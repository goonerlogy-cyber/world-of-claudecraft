// Pure planning core for the far-vista terrain layer: the whole-world coarse
// mesh that stands in for everything past the detail envelope, so the horizon
// shows real terrain instead of a fog wall.
//
// The layer splits the one fog distance the renderer used to have into two:
// - detail far: what the existing subsystems (terrain chunks, props, town,
//   foliage, water, zone streaming) cull against. Capped at the classic
//   MAX_OUTDOOR_FOG_FAR envelope so their cost model is unchanged.
// - vista far: what scene.fog actually reaches on vista-capable tiers. The
//   far mesh, and only the far mesh, fills the band between the two.
//
// Everything here is host-agnostic math (no Three, no DOM) so a Vitest
// drives every decision directly; the thin painter is far_terrain.ts. The
// color recipe is a cheap re-read of terrain.ts's sampleVertex thresholds
// against the shared terrain_palette.ts data: one terrainHeight tap per
// vertex (slope and normals come from the sampled grid), which is what makes
// a whole-world pass affordable.

import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId } from '../sim/types';
import { terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { BIOME_PALETTE, ROCK_SLOPE_START, TERRAIN_TONES } from './terrain_palette';

/** Square far-mesh tile edge, world units. Divisible by every tier spacing.
 *  Sized so the whole world is about a dozen draws: each tile carries only a
 *  couple thousand triangles, so draw count, not triangle count, is what the
 *  layer must keep small; the camera frustum still culls tile-by-tile. */
export const FAR_TILE_SIZE = 960;

/** How far past the zone-rect world the far mesh extends: covers the rim
 *  mountains' far side and the open sea apron band beyond them. */
export const FAR_WORLD_MARGIN = 600;

/** Vertical drop applied to every far-mesh vertex so the coarse mesh never
 *  pokes through the dense near terrain where the two overlap. */
export const FAR_MESH_DROP = 1.8;

/** Far tiles fully covered by resident near terrain hide once their farthest
 *  corner sits this many units inside the detail far plane. */
export const FAR_TILE_REVEAL_MARGIN = 40;

export interface FarVistaPlan {
  /** false leaves the renderer exactly as it was (low tier, constrained). */
  enabled: boolean;
  /** far-mesh vertex spacing, world units */
  spacing: number;
  /** the vista fog envelope replacing MAX_OUTDOOR_FOG_FAR in scene fog */
  envelopeFar: number;
  /** camera far plane for the tier */
  cameraFar: number;
}

/** Camera far plane when the vista layer is off: the classic constant. */
export const CLASSIC_CAMERA_FAR = 950;

/**
 * Per-tier vista plan. Low and constrained-memory devices keep the classic
 * renderer byte-for-byte (fog wall at the biome preset, camera far 950, no
 * far mesh); medium opens a shorter vista; high and ultra see the whole
 * world (the zone map's diagonal is about 2.9k units).
 */
export function farVistaPlan(
  tier: 'low' | 'medium' | 'high' | 'ultra',
  constrainedMemory: boolean,
): FarVistaPlan {
  if (constrainedMemory || tier === 'low') {
    return { enabled: false, spacing: 0, envelopeFar: 0, cameraFar: CLASSIC_CAMERA_FAR };
  }
  if (tier === 'medium') {
    return { enabled: true, spacing: 16, envelopeFar: 2200, cameraFar: 2600 };
  }
  if (tier === 'high') {
    return { enabled: true, spacing: 12, envelopeFar: 3200, cameraFar: 3600 };
  }
  return { enabled: true, spacing: 10, envelopeFar: 3200, cameraFar: 3600 };
}

/**
 * The vista fog far for one biome preset. Presets authored AT the classic
 * envelope are "open sky" and take the full vista; presets authored short
 * chose an ABSOLUTE murk distance (the marsh's 110, the Wraithwood's 225)
 * that is the realm's signature, so they open up only a little. The curve
 * between the two is the smoothstep of the preset's fraction of the classic
 * envelope: authored-clear realms (fen, jungle, garden, gale) scale most of
 * the way to the vista, authored-murk realms barely move.
 */
export function vistaFogFar(presetFar: number, envelopeFar: number, maxOutdoorFar: number): number {
  if (envelopeFar <= maxOutdoorFar) return presetFar;
  const t = Math.max(0, Math.min(1, presetFar / maxOutdoorFar));
  const s = t * t * (3 - 2 * t);
  const scale = 1 + s * (envelopeFar / maxOutdoorFar - 1);
  return Math.min(envelopeFar, presetFar * scale);
}

/** The fog distance the classic subsystems cull against: scene fog capped at
 *  the classic envelope, so vista fog never widens their workload. */
export function detailCullFar(sceneFogFar: number, maxOutdoorFar: number): number {
  return Math.min(sceneFogFar, maxOutdoorFar);
}

export interface FarTile {
  x0: number;
  z0: number;
  size: number;
  /** tile center */
  cx: number;
  cz: number;
}

/**
 * The far-mesh tile grid: the world rect grown by `margin` on every side,
 * cut into `tileSize` squares aligned to the grown origin. Tiles share edge
 * sample columns with their neighbours (the grid is global), so adjacent
 * tiles meet exactly and need no skirts between them.
 */
export function planFarTiles(
  worldMinX: number,
  worldMaxX: number,
  worldMinZ: number,
  worldMaxZ: number,
  margin: number = FAR_WORLD_MARGIN,
  tileSize: number = FAR_TILE_SIZE,
): FarTile[] {
  const minX = worldMinX - margin;
  const minZ = worldMinZ - margin;
  const tilesX = Math.ceil((worldMaxX + margin - minX) / tileSize);
  const tilesZ = Math.ceil((worldMaxZ + margin - minZ) / tileSize);
  const tiles: FarTile[] = [];
  for (let tz = 0; tz < tilesZ; tz++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = minX + tx * tileSize;
      const z0 = minZ + tz * tileSize;
      tiles.push({ x0, z0, size: tileSize, cx: x0 + tileSize / 2, cz: z0 + tileSize / 2 });
    }
  }
  return tiles;
}

/** Build order: tiles nearest the priority point first, so the world fills
 *  in around the player during the idle-paced boot build. */
export function farTileBuildOrder(tiles: readonly FarTile[], px: number, pz: number): number[] {
  return tiles
    .map((tile, i) => ({ i, d: (tile.cx - px) ** 2 + (tile.cz - pz) ** 2 }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((t) => t.i);
}

export interface RectLike {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  id: string;
}

/**
 * True when the near-detail world fully covers the tile: the tile sits
 * inside the zone-rect world AND every zone rect it intersects is resident.
 * Zone rects partition the world, so intersect-all-resident is an exact
 * coverage test; a tile reaching past the world rect keeps its rim and sea
 * band and is never covered.
 */
export function farTileCoveredByDetail(
  tile: FarTile,
  worldMinX: number,
  worldMaxX: number,
  worldMinZ: number,
  worldMaxZ: number,
  zones: readonly RectLike[],
  residentZoneIds: ReadonlySet<string>,
): boolean {
  const x1 = tile.x0 + tile.size;
  const z1 = tile.z0 + tile.size;
  if (tile.x0 < worldMinX || x1 > worldMaxX || tile.z0 < worldMinZ || z1 > worldMaxZ) {
    return false;
  }
  for (const zone of zones) {
    const intersects =
      zone.xMin < x1 && zone.xMax > tile.x0 && zone.zMin < z1 && zone.zMax > tile.z0;
    if (intersects && !residentZoneIds.has(zone.id)) return false;
  }
  return true;
}

/**
 * Per-frame visibility for one far tile. A tile hides only when the near
 * terrain already covers everything it would draw: its farthest corner is
 * comfortably inside the detail far plane AND its ground is resident. Every
 * other tile stays on and lets the camera frustum cull it.
 */
export function farTileVisible(
  tile: FarTile,
  camX: number,
  camZ: number,
  detailFar: number,
  coveredByDetail: boolean,
): boolean {
  if (!coveredByDetail) return true;
  const half = tile.size / 2;
  const dx = Math.abs(camX - tile.cx) + half;
  const dz = Math.abs(camZ - tile.cz) + half;
  return Math.hypot(dx, dz) >= detailFar - FAR_TILE_REVEAL_MARGIN;
}

/** Vertex count per tile edge for a spacing that divides the tile size. */
export function farGridSide(tileSize: number, spacing: number): number {
  return Math.round(tileSize / spacing) + 1;
}

/**
 * Triangle indices for one tile's regular grid, row-major vertex order,
 * fixed diagonal. Fits Uint16 for every shipped spacing (97x97 max).
 */
export function farGridIndices(side: number): Uint16Array {
  const cells = side - 1;
  const out = new Uint16Array(cells * cells * 6);
  let k = 0;
  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const a = iz * side + ix;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      out[k++] = a;
      out[k++] = c;
      out[k++] = b;
      out[k++] = b;
      out[k++] = c;
      out[k++] = d;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The far color recipe: terrain.ts's sampleVertex thresholds re-read at
// far-mesh scale. Sub-vertex features (roads, hub discs, rock streak grain)
// are deliberately dropped: they are narrower than one far-mesh cell and the
// near terrain owns everything inside the detail envelope anyway.
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

type Triple = [number, number, number];

/** sRGB hex to the linear-srgb triple THREE.Color(hex) resolves to, so far
 *  vertex colors land in the same working space as the near terrain's. */
export function srgbHexToLinear(hex: number): Triple {
  const conv = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [conv((hex >> 16) & 0xff), conv((hex >> 8) & 0xff), conv(hex & 0xff)];
}

interface FarPalette {
  grass: Triple;
  grassDark: Triple;
  grassYellow: Triple;
  dirt: Triple;
  sand: Triple;
}

const zoneFarPalettes: FarPalette[] = ZONES.map((zn) => {
  const p = BIOME_PALETTE[zn.biome];
  return {
    grass: srgbHexToLinear(p.grass),
    grassDark: srgbHexToLinear(p.grassDark),
    grassYellow: srgbHexToLinear(p.grassYellow),
    dirt: srgbHexToLinear(p.dirt),
    sand: srgbHexToLinear(p.sand),
  };
});

const TONE = {
  dirtDark: srgbHexToLinear(TERRAIN_TONES.dirtDark),
  rock: srgbHexToLinear(TERRAIN_TONES.rock),
  wetRock: srgbHexToLinear(TERRAIN_TONES.wetRock),
  hazyPeak: srgbHexToLinear(TERRAIN_TONES.hazyPeak),
  emberForest: srgbHexToLinear(TERRAIN_TONES.emberForest),
  emberScorch: srgbHexToLinear(TERRAIN_TONES.emberScorch),
  snowCap: srgbHexToLinear(TERRAIN_TONES.snowCap),
};

const lerp3 = (out: Triple, to: Triple, t: number): void => {
  if (t <= 0) return;
  out[0] += (to[0] - out[0]) * t;
  out[1] += (to[1] - out[1]) * t;
  out[2] += (to[2] - out[2]) * t;
};

const copy3 = (out: Triple, from: Triple): void => {
  out[0] = from[0];
  out[1] = from[1];
  out[2] = from[2];
};

const farPaletteScratch: FarPalette = {
  grass: [0, 0, 0],
  grassDark: [0, 0, 0],
  grassYellow: [0, 0, 0],
  dirt: [0, 0, 0],
  sand: [0, 0, 0],
};

const stripPalette = (zn: (typeof ZONES)[number]): FarPalette =>
  zoneFarPalettes[ZONES.indexOf(zn)] ?? zoneFarPalettes[0];

/** The same strip-cascade plus column blend paletteAt uses in terrain.ts,
 *  over linear triples. Writes into the module scratch (hot loop). */
function farPaletteAt(x: number, z: number): FarPalette {
  const out = farPaletteScratch;
  const first = stripPalette(STRIP_ZONES[0]);
  copy3(out.grass, first.grass);
  copy3(out.grassDark, first.grassDark);
  copy3(out.grassYellow, first.grassYellow);
  copy3(out.dirt, first.dirt);
  copy3(out.sand, first.sand);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    const next = stripPalette(STRIP_ZONES[i + 1]);
    lerp3(out.grass, next.grass, tt);
    lerp3(out.grassDark, next.grassDark, tt);
    lerp3(out.grassYellow, next.grassYellow, tt);
    lerp3(out.dirt, next.dirt, tt);
    lerp3(out.sand, next.sand, tt);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const p = stripPalette(col);
    lerp3(out.grass, p.grass, t);
    lerp3(out.grassDark, p.grassDark, t);
    lerp3(out.grassYellow, p.grassYellow, t);
    lerp3(out.dirt, p.dirt, t);
    lerp3(out.sand, p.sand, t);
  }
  return out;
}

/** Blend weight of one biome across the same windows the palette fades. */
function biomeWeightAt(biome: BiomeId, x: number, z: number): number {
  let w = STRIP_ZONES[0].biome === biome ? 1 : 0;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((STRIP_ZONES[i + 1].biome === biome ? 1 : 0) - w) * tt;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t > 0) w += ((col.biome === biome ? 1 : 0) - w) * t;
  }
  return w;
}

/** How much forest mass a biome carries on the far mesh: distant hillsides
 *  read as wooded where the decoration field is dense. Purely cosmetic far
 *  paint; the real trees inside the detail envelope are the source of truth. */
const FAR_FOREST_DENSITY: Partial<Record<BiomeId, number>> = {
  vale: 0.5,
  marsh: 0.35,
  peaks: 0.25,
  dusk: 0.42,
  ember: 0.2,
  frost: 0.12,
  amber: 0.45,
  fen: 0.35,
  night: 0.3,
  haunt: 0.62,
  jungle: 0.72,
  garden: 0.4,
  gale: 0.1,
};

/**
 * One far vertex's ground color, written into `out` as a linear-srgb triple.
 * `slope` is height units per world unit, from the caller's sampled grid.
 */
export function farGroundColor(
  x: number,
  z: number,
  h: number,
  slope: number,
  seed: number,
  out: Triple,
): void {
  const pal = farPaletteAt(x, z);
  const biome = zoneBiomeAt(x, z);

  // base grass with the same patchy fbm variation the near tint uses
  const v = fbm2(x * 0.045, z * 0.045, seed + 53, 3);
  copy3(out, pal.grass);
  lerp3(out, pal.grassDark, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  lerp3(out, pal.grassYellow, v2 * 0.35);

  if (biome === 'ember') {
    const forest = 1 - clamp01((z - 1925) / 145);
    if (forest > 0) lerp3(out, TONE.emberForest, forest * 0.85);
    const passT = 1 - clamp01((Math.abs(x - 404) - 26) / 26);
    const valley = passT * clamp01((z - 2310) / 80);
    const scorch = clamp01((z - 2260) / 100) * (1 - valley);
    if (scorch > 0) lerp3(out, TONE.emberScorch, scorch * 0.55);
    if (valley > 0) lerp3(out, TONE.emberForest, valley * 0.8);
  }

  // marsh mud: pull the ground toward dark wet earth where the marsh blends in
  const marshW = biomeWeightAt('marsh', x, z);
  if (marshW > 0) lerp3(out, TONE.dirtDark, marshW * 0.45);

  // far forest mass: clumped canopy paint over gentle, dry, low ground
  const shoreH = h - (WATER_LEVEL + 1.6);
  const rockStart = ROCK_SLOPE_START[biome];
  const density = FAR_FOREST_DENSITY[biome] ?? 0.3;
  if (h < 22 && shoreH > 1.2 && slope < rockStart) {
    const clump = fbm2(x * 0.03, z * 0.03, seed + 271, 2);
    const forest = clamp01((clump - 0.45) * 2.4) * density;
    if (forest > 0) {
      const canopy: Triple = [
        pal.grassDark[0] * 0.52,
        pal.grassDark[1] * 0.62,
        pal.grassDark[2] * 0.5,
      ];
      lerp3(out, canopy, forest * 0.85);
    }
  }

  // shoreline band: sand at the waterline (wet rock in the stone biomes)
  const shore = clamp01((WATER_LEVEL + 1.6 - h) / 1.6);
  if (shore > 0) {
    const wetStone = biome === 'peaks' || biome === 'volcano' || biome === 'cave';
    lerp3(out, wetStone ? TONE.wetRock : biome === 'marsh' ? TONE.dirtDark : pal.sand, shore);
  }

  // steep faces shed their cover
  const slopeRock = clamp01((slope - rockStart) * 2);
  if (slopeRock > 0) lerp3(out, TONE.rock, slopeRock);

  // high ground: rock, then a noise-broken snow ramp
  if (h > 22) lerp3(out, TONE.rock, clamp01((h - 22) / 10) * 0.6);
  const snowPatch = fbm2(x * 0.05, z * 0.05, seed + 61, 2);
  const snow = clamp01((h - 34 + (snowPatch - 0.5) * 14) / 26) * 0.85;
  if (snow > 0) lerp3(out, TONE.snowCap, snow);

  // the Frostveil's blanket: snow down to the shore wherever frost blends in
  const frostW = biomeWeightAt('frost', x, z);
  if (frostW > 0) {
    const blanket = clamp01((h - (WATER_LEVEL + 1.2)) / 3) * frostW;
    lerp3(out, TONE.snowCap, blanket * 0.8);
  }

  // world-rim haze: the encircling peaks fade toward atmosphere
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 70),
    WORLD_MIN_Z + 70 - z,
    z - (WORLD_MAX_Z - 70),
  );
  const rim = clamp01(edge / 64);
  if (rim > 0) lerp3(out, TONE.hazyPeak, rim * 0.95);
}

// ---------------------------------------------------------------------------
// Incremental tile builder: samples the padded height grid row by row so the
// painter can spread a whole-world build across idle slots, then emits flat
// typed arrays the painter wraps into a BufferGeometry unchanged.
// ---------------------------------------------------------------------------

export interface FarTileData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  minY: number;
  maxY: number;
}

export interface FarTileBuilder {
  /** Advance up to `rows` grid rows of work; true once the tile is complete. */
  step(rows: number): boolean;
  /** The finished tile. Throws if called before step() returned true. */
  result(): FarTileData;
}

export function createFarTileBuilder(tile: FarTile, spacing: number, seed: number): FarTileBuilder {
  const side = farGridSide(tile.size, spacing);
  const padded = side + 2;
  const heights = new Float32Array(padded * padded);
  const positions = new Float32Array(side * side * 3);
  const normals = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  let heightRow = 0;
  let vertexRow = 0;
  const color: Triple = [0, 0, 0];

  const sampleHeightRow = (): void => {
    const z = tile.z0 + (heightRow - 1) * spacing;
    for (let ix = 0; ix < padded; ix++) {
      heights[heightRow * padded + ix] = terrainHeight(tile.x0 + (ix - 1) * spacing, z, seed);
    }
    heightRow++;
  };

  const emitVertexRow = (): void => {
    const iz = vertexRow;
    const z = tile.z0 + iz * spacing;
    const hRow = (iz + 1) * padded;
    for (let ix = 0; ix < side; ix++) {
      const x = tile.x0 + ix * spacing;
      const hi = hRow + ix + 1;
      const h = heights[hi];
      const hx = heights[hi + 1] - heights[hi - 1];
      const hz = heights[hi + padded] - heights[hi - padded];
      const slope = Math.sqrt(hx * hx + hz * hz) / (2 * spacing);
      const invLen = 1 / Math.hypot(hx / (2 * spacing), 1, hz / (2 * spacing));
      const vi = (iz * side + ix) * 3;
      const y = h - FAR_MESH_DROP;
      positions[vi] = x;
      positions[vi + 1] = y;
      positions[vi + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      normals[vi] = -(hx / (2 * spacing)) * invLen;
      normals[vi + 1] = invLen;
      normals[vi + 2] = -(hz / (2 * spacing)) * invLen;
      farGroundColor(x, z, h, slope, seed, color);
      colors[vi] = color[0];
      colors[vi + 1] = color[1];
      colors[vi + 2] = color[2];
    }
    vertexRow++;
  };

  return {
    step(rows: number): boolean {
      let budget = rows;
      while (budget > 0 && heightRow < padded) {
        sampleHeightRow();
        budget--;
      }
      while (budget > 0 && heightRow >= padded && vertexRow < side) {
        emitVertexRow();
        budget--;
      }
      return heightRow >= padded && vertexRow >= side;
    },
    result(): FarTileData {
      if (heightRow < padded || vertexRow < side) {
        throw new Error('far tile builder not complete');
      }
      return { positions, normals, colors, indices: farGridIndices(side), minY, maxY };
    },
  };
}
