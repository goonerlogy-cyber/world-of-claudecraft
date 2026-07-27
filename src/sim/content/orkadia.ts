// Orkadia: a hand-authored orc war-camp dungeon dug into the black volcanic
// rock of the Drakelands, its halls lit by toxic-green warpyres. The overworld
// entrance is a skull-and-tusk gate near the Trollmoot raiding camp; inside, the
// green/black `orkadia` interior grade reuses the tested Sanctum room geometry
// and collider set (see src/render/dungeon.ts `orkadia` variant and
// INTERIOR_COLLIDERS in src/sim/colliders.ts), so what you see is what you
// collide with.
//
// Three orc creatures (the black_orc / blue_orc / red_orc Tripo GLBs) crew the
// camp: the Bloodtusk Grunt line packs, the heavier Ironhide Marauder elites,
// and Warlord Grommok Skullcleaver on the far dais. Mob display names are
// re-localized on the client via the entity_i18n matcher (English lives here).
import type { DungeonDef, DungeonSpawn, MobTemplate } from '../types';

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
export const ORKADIA_MOBS: Record<string, MobTemplate> = {
  // Trash line (black_orc.glb): the war-camp rank and file, in pairs.
  orkadia_grunt: {
    id: 'orkadia_grunt',
    name: 'Bloodtusk Grunt',
    minLevel: 18,
    maxLevel: 19,
    family: 'humanoid',
    elite: true,
    hpBase: 60,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.2,
    armorPerLevel: 21,
    moveSpeed: 6.6,
    aggroRadius: 12,
    componentTags: ['hide'],
    loot: [{ copper: 260, chance: 1 }],
    scale: 1.7,
    color: 0x3a4a2e, // mossy green-black warhide
  },
  // Heavier elite (blue_orc.glb): the camp's iron-shielded shock troops.
  orkadia_marauder: {
    id: 'orkadia_marauder',
    name: 'Ironhide Marauder',
    minLevel: 19,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    hpBase: 84,
    hpPerLevel: 26,
    dmgBase: 15,
    dmgPerLevel: 2.9,
    attackSpeed: 2.5,
    armorPerLevel: 27,
    moveSpeed: 6.4,
    aggroRadius: 13,
    componentTags: ['hide'],
    loot: [{ copper: 420, chance: 1 }],
    scale: 1.9,
    color: 0x35506a, // steel-blue plate over green hide
  },
  // Boss (red_orc.glb): Warlord Grommok Skullcleaver on the dais. A Warstomp
  // nova plus an enrage under 30%, mirroring the Gravewyrm Sanctum boss shape.
  orkadia_warlord: {
    id: 'orkadia_warlord',
    name: 'Warlord Grommok Skullcleaver',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    boss: true,
    ccImmune: true,
    hpBase: 440,
    hpPerLevel: 50,
    dmgBase: 16,
    dmgPerLevel: 3.1,
    attackSpeed: 2.6,
    armorPerLevel: 34,
    moveSpeed: 7,
    aggroRadius: 18,
    aoePulse: { min: 28, max: 40, radius: 13, every: 9, name: 'Warstomp' },
    knockback: { chance: 0.2, distance: 6, name: 'Skull Cleave' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    yells: {
      engage: 'Orkadia does not kneel! For the black banners!',
      enrage: 'BLEED FOR THE WARLORD!',
    },
    loot: [
      { copper: 50000, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.8 },
      { itemId: 'wyrmfang_greatblade', chance: 0.06, rollGroup: 'orkadia_bonus' },
      { itemId: 'deathlord_warplate', chance: 0.06, rollGroup: 'orkadia_bonus' },
      { itemId: 'cultist_flayer', chance: 0.06, rollGroup: 'orkadia_bonus' },
    ],
    scale: 2.9,
    color: 0x7a2418, // blood-red warpaint
  },
};

// ---------------------------------------------------------------------------
// Spawn plan (instance-local coords, reusing the Sanctum room footprint z 18..146)
// Packs of two spaced beyond social-aggro range, a marauder line at the waist,
// then Grommok alone on the far dais.
// ---------------------------------------------------------------------------
const ORKADIA_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'orkadia_grunt', x: -3, z: 20 },
  { mobId: 'orkadia_grunt', x: 3, z: 21 },
  { mobId: 'orkadia_grunt', x: -8, z: 30 },
  { mobId: 'orkadia_marauder', x: -4, z: 31 },
  { mobId: 'orkadia_grunt', x: 7, z: 44 },
  { mobId: 'orkadia_grunt', x: 3, z: 45 },
  { mobId: 'orkadia_marauder', x: -6, z: 58 },
  { mobId: 'orkadia_grunt', x: -2, z: 59 },
  { mobId: 'orkadia_marauder', x: 0, z: 72 },
  { mobId: 'orkadia_grunt', x: -7, z: 86 },
  { mobId: 'orkadia_grunt', x: -3, z: 87 },
  { mobId: 'orkadia_marauder', x: 6, z: 100 },
  { mobId: 'orkadia_grunt', x: 2, z: 101 },
  { mobId: 'orkadia_marauder', x: -4, z: 112 },
  { mobId: 'orkadia_marauder', x: 4, z: 112 },
  { mobId: 'orkadia_grunt', x: -5, z: 130 },
  { mobId: 'orkadia_grunt', x: -1, z: 132 },
  { mobId: 'orkadia_warlord', x: 0, z: 146 },
  { mobId: 'orkadia_grunt', x: -5, z: 144 },
  { mobId: 'orkadia_grunt', x: 5, z: 144 },
];

// ---------------------------------------------------------------------------
// Dungeon
// ---------------------------------------------------------------------------
export const ORKADIA_DUNGEON_DEFS: Record<string, DungeonDef> = {
  orkadia: {
    id: 'orkadia',
    name: 'Orkadia',
    index: 6,
    // Skull-and-tusk warcamp gate on the dry black rock just south-east of the
    // Trollmoot raiding camp (Trollmoot POI x460 z2140), clear of its henge and
    // spawns, in the Drakelands (zone rect x[180,540] z[1820,2420]). The old
    // {500,2200} sat on drowned seabed (groundHeight -10.3, below the -4.5 sea);
    // {490,2120} is firm ground (groundHeight ~3.8, ~8.3yd above the water).
    doorPos: { x: 490, z: 2120 },
    entry: { x: 0, z: -2 }, // clear-of-aggro arrival (see dungeon_entry_clearance test)
    exitOffset: { x: 0, z: -6 },
    spawns: ORKADIA_SPAWN_LIST,
    interior: 'orkadia',
    suggestedPlayers: 5,
    enterText: 'The warpyres flare green. The war-camp of Orkadia knows you have come.',
    leaveText: 'You cut your way back out into the ashen Drakelands wind.',
  },
};
