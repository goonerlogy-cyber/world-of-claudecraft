// Ravenrift, the 5v5 capture-the-flag battleground. Plain-data map geometry in
// instance-local coordinates (y up, z along the length), the single source of
// truth shared by BOTH the collider set (src/sim/colliders.ts) and the renderer
// (src/render/battleground.ts), so what you fight around is what you see.
// Sim layer: no three.js imports. The field is a rework of Dubtribe11's
// PR #589 layout: the keeps, flags, runes, and postern gaps are kept, and the
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
export const BG_HALF_X = 34;
export const BG_HALF_Z = 60;
export const BG_WALL_T = 1; // wall half-thickness (collider + module)
export const BG_WALL_HEIGHT = 6;
export const BG_FLAG_Z = 48; // |z| of each team's flag stand

// Keep enclosure: a back wall behind the flag and two side walls, open toward
// the field. One side wall carries the postern gap (see keepWallSegments).
const KEEP_HALF_X = 14;
const KEEP_BACK_DZ = 8; // back wall sits this far behind the flag
const KEEP_SIDE_DZ = 2; // side-wall centre offset behind the flag
const KEEP_SIDE_HD = 6; // side-wall half-depth
export const BG_POSTERN_GAP = 2.5; // width of the postern opening in one side wall

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
    spawns: [
      { x: -6, z: -54 },
      { x: 0, z: -55 },
      { x: 6, z: -54 },
      { x: -3, z: -51 },
      { x: 3, z: -51 },
    ],
    banner: { x: 0, z: -56 },
  },
  {
    team: 1,
    flag: { x: 0, z: BG_FLAG_Z },
    spawns: [
      { x: 6, z: 54 },
      { x: 0, z: 55 },
      { x: -6, z: 54 },
      { x: 3, z: 51 },
      { x: -3, z: 51 },
    ],
    banner: { x: 0, z: 56 },
  },
];

// Speed runes: one at each flag approach plus two mid-field flanks. Stepping on
// an active rune grants a sprint buff; it then recharges (see sim BG_RUNE_*).
export const BG_SPEED_RUNES: { x: number; z: number }[] = [
  { x: 0, z: -36 }, // Crimson flag approach
  { x: 0, z: 36 }, // Azure flag approach
  { x: -24, z: 0 }, // west flank
  { x: 24, z: 0 }, // east flank
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
}

// Chamber cover: the hollow heart ruin and flanking cover inside the Ruin
// Courtyard, plus one wing baffle per field chamber near each keep mouth.
// The heart ruin collides as one solid block; the renderer dresses it as a
// hollow ruin shell (visual only, same footprint). The two sightline
// breakers are angled so the two main gates never see each other.
export const BG_COVER_WALLS: BgWallSeg[] = [
  { x: 0, z: 0, hw: 6, hd: 6 }, // heart ruin block
  { x: -10, z: -10, hw: 4, hd: 1 }, // courtyard sightline breakers
  { x: 10, z: 10, hw: 4, hd: 1 },
  { x: -22, z: -30, hw: 6, hd: 1 }, // wing baffles near each keep mouth
  { x: 22, z: 30, hw: 6, hd: 1 },
];
export const BG_COVER_PILLARS: { x: number; z: number }[] = [
  { x: -18, z: -8 },
  { x: 18, z: -8 },
  { x: -18, z: 8 },
  { x: 18, z: 8 },
];
export const BG_COVER_CRATES: { x: number; z: number }[] = [
  { x: -8, z: -32 }, // field cover on each approach
  { x: 8, z: 32 },
  { x: 27, z: -3 }, // cover beside each flank rune
  { x: -27, z: 3 },
  { x: -18, z: -22 }, // the ambush crate inside each gatehouse: it blocks the
  { x: 18, z: 22 }, // straight door-to-door line and forces the jog wide
];

/** The z line of each curtain wall: the chamber boundaries. */
export const BG_CURTAIN_Z = 20;

// The two curtain walls: full-width partitions at z = +-BG_CURTAIN_Z that
// carve the field into three chambers (each team's field, the Ruin Courtyard
// between). Each curtain is pierced by exactly three crossings, mirrored:
//   main gate, 8yd, off-center toward the field side (Crimson's east);
//   flank arch, 4yd, hugging the far rampart;
//   the gatehouse, whose walls the curtain terminates into (below).
export const BG_CURTAIN_WALLS: BgWallSeg[] = [
  { x: -30, z: -20, hw: 4, hd: 1 }, // rampart to gatehouse west wall
  { x: -5, z: -20, hw: 9, hd: 1 }, // gatehouse east wall to main gate (x 4..12)
  { x: 19, z: -20, hw: 7, hd: 1 }, // main gate to flank arch (x 26..30)
  { x: 32, z: -20, hw: 2, hd: 1 }, // flank arch to rampart
  { x: 30, z: 20, hw: 4, hd: 1 }, // north curtain, point mirror
  { x: 5, z: 20, hw: 9, hd: 1 },
  { x: -19, z: 20, hw: 7, hd: 1 },
  { x: -32, z: 20, hw: 2, hd: 1 },
];

// The gatehouses: a 12x12 room straddling each curtain with OFFSET doors
// (enter the field-side door on one half, exit the courtyard-side door on the
// other), so crossing it is a jog past ambush corners, not a straight run.
// Each sits on its team's postern side, so a runner slipping out the postern
// chains naturally into it. Walls butt-join the curtain segments exactly.
export const BG_GATEHOUSE_WALLS: BgWallSeg[] = [
  { x: -25, z: -20, hw: 1, hd: 6 }, // south gatehouse, west wall
  { x: -15, z: -20, hw: 1, hd: 6 }, // east wall
  { x: -23, z: -26, hw: 3, hd: 1 }, // field-side wall (door x -20..-16)
  { x: -18.5, z: -14, hw: 2.5, hd: 1 }, // courtyard-side wall (door x -24..-21)
  { x: 25, z: 20, hw: 1, hd: 6 }, // north gatehouse, point mirror
  { x: 15, z: 20, hw: 1, hd: 6 },
  { x: 23, z: 26, hw: 3, hd: 1 },
  { x: 18.5, z: 14, hw: 2.5, hd: 1 },
];

// Mouth barricades: one low wall 2yd field-side of each keep mouth, offset
// across the mouth span so the straight line from the field to the flag is
// broken: measured against the keep's own width, a runner rounds it through a
// narrow lane on the postern side or a wide lane on the other (the open field
// beyond the keep's width flanks it entirely). Defenders get a hold point,
// attackers pick a side. Sits OUTSIDE keepInteriorBounds, so the form-up
// containment never reads it.
export const BG_KEEP_BARRICADES: BgWallSeg[] = [
  { x: -2, z: -42, hw: 6, hd: 1, low: true },
  { x: 2, z: 42, hw: 6, hd: 1, low: true },
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
export const KEEP_MOUTH_DZ = 4;

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
 * Keep walls for one team, postern gap included. Crimson's postern opens in
 * its WEST wall and Azure's in its EAST wall, the point-symmetric mirror
 * ((x,z) -> (-x,-z)) the rest of the map follows, so neither side is favored.
 * The gap gives the flag grabber a second exit: main mouth toward mid cover,
 * postern toward the fast open flank near that side's flank rune.
 */
export function keepWallSegments(team: BgTeam): BgWallSeg[] {
  const dir = team === 0 ? -1 : 1; // back wall is further from centre
  const flagZ = team === 0 ? -BG_FLAG_Z : BG_FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const sideZ = flagZ + dir * KEEP_SIDE_DZ;
  const segs: BgWallSeg[] = [{ x: 0, z: backZ, hw: KEEP_HALF_X, hd: BG_WALL_T }];
  const posternX = team === 0 ? -KEEP_HALF_X : KEEP_HALF_X;
  for (const sx of [-KEEP_HALF_X, KEEP_HALF_X]) {
    if (sx === posternX) {
      // split the side wall around a BG_POSTERN_GAP opening centred mid-wall
      const segHd = (KEEP_SIDE_HD - BG_POSTERN_GAP / 2) / 2;
      const off = BG_POSTERN_GAP / 2 + segHd;
      segs.push({ x: sx, z: sideZ - off, hw: BG_WALL_T, hd: segHd });
      segs.push({ x: sx, z: sideZ + off, hw: BG_WALL_T, hd: segHd });
    } else {
      segs.push({ x: sx, z: sideZ, hw: BG_WALL_T, hd: KEEP_SIDE_HD });
    }
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
      cameraTopY: w.low ? BG_WALL_HEIGHT / 2 : BG_WALL_HEIGHT,
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
