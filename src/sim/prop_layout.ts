// Layout and size of the SUB-PROPS that dress the world's composite props:
// the clutter around a market stall, the ore cart at a mine, the headstones in
// a graveyard. Plain data, shared by `src/sim/colliders.ts` (which turns it
// into collision) and `src/render/props.ts` (which places the models), exactly
// as `dungeon_layout.ts` is shared for interiors, so what you see and what you
// bump into cannot drift apart.
//
// Why this file had to exist: these objects were drawn as loose children of a
// parent group and never existed in the collision set at all, so a player
// walked straight through the anvils, barrels, carts, and every headstone in
// the graveyard. They are all waist-to-chest height, which is precisely the
// range a player expects to vault, mount, or be stopped by.
//
// HEIGHTS ARE MEASURED, not guessed: each `height` below is the shipped GLB's
// own bounding height multiplied by the scale the renderer places it at (the
// GLB paths are in `src/render/props.ts` `PROP_ASSET_DEFS`). Radii are the
// model's mean horizontal half-extent, trimmed slightly, because a forgiving
// footprint costs a player nothing while a too-tall collider reads as a bug.

/** One dressing prop, positioned in its parent's LOCAL frame (yards). */
export interface SubProp {
  /** Local offset from the parent prop's origin, before the parent's yaw. */
  x: number;
  z: number;
  /** Collider radius (yards). */
  r: number;
  /** Height above the parent's ground (yards). */
  height: number;
  /** Placement scale the renderer applies to the model. */
  scale: number;
}

// ---------------------------------------------------------------------------
// Market stall dressing (parent: PROPS.stalls, rotated by the stall's yaw)
// ---------------------------------------------------------------------------

/** Forge front: anvil and weapon rack (stalls flagged `smithy`). */
export const SMITHY_DRESSING: readonly SubProp[] = [
  // anvil.glb: 0.556 tall natively, placed at 1.35
  { x: 1.35, z: 1.15, r: 0.55, height: 0.75, scale: 1.35 },
  // weapon_stand.glb: 1.109 tall natively, placed at 1.25
  { x: -1.45, z: 0.6, r: 0.68, height: 1.39, scale: 1.25 },
];

/** Produce stall: an apple crate and a barrel (every non-smithy stall). */
export const STALL_DRESSING: readonly SubProp[] = [
  // farmcrate_apple.glb: 0.244 tall natively, placed at 1.5
  { x: 1.3, z: 1.05, r: 0.45, height: 0.37, scale: 1.5 },
  // barrel.glb: 0.898 tall natively, placed at 1.15
  { x: -1.35, z: 0.85, r: 0.4, height: 1.03, scale: 1.15 },
];

// ---------------------------------------------------------------------------
// Mine dressing (parent: PROPS.mines, unrotated local offsets)
// ---------------------------------------------------------------------------

/** The ore cart parked at a mine mouth. Tall enough to want climbing. */
export const MINE_CART: SubProp = {
  // cart.glb: 0.927 tall natively, placed at 1.9
  x: 2.8,
  z: 1.6,
  r: 0.62,
  height: 1.76,
  scale: 1.9,
};

// ---------------------------------------------------------------------------
// Graveyards (parent: PROPS.graveyards, unrotated grid of six stones)
// ---------------------------------------------------------------------------

/** Stones per graveyard, and the grid they sit on. */
export const GRAVE_COUNT = 6;
export const GRAVE_STRIDE_X = 2.2;
export const GRAVE_STRIDE_Z = 2.6;
/**
 * Placement scale. The renderer jitters this by up to +/-0.25 for variety;
 * collision uses the mean, which the radius comfortably covers.
 */
export const GRAVE_SCALE = 2.25;
/**
 * Native heights of the four headstone models, in the order the renderer
 * cycles them. Collision always uses this full set even though the LOW
 * graphics tier draws only the round stone: graphics settings are
 * gameplay-neutral, so what blocks a player must not depend on their preset.
 */
export const GRAVE_NATIVE_HEIGHTS: readonly number[] = [
  0.575, // gravestone_round
  0.915, // gravestone_cross (the tall one)
  0.529, // gravestone_bevel
  0.594, // gravestone_decorative
];
/** Headstone collider radius (they are thin slabs; keep it forgiving). */
export const GRAVE_RADIUS = 0.42;

/** World height of the i-th headstone in a graveyard. */
export function graveHeight(i: number): number {
  return GRAVE_NATIVE_HEIGHTS[i % GRAVE_NATIVE_HEIGHTS.length] * GRAVE_SCALE;
}

/** Local grid offset of the i-th headstone. */
export function graveOffset(i: number): { x: number; z: number } {
  return { x: (i % 3) * GRAVE_STRIDE_X, z: Math.floor(i / 3) * GRAVE_STRIDE_Z };
}
