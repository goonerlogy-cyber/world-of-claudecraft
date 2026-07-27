// Orkadia open-field interior: the shared plain-data placement table for the
// first open-air dungeon interior (DungeonDef interior 'orkadia'). This module
// is the SINGLE SOURCE OF TRUTH for the war-camp layout, in the same pattern
// as dungeon_layout.ts: the renderer (src/render/orkadia_props.ts) builds its
// meshes from ORKADIA_FIELD_PLACEMENTS and colliders.ts derives the
// INTERIOR_COLLIDERS.orkadia set from ORKADIA_FIELD_COLLIDER_SPECS +
// ORKADIA_FIELD_WALLS, so what you see is what you collide with.
//
// All coordinates are INSTANCE-LOCAL (the renderer's interior group and the
// collider resolver both subtract the claimed slot's instanceOrigin). The
// field spans about x [-45, 45], z [0, 160]: players arrive at entry {0,-2}
// (exit portal at {0,-8}) behind the war gate, fight up the mid field where
// the original spawn list lives (z 18..146, x within +/-9, see
// src/sim/content/orkadia.ts), and meet the warlord on the skull dais at the
// back. Every collider-bearing prop sits at least ~3yd clear of every mob
// spawn point (footprint edge to spawn point).
//
// Sim layer: pure data + pure derivation, no three.js, no render imports.

export type OrkadiaPropKind =
  | 'orkadia_spiked_barricade'
  | 'orkadia_war_totem'
  | 'orkadia_war_banner'
  | 'orkadia_green_brazier'
  | 'orkadia_skull_pile'
  | 'orkadia_weapon_rack'
  | 'orkadia_volcanic_cliff'
  | 'orkadia_war_gate'
  | 'orkadia_war_hall'
  | 'orkadia_skull_dais'
  | 'orkadia_watchtower'
  | 'orkadia_palisade'
  | 'orkadia_war_drum'
  | 'orkadia_prisoner_cage'
  | 'orkadia_bone_throne'
  | 'orkadia_torch_post'
  | 'orkadia_trophy_pole'
  | 'orkadia_supply_crates';

export interface OrkadiaPropPlacement {
  kind: OrkadiaPropKind;
  x: number;
  z: number;
  rot: number;
}

// The walkable field enclosure (players cannot leave it): four OBB perimeter
// walls in instance-local coords, same shape the room-kit layouts emit (plain
// obbs, no camGhost, so the chase cam pulls in at the palisade line like it
// does at interior walls). z runs -12 (behind the exit portal at -8) to 160.
export const ORKADIA_FIELD_WALLS: readonly { x: number; z: number; hw: number; hd: number }[] = [
  { x: -45, z: 74, hw: 1, hd: 86 }, // west palisade line
  { x: 45, z: 74, hw: 1, hd: 86 }, // east palisade line
  { x: 0, z: 160, hw: 46, hd: 1 }, // back line behind the war hall
  { x: 0, z: -12, hw: 46, hd: 1 }, // front line behind the arrival shelf
];

export const ORKADIA_FIELD_PLACEMENTS: readonly OrkadiaPropPlacement[] = [
  // Arrival: the war gate straddles the approach (players pass between its
  // posts), torch posts and the first banner pair dress the entrance.
  { kind: 'orkadia_war_gate', x: 0, z: 12, rot: 0 },
  { kind: 'orkadia_torch_post', x: -6, z: 8, rot: 0 },
  { kind: 'orkadia_torch_post', x: 6, z: 8, rot: 0 },
  { kind: 'orkadia_war_banner', x: -9, z: 16, rot: 0.2 },
  { kind: 'orkadia_war_banner', x: 9, z: 16, rot: -0.2 },
  // Mid field: totem, braziers, and camp work areas flanking the spawn lane
  // (the lane itself, x within +/-9, stays clear for the mob packs).
  { kind: 'orkadia_war_banner', x: -14, z: 36, rot: 0.3 },
  { kind: 'orkadia_weapon_rack', x: 14, z: 36, rot: 0.6 },
  { kind: 'orkadia_green_brazier', x: -12, z: 52, rot: 0 },
  { kind: 'orkadia_war_totem', x: 12, z: 60, rot: 0 },
  { kind: 'orkadia_war_drum', x: -14, z: 76, rot: 0.3 },
  { kind: 'orkadia_green_brazier', x: 12, z: 92, rot: 0 },
  { kind: 'orkadia_watchtower', x: 24, z: 98, rot: -Math.PI / 2 },
  { kind: 'orkadia_prisoner_cage', x: -16, z: 100, rot: -0.5 },
  { kind: 'orkadia_prisoner_cage', x: -19, z: 104, rot: 0.4 },
  { kind: 'orkadia_green_brazier', x: -10, z: 120, rot: 0 },
  { kind: 'orkadia_supply_crates', x: 16, z: 120, rot: 0.8 },
  { kind: 'orkadia_supply_crates', x: 18, z: 124, rot: -0.5 },
  { kind: 'orkadia_trophy_pole', x: -8, z: 138, rot: 0 },
  { kind: 'orkadia_trophy_pole', x: 8, z: 138, rot: Math.PI },
  // Palisade + spiked-barricade perimeter arc, just inside the wall line.
  { kind: 'orkadia_palisade', x: -24, z: 4, rot: 0.5 },
  { kind: 'orkadia_palisade', x: 24, z: 4, rot: -0.5 },
  { kind: 'orkadia_palisade', x: -38, z: 20, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 38, z: 20, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -40, z: 60, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 40, z: 60, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -40, z: 110, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 40, z: 110, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -36, z: 150, rot: 0.4 },
  { kind: 'orkadia_palisade', x: 36, z: 150, rot: -0.4 },
  { kind: 'orkadia_spiked_barricade', x: -30, z: 30, rot: 0.9 },
  { kind: 'orkadia_spiked_barricade', x: 30, z: 30, rot: -0.9 },
  { kind: 'orkadia_spiked_barricade', x: -20, z: 152, rot: 0.2 },
  { kind: 'orkadia_spiked_barricade', x: 20, z: 152, rot: -0.2 },
  // Boss end: the skull dais is the warlord's stage (walkable, NO collider,
  // matching the room-kit dais contract), throne and war hall behind it.
  { kind: 'orkadia_skull_dais', x: 0, z: 146, rot: 0 },
  { kind: 'orkadia_bone_throne', x: 0, z: 150.5, rot: Math.PI },
  { kind: 'orkadia_skull_pile', x: -6, z: 152, rot: 0 },
  { kind: 'orkadia_skull_pile', x: 7, z: 150, rot: 0.7 },
  { kind: 'orkadia_war_hall', x: 0, z: 154, rot: 0 },
  // Volcanic cliff ring: the visual backdrop OUTSIDE the palisade walls, so
  // no void is visible past the field edge. Unreachable by movement.
  { kind: 'orkadia_volcanic_cliff', x: -52, z: 20, rot: 0.3 },
  { kind: 'orkadia_volcanic_cliff', x: -54, z: 70, rot: 1.2 },
  { kind: 'orkadia_volcanic_cliff', x: -52, z: 120, rot: 2.1 },
  { kind: 'orkadia_volcanic_cliff', x: -48, z: 162, rot: 0.6 },
  { kind: 'orkadia_volcanic_cliff', x: 52, z: 20, rot: -0.4 },
  { kind: 'orkadia_volcanic_cliff', x: 54, z: 70, rot: 2.6 },
  { kind: 'orkadia_volcanic_cliff', x: 52, z: 120, rot: 1.7 },
  { kind: 'orkadia_volcanic_cliff', x: 48, z: 162, rot: -0.9 },
  { kind: 'orkadia_volcanic_cliff', x: -24, z: 170, rot: 3.0 },
  { kind: 'orkadia_volcanic_cliff', x: 24, z: 170, rot: 0.2 },
  { kind: 'orkadia_volcanic_cliff', x: 0, z: 174, rot: 1.0 },
  { kind: 'orkadia_volcanic_cliff', x: -26, z: -18, rot: 2.2 },
  { kind: 'orkadia_volcanic_cliff', x: 26, z: -18, rot: -1.4 },
  { kind: 'orkadia_volcanic_cliff', x: 0, z: -24, rot: 0.5 },
];

interface OrkadiaFootprint {
  // Circle radius (yd) matched to the prop's visual footprint after the
  // renderer's height normalization; r 0 means walk-through dressing with no
  // collider (the skull dais, same contract as the room-kit boss dais).
  r: number;
  // Visual top (yd above the flat instance floor) for the cameraTopY record.
  h: number;
  // Multi-circle footprints (the war gate: a collider per post so the gate
  // opening stays passable), offsets in the prop's local frame, rotated by
  // the placement's rot (three.js rotation.y convention, same as rotY).
  posts?: readonly { dx: number; dz: number; r: number }[];
}

const ORKADIA_PROP_FOOTPRINTS: Record<OrkadiaPropKind, OrkadiaFootprint> = {
  orkadia_spiked_barricade: { r: 1.8, h: 1.6 },
  orkadia_war_totem: { r: 0.6, h: 2.6 },
  orkadia_war_banner: { r: 0.7, h: 2.4 },
  orkadia_green_brazier: { r: 0.9, h: 0.9 },
  orkadia_skull_pile: { r: 1.0, h: 0.7 },
  orkadia_weapon_rack: { r: 0.9, h: 1.2 },
  orkadia_volcanic_cliff: { r: 4.5, h: 6.0 },
  orkadia_war_gate: {
    r: 0,
    h: 3.4,
    posts: [
      { dx: -2.8, dz: 0, r: 1.0 },
      { dx: 2.8, dz: 0, r: 1.0 },
    ],
  },
  orkadia_war_hall: { r: 3.2, h: 3.0 },
  orkadia_skull_dais: { r: 0, h: 1.0 }, // walkable boss stage, no collider
  orkadia_watchtower: { r: 2.4, h: 2.9 },
  orkadia_palisade: { r: 2.8, h: 1.6 },
  orkadia_war_drum: { r: 0.8, h: 1.2 },
  orkadia_prisoner_cage: { r: 0.75, h: 1.5 },
  orkadia_bone_throne: { r: 1.1, h: 1.0 },
  orkadia_torch_post: { r: 0.5, h: 1.5 },
  orkadia_trophy_pole: { r: 0.35, h: 2.1 },
  orkadia_supply_crates: { r: 0.75, h: 0.7 },
};

export interface OrkadiaColliderSpec {
  kind: OrkadiaPropKind;
  x: number;
  z: number;
  r: number;
  h: number;
}

// One circle spec per prop footprint (two for the war-gate posts), in
// instance-local coords. colliders.ts maps these 1:1 onto circle colliders
// with the world-prop camera contract (camGhost + cameraTopY = h).
export const ORKADIA_FIELD_COLLIDER_SPECS: readonly OrkadiaColliderSpec[] =
  ORKADIA_FIELD_PLACEMENTS.flatMap((p) => {
    const fp = ORKADIA_PROP_FOOTPRINTS[p.kind];
    if (fp.posts) {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      return fp.posts.map((post) => ({
        kind: p.kind,
        x: p.x + post.dx * c + post.dz * s,
        z: p.z - post.dx * s + post.dz * c,
        r: post.r,
        h: fp.h,
      }));
    }
    return fp.r > 0 ? [{ kind: p.kind, x: p.x, z: p.z, r: fp.r, h: fp.h }] : [];
  });
