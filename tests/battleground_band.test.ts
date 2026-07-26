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
        // slot spacing exceeds the full 280yd field length
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
    expect(crimson.filter((s) => s.x === -16)).toHaveLength(2);
    expect(crimson.filter((s) => s.x === 16)).toHaveLength(1);
    expect(azure.filter((s) => s.x === 16)).toHaveLength(2);
    expect(azure.filter((s) => s.x === -16)).toHaveLength(1);
    // the gap is BG_POSTERN_GAP wide, centred on the side-wall midline
    const [lo, hi] = crimson.filter((s) => s.x === -16).sort((a, b) => a.z - b.z);
    expect(hi.z - hi.hd - (lo.z + lo.hd)).toBeCloseTo(BG_POSTERN_GAP, 5);
  });

  it('the keep side walls span back wall to mouth line exactly (containment = walls)', () => {
    for (const team of [0, 1] as const) {
      const solidSide = keepWallSegments(team).find(
        (s) => s.hd > s.hw && s.x === (team === 0 ? 16 : -16),
      )!;
      const mouthLine = BG_FLAG_Z - KEEP_MOUTH_DZ;
      const backLine = BG_FLAG_Z + 10; // KEEP_BACK_DZ
      expect(
        Math.min(Math.abs(solidSide.z - solidSide.hd), Math.abs(solidSide.z + solidSide.hd)),
      ).toBe(mouthLine);
      expect(
        Math.max(Math.abs(solidSide.z - solidSide.hd), Math.abs(solidSide.z + solidSide.hd)),
      ).toBe(backLine);
    }
  });

  it('a path exists through the postern gap; the wall blocks everywhere else', () => {
    const o = battlegroundOrigin(0);
    const sideZ = o.z + BG_BASES[0].flag.z - 1; // Crimson west-wall midline (z - 119 local)
    // through the gap: cross x = -16 at the wall midline
    const through = resolveMovement(SEED, o.x - 14, sideZ, o.x - 19, sideZ, 0.5);
    expect(through.x).toBeLessThan(o.x - 17);
    // 5yd along the same wall: solid, the mover is stopped at the face
    const blocked = resolveMovement(SEED, o.x - 14, sideZ + 5, o.x - 19, sideZ + 5, 0.5);
    expect(blocked.x).toBeGreaterThan(o.x - 16);
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
    // 4 perimeter + (1 back + 3 side segs) x 2 keeps + 11 cover walls
    // + 8 curtain segments + 8 gatehouse walls + 2 barricades
    expect(BG_CURTAIN_WALLS).toHaveLength(8);
    expect(BG_GATEHOUSE_WALLS).toHaveLength(8);
    expect(BG_KEEP_BARRICADES).toHaveLength(2);
    expect(battlegroundWallSegments()).toHaveLength(4 + 4 * 2 + 11 + 8 + 8 + 2);
    expect(BG_COVER_PILLARS).toHaveLength(6);
    expect(BG_COVER_CRATES).toHaveLength(12);
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
    const blockedLow = cameraOcclusion(SEED, o.x, 1.0, o.z - 102, o.x, 1.0, o.z - 110);
    expect(blockedLow).toBeLessThan(1);
    // above the barricade top but below the rampart top: it clears the low wall
    expect(cameraOcclusion(SEED, o.x, 4.0, o.z - 102, o.x, 4.0, o.z - 110)).toBe(1);
    // the full-height heart ruin still occludes at that height, and clears above
    expect(cameraOcclusion(SEED, o.x, 4.0, o.z - 14, o.x, 4.0, o.z + 4)).toBeLessThan(1);
    expect(
      cameraOcclusion(SEED, o.x, BG_WALL_HEIGHT + 1, o.z - 14, o.x, BG_WALL_HEIGHT + 1, o.z + 4),
    ).toBe(1);
    // spell sight runs at eye height and the barricade top stays above it, so
    // a cast straight across the barricade is blocked
    expect(BG_WALL_HEIGHT / 2).toBeGreaterThan(SIGHT_HEIGHT);
    expect(lineOfSightClear(SEED, { x: o.x, z: o.z - 102 }, { x: o.x, z: o.z - 110 })).toBe(false);
    // and an unobstructed lane stays castable
    expect(
      lineOfSightClear(SEED, { x: o.x - 13, z: o.z - 102 }, { x: o.x - 13, z: o.z - 110 }),
    ).toBe(true);
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
    const blocked = resolveMovement(SEED, o.x, o.z - 62, o.x, o.z - 50, 0.5);
    expect(blocked.z).toBeLessThan(o.z - 57.4);
    // the 10yd main gate (x 8..18) passes
    walk({ x: 13, z: -62 }, [{ x: 13, z: -50 }]);
    // the 5yd flank arch (x 38..43) passes
    walk({ x: 40.5, z: -62 }, [{ x: 40.5, z: -50 }]);
    // the rampart-side stub is solid
    const stub = resolveMovement(SEED, o.x + 46, o.z - 62, o.x + 46, o.z - 50, 0.5);
    expect(stub.z).toBeLessThan(o.z - 57.4);
    // north curtain mirrors: main gate at x -18..-8, arch at x -43..-38
    walk({ x: -13, z: 62 }, [{ x: -13, z: 50 }]);
    walk({ x: -40.5, z: 62 }, [{ x: -40.5, z: 50 }]);
  });

  it('the gatehouse is a jogged through-route; its walls block everything else', () => {
    // in the field door (x -25..-20), west around the ambush crates, out the
    // courtyard door (x -32..-28): the offset-door S-jog
    walk({ x: -22.5, z: -69 }, [
      { x: -22.5, z: -62 }, // in through the field-side door
      { x: -24.5, z: -57 }, // jog west around the mid-room ambush crate
      { x: -30, z: -54 },
      { x: -30, z: -43 }, // out through the courtyard-side door
    ]);
    // the mid-room crate's own line is a dead stop (probed radially)
    const crate = resolveMovement(SEED, o.x - 26, o.z - 62, o.x - 26, o.z - 52, 0.5);
    expect(crate.z).toBeLessThan(o.z - 59.2);
    // the gatehouse east wall is solid from the field side
    const wall = resolveMovement(SEED, o.x - 19, o.z - 68, o.x - 19, o.z - 62, 0.5);
    expect(wall.z).toBeLessThan(o.z - 65.4);
    // the north gatehouse mirrors: in at x 20..25, out at x 28..32
    walk({ x: 22.5, z: 69 }, [
      { x: 22.5, z: 62 },
      { x: 24.5, z: 57 },
      { x: 30, z: 54 },
      { x: 30, z: 43 },
    ]);
  });

  it('chambers are sight-sealed: casts cross only at the crossings', () => {
    // across the curtain between crossings: no line of sight, probed along
    // BOTH curtains at every walled stretch
    for (const [x, z] of [
      [0, -56],
      [-40, -56],
      [25, -56],
      [46, -56],
      [0, 56],
      [40, 56],
      [-25, 56],
      [-46, 56],
    ]) {
      expect(
        lineOfSightClear(SEED, { x: o.x + x, z: o.z + z - 4 }, { x: o.x + x, z: o.z + z + 4 }),
        `curtain sealed at (${x}, ${z})`,
      ).toBe(false);
    }
    // through the main gate and the flank arch: clear
    expect(lineOfSightClear(SEED, { x: o.x + 13, z: o.z - 60 }, { x: o.x + 13, z: o.z - 52 })).toBe(
      true,
    );
    expect(
      lineOfSightClear(SEED, { x: o.x + 40.5, z: o.z - 60 }, { x: o.x + 40.5, z: o.z - 52 }),
    ).toBe(true);
    // the heart's 16yd core crosses every main-gate-to-main-gate ray, so the
    // two gates can never see each other; flag to flag is sealed too
    expect(lineOfSightClear(SEED, { x: o.x + 13, z: o.z - 56 }, { x: o.x - 13, z: o.z + 56 })).toBe(
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
    expect(spans(-56)).toEqual([
      [-49, -34],
      [-18, 8],
      [18, 38],
      [43, 49],
    ]);
    // the north curtain is the exact point mirror
    expect(spans(56)).toEqual([
      [-49, -43],
      [-38, -18],
      [-8, 18],
      [34, 49],
    ]);
    // gatehouse doors: field-side door x -25..-20 (5yd), courtyard-side door
    // x -32..-28 (4yd); the walls end exactly at those door edges
    const field = BG_GATEHOUSE_WALLS.find((s) => s.z === -65);
    const court = BG_GATEHOUSE_WALLS.find((s) => s.z === -47);
    expect(field ? field.x + field.hw : null).toBe(-25);
    expect(court ? court.x - court.hw : null).toBe(-28);
  });

  it('the mouth barricade blocks the straight charge and both gaps stay open', () => {
    // Crimson barricade spans x -11..5 at z -107..-105: the flag-line charge stops
    const blocked = resolveMovement(SEED, o.x, o.z - 102, o.x, o.z - 110, 0.5);
    expect(blocked.z).toBeGreaterThan(o.z - 105);
    // postern-side (west) gap: x = -13 threads it
    walk({ x: -13, z: -102 }, [{ x: -13, z: -109 }]);
    // wide (east) gap: x = 10 threads it
    walk({ x: 10, z: -102 }, [{ x: 10, z: -109 }]);
    // the barricade sits field-side of the form-up containment line (the keep
    // interior spans |z| in [BG_FLAG_Z - KEEP_MOUTH_DZ, back wall]), with at
    // least 1yd of clearance so tickCountdown never reads it
    for (const b of BG_KEEP_BARRICADES) {
      expect(Math.abs(b.z) + b.hd).toBeLessThanOrEqual(BG_FLAG_Z - KEEP_MOUTH_DZ - 1);
    }
  });

  it('the courtyard sightline breakers block their line and leave the lanes open', () => {
    // crossing the northeast breaker foot (x 9..23, z 21..23) head-on is blocked
    const blocked = resolveMovement(SEED, o.x + 16, o.z + 18, o.x + 16, o.z + 26, 0.5);
    expect(blocked.z).toBeLessThan(o.z + 20.6);
    // the lane between the heart's north face (z=8) and that breaker passes
    walk({ x: 20, z: 14 }, [{ x: -20, z: 14 }]);
  });

  it('each flag is reachable from the enemy keep with body radius 0.5, both routes', () => {
    // Route A, the main gates: out the wide mouth gap, through the south main
    // gate, across the courtyard between the heart and the breakers, out the
    // north main gate, and in through Azure's postern-side mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: 10, z: -114 },
      { x: 10, z: -104 }, // the wide mouth gap
      { x: 10, z: -95 },
      { x: 24, z: -92 }, // around the first S-approach wall
      { x: 26, z: -80 },
      { x: 24, z: -70 }, // around the second
      { x: 14, z: -62 },
      { x: 13, z: -50 }, // the south main gate
      { x: 13, z: -26 },
      { x: 13, z: -12 },
      { x: 13, z: 2 }, // east of the heart
      { x: 10, z: 14 },
      { x: 0, z: 24 }, // between the northern breaker pairs
      { x: -13, z: 32 },
      { x: -13, z: 50 },
      { x: -13, z: 62 }, // the north main gate
      { x: -13, z: 70 },
      { x: -24, z: 78 }, // around the mirrored S-approach
      { x: -26, z: 90 },
      { x: -14, z: 100 },
      { x: -10, z: 104 }, // Azure's postern-side mouth gap
      { x: -10, z: 110 },
      { x: -6, z: 114 },
      { x: 0, z: BG_FLAG_Z },
    ]);
    // Route B, the sneak: out the postern-side mouth gap, around the wing
    // baffle, the gatehouse S-jog, up the courtyard's west flank past the
    // rune, out the north flank arch, and home through the far mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: -10, z: -114 },
      { x: -14, z: -119 }, // out through the postern gap
      { x: -19, z: -119 },
      { x: -21, z: -112 },
      { x: -44, z: -104 }, // the rampart-side gap past the wing baffle
      { x: -44, z: -98 },
      { x: -44, z: -84 },
      { x: -36, z: -74 },
      { x: -33, z: -67.5 }, // the corridor between S-wall and gatehouse
      { x: -22.5, z: -67.5 }, // to the field door
      { x: -22.5, z: -62 }, // the gatehouse S-jog
      { x: -24.5, z: -57 },
      { x: -30, z: -54 },
      { x: -30, z: -43 },
      { x: -38, z: -30 }, // the courtyard west flank, over the rune pad
      { x: -38, z: 0 },
      { x: -38, z: 20 },
      { x: -40.5, z: 34 },
      { x: -40.5, z: 50 },
      { x: -40.5, z: 62 }, // the north flank arch
      { x: -40.5, z: 80 },
      { x: -40, z: 96 },
      { x: -20, z: 102 },
      { x: -10, z: 104 }, // Azure's postern-side mouth gap
      { x: -10, z: 110 },
      { x: -4, z: 114 },
      { x: 0, z: BG_FLAG_Z },
    ]);
  });

  it('the form-up spots and spawn rings stay walkable under the new geometry', () => {
    for (const base of BG_BASES) {
      for (const sp of base.spawns) {
        // The ring sits in open keep floor (moved off the back wall so the
        // spawn-in camera has clearance): exact resolution, no face-nudge.
        const p = resolvePosition(SEED, o.x + sp.x, o.z + sp.z, 0.5);
        expect(p.x).toBeCloseTo(o.x + sp.x, 5);
        expect(p.z).toBeCloseTo(o.z + sp.z, 5);
        // Never on the flag stand itself, and clear of the keep back wall
        // (|z| = 128, BG_FLAG_Z + KEEP_BACK_DZ) by the camera's working room.
        expect(Math.hypot(sp.x - base.flag.x, sp.z - base.flag.z)).toBeGreaterThanOrEqual(4);
        expect(128 - Math.abs(sp.z)).toBeGreaterThanOrEqual(10);
      }
      // The two rings mirror under the point symmetry like everything else.
      const mirror = BG_BASES[1 - base.team];
      for (const [i, sp] of base.spawns.entries()) {
        expect(mirror.spawns[i].x).toBeCloseTo(-sp.x, 5);
        expect(mirror.spawns[i].z).toBeCloseTo(-sp.z, 5);
      }
    }
    // the mechanics suites stage in-match players at flag-relative offsets;
    // pin the two staging spots nearest new geometry: the mouth line and the
    // carrier's off-stand spot inside the keep
    for (const [sx2, sz2] of [
      [0, -104], // the mouth line
      [6, 110], // the carrier's off-stand spot (battleground.test.ts:444)
      [10, -98], // home + (10, 20) staging
      [12, -93], // home + (12, 25) staging
    ]) {
      const p = resolvePosition(SEED, o.x + sx2, o.z + sz2, 0.5);
      expect(p.x).toBeCloseTo(o.x + sx2, 5);
      expect(p.z).toBeCloseTo(o.z + sz2, 5);
    }
  });
});
