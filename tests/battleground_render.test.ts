// Headless pins for the Ravenrift battleground RENDER manifest
// (src/render/battleground_core.ts): the pure placement record the Three
// builder (src/render/battleground.ts) instantiates verbatim. The manifest
// derives from src/sim/battleground_layout.ts, the SAME record the collider
// set reads, so these pins are the see-what-you-collide-with guarantee:
// every solid wall segment yields wall modules, the postern gaps stay open,
// the heart ruin renders hollow over its solid collider footprint, and the
// field's dressing (rune pads, flag pedestals, banners) is present and
// point-symmetric like the layout itself.
import { describe, expect, it } from 'vitest';
import {
  BG_BANNER_FLANK_DX,
  BG_LOW_WALL_Y_SCALE,
  BG_WALL_Y_SCALE,
  BG_ZONE_MID_HALF_Z,
  type BgModulePlacement,
  battlegroundRenderManifest,
  bgZoneAt,
  isRuinBlock,
} from '../src/render/battleground_core';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_KEEP_BARRICADES,
  BG_POSTERN_GAP,
  BG_SPEED_RUNES,
  BG_WALL_T,
  type BgWallSeg,
  battlegroundWallSegments,
} from '../src/sim/battleground_layout';
import { SIGHT_HEIGHT } from '../src/sim/colliders';

// KayKit wall module is 4u long and 4u tall at scale 1 (dungeon.ts convention),
// so scale[0] * 4 is a module's run length and scale[1] * 4 its height.
const WALL_MODULE_LEN = 4;

function ruinBlock(): BgWallSeg {
  const blocks = battlegroundWallSegments().filter(isRuinBlock);
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

// A placement covers a point when the point lies inside the module's own
// footprint along its run axis (ry quarter-turn: local x maps to world z).
function moduleSpan(p: BgModulePlacement): { min: number; max: number; axis: 'x' | 'z' } {
  const half = (p.scale[0] * WALL_MODULE_LEN) / 2;
  const alongZ = Math.abs(Math.sin(p.ry)) > 0.5;
  return alongZ
    ? { min: p.z - half, max: p.z + half, axis: 'z' }
    : { min: p.x - half, max: p.x + half, axis: 'x' };
}

describe('battleground render manifest derives from the layout', () => {
  const m = battlegroundRenderManifest();

  it('every solid wall segment yields wall modules covering its full run', () => {
    const solid = battlegroundWallSegments().filter((s) => !isRuinBlock(s));
    expect(solid.length).toBeGreaterThan(0);
    for (const s of solid) {
      const alongZ = s.hd >= s.hw;
      const lo = alongZ ? s.z - s.hd : s.x - s.hw;
      const hi = alongZ ? s.z + s.hd : s.x + s.hw;
      // Modules whose center sits on this segment's centerline.
      const mods = m.walls.filter((p) => (alongZ ? p.x === s.x : p.z === s.z));
      const covering = mods.filter((p) => {
        const span = moduleSpan(p);
        return span.min >= lo - 1e-6 && span.max <= hi + 1e-6;
      });
      expect(covering.length, `segment at (${s.x}, ${s.z})`).toBeGreaterThan(0);
      // The tiled modules jointly span the segment end to end.
      const min = Math.min(...covering.map((p) => moduleSpan(p).min));
      const max = Math.max(...covering.map((p) => moduleSpan(p).max));
      expect(min, `segment start at (${s.x}, ${s.z})`).toBeCloseTo(lo, 6);
      expect(max, `segment end at (${s.x}, ${s.z})`).toBeCloseTo(hi, 6);
    }
  });

  it('keeps the postern gap columns open: no wall module inside the gap span', () => {
    for (const base of BG_BASES) {
      // The postern wall column: Crimson's west (x=-14), Azure's east (x=+14),
      // recovered from the layout (the segment column split into TWO runs).
      const sideX = base.team === 0 ? -14 : 14;
      const column = battlegroundWallSegments().filter(
        (s) => !isRuinBlock(s) && s.x === sideX && Math.sign(s.z) === Math.sign(base.flag.z),
      );
      expect(column.length, `team ${base.team} postern column`).toBe(2);
      const [a, b] = [...column].sort((s1, s2) => s1.z - s2.z);
      const gapLo = a.z + a.hd;
      const gapHi = b.z - b.hd;
      expect(gapHi - gapLo).toBeCloseTo(BG_POSTERN_GAP, 6);
      const intruders = [...m.walls, ...m.ruin].filter((p) => {
        if (p.x !== sideX) return false;
        const span = moduleSpan(p);
        return span.max > gapLo + 1e-6 && span.min < gapHi - 1e-6;
      });
      expect(intruders, `team ${base.team} postern gap must stay open`).toEqual([]);
    }
  });

  it('renders the heart ruin hollow: shell on the footprint, nothing inside', () => {
    const block = ruinBlock();
    expect(m.ruin.length).toBeGreaterThan(0);
    // Nothing (shell or ordinary wall) sits strictly inside the open interior.
    const inLo = { x: block.hw - 2 * BG_WALL_T, z: block.hd - 2 * BG_WALL_T };
    const intruders = [...m.ruin, ...m.walls].filter(
      (p) => Math.abs(p.x - block.x) < inLo.x - 1e-6 && Math.abs(p.z - block.z) < inLo.z - 1e-6,
    );
    expect(intruders).toEqual([]);
    // The shell keeps the collider's exact footprint: every module inside the
    // block's bounds, and the outer faces reached on all four sides.
    for (const p of m.ruin) {
      expect(Math.abs(p.x - block.x)).toBeLessThanOrEqual(block.hw);
      expect(Math.abs(p.z - block.z)).toBeLessThanOrEqual(block.hd);
    }
    expect(Math.max(...m.ruin.map((p) => p.z))).toBeCloseTo(block.z + block.hd - BG_WALL_T, 6);
    expect(Math.min(...m.ruin.map((p) => p.z))).toBeCloseTo(block.z - block.hd + BG_WALL_T, 6);
    expect(Math.max(...m.ruin.map((p) => p.x))).toBeCloseTo(block.x + block.hw - BG_WALL_T, 6);
    expect(Math.min(...m.ruin.map((p) => p.x))).toBeCloseTo(block.x - block.hw + BG_WALL_T, 6);
  });

  it('places a rune pad at every speed rune and a pedestal at both flags', () => {
    expect(m.runePads).toEqual(BG_SPEED_RUNES.map((r) => ({ x: r.x, z: r.z })));
    expect(m.flagPedestals).toHaveLength(2);
    for (const base of BG_BASES) {
      expect(m.flagPedestals).toContainEqual({
        team: base.team,
        x: base.flag.x,
        z: base.flag.z,
      });
      // Two banner poles flank each keep's banner point.
      const poles = m.banners.filter((b) => b.team === base.team);
      expect(poles.map((b) => b.x).sort((x1, x2) => x1 - x2)).toEqual([
        base.banner.x - BG_BANNER_FLANK_DX,
        base.banner.x + BG_BANNER_FLANK_DX,
      ]);
      for (const pole of poles) expect(pole.z).toBe(base.banner.z);
    }
  });

  it('places the cover pillars and crates from the layout', () => {
    expect(m.pillars.map((p) => ({ x: p.x, z: p.z }))).toEqual(
      BG_COVER_PILLARS.map((p) => ({ x: p.x, z: p.z })),
    );
    expect(m.pillars.every((p) => p.kind === 'pillar')).toBe(true);
    expect(m.crates.map((c) => ({ x: c.x, z: c.z }))).toEqual(
      BG_COVER_CRATES.map((c) => ({ x: c.x, z: c.z })),
    );
    expect(m.crates.every((c) => c.kind === 'crates_stacked' || c.kind === 'box_stacked')).toBe(
      true,
    );
  });

  it('is point-symmetric under (x,z) -> (-x,-z) for the wall placements', () => {
    // The layout mirrors the two halves of the field, so the tiled wall
    // transforms must mirror too (kinds may differ: they are hash-varied
    // cosmetics). Ruin heights are hash-varied, so the shell mirrors on
    // position only.
    const key = (p: BgModulePlacement): string =>
      `${p.x.toFixed(4)}|${p.z.toFixed(4)}|${p.scale.map((s) => s.toFixed(4)).join(',')}`;
    const wallKeys = new Set(m.walls.map(key));
    for (const p of m.walls) {
      const mirrored = key({ ...p, x: -p.x, z: -p.z });
      expect(wallKeys.has(mirrored), `mirror of wall at (${p.x}, ${p.z})`).toBe(true);
    }
    const ruinPos = new Set(m.ruin.map((p) => `${p.x.toFixed(4)}|${p.z.toFixed(4)}`));
    for (const p of m.ruin) {
      expect(ruinPos.has(`${(-p.x).toFixed(4)}|${(-p.z).toFixed(4)}`)).toBe(true);
    }
  });

  it('keeps floor tiles inside the walled field and wall heights on the collider height', () => {
    expect(m.floors.length).toBeGreaterThan(0);
    for (const f of m.floors) {
      expect(Math.abs(f.x)).toBeLessThan(34);
      expect(Math.abs(f.z)).toBeLessThan(60);
    }
    // Solid walls render at the collider's full height, EXCEPT the low mouth
    // barricades, which render at half height (their collider tops match).
    const isBarricadeModule = (p: BgModulePlacement) =>
      BG_KEEP_BARRICADES.some(
        (b) => p.z === b.z && Math.abs(p.x - b.x) <= b.hw && (b.low ?? false),
      );
    const lowMods = m.walls.filter((p) => p.scale[1] === BG_LOW_WALL_Y_SCALE);
    // exactly two modules per barricade, nothing else low, and the mirrored
    // barricades dress identically (one fixed rubble kind, no hash coin-flip)
    expect(lowMods).toHaveLength(4);
    for (const p of lowMods) {
      expect(isBarricadeModule(p)).toBe(true);
      expect(p.kind).toBe('wall_cracked');
    }
    for (const p of m.walls) {
      expect(p.scale[1]).toBe(isBarricadeModule(p) ? BG_LOW_WALL_Y_SCALE : BG_WALL_Y_SCALE);
    }
    expect(BG_LOW_WALL_Y_SCALE).toBeLessThan(BG_WALL_Y_SCALE);
    // the low render height still tops out above the spell sight line, so a
    // barricade that blocks casts is never drawn short enough to see over
    expect(BG_LOW_WALL_Y_SCALE * WALL_MODULE_LEN).toBeGreaterThan(SIGHT_HEIGHT);
    for (const p of m.ruin) {
      expect(p.scale[1]).toBeGreaterThan(0);
      expect(p.scale[1]).toBeLessThanOrEqual(BG_WALL_Y_SCALE);
    }
  });
});

describe('zone theming (visual only; colliders never move)', () => {
  const m = battlegroundRenderManifest();
  const dirtShare = (floors: { kind: string }[]) =>
    floors.filter((f) => f.kind.startsWith('floor_dirt')).length / Math.max(1, floors.length);

  it('the mid ruin belt is decisively more broken than the keep grounds', () => {
    const mid = m.floors.filter((f) => bgZoneAt(f.z) === 'mid');
    const keep = m.floors.filter((f) => bgZoneAt(f.z) === 'keep');
    expect(mid.length).toBeGreaterThan(0);
    expect(keep.length).toBeGreaterThan(0);
    expect(dirtShare(mid)).toBeGreaterThan(dirtShare(keep) + 0.2);
  });

  it('rubble accents stay inside the mid belt and clear of every rune pad', () => {
    expect(m.accents.length).toBeGreaterThan(10);
    for (const a of m.accents) {
      expect(Math.abs(a.z)).toBeLessThanOrEqual(BG_ZONE_MID_HALF_Z + 1);
      for (const r of m.runePads) {
        expect(Math.hypot(r.x - a.x, r.z - a.z)).toBeGreaterThan(1.4);
      }
    }
  });

  it('torches are point-symmetric, so neither approach is better lit', () => {
    const key = (x: number, z: number) => `${x.toFixed(2)}|${z.toFixed(2)}`;
    const set = new Set(m.torches.map((t) => key(t.x, t.z)));
    for (const t of m.torches) {
      expect(set.has(key(-t.x, -t.z)), `torch at (${t.x},${t.z}) has no mirror`).toBe(true);
    }
    expect(m.torches.length).toBeGreaterThanOrEqual(12);
  });

  it('keep banner dressing mirrors exactly between the teams, colors aside', () => {
    const red = m.wallBanners.filter((b) => b.kind.endsWith('_red'));
    const blue = m.wallBanners.filter((b) => b.kind.endsWith('_blue'));
    expect(red.length + blue.length).toBe(m.wallBanners.length); // team kinds only
    expect(red.length).toBe(blue.length);
    // every red banner has the point-mirrored blue twin of the matching family
    const family = (k: string) => k.replace(/_(red|blue)$/, '');
    const blueSet = new Set(
      blue.map((b) => `${family(b.kind)}|${(-b.x).toFixed(2)}|${(-b.z).toFixed(2)}`),
    );
    for (const b of red) {
      expect(
        blueSet.has(`${family(b.kind)}|${b.x.toFixed(2)}|${b.z.toFixed(2)}`),
        `red ${b.kind} at (${b.x},${b.z}) has no mirrored blue twin`,
      ).toBe(true);
    }
    // red dresses the south keep, blue the north
    for (const b of red) expect(b.z).toBeLessThan(0);
    for (const b of blue) expect(b.z).toBeGreaterThan(0);
  });
});
