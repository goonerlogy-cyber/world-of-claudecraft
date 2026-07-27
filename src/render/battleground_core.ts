// Ravenrift battleground render manifest, the pure half of battleground.ts.
// Derives every module placement (KayKit module kind + instance-local
// transform) from the sim layout in src/sim/battleground_layout.ts, the SAME
// record the collider set reads, so what players collide with is exactly what
// the builder draws. The one deliberate visual-only divergence: the heart-ruin
// block (the single thick near-square segment) collides solid but renders as a
// hollow four-sided ruin shell with an identical 16x16 footprint.
// Three-free and deterministic (hash2 is the dungeon.ts position hash), so
// tests/battleground_render.test.ts pins the geometry headlessly.

import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_CURTAIN_WALLS,
  BG_CURTAIN_Z,
  BG_FLAG_Z,
  BG_GATEHOUSE_WALLS,
  BG_GRAVEYARDS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  BG_WALL_HEIGHT,
  BG_WALL_T,
  type BgTeam,
  type BgWallSeg,
  battlegroundWallSegments,
  KEEP_BACK_DZ,
  KEEP_HALF_X,
  KEEP_MOUTH_DZ,
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
/** Low barricades (BgWallSeg.low) render at half the rampart height: 3yd,
 *  head-high-plus, above SIGHT_HEIGHT. The collider matches: same footprint,
 *  camera clears it above 3yd, casts stay blocked (layout cameraTopY). */
export const BG_LOW_WALL_Y_SCALE = BG_WALL_Y_SCALE * 0.5;
/** Graveyard fence rails render at BG_GRAVEYARD_FENCE_TOP (1.8yd): a low
 *  crumbled run around each keep's graveyard plot, matching its collider. */
export const BG_FENCE_Y_SCALE = BG_WALL_Y_SCALE * 0.3;
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
  /** Wall modules tiled along every SOLID wall segment (perimeter, sealed
   *  keeps, thin cover walls). Never the heart-ruin block. */
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
  /** Ruin Courtyard rubble/weed accents (small kit tiles laid proud of the floor). */
  accents: BgModulePlacement[];
  /** Team-colored kit banners dressing the keep walls (red south, blue north). */
  wallBanners: BgModulePlacement[];
  /** Mounted torches along the ramparts; the builder adds a warm glow at each. */
  torches: BgModulePlacement[];
  /** Graveyard dressing inside each keep plot: stones, markers, a shrine. */
  graves: BgModulePlacement[];
  /** Visual-only field dressing (never a collider): the tree line outside the
   *  perimeter, wall trophies/plaques, gate banners, courtyard rubble, and
   *  keep-corner garrison clutter. Point-mirrored (colors aside). */
  dressing: BgModulePlacement[];
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
// Low barricades read as crumbled rubble walls, not fresh masonry. One fixed
// kind: with so few modules, a hash mix would dress the two keeps' barricades
// differently, and the mirrored dressing rule outranks variety here. The
// gatehouses are landmarks under the same rule: fixed intact masonry, so the
// two mirrored gatehouses always dress identically.
const BARRICADE_KINDS: [string, number][] = [['wall_cracked', 1]];
const GATEHOUSE_KINDS: [string, number][] = [['wall', 1]];
// The curtains are the oldest walls on the field: cracked-heavy, so the Ruin
// Courtyard's boundary reads ancient against the maintained perimeter/keeps.
const CURTAIN_KINDS: [string, number][] = [
  ['wall_cracked', 2],
  ['wall', 1],
];
// The ruin shell reads ruined: cracked-heavy modules at hash-varied heights.
const RUIN_KINDS: [string, number][] = [
  ['wall_cracked', 2],
  ['wall', 1],
];
const RUIN_HEIGHT_LEVELS = [1, 0.8, 0.6];

// --- Zone theming (visual only; colliders never read any of this) ----------
// Three mirrored |z| bands, aligned to the chamber walls: each KEEP GROUND is
// a maintained garrison (clean tiles, team banners, torch-lit ramparts), the
// FIELD chambers between keep and curtain are the worn road, and the RUIN
// COURTYARD between the curtains is broken, overgrown ground littered with
// rubble. Bands key on |z|, so the two halves stay exact mirrors and neither
// team's end reads differently in gameplay terms (theme, never information).
export type BgZone = 'keep' | 'approach' | 'mid';
/** The courtyard band ends at the curtain line, DERIVED so it cannot drift. */
export const BG_ZONE_MID_HALF_Z = BG_CURTAIN_Z;
/** The garrison band starts at the keep mouth line, past the barricades. */
export const BG_ZONE_KEEP_MIN_Z = BG_FLAG_Z - KEEP_MOUTH_DZ;

export function bgZoneAt(z: number): BgZone {
  const az = Math.abs(z);
  if (az >= BG_ZONE_KEEP_MIN_Z) return 'keep';
  if (az > BG_ZONE_MID_HALF_Z) return 'approach';
  return 'mid';
}

const FLOOR_KINDS_BY_ZONE: Record<BgZone, [string, number][]> = {
  // garrison grounds: swept tile with the odd rocky patch
  keep: [
    ['floor_tile_large', 6],
    ['floor_tile_large_rocks', 1],
    ['floor_dirt_large', 1],
  ],
  // each team's field chamber: a kept road, clearly tidier than the courtyard
  approach: [
    ['floor_tile_large', 5],
    ['floor_tile_large_rocks', 2],
    ['floor_dirt_large', 1],
  ],
  // the ruin courtyard: broken earth almost wall to wall
  mid: [
    ['floor_tile_large', 1],
    ['floor_tile_large_rocks', 2],
    ['floor_dirt_large', 3],
    ['floor_dirt_large_rocky', 4],
  ],
};

// Rubble/overgrowth accents scattered over the ruin courtyard (small kit tiles laid
// proud of the floor). Deliberately clear of the rune pads so the gold rings
// stay unobstructed reads.
const ACCENT_KINDS: [string, number][] = [
  ['floor_tile_small_broken_A', 2],
  ['floor_tile_small_broken_B', 2],
  ['floor_tile_small_weeds_A', 3],
  ['floor_tile_small_weeds_B', 3],
];
const ACCENT_CHANCE = 0.45;
const ACCENT_Y_LIFT = 0.015;
const ACCENT_CLEARANCE = 2.4; // keep-away radius around rune pads
const ACCENT_SCALE = 1.4;

// Team-colored kit banners dressing each keep's walls (red kinds south,
// blue kinds north; positions mirror under the same point symmetry the
// colliders keep, so neither end is dressed "more").
const KEEP_BANNER_XS = [-6, 0, 6];
const KEEP_BANNER_KINDS: Record<BgTeam, { center: string; side: string; mouth: string }> = {
  0: { center: 'banner_patterna_red', side: 'banner_thin_red', mouth: 'banner_shield_red' },
  1: { center: 'banner_patterna_blue', side: 'banner_thin_blue', mouth: 'banner_shield_blue' },
};
const BANNER_MODULE_SCALE = 1.5; // 4u kit banner -> 6u, the wall height
const BANNER_WALL_INSET = 1.1; // stood just inside the wall face

// Torch-lit ramparts: mounted torches along the perimeter side walls plus the
// keep back walls, mirrored. The builder adds a small warm glow at each
// BG_TORCH_GLOW_H; no lights, so every tier pays the same nothing.
// Rampart torches per side, spread along the 280yd length: keep mouths,
// each field chamber, and the courtyard. All clear of the curtain band
// (|z| 55..57) and the keep walls; rampart torches sit at |x| 49, far from
// the gatehouse footprints (|x| 18..34).
const TORCH_SIDE_ZS = [-102, -72, -32, 32, 72, 102];
const TORCH_KEEP_XS = [-10, 10];
const TORCH_MODULE_SCALE = 1.5;
const TORCH_WALL_INSET = 1.0;
export const BG_TORCH_GLOW_H = 3.3;

const GRAVE_MODULE_SCALE = 1.2;

// Field dressing (visual only). The tree kinds ring the OUTSIDE of the
// perimeter so the skyline reads like a real place (the Eastbrook-gap fix);
// nothing there is walkable, so no collider question arises.
const DRESSING_TREE_KINDS: [string, number][] = [
  ['tree_pine_orange_large', 3],
  ['tree_pine_orange_medium', 2],
  ['tree_dead_large', 2],
  ['tree_dead_medium', 1],
];
const CRATE_KINDS: [string, number][] = [
  ['crates_stacked', 2],
  ['box_stacked', 1],
];

// Tile one thin wall segment into near-8u wall modules (the remainder is
// spread evenly so runs stay flush with the segment ends: door and gate
// edges are collider edges and must match exactly).
function tileWallSegment(
  out: BgModulePlacement[],
  s: BgWallSeg,
  kinds: [string, number][],
  heightLevels: number[] | null,
  baseYScale: number = BG_WALL_Y_SCALE,
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
      ? baseYScale * heightLevels[Math.floor(hash2(z, x * 7.3) * heightLevels.length)]
      : baseYScale;
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
  const accents: BgModulePlacement[] = [];
  for (let z = -(BG_HALF_Z - FLOOR_CELL / 2); z <= BG_HALF_Z - FLOOR_CELL / 2; z += FLOOR_CELL) {
    for (let x = -(BG_HALF_X - FLOOR_CELL / 2); x <= BG_HALF_X - FLOOR_CELL / 2; x += FLOOR_CELL) {
      const zone = bgZoneAt(z);
      floors.push({
        kind: pickKind(FLOOR_KINDS_BY_ZONE[zone], hash2(x * 1.31, z)),
        x,
        y: BG_FLOOR_Y,
        z,
        ry: Math.floor(hash2(z, x) * 4) * QUARTER,
        scale: [1, 1, 1],
      });
      // rubble/overgrowth only inside the courtyard band, clear of the rune
      // pads (clearance measured at the JITTERED spot, the real position)
      if (zone === 'mid' && hash2(x * 3.7, z * 1.9) < ACCENT_CHANCE) {
        const jx = (hash2(x, z * 5.1) - 0.5) * 1.6;
        const jz = (hash2(x * 5.3, z) - 0.5) * 1.6;
        const nearRune = [...BG_SPEED_RUNES, ...BG_POWER_RUNES].some(
          (r) => Math.hypot(r.x - (x + jx), r.z - (z + jz)) < ACCENT_CLEARANCE,
        );
        if (!nearRune) {
          accents.push({
            kind: pickKind(ACCENT_KINDS, hash2(x * 7.7, z * 2.3)),
            x: x + jx,
            y: BG_FLOOR_Y + ACCENT_Y_LIFT,
            z: z + jz,
            ry: Math.floor(hash2(z * 3.1, x) * 4) * QUARTER,
            scale: [ACCENT_SCALE, 1, ACCENT_SCALE],
          });
        }
      }
    }
  }

  const walls: BgModulePlacement[] = [];
  const ruin: BgModulePlacement[] = [];
  for (const s of battlegroundWallSegments()) {
    if (isRuinBlock(s)) {
      for (const edge of ruinShellSegments(s)) {
        tileWallSegment(ruin, edge, RUIN_KINDS, RUIN_HEIGHT_LEVELS);
      }
    } else if (s.fence) {
      // Fixed kind (the mirrored-dressing rule): both plots rail identically.
      tileWallSegment(walls, s, BARRICADE_KINDS, null, BG_FENCE_Y_SCALE);
    } else if (s.low) {
      tileWallSegment(walls, s, BARRICADE_KINDS, null, BG_LOW_WALL_Y_SCALE);
    } else if (BG_GATEHOUSE_WALLS.includes(s)) {
      tileWallSegment(walls, s, GATEHOUSE_KINDS, null);
    } else if (BG_CURTAIN_WALLS.includes(s)) {
      tileWallSegment(walls, s, CURTAIN_KINDS, null);
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

  const runePads = [...BG_SPEED_RUNES, ...BG_POWER_RUNES].map((r) => ({ x: r.x, z: r.z }));

  // Keep-wall banner dressing + the torch-lit ramparts. Everything derives
  // from the base/team geometry, so the two ends mirror exactly (color aside).
  const wallBanners: BgModulePlacement[] = [];
  const torches: BgModulePlacement[] = [];
  for (const base of BG_BASES) {
    const dir = base.team === 0 ? -1 : 1;
    const kinds = KEEP_BANNER_KINDS[base.team];
    const backZ = base.flag.z + dir * KEEP_BACK_DZ;
    const innerBackZ = backZ - dir * BANNER_WALL_INSET;
    const faceField = dir === -1 ? 0 : Math.PI; // cloth faces mid-field
    for (const bx of KEEP_BANNER_XS) {
      wallBanners.push({
        kind: bx === 0 ? kinds.center : kinds.side,
        x: bx,
        y: 0,
        z: innerBackZ,
        ry: faceField,
        scale: [BANNER_MODULE_SCALE, BANNER_MODULE_SCALE, BANNER_MODULE_SCALE],
      });
    }
    // shield banners greet the attacker just inside the mouth, hung ON the
    // side-wall inner faces (they used to stand free in the opening itself,
    // which read as misplaced set dressing rather than a hung banner)
    const mouthZ = base.flag.z - dir * KEEP_MOUTH_DZ;
    const jambZ = mouthZ + dir * 1.6; // one step inside, on the side-wall span
    for (const sx of [-1, 1]) {
      wallBanners.push({
        kind: kinds.mouth,
        x: sx * (KEEP_HALF_X - BANNER_WALL_INSET),
        y: 0,
        z: jambZ,
        ry: sx === -1 ? Math.PI / 2 : -Math.PI / 2, // cloth faces into the keep
        scale: [BANNER_MODULE_SCALE, BANNER_MODULE_SCALE, BANNER_MODULE_SCALE],
      });
    }
    for (const tx of TORCH_KEEP_XS) {
      torches.push({
        kind: 'torch_mounted',
        x: tx,
        y: 0,
        z: innerBackZ,
        ry: faceField,
        scale: [TORCH_MODULE_SCALE, TORCH_MODULE_SCALE, TORCH_MODULE_SCALE],
      });
    }
    // Each team's colors also dress the FIELD side of its own curtain wall
    // (a thin banner mid-run, shields at the main-gate jambs), so the three
    // chambers read as places: your field wears your colors, the courtyard
    // between wears none. Positions are the exact point mirrors: the south
    // curtain carries red at x -5 (run center), 3 and 13 (gate jambs), the
    // north curtain carries blue at 5, -3 and -13.
    const curtainZ = dir * (BG_CURTAIN_Z + BANNER_WALL_INSET);
    const faceOwnField = dir === -1 ? Math.PI : 0; // cloth faces the team's field
    // The gate-jamb shields sit two yards INTO the solid runs (hugging the
    // exact gate edges left them reading detached beside the opening).
    const curtainSpots: { x: number; kind: string }[] = [
      { x: -5, kind: kinds.side },
      { x: 5, kind: kinds.mouth },
      { x: 21, kind: kinds.mouth },
    ];
    for (const spot of curtainSpots) {
      wallBanners.push({
        kind: spot.kind,
        x: base.team === 0 ? spot.x : -spot.x,
        y: 0,
        z: curtainZ,
        ry: faceOwnField,
        scale: [BANNER_MODULE_SCALE, BANNER_MODULE_SCALE, BANNER_MODULE_SCALE],
      });
    }
  }
  for (const sx of [-1, 1]) {
    const wallX = sx * (BG_HALF_X - TORCH_WALL_INSET);
    for (const tz of TORCH_SIDE_ZS) {
      torches.push({
        kind: 'torch_mounted',
        x: wallX,
        y: 0,
        z: tz,
        ry: sx === -1 ? Math.PI / 2 : -Math.PI / 2, // face into the field
        scale: [TORCH_MODULE_SCALE, TORCH_MODULE_SCALE, TORCH_MODULE_SCALE],
      });
    }
  }
  // The contested crossings get their own light (playtest polish): two
  // torches inside each gatehouse room on its outer-wall inner face (the
  // ambush corners read instead of sitting in murk), and a pair on the sealed
  // rampart-side curtain run's field face. Every placement below is written
  // for the SOUTH side and point-mirrored ((x,z) -> (-x,-z)), so neither
  // team's approach is better lit.
  const CROSSING_TORCHES: { x: number; z: number; ry: number }[] = [
    // south gatehouse (room x -32..-20, z -65..-47): west-wall inner face
    // (inset measures from the wall CENTRE at x -33, landing ON the face)
    { x: -33 + TORCH_WALL_INSET, z: -52, ry: Math.PI / 2 },
    { x: -33 + TORCH_WALL_INSET, z: -61, ry: Math.PI / 2 },
    // the sealed rampart-side curtain run (x 18..49 at z -56): field face
    { x: 36.5, z: -(BG_CURTAIN_Z + TORCH_WALL_INSET), ry: 0 },
    { x: 44.5, z: -(BG_CURTAIN_Z + TORCH_WALL_INSET), ry: 0 },
  ];
  for (const t of CROSSING_TORCHES) {
    for (const m of [1, -1]) {
      torches.push({
        kind: 'torch_mounted',
        x: m * t.x,
        y: 0,
        z: m * t.z,
        ry: m === 1 ? t.ry : t.ry + Math.PI,
        scale: [TORCH_MODULE_SCALE, TORCH_MODULE_SCALE, TORCH_MODULE_SCALE],
      });
    }
  }
  // Graveyard dressing: exact point mirrors between the two plots (offsets
  // negated, yaw rotated a half turn), fixed kinds per spot.
  const GRAVE_SPOTS: { dx: number; dz: number; kind: string; y?: number }[] = [
    // two loose rows of stones with dirt patches under the gaps
    { dx: -6.2, dz: -3.8, kind: 'gravestone' },
    { dx: -2.4, dz: -4.2, kind: 'grave_a' },
    { dx: 1.6, dz: -3.6, kind: 'gravemarker_A' },
    { dx: 5.4, dz: -4.1, kind: 'grave_B' },
    { dx: -4.3, dz: -0.4, kind: 'gravemarker_b' },
    { dx: -0.2, dz: -0.8, kind: 'gravestone' },
    { dx: 3.8, dz: -0.2, kind: 'grave_a' },
    { dx: 6.3, dz: 2.9, kind: 'gravemarker_A' },
    { dx: -6.0, dz: 3.2, kind: 'grave_B' },
    { dx: -1.9, dz: 3.4, kind: 'gravemarker_b' },
    { dx: -3.4, dz: -2.3, kind: 'floor_dirt_grave', y: 0.03 },
    { dx: 0.8, dz: -2.1, kind: 'floor_dirt_grave', y: 0.03 },
    { dx: 4.6, dz: -2.4, kind: 'floor_dirt_grave', y: 0.03 },
    { dx: -0.6, dz: 1.6, kind: 'floor_dirt_grave', y: 0.03 },
    // the shrine anchors the far corner, away from the entrance
    { dx: 7.1, dz: -4.6, kind: 'shrine_candles' },
  ];
  // --- Visual-only field dressing (zero colliders, point-mirrored) ----------
  // Everything below is authored for the SOUTH half and mirrored
  // ((x,z) -> (-x,-z), yaw + half turn); team-colored pieces swap kinds.
  const dressing: BgModulePlacement[] = [];
  const pushMirrored = (p: BgModulePlacement, mirrorKind?: string): void => {
    dressing.push(p);
    dressing.push({ ...p, kind: mirrorKind ?? p.kind, x: -p.x, z: -p.z, ry: p.ry + Math.PI });
  };
  // The tree line: pines and dead trees in bands beyond the walls, jittered
  // deterministically, sunk slightly so trunks meet uneven outside ground.
  const treeAt = (bx: number, bz: number): void => {
    const jx = (hash2(bx, bz) - 0.5) * 5;
    const jz = (hash2(bz, bx) - 0.5) * 5;
    const kind = pickKind(DRESSING_TREE_KINDS, hash2(bx * 1.7, bz * 0.9));
    const ts = 1.7 + hash2(bx * 0.31, bz * 2.3) * 0.9;
    pushMirrored({
      kind,
      x: bx + jx,
      y: -0.4,
      z: bz + jz,
      ry: hash2(bx, bz * 3.1) * Math.PI * 2,
      scale: [ts, ts, ts],
    });
  };
  for (let tz = -150; tz <= 150; tz += 11) treeAt(-58, tz); // west band (mirror: east)
  for (let tx = -56; tx <= 56; tx += 11) treeAt(tx, -150); // south band (mirror: north)
  // Wall dressing on the curtains' COURTYARD faces: crossed-sword trophies
  // mid-wall and candle plaques at the wall foot, spaced between the runs.
  const courtZ = -(BG_CURTAIN_Z - 1.1);
  for (const t of [
    { x: -10, y: 0, kind: 'plaque_candles', s: 1.4 },
    { x: -1, y: 3.0, kind: 'sword_shield', s: 1.5 },
    { x: 26, y: 3.0, kind: 'sword_shield', s: 1.5 },
    { x: 44, y: 0, kind: 'plaque_candles', s: 1.4 },
  ]) {
    pushMirrored({ kind: t.kind, x: t.x, y: t.y, z: courtZ, ry: 0, scale: [t.s, t.s, t.s] });
  }
  // Team triple banners flanking each main gate on the courtyard face: the
  // gate reads as a dressed threshold from mid-field (red south, blue north).
  for (const gx of [6.5, 19.5]) {
    pushMirrored(
      { kind: 'banner_triple_red', x: gx, y: 0, z: courtZ, ry: 0, scale: [1.5, 1.5, 1.5] },
      'banner_triple_blue',
    );
  }
  // Courtyard rubble: collapsed-masonry piles hugging the ruin heart and the
  // wall feet; low debris the boots read over, never movement blocking.
  for (const r of [
    { x: 11.5, z: -11.5, kind: 'rubble_large', s: 1.6 },
    { x: -13, z: -9, kind: 'rubble_half', s: 1.5 },
    { x: -20, z: -50, kind: 'rubble_large', s: 1.7 },
    { x: 30, z: -51, kind: 'rubble_half', s: 1.4 },
    { x: 44, z: -24, kind: 'rocks_decorated', s: 1.6 },
    { x: -44, z: -36, kind: 'rubble_half', s: 1.5 },
    { x: 5, z: -30, kind: 'rocks_decorated', s: 1.4 },
    { x: -33, z: -20, kind: 'rocks_decorated', s: 1.5 },
  ]) {
    pushMirrored({
      kind: r.kind,
      x: r.x,
      y: 0,
      z: r.z,
      ry: hash2(r.x, r.z) * Math.PI * 2,
      scale: [r.s, r.s, r.s],
    });
  }
  // Garrison clutter in each keep's back corners, clear of the spawn ring,
  // the banners, and the graveyard mouth.
  for (const c of [
    { x: -13.5, z: -126, kind: 'keg', s: 1.5 },
    { x: 13.4, z: -125.7, kind: 'barrel_large', s: 1.4 },
    { x: 14.3, z: -124.1, kind: 'haybale', s: 1.3 },
  ]) {
    pushMirrored({
      kind: c.kind,
      x: c.x,
      y: 0,
      z: c.z,
      ry: hash2(c.x, c.z) * Math.PI * 2,
      scale: [c.s, c.s, c.s],
    });
  }

  const graves: BgModulePlacement[] = [];
  for (const base of BG_BASES) {
    const plot = BG_GRAVEYARDS[base.team];
    const m = base.team === 0 ? 1 : -1;
    for (const spot of GRAVE_SPOTS) {
      graves.push({
        kind: spot.kind,
        x: plot.x + m * spot.dx,
        y: spot.y ?? 0,
        z: plot.z + m * spot.dz,
        ry: base.team === 0 ? 0 : Math.PI,
        scale: [GRAVE_MODULE_SCALE, GRAVE_MODULE_SCALE, GRAVE_MODULE_SCALE],
      });
    }
  }

  return {
    floors,
    walls,
    ruin,
    pillars,
    crates,
    banners,
    flagPedestals,
    runePads,
    accents,
    wallBanners,
    torches,
    graves,
    dressing,
  };
}
