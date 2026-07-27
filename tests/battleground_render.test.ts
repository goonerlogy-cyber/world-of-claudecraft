// Headless pins for the Ravenrift battleground RENDER manifest
// (src/render/battleground_core.ts): the pure placement record the Three
// builder (src/render/battleground.ts) instantiates verbatim. The manifest
// derives from src/sim/battleground_layout.ts, the SAME record the collider
// set reads, so these pins are the see-what-you-collide-with guarantee:
// every solid wall segment yields wall modules, the keep side walls seal solid,
// the heart ruin renders hollow over its solid collider footprint, and the
// field's dressing (rune pads, flag pedestals, banners) is present and
// point-symmetric like the layout itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BG_BANNER_FLANK_DX,
  BG_FENCE_Y_SCALE,
  BG_LOW_WALL_Y_SCALE,
  BG_WALL_Y_SCALE,
  BG_ZONE_KEEP_MIN_Z,
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
  BG_GATEHOUSE_WALLS,
  BG_GRAVEYARD_FENCES,
  BG_KEEP_BARRICADES,
  BG_POWER_RUNES,
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

  it('keeps are sealed: each side-wall column is one solid, gap-free module run', () => {
    for (const base of BG_BASES) {
      for (const sideX of [-16, 16]) {
        // A keep side column: a z-run at x = +/-16 on this keep's half.
        const column = battlegroundWallSegments().filter(
          (s) =>
            !isRuinBlock(s) &&
            s.hd > s.hw && // a z-run: courtyard x-runs sharing the x are not walls of this column
            s.x === sideX &&
            Math.sign(s.z) === Math.sign(base.flag.z),
        );
        expect(column.length, `team ${base.team} side column x=${sideX}`).toBe(1);
        const seg = column[0];
        // The modules tiling that column leave NO gap: sorted spans chain
        // contiguously from the mouth line to the back wall.
        const spans = m.walls
          .filter((p) => p.x === sideX)
          .map(moduleSpan)
          .filter(
            (sp) =>
              sp.axis === 'z' && sp.min >= seg.z - seg.hd - 1e-6 && sp.max <= seg.z + seg.hd + 1e-6,
          )
          .sort((s1, s2) => s1.min - s2.min);
        expect(spans.length, `team ${base.team} side x=${sideX} modules`).toBeGreaterThan(0);
        let cursor = seg.z - seg.hd;
        for (const sp of spans) {
          expect(sp.min, `gap in team ${base.team} side x=${sideX}`).toBeLessThanOrEqual(
            cursor + 1e-6,
          );
          cursor = Math.max(cursor, sp.max);
        }
        expect(cursor, `team ${base.team} side x=${sideX} reaches the back wall`).toBeCloseTo(
          seg.z + seg.hd,
          6,
        );
      }
    }
  });

  it('leaves every curtain crossing open and dresses the gatehouses in one kind', () => {
    // no wall or ruin module may intrude into a crossing span on the curtain
    // line (the render-side twin of the sealed-keep pin)
    const crossings: { z: number; lo: number; hi: number }[] = [
      { z: -56, lo: -34, hi: -18 }, // south gatehouse span (its room walls own it)
      { z: -56, lo: 8, hi: 18 }, // south main gate
      { z: 56, lo: 18, hi: 34 }, // north mirrors
      { z: 56, lo: -18, hi: -8 },
    ];
    for (const c of crossings) {
      const intruders = [...m.walls, ...m.ruin].filter((p) => {
        if (p.z !== c.z) return false;
        const span = moduleSpan(p);
        return span.max > c.lo + 1e-6 && span.min < c.hi - 1e-6;
      });
      expect(intruders, `crossing at z=${c.z}, x ${c.lo}..${c.hi}`).toEqual([]);
    }
    // gatehouse walls dress in the one fixed kind, so the mirrored landmark
    // pair always reads identically (never a hash coin-flip)
    for (const s of BG_GATEHOUSE_WALLS) {
      const alongZ = s.hd >= s.hw;
      const mods = m.walls.filter((p) =>
        alongZ
          ? p.x === s.x && Math.abs(p.z - s.z) <= s.hd
          : p.z === s.z && Math.abs(p.x - s.x) <= s.hw,
      );
      expect(mods.length, `gatehouse wall at (${s.x}, ${s.z})`).toBeGreaterThan(0);
      for (const p of mods) expect(p.kind).toBe('wall');
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

  it('places a rune pad at every rune (speed + power) and a pedestal at both flags', () => {
    expect(m.runePads).toEqual(
      [...BG_SPEED_RUNES, ...BG_POWER_RUNES].map((r) => ({ x: r.x, z: r.z })),
    );
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
      expect(Math.abs(f.x)).toBeLessThan(50);
      expect(Math.abs(f.z)).toBeLessThan(140);
    }
    // Solid walls render at the collider's full height, EXCEPT the low mouth
    // barricades (half height) and the graveyard fence rails (fence height);
    // both collider tops match their render tops.
    const isBarricadeModule = (p: BgModulePlacement) =>
      BG_KEEP_BARRICADES.some(
        (b) => p.z === b.z && Math.abs(p.x - b.x) <= b.hw && (b.low ?? false),
      );
    const isFenceModule = (p: BgModulePlacement) =>
      BG_GRAVEYARD_FENCES.some((f) => Math.abs(p.x - f.x) <= f.hw && Math.abs(p.z - f.z) <= f.hd);
    const lowMods = m.walls.filter((p) => p.scale[1] === BG_LOW_WALL_Y_SCALE);
    // exactly two modules per barricade, nothing else low, and the mirrored
    // barricades dress identically (one fixed rubble kind, no hash coin-flip)
    expect(lowMods).toHaveLength(4);
    for (const p of lowMods) {
      expect(isBarricadeModule(p)).toBe(true);
      expect(p.kind).toBe('wall_cracked');
    }
    const fenceMods = m.walls.filter((p) => p.scale[1] === BG_FENCE_Y_SCALE);
    expect(fenceMods.length).toBeGreaterThanOrEqual(4); // two rails per plot
    for (const p of fenceMods) {
      expect(isFenceModule(p)).toBe(true);
      expect(p.kind).toBe('wall_cracked'); // fixed kind: mirrored plots dress identically
    }
    for (const p of m.walls) {
      expect(p.scale[1]).toBe(
        isBarricadeModule(p)
          ? BG_LOW_WALL_Y_SCALE
          : isFenceModule(p)
            ? BG_FENCE_Y_SCALE
            : BG_WALL_Y_SCALE,
      );
    }
    expect(BG_LOW_WALL_Y_SCALE).toBeLessThan(BG_WALL_Y_SCALE);
    // the low render height still tops out above the spell sight line, so a
    // barricade that blocks casts is never drawn short enough to see over
    expect(BG_LOW_WALL_Y_SCALE * WALL_MODULE_LEN).toBeGreaterThan(SIGHT_HEIGHT);
    // ...and so does the graveyard fence: what blocks a cast is never
    // rendered below the eye line
    expect(BG_FENCE_Y_SCALE * WALL_MODULE_LEN).toBeGreaterThan(SIGHT_HEIGHT);
    // the graveyard dressing mirrors exactly, plot to plot
    const gravePos = new Set(m.graves.map((g) => `${g.x.toFixed(4)}|${g.z.toFixed(4)}`));
    expect(m.graves.length).toBeGreaterThanOrEqual(12);
    for (const g of m.graves) {
      expect(gravePos.has(`${(-g.x).toFixed(4)}|${(-g.z).toFixed(4)}`)).toBe(true);
    }
    for (const p of m.ruin) {
      expect(p.scale[1]).toBeGreaterThan(0);
      expect(p.scale[1]).toBeLessThanOrEqual(BG_WALL_Y_SCALE);
    }
  });
});

describe('the band fog is view distance, tier-identical (source pin)', () => {
  it('the battleground fog branch sets fixed values and reads no tier knob', () => {
    // A tier-conditional fog here would be a live see-farther exploit: pin
    // that the branch is unconditional and its values are the view-distance
    // pair the design names.
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = src.indexOf("desired === 'battleground'");
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, src.indexOf('} else if', start + 1));
    expect(branch).toContain('fog.near = 70');
    expect(branch).toContain('fog.far = 210');
    expect(branch).not.toContain('lowGfx');
    expect(branch).not.toContain('Governor');
  });
});

describe('zone theming (visual only; colliders never move)', () => {
  const m = battlegroundRenderManifest();
  const dirtShare = (floors: { kind: string }[]) =>
    floors.filter((f) => f.kind.startsWith('floor_dirt')).length / Math.max(1, floors.length);

  it('the ruin courtyard is decisively more broken than the keep grounds', () => {
    const mid = m.floors.filter((f) => bgZoneAt(f.z) === 'mid');
    const keep = m.floors.filter((f) => bgZoneAt(f.z) === 'keep');
    expect(mid.length).toBeGreaterThan(0);
    expect(keep.length).toBeGreaterThan(0);
    expect(dirtShare(mid)).toBeGreaterThan(dirtShare(keep) + 0.2);
  });

  it('rubble accents stay inside the courtyard band and clear of every rune pad', () => {
    expect(m.accents.length).toBeGreaterThan(10);
    for (const a of m.accents) {
      expect(Math.abs(a.z)).toBeLessThanOrEqual(BG_ZONE_MID_HALF_Z + 1);
      for (const r of m.runePads) {
        expect(Math.hypot(r.x - a.x, r.z - a.z)).toBeGreaterThan(1.4);
      }
    }
  });

  it('the floor bands land exactly on the chamber lines', () => {
    // rows are 4yd tiles at |z| = 2 + 4k: the courtyard band's outermost row
    // sits just inside the curtain line, the approach band starts just outside
    // it, and the garrison band starts past the keep mouth line. If a zone
    // constant drifts off a wall line (or off the tile grid), this fails.
    const mid = m.floors.filter((f) => bgZoneAt(f.z) === 'mid');
    const approach = m.floors.filter((f) => bgZoneAt(f.z) === 'approach');
    const keep = m.floors.filter((f) => bgZoneAt(f.z) === 'keep');
    expect(Math.max(...mid.map((f) => Math.abs(f.z)))).toBe(BG_ZONE_MID_HALF_Z - 2);
    expect(Math.min(...approach.map((f) => Math.abs(f.z)))).toBe(BG_ZONE_MID_HALF_Z + 2);
    expect(Math.max(...approach.map((f) => Math.abs(f.z)))).toBe(BG_ZONE_KEEP_MIN_Z - 2);
    expect(Math.min(...keep.map((f) => Math.abs(f.z)))).toBe(BG_ZONE_KEEP_MIN_Z + 2);
  });

  it('field dressing is visual-only, mirrored, and placed where it claims', () => {
    expect(m.dressing.length).toBeGreaterThan(60); // the tree line alone is dozens
    // Point symmetry (colors aside: the red/blue triple banners swap kinds).
    const key = (x: number, z: number) => `${x.toFixed(3)}|${z.toFixed(3)}`;
    const set = new Set(m.dressing.map((d) => key(d.x, d.z)));
    for (const d of m.dressing) {
      expect(set.has(key(-d.x, -d.z)), `dressing at (${d.x},${d.z}) has no mirror`).toBe(true);
    }
    // Trees live OUTSIDE the walls (skyline, never field furniture); rubble,
    // trophies, and clutter live INSIDE the perimeter.
    for (const d of m.dressing) {
      const outside = Math.abs(d.x) > 50 || Math.abs(d.z) > 140;
      if (d.kind.startsWith('tree_')) {
        expect(outside, `tree at (${d.x},${d.z}) must sit outside the walls`).toBe(true);
      } else {
        expect(outside, `${d.kind} at (${d.x},${d.z}) must sit inside`).toBe(false);
      }
    }
    // And none of it may share a spot with a collider footprint (visual-only
    // dressing must never suggest cover that does not block): probe centers
    // against the wall segments (trees are outside every wall by the check
    // above; rubble/clutter spots are hand-placed clear).
    for (const d of m.dressing) {
      if (d.kind.startsWith('tree_')) continue;
      for (const w of battlegroundWallSegments()) {
        // Wall-hung cloth deliberately sits AT the face plane (inset 0.78 from
        // a 1.0 half-thickness), so only a truly BURIED center fails here.
        const inside =
          Math.abs(d.x - w.x) < w.hw - 0.35 && Math.abs(d.z - w.z) < w.hd - 0.35 && d.y === 0;
        expect(inside, `${d.kind} at (${d.x},${d.z}) is inside a wall footprint`).toBe(false);
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
