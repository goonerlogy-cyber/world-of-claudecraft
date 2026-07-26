// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

/**
 * The per-slot dressing roll for a wall-side obstacle: the ONE draw both the
 * renderer (which prop fills the slot) and the collider builder (how tall the
 * standable top is) consume, so mesh and physics can never disagree. Same
 * stable sine hash the renderer's prop jitter has always used.
 */
export function tombSlotRoll(x: number, z: number): number {
  const s = Math.sin(x * 3.7 * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Shared structural constants (instance-local coordinates, y up, z into the
// dungeon). Values are frozen gameplay contracts: mob spawns and pathing
// assume these exact footprints.
export const DUNGEON_WALL_X = 23; // side wall centreline (|x|)
export const DUNGEON_WALL_HW = 1; // wall half thickness
/** Walkable half-width inside side-wall colliders (instance-local x). */
export const DUNGEON_WALK_HALF_X = DUNGEON_WALL_X - DUNGEON_WALL_HW;
export const DUNGEON_END_WALL_HW = 24; // front/back wall half width
export const PILLAR_COLLIDER_R = 1.0; // centre-aisle pillar obstacle radius
export const TOMB_HW = 1.1; // wall-side obstacle (sarcophagus/cargo) half extents
export const TOMB_HD = 2.1;
export const DUNGEON_WALL_HEIGHT = 8; // visual module height (2x KayKit 4u walls)
/**
 * Boss dais height (yards): the foundation blocks the renderer stacks are 2u
 * pieces at 0.3 y-scale. The SIM treats this as real elevation (the interior
 * floor rises by it inside the dais radius, see `daisLiftAt`), so the boss
 * stands ON the stage instead of knee-deep in it, and a player strides up the
 * rim exactly like an open-world kerb (it sits inside MAX_STEP_HEIGHT).
 */
export const DAIS_HEIGHT = 0.6;

/**
 * Standable tops for the wall-side obstacle slots, measured from the shipped
 * dungeon-kit GLBs at the exact scales `render/dungeon.ts` places them
 * (gltf-transform dequantized bounds), so the surface a body lands on IS the
 * silhouette it sees. Per-slot variety keys off the SAME `hash2(x * 3.7, z)`
 * draw the renderer uses to pick the prop, so collider and mesh can never
 * disagree about which piece fills a slot.
 */
// Hollow Crypt / Nythraxis corners: coffin 1.322 native x 1.3 = 1.72;
// coffin_decorated 0.902 x 1.3 = 1.17.
export const TOMB_COFFIN_PLAIN_TOP = 1.72;
export const TOMB_COFFIN_DECORATED_TOP = 1.17;
// Sunken Bastion cargo, front stack: crates_stacked 2.142 x 1.0 = 2.14;
// box_stacked 3.309 x 0.6 = 1.99. Rear cask: barrel_large 2.0 x 0.85 = 1.70;
// keg 2.051 x 0.9 = 1.85.
export const TOMB_CARGO_STACK_TOP = 2.14;
export const TOMB_CARGO_BOX_TOP = 1.99;
export const TOMB_CARGO_BARREL_TOP = 1.7;
export const TOMB_CARGO_KEG_TOP = 1.85;
/** Cargo sub-collider footprints (the crate stack and the cask behind it). */
export const TOMB_CARGO_STACK_HW = 0.95;
export const TOMB_CARGO_CASK_R = 0.55;

/**
 * How a dungeon dresses its wall-side obstacle slots, and therefore what the
 * matching colliders look like. `coffins` slots are a single standable lid;
 * `cargo` slots split into the crate stack and the cask the renderer actually
 * draws; absent, the slot stays the legacy full-height block (the temple's
 * candle shrines are altars, not furniture).
 */
export type TombDressing = 'coffins' | 'cargo';

export interface GridPoint {
  x: number;
  z: number;
}

export interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DungeonLayout {
  /** front wall centreline (entrance end) */
  zMin: number;
  /** back wall centreline (boss end) */
  zMax: number;
  /** side-wall collider slab (matches the legacy hand-authored extents) */
  sideWallZ: number;
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
  /**
   * True when the renderer stacks the DAIS_HEIGHT foundation platform on the
   * dais: the sim's interior floor rises to match (`daisLiftAt`). Absent on
   * the flat fighting floors (arena, the Nythraxis raid).
   */
  daisRaised?: boolean;
  /** Optional room width override for oversized rooms. Defaults to the classic crypt width. */
  wallX?: number;
  endWallHw?: number;
  floorHalfX?: number;
  /** entrance archway z position; renderer places gate props here when set */
  doorZ?: number;
  /** floor scatter positions, renderer places props here AND collision circles back them */
  clutter?: GridPoint[];
  /** Room shell outline (CCW, simple, star-shaped from `shellPole`), instance-local.
   * When present, render/collision derive the room's walls and floor mask from this
   * polygon instead of the rectangular wallX/zMin/zMax shell. */
  shellPolygon?: Array<{ x: number; z: number }>;
  /** Star-shaping pole paired with `shellPolygon` (see geometry2d.polygonIsStarShaped). */
  shellPole?: { x: number; z: number };
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// The Hollow Crypt / Sunken Bastion room (both DungeonDef.interior 'crypt'):
// one long nave, z -19..112, pillar rows at +-14, sarcophagi at +-19.
export const CRYPT_LAYOUT: DungeonLayout = {
  zMin: -19,
  zMax: 112,
  sideWallZ: 47,
  sideWallHd: 66,
  pillars: grid(10, 100, 15, [-14, 14]),
  tombs: grid(16, 92, 19, [-19, 19]),
  stubs: [],
  dais: { x: 0, z: 96, r: 9.5 },
  daisRaised: true,
};

// Gravewyrm Sanctum: a stretched three-chamber crypt (z -19..158) with
// narrowed waists at z 67/115 leaving a ~10u centre passage at |x| <= 5.
export const SANCTUM_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 67, hw: 9, hd: 5 }); // Boneworks -> Korgath's Hall
    stubs.push({ x: sx, z: 115, hw: 9, hd: 3 }); // Ritual Vault -> Wyrm's Hollow
  }
  return {
    zMin: -19,
    zMax: 158,
    sideWallZ: 69.5,
    sideWallHd: 89,
    pillars,
    tombs: [],
    stubs,
    dais: { x: 0, z: 146, r: 11.5 },
    daisRaised: true,
  };
})();

// Nythraxis' Abandoned Crypt raid room: a long dark nave ending in one large
// fighting arena. It stays within the shared wall-width contract, but leaves the
// central floor open so ten players can spread, stack, and reach three wardstones.
export const NYTHRAXIS_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [18, 38, 60, 82, 106]) {
    for (const x of [-90, -45, 45, 90]) pillars.push({ x, z });
  }
  return {
    zMin: -19,
    zMax: 126,
    sideWallZ: 53.5,
    sideWallHd: 73,
    wallX: 230,
    endWallHw: 231,
    floorHalfX: 228,
    pillars,
    tombs: [
      { x: -210, z: 20 },
      { x: 210, z: 20 },
      { x: -210, z: 42 },
      { x: 210, z: 42 },
      { x: -210, z: 64 },
      { x: 210, z: 64 },
    ],
    stubs: [],
    dais: { x: 0, z: 96, r: 13.5 },
  };
})();

// The Drowned Temple (interior 'temple'): a two-part flooded temple — a long
// antechamber, a single chamber-waist arch at z 66 (10u centre passage), then
// the moon-sanctum with Ysolei's great altar dais. Side walls at |x|=23 like
// the crypt so the KayKit wall modules fit unchanged; wall-side slots carry
// drowned reliquary altars instead of sarcophagi.
export const TEMPLE_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 80, 95, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 66, hw: 9, hd: 4 }); // antechamber -> moon-sanctum
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 75.5,
    pillars,
    tombs: grid(18, 40, 22, [-19, 19]), // reliquary altars hugging the antechamber walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
    daisRaised: true,
  };
})();

// The Ashen Coliseum (interior 'arena'): a compact, fully-enclosed square pit
// — no door, no aisle (combatants are teleported in by matchmaking). Side
// walls at |x|=23 like the crypt so the KayKit wall modules fit unchanged;
// four corner pillars carry the arena's warm torches. The dais marker only
// drives the central floor glow (the renderer skips its platform for the
// arena), so it stays a flat, obstacle-free fighting ring.
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -20,
  zMax: 24,
  sideWallZ: 2,
  sideWallHd: 23,
  pillars: [
    { x: -14, z: -10 },
    { x: 14, z: -10 },
    { x: -14, z: 14 },
    { x: 14, z: 14 },
    // Cover/parkour posts, mirrored about the centre line (z=2) so neither side
    // is favoured. They give the Fiesta something to juke around (and ranked a
    // little cover too) without crowding the spawns at z=-14 / z=18.
    { x: 0, z: -4 },
    { x: 0, z: 8 },
    { x: -9, z: -10 },
    { x: 9, z: -10 },
    { x: -9, z: 14 },
    { x: 9, z: 14 },
  ],
  tombs: [],
  // Narrow flanking cover walls along the side lanes, mirrored about z=2.
  stubs: [
    { x: -11, z: 2, hw: 0.6, hd: 4 },
    { x: 11, z: 2, hw: 0.6, hd: 4 },
  ],
  dais: { x: 0, z: 2, r: 8 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other.
export const ARENA_SPAWN_A = { x: 0, z: -14, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 18, facing: Math.PI }; // faces -z toward A

// 2v2: two fighters per side, spread along x.
export const ARENA_SPAWNS_A_2v2 = [
  { x: -7, z: -14, facing: 0 },
  { x: 7, z: -14, facing: 0 },
];
export const ARENA_SPAWNS_B_2v2 = [
  { x: -7, z: 18, facing: Math.PI },
  { x: 7, z: 18, facing: Math.PI },
];

/**
 * The interior floor's rise above the flat room floor at an instance-local
 * point: DAIS_HEIGHT inside a raised boss dais, zero elsewhere. This is the
 * sim half of the platform the renderer stacks; `world.ts` groundHeight adds
 * it, so mobs, spawns, loot, landings, and the camera all stand on the stage.
 */
export function daisLiftAt(layout: DungeonLayout, lx: number, lz: number): number {
  if (!layout.daisRaised) return 0;
  const d = layout.dais;
  const dx = lx - d.x;
  const dz = lz - d.z;
  return dx * dx + dz * dz <= d.r * d.r ? DAIS_HEIGHT : 0;
}

/**
 * Interior collision set for a layout, in instance-local coordinates.
 * `dressing` describes what the renderer stands in the tomb slots for this
 * dungeon, and therefore what the slots' colliders are: coffins are one
 * standable lid (per-slot height from the same hash the renderer draws),
 * cargo splits into the crate stack and the cask, and no dressing keeps the
 * legacy full-height block. `floorY` absolutizes the standable tops (the
 * interior floor constant; instance-local props all sit on it).
 */
export function layoutColliders(
  layout: DungeonLayout,
  dressing?: TombDressing,
  floorY = 0,
): Collider[] {
  const out: Collider[] = [];
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
  // side walls
  for (const sx of [-wallX, wallX]) {
    out.push({
      type: 'obb',
      x: sx,
      z: layout.sideWallZ,
      hw: DUNGEON_WALL_HW,
      hd: layout.sideWallHd,
      rot: 0,
    });
  }
  // back wall, then front wall (entrance porch: chase cam fits inside)
  out.push({ type: 'obb', x: 0, z: layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  out.push({ type: 'obb', x: 0, z: layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  // chamber waists
  for (const s of layout.stubs)
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars)
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // Wall-side obstacle slots (the boss dais is walkable: no collider). The
  // per-slot draw is `tombSlotRoll`, the same roll the renderer picks the
  // prop with, so the collider always matches the piece filling the slot.
  for (const t of layout.tombs) {
    const r = tombSlotRoll(t.x, t.z);
    if (dressing === 'coffins') {
      const top = r < 0.55 ? TOMB_COFFIN_PLAIN_TOP : TOMB_COFFIN_DECORATED_TOP;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z,
        hw: TOMB_HW,
        hd: TOMB_HD,
        rot: 0,
        moveTopY: floorY + top,
        standable: true,
      });
    } else if (dressing === 'cargo') {
      // Front stack and rear cask, at the exact offsets the renderer uses,
      // with the walkable gap between them the player can now see AND use.
      const stackTop = r < 0.5 ? TOMB_CARGO_STACK_TOP : TOMB_CARGO_BOX_TOP;
      const caskTop = r < 0.5 ? TOMB_CARGO_BARREL_TOP : TOMB_CARGO_KEG_TOP;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z - 1.0,
        hw: TOMB_CARGO_STACK_HW,
        hd: TOMB_CARGO_STACK_HW,
        rot: 0,
        moveTopY: floorY + stackTop,
        standable: true,
      });
      out.push({
        type: 'circle',
        x: t.x + (r < 0.5 ? 0.1 : -0.1),
        z: t.z + 1.3,
        r: TOMB_CARGO_CASK_R,
        moveTopY: floorY + caskTop,
        standable: true,
      });
    } else {
      out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
    }
  }
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
