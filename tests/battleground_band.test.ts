import { describe, expect, it } from 'vitest';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_CURTAIN_WALLS,
  BG_FLAG_Z,
  BG_GATEHOUSE_WALLS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_KEEP_BARRICADES,
  BG_POSTERN_GAP,
  BG_WALL_HEIGHT,
  BG_WALL_T,
  battlegroundColliders,
  battlegroundWallSegments,
  KEEP_MOUTH_DZ,
  keepWallSegments,
} from '../src/sim/battleground_layout';
import {
  cameraOcclusion,
  lineOfSightClear,
  resolveMovement,
  resolvePosition,
  SIGHT_HEIGHT,
} from '../src/sim/colliders';
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

  it('pins the wall/pillar/crate manifest counts (the three-chambers field)', () => {
    // 4 perimeter + (1 back + 3 side segs) x 2 keeps + 5 cover walls
    // + 8 curtain segments + 8 gatehouse walls + 2 barricades
    expect(BG_CURTAIN_WALLS).toHaveLength(8);
    expect(BG_GATEHOUSE_WALLS).toHaveLength(8);
    expect(BG_KEEP_BARRICADES).toHaveLength(2);
    expect(battlegroundWallSegments()).toHaveLength(4 + 4 * 2 + 5 + 8 + 8 + 2);
    expect(BG_COVER_PILLARS).toHaveLength(4);
    expect(BG_COVER_CRATES).toHaveLength(6);
  });

  it('only the two mouth barricades are low; every other segment is full height', () => {
    const low = battlegroundWallSegments().filter((s) => s.low);
    expect(low).toEqual(BG_KEEP_BARRICADES);
    for (const b of BG_KEEP_BARRICADES) expect(b.low).toBe(true);
  });

  it('the low flag never changes a collider footprint, only its visual top', () => {
    const segs = battlegroundWallSegments();
    const obbs = battlegroundColliders().filter((c) => c.type === 'obb');
    expect(obbs).toHaveLength(segs.length);
    segs.forEach((s, i) => {
      const c = obbs[i];
      expect([c.x, c.z, c.hw, c.hd]).toEqual([s.x, s.z, s.hw, s.hd]);
      expect(c.cameraTopY).toBe(s.low ? BG_WALL_HEIGHT / 2 : BG_WALL_HEIGHT);
    });
  });

  it('every real wall run is exactly BG_WALL_T thin; the heart is the one thick block', () => {
    const segs = battlegroundWallSegments();
    const thick = segs.filter((s) => Math.min(s.hw, s.hd) > BG_WALL_T);
    expect(thick).toHaveLength(1); // the heart ruin
    for (const s of segs) {
      if (!thick.includes(s)) expect(Math.min(s.hw, s.hd)).toBe(BG_WALL_T);
    }
  });

  it('the chase camera clears what it is visually above; casts stay blocked at eye height', () => {
    const o = battlegroundOrigin(0);
    // below the barricade top (3yd): the camera ray is occluded
    const blockedLow = cameraOcclusion(SEED, o.x, 1.0, o.z - 38, o.x, 1.0, o.z - 46);
    expect(blockedLow).toBeLessThan(1);
    // above the barricade top but below the rampart top: it clears the low wall
    expect(cameraOcclusion(SEED, o.x, 4.0, o.z - 38, o.x, 4.0, o.z - 46)).toBe(1);
    // the full-height heart ruin still occludes at that height, and clears above
    expect(cameraOcclusion(SEED, o.x, 4.0, o.z - 10, o.x, 4.0, o.z + 2)).toBeLessThan(1);
    expect(
      cameraOcclusion(SEED, o.x, BG_WALL_HEIGHT + 1, o.z - 10, o.x, BG_WALL_HEIGHT + 1, o.z + 2),
    ).toBe(1);
    // spell sight runs at eye height and the barricade top stays above it, so
    // a cast straight across the barricade is blocked
    expect(BG_WALL_HEIGHT / 2).toBeGreaterThan(SIGHT_HEIGHT);
    expect(lineOfSightClear(SEED, { x: o.x, z: o.z - 38 }, { x: o.x, z: o.z - 46 })).toBe(false);
    // and an unobstructed lane stays castable
    expect(lineOfSightClear(SEED, { x: o.x - 10, z: o.z - 38 }, { x: o.x - 10, z: o.z - 46 })).toBe(
      true,
    );
  });
});

describe('Ravenrift chamber routes: curtains, gates, gatehouses, barricades', () => {
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

  it('the curtain wall is solid; the main gate and flank arch thread it', () => {
    // straight into the south curtain between the crossings: stopped at its face
    const blocked = resolveMovement(SEED, o.x, o.z - 26, o.x, o.z - 14, 0.5);
    expect(blocked.z).toBeLessThan(o.z - 21.4);
    // the 8yd main gate (x 4..12) passes
    walk({ x: 8, z: -26 }, [{ x: 8, z: -14 }]);
    // the 4yd flank arch (x 26..30) passes
    walk({ x: 28, z: -26 }, [{ x: 28, z: -14 }]);
    // the rampart-side stub is solid
    const stub = resolveMovement(SEED, o.x + 32, o.z - 26, o.x + 32, o.z - 14, 0.5);
    expect(stub.z).toBeLessThan(o.z - 21.4);
    // north curtain mirrors: main gate at x -12..-4, arch at x -30..-26
    walk({ x: -8, z: 26 }, [{ x: -8, z: 14 }]);
    walk({ x: -28, z: 26 }, [{ x: -28, z: 14 }]);
  });

  it('the gatehouse is a jogged through-route; its walls block everything else', () => {
    // in the field door (x -20..-16), west around the ambush crate, out the
    // courtyard door (x -24..-21): the offset-door S-jog
    walk({ x: -18, z: -30 }, [
      { x: -18, z: -24 }, // in through the field-side door
      { x: -21.5, z: -23 }, // jog west around the ambush crate
      { x: -22.5, z: -16 },
      { x: -22.5, z: -12 }, // out through the courtyard-side door
    ]);
    // the crate's own line is a dead stop (probed radially at its center x)
    const crate = resolveMovement(SEED, o.x - 19, o.z - 25, o.x - 19, o.z - 16, 0.5);
    expect(crate.z).toBeLessThan(o.z - 23.2);
    // the gatehouse east wall is solid from the field side
    const wall = resolveMovement(SEED, o.x - 15, o.z - 30, o.x - 15, o.z - 24, 0.5);
    expect(wall.z).toBeLessThan(o.z - 26.4);
    // the north gatehouse mirrors: in at x 16..20, out at x 21..24
    walk({ x: 18, z: 30 }, [
      { x: 18, z: 24 },
      { x: 21.5, z: 23 },
      { x: 22.5, z: 16 },
      { x: 22.5, z: 12 },
    ]);
  });

  it('chambers are sight-sealed: casts cross only at the crossings', () => {
    // across the curtain between crossings: no line of sight, probed along
    // BOTH curtains at every walled stretch
    for (const [x, z] of [
      [0, -20],
      [-10, -20],
      [20, -20],
      [31.5, -20],
      [0, 20],
      [10, 20],
      [-20, 20],
      [-31.5, 20],
    ]) {
      expect(
        lineOfSightClear(SEED, { x: o.x + x, z: o.z + z - 4 }, { x: o.x + x, z: o.z + z + 4 }),
        `curtain sealed at (${x}, ${z})`,
      ).toBe(false);
    }
    // through the main gate and the flank arch: clear
    expect(lineOfSightClear(SEED, { x: o.x + 8, z: o.z - 24 }, { x: o.x + 8, z: o.z - 16 })).toBe(
      true,
    );
    expect(lineOfSightClear(SEED, { x: o.x + 28, z: o.z - 24 }, { x: o.x + 28, z: o.z - 16 })).toBe(
      true,
    );
    // the heart's 12yd core crosses every main-gate-to-main-gate ray, so the
    // two gates can never see each other; flag to flag is sealed too
    expect(lineOfSightClear(SEED, { x: o.x + 8, z: o.z - 20 }, { x: o.x - 8, z: o.z + 20 })).toBe(
      false,
    );
    expect(
      lineOfSightClear(SEED, { x: o.x, z: o.z - BG_FLAG_Z }, { x: o.x, z: o.z + BG_FLAG_Z }),
    ).toBe(false);
  });

  it('pins the crossing spans exactly: gate 8yd, arch 4yd, gatehouse doors 4 and 3', () => {
    const spans = (z: number) =>
      BG_CURTAIN_WALLS.filter((s) => s.z === z)
        .map((s) => [s.x - s.hw, s.x + s.hw])
        .sort((a, b) => a[0] - b[0]);
    // south curtain walls: rampart..gatehouse west, gatehouse east..main gate,
    // main gate..flank arch, flank arch..rampart (openings are the gaps)
    expect(spans(-20)).toEqual([
      [-33, -26],
      [-14, 4],
      [12, 26],
      [30, 33],
    ]);
    // the north curtain is the exact point mirror
    expect(spans(20)).toEqual([
      [-33, -30],
      [-26, -12],
      [-4, 14],
      [26, 33],
    ]);
    // gatehouse doors: field-side door x -20..-16 (4yd), courtyard-side door
    // x -24..-21 (3yd); the walls end exactly at those door edges
    const field = BG_GATEHOUSE_WALLS.find((s) => s.z === -26);
    const court = BG_GATEHOUSE_WALLS.find((s) => s.z === -14);
    expect(field ? field.x + field.hw : null).toBe(-20);
    expect(court ? court.x - court.hw : null).toBe(-21);
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

  it('the courtyard sightline breakers block their line and leave the lanes open', () => {
    // crossing the northeast breaker (x 6..14, z 9..11) head-on is blocked
    const blocked = resolveMovement(SEED, o.x + 10, o.z + 6, o.x + 10, o.z + 14, 0.5);
    expect(blocked.z).toBeLessThan(o.z + 8.6);
    // the lane between the heart's north face (z=6) and that breaker passes
    walk({ x: 10, z: 7.5 }, [{ x: -2, z: 7.5 }]);
  });

  it('each flag is reachable from the enemy keep with body radius 0.5, both routes', () => {
    // Route A, the main gates: out the wide mouth gap, through the south main
    // gate, across the courtyard between the heart and the breakers, out the
    // north main gate, and in through Azure's postern-side mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: 8, z: -46 },
      { x: 8, z: -38 },
      { x: 8, z: -26 },
      { x: 8, z: -14 }, // the south main gate
      { x: 10, z: -4 },
      { x: 10, z: 7.5 }, // the heart-to-breaker lane
      { x: -2, z: 7.5 },
      { x: -8, z: 14 },
      { x: -8, z: 26 }, // the north main gate
      { x: -8, z: 38 },
      { x: -8, z: 44 },
      { x: -6, z: 46 },
      { x: 0, z: BG_FLAG_Z },
    ]);
    // Route B, the sneak: out the postern-side mouth gap, around the wing
    // baffle, the gatehouse S-jog, up the courtyard's west flank past the
    // rune, out the north flank arch, and home through the far mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: -8, z: -46 },
      { x: -10, z: -44 },
      { x: -10, z: -36 },
      { x: -25, z: -34 },
      { x: -30.5, z: -33 },
      { x: -30.5, z: -28 }, // the rampart-side gap past the wing baffle
      { x: -22, z: -28 },
      { x: -18, z: -27 },
      { x: -18, z: -24 }, // the gatehouse S-jog
      { x: -21.5, z: -23 },
      { x: -22.5, z: -16 },
      { x: -22.5, z: -12 },
      { x: -24, z: -4 }, // the courtyard west flank, over the rune pad
      { x: -24, z: 8 },
      { x: -28, z: 14 },
      { x: -28, z: 26 }, // the north flank arch
      { x: -28, z: 32 },
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
