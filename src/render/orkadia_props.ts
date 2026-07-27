// Orkadia open-field interior (DungeonDef interior 'orkadia'): the first dungeon
// whose instance is open air instead of a closed KayKit room. An outdoor orc
// war-camp under the sky: a broad volcanic-ash ground plane on the flat instance
// floor, the 18 generated orkadia_* prop GLBs placed as a war-camp, green
// warpyre accents, and a volcanic cliff ring as the visual perimeter (no room
// walls, no ceiling; the sky/fog/light rig is the renderer's own outdoor
// machinery, see the 'orkadiaField' fogState in renderer.ts).
//
// The placement table is shared with the sim: ORKADIA_FIELD_PLACEMENTS and
// ORKADIA_FIELD_COLLIDER_SPECS live in src/sim/orkadia_field.ts and drive BOTH
// these meshes and INTERIOR_COLLIDERS.orkadia, so render and collision cannot
// drift. GLB-first with a merged-primitive fallback per kind, in the
// rift_decor/artisan_row pattern. All coordinates are instance-local; the
// builder positions the returned group at the claimed slot's origin, like the
// other interior builders in dungeon.ts.

import * as THREE from 'three';
import {
  ORKADIA_FIELD_COLLIDER_SPECS,
  ORKADIA_FIELD_PLACEMENTS,
  type OrkadiaPropKind,
} from '../sim/orkadia_field';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { groundDetailTexture, radialGlowTexture } from './textures';

// Toxic warpyre green (the old TORCH_COLORS.orkadia grade): flame, emissive,
// and point-light pools for the braziers and torch posts.
const WARPYRE_FLAME = 0x9dff66;
const WARPYRE_EMISSIVE = 0x3aa82a;
const WARPYRE_LIGHT = 0x86f060;
const FLAME_EMISSIVE_HIGH = 2.2;
// Warpyre point lights: gentler than the closed-room torch rig (the outdoor
// sun/hemi rig stays up in this interior), same budget path via fireLights.
const WARPYRE_LIGHT_Y = 2.4;
const WARPYRE_LIGHT_INTENSITY = 24;
const WARPYRE_LIGHT_DISTANCE = 26;

// Volcanic ash ground: dark mossy green over the grayscale mottled detail
// texture every terrain surface reuses, tiled across the field plane.
const GROUND_COLOR = 0x3a4430;
const GROUND_WIDTH = 240;
const GROUND_DEPTH = 260;
const GROUND_CENTER_Z = 74; // covers the field (z -12..160) plus the cliff ring

const ORKADIA_ASSET_URL: Record<OrkadiaPropKind, string> = {
  orkadia_spiked_barricade: '/models/props/orkadia_spiked_barricade.glb',
  orkadia_war_totem: '/models/props/orkadia_war_totem.glb',
  orkadia_war_banner: '/models/props/orkadia_war_banner.glb',
  orkadia_green_brazier: '/models/props/orkadia_green_brazier.glb',
  orkadia_skull_pile: '/models/props/orkadia_skull_pile.glb',
  orkadia_weapon_rack: '/models/props/orkadia_weapon_rack.glb',
  orkadia_volcanic_cliff: '/models/props/orkadia_volcanic_cliff.glb',
  orkadia_war_gate: '/models/props/orkadia_war_gate.glb',
  orkadia_war_hall: '/models/props/orkadia_war_hall.glb',
  orkadia_skull_dais: '/models/props/orkadia_skull_dais.glb',
  orkadia_watchtower: '/models/props/orkadia_watchtower.glb',
  orkadia_palisade: '/models/props/orkadia_palisade.glb',
  orkadia_war_drum: '/models/props/orkadia_war_drum.glb',
  orkadia_prisoner_cage: '/models/props/orkadia_prisoner_cage.glb',
  orkadia_bone_throne: '/models/props/orkadia_bone_throne.glb',
  orkadia_torch_post: '/models/props/orkadia_torch_post.glb',
  orkadia_trophy_pole: '/models/props/orkadia_trophy_pole.glb',
  orkadia_supply_crates: '/models/props/orkadia_supply_crates.glb',
};

// Target height (yd), matched to each generation job's --height so the fallback
// primitives occupy the same silhouette the real GLB settles into.
const ORKADIA_TARGET_HEIGHT: Record<OrkadiaPropKind, number> = {
  orkadia_spiked_barricade: 1.6,
  orkadia_war_totem: 2.2,
  orkadia_war_banner: 2.0,
  orkadia_green_brazier: 0.7,
  orkadia_skull_pile: 0.8,
  orkadia_weapon_rack: 1.2,
  orkadia_volcanic_cliff: 6.0,
  orkadia_war_gate: 3.4,
  orkadia_war_hall: 4.2,
  orkadia_skull_dais: 1.0,
  orkadia_watchtower: 3.8,
  orkadia_palisade: 1.4,
  orkadia_war_drum: 0.8,
  orkadia_prisoner_cage: 1.3,
  orkadia_bone_throne: 0.9,
  orkadia_torch_post: 1.3,
  orkadia_trophy_pole: 2.2,
  orkadia_supply_crates: 0.7,
};

// Local GLB cache keyed by prop kind. A `null` cache entry means asset load
// failed and fallback primitives are active for the rest of the run.
type OrkadiaGltf = Awaited<ReturnType<typeof loadGltf>>;
const loadedOrkadiaGltf = new Map<OrkadiaPropKind, OrkadiaGltf | null>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(ORKADIA_ASSET_URL) as [OrkadiaPropKind, string][]) {
    registerPreload(
      loadGltf(url)
        .then((gltf: OrkadiaGltf) => {
          const scene = gltf.scene;
          scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              markSharedGeometry(child.geometry);
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const mat of mats) markSharedMaterial(mat);
            }
          });
          loadedOrkadiaGltf.set(kind, gltf);
        })
        .catch(() => {
          loadedOrkadiaGltf.set(kind, null);
        }),
    );
  }
}

/** Test-only window into the preload / placement tables (pure test import mirror). */
export const orkadiaPropsPreloadInternalsForTest = {
  assetUrl: ORKADIA_ASSET_URL,
  targetHeight: ORKADIA_TARGET_HEIGHT,
  placements: ORKADIA_FIELD_PLACEMENTS,
  colliderSpecs: ORKADIA_FIELD_COLLIDER_SPECS,
};

interface OrkadiaFallbackSpec {
  w: number;
  h: number;
  d: number;
  color: number;
}

const ORKADIA_FALLBACK_GEOMETRY: Record<OrkadiaPropKind, OrkadiaFallbackSpec> = {
  orkadia_spiked_barricade: { w: 0.55, h: 1.5, d: 2.4, color: 0x74614b },
  orkadia_war_totem: { w: 0.8, h: 2.2, d: 0.8, color: 0x7a6b3c },
  orkadia_war_banner: { w: 1.7, h: 2.0, d: 0.6, color: 0xb44a4a },
  orkadia_green_brazier: { w: 0.5, h: 0.6, d: 0.5, color: 0x5a4e34 },
  orkadia_skull_pile: { w: 0.8, h: 0.7, d: 0.8, color: 0x4b4943 },
  orkadia_weapon_rack: { w: 1.2, h: 1.0, d: 1.1, color: 0x7e6f52 },
  orkadia_volcanic_cliff: { w: 6.5, h: 2.3, d: 4.8, color: 0x30241b },
  orkadia_war_gate: { w: 4.8, h: 2.4, d: 2.6, color: 0x6a5a4a },
  orkadia_war_hall: { w: 9.5, h: 2.8, d: 7.0, color: 0x584839 },
  orkadia_skull_dais: { w: 2.2, h: 0.8, d: 2.2, color: 0x5f5a4a },
  orkadia_watchtower: { w: 2.3, h: 3.7, d: 2.3, color: 0x5a4e36 },
  orkadia_palisade: { w: 0.4, h: 1.2, d: 2.2, color: 0x6f6848 },
  orkadia_war_drum: { w: 1.1, h: 0.7, d: 1.8, color: 0x604a22 },
  orkadia_prisoner_cage: { w: 1.5, h: 1.2, d: 1.0, color: 0x5a4735 },
  orkadia_bone_throne: { w: 1.0, h: 0.8, d: 1.4, color: 0x5e4e37 },
  orkadia_torch_post: { w: 0.45, h: 1.3, d: 0.45, color: 0x51462f },
  orkadia_trophy_pole: { w: 0.35, h: 2.0, d: 0.35, color: 0x7f6e54 },
  orkadia_supply_crates: { w: 1.2, h: 0.6, d: 0.8, color: 0x7a5f3a },
};

function buildFallbackMesh(kind: OrkadiaPropKind): THREE.Group {
  const spec = ORKADIA_FALLBACK_GEOMETRY[kind];
  const mat = surfaceMat({ color: spec.color });
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mat);
  base.position.y = spec.h / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  if (kind === 'orkadia_war_gate') {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h * 0.22, spec.h * 0.1), mat);
    lintel.position.set(0, spec.h * 0.82, spec.d * 0.18);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    group.add(lintel);
  }

  if (kind === 'orkadia_war_totem' || kind === 'orkadia_trophy_pole') {
    const token = new THREE.Mesh(new THREE.ConeGeometry(spec.w * 0.22, spec.h * 0.5, 8), mat);
    token.position.set(0, spec.h * 0.95, 0);
    token.castShadow = true;
    token.receiveShadow = true;
    group.add(token);
  }

  if (kind === 'orkadia_watchtower' || kind === 'orkadia_palisade') {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.w * 0.12, spec.w * 0.12, spec.h * 0.35),
      mat,
    );
    beam.position.set(0, spec.h * 0.62, 0);
    beam.castShadow = true;
    beam.receiveShadow = true;
    group.add(beam);
  }

  if (kind === 'orkadia_war_hall' || kind === 'orkadia_volcanic_cliff') {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w * 0.85, spec.h * 0.15, spec.d * 0.85),
      mat,
    );
    roof.position.set(0, spec.h * 1.1, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);
  }

  if (kind === 'orkadia_bone_throne') {
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w * 0.65, spec.h * 0.3, spec.d * 0.75),
      mat,
    );
    seat.position.set(0, spec.h * 0.2, spec.d * 0.2);
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);
  }

  if (kind === 'orkadia_skull_dais' || kind === 'orkadia_green_brazier') {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.w * 0.55, spec.w * 0.55, spec.h * 0.08, 20),
      mat,
    );
    ring.position.y = spec.h * 0.1;
    ring.castShadow = true;
    ring.receiveShadow = true;
    group.add(ring);
  }

  if (kind === 'orkadia_war_totem') {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.w * 0.26, spec.w * 0.36, spec.h * 0.22, 12),
      mat,
    );
    base.position.y = spec.h * 0.06;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
  }

  return group;
}

function buildOrkadiaMesh(kind: OrkadiaPropKind): THREE.Object3D {
  const loaded = loadedOrkadiaGltf.get(kind);
  if (!loaded) return buildFallbackMesh(kind);
  const inst = loaded.scene.clone(true);
  const box = new THREE.Box3().setFromObject(inst);
  const rawHeight = box.max.y - box.min.y;
  const target = ORKADIA_TARGET_HEIGHT[kind] || 1;
  const scale = rawHeight > 1e-4 ? target / rawHeight : 1;
  inst.scale.setScalar(scale);
  const scaled = new THREE.Box3().setFromObject(inst);
  inst.position.y -= scaled.min.y;
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return inst;
}

// ---------------------------------------------------------------------------
// The open-field interior builder
// ---------------------------------------------------------------------------

/** Registries the renderer shares with every interior (see DungeonInteriors):
 * flames get the per-frame flicker, fireLights the point-light budget; both are
 * pruned when the interior group retires. */
export interface OrkadiaFieldInteriorDeps {
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: THREE.PointLight[];
}

// Module-level shared resources (built once, reused by every claimed slot's
// copy of the field; marked shared so per-view disposal skips them).
let groundGeo: THREE.BufferGeometry | null = null;
let groundTex: THREE.Texture | null = null;
let flameGeo: THREE.BufferGeometry | null = null;
let flameMat: THREE.MeshLambertMaterial | null = null;
let glowGeo: THREE.BufferGeometry | null = null;
let glowTex: THREE.Texture | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;

function orkadiaGroundMesh(): THREE.Mesh {
  if (!groundGeo) {
    groundGeo = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH).rotateX(-Math.PI / 2);
    markSharedGeometry(groundGeo);
  }
  if (!groundTex) {
    groundTex = groundDetailTexture();
    groundTex.repeat.set(Math.round(GROUND_WIDTH / 5), Math.round(GROUND_DEPTH / 5));
  }
  const mat = surfaceMat({ color: GROUND_COLOR, map: groundTex, roughness: 1 });
  markSharedMaterial(mat);
  const ground = new THREE.Mesh(groundGeo, mat);
  ground.position.set(0, 0, GROUND_CENTER_Z);
  ground.receiveShadow = true;
  return ground;
}

// Animated warpyre flame cone, same renderer contract as the dungeon torches:
// the mesh goes into deps.flames (per-frame flicker) and a budgeted PointLight
// with userData.baseIntensity goes into deps.fireLights.
function addWarpyre(
  group: THREE.Group,
  deps: OrkadiaFieldInteriorDeps,
  x: number,
  z: number,
  y: number,
): void {
  if (!flameGeo) {
    flameGeo = new THREE.ConeGeometry(0.22, 0.6, 6);
    markSharedGeometry(flameGeo);
  }
  if (!flameMat) {
    flameMat = new THREE.MeshLambertMaterial({
      color: WARPYRE_FLAME,
      emissive: WARPYRE_EMISSIVE,
      emissiveIntensity: deps.lowGfx ? 1.6 : FLAME_EMISSIVE_HIGH,
      transparent: true,
      opacity: 0.92,
    });
    markSharedMaterial(flameMat);
  }
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(x, y, z);
  group.add(flame);
  deps.flames.push(flame);

  const light = new THREE.PointLight(
    WARPYRE_LIGHT,
    deps.lowGfx ? 8 : 10,
    deps.lowGfx ? 18 : WARPYRE_LIGHT_DISTANCE,
    2,
  );
  if (!deps.lowGfx) light.userData.baseIntensity = WARPYRE_LIGHT_INTENSITY;
  light.position.set(x, y + WARPYRE_LIGHT_Y * 0.5, z);
  group.add(light);
  deps.fireLights.push(light);
}

// Additive light-pool decal under a warpyre / on the boss dais: the point-light
// budget only keeps the nearest few lights live, so the floor pools are baked
// in (same trick as DungeonInteriors.addTorchGlow).
function addWarpyreGlow(
  group: THREE.Group,
  deps: OrkadiaFieldInteriorDeps,
  x: number,
  z: number,
  y = 0.07,
  scale = 1,
): void {
  if (deps.lowGfx) return;
  if (!glowGeo) {
    glowGeo = new THREE.CircleGeometry(6.6, 20).rotateX(-Math.PI / 2);
    markSharedGeometry(glowGeo);
  }
  if (!glowTex) glowTex = radialGlowTexture();
  if (!glowMat) {
    glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: WARPYRE_LIGHT,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    markSharedMaterial(glowMat);
  }
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(x, y, z);
  glow.scale.setScalar(scale);
  glow.renderOrder = 1; // after the ground plane it floats over
  group.add(glow);
}

// Build one copy of the Orkadia open field at instance-local origin (0,0);
// the caller positions the returned group at the claimed slot's (ox, oz) and
// adds it to the scene, exactly like DungeonInteriors.buildInterior. Lazy: the
// renderer only calls this when a player enters the instance band, and the GLBs
// resolve synchronously out of the import-time preload cache above.
export function buildOrkadiaFieldInterior(deps: OrkadiaFieldInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  group.name = 'orkadiaField';

  group.add(orkadiaGroundMesh());

  for (const p of ORKADIA_FIELD_PLACEMENTS) {
    const obj = buildOrkadiaMesh(p.kind);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.position.set(p.x, 0, p.z); // the instance floor is flat (y=0)
    holder.rotation.y = p.rot;
    group.add(holder);
  }

  // Warpyre accents: a flame + budgeted green point light on every brazier and
  // torch post (5 lights total, well inside the interior light budget).
  for (const p of ORKADIA_FIELD_PLACEMENTS) {
    if (p.kind === 'orkadia_green_brazier') {
      addWarpyre(group, deps, p.x, p.z, ORKADIA_TARGET_HEIGHT.orkadia_green_brazier + 0.35);
      addWarpyreGlow(group, deps, p.x, p.z);
    } else if (p.kind === 'orkadia_torch_post') {
      addWarpyre(group, deps, p.x, p.z, ORKADIA_TARGET_HEIGHT.orkadia_torch_post + 0.35);
      addWarpyreGlow(group, deps, p.x, p.z, 0.07, 0.7);
    }
  }
  // A warpyre pool on the walkable skull dais so the boss stage never reads as
  // a black slab, and one under the war gate arching the approach.
  addWarpyreGlow(group, deps, 0, 146, 0.07, 1.8);
  addWarpyreGlow(group, deps, 0, 12, 0.07, 1.2);

  return group;
}
