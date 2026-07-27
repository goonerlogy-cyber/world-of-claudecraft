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
// field spans x [-80, 80], z [-20, 240]: players arrive at entry {0,-2} (exit
// portal at {0,-8}) behind the war gate, fight up the mid field where the
// spawn list lives (z 30..216, x within +/-9, see src/sim/content/orkadia.ts),
// and meet the warlord on the skull dais atop the back terrace. The 240 back
// line is a hard constraint: instance slots sit 500yd apart, so instance-local
// |z| must stay under 250 or the slot math snaps to the neighbor slot. Every
// collider-bearing prop sits at least ~3yd clear of every mob spawn point
// (footprint edge to spawn point).
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

// Walkable-field bounds (also the ground relief domain), instance-local.
export const ORKADIA_FIELD_BOUNDS = { minX: -80, maxX: 80, minZ: -20, maxZ: 240 } as const;

// The walkable field enclosure (players cannot leave it): four OBB perimeter
// walls in instance-local coords, same shape the room-kit layouts emit (plain
// obbs, no camGhost, so the chase cam pulls in at the palisade line like it
// does at interior walls). z runs -20 (behind the exit portal at -8) to 240.
export const ORKADIA_FIELD_WALLS: readonly { x: number; z: number; hw: number; hd: number }[] = [
  { x: -80, z: 110, hw: 1, hd: 130 }, // west palisade line
  { x: 80, z: 110, hw: 1, hd: 130 }, // east palisade line
  { x: 0, z: 240, hw: 81, hd: 1 }, // back line behind the war hall
  { x: 0, z: -20, hw: 81, hd: 1 }, // front line behind the arrival shelf
];

// ---------------------------------------------------------------------------
// Ground relief (deterministic, shared by sim groundHeight and the render mesh)
// ---------------------------------------------------------------------------

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Rolling ash dunes, side berms rising toward the palisade lines, and a broad
// boss terrace at the back: the warlord's dais and war hall stand 3.2yd above
// the camp floor up a 40yd ramp. Every slope stays walkable (under ~7deg).
// The arrival shelf (z < 26) is flattened so entry/exit ground is level.
export function orkadiaFieldHeight(lx: number, lz: number): number {
  const dunes =
    0.55 * Math.sin(lx * 0.055 + 0.8) * Math.cos(lz * 0.047 - 0.3) +
    0.35 * Math.sin(lx * 0.021 - 1.2) * Math.sin(lz * 0.083 + 0.6);
  const side = 1.4 * smoothstep(46, 78, Math.abs(lx));
  const flat = smoothstep(6, 26, lz);
  const terrace = 3.2 * smoothstep(170, 210, lz);
  return (dunes + side) * flat + terrace;
}

export const ORKADIA_FIELD_PLACEMENTS: readonly OrkadiaPropPlacement[] = [
  // Arrival: the war gate straddles the approach (players pass between its
  // posts), torch posts and the first banner pair dress the entrance.
  { kind: 'orkadia_war_gate', x: 0, z: 14, rot: 0 },
  { kind: 'orkadia_torch_post', x: -8, z: 8, rot: 0 },
  { kind: 'orkadia_torch_post', x: 8, z: 8, rot: 0 },
  { kind: 'orkadia_war_banner', x: -12, z: 22, rot: 0.2 },
  { kind: 'orkadia_war_banner', x: 12, z: 22, rot: -0.2 },
  // Mid field: totems, braziers, watchtowers, and camp work areas flanking the
  // spawn lane (the lane itself, x within +/-9, stays clear for the mob packs).
  { kind: 'orkadia_war_banner', x: -18, z: 53, rot: 0.3 },
  { kind: 'orkadia_weapon_rack', x: 18, z: 53, rot: 0.6 },
  { kind: 'orkadia_green_brazier', x: -16, z: 77, rot: 0 },
  { kind: 'orkadia_war_totem', x: 16, z: 89, rot: 0 },
  { kind: 'orkadia_watchtower', x: -30, z: 82, rot: Math.PI / 2 },
  { kind: 'orkadia_war_banner', x: -15, z: 106, rot: 0.25 },
  { kind: 'orkadia_war_banner', x: 15, z: 106, rot: -0.25 },
  { kind: 'orkadia_war_drum', x: -18, z: 112, rot: 0.3 },
  { kind: 'orkadia_green_brazier', x: 16, z: 136, rot: 0 },
  { kind: 'orkadia_watchtower', x: 30, z: 145, rot: -Math.PI / 2 },
  { kind: 'orkadia_prisoner_cage', x: -22, z: 148, rot: -0.5 },
  { kind: 'orkadia_prisoner_cage', x: -25, z: 154, rot: 0.4 },
  { kind: 'orkadia_green_brazier', x: -14, z: 178, rot: 0 },
  { kind: 'orkadia_supply_crates', x: 22, z: 178, rot: 0.8 },
  { kind: 'orkadia_supply_crates', x: 24, z: 184, rot: -0.5 },
  { kind: 'orkadia_war_totem', x: -16, z: 192, rot: 0 },
  { kind: 'orkadia_trophy_pole', x: -11, z: 204, rot: 0 },
  { kind: 'orkadia_trophy_pole', x: 11, z: 204, rot: Math.PI },
  { kind: 'orkadia_green_brazier', x: -14, z: 215, rot: 0 },
  { kind: 'orkadia_green_brazier', x: 14, z: 215, rot: 0 },
  // Palisade + spiked-barricade perimeter, just inside the wall line.
  { kind: 'orkadia_palisade', x: -40, z: -8, rot: 0.5 },
  { kind: 'orkadia_palisade', x: 40, z: -8, rot: -0.5 },
  { kind: 'orkadia_palisade', x: -72, z: 20, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 72, z: 20, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -72, z: 70, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 72, z: 70, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -72, z: 120, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 72, z: 120, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -72, z: 170, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 72, z: 170, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -72, z: 220, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: 72, z: 220, rot: Math.PI / 2 },
  { kind: 'orkadia_palisade', x: -56, z: 232, rot: 0.4 },
  { kind: 'orkadia_palisade', x: 56, z: 232, rot: -0.4 },
  { kind: 'orkadia_spiked_barricade', x: -45, z: 45, rot: 0.9 },
  { kind: 'orkadia_spiked_barricade', x: 45, z: 45, rot: -0.9 },
  { kind: 'orkadia_spiked_barricade', x: -45, z: 150, rot: 0.9 },
  { kind: 'orkadia_spiked_barricade', x: 45, z: 150, rot: -0.9 },
  { kind: 'orkadia_spiked_barricade', x: -28, z: 230, rot: 0.2 },
  { kind: 'orkadia_spiked_barricade', x: 28, z: 230, rot: -0.2 },
  // Boss end: the skull dais is the warlord's stage (walkable, NO collider,
  // matching the room-kit dais contract), throne and war hall behind it on the
  // terrace plateau.
  { kind: 'orkadia_skull_dais', x: 0, z: 216, rot: 0 },
  { kind: 'orkadia_bone_throne', x: 0, z: 224, rot: Math.PI },
  { kind: 'orkadia_skull_pile', x: -8, z: 226, rot: 0 },
  { kind: 'orkadia_skull_pile', x: 9, z: 222, rot: 0.7 },
  { kind: 'orkadia_war_hall', x: 0, z: 234, rot: 0 },
  // Volcanic cliff ring: the visual backdrop OUTSIDE the palisade walls, so
  // no void is visible past the field edge. Unreachable by movement, and past
  // the 250 slot half-spacing these are render-only dressing (no colliders).
  { kind: 'orkadia_volcanic_cliff', x: -88, z: 20, rot: 0.3 },
  { kind: 'orkadia_volcanic_cliff', x: -90, z: 70, rot: 1.2 },
  { kind: 'orkadia_volcanic_cliff', x: -88, z: 120, rot: 2.1 },
  { kind: 'orkadia_volcanic_cliff', x: -90, z: 175, rot: 0.6 },
  { kind: 'orkadia_volcanic_cliff', x: -86, z: 228, rot: 1.8 },
  { kind: 'orkadia_volcanic_cliff', x: 88, z: 20, rot: -0.4 },
  { kind: 'orkadia_volcanic_cliff', x: 90, z: 70, rot: 2.6 },
  { kind: 'orkadia_volcanic_cliff', x: 88, z: 120, rot: 1.7 },
  { kind: 'orkadia_volcanic_cliff', x: 90, z: 175, rot: -0.9 },
  { kind: 'orkadia_volcanic_cliff', x: 86, z: 228, rot: 0.9 },
  { kind: 'orkadia_volcanic_cliff', x: -44, z: 252, rot: 3.0 },
  { kind: 'orkadia_volcanic_cliff', x: 0, z: 256, rot: 1.0 },
  { kind: 'orkadia_volcanic_cliff', x: 44, z: 252, rot: 0.2 },
  { kind: 'orkadia_volcanic_cliff', x: -44, z: -34, rot: 2.2 },
  { kind: 'orkadia_volcanic_cliff', x: 0, z: -38, rot: 0.5 },
  { kind: 'orkadia_volcanic_cliff', x: 44, z: -34, rot: -1.4 },
];

interface OrkadiaFootprint {
  // Circle radius (yd) matched to the prop's visual footprint after the
  // renderer's height normalization; r 0 means walk-through dressing with no
  // collider (the skull dais, same contract as the room-kit boss dais).
  r: number;
  // Visual top (yd above the local ground) for the cameraTopY record.
  h: number;
  // Multi-circle footprints (the war gate: a collider per post so the gate
  // opening stays passable), offsets in the prop's local frame, rotated by
  // the placement's rot (three.js rotation.y convention, same as rotY).
  posts?: readonly { dx: number; dz: number; r: number }[];
}

const ORKADIA_PROP_FOOTPRINTS: Record<OrkadiaPropKind, OrkadiaFootprint> = {
  orkadia_spiked_barricade: { r: 2.6, h: 2.4 },
  orkadia_war_totem: { r: 0.9, h: 4.2 },
  orkadia_war_banner: { r: 1.0, h: 4.0 },
  orkadia_green_brazier: { r: 1.2, h: 1.8 },
  orkadia_skull_pile: { r: 1.4, h: 1.2 },
  orkadia_weapon_rack: { r: 1.3, h: 2.2 },
  orkadia_volcanic_cliff: { r: 6.5, h: 11.0 },
  orkadia_war_gate: {
    r: 0,
    h: 8.0,
    posts: [
      { dx: -4.6, dz: 0, r: 1.6 },
      { dx: 4.6, dz: 0, r: 1.6 },
    ],
  },
  orkadia_war_hall: { r: 6.0, h: 12.0 },
  orkadia_skull_dais: { r: 0, h: 1.6 }, // walkable boss stage, no collider
  orkadia_watchtower: { r: 3.4, h: 9.0 },
  orkadia_palisade: { r: 4.2, h: 3.4 },
  orkadia_war_drum: { r: 1.1, h: 1.5 },
  orkadia_prisoner_cage: { r: 1.1, h: 2.8 },
  orkadia_bone_throne: { r: 1.8, h: 3.0 },
  orkadia_torch_post: { r: 0.7, h: 2.6 },
  orkadia_trophy_pole: { r: 0.5, h: 3.4 },
  orkadia_supply_crates: { r: 1.0, h: 1.3 },
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
