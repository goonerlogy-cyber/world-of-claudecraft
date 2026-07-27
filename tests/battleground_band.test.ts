import { describe, expect, it } from 'vitest';
import {
  BG_BASES,
  BG_COVER_CRATES,
  BG_COVER_PILLARS,
  BG_CURTAIN_WALLS,
  BG_FLAG_Z,
  BG_GATEHOUSE_WALLS,
  BG_GRAVEYARD_FENCE_TOP,
  BG_GRAVEYARD_FENCES,
  BG_GRAVEYARDS,
  BG_HALF_X,
  BG_HALF_Z,
  BG_KEEP_BARRICADES,
  BG_POWER_RUNES,
  BG_RUBBLE_PILES,
  BG_SPEED_RUNES,
  BG_WALL_HEIGHT,
  BG_WALL_T,
  battlegroundColliders,
  battlegroundWallSegments,
  KEEP_MOUTH_DZ,
  keepInteriorBounds,
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
import { bgGraveyardSpot } from '../src/sim/spirit';

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

describe('Ravenrift layout: sealed keeps + point symmetry', () => {
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

  it('each keep is sealed except the mouth: one solid segment per side, both teams', () => {
    // The owner's two-routes rule: into a base area you come through the main
    // gate or the gatehouse room, never a side gap, so each keep is exactly a
    // back wall plus two single unbroken side walls.
    for (const team of [0, 1] as const) {
      const segs = keepWallSegments(team);
      expect(segs).toHaveLength(3);
      expect(segs.filter((s) => s.x === -16)).toHaveLength(1);
      expect(segs.filter((s) => s.x === 16)).toHaveLength(1);
      expect(segs.filter((s) => s.hw > s.hd)).toHaveLength(1); // the back wall
    }
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

  it('the keep side walls block everywhere: the mouth is the only way out', () => {
    const o = battlegroundOrigin(0);
    const sideZ = o.z + BG_BASES[0].flag.z - 1; // Crimson west-wall midline (z - 119 local)
    // at the wall midline (where the postern gap used to open): solid now
    const mid = resolveMovement(SEED, o.x - 14, sideZ, o.x - 19, sideZ, 0.5);
    expect(mid.x).toBeGreaterThan(o.x - 16);
    // and 5yd along the same wall: also solid
    const blocked = resolveMovement(SEED, o.x - 14, sideZ + 5, o.x - 19, sideZ + 5, 0.5);
    expect(blocked.x).toBeGreaterThan(o.x - 16);
  });

  it('rubble heaps block movement but sit below the eye line (casts pass over)', () => {
    const o = battlegroundOrigin(0);
    const rb = BG_RUBBLE_PILES[0];
    // walking straight at the heap stops at its face
    const blocked = resolveMovement(
      SEED,
      o.x + rb.x - 3,
      o.z + rb.z,
      o.x + rb.x + 3,
      o.z + rb.z,
      0.5,
    );
    expect(blocked.x).toBeLessThan(o.x + rb.x - 1);
    // but the cast crosses it: the pile top is under SIGHT_HEIGHT, honestly
    expect(
      lineOfSightClear(
        SEED,
        { x: o.x + rb.x - 3, z: o.z + rb.z },
        { x: o.x + rb.x + 3, z: o.z + rb.z },
      ),
    ).toBe(true);
  });

  it('flag stands and rune pads are walkable (no collider on them)', () => {
    const o = battlegroundOrigin(1);
    for (const base of BG_BASES) {
      const p = resolvePosition(SEED, o.x + base.flag.x, o.z + base.flag.z, 0.5);
      expect(p.x).toBeCloseTo(o.x + base.flag.x, 5);
      expect(p.z).toBeCloseTo(o.z + base.flag.z, 5);
    }
    for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      const p = resolvePosition(SEED, o.x + r.x, o.z + r.z, 0.5);
      expect(p.x).toBeCloseTo(o.x + r.x, 5);
      expect(p.z).toBeCloseTo(o.z + r.z, 5);
    }
    // the two power pads are exact point mirrors
    expect(BG_POWER_RUNES).toHaveLength(2);
    expect(BG_POWER_RUNES[1].x).toBeCloseTo(-BG_POWER_RUNES[0].x, 5);
    expect(BG_POWER_RUNES[1].z).toBeCloseTo(-BG_POWER_RUNES[0].z, 5);
  });

  it('pins the wall/pillar/crate manifest counts (the three-chambers field)', () => {
    // 4 perimeter + (1 back + 3 side segs) x 2 keeps + 11 cover walls
    // + 8 curtain segments + 8 gatehouse walls + 2 barricades
    // + 8 graveyard fence rails (4 per corner yard)
    expect(BG_CURTAIN_WALLS).toHaveLength(6);
    expect(BG_GATEHOUSE_WALLS).toHaveLength(8);
    expect(BG_KEEP_BARRICADES).toHaveLength(2);
    expect(BG_GRAVEYARD_FENCES).toHaveLength(8);
    expect(battlegroundWallSegments()).toHaveLength(4 + 3 * 2 + 11 + 6 + 8 + 2 + 8);
    expect(BG_COVER_PILLARS).toHaveLength(6);
    expect(BG_RUBBLE_PILES).toHaveLength(10);
    expect(BG_COVER_CRATES).toHaveLength(12);
  });

  it('only the two mouth barricades are low; every other segment is full height', () => {
    const low = battlegroundWallSegments().filter((s) => s.low);
    expect(low).toEqual(BG_KEEP_BARRICADES);
    for (const b of BG_KEEP_BARRICADES) expect(b.low).toBe(true);
  });

  it('the low/fence flags never change a collider footprint, only its visual top', () => {
    const segs = battlegroundWallSegments();
    const obbs = battlegroundColliders().filter((c) => c.type === 'obb');
    expect(obbs).toHaveLength(segs.length);
    segs.forEach((s, i) => {
      const c = obbs[i];
      expect([c.x, c.z, c.hw, c.hd]).toEqual([s.x, s.z, s.hw, s.hd]);
      expect(c.cameraTopY).toBe(
        s.fence ? BG_GRAVEYARD_FENCE_TOP : s.low ? BG_WALL_HEIGHT / 2 : BG_WALL_HEIGHT,
      );
    });
    // the fence top stays above the eye line: what blocks a cast is never
    // renderable-below-sight (the band's honesty rule)
    expect(BG_GRAVEYARD_FENCE_TOP).toBeGreaterThan(SIGHT_HEIGHT);
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

  it('the curtain wall is solid; only the main gate threads it', () => {
    // straight into the south curtain between the crossings: stopped at its face
    const blocked = resolveMovement(SEED, o.x, o.z - 62, o.x, o.z - 50, 0.5);
    expect(blocked.z).toBeLessThan(o.z - 57.4);
    // the 10yd main gate (x 8..18) passes
    walk({ x: 13, z: -62 }, [{ x: 13, z: -50 }]);
    // where the old flank arch opened (x 38..43): sealed solid now
    const sealedArch = resolveMovement(SEED, o.x + 40.5, o.z - 62, o.x + 40.5, o.z - 50, 0.5);
    expect(sealedArch.z).toBeLessThan(o.z - 57.4);
    // the rampart-side run is solid
    const stub = resolveMovement(SEED, o.x + 46, o.z - 62, o.x + 46, o.z - 50, 0.5);
    expect(stub.z).toBeLessThan(o.z - 57.4);
    // north curtain mirrors: main gate at x -18..-8 passes, the mirror arch line is sealed
    walk({ x: -13, z: 62 }, [{ x: -13, z: 50 }]);
    const sealedNorth = resolveMovement(SEED, o.x - 40.5, o.z + 62, o.x - 40.5, o.z + 50, 0.5);
    expect(sealedNorth.z).toBeGreaterThan(o.z + 57.4);
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
    // through the main gate: clear; across the sealed old arch line: blocked
    expect(lineOfSightClear(SEED, { x: o.x + 13, z: o.z - 60 }, { x: o.x + 13, z: o.z - 52 })).toBe(
      true,
    );
    expect(
      lineOfSightClear(SEED, { x: o.x + 40.5, z: o.z - 60 }, { x: o.x + 40.5, z: o.z - 52 }),
    ).toBe(false);
    // the heart's 16yd core crosses every main-gate-to-main-gate ray, so the
    // two gates can never see each other; flag to flag is sealed too
    expect(lineOfSightClear(SEED, { x: o.x + 13, z: o.z - 56 }, { x: o.x - 13, z: o.z + 56 })).toBe(
      false,
    );
    expect(
      lineOfSightClear(SEED, { x: o.x, z: o.z - BG_FLAG_Z }, { x: o.x, z: o.z + BG_FLAG_Z }),
    ).toBe(false);
  });

  it('pins the crossing spans exactly: one 10yd gate per curtain, gatehouse doors 5 and 4', () => {
    const spans = (z: number) =>
      BG_CURTAIN_WALLS.filter((s) => s.z === z)
        .map((s) => [s.x - s.hw, s.x + s.hw])
        .sort((a, b) => a[0] - b[0]);
    // south curtain walls: rampart..gatehouse west, gatehouse east..main gate,
    // main gate..rampart in ONE sealed run (openings are the gaps)
    expect(spans(-56)).toEqual([
      [-49, -34],
      [-18, 8],
      [18, 49],
    ]);
    // the north curtain is the exact point mirror
    expect(spans(56)).toEqual([
      [-49, -18],
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
    // narrow (west) gap: x = -13 threads it
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
    // north main gate, and in through Azure's narrow mouth gap.
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
      { x: -10, z: 104 }, // Azure's narrow mouth gap
      { x: -10, z: 110 },
      { x: -6, z: 114 },
      { x: 0, z: BG_FLAG_Z },
    ]);
    // Route B, the sneak: out the narrow west mouth gap, around the wing
    // baffle, the gatehouse S-jog, up the courtyard's west flank past the
    // rune, then across to the north main gate (the old flank arch is
    // sealed), and home through the far mouth gap.
    walk({ x: 0, z: -BG_FLAG_Z }, [
      { x: -10, z: -114 },
      { x: -13, z: -109 }, // out the narrow west mouth gap past the barricade
      { x: -13, z: -104 },
      { x: -18, z: -106 },
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
      { x: -38, z: 44 }, // past the west breaker, still on the flank
      { x: -13, z: 50 }, // cut across to the north main gate
      { x: -13, z: 62 },
      { x: -13, z: 70 },
      { x: -24, z: 78 }, // around the mirrored S-approach
      { x: -26, z: 90 },
      { x: -14, z: 100 },
      { x: -10, z: 104 }, // Azure's narrow mouth gap
      { x: -10, z: 110 },
      { x: -4, z: 114 },
      { x: 0, z: BG_FLAG_Z },
    ]);
  });

  it('graveyard plots: inside the keeps, exact mirrors, spots and ward clear of colliders', () => {
    // plots are point mirrors and sit fully inside their keep interiors
    expect(BG_GRAVEYARDS[1].x).toBeCloseTo(-BG_GRAVEYARDS[0].x, 5);
    expect(BG_GRAVEYARDS[1].z).toBeCloseTo(-BG_GRAVEYARDS[0].z, 5);
    expect(BG_GRAVEYARDS[1].hw).toBe(BG_GRAVEYARDS[0].hw);
    expect(BG_GRAVEYARDS[1].hd).toBe(BG_GRAVEYARDS[0].hd);
    for (const team of [0, 1] as const) {
      const plot = BG_GRAVEYARDS[team];
      // The yard lives in the map corner BESIDE the keep: inside the
      // perimeter with wall clearance, fully OUTSIDE the keep interior
      // (never in the flag room), on the gatehouse-opposite flank.
      expect(Math.abs(plot.x) + plot.hw).toBeLessThanOrEqual(BG_HALF_X - 2);
      expect(Math.abs(plot.z) + plot.hd).toBeLessThanOrEqual(BG_HALF_Z - 2);
      const bounds = keepInteriorBounds(team);
      const overlapsKeep =
        plot.x + plot.hw > bounds.minX &&
        plot.x - plot.hw < bounds.maxX &&
        plot.z + plot.hd > bounds.minZ &&
        plot.z - plot.hd < bounds.maxZ;
      expect(overlapsKeep).toBe(false);
    }
    // every release spot (5 roster slots x 2 teams) resolves in place at body
    // radius: a spirit is never teleported into a fence rail
    const o = battlegroundOrigin(0);
    const fakeMatch = {
      slot: 0,
      teams: [
        [101, 102, 103, 104, 105],
        [201, 202, 203, 204, 205],
      ],
    } as unknown as Parameters<typeof bgGraveyardSpot>[0];
    for (const pid of [...fakeMatch.teams[0], ...fakeMatch.teams[1]]) {
      const spot = bgGraveyardSpot(fakeMatch, pid);
      const r = resolvePosition(SEED, spot.x, spot.z, 0.5);
      expect(r.x, `spot for ${pid}`).toBeCloseTo(spot.x, 5);
      expect(r.z, `spot for ${pid}`).toBeCloseTo(spot.z, 5);
      // and inside the ward box the clamp enforces (plot inset by 1.6)
      const team = pid >= 200 ? 1 : 0;
      const plot = BG_GRAVEYARDS[team];
      expect(Math.abs(spot.x - (o.x + plot.x))).toBeLessThanOrEqual(plot.hw - 1.6 + 1e-9);
      expect(Math.abs(spot.z - (o.z + plot.z))).toBeLessThanOrEqual(plot.hd - 1.6 + 1e-9);
    }
    // the ward corners themselves resolve in place: the clamp can never park
    // a spirit inside a rail or keep wall
    for (const team of [0, 1] as const) {
      const plot = BG_GRAVEYARDS[team];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const wx = o.x + plot.x + sx * (plot.hw - 1.6);
          const wz = o.z + plot.z + sz * (plot.hd - 1.6);
          const r = resolvePosition(SEED, wx, wz, 0.5);
          expect(r.x, `ward corner ${team}/${sx}/${sz}`).toBeCloseTo(wx, 5);
          expect(r.z, `ward corner ${team}/${sx}/${sz}`).toBeCloseTo(wz, 5);
        }
      }
    }
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
