// Move a test's player somewhere genuinely empty.
//
// The starting town is furnished now (profession stations, Artisan Row, the
// cemetery: see `src/sim/town_props.ts`), so a fixture that spawns at
// PLAYER_START and walks or shoots north is measuring a collision with a loom,
// not the thing it meant to test. Suites that care about SPEED, RANGE, or
// LINE OF SIGHT should stand on clear ground and say so, rather than depending
// on the town happening to be empty.
//
// The spot is the flat vale clearing south of town that the movement suites
// already use (`tests/sim.test.ts`, `tests/player_motion.test.ts`), far from
// every authored prop and well above water.

import { terrainHeight } from '../../src/sim/world';

/** Flat, dry, prop-free vale ground well clear of the town. */
export const OPEN_GROUND = { x: 0, z: -40 } as const;

interface TeleportableSim {
  player: {
    pos: { x: number; y: number; z: number };
    prevPos: { x: number; y: number; z: number };
    onGround: boolean;
    vx: number;
    vy: number;
    vz: number;
  };
  cfg: { seed: number };
}

/** Stand the sim's player on open ground, at rest. Returns the position. */
export function standOnOpenGround<T extends TeleportableSim>(sim: T): { x: number; z: number } {
  const p = sim.player;
  p.pos.x = OPEN_GROUND.x;
  p.pos.z = OPEN_GROUND.z;
  p.pos.y = terrainHeight(OPEN_GROUND.x, OPEN_GROUND.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  return { x: OPEN_GROUND.x, z: OPEN_GROUND.z };
}
