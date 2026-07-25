// Artisan Row: decorative crafting-flavor clutter for the ten crafting/gathering
// professions that have no environmental presence elsewhere in Eastbrook Vale
// (weaponcrafting/armorcrafting already get an anvil at Smith Haldren's stall,
// see props.ts). Purely cosmetic, render-only: no collision, no interaction, no
// sim/IWorld state. Each item is a small Tripo-generated GLB (see
// public/models/props/CLAUDE.md), placed once around Smith Haldren's stall in
// zone1. A merged-primitive fallback keeps the brief pre-load window from
// showing an empty patch of ground, mirroring gather_nodes.ts.

import * as THREE from 'three';
import { BUILTIN_WORLD, getActiveWorldContent } from '../sim/data';
import {
  type ArtisanPropKind,
  ARTISAN_ROW_PLACEMENTS as SIM_ARTISAN_ROW_PLACEMENTS,
} from '../sim/town_props';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';

// Half-step (yd) used to finite-difference the local ground slope under each
// prop, so furniture-scale props tilt to match sloped terrain instead of
// floating/sinking a corner. Small relative to placement spacing.
const PITCH_SAMPLE_STEP = 0.4;

const ARTISAN_ASSET_URL: Record<ArtisanPropKind, string> = {
  engineering_workbench: '/models/props/engineering_workbench.glb',
  alchemy_cauldron: '/models/props/alchemy_cauldron.glb',
  cooking_spit: '/models/props/cooking_spit.glb',
  leatherworking_rack: '/models/props/leatherworking_rack.glb',
  tailoring_loom: '/models/props/tailoring_loom.glb',
  inscription_lectern: '/models/props/inscription_lectern.glb',
  enchanting_altar: '/models/props/enchanting_altar.glb',
  jewelcrafting_bench: '/models/props/jewelcrafting_bench.glb',
  mining_ore_cart: '/models/props/mining_ore_cart.glb',
  herbalism_drying_rack: '/models/props/herbalism_drying_rack.glb',
};

// Target height (yd), matched to each generation job's --height so the fallback
// box occupies the same footprint the real GLB will settle into.
const ARTISAN_TARGET_HEIGHT: Record<ArtisanPropKind, number> = {
  engineering_workbench: 1.0,
  alchemy_cauldron: 0.9,
  cooking_spit: 0.85,
  leatherworking_rack: 1.5,
  tailoring_loom: 1.3,
  inscription_lectern: 1.1,
  enchanting_altar: 1.0,
  jewelcrafting_bench: 0.9,
  mining_ore_cart: 1.1,
  herbalism_drying_rack: 1.4,
};

// The placements now live in `src/sim/town_props.ts` so COLLISION can see
// them: ten solid pieces of furniture stand along this row, and until the sim
// owned their positions a player walked straight through every one.
const ARTISAN_ROW_PLACEMENTS = SIM_ARTISAN_ROW_PLACEMENTS;

const loadedArtisanGltf = new Map<ArtisanPropKind, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(ARTISAN_ASSET_URL) as [ArtisanPropKind, string][]) {
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedArtisanGltf.set(kind, gltf.scene);
      }),
    );
  }
}

/** Test-only window into the preload asset set (mirrors props.ts/gather_nodes.ts). */
export const artisanRowPreloadInternalsForTest = {
  assetUrl: ARTISAN_ASSET_URL,
  targetHeight: ARTISAN_TARGET_HEIGHT,
  placements: ARTISAN_ROW_PLACEMENTS,
};

function buildFallbackMesh(kind: ArtisanPropKind): THREE.Object3D {
  const h = ARTISAN_TARGET_HEIGHT[kind];
  const geo = new THREE.BoxGeometry(h * 0.7, h, h * 0.7);
  const mesh = new THREE.Mesh(geo, surfaceMat({ color: 0x8a6a4a }));
  mesh.position.y = h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildArtisanMesh(kind: ArtisanPropKind): THREE.Object3D {
  const loaded = loadedArtisanGltf.get(kind);
  if (!loaded) return buildFallbackMesh(kind);
  const inst = loaded.clone(true);
  // Normalize to the target height and re-seat the base at y=0 (the GLB's
  // authored origin is not guaranteed to sit on the ground plane).
  const box = new THREE.Box3().setFromObject(inst);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 1e-4 ? ARTISAN_TARGET_HEIGHT[kind] / rawHeight : 1;
  inst.scale.setScalar(scale);
  const scaledBox = new THREE.Box3().setFromObject(inst);
  inst.position.y -= scaledBox.min.y;
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return inst;
}

export interface ArtisanRowView {
  group: THREE.Group;
}

// Local ground normal at (x, z), from a finite-difference sample of terrainHeight.
function groundNormal(x: number, z: number, seed: number): THREE.Vector3 {
  const s = PITCH_SAMPLE_STEP;
  const hPX = terrainHeight(x + s, z, seed);
  const hNX = terrainHeight(x - s, z, seed);
  const hPZ = terrainHeight(x, z + s, seed);
  const hNZ = terrainHeight(x, z - s, seed);
  return new THREE.Vector3(-(hPX - hNX) / (2 * s), 1, -(hPZ - hNZ) / (2 * s)).normalize();
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// This is a hand-authored landmark for the built-in Eastbrook Vale zone1 stall,
// not procedural world dressing: it hardcodes zone1 coordinates, so it must
// only place props against the built-in world. The editor's play-test swaps in
// a different WorldContent via setActiveWorldContent; without this guard these
// ten fixed spots would still appear on a custom map, possibly inside a
// building or below water.
export function buildArtisanRowProps(seed: number): ArtisanRowView {
  const group = new THREE.Group();
  group.name = 'artisanRowProps';
  if (getActiveWorldContent() !== BUILTIN_WORLD) return { group };
  for (const p of ARTISAN_ROW_PLACEMENTS) {
    const obj = buildArtisanMesh(p.kind);
    obj.position.x = p.x;
    obj.position.z = p.z;
    obj.position.y += terrainHeight(p.x, p.z, seed);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, p.rot);
    const tiltQuat = new THREE.Quaternion().setFromUnitVectors(
      WORLD_UP,
      groundNormal(p.x, p.z, seed),
    );
    obj.quaternion.copy(tiltQuat.multiply(yawQuat));
    group.add(obj);
  }
  return { group };
}
