// The Ravenrift flag/rune per-frame visual core (src/render/battleground_fx_core.ts):
// the transition classifier that picks celebration bursts, and the carried-lean /
// rune-gem pose math the thin Three consumer (battleground_fx.ts) applies.
import { describe, expect, it } from 'vitest';
import {
  BG_CARRY_BOB_AMP,
  BG_CARRY_TILT,
  BG_RUNE_BOB_AMP,
  carriedLean,
  classifyFlagTransition,
  runeGemPose,
} from '../src/render/battleground_fx_core';

describe('classifyFlagTransition', () => {
  it('maps every state pair to exactly the right burst', () => {
    // First sighting is never a burst: the change was not observed.
    expect(classifyFlagTransition(null, 'home')).toBeNull();
    expect(classifyFlagTransition(null, 'carried')).toBeNull();
    expect(classifyFlagTransition(null, 'dropped')).toBeNull();
    // No-change frames are silent.
    expect(classifyFlagTransition('home', 'home')).toBeNull();
    expect(classifyFlagTransition('carried', 'carried')).toBeNull();
    expect(classifyFlagTransition('dropped', 'dropped')).toBeNull();
    // Into carried: a pickup from the stand or from the ground.
    expect(classifyFlagTransition('home', 'carried')).toBe('pickup');
    expect(classifyFlagTransition('dropped', 'carried')).toBe('pickup');
    // Into home: only a capture ends a carry, only a return ends a drop.
    expect(classifyFlagTransition('carried', 'home')).toBe('capture');
    expect(classifyFlagTransition('dropped', 'home')).toBe('return');
    // A drop plays no burst (the banner + the grounded flag carry the beat).
    expect(classifyFlagTransition('carried', 'dropped')).toBeNull();
    // home -> dropped cannot happen in the sim; the classifier stays silent.
    expect(classifyFlagTransition('home', 'dropped')).toBeNull();
  });
});

describe('pose math', () => {
  it('carried lean: constant tilt, bob bounded and always upward', () => {
    for (const t of [0, 0.1, 0.25, 1.3, 7.77, 100]) {
      const lean = carriedLean(t);
      expect(lean.tilt).toBe(BG_CARRY_TILT);
      expect(lean.bob).toBeGreaterThanOrEqual(0);
      expect(lean.bob).toBeLessThanOrEqual(BG_CARRY_BOB_AMP + 1e-9);
    }
  });

  it('rune gem: spin advances monotonically, hover stays bounded', () => {
    let prevSpin = Number.NEGATIVE_INFINITY;
    for (const t of [0, 0.5, 1, 2, 5, 30]) {
      const pose = runeGemPose(t);
      expect(pose.spin).toBeGreaterThan(prevSpin);
      prevSpin = pose.spin;
      expect(Math.abs(pose.bob)).toBeLessThanOrEqual(BG_RUNE_BOB_AMP + 1e-9);
    }
  });
});
