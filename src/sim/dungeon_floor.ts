// The dungeon interior floor's elevation profile: flat room floor plus the
// raised boss dais (see dungeon_layout.ts DAIS_HEIGHT). A pure leaf between
// data.ts (which dungeon an x-band belongs to, instance slot origins) and
// dungeon_layout.ts (the per-interior room plan), consumed by world.ts
// groundHeight so EVERY height consumer — mob y-snapping, spawns, loot,
// landings, ground AoEs, the chase camera — stands on the stage for free.
//
// Pure and deterministic: no rng, no wall clock, no sim state.

import { dungeonAt, INSTANCE_SLOT_COUNT, instanceOrigin } from './data';
import {
  CRYPT_LAYOUT,
  type DungeonLayout,
  daisLiftAt,
  NYTHRAXIS_LAYOUT,
  SANCTUM_LAYOUT,
  TEMPLE_LAYOUT,
} from './dungeon_layout';

/** Room plan per DungeonDef.interior key (colliders.ts derives its sets from
 *  the same map, so floor and walls can never disagree about the plan). */
export const INTERIOR_LAYOUTS: Record<string, DungeonLayout> = {
  crypt: CRYPT_LAYOUT,
  sanctum: SANCTUM_LAYOUT,
  temple: TEMPLE_LAYOUT,
  nythraxis: NYTHRAXIS_LAYOUT,
};

/** The dungeon instance (its def, layout, and slot origin) at a world point,
 *  or null outside every dungeon x-band. Shared by the floor query below and
 *  colliders.ts instance routing. */
export function dungeonInstanceAt(
  x: number,
  z: number,
): { interior: string; layout: DungeonLayout; ox: number; oz: number; dungeonId: string } | null {
  const dungeon = dungeonAt(x);
  if (!dungeon) return null;
  const index = dungeon.index;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < INSTANCE_SLOT_COUNT; i++) {
    const o = instanceOrigin(index, i);
    const d = Math.abs(z - o.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const o = instanceOrigin(index, best);
  const interior = dungeon.interior;
  return {
    interior,
    layout: INTERIOR_LAYOUTS[interior] ?? CRYPT_LAYOUT,
    ox: o.x,
    oz: o.z,
    dungeonId: dungeon.id,
  };
}

/**
 * How far the interior floor rises above the flat dungeon floor at a WORLD
 * point: DAIS_HEIGHT on a raised boss dais, zero everywhere else (including
 * every non-dungeon coordinate, so the open world and the delve/arena bands
 * are untouched by construction).
 */
export function dungeonFloorLift(x: number, z: number): number {
  const inst = dungeonInstanceAt(x, z);
  if (!inst) return 0;
  return daisLiftAt(inst.layout, x - inst.ox, z - inst.oz);
}
