// Ravenrift battleground render manifest, the pure half of battleground.ts.
// Derives every module placement (KayKit module kind + instance-local
// transform) from the sim layout in src/sim/battleground_layout.ts, the SAME
// record the collider set reads, so what players collide with is exactly what
// the builder draws. The one deliberate visual-only divergence: the heart-ruin
// block (the single thick near-square segment) collides solid but renders as a
// hollow four-sided ruin shell with an identical 10x10 footprint.
// Three-free and deterministic (hash2 is the dungeon.ts position hash), so
// tests/battleground_render.test.ts pins the geometry headlessly.

import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_SPEED_RUNES,
  BG_WALL_HEIGHT,
  BG_WALL_T,
  type BgTeam,
  type BgWallSeg,
  battlegroundWallSegments,
} from '../sim/battleground_layout';

// KayKit module dimensions at scale 1 (the dungeon.ts conventions): a wall
// module is 4u long, 4u tall, 1u thick; floor tiles are 4x4.
const WALL_MODULE_LEN = 4;
const WALL_MODULE_H = 4;
const WALL_MODULE_T = 1;
const FLOOR_CELL = 4;
// Target run length per wall module (8u, the dungeon MODULE_SCALE=2 tiling).
const WALL_TILE_LEN = 8;

/** Tile tops sit proud of the levelled ground (no z-fight with the floor). */
export const BG_FLOOR_Y = 0.02;
/** Wall module y scale: the visual wall height matches the collider height. */
export const BG_WALL_Y_SCALE = BG_WALL_HEIGHT / WALL_MODULE_H;
const WALL_CROSS_SCALE = (BG_WALL_T * 2) / WALL_MODULE_T;

/** Banner poles flank each keep's spawn banner point on x by this offset. */
export const BG_BANNER_FLANK_DX = 9;

// Cover dressing scales: sized to read against the r=1.0 pillar / r=0.8 crate
// circle colliders (cosmetic fit; the manifest tests pin only presence).
const PILLAR_XZ_SCALE = 1.3;
const CRATE_SCALE = 1.6;

const QUARTER = Math.PI / 2;

// Stable per-position hash (the dungeon.ts / jail_scene.ts trick; local copy
// because dungeon.ts keeps its own private).
function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function pickKind(kinds: [name: string, weight: number][], t: number): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = 0;
  for (const [name, w] of kinds) {
    acc += w;
    if (t * total < acc) return name;
  }
  return kinds[kinds.length - 1][0];
}

/** One kit-module instance in battleground-local coordinates. */
export interface BgModulePlacement {
  kind: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  scale: [number, number, number];
}

export interface BgTeamPoint {
  team: BgTeam;
  x: number;
  z: number;
}

/** Everything the Three builder instantiates, all derived from the layout. */
export interface BattlegroundRenderManifest {
  /** Hash-varied courtyard floor tiles covering the walled field. */
  floors: BgModulePlacement[];
  /** Wall modules tiled along every SOLID wall segment (perimeter, keeps with
   *  their postern gaps, thin cover walls). Never the heart-ruin block. */
  walls: BgModulePlacement[];
  /** The heart ruin: a hollow four-sided shell over the block's footprint. */
  ruin: BgModulePlacement[];
  pillars: BgModulePlacement[];
  crates: BgModulePlacement[];
  /** Two procedural team banner poles flanking each keep's spawn banner. */
  banners: BgTeamPoint[];
  /** One glowing flag pedestal at each team's flag stand. */
  flagPedestals: BgTeamPoint[];
  /** One additive gold ring pad per speed rune. */
  runePads: { x: number; z: number }[];
}

/** The heart ruin is the one thick (near-square) segment; every real wall run
 *  is BG_WALL_T thin on one axis. */
export function isRuinBlock(s: BgWallSeg): boolean {
  return Math.min(s.hw, s.hd) > BG_WALL_T;
}

const WALL_KINDS: [string, number][] = [
  ['wall', 5],
  ['wall_cracked', 1],
];
// The ruin shell reads ruined: cracked-heavy modules at hash-varied heights.
const RUIN_KINDS: [string, number][] = [
  ['wall_cracked', 2],
  ['wall', 1],
];
const RUIN_HEIGHT_LEVELS = [1, 0.8, 0.6];

const FLOOR_KINDS: [string, number][] = [
  ['floor_tile_large', 4],
  ['floor_tile_large_rocks', 2],
  ['floor_dirt_large', 2],
  ['floor_dirt_large_rocky', 1],
];

const CRATE_KINDS: [string, number][] = [
  ['crates_stacked', 2],
  ['box_stacked', 1],
];

// Tile one thin wall segment into near-8u wall modules (the remainder is
// spread evenly so runs stay flush with the segment ends: the postern gap
// edges are collider edges and must match exactly).
function tileWallSegment(
  out: BgModulePlacement[],
  s: BgWallSeg,
  kinds: [string, number][],
  heightLevels: number[] | null,
): void {
  const alongZ = s.hd >= s.hw;
  const len = 2 * (alongZ ? s.hd : s.hw);
  const modules = Math.max(1, Math.round(len / WALL_TILE_LEN));
  const step = len / modules;
  const start = (alongZ ? s.z - s.hd : s.x - s.hw) + step / 2;
  for (let i = 0; i < modules; i++) {
    const c = start + i * step;
    const x = alongZ ? s.x : c;
    const z = alongZ ? c : s.z;
    const yScale = heightLevels
      ? BG_WALL_Y_SCALE * heightLevels[Math.floor(hash2(z, x * 7.3) * heightLevels.length)]
      : BG_WALL_Y_SCALE;
    out.push({
      kind: pickKind(kinds, hash2(x * 1.7, z)),
      x,
      y: 0,
      z,
      ry: alongZ ? QUARTER : 0,
      scale: [step / WALL_MODULE_LEN, yScale, WALL_CROSS_SCALE],
    });
  }
}

// The hollow ruin shell: four thin edge runs over the block's own footprint
// (outer faces exactly where the collider's faces are; the interior stays
// open so the ruin reads as a roofless shell).
function ruinShellSegments(s: BgWallSeg): BgWallSeg[] {
  const t = BG_WALL_T;
  return [
    { x: s.x, z: s.z - (s.hd - t), hw: s.hw, hd: t },
    { x: s.x, z: s.z + (s.hd - t), hw: s.hw, hd: t },
    { x: s.x - (s.hw - t), z: s.z, hw: t, hd: s.hd - 2 * t },
    { x: s.x + (s.hw - t), z: s.z, hw: t, hd: s.hd - 2 * t },
  ];
}

/** Build the full render manifest from the layout record (never hardcoded
 *  geometry): pure, deterministic, Three-free. */
export function battlegroundRenderManifest(): BattlegroundRenderManifest {
  const floors: BgModulePlacement[] = [];
  for (let z = -(BG_HALF_Z - FLOOR_CELL / 2); z <= BG_HALF_Z - FLOOR_CELL / 2; z += FLOOR_CELL) {
    for (let x = -(BG_HALF_X - FLOOR_CELL / 2); x <= BG_HALF_X - FLOOR_CELL / 2; x += FLOOR_CELL) {
      floors.push({
        kind: pickKind(FLOOR_KINDS, hash2(x * 1.31, z)),
        x,
        y: BG_FLOOR_Y,
        z,
        ry: Math.floor(hash2(z, x) * 4) * QUARTER,
        scale: [1, 1, 1],
      });
    }
  }

  const walls: BgModulePlacement[] = [];
  const ruin: BgModulePlacement[] = [];
  for (const s of battlegroundWallSegments()) {
    if (isRuinBlock(s)) {
      for (const edge of ruinShellSegments(s)) {
        tileWallSegment(ruin, edge, RUIN_KINDS, RUIN_HEIGHT_LEVELS);
      }
    } else {
      tileWallSegment(walls, s, WALL_KINDS, null);
    }
  }

  const pillars: BgModulePlacement[] = BG_COVER_PILLARS.map((p) => ({
    kind: 'pillar',
    x: p.x,
    y: 0,
    z: p.z,
    ry: Math.floor(hash2(p.x, p.z) * 4) * QUARTER,
    scale: [PILLAR_XZ_SCALE, BG_WALL_Y_SCALE, PILLAR_XZ_SCALE],
  }));

  const crates: BgModulePlacement[] = BG_COVER_CRATES.map((c) => ({
    kind: pickKind(CRATE_KINDS, hash2(c.x * 2.1, c.z)),
    x: c.x,
    y: 0,
    z: c.z,
    ry: Math.floor(hash2(c.z, c.x) * 4) * QUARTER,
    scale: [CRATE_SCALE, CRATE_SCALE, CRATE_SCALE],
  }));

  const banners: BgTeamPoint[] = [];
  const flagPedestals: BgTeamPoint[] = [];
  for (const base of BG_BASES) {
    banners.push({ team: base.team, x: base.banner.x - BG_BANNER_FLANK_DX, z: base.banner.z });
    banners.push({ team: base.team, x: base.banner.x + BG_BANNER_FLANK_DX, z: base.banner.z });
    flagPedestals.push({ team: base.team, x: base.flag.x, z: base.flag.z });
  }

  const runePads = BG_SPEED_RUNES.map((r) => ({ x: r.x, z: r.z }));

  return { floors, walls, ruin, pillars, crates, banners, flagPedestals, runePads };
}
