// The ability sample seam (src/game/ability_sfx_samples.ts): per-take
// normalization math, cached beef-bus saturation curves, and strict
// round-robin take selection (no consecutive repeats).
//
// No sampled pack ships yet, so the "does the shipped pack carry every routed
// id" coverage suite is deliberately absent: it belongs with the pack, in the
// change that lands the takes as conformed MP3s through scripts/sfx/. The
// routing tables themselves are still pinned below.
import { describe, expect, it } from 'vitest';
import {
  AbilitySfxSamples,
  beefCurve,
  MOTIF_SAMPLE,
  normalizeTakeGain,
  RELEASE_FAMILY,
  SPIRIT_VOICE,
} from '../src/game/ability_sfx_samples';

describe('per-take peak normalization (gallery loadPack)', () => {
  it('pulls takes toward the 0.8 target peak', () => {
    expect(normalizeTakeGain(0.8)).toBeCloseTo(1);
    expect(normalizeTakeGain(0.4)).toBeCloseTo(2);
    expect(normalizeTakeGain(1.6)).toBeCloseTo(0.5);
  });

  it('caps boost at 2.5x and never boosts near-silence into noise', () => {
    expect(normalizeTakeGain(0.05)).toBe(2.5);
    expect(normalizeTakeGain(0.01)).toBe(1);
    expect(normalizeTakeGain(0)).toBe(1);
  });
});

describe('beef-bus saturation curves (gallery _beefCurve)', () => {
  it('caches per quantized drive amount', () => {
    expect(beefCurve(0.3)).toBe(beefCurve(0.3));
    expect(beefCurve(0.3)).toBe(beefCurve(0.31)); // same round(amount * 20) bucket
    expect(beefCurve(0.3)).not.toBe(beefCurve(0.45));
  });

  it('is a bounded, endpoint-normalized, monotonic transfer curve', () => {
    const curve = beefCurve(0.45);
    expect(curve).toHaveLength(1024);
    expect(curve[0]).toBeCloseTo(-1, 3);
    expect(curve[1023]).toBeCloseTo(1, 3);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
      expect(Math.abs(curve[i])).toBeLessThanOrEqual(1);
    }
  });
});

describe('round-robin take selection (gallery sample())', () => {
  const fakeBufs = (n: number) =>
    Array.from({ length: n }, (_take, i) => ({ duration: 0.5 + i }) as AudioBuffer);

  it('never plays the same multi-take id twice in a row', () => {
    const samples = new AbilitySfxSamples();
    samples.install('imp_storm', fakeBufs(3), [1, 1.2, 0.9]);
    let previous = samples.pick('imp_storm');
    for (let play = 0; play < 20; play++) {
      const take = samples.pick('imp_storm');
      expect(take).not.toBeNull();
      expect(take?.buf).not.toBe(previous?.buf);
      previous = take;
    }
  });

  it('cycles every take with its own normalization gain', () => {
    const samples = new AbilitySfxSamples();
    const bufs = fakeBufs(3);
    samples.install('rel_fire', bufs, [1, 2, 3]);
    const seen = new Set<number>();
    for (let play = 0; play < 3; play++) {
      const take = samples.pick('rel_fire');
      expect(take).not.toBeNull();
      if (take) {
        expect(take.gain).toBe(bufs.indexOf(take.buf) + 1);
        seen.add(take.gain);
      }
    }
    expect(seen.size).toBe(3);
    expect(samples.loaded).toBe(true);
  });

  it('returns null for ids the pack does not carry', () => {
    const samples = new AbilitySfxSamples();
    expect(samples.pick('imp_missing')).toBeNull();
    expect(samples.loaded).toBe(false);
    expect(samples.state).toBe('idle');
  });
});

describe('the routing tables the sampled layer will bind to', () => {
  it('maps a release family for all 12 palettes', () => {
    expect(Object.keys(RELEASE_FAMILY)).toHaveLength(12);
    for (const family of Object.values(RELEASE_FAMILY)) {
      expect(family, 'release family id').toMatch(/^[a-z_]+$/);
    }
  });

  it('maps every motif to a snake_case foley id', () => {
    expect(Object.keys(MOTIF_SAMPLE).length).toBeGreaterThan(0);
    for (const [motif, id] of Object.entries(MOTIF_SAMPLE)) {
      expect(id, motif).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('mixes every spirit voice at a sane level', () => {
    for (const [model, [gain]] of Object.entries(SPIRIT_VOICE)) {
      expect(gain, model).toBeGreaterThan(0);
      expect(gain, model).toBeLessThanOrEqual(1);
    }
  });
});
