// The character physics solver: the horizontal half of a real character
// controller, in the Unreal/Quake lineage, adapted exactly to this world's
// extruded-2D collision geometry and this sim's determinism rules.
//
// Per call it runs, in order:
//   1. DEPENETRATION  push the body out of anything it starts inside (a
//      teleport, a geometry swap, or float drift can leave it embedded).
//   2. SLIDE ITERATIONS  sweep the body along the remaining motion, advance to
//      the time of impact (minus a skin), then project what is left along the
//      contact plane and sweep again. Four passes resolve corners and creases
//      without the wall-sticking a single push-out pass produces.
//   3. STEP UP  when a blocking obstacle's top is within `stepHeight` of the
//      feet and is standable, lift the body onto it and keep the SAME
//      horizontal motion going. This is what makes small stones, kerbs, roots,
//      and low rubble something you stride over instead of bump into, with no
//      jump input and no vertical velocity: the defining feature of a modern
//      character controller.
//   4. TERRAIN GATE  the heightfield is not a collider: a step whose rise
//      exceeds the walkable slope is a wall, UNLESS the rise is inside
//      `stepHeight`, in which case it is a kerb and the body steps up. A
//      rejected uphill retries along the contour so a body slides across a
//      steep face instead of sticking to it.
//
// Determinism: pure functions of (world content, seed, pose, delta). No rng,
// no wall clock, no allocation in the steady state (module scratch is reused).
// The same code runs on the server Sim, the offline browser Sim, the headless
// RL env, and the client's display-only self extrapolator.
//
// Scope: the OPEN WORLD. Instanced interiors (dungeons, delves, arena, the
// Yumi maze) are flat-floored rooms of full-height walls where step-up has
// nothing to act on, so they stay on the long-standing `resolveMove` path and
// keep their behavior (and their tests) byte-identical.

import {
  type Collider,
  MANTLE_REACH,
  queryOpenWorldColliders,
  supportHeightAt,
} from '../colliders';
import { groundHeight, terrainDownhill, terrainSteepnessAt } from '../world';
import { overlapCollider, SKIN_WIDTH, sweepCollider } from './sweep';

/**
 * How high a walking body climbs without jumping (yards). At the player's
 * 2 yd body height this is 35 percent of stature: generous in the classic-MMO
 * tradition, and chosen against the measured world geometry so small field
 * stones and low rubble are strideable while crates and boulders still ask for
 * a jump. Pinned against the rock size model by tests/physics_character.test.ts.
 */
export const MAX_STEP_HEIGHT = 0.8;
/** Slide passes per move. Four resolves a corner (two planes) plus slack. */
const MAX_SLIDE_ITERATIONS = 4;
/** Depenetration passes when the body starts embedded. */
const MAX_DEPENETRATION_ITERATIONS = 4;
/** Height comparisons against a collider top. */
const TOP_EPS = 1e-3;
/** Motions below this are treated as zero. */
const MIN_MOTION = 1e-7;

export interface CharacterMoveParams {
  seed: number;
  /** Body radius (yards). */
  radius: number;
  /** How high the body climbs unaided (yards). */
  stepHeight: number;
  /** Walkable slope limit (rise over run), the terrain wall gate. */
  maxSlope: number;
  /** Step-up requires footing: an airborne body only passes over tops. */
  grounded: boolean;
  /** Jump arcs clear low fence rails (the long-standing fence rule). */
  ignoreFences: boolean;
}

export interface CharacterMoveResult {
  x: number;
  /** Feet height: raised when the body stepped up onto something. */
  y: number;
  z: number;
  /** True when a surface stopped or deflected the motion. */
  blocked: boolean;
  /** Total height gained by stepping up this move (0 when none). */
  stepped: number;
}

// Module scratch: this runs per body per tick and must not allocate.
const candidates: Collider[] = [];
const hit = { t: 0, nx: 0, nz: 0 };
const push = { nx: 0, nz: 0, depth: 0 };

/**
 * Does this collider block a body whose feet are at `feetY`?
 *
 * An AIRBORNE body gets the mantle assist over standable tops (the same
 * `MANTLE_REACH` allowance `colliders.ts` grants the legacy sweep): a jump
 * that falls just short of a crate rim still carries over it, and the vertical
 * pass then seats the body on top. Grounded bodies get no lift; they climb
 * only through step-up, which has its own, stricter gate.
 */
function blocksAt(c: Collider, feetY: number, params: CharacterMoveParams): boolean {
  if (params.ignoreFences && c.type === 'obb' && c.isFence) return false;
  if (c.moveTopY === undefined) return true; // full height: buildings, trees, walls
  const lift = !params.grounded && c.standable === true ? MANTLE_REACH : 0;
  return c.moveTopY > feetY + lift + TOP_EPS;
}

/** Can a grounded body climb onto this obstacle without jumping? */
function steppableAt(c: Collider, feetY: number, params: CharacterMoveParams): boolean {
  return (
    params.grounded &&
    c.standable === true &&
    c.moveTopY !== undefined &&
    c.moveTopY > feetY &&
    c.moveTopY - feetY <= params.stepHeight
  );
}

/** Is the body clear at (x, z) with its feet at `feetY`? Gates every step-up:
 *  climbing must never push the body into a wall or under an overhang. */
function isClear(x: number, z: number, feetY: number, params: CharacterMoveParams): boolean {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!blocksAt(c, feetY, params)) continue;
    if (overlapCollider(c, x, z, params.radius, push)) return false;
  }
  return true;
}

// Push the body out of everything it starts inside. Sequential minimum
// translations, capped: a body wedged in a crevice settles instead of jittering.
function depenetrate(
  x: number,
  z: number,
  feetY: number,
  params: CharacterMoveParams,
  out: { x: number; z: number },
): void {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < MAX_DEPENETRATION_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!blocksAt(c, feetY, params)) continue;
      if (!overlapCollider(c, px, pz, params.radius, push)) continue;
      px += push.nx * (push.depth + SKIN_WIDTH);
      pz += push.nz * (push.depth + SKIN_WIDTH);
      moved = true;
    }
    if (!moved) break;
  }
  out.x = px;
  out.z = pz;
}

const depen = { x: 0, z: 0 };

/**
 * Move a character body by (dx, dz), resolving collision with sliding and
 * step-up. Writes the resolved pose into `out`; never allocates.
 */
export function moveCharacter(
  params: CharacterMoveParams,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  out: CharacterMoveResult,
): void {
  out.x = x;
  out.y = y;
  out.z = z;
  out.blocked = false;
  out.stepped = 0;

  // Broadphase over the whole swept extent, padded by the body and the step
  // reach so a step-up's headroom test sees the same candidate set.
  const pad = params.radius + params.stepHeight + 1;
  candidates.length = 0;
  queryOpenWorldColliders(
    params.seed,
    Math.min(x, x + dx) - pad,
    Math.min(z, z + dz) - pad,
    Math.max(x, x + dx) + pad,
    Math.max(z, z + dz) + pad,
    candidates,
  );

  let feetY = y;
  depenetrate(x, z, feetY, params, depen);
  let px = depen.x;
  let pz = depen.z;
  let remX = dx;
  let remZ = dz;
  let blocked = false;
  let stepped = 0;

  for (let iter = 0; iter < MAX_SLIDE_ITERATIONS; iter++) {
    const len = Math.hypot(remX, remZ);
    if (len < MIN_MOTION) break;

    let bestT = Infinity;
    let bestIndex = -1;
    let bestNx = 0;
    let bestNz = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!blocksAt(c, feetY, params)) continue;
      if (!sweepCollider(c, px, pz, remX, remZ, params.radius, hit)) continue;
      if (hit.t < bestT) {
        bestT = hit.t;
        bestIndex = i;
        bestNx = hit.nx;
        bestNz = hit.nz;
      }
    }
    if (bestIndex < 0) {
      px += remX;
      pz += remZ;
      break;
    }

    // Advance to just short of contact, keeping the skin gap.
    const skinT = Math.min(bestT, SKIN_WIDTH / len);
    const advance = Math.max(0, bestT - skinT);
    px += remX * advance;
    pz += remZ * advance;
    remX *= 1 - advance;
    remZ *= 1 - advance;

    // Step up rather than stop, when the obstacle is a low standable ledge and
    // the body fits at the raised height. The horizontal motion continues
    // unchanged: no vertical velocity, no input, no pause.
    const blocker = candidates[bestIndex];
    if (steppableAt(blocker, feetY, params)) {
      const lifted = (blocker.moveTopY as number) + TOP_EPS;
      if (isClear(px, pz, lifted, params)) {
        stepped += lifted - feetY;
        feetY = lifted;
        continue;
      }
    }

    blocked = true;
    // Slide: strip the into-surface component from what is left.
    const into = remX * bestNx + remZ * bestNz;
    if (into < 0) {
      remX -= into * bestNx;
      remZ -= into * bestNz;
    } else {
      break; // already moving away; nothing left to resolve
    }
  }

  // Terrain gate. The heightfield is not in the collider set, so the walkable
  // slope rule is applied to the net move: an unwalkable rise is a wall unless
  // it is inside the step height, in which case the body steps onto it.
  const groundStart = groundHeight(x, z, params.seed);
  let groundEnd = groundHeight(px, pz, params.seed);
  const run = Math.hypot(px - x, pz - z);
  if (groundEnd > groundStart && run > 1e-5) {
    const rise = groundEnd - groundStart;
    const unwalkable =
      rise / run > params.maxSlope || terrainSteepnessAt(px, pz, params.seed) > params.maxSlope;
    // NOTE: step-up deliberately does NOT apply to the heightfield. A per-tick
    // step allowance on terrain is a cliff-climbing ladder: at 20 Hz a body
    // covers about 0.35 yd per tick, so allowing a step-height rise each tick
    // would raise the effective climb limit to stepHeight/0.35 (over 2.2) and
    // let players walk up faces the slope gate exists to forbid. Terrain keeps
    // the original wall rule exactly; step-up is for placed geometry (stones,
    // kerbs, low props), which is what the player actually gets stuck on.
    if (unwalkable) {
      // A wall. Rather than stick, slide along the contour: project the
      // attempted motion perpendicular to the downhill gradient and retry it
      // once. A body brushing a steep face keeps moving across it.
      blocked = true;
      const slope = terrainDownhill(x, z, params.seed);
      const gx = slope?.x ?? 0;
      const gz = slope?.z ?? 0;
      const glen = Math.hypot(gx, gz);
      px = x;
      pz = z;
      if (glen > 1e-6) {
        const ux = gx / glen;
        const uz = gz / glen;
        const along = dx * ux + dz * uz;
        const contourX = dx - along * ux;
        const contourZ = dz - along * uz;
        if (Math.hypot(contourX, contourZ) > MIN_MOTION) {
          const cx = x + contourX;
          const cz = z + contourZ;
          const contourGround = groundHeight(cx, cz, params.seed);
          const contourRise = contourGround - groundStart;
          const contourRun = Math.hypot(contourX, contourZ);
          const contourOk = contourRise <= 0 || contourRise / contourRun <= params.maxSlope;
          if (contourOk && isClear(cx, cz, feetY, params)) {
            px = cx;
            pz = cz;
          }
        }
      }
      groundEnd = groundHeight(px, pz, params.seed);
    }
  }

  out.x = px;
  out.z = pz;
  out.y = feetY;
  out.blocked = blocked;
  out.stepped = stepped;
}

/**
 * The surface the body rests on at (x, z): the terrain, or the highest
 * standable prop top no higher than `maxY`. This is the floor query the
 * vertical pass lands and snaps against.
 */
export function floorHeightAt(
  seed: number,
  x: number,
  z: number,
  radius: number,
  maxY: number,
): number {
  return Math.max(groundHeight(x, z, seed), supportHeightAt(seed, x, z, radius, maxY));
}
