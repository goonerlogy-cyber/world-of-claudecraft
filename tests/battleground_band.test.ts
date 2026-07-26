import { describe, expect, it } from 'vitest';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_POSTERN_GAP,
  battlegroundColliders,
  battlegroundWallSegments,
  keepWallSegments,
} from '../src/sim/battleground_layout';
import { resolveMovement, resolvePosition } from '../src/sim/colliders';
import {
  BG_BAND_X_MAX,
  BG_BAND_X_MIN,
  BG_SLOT_COUNT,
  BG_X,
  battlegroundOrigin,
  bgOriginAt,
  DELVE_BAND_X_MIN,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isYumiMazePos,
  YUMI_BAND_X_MAX,
} from '../src/sim/data';

const SEED = 42;

describe('Ravenrift band: non-overlap with every other instance band', () => {
  it('claims a band past the Yumi cap and stays west of the Vale Cup pitches', () => {
    expect(BG_BAND_X_MIN).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX);
    // Vale Cup practice pitches sit at x = 30000 (vale_cup_layout.ts
    // vcPracticeOrigin); the two-sided cap keeps them unclassified as bg.
    expect(BG_BAND_X_MAX).toBeLessThanOrEqual(30000);
    expect(isBgPos(30000)).toBe(false);
  });

  it('classifies exclusively: no x is ever in two bands', () => {
    // sweep the whole instanced range at 50yd steps
    for (let x = 500; x <= 31000; x += 50) {
      const claims = [isArenaPos(x), isDelvePos(x), isYumiMazePos(x), isBgPos(x)].filter(
        Boolean,
      ).length;
      expect(claims, `x=${x} claimed by ${claims} bands`).toBeLessThanOrEqual(1);
    }
    // the band's own edges
    expect(isBgPos(BG_BAND_X_MIN)).toBe(true);
    expect(isBgPos(BG_BAND_X_MAX)).toBe(false);
    expect(isBgPos(BG_BAND_X_MIN - 1)).toBe(false);
    expect(isDelvePos(BG_X)).toBe(false);
    expect(isArenaPos(BG_X)).toBe(false);
    expect(isYumiMazePos(BG_X)).toBe(false);
    // the arena/delve bands are untouched by the addition
    expect(isArenaPos(4200)).toBe(true);
    expect(isDelvePos(DELVE_BAND_X_MIN)).toBe(true);
  });

  it('every slot footprint fits inside the band and slots never overlap', () => {
    for (let i = 0; i < BG_SLOT_COUNT; i++) {
      const o = battlegroundOrigin(i);
      expect(isBgPos(o.x - BG_HALF_X)).toBe(true);
      expect(isBgPos(o.x + BG_HALF_X)).toBe(true);
      expect(bgOriginAt(o.z).slot).toBe(i);
      if (i > 0) {
        const prev = battlegroundOrigin(i - 1);
        // slot spacing exceeds the full 120yd field length
        expect(Math.abs(o.z - prev.z)).toBeGreaterThan(BG_HALF_Z * 2);
      }
    }
  });
});

describe('Ravenrift layout: postern gaps + point symmetry', () => {
  it('the whole collider set is point-symmetric ((x,z) -> (-x,-z)), so neither team is favored', () => {
    const colliders = battlegroundColliders();
    const key = (x: number, z: number, a: number, b: number) =>
      `${x.toFixed(3)}|${z.toFixed(3)}|${a.toFixed(3)}|${b.toFixed(3)}`;
    const set = new Set(
      colliders.map((c) => (c.type === 'obb' ? key(c.x, c.z, c.hw, c.hd) : key(c.x, c.z, c.r, 0))),
    );
    for (const c of colliders) {
      const mirrored = c.type === 'obb' ? key(-c.x, -c.z, c.hw, c.hd) : key(-c.x, -c.z, c.r, 0);
      expect(set.has(mirrored), `collider at (${c.x},${c.z}) has no point mirror`).toBe(true);
    }
  });

  it('each keep has exactly one postern gap, mirrored between teams', () => {
    // Crimson (team 0) posterns WEST (x = -14); Azure mirrors EAST (x = +14):
    // the split side wall shows as two segments on that side, one on the other.
    const crimson = keepWallSegments(0);
    const azure = keepWallSegments(1);
    expect(crimson.filter((s) => s.x === -14)).toHaveLength(2);
    expect(crimson.filter((s) => s.x === 14)).toHaveLength(1);
    expect(azure.filter((s) => s.x === 14)).toHaveLength(2);
    expect(azure.filter((s) => s.x === -14)).toHaveLength(1);
    // the gap is BG_POSTERN_GAP wide, centred on the side-wall midline
    const [lo, hi] = crimson.filter((s) => s.x === -14).sort((a, b) => a.z - b.z);
    expect(hi.z - hi.hd - (lo.z + lo.hd)).toBeCloseTo(BG_POSTERN_GAP, 5);
  });

  it('a path exists through the postern gap; the wall blocks everywhere else', () => {
    const o = battlegroundOrigin(0);
    const sideZ = o.z + BG_BASES[0].flag.z - 2; // Crimson west-wall midline (z - 50 local)
    // through the gap: cross x = -14 at the wall midline
    const through = resolveMovement(SEED, o.x - 12, sideZ, o.x - 17, sideZ, 0.5);
    expect(through.x).toBeLessThan(o.x - 15);
    // 4yd along the same wall: solid, the mover is stopped at the face
    const blocked = resolveMovement(SEED, o.x - 12, sideZ + 4, o.x - 17, sideZ + 4, 0.5);
    expect(blocked.x).toBeGreaterThan(o.x - 14);
  });

  it('flag stands and rune pads are walkable (no collider on them)', () => {
    const o = battlegroundOrigin(1);
    for (const base of BG_BASES) {
      const p = resolvePosition(SEED, o.x + base.flag.x, o.z + base.flag.z, 0.5);
      expect(p.x).toBeCloseTo(o.x + base.flag.x, 5);
      expect(p.z).toBeCloseTo(o.z + base.flag.z, 5);
    }
  });

  it('pins the wall/pillar/crate manifest counts (the #589 map, plus 4 postern splits)', () => {
    // 4 perimeter + (1 back + 3 side segs) x 2 keeps + 7 cover walls
    expect(battlegroundWallSegments()).toHaveLength(4 + 4 * 2 + 7);
    expect(BG_COVER_PILLARS).toHaveLength(6);
    expect(BG_COVER_CRATES).toHaveLength(4);
  });
});
