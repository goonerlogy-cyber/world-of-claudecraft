import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CAMERA_FAR,
  createFarTileBuilder,
  detailCullFar,
  FAR_MESH_DROP,
  FAR_TILE_REVEAL_MARGIN,
  FAR_TILE_SIZE,
  FAR_WORLD_MARGIN,
  type FarTile,
  farGridIndices,
  farGridSide,
  farGroundColor,
  farTileBuildOrder,
  farTileCoveredByDetail,
  farTileVisible,
  farVistaPlan,
  planFarTiles,
  srgbHexToLinear,
  vistaFogFar,
} from '../src/render/far_terrain_core';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../src/sim/data';
import { terrainHeight } from '../src/sim/world';

const SEED = 20061; // the fixed built-in world seed (src/main.ts)
const MAX_OUTDOOR = 850; // zone_streaming.ts envelope

// The whole-world diagonal the vista must cover for "see the whole game".
const WORLD_DIAGONAL = Math.hypot(WORLD_MAX_X - WORLD_MIN_X, WORLD_MAX_Z - WORLD_MIN_Z);

describe('farVistaPlan: per-tier vista envelopes', () => {
  it('low tier and constrained devices keep the classic renderer exactly', () => {
    for (const plan of [
      farVistaPlan('low', false),
      farVistaPlan('low', true),
      farVistaPlan('high', true),
      farVistaPlan('ultra', true),
    ]) {
      expect(plan.enabled).toBe(false);
      expect(plan.cameraFar).toBe(CLASSIC_CAMERA_FAR);
    }
  });

  it('high and ultra see the whole world: envelope beats the map diagonal', () => {
    for (const tier of ['high', 'ultra'] as const) {
      const plan = farVistaPlan(tier, false);
      expect(plan.enabled).toBe(true);
      expect(plan.envelopeFar).toBeGreaterThanOrEqual(WORLD_DIAGONAL);
      expect(plan.cameraFar).toBeGreaterThan(plan.envelopeFar);
    }
  });

  it('medium opens a shorter vista, still far past the classic envelope', () => {
    const plan = farVistaPlan('medium', false);
    expect(plan.enabled).toBe(true);
    expect(plan.envelopeFar).toBeGreaterThan(MAX_OUTDOOR * 2);
    expect(plan.envelopeFar).toBeLessThan(farVistaPlan('high', false).envelopeFar);
  });

  it('every enabled spacing divides the tile size (shared-edge grid, no cracks)', () => {
    for (const tier of ['medium', 'high', 'ultra'] as const) {
      const plan = farVistaPlan(tier, false);
      expect(FAR_TILE_SIZE % plan.spacing).toBe(0);
    }
  });
});

describe('vistaFogFar: open-sky realms take the vista, murk realms keep their signature', () => {
  const ENVELOPE = 3200;

  it('a preset authored at the classic envelope reaches the full vista', () => {
    expect(vistaFogFar(850, ENVELOPE, MAX_OUTDOOR)).toBe(ENVELOPE);
  });

  it('the marsh (110) keeps its murk: it opens by a sliver, never proportionally', () => {
    const far = vistaFogFar(110, ENVELOPE, MAX_OUTDOOR);
    expect(far).toBeGreaterThan(110);
    expect(far).toBeLessThan(110 * 1.35);
  });

  it('the clearest authored realms (the Galecrest, 645) open most of the way', () => {
    const far = vistaFogFar(645, ENVELOPE, MAX_OUTDOOR);
    expect(far).toBeGreaterThan(ENVELOPE * 0.55);
    expect(far).toBeLessThan(ENVELOPE);
  });

  it('is monotonic in the preset distance (a clearer realm never sees less)', () => {
    let prev = 0;
    for (const preset of [90, 110, 225, 285, 360, 375, 405, 495, 510, 600, 630, 645, 850]) {
      const far = vistaFogFar(preset, ENVELOPE, MAX_OUTDOOR);
      expect(far).toBeGreaterThan(prev);
      prev = far;
    }
  });

  it('a disabled vista (envelope at or under the classic cap) is the identity', () => {
    expect(vistaFogFar(510, MAX_OUTDOOR, MAX_OUTDOOR)).toBe(510);
    expect(vistaFogFar(850, 0, MAX_OUTDOOR)).toBe(850);
  });

  it('detailCullFar caps the subsystem view at the classic envelope', () => {
    expect(detailCullFar(3200, MAX_OUTDOOR)).toBe(MAX_OUTDOOR);
    expect(detailCullFar(510, MAX_OUTDOOR)).toBe(510);
  });
});

describe('planFarTiles: the whole grown world, aligned, no gaps', () => {
  const tiles = planFarTiles(WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z);

  it('covers the world rect plus the margin on every side', () => {
    const minX = Math.min(...tiles.map((t) => t.x0));
    const maxX = Math.max(...tiles.map((t) => t.x0 + t.size));
    const minZ = Math.min(...tiles.map((t) => t.z0));
    const maxZ = Math.max(...tiles.map((t) => t.z0 + t.size));
    expect(minX).toBe(WORLD_MIN_X - FAR_WORLD_MARGIN);
    expect(minZ).toBe(WORLD_MIN_Z - FAR_WORLD_MARGIN);
    expect(maxX).toBeGreaterThanOrEqual(WORLD_MAX_X + FAR_WORLD_MARGIN);
    expect(maxZ).toBeGreaterThanOrEqual(WORLD_MAX_Z + FAR_WORLD_MARGIN);
  });

  it('tiles align to one global grid (neighbours share sample columns)', () => {
    for (const tile of tiles) {
      expect((tile.x0 - (WORLD_MIN_X - FAR_WORLD_MARGIN)) % FAR_TILE_SIZE).toBe(0);
      expect((tile.z0 - (WORLD_MIN_Z - FAR_WORLD_MARGIN)) % FAR_TILE_SIZE).toBe(0);
    }
    const keys = new Set(tiles.map((t) => `${t.x0}:${t.z0}`));
    expect(keys.size).toBe(tiles.length);
  });

  it('stays a few dozen frustum-cullable draws, not hundreds', () => {
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.length).toBeLessThan(80);
  });

  it('build order walks outward from the priority point', () => {
    const order = farTileBuildOrder(tiles, 0, 0);
    expect(order.length).toBe(tiles.length);
    const d = (i: number) => tiles[order[i]].cx ** 2 + tiles[order[i]].cz ** 2;
    for (let i = 1; i < order.length; i++) {
      expect(d(i)).toBeGreaterThanOrEqual(d(i - 1));
    }
  });
});

describe('far tile visibility: covered tiles hide, everything else survives to the frustum', () => {
  // A synthetic 2x2 zone partition of a 0..960 square world.
  const zones = [
    { id: 'a', xMin: 0, xMax: 480, zMin: 0, zMax: 480 },
    { id: 'b', xMin: 480, xMax: 960, zMin: 0, zMax: 480 },
    { id: 'c', xMin: 0, xMax: 480, zMin: 480, zMax: 960 },
    { id: 'd', xMin: 480, xMax: 960, zMin: 480, zMax: 960 },
  ];
  const world = [0, 960, 0, 960] as const;
  const tileAt = (x0: number, z0: number, size = 480): FarTile => ({
    x0,
    z0,
    size,
    cx: x0 + size / 2,
    cz: z0 + size / 2,
  });
  const covered = (tile: FarTile, resident: string[]) =>
    farTileCoveredByDetail(tile, world[0], world[1], world[2], world[3], zones, new Set(resident));

  it('a tile inside the world is covered only when every intersecting zone is resident', () => {
    const inside = tileAt(240, 240); // straddles all four zones
    expect(covered(inside, ['a', 'b', 'c', 'd'])).toBe(true);
    expect(covered(inside, ['a', 'b', 'c'])).toBe(false);
    const single = tileAt(0, 0); // exactly zone a
    expect(covered(single, ['a'])).toBe(true);
    expect(covered(single, [])).toBe(false);
  });

  it('a tile reaching past the world rect keeps its rim and sea band forever', () => {
    expect(covered(tileAt(-480, 0), ['a', 'b', 'c', 'd'])).toBe(false);
    expect(covered(tileAt(720, 720), ['a', 'b', 'c', 'd'])).toBe(false);
  });

  it('a covered tile hides only when its farthest corner sits inside the detail far', () => {
    const tile = tileAt(0, 0);
    // camera at the tile center: the farthest corner is half a diagonal away
    const cornerDist = Math.hypot(240, 240);
    expect(farTileVisible(tile, 240, 240, cornerDist + FAR_TILE_REVEAL_MARGIN + 1, true)).toBe(
      false,
    );
    expect(farTileVisible(tile, 240, 240, cornerDist + FAR_TILE_REVEAL_MARGIN - 60, true)).toBe(
      true,
    );
    // an uncovered tile never hides, whatever the distance
    expect(farTileVisible(tile, 240, 240, 10_000, false)).toBe(true);
  });
});

describe('far grid geometry', () => {
  it('side counts and index buffers are exact for every shipped spacing', () => {
    for (const spacing of [10, 12, 16]) {
      const side = farGridSide(FAR_TILE_SIZE, spacing);
      expect(side).toBe(FAR_TILE_SIZE / spacing + 1);
      const indices = farGridIndices(side);
      expect(indices.length).toBe((side - 1) * (side - 1) * 6);
      let max = 0;
      const seen = new Set<number>();
      for (const i of indices) {
        if (i > max) max = i;
        seen.add(i);
      }
      expect(max).toBe(side * side - 1);
      expect(seen.size).toBe(side * side); // every vertex is referenced
    }
  });

  it('srgbHexToLinear matches the sRGB transfer curve', () => {
    expect(srgbHexToLinear(0xffffff)).toEqual([1, 1, 1]);
    expect(srgbHexToLinear(0x000000)).toEqual([0, 0, 0]);
    const [mid] = srgbHexToLinear(0x808080);
    expect(mid).toBeCloseTo(0.2158, 3);
  });
});

describe('createFarTileBuilder: real heights, deterministic, incremental', () => {
  const tile: FarTile = { x0: -240, z0: -120, size: 480, cx: 0, cz: 120 };
  const SPACING = 24; // coarse test spacing, divides 480

  const buildAll = (rowsPerStep: number) => {
    const b = createFarTileBuilder(tile, SPACING, SEED);
    while (!b.step(rowsPerStep)) {
      // drain
    }
    return b.result();
  };

  it('positions carry the true sim height minus the anti-poke drop', () => {
    const data = buildAll(64);
    const side = farGridSide(tile.size, SPACING);
    expect(data.positions.length).toBe(side * side * 3);
    for (const [ix, iz] of [
      [0, 0],
      [side - 1, 0],
      [7, 13],
      [side - 1, side - 1],
    ]) {
      const vi = (iz * side + ix) * 3;
      const x = tile.x0 + ix * SPACING;
      const z = tile.z0 + iz * SPACING;
      expect(data.positions[vi]).toBe(x);
      expect(data.positions[vi + 2]).toBe(z);
      expect(data.positions[vi + 1]).toBeCloseTo(terrainHeight(x, z, SEED) - FAR_MESH_DROP, 4);
    }
    expect(data.minY).toBeLessThanOrEqual(data.maxY);
  });

  it('a one-row-at-a-time build is byte-identical to a one-shot build', () => {
    const slow = buildAll(1);
    const fast = buildAll(1024);
    expect(slow.positions).toEqual(fast.positions);
    expect(slow.normals).toEqual(fast.normals);
    expect(slow.colors).toEqual(fast.colors);
    expect(slow.indices).toEqual(fast.indices);
  });

  it('colors are finite unit-range linear triples with unit normals', () => {
    const data = buildAll(64);
    for (let i = 0; i < data.colors.length; i++) {
      expect(data.colors[i]).toBeGreaterThanOrEqual(0);
      expect(data.colors[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < data.normals.length; i += 3) {
      const len = Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2]);
      expect(len).toBeCloseTo(1, 3);
      expect(data.normals[i + 1]).toBeGreaterThan(0); // ground never faces down
    }
  });

  it('result() before completion throws instead of returning a half-built tile', () => {
    const b = createFarTileBuilder(tile, SPACING, SEED);
    b.step(1);
    expect(() => b.result()).toThrow();
  });
});

describe('farGroundColor: the far recipe reads like the world it stands in for', () => {
  const color = (x: number, z: number): [number, number, number] => {
    const out: [number, number, number] = [0, 0, 0];
    const h = terrainHeight(x, z, SEED);
    farGroundColor(x, z, h, 0.1, SEED, out);
    return out;
  };

  it('the vale reads green', () => {
    const [r, g, b] = color(60, 40);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('the Frostveil interior reads snow-bright', () => {
    const [r, g, b] = color(-30, 1700);
    expect(r + g + b).toBeGreaterThan(1.2);
    expect(Math.abs(r - b)).toBeLessThan(0.25); // near-neutral white, not green
  });

  it('the world rim fades toward the atmospheric haze tone', () => {
    const rim = color(WORLD_MAX_X + 120, 1200);
    const interior = color(0, 1200);
    // the rim tone is the hazy blue: blue channel dominates its red
    expect(rim[2]).toBeGreaterThan(rim[0]);
    // and it is far from the interior ground color
    const dist = Math.hypot(rim[0] - interior[0], rim[1] - interior[1], rim[2] - interior[2]);
    expect(dist).toBeGreaterThan(0.05);
  });

  it('stays deterministic: same input, same triple', () => {
    expect(color(123, 456)).toEqual(color(123, 456));
  });
});

describe('module purity', () => {
  it('imports no Three, DOM, or painter modules (Node-testable core)', () => {
    const src = readFileSync(new URL('../src/render/far_terrain_core.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from 'three'/);
    expect(src).not.toMatch(/from '\.\/far_terrain'/);
    expect(src).not.toMatch(/document\.|window\./);
  });
});
