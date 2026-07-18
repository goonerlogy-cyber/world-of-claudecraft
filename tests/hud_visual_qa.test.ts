import { describe, expect, it } from 'vitest';
import { hudVisualQaPartySize } from '../src/game/hud_visual_qa';

describe('hudVisualQaPartySize', () => {
  it('accepts only the supported party/raid screenshot sizes', () => {
    expect(hudVisualQaPartySize('?hudqa=3')).toBe(3);
    expect(hudVisualQaPartySize('?hudqa=5')).toBe(5);
    expect(hudVisualQaPartySize('?hudqa=10')).toBe(10);
    expect(hudVisualQaPartySize('?hudqa=4')).toBeNull();
    expect(hudVisualQaPartySize('')).toBeNull();
  });
});
