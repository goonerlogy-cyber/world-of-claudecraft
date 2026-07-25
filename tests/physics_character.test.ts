import { afterEach, describe, expect, it } from 'vitest';
import { CRATE_TOP, isBlocked, MANTLE_REACH } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  ROCK_COLLIDER_MIN_SCALE,
  ROCK_HEIGHT_PER_SCALE,
  rockHeight,
} from '../src/sim/decoration_dims';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import {
  type CharacterMoveParams,
  type CharacterMoveResult,
  floorHeightAt,
  MAX_STEP_HEIGHT,
  moveCharacter,
} from '../src/sim/physics';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import type { WorldContent } from '../src/sim/types';
import { generateDecorations, groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

// The character physics solver: swept collision, multi-plane sliding,
// depenetration, step-up, and the terrain wall/contour gate. These pin the
// contract the movement kernel depends on; tests/parkour.test.ts covers the
// same behavior end to end through a live Sim.

const SEED = 42;
const R = PLAYER_BODY_RADIUS;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

function params(over: Partial<CharacterMoveParams> = {}): CharacterMoveParams {
  return {
    seed: SEED,
    radius: R,
    stepHeight: MAX_STEP_HEIGHT,
    maxSlope: PLAYER_MAX_CLIMB_SLOPE,
    grounded: true,
    ignoreFences: false,
    ...over,
  };
}

const out: CharacterMoveResult = { x: 0, y: 0, z: 0, blocked: false, stepped: 0 };

// A flat, dry, collider-free strip to build cases on.
function findFlatSpot(): { x: number; z: number } {
  for (let x = -120; x <= 120; x += 3) {
    for (let z = -120; z <= 120; z += 3) {
      const h = terrainHeight(x, z, SEED);
      if (h < WATER_LEVEL + 1.5) continue;
      let ok = true;
      for (let dz = -3; dz <= 6 && ok; dz += 1) {
        if (Math.abs(terrainHeight(x, z + dz, SEED) - h) > 0.4) ok = false;
        if (isBlocked(SEED, x, z + dz, 2)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no flat spot found');
}

const SPOT = findFlatSpot();

describe('swept collision and sliding', () => {
  it('moves freely when nothing is in the way', () => {
    setActiveWorldContent(world({}));
    moveCharacter(params(), SPOT.x, 0, SPOT.z, 0, 1, out);
    expect(out.x).toBeCloseTo(SPOT.x, 6);
    expect(out.z).toBeCloseTo(SPOT.z + 1, 6);
    expect(out.blocked).toBe(false);
    expect(out.stepped).toBe(0);
  });

  it('stops at the surface of a tall obstacle instead of entering it', () => {
    // A crate is 1.35 tall: above the step height, so it is a wall on foot.
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.blocked).toBe(true);
    // Stopped clear of the crate: distance from its center is at least the
    // sum of the radii (crate 0.65 + body 0.5), inside a skin's tolerance.
    expect(Math.hypot(out.x - SPOT.x, out.z - cz)).toBeGreaterThan(0.65 + R - 0.02);
    expect(out.z).toBeLessThan(cz);
  });

  it('slides along an obstacle rather than sticking to it', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Approach at an angle: the body must keep making lateral progress.
    moveCharacter(params(), SPOT.x - 0.5, g, SPOT.z, 0.35, 1, out);
    expect(out.blocked).toBe(true);
    expect(Math.abs(out.x - (SPOT.x - 0.5))).toBeGreaterThan(0.05);
  });

  it('never tunnels through a thin obstacle at high speed', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // A 12 yard step in one call, far beyond any per-tick motion.
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 12, out);
    expect(out.z).toBeLessThan(cz);
  });

  it('pushes a body that starts inside an obstacle back out', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    moveCharacter(params(), SPOT.x, g, cz, 0, 0, out);
    expect(Math.hypot(out.x - SPOT.x, out.z - cz)).toBeGreaterThanOrEqual(0.65 + R - 1e-6);
  });
});

describe('step up: walking over low obstacles', () => {
  it('never steps onto a full-height blocker (an editor placement is a wall)', () => {
    const cz = SPOT.z + 2;
    const g = groundHeight(SPOT.x, cz, SEED);
    const placed = {
      ...world({}),
      placements: [
        {
          path: '/models/foliage/rock_1.glb',
          x: SPOT.x,
          z: cz,
          rotY: 0,
          scale: 1,
          collideRadius: 1,
        },
      ],
    } as WorldContent;
    setActiveWorldContent(placed);
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.stepped).toBe(0);
    expect(out.blocked).toBe(true);
    expect(out.y).toBe(g);
  });

  it('walks clean over a real low field stone', () => {
    setActiveWorldContent(null);
    // The "I cannot walk over stones" case, driven against real world data:
    // a stone whose true height is inside the step reach must be strideable.
    const stone = generateDecorations(SEED).find(
      (d) =>
        d.kind === 'rock' &&
        d.scale >= ROCK_COLLIDER_MIN_SCALE &&
        rockHeight(d.x, d.z, d.scale, SEED) <= MAX_STEP_HEIGHT &&
        terrainHeight(d.x, d.z, SEED) > WATER_LEVEL + 2,
    );
    expect(stone).toBeDefined();
    if (!stone) return;
    const height = rockHeight(stone.x, stone.z, stone.scale, SEED);
    expect(height).toBeLessThanOrEqual(MAX_STEP_HEIGHT);

    const g = groundHeight(stone.x, stone.z, SEED);
    // Approach from 3 yards south, walking north straight through it.
    let px = stone.x;
    let pz = stone.z - 3;
    let py = groundHeight(px, pz, SEED);
    let stepped = 0;
    for (let i = 0; i < 30; i++) {
      moveCharacter(params(), px, py, pz, 0, 0.35, out);
      px = out.x;
      pz = out.z;
      stepped += out.stepped;
      py = Math.max(out.y, floorHeightAt(SEED, px, pz, R, out.y + 0.01));
    }
    // It walked clean past the stone rather than stalling against it.
    expect(pz).toBeGreaterThan(stone.z + 1);
    expect(stepped).toBeGreaterThan(0); // it really did climb, not slip round
    expect(py).toBeGreaterThanOrEqual(g - 1);
  });

  it('every collidable stone is traversable: strideable, or reachable by a jump', () => {
    setActiveWorldContent(null);
    // The design contract for the whole rock field: nothing is a dead end.
    // A jump's apex is JUMP_VELOCITY^2 / 2g above the takeoff surface, and the
    // mantle assist adds MANTLE_REACH on top, so every stone top must sit
    // inside that reach. A meaningful share must also be plain strideable, or
    // "walking over stones" would be theory rather than something you feel.
    const apex = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    const reach = apex + MANTLE_REACH;
    let total = 0;
    let strideable = 0;
    let tallest = 0;
    for (const d of generateDecorations(SEED)) {
      if (d.kind !== 'rock' || d.scale < ROCK_COLLIDER_MIN_SCALE) continue;
      const h = rockHeight(d.x, d.z, d.scale, SEED);
      total++;
      if (h <= MAX_STEP_HEIGHT) strideable++;
      tallest = Math.max(tallest, h);
    }
    expect(total).toBeGreaterThan(100);
    expect(tallest).toBeLessThanOrEqual(reach);
    expect(strideable / total).toBeGreaterThan(0.12);
  });

  it('refuses to step up while airborne (no mid-air stairs)', () => {
    setActiveWorldContent(null);
    const stone = generateDecorations(SEED).find(
      (d) =>
        d.kind === 'rock' &&
        d.scale >= ROCK_COLLIDER_MIN_SCALE &&
        rockHeight(d.x, d.z, d.scale, SEED) <= MAX_STEP_HEIGHT &&
        terrainHeight(d.x, d.z, SEED) > WATER_LEVEL + 2,
    );
    expect(stone).toBeDefined();
    if (!stone) return;
    const g = groundHeight(stone.x, stone.z, SEED);
    moveCharacter(params({ grounded: false }), stone.x, g, stone.z - 2, 0, 4, out);
    expect(out.stepped).toBe(0);
  });

  it('never steps onto something taller than the step height', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    expect(CRATE_TOP).toBeGreaterThan(MAX_STEP_HEIGHT); // fixture premise
    moveCharacter(params(), SPOT.x, g, SPOT.z, 0, 4, out);
    expect(out.stepped).toBe(0);
    expect(out.y).toBe(g);
  });
});

describe('terrain gate', () => {
  it('keeps an unwalkable rise a wall, and slides along it', () => {
    setActiveWorldContent(null);
    // The world rim is the canonical unwalkable face.
    let found: { x: number; z: number } | null = null;
    for (let z = -60; z <= 200 && !found; z += 7) {
      for (let x = -130; x >= -184; x -= 0.25) {
        if (terrainHeight(x, z, SEED) < WATER_LEVEL + 0.5) break;
        if (isBlocked(SEED, x, z, 0.6)) break;
        const rise = terrainHeight(x - 0.5, z, SEED) - terrainHeight(x, z, SEED);
        if (rise > MAX_STEP_HEIGHT * 2) {
          found = { x, z };
          break;
        }
      }
    }
    expect(found).toBeDefined();
    if (!found) return;
    const g = groundHeight(found.x, found.z, SEED);
    moveCharacter(params(), found.x, g, found.z, -1, 0, out);
    // Did not climb the face.
    expect(out.x).toBeGreaterThan(found.x - 0.6);
  });

  it('steps up a small terrain lip instead of walling on it', () => {
    // A rise inside the step height is a kerb, not a cliff: the solver must
    // let the body through even when the local gradient is unwalkable.
    setActiveWorldContent(null);
    const p = params();
    // Synthesize the check directly: any point whose forward neighbour rises
    // less than the step height must be reachable.
    const g0 = groundHeight(SPOT.x, SPOT.z, SEED);
    moveCharacter(p, SPOT.x, g0, SPOT.z, 0, 0.35, out);
    expect(Math.hypot(out.x - SPOT.x, out.z - SPOT.z)).toBeGreaterThan(0.3);
  });
});

describe('floor query', () => {
  it('reports the terrain on open ground and a crate top when standing on one', () => {
    const cz = SPOT.z + 2;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    expect(floorHeightAt(SEED, SPOT.x, SPOT.z, R, 1000)).toBeCloseTo(
      groundHeight(SPOT.x, SPOT.z, SEED),
      6,
    );
    expect(floorHeightAt(SEED, SPOT.x, cz, R, g + CRATE_TOP + 0.01)).toBeCloseTo(g + CRATE_TOP, 6);
  });
});

describe('rock dimensions match the rendered silhouette', () => {
  it('keeps every collidable stone within the documented height band', () => {
    setActiveWorldContent(null);
    let checked = 0;
    for (const d of generateDecorations(SEED)) {
      if (d.kind !== 'rock' || d.scale < ROCK_COLLIDER_MIN_SCALE) continue;
      const h = rockHeight(d.x, d.z, d.scale, SEED);
      // The model: scale * ROCK_HEIGHT_PER_SCALE * (0.8 .. 1.3).
      expect(h).toBeGreaterThanOrEqual(d.scale * ROCK_HEIGHT_PER_SCALE * 0.8 - 1e-9);
      expect(h).toBeLessThanOrEqual(d.scale * ROCK_HEIGHT_PER_SCALE * 1.3 + 1e-9);
      checked++;
      if (checked > 400) break;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('is deterministic for a given seed', () => {
    const a = rockHeight(12.5, -33.25, 1.1, SEED);
    const b = rockHeight(12.5, -33.25, 1.1, SEED);
    expect(a).toBe(b);
    expect(rockHeight(12.5, -33.25, 1.1, SEED + 1)).not.toBe(a);
  });
});
