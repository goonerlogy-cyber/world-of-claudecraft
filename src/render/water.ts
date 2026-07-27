import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, WORLD_SIZE } from '../sim/data';
import type { ZoneDef } from '../sim/types';
import { waterLevel } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { farVistaPlan } from './far_terrain_core';
import { GFX, SUN_DIR, sharedUniforms } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import { waterNormalish, waterNormalMaps } from './textures';
import { shoreDepthAt } from './water_core';
import { WaterSimulation, type WaterWaveUniforms } from './water_simulation';

// Water for the whole zone strip.
//
// High tier: one ShaderMaterial plane per zone (so off-screen zones frustum
// cull away) with a CPU-precomputed per-vertex shore depth. Dual scrolling
// real normal maps (three.js r165 water set, MIT) + a broad ocean-swell map
// at range, fresnel sky tint, HDR sun glints (>1 so bloom catches them), a
// shoreline foam band and a subtle wave displacement.
//
// On top of that static surface sits the interactive height field
// (water_simulation.ts): ONE camera-anchored window, not one field per lake,
// because this world's water is continuous (zone strips plus the horizon
// apron) and has no lake list to key fields off. Every water mesh shares one
// material, so the field's uniforms drive all of them by reference. The broad
// swell maps stay: the field is camera-local and contributes nothing at range,
// where an open sea still has to read as moving water.
//
// Low tier keeps the legacy scrolling Phong plane, upgraded with the real
// swell normal map for textured speculars.

const SEGMENTS_PER_ZONE = 180; // ~2u vertex spacing, enough for the foam band
// terrainHeight is deliberately rich and sampling all 32k water vertices in
// one timer was a measured 170-260ms live-play freeze. Background zone loads
// fill a handful of rows per idle callback instead; four rows stay around the
// 6ms cooperative-work budget on the profiling machine.
const WATER_ROWS_PER_IDLE_SLICE = 4;
const WATER_IDLE_TIMEOUT_MS = 200;
const WATER_VERTEX_ROWS = Array.from({ length: SEGMENTS_PER_ZONE + 1 }, (_, row) => row);

// Real water normal maps, fetched at module import and gated by the boot
// preload only for the shader tier. Low/mobile uses generated canvas water
// so it does not pay network/decode/upload cost for water detail.
const WATER_TEX: Record<string, THREE.Texture> = {};
function kickWaterTex(key: string, file: string): void {
  registerPreload(
    loadTexture(`/textures/water/${file}`, { repeat: true }).then((tex) => {
      tex.anisotropy = 4;
      WATER_TEX[key] = tex;
      return tex;
    }),
  );
}
if (GFX.standardMaterials) {
  kickWaterTex('n1', 'water_1_normal.jpg');
  kickWaterTex('n2', 'water_2_normal.jpg');
  kickWaterTex('broad', 'waternormals.jpg');
}

export function hasWaterShaderAssets(): boolean {
  return Boolean(WATER_TEX.n1 && WATER_TEX.n2 && WATER_TEX.broad);
}

const DEEP_COLOR = new THREE.Color(0x0d3a52);
const SHALLOW_COLOR = new THREE.Color(0x2d8077);
const SKY_TINT = new THREE.Color(0x7fb2e0); // matches the sky horizon band
const SUN_COLOR = new THREE.Color(0xfff0d4);

export interface WaterView {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * Advances the legacy texture scroll (low tier; high tier uses uTime) and
   * the interactive height field. Returns the simulation passes drawn this
   * frame, which the renderer folds into its draw-call accounting.
   */
  update(time: number, cameraX: number, cameraZ: number, visibleRange: number): number;
  /** Adds a local entry, landing, fish, or bobber disturbance. */
  addSplash(x: number, z: number, radius: number, strength?: number): void;
  /** Presses a facing-aligned body footprint into the surface. */
  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Moves submerged volume from the previous footprint to the current one. */
  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Refills the final submerged footprint when a contact exits. */
  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /**
   * Editor-only: re-seat the surface at the ACTIVE waterLevel() and recompute
   * the per-vertex shore depth from the CURRENT terrainHeight (after a
   * water-level change or a sculpt near the shoreline). Updates the existing
   * geometry in place (no geometry is replaced, so nothing leaks); the low
   * Phong tier has no shore attribute and only repositions its one plane.
   */
  setLevel(): void;
  /** Releases view-owned geometry, materials, and simulation targets. */
  dispose(): void;
}

// Shared by the vertex and fragment stages: map a world xz onto the anchored
// height-field window, and report whether the sample actually lands inside it.
// Outside the window there is no state to read, and clamping to the rim would
// smear the border texel across the entire distant sea.
const WAVE_SAMPLE_GLSL = /* glsl */ `
  bool waveSampleAt(vec2 worldXZ, out vec4 wave) {
    vec2 waveUv = (worldXZ - uWaveOrigin) / uWaveSize;
    if (any(lessThan(waveUv, vec2(0.0))) || any(greaterThan(waveUv, vec2(1.0)))) {
      wave = vec4(0.0);
      return false;
    }
    wave = texture2D(uWaveState, waveUv);
    return true;
  }
`;

const WATER_VERT = /* glsl */ `
  attribute float aShoreDepth;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  varying vec3 vWPos;
  varying float vShoreDepth;
  #include <fog_pars_vertex>
  ${WAVE_SAMPLE_GLSL}
  void main() {
    vec3 pos = position;
    pos.y += (sin(uTime * 1.1 + pos.x * 0.35) + sin(uTime * 0.7 + pos.z * 0.28)) * 0.05;
    if (uWaveEnabled > 0.001) {
      vec4 wave;
      if (waveSampleAt(pos.xz, wave)) pos.y += wave.r * uWaveEnabled;
    }
    vShoreDepth = aShoreDepth;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D uNorm1;
  uniform sampler2D uNorm2;
  uniform sampler2D uNorm3;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  varying vec3 vWPos;
  varying float vShoreDepth;
  #include <common>
  #include <fog_pars_fragment>
  ${WAVE_SAMPLE_GLSL}
  void main() {
    float camDist = length(cameraPosition - vWPos);
    // dual-scroll detail ripples (real three.js water normal maps)
    vec3 n1 = texture2D(uNorm1, vWPos.xz * 0.055 + uTime * vec2(0.013, 0.019)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm2, vWPos.xz * 0.115 - uTime * vec2(0.021, 0.011)).xyz * 2.0 - 1.0;
    // broad slow ocean swell that survives at range, where the detail maps
    // average out to a mirror, keeps big water surfaces alive from above
    vec3 n3 = texture2D(uNorm3, vWPos.xz * 0.016 + uTime * vec2(0.005, -0.004)).xyz * 2.0 - 1.0;
    float farW = smoothstep(24.0, 140.0, camDist);
    // rippled up close -> glassy at distance: detail fades out, swell stays
    vec2 nm = mix(n1.xy * 0.85 + n2.xy * 0.6, n3.xy * 1.5, farW * 0.78);
    // interactive wakes ride on top of the static maps, near the camera only
    vec2 waveSlope = vec2(0.0);
    float waveEnergy = 0.0;
    if (uWaveEnabled > 0.001) {
      vec4 wave;
      if (waveSampleAt(vWPos.xz, wave)) {
        waveSlope = wave.ba * uWaveEnabled;
        waveEnergy = (abs(wave.g) * 0.9 + length(wave.ba) * 0.4) * uWaveEnabled;
      }
    }
    vec3 N = normalize(vec3(nm + waveSlope * 9.5, 3.1).xzy);
    vec3 V = normalize(cameraPosition - vWPos);
    float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    float depth = clamp(vShoreDepth / 6.0, 0.0, 1.0);
    vec3 col = mix(uShallow, uDeep, depth);
    // dappled shimmer that fades with distance so it never reads as speckle
    float shimmer = max(n1.x * 0.7 + n2.y * 0.55, 0.0) * exp(-camDist * 0.022);
    col *= 0.92 + 0.4 * shimmer;
    // reflection tracks the live fog/horizon color so each biome's water
    // belongs to its sky instead of a constant pasted-on tint
    vec3 skyRef = mix(uSkyColor, fogColor, 0.5);
    col = mix(col, skyRef, min(fresnel * 0.65, 0.42));
    float sunAlign = max(dot(reflect(-uSunDir, N), V), 0.0);
    col += uSunColor * pow(sunAlign, 130.0) * 2.6;                   // sparkle glints (>1 -> bloom)
    col += uSunColor * pow(sunAlign, 28.0) * 0.30;                   // wider lobe: survives steep cameras
    col += uSunColor * pow(sunAlign, 6.0) * 0.05;                    // faint warm sheen sunward
    // shoreline foam: wide animated band hugging the waterline (the shore
    // attribute is per-vertex at ~2u, so the band must span several units)
    float foamBand = smoothstep(3.2, 0.1, vShoreDepth + n1.x * 0.7);
    foamBand *= foamBand;
    float foamWave = 0.62 + 0.38 * sin(uTime * 1.7 + vWPos.x * 1.2 + vWPos.z * 0.95 + n2.y * 6.0);
    float foam = foamBand * foamWave;
    // disturbed water reads brighter and skyward, the way a real wake does
    float contactSheen = smoothstep(0.025, 0.13, waveEnergy) * exp(-camDist * 0.022);
    col = mix(col, mix(uShallow, uSkyColor, 0.52), contactSheen * 0.24);
    col = mix(col, vec3(1.05), clamp(foam, 0.0, 0.9));
    float surfaceAccent = clamp(foam + contactSheen * 0.12, 0.0, 0.92);
    float alpha = max(mix(0.84, 0.96, depth), surfaceAccent * 0.95);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function disposeOwned(meshes: THREE.Mesh[]): void {
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else materials.add(material);
  }
  for (const material of materials) material.dispose();
}

function zeroWaveUniforms(): WaterWaveUniforms {
  return {
    uWaveState: { value: WATER_TEX.n1 },
    uWaveEnabled: { value: 0 },
    uWaveOrigin: { value: new THREE.Vector2() },
    uWaveSize: { value: 1 },
  };
}

function buildShaderWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  // legacy procedural maps still get generated (unused) to preserve the
  // shared-LCG call order in textures.ts for everything generated after
  waterNormalMaps();
  const simulation = renderer ? new WaterSimulation(renderer) : null;
  const wave = simulation ? simulation.uniforms : zeroWaveUniforms();
  // ONE material for every zone plane and the apron, so the field's uniform
  // objects (shared by reference, like uTime) drive the whole surface.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uNorm1: { value: WATER_TEX.n1 },
      uNorm2: { value: WATER_TEX.n2 },
      uNorm3: { value: WATER_TEX.broad },
      uSunDir: { value: SUN_DIR.clone() }, // the one shared sun (gfx.ts)
      uSunColor: { value: SUN_COLOR },
      uSkyColor: { value: SKY_TINT },
      uDeep: { value: DEEP_COLOR },
      uShallow: { value: SHALLOW_COLOR },
      uTime: sharedUniforms.uTime,
      uWaveState: wave.uWaveState,
      uWaveEnabled: wave.uWaveEnabled,
      uWaveOrigin: wave.uWaveOrigin,
      uWaveSize: wave.uWaveSize,
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });

  const meshes: THREE.Mesh[] = [];
  const group = new THREE.Group();
  group.name = 'water';
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<THREE.Mesh[]>>();
  // Per-mesh in-place refit closures: re-seat y and recompute the shore-depth
  // attribute from the CURRENT terrain (build and setLevel share them). The
  // vertices never move (only the attribute + the mesh transform change), so
  // the baked bounding volumes stay valid.
  const refits: (() => void)[] = [];
  // The apron: one huge deep-sea sheet running far past every map edge, so
  // looking off the world's side reads as open ocean to the fog line, never
  // a water plane ending in mid-air. It sits a hair below the zone planes
  // (no z-fight) and carries a constant deep shore attribute. Its reach must
  // beat the fog envelope from ANY camera position or its rim shows as a
  // line against the sky; the vista tiers open that envelope well past the
  // classic 850, so the apron grows with the tier's vista plan.
  {
    const vista = farVistaPlan(GFX.tier, GFX.constrainedMemory);
    const reach = vista.enabled ? WORLD_MAX_X + vista.envelopeFar + 400 : 0;
    const width = vista.enabled ? reach * 2 : 3000;
    const span = WORLD_MAX_Z - WORLD_MIN_Z + (vista.enabled ? reach * 2 : 2400);
    const geo = new THREE.PlaneGeometry(width, span, 1, 1).rotateX(-Math.PI / 2);
    geo.translate(0, 0, (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const deep = new Float32Array(pos.count).fill(8);
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(deep, 1));
    geo.computeBoundingSphere();
    const apron = new THREE.Mesh(geo, material);
    apron.position.y = waterLevel() - 0.06;
    meshes.push(apron);
    group.add(apron);
    refits.push(() => {
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      apron.position.y = waterLevel() - 0.06;
    });
  }
  const buildZone = async (zone: ZoneDef, idlePace: boolean): Promise<THREE.Mesh> => {
    const depth = zone.zMax - zone.zMin;
    // each plane covers its zone's own rect: the side columns live at
    // x beyond the strip, and a strip-centered plane would leave their
    // shores (and the border meres straddling the column line) on the
    // featureless apron with no foam or shallow grading
    const x0 = zone.xMin ?? -WORLD_SIZE / 2;
    const x1 = zone.xMax ?? WORLD_SIZE / 2;
    const geo = new THREE.PlaneGeometry(
      x1 - x0,
      depth,
      SEGMENTS_PER_ZONE,
      SEGMENTS_PER_ZONE,
    ).rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (zone.zMin + zone.zMax) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const shoreDepth = new Float32Array(pos.count);
    const columns = SEGMENTS_PER_ZONE + 1;
    const fillRow = (row: number): void => {
      const start = row * columns;
      const end = Math.min(pos.count, start + columns);
      for (let i = start; i < end; i++) {
        shoreDepth[i] = shoreDepthAt(pos.getX(i), pos.getZ(i), seed);
      }
    };
    const fill = (): void => {
      for (const row of WATER_VERTEX_ROWS) fillRow(row);
    };
    if (idlePace) {
      await runIdleQueue(WATER_VERTEX_ROWS, fillRow, {
        batchSize: WATER_ROWS_PER_IDLE_SLICE,
        timeoutMs: WATER_IDLE_TIMEOUT_MS,
      });
    } else {
      fill();
    }
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(shoreDepth, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = waterLevel();
    // The renderer compiles a background zone's material while this mesh is
    // hidden, then reveals it. Adding it visible here lets the next rAF draw
    // (and synchronously upload/link) it before prepareZoneAt can prewarm it.
    mesh.visible = !idlePace;
    meshes.push(mesh);
    group.add(mesh);
    refits.push(() => {
      fill();
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      mesh.position.y = waterLevel();
    });
    return mesh;
  };
  return {
    group,
    meshes,
    ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]> {
      if (loadedZones.has(zone.id)) return Promise.resolve([]);
      const pending = pendingZones.get(zone.id);
      if (pending) return pending;
      const idlePace = opts?.pace === 'idle';
      const scheduled = idlePace
        ? idleSlot(WATER_IDLE_TIMEOUT_MS)
        : new Promise<void>((resolve) => setTimeout(resolve, 0));
      const task = scheduled
        .then(async () => {
          const mesh = await buildZone(zone, idlePace);
          loadedZones.add(zone.id);
          return [mesh];
        })
        .finally(() => pendingZones.delete(zone.id));
      pendingZones.set(zone.id, task);
      return task;
    },
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    update(_time: number, cameraX: number, cameraZ: number): number {
      return simulation?.update(_time, cameraX, cameraZ) ?? 0;
    },
    addSplash(x: number, z: number, radius: number, strength = 1): void {
      simulation?.addSplash(x, z, radius, strength);
    },
    enterContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.enterContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    moveContact(
      oldX: number,
      oldZ: number,
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.moveContact(oldX, oldZ, x, z, radius, halfLength, axisX, axisZ, strength);
    },
    releaseContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.releaseContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    setLevel(): void {
      simulation?.reset();
      for (const refit of refits) refit();
    },
    dispose(): void {
      simulation?.dispose();
      disposeOwned(meshes);
    },
  };
}

function buildPhongWater(): WaterView {
  const tex = waterNormalish();
  const [norm] = waterNormalMaps();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2a6a96,
    transparent: true,
    opacity: 0.8,
    shininess: 140,
    specular: 0xd8ecff,
    map: tex,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  // low tier gets the same to-the-horizon apron by simply oversizing the
  // one plane (the tiled texture keeps its density via the repeat bump)
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z + 2400;
  tex.repeat.set(240, 240);
  norm.repeat.set(210, 620);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, worldDepth).rotateX(-Math.PI / 2), mat);
  mesh.position.set(0, waterLevel(), (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
  const meshes = [mesh];
  const group = new THREE.Group();
  group.name = 'water';
  group.add(mesh);
  return {
    group,
    meshes,
    ensureZone: async () => [],
    isZoneLoaded: () => true,
    // The low tier has no height field at all: a Phong plane cannot sample one,
    // and the tier exists precisely to skip that GPU work.
    update(time: number): number {
      tex.offset.x = time * 0.008;
      tex.offset.y = time * 0.011;
      norm.offset.x = time * 0.006;
      norm.offset.y = time * 0.009;
      return 0;
    },
    addSplash: () => {},
    enterContact: () => {},
    moveContact: () => {},
    releaseContact: () => {},
    setLevel(): void {
      for (const m of meshes) m.position.y = waterLevel();
    },
    dispose(): void {
      disposeOwned(meshes);
    },
  };
}

export function buildWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  return GFX.standardMaterials && hasWaterShaderAssets()
    ? buildShaderWater(seed, renderer)
    : buildPhongWater();
}
