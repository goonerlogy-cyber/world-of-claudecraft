// Ledge detection for the climb (mantle) move: can this body, mid-jump, get
// its hands on something above it and pull up?
//
// The traversal ladder this completes, by how high the obstacle is above the
// feet:
//   below MAX_STEP_HEIGHT      the body strides over it, no input      (step)
//   up to MANTLE_REACH airborne a jump arc carries it over the rim     (vault)
//   up to LEDGE_GRAB_MAX       a jump GRABS it and climbs up           (climb)
//   above that                 it is a wall
//
// Everything here is a pure query against the same extruded-2D collider set
// and heightfield the solver uses, so a climb can only ever start onto a
// surface the body could legitimately stand on: a standable prop top (crate,
// rock, cart, low wall) or walkable terrain. It never grabs a full-height
// blocker, never grabs into an overhang, and never grabs a surface the body
// would not fit on.
//
// No rng, no wall clock, no allocation beyond the single result object the
// caller owns.

import { type Collider, queryOpenWorldColliders, supportHeightAt } from '../colliders';
import { groundHeight, terrainSteepnessAt } from '../world';

/** A ledge must be at least this far above the feet, or it is a step. */
export const LEDGE_GRAB_MIN = 0.9;
/**
 * Arms-extended reach above the feet (yards). At the player's 2 yd stature
 * this is chest-to-overhead: combined with a jump apex near 1.1 yd it puts
 * ledges up to roughly 2.7 yd above the launch ground within climbing range,
 * which covers rocks, carts, low walls, and the lower structures of a town.
 */
export const LEDGE_GRAB_MAX = 1.6;
/** How far ahead of the body's leading edge the hands can reach (yards). */
export const LEDGE_GRAB_FORWARD = 0.5;
/** Clearance a body needs above a ledge to be allowed to climb onto it. */
export const LEDGE_HEADROOM = 1.1;

export interface LedgeGrab {
  /** Surface height the body climbs onto. */
  topY: number;
  /** Where it ends up standing. */
  x: number;
  z: number;
}

const candidates: Collider[] = [];
const result: LedgeGrab = { topY: 0, x: 0, z: 0 };

export interface LedgeQuery {
  seed: number;
  radius: number;
  /** Facing, sim convention: forward is (sin f, cos f). */
  facing: number;
  /** Horizontal velocity; when meaningful it beats facing as the intent. */
  vx: number;
  vz: number;
}

// Is the body clear at (x, z) with its feet on `feetY`, allowing for the
// headroom a climb needs? Anything whose top rises above the feet blocks.
function fitsOn(x: number, z: number, feetY: number, radius: number): boolean {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.moveTopY !== undefined && c.moveTopY <= feetY + 1e-3) continue;
    if (c.type === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      const reach = c.r + radius;
      if (dx * dx + dz * dz < reach * reach) return false;
    } else {
      const cos = Math.cos(-c.rot);
      const sin = Math.sin(-c.rot);
      const lx = (x - c.x) * cos + (z - c.z) * sin;
      const lz = -(x - c.x) * sin + (z - c.z) * cos;
      if (Math.abs(lx) < c.hw + radius && Math.abs(lz) < c.hd + radius) return false;
    }
  }
  return true;
}

/**
 * Find a ledge this airborne body can grab and climb onto, or null.
 *
 * The probe runs along the body's intent (velocity when it is moving with
 * purpose, otherwise where it is looking), one body-radius plus a reach
 * ahead. Only a surface strictly higher than a step and no higher than the
 * arms can reach counts, and it must be somewhere the body actually fits.
 */
export function findLedgeGrab(q: LedgeQuery, x: number, y: number, z: number): LedgeGrab | null {
  // Intent direction: real motion wins, because a body drifting sideways past
  // a wall should not snap onto whatever it happens to be facing.
  const speed = Math.hypot(q.vx, q.vz);
  const dirX = speed > 0.5 ? q.vx / speed : Math.sin(q.facing);
  const dirZ = speed > 0.5 ? q.vz / speed : Math.cos(q.facing);

  const reach = q.radius + LEDGE_GRAB_FORWARD;
  const px = x + dirX * reach;
  const pz = z + dirZ * reach;
  const minY = y + LEDGE_GRAB_MIN;
  const maxY = y + LEDGE_GRAB_MAX;

  candidates.length = 0;
  const pad = q.radius + LEDGE_GRAB_FORWARD + 1;
  queryOpenWorldColliders(q.seed, px - pad, pz - pad, px + pad, pz + pad, candidates);

  // The best surface under the hands: a standable prop top, or the terrain
  // itself where it steps up (a natural ledge or a bank).
  const propTop = supportHeightAt(q.seed, px, pz, q.radius, maxY);
  const ground = groundHeight(px, pz, q.seed);
  let topY = -Infinity;
  if (propTop >= minY && propTop <= maxY) topY = propTop;
  if (
    ground > topY &&
    ground >= minY &&
    ground <= maxY &&
    // Only onto ground a body could stand on: a cliff face is not a ledge.
    terrainSteepnessAt(px, pz, q.seed) <= 1.5
  ) {
    topY = ground;
  }
  if (topY === -Infinity) return null;

  // The body must fit where it is going to end up, with room over its head.
  if (!fitsOn(px, pz, topY + 1e-3, q.radius)) return null;
  if (!fitsOn(px, pz, topY + LEDGE_HEADROOM, q.radius)) return null;

  result.topY = topY;
  result.x = px;
  result.z = pz;
  return result;
}
