import { describe, expect, it } from 'vitest';
import { targetOfTargetEntityId } from '../src/ui/target_of_target';

describe('targetOfTargetEntityId', () => {
  it('uses the authoritative aggro victim for mobs, pets, and combat NPCs', () => {
    expect(
      targetOfTargetEntityId({
        kind: 'mob',
        targetId: null,
        aggroTargetId: 42,
      }),
    ).toBe(42);
    expect(
      targetOfTargetEntityId({
        kind: 'npc',
        targetId: null,
        aggroTargetId: 7,
      }),
    ).toBe(7);
  });

  it('uses another player’s selected target when that state is available', () => {
    expect(
      targetOfTargetEntityId({
        kind: 'player',
        targetId: 19,
        aggroTargetId: 3,
      }),
    ).toBe(19);
  });

  it('hides the chip for no target, world objects, and units with no target', () => {
    expect(targetOfTargetEntityId(null)).toBeNull();
    expect(
      targetOfTargetEntityId({
        kind: 'object',
        targetId: 2,
        aggroTargetId: 2,
      }),
    ).toBeNull();
    expect(
      targetOfTargetEntityId({
        kind: 'mob',
        targetId: null,
        aggroTargetId: null,
      }),
    ).toBeNull();
  });
});
