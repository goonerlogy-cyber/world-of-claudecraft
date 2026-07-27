// Orkadia orc war-camp dungeon (src/sim/content/orkadia.ts): a hand-authored
// classic DungeonDef placed in the Drakelands, reusing the tested Sanctum room
// geometry/colliders under a green/black `orkadia` interior grade. Pins the
// content wiring (def fields, entrance zone, the three orc mobs, the boss kit),
// the entry lifecycle (spawns the roster incl. the warlord), and the Book of
// Deeds pair, so a future edit that drops any of them reds here.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { DEEDS } from '../src/sim/content/deeds';
import { ORKADIA_DUNGEON_DEFS, ORKADIA_MOBS } from '../src/sim/content/orkadia';
import {
  ARENA_X,
  BUILTIN_WORLD,
  DELVE_BAND_X_MIN,
  DUNGEONS,
  dungeonAt,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
  MOBS,
  zoneAt,
} from '../src/sim/data';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const ORKADIA_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(seed = 77): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: ORKADIA_TEST_WORLD });
}

describe('Orkadia dungeon content', () => {
  it('registers the dungeon with the orc-themed interior and a Drakelands entrance', () => {
    const def = DUNGEONS.orkadia;
    expect(def).toBeDefined();
    expect(def.name).toBe('Orkadia');
    expect(def.interior).toBe('orkadia');
    expect(def.index).toBe(6);
    expect(def.suggestedPlayers).toBe(5);
    // The entrance door sits inside the Drakelands rectangle.
    expect(zoneAt(def.doorPos.x, def.doorPos.z).id).toBe('drakelands');
    // index is unique across the whole live dungeon table.
    const indices = Object.values(DUNGEONS).map((d) => d.index);
    expect(indices.filter((i) => i === def.index)).toHaveLength(1);
  });

  it('defines exactly the three orc creatures and reaches the global MOBS table', () => {
    expect(Object.keys(ORKADIA_MOBS).sort()).toEqual([
      'orkadia_grunt',
      'orkadia_marauder',
      'orkadia_warlord',
    ]);
    for (const id of Object.keys(ORKADIA_MOBS)) {
      expect(MOBS[id], `${id} reaches MOBS`).toBeDefined();
      expect(MOBS[id].family).toBe('humanoid');
    }
  });

  it('makes the warlord a boss with a Warstomp nova and an enrage', () => {
    const boss = MOBS.orkadia_warlord;
    expect(boss.boss).toBe(true);
    expect(boss.ccImmune).toBe(true);
    expect(boss.aoePulse?.name).toBe('Warstomp');
    expect(boss.enrage?.belowHpPct).toBe(0.3);
    // trash grunts and marauders are NOT bosses.
    expect(MOBS.orkadia_grunt.boss).toBeUndefined();
    expect(MOBS.orkadia_marauder.boss).toBeUndefined();
  });

  it('spawns only orc mobs, and the warlord exactly once, sitting last on the dais', () => {
    const spawns = ORKADIA_DUNGEON_DEFS.orkadia.spawns;
    for (const s of spawns) expect(s.mobId.startsWith('orkadia_')).toBe(true);
    const bosses = spawns.filter((s) => s.mobId === 'orkadia_warlord');
    expect(bosses).toHaveLength(1);
    // the boss is the deepest spawn (largest z) in the run.
    const maxZ = Math.max(...spawns.map((s) => s.z));
    expect(bosses[0].z).toBe(maxZ);
  });

  it('spawns the full roster (including the warlord) when a party claims the instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Alpha');
    expect(enterDungeon(sim.ctx, 'orkadia', pid)).toBe(true);
    const inst = (
      sim.instances as { dungeonId: string; partyKey: unknown; mobIds: number[] }[]
    ).find((i) => i.dungeonId === 'orkadia' && i.partyKey !== null);
    expect(inst, 'orkadia instance claimed').toBeDefined();
    const templates = inst!.mobIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e)
      .map((e) => e.templateId);
    expect(templates).toContain('orkadia_warlord');
    expect(templates).toContain('orkadia_grunt');
    expect(templates).toContain('orkadia_marauder');
    // every spawned mob is an orc.
    for (const t of templates) expect(t.startsWith('orkadia_')).toBe(true);
  });

  it('classifies its instance origin as a dungeon, not the arena band (pitch-black-room regression)', () => {
    // Root cause of the "Orkadia renders completely black, no lights" bug: index 6
    // puts the instance origin at ARENA_X + 300, past the arena anchor (ARENA_X)
    // but still west of the delve band. The old wide arena band (ARENA_X_MIN up to
    // the delve band) swallowed it, so dungeonAt() returned null: the renderer took
    // the arena branch and never built the interior (no geometry, no torch lights),
    // and the collider resolver routed the player against ARENA_COLLIDERS instead of
    // the Orkadia (Sanctum) set. The origin must classify as the Orkadia dungeon.
    const origin = instanceOrigin(DUNGEONS.orkadia.index, 0);
    expect(origin.x).toBeGreaterThan(ARENA_X); // sits past the arena anchor...
    expect(origin.x).toBeLessThan(DELVE_BAND_X_MIN); // ...but west of the delve band
    expect(dungeonAt(origin.x)?.id).toBe('orkadia');
    expect(dungeonAt(origin.x)?.interior).toBe('orkadia');
    expect(isArenaPos(origin.x)).toBe(false);
    expect(isDelvePos(origin.x)).toBe(false);
  });

  it('resolves collision against its own interior colliders, not the arena', () => {
    // A point buried in the Sanctum-derived side wall (instance-local |x| = 23,
    // deep along z where only the dungeon side wall exists, not the short arena
    // wall) must be pushed back out. Under the classification bug this position
    // routed to ARENA_COLLIDERS ~300u away and moved not at all (the player clipped
    // straight through Orkadia's walls into a black void).
    const origin = instanceOrigin(DUNGEONS.orkadia.index, 0);
    const wallPoint = { x: origin.x + 23, z: origin.z + 100 };
    const resolved = resolvePosition(1, wallPoint.x, wallPoint.z, 1);
    const moved = Math.hypot(resolved.x - wallPoint.x, resolved.z - wallPoint.z);
    expect(moved).toBeGreaterThan(0.5); // collision fired: the Orkadia colliders are live
  });

  it('authors the Book of Deeds clear pair targeting the dungeon', () => {
    expect(DEEDS.dgn_orkadia.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'orkadia',
      count: 1,
    });
    expect(DEEDS.dgn_orkadia_heroic.trigger).toEqual({
      kind: 'dungeonClears',
      dungeonId: 'orkadia',
      difficulty: 'heroic',
      count: 1,
    });
    expect(DEEDS.dgn_orkadia.category).toBe('dungeon');
  });
});
