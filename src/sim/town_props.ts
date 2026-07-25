// The town's furniture: profession-station clusters and Artisan Row, as sim
// data so the player can actually bump into them.
//
// These objects used to be drawn entirely inside the render layer
// (`stations_core.ts` owned the cluster offsets, `artisan_row_props.ts` the
// row placements), which the sim cannot import. The result was the single
// biggest collision gap in the game: a couple of dozen solid, waist-to-chest
// objects standing in the starting town that a player walked straight
// through, including anvils, looms, workbenches, barrels and crates that are
// visually identical to the `PROPS.crates` barrels a few yards away that DO
// block. Moving the layout here and letting the renderer read it back is the
// same fix `decoration_dims.ts` applied to rocks: one owner, no drift.
//
// SIZES ARE MEASURED from the shipped GLBs (their authored target heights and
// bounding footprints), not guessed. Radii are the mean horizontal half-extent
// trimmed slightly: a forgiving footprint costs a player nothing, while a
// collider taller or wider than its model reads as a bug.
//
// Everything here is standable except open flame, so the whole set is part of
// the traversal ladder: stride the low, vault the mid, climb the tall.

/** Physical size of one piece of town furniture. */
export interface TownPropSize {
  /** Height above its ground (yards). */
  height: number;
  /** Collider radius (yards). */
  r: number;
  /** May a body stand on top? False only for open flame. */
  standable: boolean;
}

export type StationPropKind =
  | 'anvil'
  | 'campfire'
  | 'cauldron'
  | 'tanningRack'
  | 'loom'
  | 'workbench'
  | 'crate'
  | 'barrel';

export const STATION_PROP_SIZES: Readonly<Record<StationPropKind, TownPropSize>> = {
  anvil: { height: 0.75, r: 0.5, standable: true },
  // The station campfire matches the world campfires: a jump clears it, a walk
  // does not, and nobody stands in the fire.
  campfire: { height: 0.45, r: 0.7, standable: false },
  cauldron: { height: 0.9, r: 0.37, standable: true },
  tanningRack: { height: 1.5, r: 0.55, standable: true },
  loom: { height: 1.3, r: 0.72, standable: true },
  workbench: { height: 1.0, r: 0.49, standable: true },
  crate: { height: 0.65, r: 0.31, standable: true },
  barrel: { height: 0.85, r: 0.33, standable: true },
};

export type StationType = 'forge' | 'kitchens' | 'apothecary' | 'tannery' | 'loom' | 'toolworks';

export interface StationClusterProp {
  kind: StationPropKind;
  dx: number;
  dz: number;
  rot: number;
}

// Per-type clusters: the anchor prop sits ON the station pos (dx/dz 0) so
// the spot the proximity gate measures from is the spot the player sees.
// Clutter offsets stay within ~1.5 yd and avoid each master NPC's side.
export const STATION_PROP_CLUSTERS: Readonly<Record<StationType, readonly StationClusterProp[]>> = {
  forge: [
    { kind: 'anvil', dx: 0, dz: 0, rot: 0.9 },
    { kind: 'barrel', dx: -1.1, dz: 1.0, rot: 0.3 },
    { kind: 'crate', dx: 1.0, dz: -1.2, rot: -0.5 },
  ],
  kitchens: [
    { kind: 'campfire', dx: 0, dz: 0, rot: 0 },
    { kind: 'crate', dx: 1.2, dz: 0.5, rot: 0.7 },
    { kind: 'barrel', dx: -0.5, dz: 1.4, rot: -0.2 },
  ],
  apothecary: [
    { kind: 'cauldron', dx: 0, dz: 0, rot: -0.4 },
    { kind: 'crate', dx: -1.3, dz: 0.5, rot: 0.4 },
    { kind: 'barrel', dx: 0.9, dz: 1.2, rot: 0.9 },
  ],
  tannery: [
    { kind: 'tanningRack', dx: 0, dz: 0, rot: 0.3 },
    { kind: 'barrel', dx: -1.3, dz: 0.7, rot: -0.6 },
    { kind: 'crate', dx: 0.5, dz: -1.4, rot: 1.1 },
  ],
  loom: [
    { kind: 'loom', dx: 0, dz: 0, rot: 0.6 },
    { kind: 'crate', dx: 1.3, dz: 0.6, rot: -0.3 },
    { kind: 'barrel', dx: 0.4, dz: 1.5, rot: 0.5 },
  ],
  toolworks: [
    { kind: 'workbench', dx: 0, dz: 0, rot: -0.4 },
    { kind: 'crate', dx: 1.2, dz: 0.8, rot: 0.2 },
    { kind: 'barrel', dx: -1.0, dz: 1.1, rot: -0.8 },
  ],
};

export type ArtisanPropKind =
  | 'engineering_workbench'
  | 'alchemy_cauldron'
  | 'cooking_spit'
  | 'leatherworking_rack'
  | 'tailoring_loom'
  | 'inscription_lectern'
  | 'enchanting_altar'
  | 'jewelcrafting_bench'
  | 'mining_ore_cart'
  | 'herbalism_drying_rack';

export const ARTISAN_PROP_SIZES: Readonly<Record<ArtisanPropKind, TownPropSize>> = {
  engineering_workbench: { height: 1.0, r: 0.49, standable: true },
  alchemy_cauldron: { height: 0.9, r: 0.37, standable: true },
  cooking_spit: { height: 0.85, r: 0.4, standable: true },
  leatherworking_rack: { height: 1.5, r: 0.55, standable: true },
  tailoring_loom: { height: 1.3, r: 0.72, standable: true },
  inscription_lectern: { height: 1.1, r: 0.33, standable: true },
  enchanting_altar: { height: 1.0, r: 0.28, standable: true },
  jewelcrafting_bench: { height: 0.9, r: 0.32, standable: true },
  mining_ore_cart: { height: 1.1, r: 0.53, standable: true },
  herbalism_drying_rack: { height: 1.4, r: 0.6, standable: true },
};

export interface ArtisanPlacement {
  kind: ArtisanPropKind;
  x: number;
  z: number;
  rot: number;
}

// Fixed placements around Smith Haldren's market stall (zone1, stall at
// x=9.5 z=17.5), arced clear of his stall footprint (r=1.7) and the house at
// x=10 z=12. Hand-authored landmark, not procedural scatter, so exact spots
// matter more than deterministic variety.
export const ARTISAN_ROW_PLACEMENTS: readonly ArtisanPlacement[] = [
  { kind: 'engineering_workbench', x: 2, z: 20, rot: 0.4 },
  { kind: 'alchemy_cauldron', x: 5, z: 23, rot: -0.6 },
  { kind: 'cooking_spit', x: 9, z: 25, rot: 0 },
  { kind: 'leatherworking_rack', x: 13, z: 24, rot: 0.9 },
  // Nudged off the northeast ruins road: both now sit past 4.0.
  { kind: 'tailoring_loom', x: 13.5, z: 20.5, rot: 1.6 },
  { kind: 'inscription_lectern', x: 19.5, z: 14.5, rot: 2.4 },
  { kind: 'enchanting_altar', x: 16, z: 13, rot: -2.6 },
  { kind: 'jewelcrafting_bench', x: 15, z: 9, rot: -1.8 },
  { kind: 'mining_ore_cart', x: 3, z: 12, rot: -0.9 },
  { kind: 'herbalism_drying_rack', x: 1, z: 16, rot: 0.3 },
];

/** One piece of town furniture resolved into world space. */
export interface TownPropPlacement {
  x: number;
  z: number;
  size: TownPropSize;
}

/**
 * Never wall off an NPC. Some station anchors sit at the exact position of
 * their master (the Eastbrook forge and Smith Haldren share a spot, so the
 * anvil is DRAWN inside him): giving that a collider would push players out
 * of talking range of a quest giver. A prop standing on a person is a content
 * overlap to look at, never a wall to enforce.
 */
const NPC_CLEARANCE = 0.4;

function standsOnAnNpc(x: number, z: number, r: number, npcs: readonly TownNpcPos[]): boolean {
  for (const n of npcs) {
    if (Math.hypot(n.x - x, n.z - z) < r + NPC_CLEARANCE) return true;
  }
  return false;
}

export interface TownNpcPos {
  x: number;
  z: number;
}

export interface TownStationAnchor {
  type: string;
  x: number;
  z: number;
}

/**
 * Every collidable piece of town furniture, in world space, with the
 * NPC guard applied. Callers pass the station anchors and the NPC positions
 * so this module stays a pure leaf; `colliders.ts` supplies the live ones and
 * the tests supply the same, which is what keeps the two in agreement.
 */
export function townPropPlacements(
  stations: readonly TownStationAnchor[],
  npcs: readonly TownNpcPos[],
): TownPropPlacement[] {
  const out: TownPropPlacement[] = [];
  for (const st of stations) {
    const cluster = STATION_PROP_CLUSTERS[st.type as StationType];
    if (!cluster) continue;
    for (const prop of cluster) {
      const size = STATION_PROP_SIZES[prop.kind];
      const x = st.x + prop.dx;
      const z = st.z + prop.dz;
      if (standsOnAnNpc(x, z, size.r, npcs)) continue;
      out.push({ x, z, size });
    }
  }
  for (const a of ARTISAN_ROW_PLACEMENTS) {
    const size = ARTISAN_PROP_SIZES[a.kind];
    if (standsOnAnNpc(a.x, a.z, size.r, npcs)) continue;
    out.push({ x: a.x, z: a.z, size });
  }
  return out;
}
