// Ravenrift battleground field: the Three half of the render layer. One view
// per match slot, built lazily by the renderer when the player is near (the
// yumi_maze pattern). Every kit-module transform comes from the pure manifest
// in battleground_core.ts, which derives from the SAME battleground_layout the
// sim collides against, so what you see is exactly what blocks movement.
// KayKit modules render as one InstancedMesh per kind (the jail_scene emit
// pattern); the team banners, flag pedestals, and speed-rune pads are small
// procedural meshes owned (and disposed) by the view.
//
// Graphics fairness: nothing gameplay-actionable is tier-gated here. The team
// glows, banner cloths, and rune pads render identically on every tier; only
// cosmetic richness (shadow casting) checks lowGfx.
import * as THREE from 'three';
import { BG_TEAM_COLORS } from '../sim/battleground_layout';
import { groundHeight } from '../sim/world';
import { registerPreload } from './assets/preload';
import {
  BG_FLOOR_Y,
  BG_TORCH_GLOW_H,
  type BgModulePlacement,
  battlegroundRenderManifest,
} from './battleground_core';
import { buildDungeonPropMesh, ensureDungeonAssets, loadKitModules } from './dungeon';
import { GFX, surfaceMat } from './gfx';
import { markSharedMaterial } from './shared_resource';
import { freezeStaticMatrices } from './static_matrix';

export { battlegroundRenderManifest } from './battleground_core';

// Kit modules outside the dungeon base pack would load here on demand (the
// jail_scene loadKitModules seam); every module the battleground manifest
// emits today ships in the base kit, so the extra list is empty.
const BG_EXTRA_KIT: readonly string[] = [];

export function ensureBattlegroundAssets(): Promise<void> {
  return Promise.all([ensureDungeonAssets(), loadKitModules(BG_EXTRA_KIT)]).then(() => undefined);
}

// Same boot-preload fold as the dungeon kit / jail: the renderer builds a
// field copy synchronously once the player nears the band, after assetsReady().
if (typeof window !== 'undefined') registerPreload(ensureBattlegroundAssets());

// Shadow/receive sets for the kinds the manifest emits (dungeon.ts semantics).
const BG_CASTER_KINDS = new Set([
  'wall',
  'wall_cracked',
  'pillar',
  'crates_stacked',
  'box_stacked',
]);
const BG_RECEIVER_KINDS = new Set([
  'floor_tile_large',
  'floor_tile_large_rocks',
  'floor_dirt_large',
  'floor_dirt_large_rocky',
]);

// Procedural dressing dimensions.
const TORCH_GLOW_R = 0.24;
const TORCH_GLOW_COLOR = 0xffb254;
const TORCH_GLOW_OPACITY = 0.85;
const BANNER_POLE_H = 7.6;
const BANNER_POLE_R = 0.09;
const BANNER_CLOTH_W = 1.5;
const BANNER_CLOTH_H = 2.3;
const PEDESTAL_R = 1.35;
const PEDESTAL_H = 0.5;
const PEDESTAL_GLOW_H = 2.4;
const PEDESTAL_GLOW_OPACITY = 0.32;
const RUNE_PAD_INNER_R = 0.85;
const RUNE_PAD_OUTER_R = 1.3;
const RUNE_PAD_Y = 0.06;
const RUNE_GOLD = 0xffd24a;
const POLE_COLOR = 0x5a4632;
const STONE_COLOR = 0x8a8175;

// Shared display materials: one tuned clone per kit source material (the
// jail_scene displayMaterial pattern). Marked shared so per-view disposal
// never frees them: they are renderer-owned, process-lifetime.
const displayMats = new Map<THREE.Material, THREE.Material>();

function displayMaterial(src: THREE.Material): THREE.Material {
  let mat = displayMats.get(src);
  if (mat) return mat;
  if (!GFX.standardMaterials) {
    mat = new THREE.MeshLambertMaterial({
      map: (src as THREE.MeshStandardMaterial).map ?? null,
    });
  } else {
    const std = (src as THREE.MeshStandardMaterial).clone();
    std.vertexColors = false;
    std.metalness = 0;
    std.roughness = Math.max(0.85, std.roughness);
    mat = std;
  }
  markSharedMaterial(mat);
  displayMats.set(src, mat);
  return mat;
}

/** The renderer-owned hooks the field plugs into (the yumi signature shape;
 *  the battleground burns no fires today, so the pools are optional). */
export interface BattlegroundLightHooks {
  lowGfx: boolean;
  flames?: THREE.Mesh[];
  fireLights?: THREE.PointLight[];
}

export interface BattlegroundView {
  group: THREE.Group;
  dispose(): void;
}

export function buildBattleground(
  origin: { x: number; z: number },
  seed: number,
  opts: BattlegroundLightHooks,
): BattlegroundView {
  const group = new THREE.Group();
  group.name = 'battleground';
  const floorY = groundHeight(origin.x, origin.z, seed);
  group.position.set(origin.x, floorY, origin.z);

  const manifest = battlegroundRenderManifest();
  const ownGeos: THREE.BufferGeometry[] = [];
  const ownMats: THREE.Material[] = [];
  const instanced: THREE.InstancedMesh[] = [];

  // One InstancedMesh per kit-module kind (the jail_scene emit pattern).
  const byKind = new Map<string, BgModulePlacement[]>();
  for (const list of [
    manifest.floors,
    manifest.walls,
    manifest.ruin,
    manifest.pillars,
    manifest.crates,
    manifest.accents,
    manifest.wallBanners,
    manifest.torches,
  ]) {
    for (const pl of list) {
      const bucket = byKind.get(pl.kind);
      if (bucket) bucket.push(pl);
      else byKind.set(pl.kind, [pl]);
    }
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (const [kind, list] of byKind) {
    const proto = buildDungeonPropMesh(kind);
    if (!proto) {
      console.warn(`battleground: kit module not loaded '${kind}'`);
      continue;
    }
    const src = Array.isArray(proto.material) ? proto.material[0] : proto.material;
    const mesh = new THREE.InstancedMesh(proto.geometry, displayMaterial(src), list.length);
    for (let i = 0; i < list.length; i++) {
      const pl = list[i];
      pos.set(pl.x, pl.y, pl.z);
      q.setFromEuler(euler.set(0, pl.ry, 0));
      scl.set(pl.scale[0], pl.scale[1], pl.scale[2]);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = !opts.lowGfx && BG_CASTER_KINDS.has(kind);
    mesh.receiveShadow = BG_RECEIVER_KINDS.has(kind);
    instanced.push(mesh);
    group.add(mesh);
  }

  // Team banners flanking each keep: pole cylinder + team-color cloth plane.
  // Unlit cloth so the team read is identical on every tier.
  const poleGeo = new THREE.CylinderGeometry(BANNER_POLE_R, BANNER_POLE_R * 1.4, BANNER_POLE_H, 6);
  const clothGeo = new THREE.PlaneGeometry(BANNER_CLOTH_W, BANNER_CLOTH_H);
  ownGeos.push(poleGeo, clothGeo);
  const poleMat = surfaceMat({ color: POLE_COLOR, roughness: 0.9 });
  const clothMats = new Map<number, THREE.MeshBasicMaterial>();
  const clothMat = (color: number): THREE.MeshBasicMaterial => {
    let mat = clothMats.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      clothMats.set(color, mat);
      ownMats.push(mat);
    }
    return mat;
  };
  for (const banner of manifest.banners) {
    const color = BG_TEAM_COLORS[banner.team];
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(banner.x, BANNER_POLE_H / 2, banner.z);
    pole.castShadow = !opts.lowGfx;
    group.add(pole);
    const cloth = new THREE.Mesh(clothGeo, clothMat(color));
    // Hang from just under the pole tip, spread inward toward the keep's
    // centre line; the plane faces down the field (double-sided), so the team
    // color reads from mid-field.
    cloth.position.set(
      banner.x - Math.sign(banner.x || 1) * (BANNER_CLOTH_W / 2 + BANNER_POLE_R),
      BANNER_POLE_H - BANNER_CLOTH_H / 2 - 0.15,
      banner.z,
    );
    group.add(cloth);
  }

  // Flag pedestals: a stone drum plus an additive team-color glow column, so
  // each flag home reads across the field on every tier.
  const pedestalGeo = new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R * 1.15, PEDESTAL_H, 10);
  const glowGeo = new THREE.CylinderGeometry(
    PEDESTAL_R * 0.72,
    PEDESTAL_R * 1.05,
    PEDESTAL_GLOW_H,
    12,
    1,
    true,
  );
  ownGeos.push(pedestalGeo, glowGeo);
  const pedestalMat = surfaceMat({ color: STONE_COLOR, roughness: 0.9 });
  for (const stand of manifest.flagPedestals) {
    const color = BG_TEAM_COLORS[stand.team];
    const drum = new THREE.Mesh(pedestalGeo, pedestalMat);
    drum.position.set(stand.x, PEDESTAL_H / 2, stand.z);
    drum.receiveShadow = true;
    group.add(drum);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: PEDESTAL_GLOW_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    ownMats.push(glowMat);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(stand.x, PEDESTAL_H + PEDESTAL_GLOW_H / 2, stand.z);
    group.add(glow);
  }

  // Speed-rune pads: an additive gold ring at every rune entry (the rune
  // entity itself renders via battleground_props; the pad marks the spot even
  // while the rune recharges). Identical on every tier.
  const padGeo = new THREE.RingGeometry(RUNE_PAD_INNER_R, RUNE_PAD_OUTER_R, 24);
  ownGeos.push(padGeo);
  const padMat = new THREE.MeshBasicMaterial({
    color: RUNE_GOLD,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  ownMats.push(padMat);
  for (const rune of manifest.runePads) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(rune.x, BG_FLOOR_Y + RUNE_PAD_Y, rune.z);
    group.add(pad);
  }

  // A small warm additive glow at every mounted torch head: the torch-lit
  // rampart read with zero light cost, identical on every tier.
  if (manifest.torches.length > 0) {
    const glowGeo = new THREE.SphereGeometry(TORCH_GLOW_R, 8, 6);
    ownGeos.push(glowGeo);
    const glowMat = new THREE.MeshBasicMaterial({
      color: TORCH_GLOW_COLOR,
      transparent: true,
      opacity: TORCH_GLOW_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    ownMats.push(glowMat);
    const torchGlows = new THREE.InstancedMesh(glowGeo, glowMat, manifest.torches.length);
    for (let i = 0; i < manifest.torches.length; i++) {
      const t = manifest.torches[i];
      pos.set(t.x, BG_TORCH_GLOW_H, t.z);
      q.setFromEuler(euler.set(0, 0, 0));
      scl.set(1, 1, 1);
      m.compose(pos, q, scl);
      torchGlows.setMatrixAt(i, m);
    }
    torchGlows.instanceMatrix.needsUpdate = true;
    torchGlows.computeBoundingSphere();
    instanced.push(torchGlows);
    group.add(torchGlows);
  }

  freezeStaticMatrices(group);

  return {
    group,
    dispose(): void {
      group.removeFromParent();
      for (const mesh of instanced) mesh.dispose();
      for (const geo of ownGeos) geo.dispose();
      for (const mat of ownMats) mat.dispose();
    },
  };
}
