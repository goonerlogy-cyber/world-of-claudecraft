import { afterEach, describe, expect, it } from 'vitest';
import { advanceClimb, CLIMB_DURATION, tryStartClimb } from '../src/sim/climb';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { MAX_STEP_HEIGHT } from '../src/sim/physics';
import { findLedgeGrab, LEDGE_GRAB_MAX, LEDGE_GRAB_MIN } from '../src/sim/physics/ledge';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight, terrainSteepnessAt, WATER_LEVEL } from '../src/sim/world';

// The ledge climb completes the traversal ladder: step over the low, vault the
// mid, CLIMB the high, and everything above that is a wall.

const SEED = 42;
const R = PLAYER_BODY_RADIUS;

afterEach(() => {
  setActiveWorldContent(null);
});

function world(props: Partial<WorldContent['props']>): WorldContent {
  return { ...BUILTIN_WORLD, props: { ...BUILTIN_WORLD.props, ...props } };
}

// Flat, dry, collider-free ground to build fixtures on.
function findFlatSpot(): { x: number; z: number } {
  for (let x = -110; x <= 110; x += 3) {
    for (let z = -110; z <= 110; z += 3) {
      if (terrainHeight(x, z, SEED) < WATER_LEVEL + 2) continue;
      let ok = true;
      for (let dz = -3; dz <= 5 && ok; dz += 1) {
        if (terrainSteepnessAt(x, z + dz, SEED) > 0.3) ok = false;
        if (isBlocked(SEED, x, z + dz, 2.2)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no flat spot');
}

const SPOT = findFlatSpot();
const q = (over: Partial<Parameters<typeof findLedgeGrab>[0]> = {}) => ({
  seed: SEED,
  radius: R,
  facing: 0, // +z
  vx: 0,
  vz: 4,
  ...over,
});

describe('ledge detection', () => {
  it('finds nothing on open ground', () => {
    setActiveWorldContent(world({}));
    const g = groundHeight(SPOT.x, SPOT.z, SEED);
    expect(findLedgeGrab(q(), SPOT.x, g, SPOT.z)).toBeNull();
  });

  it('grabs a crate stack that is too tall to vault', () => {
    // A crate top sits 1.35 above its ground: above the step height, so a
    // walking body is stopped by it, and this is exactly what a climb is for.
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const grab = findLedgeGrab(q(), SPOT.x, g, SPOT.z);
    expect(grab).not.toBeNull();
    if (!grab) return;
    expect(grab.topY - g).toBeGreaterThan(MAX_STEP_HEIGHT);
    expect(grab.topY - g).toBeLessThanOrEqual(LEDGE_GRAB_MAX + 1e-6);
  });

  it('refuses a ledge below the step height (that is a stride, not a climb)', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Feet already level with most of the crate: the gap is under the minimum.
    const grab = findLedgeGrab(q(), SPOT.x, g + 1.35 - LEDGE_GRAB_MIN + 0.05, SPOT.z);
    expect(grab).toBeNull();
  });

  it('refuses a ledge beyond arm reach', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Feet far below the top: out of reach even with arms extended.
    expect(findLedgeGrab(q(), SPOT.x, g - 1.2, SPOT.z)).toBeNull();
  });

  it('never grabs a full-height blocker (a wall is not a ledge)', () => {
    const cz = SPOT.z + 1.4;
    const placed = {
      ...world({}),
      placements: [
        { path: '/models/props/x.glb', x: SPOT.x, z: cz, rotY: 0, scale: 1, collideRadius: 1 },
      ],
    } as WorldContent;
    setActiveWorldContent(placed);
    const g = groundHeight(SPOT.x, cz, SEED);
    for (let up = 0; up <= 2.5; up += 0.25) {
      expect(findLedgeGrab(q(), SPOT.x, g + up, SPOT.z)).toBeNull();
    }
  });

  it('uses real motion as intent, not just where the body looks', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    // Facing the crate but flying away from it: nothing to grab.
    const away = findLedgeGrab(q({ vx: 0, vz: -5 }), SPOT.x, g, SPOT.z);
    expect(away).toBeNull();
    // Same pose, drifting slowly: facing decides, and the crate is ahead.
    const slow = findLedgeGrab(q({ vx: 0, vz: 0.1 }), SPOT.x, g, SPOT.z);
    expect(slow).not.toBeNull();
  });
});

describe('the climb move', () => {
  const makeBody = (x: number, y: number, z: number): Entity =>
    ({
      pos: { x, y, z },
      prevPos: { x, y, z },
      facing: 0,
      vx: 0,
      vy: 0,
      vz: 4,
      onGround: false,
      jumping: true,
      fallStartY: y,
      dead: false,
      ghost: false,
      auras: [],
      climb: null,
    }) as unknown as Entity;

  it('rises before it pulls forward, and lands standing on the surface', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const p = makeBody(SPOT.x, g, SPOT.z);
    expect(tryStartClimb(p, SEED)).toBe(true);
    const target = p.climb ? { ...p.climb.to } : null;
    expect(target).not.toBeNull();
    if (!target) return;

    const startZ = p.pos.z;
    let midRiseFraction = 0;
    let midForwardFraction = 0;
    let ticks = 0;
    while (advanceClimb(p) && ticks < 40) {
      ticks++;
      if (ticks === 3) {
        midRiseFraction = (p.pos.y - g) / (target.y - g);
        midForwardFraction = (p.pos.z - startZ) / (target.z - startZ);
      }
      // Never overshoots the destination on any axis.
      expect(p.pos.y).toBeLessThanOrEqual(target.y + 1e-6);
    }
    // Early in the move the body is mostly UP, not yet over the edge: that
    // ordering is what makes it read as a mantle and not a diagonal slide.
    expect(midRiseFraction).toBeGreaterThan(midForwardFraction + 0.15);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(CLIMB_DURATION * 20) + 1);
    expect(p.climb).toBeNull();
    expect(p.onGround).toBe(true);
    expect(p.pos.y).toBeCloseTo(target.y, 6);
    expect(p.vy).toBe(0);
  });

  it('does not start while the jump is still rising', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const p = makeBody(SPOT.x, g, SPOT.z);
    p.vy = 5; // just launched
    expect(tryStartClimb(p, SEED)).toBe(false);
  });

  it('never starts from the ground, from a corpse, or under crowd control', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const grounded = makeBody(SPOT.x, g, SPOT.z);
    grounded.onGround = true;
    expect(tryStartClimb(grounded, SEED)).toBe(false);

    const dead = makeBody(SPOT.x, g, SPOT.z);
    dead.dead = true;
    expect(tryStartClimb(dead, SEED)).toBe(false);

    const stunned = makeBody(SPOT.x, g, SPOT.z);
    stunned.auras = [{ kind: 'stun', value: 1, remaining: 3 }] as Entity['auras'];
    expect(tryStartClimb(stunned, SEED)).toBe(false);
  });

  it('drops the body when a stun lands mid-climb', () => {
    const cz = SPOT.z + 1.4;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const g = groundHeight(SPOT.x, cz, SEED);
    const p = makeBody(SPOT.x, g, SPOT.z);
    expect(tryStartClimb(p, SEED)).toBe(true);
    advanceClimb(p);
    advanceClimb(p);
    p.auras = [{ kind: 'stun', value: 1, remaining: 3 }] as Entity['auras'];
    expect(advanceClimb(p)).toBe(false);
    expect(p.climb).toBeNull();
    expect(p.onGround).toBe(false); // falls, rather than finishing the pull
  });
});

describe('the climb through a live Sim', () => {
  it('carries a jumping player onto a crate they could not vault', () => {
    const cz = SPOT.z + 1.6;
    setActiveWorldContent(world({ crates: [[SPOT.x, cz]] }));
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(60);
    const p = sim.player;
    p.pos.x = SPOT.x;
    p.pos.z = SPOT.z - 1.2;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, SEED);
    p.prevPos = { ...p.pos };
    p.facing = 0;
    p.onGround = true;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');
    const crateTop = groundHeight(SPOT.x, cz, SEED) + 1.35;
    let reachedTop = false;
    for (let i = 0; i < 60; i++) {
      Object.assign(meta.moveInput, {
        forward: true,
        back: false,
        turnLeft: false,
        turnRight: false,
        strafeLeft: false,
        strafeRight: false,
        jump: true,
      });
      sim.tick();
      if (p.onGround && Math.abs(p.pos.y - crateTop) < 0.05) reachedTop = true;
    }
    expect(reachedTop).toBe(true);
  });
});
