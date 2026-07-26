// Source-guard for the gatherResult/craftResult/masterwork audio wiring
// (the player_death_audio.test.ts pattern): pins that gathering plays a
// dedicated node-type cue (audio.gather), that a successful craft resolves
// the recipe's professionId to its own ui_craft_<family> cue via
// audio.craftSuccess(), and that a masterwork proc LAYERS audio.masterwork()
// alongside that cue rather than replacing it. Every professions grant also
// suppresses BOTH generic hub feedbacks at the source (Sim.addItem/
// addItemInstance opts.silent and opts.callerLogs, see
// tests/professions_silent_loot.test.ts) so neither the generic ding nor the
// generic "You receive:" line stacks on top of the profession's own cue and
// line; the corresponding hud.ts case 'loot' halves of that contract are
// pinned below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

describe('gatherResult audio wiring', () => {
  it('plays a gather cue keyed off the node type, not silence', () => {
    const start = hud.indexOf("case 'gatherResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.gather(ev.nodeType)');
  });
});

describe('gather-cast tool-out audio wiring', () => {
  it('plays a node-type-keyed cue on a gather cast start, not the flat fallback', () => {
    // hud.ts has two 'castStart' cases (a spatial cast-loop handler, and this
    // personal-cue one); anchor on GATHER_CAST_ID, unique to the latter.
    const start = hud.indexOf('ev.ability === GATHER_CAST_ID');
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.gatherCast(ev.gatherNodeType)');
  });
});

describe('craftResult audio wiring', () => {
  it('resolves the recipe to its craft family instead of always playing the loot ding', () => {
    const start = hud.indexOf("case 'craftResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf("case 'lootRoll'", start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.craftSuccess(');
    expect(body).not.toContain('audio.lootItem()');
  });

  it('layers the masterwork sting alongside the family cue, gated on ev.masterwork', () => {
    const start = hud.indexOf("case 'craftResult':");
    const end = hud.indexOf("case 'lootRoll'", start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (ev.masterwork) audio.masterwork();');
    // The masterwork call must come strictly after the craftSuccess call, so
    // it layers on top rather than replacing it.
    expect(body.indexOf('audio.craftSuccess(')).toBeLessThan(body.indexOf('audio.masterwork();'));
  });
});

describe('the generic loot cue respects ev.silent', () => {
  it('skips both audio.coin() and audio.lootItem() when the loot event is silent', () => {
    const start = hud.indexOf("case 'loot':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (!ev.silent)');
    // Both generic cues sit INSIDE the silent guard, and nothing else does:
    // a professions grant suppresses the ding without suppressing anything
    // else this arm does for it.
    const guard = body.indexOf('if (!ev.silent)');
    expect(body.indexOf('audio.lootItem()')).toBeGreaterThan(guard);
    expect(body.indexOf('audio.coin()')).toBeGreaterThan(guard);
  });
});

describe('the generic loot LINE respects ev.callerLogs', () => {
  // The text half of the same idea (#2430). This block replaces an earlier pin
  // that asserted the opposite contract ("the log line must sit OUTSIDE the
  // silent guard, so a professions grant's 'You receive:' line still prints"):
  // that line was the second of the two lines one profession action printed
  // for one grant, and it now stands down. The old pin's index-order form
  // would have stayed GREEN under this change while asserting a contract the
  // code no longer has, so it is replaced rather than adjusted.
  it('the hub log call sits inside a callerLogs guard, as one statement', () => {
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    // One statement, not a guard placed above an unguarded log: the adjacency
    // is what makes this pin fail if the line ever prints unconditionally
    // again.
    expect(body).toContain('if (!ev.callerLogs) this.log(');
    expect(body.match(/this\.log\(/g)).toHaveLength(1);
  });

  it('the bag refresh and the loot-roll close stay OUTSIDE the callerLogs guard', () => {
    // A professions grant still moves items, so the online bag mirror must
    // still repaint, and a loot-roll line must still close its prompt. Only
    // the duplicate TEXT is elided.
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    const guard = body.indexOf('if (!ev.callerLogs)');
    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf('this.lootRolls.closeForItem(')).toBeGreaterThan(guard);
    expect(body.indexOf('this.renderBags()')).toBeGreaterThan(guard);
  });

  it('the two flags stay independent conditions', () => {
    // Merging them would tie a caller's cue ownership to its line ownership;
    // they are deliberately separate (a caller can own one without the other).
    const start = hud.indexOf("case 'loot':");
    const body = hud.slice(start, hud.indexOf('break;', start));
    expect(body).not.toContain('!ev.silent && !ev.callerLogs');
    expect(body).not.toContain('!ev.callerLogs && !ev.silent');
  });
});

describe('disenchantResult audio wiring', () => {
  // disenchantItem is called from the bag item action menu
  // (src/ui/bag_item_action_menu.ts); the success (toast.sink === 'log') arm
  // plays audio.disenchant(), a denial (showError) never does.
  it('plays the disenchant cue on a successful disenchant, not on a denial', () => {
    const start = hud.indexOf("case 'disenchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.disenchant();');
    // The disenchant call must sit inside the log (success) arm, before the
    // else (showError/denial) branch.
    expect(body.indexOf('audio.disenchant();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('salvageResult audio wiring', () => {
  // salvageItem is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the salvage cue on a successful salvage, not on a denial', () => {
    const start = hud.indexOf("case 'salvageResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.salvage();');
    expect(body.indexOf('audio.salvage();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('enchantResult audio wiring', () => {
  // applyEnchant is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the enchant cue on a successful apply-enchant, not on a denial', () => {
    const start = hud.indexOf("case 'enchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.enchant();');
    expect(body.indexOf('audio.enchant();')).toBeLessThan(body.indexOf('else'));
  });
});
