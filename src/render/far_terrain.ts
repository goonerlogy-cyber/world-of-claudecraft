// The far-vista terrain painter: a whole-world coarse mesh (one Lambert
// material, about a dozen frustum-culled tiles) drawn beyond the classic
// detail envelope so the horizon shows the real world instead of a fog
// wall. All decisions live in far_terrain_core.ts (pure, Node-tested);
// this file only owns the Three objects and the idle-paced build loop.
//
// Cost model: the tiles are static world-space geometry built once per
// session (about 100-200ms of terrainHeight sampling, spread across idle
// slots, nearest tiles first). Per frame the layer costs one visibility
// loop over ~12 tiles plus the draw of whatever survives the frustum and
// the fog wall: tiles beyond the live fog distance hide outright (their
// pixels would be pure fog color, which the sky dome's horizon band
// already paints), so the murk realms pay almost nothing. Fragments
// inside the detail envelope are discarded in the shader; that overlap
// band is where the real terrain owns every pixel.

import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../sim/data';
import {
  createFarTileBuilder,
  type FarTile,
  type FarVistaPlan,
  farGridIndices,
  farGridSide,
  farTileBuildOrder,
  farTileVisible,
  planFarTiles,
} from './far_terrain_core';
import { idleSlot } from './idle_queue';

// One Uint16 index buffer per (tileSize, spacing): every tile of one
// spacing has identical topology, so a dozen tiles share one buffer.
const indexCache = new Map<string, THREE.BufferAttribute>();
function sharedIndexFor(tileSize: number, spacing: number): THREE.BufferAttribute {
  const key = `${tileSize}:${spacing}`;
  let index = indexCache.get(key);
  if (!index) {
    index = new THREE.BufferAttribute(farGridIndices(farGridSide(tileSize, spacing)), 1);
    indexCache.set(key, index);
  }
  return index;
}

// An idle-paced build slice: about the same per-slice budget the near
// terrain's streamed chunk builds use (IDLE_GEOMETRY_SLICE_MS scale). A
// 960u tile row is ~100 terrainHeight samples, roughly half a millisecond.
const FAR_BUILD_ROWS_PER_SLICE = 12;
const FAR_BUILD_TIMEOUT_MS = 200;

// Fragments closer than (detailFar - margin) are discarded: inside the
// detail envelope the real terrain owns every pixel, and on steep ridges
// the coarse mesh's chord error is far larger than any fixed vertical drop
// could hide (the sealed walls rise 60 units inside one far-mesh cell). The
// margin keeps a covered overlap band so the handoff never opens a seam:
// near chunks stay visible out to detailFar itself.
const FAR_DISCARD_MARGIN = 60;

interface BuiltFarTile {
  tile: FarTile;
  mesh: THREE.Mesh;
}

export interface FarTerrainView {
  group: THREE.Group;
  /** Per-frame visibility: the layer shows only outdoors; tiles beyond the
   *  live fog wall hide; near-field fragments discard against detailFar. */
  update(
    camX: number,
    camZ: number,
    detailFar: number,
    sceneFogFar: number,
    outdoor: boolean,
  ): void;
  /** Stops the in-flight background build (call before discarding). */
  cancelStreaming(): void;
  /** Dispose every built tile geometry and the one shared material. */
  dispose(): void;
  /** Build progress for diagnostics: built tiles / planned tiles. */
  builtTileCount(): number;
  plannedTileCount(): number;
}

export function buildFarTerrain(
  seed: number,
  plan: FarVistaPlan,
  priorityPoint?: { x: number; z: number },
): FarTerrainView {
  const group = new THREE.Group();
  group.name = 'farTerrain';
  const built: BuiltFarTile[] = [];
  let cancelled = false;

  if (!plan.enabled) {
    return {
      group,
      update: () => {},
      cancelStreaming: () => {
        cancelled = true;
      },
      dispose: () => {},
      builtTileCount: () => 0,
      plannedTileCount: () => 0,
    };
  }

  const tiles = planFarTiles(WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = 'farTerrain';
  // The near-field discard (see FAR_DISCARD_MARGIN). uTime-style shared
  // uniforms are overkill here: one vec3 (camera xz + cutoff) per frame.
  const farCut = { value: new THREE.Vector3(0, 0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFarCut = farCut;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFarXZ = (modelMatrix * vec4(position, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFarXZ;\nuniform vec3 uFarCut;',
      )
      .replace(
        'void main() {',
        'void main() {\n\tif (distance(vFarXZ, uFarCut.xy) < uFarCut.z) discard;',
      );
  };

  const sharedIndex = sharedIndexFor(tiles[0].size, plan.spacing);

  const attachTile = (
    tile: FarTile,
    minY: number,
    maxY: number,
    geo: THREE.BufferGeometry,
  ): void => {
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(tile.x0, minY, tile.z0),
      new THREE.Vector3(tile.x0 + tile.size, maxY, tile.z0 + tile.size),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    built.push({ tile, mesh });
  };

  const buildAll = async (): Promise<void> => {
    const order = farTileBuildOrder(tiles, priorityPoint?.x ?? 0, priorityPoint?.z ?? 0);
    for (const idx of order) {
      if (cancelled) return;
      const tile = tiles[idx];
      const builder = createFarTileBuilder(tile, plan.spacing, seed);
      for (;;) {
        await idleSlot(FAR_BUILD_TIMEOUT_MS);
        if (cancelled) return;
        if (builder.step(FAR_BUILD_ROWS_PER_SLICE)) break;
      }
      const data = builder.result();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geo.setIndex(sharedIndex);
      attachTile(tile, data.minY, data.maxY, geo);
    }
  };
  void buildAll();

  return {
    group,
    update(camX, camZ, detailFar, sceneFogFar, outdoor): void {
      group.visible = outdoor;
      if (!outdoor) return;
      farCut.value.set(camX, camZ, Math.max(0, detailFar - FAR_DISCARD_MARGIN));
      for (const b of built) {
        b.mesh.visible = farTileVisible(b.tile, camX, camZ, sceneFogFar);
      }
    },
    cancelStreaming(): void {
      cancelled = true;
    },
    dispose(): void {
      cancelled = true;
      for (const b of built) b.mesh.geometry.dispose();
      built.length = 0;
      material.dispose();
    },
    builtTileCount: () => built.length,
    plannedTileCount: () => tiles.length,
  };
}
