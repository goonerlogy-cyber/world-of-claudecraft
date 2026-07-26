// Still-water dressing for the whole world: the Willowfen's lily rafts and
// river reeds instanced onto every declared zone lake EXCEPT the frozen
// Frostveil, the molten Drakelands, and the two realms that already dress
// their own water (the Willowfen itself and the Palmreach). One pass over
// ZONES at build time; same placement walk as the originals, render-only.
import * as THREE from 'three';
import { ZONES } from '../sim/data';
import { hollowWillowSpots } from '../sim/fen_willows';
import { hash2 } from '../sim/rng';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';

export interface WaterFloraView {
  group: THREE.Group;
  update(time: number): void;
}

const FLORA_URLS = {
  lilies: '/models/props/fen_lilies.glb',
  reeds: '/models/props/fen_reeds.glb',
  willow: '/models/props/willow_tree.glb',
} as const;
type FloraKey = keyof typeof FLORA_URLS;
const floraScenes: Partial<Record<FloraKey, THREE.Group>> = {};
for (const key of Object.keys(FLORA_URLS) as FloraKey[]) {
  registerPreload(
    loadGltf(FLORA_URLS[key]).then((gltf) => {
      floraScenes[key] = gltf.scene;
    }),
  );
}

export const waterFloraPreloadInternalsForTest = {
  propUrls: Object.values(FLORA_URLS),
};

const SKIP_BIOMES = new Set(['frost', 'ember']);
const SKIP_ZONES = new Set(['willowfen', 'palmreach']); // dress their own water

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

function extractParts(scene: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  scene.updateMatrixWorld(true);
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geo, mat: mesh.material as THREE.Material });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return parts;
}

export function buildWaterFlora(seed: number): WaterFloraView {
  const group = new THREE.Group();
  group.name = 'water-flora';

  const instanceProp = (key: FloraKey, spots: Placement[]): void => {
    const scene = floraScenes[key];
    if (!scene || spots.length === 0) return;
    for (const part of extractParts(scene)) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  };

  const lilySpots: Placement[] = [];
  const reedSpots: Placement[] = [];
  for (const zone of ZONES) {
    if (SKIP_BIOMES.has(zone.biome)) continue;
    if (SKIP_ZONES.has(zone.id)) continue;
    for (const lake of zone.lakes ?? []) {
      const lilies = 2 + Math.floor(hash2(lake.z, lake.x, seed + 6201) * 3);
      for (let k = 0; k < lilies; k++) {
        const ang = hash2(k * 3, lake.x, seed + 6211) * Math.PI * 2;
        const dist = Math.sqrt(hash2(lake.z, k * 5, seed + 6221)) * lake.radius * 0.7;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (terrainHeight(x, z, seed) > WATER_LEVEL - 0.7) continue;
        if (roadDistance(x, z) < 4) continue;
        lilySpots.push({
          x,
          z,
          y: WATER_LEVEL + 0.03,
          s: 3.5 + hash2(lake.x, k + 11, seed + 6241) * 2,
          rot: hash2(k, lake.x + 7, seed + 6231) * Math.PI * 2,
        });
      }
      const reeds = 4 + Math.floor(hash2(lake.x + 3, lake.z, seed + 6251) * 3);
      for (let k = 0; k < reeds; k++) {
        const ang = hash2(k * 7, lake.z, seed + 6261) * Math.PI * 2;
        for (let dist = lake.radius * 0.9; dist < lake.radius * 1.7; dist += 0.6) {
          const x = lake.x + Math.sin(ang) * dist;
          const z = lake.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < WATER_LEVEL - 0.45 || y > WATER_LEVEL + 0.25) continue;
          if (roadDistance(x, z) < 4) break;
          reedSpots.push({
            x,
            z,
            y: y - 0.1,
            s: 2.6 + hash2(lake.z, k + 5, seed + 6271) * 1.2,
            rot: hash2(k, lake.x + 13, seed + 6281) * Math.PI * 2,
          });
          break;
        }
      }
    }
  }
  instanceProp('lilies', lilySpots);
  instanceProp('reeds', reedSpots);

  // the Veiled Hollow's willows: drawn from the shared sim list so every
  // trunk the renderer shows is a trunk the colliders block
  instanceProp(
    'willow',
    hollowWillowSpots(seed).map((w) => ({ x: w.x, y: w.y, z: w.z, s: w.s, rot: w.rot })),
  );

  return {
    group,
    update(): void {
      // rafts and reeds ride the still water; the water shader is the motion
    },
  };
}
