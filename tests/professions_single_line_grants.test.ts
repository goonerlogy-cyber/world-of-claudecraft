// @vitest-environment jsdom

// The single-line grant contract (#2430), tested through the REAL hud event
// switch rather than through source-text pins.
//
// Before: every profession action produced TWO chat lines for one grant. The
// grant hub (Sim.addItem/addItemInstance) emitted a 'loot' SimEvent whose flat
// "You receive: X" line the HUD logged unconditionally, and the profession's
// own result event logged a second, richer line right after it. The weaker
// line printed FIRST, carried no quality color, no quantity and no item link,
// so the richer line underneath read as the echo.
//
// After: a profession grant sets the loot event's `callerLogs` flag, the HUD's
// case 'loot' arm skips its log() call for it, and the profession's own line
// is the only one. That line now also splices the granted item as a clickable
// [[i:id]] chat link, which the chat log renders as a bracketed,
// quality-colored, tooltipped span.
//
// This file drives hud.handleEvents with the exact event PAIRS the sim emits
// for each of the six flows and counts the rendered chat lines, which is the
// thing a player actually sees and the thing no source-text pin can prove.
// The sim half of the contract (which grants carry the flags) is pinned in
// tests/professions_silent_loot.test.ts and tests/professions_fishing.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { ITEMS } from '../src/sim/data';
import type { SimEvent } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { Hud } from '../src/ui/hud';
import { QUALITY_COLOR } from '../src/ui/icons';

const PLAYER_ID = 7;
// Real content ids so the item links resolve through the same ITEMS table the
// renderer uses. A rename that strands one of these fails loudly here.
const SWORD = 'eastbrook_arming_sword';
const DUST = 'arcane_dust';
const ORE = 'copper_ore';
const RARE_WEAPON = 'moggers_copper_cudgel'; // rare, so link color varies from SWORD's

// jsdom normalizes an assigned hex to rgb(), so a raw QUALITY_COLOR hex never
// compares equal to what style.color reads back. Round-trip the expectation
// through the same element property instead of hand-writing the rgb() form.
const cssColor = (hex: string): string => {
  const probe = document.createElement('span');
  probe.style.color = hex;
  return probe.style.color;
};

interface GrantLineHarness {
  sim: {
    playerId: number;
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
  };
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  lootRolls: { closeForItem: ReturnType<typeof vi.fn> };
  chatLogEl: HTMLElement;
  chatTimestamps: boolean;
  chatWindow: { hideIfFiltered: ReturnType<typeof vi.fn> };
  chatAnnouncer: { push: ReturnType<typeof vi.fn> };
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  openUnbindNpcId: number | null;
  renderBags: ReturnType<typeof vi.fn>;
  renderCrafting: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  attachTooltip: ReturnType<typeof vi.fn>;
  itemTooltip: ReturnType<typeof vi.fn>;
  handleEvents(events: SimEvent[]): void;
}

function makeHud(): GrantLineHarness {
  const hud = Object.create(Hud.prototype) as unknown as GrantLineHarness;
  hud.sim = { playerId: PLAYER_ID, craftingIdentity: { synced: false }, craftSkills: {} };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.lootRolls = { closeForItem: vi.fn() };
  hud.chatLogEl = document.createElement('div');
  hud.chatTimestamps = false;
  hud.chatWindow = { hideIfFiltered: vi.fn() };
  hud.chatAnnouncer = { push: vi.fn() };
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  // null so the unbindResult arm's service-row refresh short-circuits before
  // it reaches $('#unbind-window'), which this harness does not mount.
  hud.openUnbindNpcId = null;
  hud.renderBags = vi.fn();
  hud.renderCrafting = vi.fn();
  hud.showError = vi.fn();
  // appendChatItemLink attaches a real tooltip; stub the binding so the test
  // exercises the LINK construction without the tooltip host.
  hud.attachTooltip = vi.fn();
  hud.itemTooltip = vi.fn();
  return hud;
}

// case 'loot' reads `$('#bags').style.display` unconditionally, and $ is an
// unchecked querySelector cast, so the element has to exist or the arm throws.
function mountBags(): void {
  const bags = document.createElement('div');
  bags.id = 'bags';
  // OPEN, so the arm's `!== 'none'` refresh branch actually runs and the pin
  // below proves the callerLogs guard does not swallow it.
  bags.style.display = 'block';
  document.body.append(bags);
  const crafting = document.createElement('div');
  crafting.id = 'crafting-window';
  crafting.style.display = 'none';
  document.body.append(crafting);
}

const lines = (hud: GrantLineHarness): string[] =>
  [...hud.chatLogEl.children].map((el) => el.textContent ?? '');

/** The hub loot event a profession grant now emits: text still carried, both
 *  stand-down flags set. */
const professionGrant = (itemId: string, count = 1): SimEvent =>
  ({
    type: 'loot',
    text: `You receive: ${ITEMS[itemId]?.name ?? itemId}${count > 1 ? ` x${count}` : ''}.`,
    pid: PLAYER_ID,
    silent: true,
    callerLogs: true,
  }) as SimEvent;

beforeEach(() => {
  mountBags();
  // Every cue is stubbed: this file is about lines, and the cue contract has
  // its own file. The fishing arm's cue count is asserted below, though.
  for (const name of [
    'lootItem',
    'coin',
    'gather',
    'gatherRareTier',
    'craftSuccess',
    'masterwork',
    'disenchant',
    'salvage',
    'enchant',
    'fishReel',
  ] as const) {
    vi.spyOn(audio, name).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('one profession action prints exactly one grant line', () => {
  it('a harvest prints the gather line only, with the quantity and an item link', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 5),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'rare',
        qty: 5,
        rareEvent: null,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You gather: [${itemDisplayName(ITEMS[ORE])}] x5.`]);
    // The bag refresh still runs for the elided grant: only the TEXT stands down.
    expect(hud.renderBags).toHaveBeenCalled();
  });

  it('a single-unit harvest prints no x1', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'common',
        qty: 1,
        rareEvent: null,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You gather: [${itemDisplayName(ITEMS[ORE])}].`]);
  });

  it('a landed catch prints the reel-in line only, and plays exactly one cue', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      { type: 'fishingResult', pid: PLAYER_ID, itemId: ORE, quality: 'common' } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You reel in: [${itemDisplayName(ITEMS[ORE])}]`]);
    // The double-cue half of #2430: the reel cue fires, the generic loot ding
    // does not.
    expect(audio.fishReel).toHaveBeenCalledTimes(1);
    expect(audio.lootItem).not.toHaveBeenCalled();
    expect(audio.coin).not.toHaveBeenCalled();
  });

  it('a multi-output craft prints ONE line carrying the count, not one per grant call', () => {
    const hud = makeHud();
    // A resultCount 3 recipe can reach the hub as several internal grant calls;
    // every one of them is elided and the single craft line carries the count.
    hud.handleEvents([
      professionGrant(SWORD, 1),
      professionGrant(SWORD, 2),
      {
        type: 'craftResult',
        pid: PLAYER_ID,
        ok: true,
        recipeId: 'recipe_x',
        itemId: SWORD,
        count: 3,
        quality: 'common',
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`Crafted: [${itemDisplayName(ITEMS[SWORD])}] x3`]);
  });

  it('a single-output craft prints no x1', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(SWORD, 1),
      {
        type: 'craftResult',
        pid: PLAYER_ID,
        ok: true,
        recipeId: 'recipe_x',
        itemId: SWORD,
        count: 1,
        quality: 'common',
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`Crafted: [${itemDisplayName(ITEMS[SWORD])}]`]);
  });

  it('a sub-rare disenchant prints ONE line naming both the piece and the yield', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 2),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 2,
      } as SimEvent,
    ]);
    // The yield is the whole reason the line was extended: eliding the hub
    // line without naming the material would tell the player nothing about
    // what they got back.
    expect(lines(hud)).toEqual([
      `You disenchant [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}] x2.`,
    ]);
  });

  it('a rare+ disenchant adds ONE extra line for the typed secondary, not one per unit', () => {
    const hud = makeHud();
    const secondary = Object.keys(ITEMS).find((id) => id !== DUST && id !== SWORD);
    if (!secondary) throw new Error('no second content item');
    // The sim grants the secondary one unit per call, so an epic yield of 2
    // emits TWO hub loot events; both are elided and the count rides one line.
    hud.handleEvents([
      professionGrant(DUST, 1),
      professionGrant(secondary, 1),
      professionGrant(secondary, 1),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 1,
        secondaryItemId: secondary,
        secondaryCount: 2,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([
      `You disenchant [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}].`,
      `You also recover [${itemDisplayName(ITEMS[secondary])}] x2.`,
    ]);
  });

  it('a salvage prints ONE line naming both the piece and the yield', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 3),
      {
        type: 'salvageResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 3,
      } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([
      `You salvage [${itemDisplayName(ITEMS[SWORD])}] into [${itemDisplayName(ITEMS[DUST])}] x3.`,
    ]);
  });

  it('unbinding one copy out of a stack prints the unbind line only', () => {
    // The sweep's last grant site (commission.ts unbindItem). A bound stack of
    // byte-equal copies is SPLIT: one copy is peeled off and re-granted through
    // the hub, so the player was told they received an item they already held,
    // stacked on top of the unbind line. A single-copy unbind clears in place
    // and never reaches the hub, so only the stacked arm ever double-logged.
    const hud = makeHud();
    hud.handleEvents([
      {
        type: 'loot',
        text: `You receive: ${ITEMS[SWORD]?.name}.`,
        pid: PLAYER_ID,
        callerLogs: true,
      } as SimEvent,
      { type: 'unbindResult', pid: PLAYER_ID, ok: true, itemId: SWORD, fee: 2500 } as SimEvent,
    ]);
    const rendered = lines(hud);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).not.toContain('You receive');
    expect(rendered[0]).toContain(itemDisplayName(ITEMS[SWORD]));
    // The cue is deliberately NOT stood down for this one: unbind has no
    // dedicated cue of its own, so the grant sets callerLogs without silent.
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
    // The peel still moved items, so the bag mirror still repaints.
    expect(hud.renderBags).toHaveBeenCalled();
  });

  it('a yield-free disenchant success renders no dangling empty operand', () => {
    // The fallback contract spans two files: enchanting_view picks the
    // yield-free key when materialItemId is absent, and hud.ts independently
    // substitutes an empty {material}. If the selector ever returned a Yield
    // key for a material-less success the player would read "You disenchant
    // [Sword] into ." This drives the arm end to end so the two halves cannot
    // drift apart silently.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'disenchantResult', pid: PLAYER_ID, ok: true, itemId: SWORD } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You disenchant [${itemDisplayName(ITEMS[SWORD])}].`]);
  });

  it('a yield-free salvage success renders no dangling empty operand either', () => {
    const hud = makeHud();
    hud.handleEvents([
      { type: 'salvageResult', pid: PLAYER_ID, ok: true, itemId: SWORD } as SimEvent,
    ]);
    expect(lines(hud)).toEqual([`You salvage [${itemDisplayName(ITEMS[SWORD])}].`]);
  });

  it('applying an enchant never says the player received an item they already held', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(SWORD, 1),
      {
        type: 'enchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        enchantId: 'enchant_weapon_might',
      } as SimEvent,
    ]);
    const rendered = lines(hud);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).not.toContain('You receive');
    expect(rendered[0]).toContain(`[${itemDisplayName(ITEMS[SWORD])}]`);
  });
});

describe('non-profession grants are untouched', () => {
  it('an ordinary loot grant still prints the hub line and plays the hub cue', () => {
    // The control. Mob loot, corpse loot, quest rewards, vendor buys, mail and
    // trade all reach the hub with no flags, and none of them has a result
    // event of its own, so the hub line is their only feedback.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'loot', text: 'You receive: Copper Ore x3.', pid: PLAYER_ID } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(lines(hud)[0]).toContain('You receive');
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
  });

  it('a money loot line still prints and plays the coin cue', () => {
    const hud = makeHud();
    hud.handleEvents([{ type: 'loot', text: 'You loot 12s 30c.', pid: PLAYER_ID } as SimEvent]);
    expect(lines(hud)).toHaveLength(1);
    expect(audio.coin).toHaveBeenCalledTimes(1);
  });

  it('a silent-but-logged grant still prints its line (the flags are independent)', () => {
    // A caller that owns the CUE but not the LINE must keep its line. This is
    // the arm that fails if the two flags are ever collapsed into one.
    const hud = makeHud();
    hud.handleEvents([
      { type: 'loot', text: 'You receive: Copper Ore.', pid: PLAYER_ID, silent: true } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(1);
    expect(audio.lootItem).not.toHaveBeenCalled();
  });

  it('a loot-roll result line still closes its prompt even when the line is elided', () => {
    // closeForItem sits OUTSIDE the callerLogs guard on purpose: a flagged
    // event must still drive the non-text side effects.
    const hud = makeHud();
    hud.handleEvents([
      {
        type: 'loot',
        text: 'Everyone passed on [[i:copper_ore]].',
        pid: PLAYER_ID,
        callerLogs: true,
      } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(0);
    expect(hud.lootRolls.closeForItem).toHaveBeenCalledTimes(1);
    // The OTHER half of flag independence, and the arm that a source-text
    // "the conditions are not merged" pin cannot prove: this event owns the
    // LINE without owning the CUE, so the ding must still fire. Merging the
    // two guards into `if (!(ev.silent || ev.callerLogs))` is behaviorally the
    // regression those pins exist to stop, and it passes them; it fails here.
    expect(audio.lootItem).toHaveBeenCalledTimes(1);
  });
});

describe('the grant line renders a real, clickable item link', () => {
  it('the granted item is a chat-item-link span, not plain text', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(ORE, 1),
      {
        type: 'gatherResult',
        pid: PLAYER_ID,
        nodeId: 'n1',
        nodeType: 'ore',
        professionId: 'mining',
        itemId: ORE,
        rarity: 'common',
        qty: 1,
        rareEvent: null,
      } as SimEvent,
    ]);
    const link = hud.chatLogEl.querySelector('span.chat-item-link');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(`[${itemDisplayName(ITEMS[ORE])}]`);
    // Focusable, so the link is reachable without a pointer.
    expect((link as HTMLElement).tabIndex).toBe(0);
    // Quality-colored. This is load-bearing for the CRAFT family in
    // particular: its line keeps a flat loot-green and delegates the output's
    // quality entirely to the link, so if the link ever stopped painting from
    // the item def the craft line would lose the quality signal outright.
    expect((link as HTMLElement).style.color).toBe(cssColor(QUALITY_COLOR.common));
  });

  it('the craft line paints its quality through the link, and the tier actually varies', () => {
    // The craft arm logs flat '#7fdc4f' by design and lets the item link carry
    // the quality, so the link IS the craft line's only quality signal. Two
    // different tiers, because a single common-quality case would also pass if
    // the link painted everything white.
    const craftedLinkColor = (itemId: string): string => {
      const hud = makeHud();
      hud.handleEvents([
        professionGrant(itemId, 1),
        {
          type: 'craftResult',
          pid: PLAYER_ID,
          ok: true,
          recipeId: 'recipe_x',
          itemId,
          count: 1,
        } as SimEvent,
      ]);
      const link = hud.chatLogEl.querySelector('span.chat-item-link') as HTMLElement;
      expect(link).not.toBeNull();
      return link.style.color;
    };
    expect(ITEMS[SWORD].quality ?? 'common').toBe('common');
    expect(ITEMS[RARE_WEAPON].quality).toBe('rare');
    expect(craftedLinkColor(SWORD)).toBe(cssColor(QUALITY_COLOR.common));
    expect(craftedLinkColor(RARE_WEAPON)).toBe(cssColor(QUALITY_COLOR.rare));
    expect(craftedLinkColor(SWORD)).not.toBe(craftedLinkColor(RARE_WEAPON));
  });

  it('a disenchant line renders BOTH operands as links', () => {
    const hud = makeHud();
    hud.handleEvents([
      professionGrant(DUST, 1),
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: true,
        itemId: SWORD,
        materialItemId: DUST,
        count: 1,
      } as SimEvent,
    ]);
    const links = [...hud.chatLogEl.querySelectorAll('span.chat-item-link')];
    expect(links.map((el) => el.textContent)).toEqual([
      `[${itemDisplayName(ITEMS[SWORD])}]`,
      `[${itemDisplayName(ITEMS[DUST])}]`,
    ]);
  });

  it('a DENIED action stays a name-free error toast (tokens never expand there)', () => {
    // showError does not go through the chat log, so an item token there would
    // print as literal "[[i:...]]" source text to the player.
    const hud = makeHud();
    hud.handleEvents([
      {
        type: 'disenchantResult',
        pid: PLAYER_ID,
        ok: false,
        itemId: SWORD,
        reason: 'not_disenchantable',
      } as SimEvent,
    ]);
    expect(lines(hud)).toHaveLength(0);
    expect(hud.showError).toHaveBeenCalledTimes(1);
    expect(String(hud.showError.mock.calls[0][0])).not.toContain('[[i:');
  });
});
