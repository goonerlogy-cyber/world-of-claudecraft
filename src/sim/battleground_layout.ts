// Ravenrift, the 5v5 capture-the-flag battleground. Plain-data map geometry in
// instance-local coordinates (y up, z along the length), the single source of
// truth shared by BOTH the collider set (src/sim/colliders.ts) and the renderer
// (src/render/battleground.ts), so what you fight around is what you see.
// Sim layer: no three.js imports. The field is a rework of Dubtribe11's
// PR #589 layout: the keeps, flags, and runes are kept, and the
// space between them is carved into THREE CHAMBERS. Two full-width curtain
// walls partition the field into each team's own field chamber and the walled
// Ruin Courtyard between them; every move between chambers passes one of three
// contested crossings per curtain (main gate, flank arch, or the gatehouse
// room), and a low barricade breaks the straight charge into each keep mouth.
import type { Collider } from './colliders';

export type BgTeam = 0 | 1; // 0 = Crimson (south, -z), 1 = Azure (north, +z)
export const BG_TEAM_NAMES = ['Crimson', 'Azure'] as const;
export const BG_TEAM_COLORS = [0xd1413a, 0x3a78d1] as const; // red, blue: flags/banners/blips

// Field footprint. The play area is a walled rectangle; the two keeps sit at
// the short ends with their flag at the heart of a three-sided enclosure.
export const BG_HALF_X = 50;
export const BG_HALF_Z = 140;
export const BG_WALL_T = 1; // wall half-thickness (collider + module)
export const BG_WALL_HEIGHT = 6;
export const BG_FLAG_Z = 118; // |z| of each team's flag stand

// Keep enclosure: a back wall behind the flag and two SOLID side walls, open
// only toward the field: the keep mouth is the one way in or out, so the only
// two routes into a base area are the main gate and the gatehouse room.
export const KEEP_HALF_X = 16;
export const KEEP_BACK_DZ = 10; // back wall sits this far behind the flag
const KEEP_SIDE_DZ = 0; // side walls centre on the flag line: they span the
const KEEP_SIDE_HD = 10; // full back-wall-to-mouth-line depth, so the form-up
// containment box (keepInteriorBounds) coincides exactly with the walls

export interface BgBaseDef {
  team: BgTeam;
  flag: { x: number; z: number }; // flag home + capture point
  spawns: { x: number; z: number }[]; // respawn ring behind the flag
  banner: { x: number; z: number };
}

// Crimson keep opens toward +z (the field); Azure mirrors it on +z.
export const BG_BASES: BgBaseDef[] = [
  {
    team: 0,
    flag: { x: 0, z: -BG_FLAG_Z },
    // The ring flanks the flag stand on its field side (never on it) and sits
    // ~11yd off the back wall so the spawn-in chase camera never collides.
    spawns: [
      { x: -7, z: -117 },
      { x: 0, z: -113 },
      { x: 7, z: -117 },
      { x: -3.5, z: -114.5 },
      { x: 3.5, z: -114.5 },
    ],
    banner: { x: 0, z: -128 },
  },
  {
    team: 1,
    flag: { x: 0, z: BG_FLAG_Z },
    spawns: [
      { x: 7, z: 117 },
      { x: 0, z: 113 },
      { x: -7, z: 117 },
      { x: 3.5, z: 114.5 },
      { x: -3.5, z: 114.5 },
    ],
    banner: { x: 0, z: 128 },
  },
];

// Speed runes: one at each flag approach plus two mid-field flanks. Stepping on
// an active rune grants a sprint buff; it then recharges (see sim BG_RUNE_*).
// Power runes: one pad at each curtain's courtyard-side mouth (by the main
// gate), mirrored. The pad holds either a Battle Rune (outgoing damage) or a
// Ward Rune (damage taken less); the sim owns the face and its alternation
// (social/battleground.ts). Both pads open the match on the SAME face.
export const BG_POWER_RUNES: { x: number; z: number }[] = [
  { x: 13, z: -48 }, // south main gate's courtyard mouth
  { x: -13, z: 48 }, // north mirror
];

export const BG_SPEED_RUNES: { x: number; z: number }[] = [
  { x: 0, z: -91 }, // Crimson flag approach (mid-field of its own chamber)
  { x: 0, z: 91 }, // Azure flag approach
  { x: -38, z: 0 }, // west flank, in the courtyard
  { x: 38, z: 0 }, // east flank
];

// Axis-aligned wall segment, shared by colliders and the renderer.
export interface BgWallSeg {
  x: number;
  z: number;
  hw: number; // half-width (x extent)
  hd: number; // half-depth (z extent)
  /** Low barricade: blocks movement like any wall but is HALF the rampart
   *  height (3yd, above eye level): it renders half-height, the chase camera
   *  clears it from above via its cameraTopY, and it still blocks spell line
   *  of sight (its top is above SIGHT_HEIGHT). Footprint is identical. */
  low?: boolean;
  /** Graveyard fence rail: a real collider at BG_GRAVEYARD_FENCE_TOP (1.8yd,
   *  still above SIGHT_HEIGHT so camera and casts stay honest), rendered as a
   *  low crumbled run. */
  fence?: boolean;
}

// Chamber cover: the hollow heart ruin and flanking cover inside the Ruin
// Courtyard, plus one wing baffle per field chamber near each keep mouth.
// The heart ruin collides as one solid block; the renderer dresses it as a
// hollow ruin shell (visual only, same footprint). The 16yd heart is what
// seals main-gate-to-main-gate sight (every such ray crosses its core); the
// offset breaker pairs add courtyard cover and cut the diagonal lanes.
export const BG_COVER_WALLS: BgWallSeg[] = [
  { x: 0, z: 0, hw: 8, hd: 8 }, // heart ruin block (16x16, hollow-rendered)
  { x: -16, z: -22, hw: 7, hd: 1 }, // courtyard sightline breakers, two
  { x: 16, z: 22, hw: 7, hd: 1 }, // mirrored pairs spread over the 112yd
  { x: 26, z: -30, hw: 1, hd: 7 }, // courtyard
  { x: -26, z: 30, hw: 1, hd: 7 },
  { x: -30, z: -98, hw: 9, hd: 1 }, // wing baffles near each keep mouth
  { x: 30, z: 98, hw: 9, hd: 1 },
  { x: 10, z: -84, hw: 12, hd: 1 }, // the staggered S-approach: two offset
  { x: -10, z: 84, hw: 12, hd: 1 }, // walls per field chamber, so the mouth-
  { x: -18, z: -70, hw: 12, hd: 1 }, // to-gate run is never a straight sprint
  { x: 18, z: 70, hw: 12, hd: 1 },
];
export const BG_COVER_PILLARS: { x: number; z: number }[] = [
  { x: -30, z: -14 },
  { x: 30, z: -14 },
  { x: 0, z: -42 },
  { x: 30, z: 14 },
  { x: -30, z: 14 },
  { x: 0, z: 42 },
];
export const BG_COVER_CRATES: { x: number; z: number }[] = [
  { x: -10, z: -102 }, // field cover on each approach
  { x: 10, z: 102 },
  { x: 14, z: -76 },
  { x: -14, z: 76 },
  { x: -42, z: -60 }, // by each flank-arch approach
  { x: 42, z: 60 },
  { x: 41, z: -4 }, // cover beside each flank rune
  { x: -41, z: 4 },
  { x: -26, z: -58 }, // the ambush crates inside each gatehouse: one mid-room
  { x: 26, z: 58 }, // on the straight door-to-door line, one beside the
  { x: -27, z: -51 }, // courtyard door (clear of the door line and jamb)
  { x: 27, z: 51 },
];

/** The z line of each curtain wall: the chamber boundaries. On the 4yd floor
 *  grid, so the theming bands land exactly on the walls. */
export const BG_CURTAIN_Z = 56;

// The two curtain walls: full-width partitions at z = +-BG_CURTAIN_Z that
// carve the field into three chambers (each team's field, the Ruin Courtyard
// between). Each curtain is pierced by exactly three crossings, mirrored:
//   main gate, 10yd, off-center toward the field side (Crimson's east);
//   flank arch, 5yd, six yards off the far rampart;
//   the gatehouse, whose walls the curtain terminates into (below).
// Every curtain segment butt-joins what it meets (the rampart inner face at
// |x| 49, the gatehouse side walls), never overlaps it.
export const BG_CURTAIN_WALLS: BgWallSeg[] = [
  { x: -41.5, z: -56, hw: 7.5, hd: 1 }, // rampart to gatehouse west wall
  { x: -5, z: -56, hw: 13, hd: 1 }, // gatehouse east wall to main gate (x 8..18)
  { x: 28, z: -56, hw: 10, hd: 1 }, // main gate to flank arch (x 38..43)
  { x: 46, z: -56, hw: 3, hd: 1 }, // flank arch to rampart
  { x: 41.5, z: 56, hw: 7.5, hd: 1 }, // north curtain, point mirror
  { x: 5, z: 56, hw: 13, hd: 1 },
  { x: -28, z: 56, hw: 10, hd: 1 },
  { x: -46, z: 56, hw: 3, hd: 1 },
];

// The gatehouses: a room straddling each curtain (16yd wide, 20yd long over
// its end walls) with OFFSET doors (enter the field-side door on one half,
// exit the courtyard-side door on the other), so crossing it is a jog past
// ambush corners, not a straight run.
// Each sits on its team's gatehouse flank (Crimson west, Azure east, the
// point-symmetric mirror). Walls butt-join the curtain segments exactly.
export const BG_GATEHOUSE_WALLS: BgWallSeg[] = [
  { x: -33, z: -56, hw: 1, hd: 9 }, // south gatehouse, west wall
  { x: -19, z: -56, hw: 1, hd: 9 }, // east wall
  { x: -29, z: -65, hw: 4, hd: 1 }, // field-side wall (door x -25..-20)
  { x: -23.5, z: -47, hw: 4.5, hd: 1 }, // courtyard-side wall (door x -32..-28)
  { x: 33, z: 56, hw: 1, hd: 9 }, // north gatehouse, point mirror
  { x: 19, z: 56, hw: 1, hd: 9 },
  { x: 29, z: 65, hw: 4, hd: 1 },
  { x: 23.5, z: 47, hw: 4.5, hd: 1 },
];

// Mouth barricades: one low wall 2yd field-side of each keep mouth, offset
// across the mouth span so the straight line from the field to the flag is
// broken: measured against the keep's own width, a runner rounds it through a
// narrow lane on the gatehouse side or a wide lane on the other (the open field
// beyond the keep's width flanks it entirely). Defenders get a hold point,
// attackers pick a side. Sits OUTSIDE keepInteriorBounds, so the form-up
// containment never reads it.
export const BG_KEEP_BARRICADES: BgWallSeg[] = [
  { x: -3, z: -106, hw: 8, hd: 1, low: true },
  { x: 3, z: 106, hw: 8, hd: 1, low: true },
];

// Graveyards: a large fenced plot in the map corner BESIDE each keep, on its
// gatehouse-OPPOSITE flank (out of the flag room, per the owner's direction), so
// the keep interior stays a clean fight space and the yard reads as a real
// place. A released spirit rises here and is bound to the plot until its
// team's respawn wave (social/battleground.ts tickGraveyards). The stone
// rails are REAL colliders with a 4yd entrance at the field-facing corner;
// their top sits above eye height, so the camera clears them and spell sight
// through them is honestly blocked, per the band's camera/sight contract.
export const BG_GRAVEYARD_FENCE_TOP = 1.8;
export interface BgGraveyardPlot {
  x: number;
  z: number;
  hw: number;
  hd: number;
}
export const BG_GRAVEYARDS: [BgGraveyardPlot, BgGraveyardPlot] = [
  { x: 33, z: -130, hw: 9, hd: 6 }, // Crimson: east corner beside the keep (gatehouse is west)
  { x: -33, z: 130, hw: 9, hd: 6 }, // Azure mirror
];
export const BG_GRAVEYARD_FENCES: BgWallSeg[] = [
  // Crimson yard: west + east rails, a south rail butt-joined between them,
  // and a north rail leaving the 4yd entrance at the keep-side corner.
  { x: 24, z: -130, hw: BG_WALL_T, hd: 6, fence: true },
  { x: 42, z: -130, hw: BG_WALL_T, hd: 6, fence: true },
  { x: 33, z: -136, hw: 8, hd: BG_WALL_T, fence: true },
  { x: 35, z: -124, hw: 6, hd: BG_WALL_T, fence: true },
  // Azure point mirrors.
  { x: -24, z: 130, hw: BG_WALL_T, hd: 6, fence: true },
  { x: -42, z: 130, hw: BG_WALL_T, hd: 6, fence: true },
  { x: -33, z: 136, hw: 8, hd: BG_WALL_T, fence: true },
  { x: -35, z: 124, hw: 6, hd: BG_WALL_T, fence: true },
];

const PILLAR_R = 1.0;
const CRATE_R = 0.8;

// Visual tops for camera occlusion and the spell-sight low-obstacle skip
// (src/sim/colliders.ts): walls and pillars render BG_WALL_HEIGHT tall, low
// barricades half that, and a crate stack tops out at the kit crate's 1.35u
// height under the renderer's 1.6 crate scale. The BG ground is flat y=0, so
// these are absolute Y. Movement collision ignores all of them.
const CRATE_TOP = 2.2;

// The four perimeter ramparts.
export const BG_PERIMETER_WALLS: BgWallSeg[] = [
  { x: -BG_HALF_X, z: 0, hw: BG_WALL_T, hd: BG_HALF_Z },
  { x: BG_HALF_X, z: 0, hw: BG_WALL_T, hd: BG_HALF_Z },
  { x: 0, z: -BG_HALF_Z, hw: BG_HALF_X, hd: BG_WALL_T },
  { x: 0, z: BG_HALF_Z, hw: BG_HALF_X, hd: BG_WALL_T },
];

/** How far past the flag (toward the field) the keep interior extends: the
 *  mouth line the form-up containment holds players behind. */
export const KEEP_MOUTH_DZ = 10;

/**
 * The keep's interior box for one team (world-relative to the instance
 * origin): x across the keep's full width, z from the back wall to the mouth
 * line. The form-up containment (social/battleground.ts tickCountdown) reads
 * this so the gate can never drift from the walls it stands in for.
 */
export function keepInteriorBounds(team: BgTeam): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const dir = team === 0 ? -1 : 1;
  const flagZ = team === 0 ? -BG_FLAG_Z : BG_FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const mouthZ = flagZ - dir * KEEP_MOUTH_DZ;
  return {
    minX: -KEEP_HALF_X,
    maxX: KEEP_HALF_X,
    minZ: Math.min(backZ, mouthZ),
    maxZ: Math.max(backZ, mouthZ),
  };
}

/**
 * Keep walls for one team: a back wall and two SOLID side walls. The keep
 * mouth is the ONLY opening (the owner's two-routes rule: into a base area
 * you come through the main gate or the gatehouse room, nothing else), and
 * the set stays point-symmetric ((x,z) -> (-x,-z)) so neither side is favored.
 */
export function keepWallSegments(team: BgTeam): BgWallSeg[] {
  const dir = team === 0 ? -1 : 1; // back wall is further from centre
  const flagZ = team === 0 ? -BG_FLAG_Z : BG_FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const sideZ = flagZ + dir * KEEP_SIDE_DZ;
  const segs: BgWallSeg[] = [{ x: 0, z: backZ, hw: KEEP_HALF_X, hd: BG_WALL_T }];
  for (const sx of [-KEEP_HALF_X, KEEP_HALF_X]) {
    segs.push({ x: sx, z: sideZ, hw: BG_WALL_T, hd: KEEP_SIDE_HD });
  }
  return segs;
}

/** Every wall segment on the field (perimeter + both keeps + chamber cover +
 *  the curtains, gatehouses, and mouth barricades). */
export function battlegroundWallSegments(): BgWallSeg[] {
  return [
    ...BG_PERIMETER_WALLS,
    ...keepWallSegments(0),
    ...keepWallSegments(1),
    ...BG_COVER_WALLS,
    ...BG_CURTAIN_WALLS,
    ...BG_GATEHOUSE_WALLS,
    ...BG_KEEP_BARRICADES,
    ...BG_GRAVEYARD_FENCES,
  ];
}

/** Full BG collision set in instance-local coordinates. Flag stands and speed
 *  runes are deliberately walkable (no collider). */
export function battlegroundColliders(): Collider[] {
  const out: Collider[] = [];
  for (const w of battlegroundWallSegments()) {
    out.push({
      type: 'obb',
      x: w.x,
      z: w.z,
      hw: w.hw,
      hd: w.hd,
      rot: 0,
      cameraTopY: w.fence ? BG_GRAVEYARD_FENCE_TOP : w.low ? BG_WALL_HEIGHT / 2 : BG_WALL_HEIGHT,
    });
  }
  for (const p of BG_COVER_PILLARS) {
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_R, cameraTopY: BG_WALL_HEIGHT });
  }
  for (const c of BG_COVER_CRATES) {
    out.push({ type: 'circle', x: c.x, z: c.z, r: CRATE_R, cameraTopY: CRATE_TOP });
  }
  return out;
}
