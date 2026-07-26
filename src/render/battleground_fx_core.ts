// Pure math + state classification for the Ravenrift flag/rune per-frame
// visuals (no Three, no DOM): the carried-flag lean and bob, the rune gem's
// spin and hover, and the flag state-transition classifier that decides which
// celebration burst plays. battleground_fx.ts is the thin Three consumer.
//
// Graphics fairness: the lean, the carrier ring, and the gem read identically
// on every tier (battleground_props builds them unconditionally); only the
// transient bursts ride the quality-scaled Vfx pool.

export type BgFlagState = 'home' | 'carried' | 'dropped';
export type BgFlagFxKind = 'pickup' | 'capture' | 'return';

// Carried flag: leaned back over the carrier's shoulder with a light jog bob.
export const BG_CARRY_TILT = 0.55; // radians off vertical
export const BG_CARRY_BOB_AMP = 0.07;
export const BG_CARRY_BOB_HZ = 2.1;

// Rune gem: a slow spin with a gentle hover so it reads as a pickup from afar.
export const BG_RUNE_SPIN_RADS = 0.9; // radians per second
export const BG_RUNE_BOB_AMP = 0.12;
export const BG_RUNE_BOB_HZ = 0.55;

/**
 * Classify a flag-state transition into the burst it earns. `prev` is null on
 * the first sighting (interest churn, match start): never a burst, the state
 * was not observed changing. A transition INTO 'carried' is a pickup wherever
 * it came from; 'carried' -> 'home' only happens on a capture and
 * 'dropped' -> 'home' only on a return, so the two are distinguishable from
 * state alone. A drop plays no burst: the banner plus the flag lying on the
 * ground carry that beat.
 */
export function classifyFlagTransition(
  prev: BgFlagState | null,
  next: BgFlagState,
): BgFlagFxKind | null {
  if (prev === null || prev === next) return null;
  if (next === 'carried') return 'pickup';
  if (next === 'home') return prev === 'carried' ? 'capture' : 'return';
  return null;
}

export function carriedLean(timeS: number): { tilt: number; bob: number } {
  return {
    tilt: BG_CARRY_TILT,
    bob: Math.abs(Math.sin(timeS * Math.PI * BG_CARRY_BOB_HZ)) * BG_CARRY_BOB_AMP,
  };
}

export function runeGemPose(timeS: number): { spin: number; bob: number } {
  return {
    spin: timeS * BG_RUNE_SPIN_RADS,
    bob: Math.sin(timeS * Math.PI * 2 * BG_RUNE_BOB_HZ) * BG_RUNE_BOB_AMP,
  };
}
