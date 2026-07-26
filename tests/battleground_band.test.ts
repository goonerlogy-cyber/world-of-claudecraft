import { describe, expect, it } from 'vitest';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_FLAG_Z,
  BG_HALF_X,
  BG_HALF_Z,
  BG_KEEP_BARRICADES,
  BG_POSTERN_GAP,
  BG_RAMPART_NICHES,
  BG_RUIN_FRAGMENTS,
  BG_SIDE_ROOM_WALLS,
  battlegroundColliders,
  battlegroundWallSegments,
  KEEP_MOUTH_DZ,
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

  it('pins the wall/pillar/crate manifest counts (the v2 recut field)', () => {
    // 4 perimeter + (1 back + 3 side segs) x 2 keeps + 7 cover walls
    // + 4 ruin fragments + 6 side-room walls + 8 niche stubs + 2 barricades
    expect(BG_RUIN_FRAGMENTS).toHaveLength(4);
    expect(BG_SIDE_ROOM_WALLS).toHaveLength(6);
    expect(BG_RAMPART_NICHES).toHaveLength(8);
    expect(BG_KEEP_BARRICADES).toHaveLength(2);
    expect(battlegroundWallSegments()).toHaveLength(4 + 4 * 2 + 7 + 4 + 6 + 8 + 2);
    expect(BG_COVER_PILLARS).toHaveLength(6);
    expect(BG_COVER_CRATES).toHaveLength(6);
  });

  it('only the two mouth barricades are low; every other segment is full height', () => {
    const low = battlegroundWallSegments().filter((s) => s.low);
    expect(low).toEqual(BG_KEEP_BARRICADES);
    for (const b of BG_KEEP_BARRICADES) expect(b.low).toBe(true);
  });
});

describe('Ravenrift v2 routes: side rooms, niches, barricades, ruin fragments', () => {
  const o = battlegroundOrigin(0);
  // Walk a chain of straight legs with body radius 0.5, asserting every leg
  // arrives at its waypoint (so the whole route is genuinely traversable).
  function walk(from: { x: number; z: number }, waypoints: { x: number; z: number }[]) {
    let at = { x: o.x + from.x, z: o.z + from.z };
    for (const wp of waypoints) {
      const res = resolveMovement(SEED, at.x, at.z, o.x + wp.x, o.z + wp.z, 0.5);
      expect(res.x, `leg to (${wp.x}, ${wp.z}) x`).toBeCloseTo(o.x + wp.x, 1);
      expect(res.z, `leg to (${wp.x}, ${wp.z}) z`).toBeCloseTo(o.z + wp.z, 1);
      at = res;
    }
    return at;
  }

  it('the west side room is a through-route: south doorway to north doorway', () => {
    walk({ x: -31.5, z: -16 }, [
      { x: -31.5, z: -10 }, // in through the south doorway
      { x: -32, z: -8 }, // around the ambush crate, hugging the rampart
      { x: -32, z: -4 },
      { x: -31.5, z: 0 },
      { x: -31.5, z: 6 }, // out through the north doorway
    ]);
  });

  it('the east side room mirrors it exactly', () => {
    walk({ x: 31.5, z: 16 }, [
      { x: 31.5, z: 10 },
      { x: 32, z: 8 },
      { x: 32, z: 4 },
      { x: 31.5, z: 0 },
      { x: 31.5, z: -6 },
    ]);
  });

  it('the side-room field wall blocks entry from the field side', () => {
    // straight at the west room's field wall (x = -27, faces at -26/-28)
    const blocked = resolveMovement(SEED, o.x - 22, o.z - 5, o.x - 30, o.z - 5, 0.5);
    expect(blocked.x).toBeGreaterThan(o.x - 26);
  });

  it('the mouth barricade blocks the straight charge and both gaps stay open', () => {
    // Crimson barricade spans x -7..3 at z -43..-41: the flag-line charge stops
    const blocked = resolveMovement(SEED, o.x, o.z - 38, o.x, o.z - 46, 0.5);
    expect(blocked.z).toBeGreaterThan(o.z - 41);
    // postern-side (west) gap: x = -10 threads it
    walk({ x: -10, z: -38 }, [{ x: -10, z: -45 }]);
    // wide (east) gap: x = 8 threads it
    walk({ x: 8, z: -38 }, [{ x: 8, z: -45 }]);
    // the barricade sits field-side of the form-up containment line (the keep
    // interior spans |z| in [BG_FLAG_Z - KEEP_MOUTH_DZ, back wall]), with at
    // least 1yd of clearance so tickCountdown never reads it
    for (const b of BG_KEEP_BARRICADES) {
      expect(Math.abs(b.z) + b.hd).toBeLessThanOrEqual(BG_FLAG_Z - KEEP_MOUTH_DZ - 1);
    }
  });

  it('a rampart niche bay is enterable cover; its stub walls block the wall-hug line', () => {
    // duck into the west bay between the stubs at z -24..-20
    walk({ x: -28, z: -22 }, [{ x: -31.8, z: -22 }]);
    // hugging the rampart straight through the stub is blocked
    const blocked = resolveMovement(SEED, o.x - 31.5, o.z - 28, o.x - 31.5, o.z - 22, 0.5);
    expect(blocked.z).toBeLessThan(o.z - 26);
  });

  it('the ruin fragments thread the tight heart corridor and block their own line', () => {
    // the 2yd corridor between the heart's south face (z=-5) and the fragment
    // foot (z=-7): passable end to end at z=-6
    walk({ x: -8, z: -6 }, [{ x: 2, z: -6 }]);
    // crossing the fragment foot head-on is blocked
    const blocked = resolveMovement(SEED, o.x - 5, o.z - 11, o.x - 5, o.z - 3, 0.5);
    expect(blocked.z).toBeLessThan(o.z - 9.4);
    // the corner slip gap between the two fragment arms is passable
    walk({ x: -11, z: -6 }, [{ x: -6, z: -6 }]);
  });

  it('each flag is reachable from the enemy keep with body radius 0.5, both routes', () => {
    // Route A, mid-field: Crimson flag out the wide mouth gap, up the east
    // lane between the lane walls and the ruin fragments, in through Azure's
    // postern-side mouth gap to the Azure flag.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: 8, z: -46 },
      { x: 8, z: -38 },
      { x: 11, z: -24 },
      { x: 11, z: -8 },
      { x: 11, z: 6 },
      { x: 11, z: 12 },
      { x: 6, z: 20 },
      { x: -5, z: 27 },
      { x: -8, z: 34 },
      { x: -8, z: 44 },
      { x: -6, z: 46 },
      { x: 0, z: BG_FLAG_Z },
    ]);
    // Route B, west flank: out the narrow gap, past the wing baffle, weaving
    // the niche stubs, THROUGH the west side room, and in through Azure's
    // wide western mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: -8, z: -46 },
      { x: -10, z: -44 },
      { x: -10, z: -36 },
      { x: -30.5, z: -34 },
      { x: -31, z: -28 }, // hug the rampart past the wing baffle
      { x: -29, z: -27 }, // step off the wall ahead of the niche stub
      { x: -29, z: -22 },
      { x: -31.8, z: -22 }, // duck into the cover bay
      { x: -29, z: -22 },
      { x: -29, z: -16 },
      { x: -31.5, z: -15 },
      { x: -31.5, z: -10 }, // through the room, south door to north door
      { x: -32, z: -8 },
      { x: -32, z: -4 },
      { x: -31.5, z: 6 },
      { x: -29, z: 12 },
      { x: -29, z: 22 },
      { x: -31.8, z: 22 }, // the northern cover bay
      { x: -29, z: 22 },
      { x: -29, z: 27 },
      { x: -31, z: 29 },
      { x: -31, z: 40 },
      { x: -10, z: 40 },
      { x: -10, z: 46 },
      { x: -4, z: 47 },
      { x: 0, z: BG_FLAG_Z },
    ]);
  });

  it('the form-up spots and spawn rings stay walkable under the new geometry', () => {
    for (const base of BG_BASES) {
      for (const sp of base.spawns) {
        // The back-row spawn touches the keep back wall face (a #589-era
        // trait), so allow the face-nudge but never a real embed.
        const p = resolvePosition(SEED, o.x + sp.x, o.z + sp.z, 0.5);
        expect(Math.hypot(p.x - (o.x + sp.x), p.z - (o.z + sp.z))).toBeLessThanOrEqual(0.5 + 1e-6);
      }
    }
    // the mechanics suites stage players at (0, -40): 1yd clear of the barricade
    const p = resolvePosition(SEED, o.x, o.z - 40, 0.5);
    expect(p.x).toBeCloseTo(o.x, 5);
    expect(p.z).toBeCloseTo(o.z - 40, 5);
  });
});
