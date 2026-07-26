// Pins for the merged PvP window's tab-strip model (src/ui/pvp_tabs_view.ts):
// display order with Ravenrift primary, busy-mode pinning and locking, and the
// dev-only edge where a retired bracket is live.
import { describe, expect, it } from 'vitest';
import { buildPvpTabs, PVP_TABS } from '../src/ui/pvp_tabs_view';

describe('pvp tabs: order, pinning, locking', () => {
  it('offers exactly Ravenrift, 1v1, 2v2, in that order, Ravenrift primary', () => {
    expect(PVP_TABS).toEqual(['ravenrift', '1v1', '2v2']);
    const m = buildPvpTabs({ selected: 'ravenrift', bgBusy: false, arenaBusyBracket: null });
    expect(m.tabs.map((tab) => tab.id)).toEqual(['ravenrift', '1v1', '2v2']);
  });

  it('idle: the selection is active, nothing is locked, nothing commits', () => {
    const m = buildPvpTabs({ selected: '2v2', bgBusy: false, arenaBusyBracket: null });
    expect(m.active).toBe('2v2');
    expect(m.commit).toBe(false);
    expect(m.tabs.find((tab) => tab.id === '2v2')?.active).toBe(true);
    expect(m.tabs.every((tab) => !tab.locked)).toBe(true);
  });

  it('a busy battleground pins Ravenrift and locks both arena tabs', () => {
    const m = buildPvpTabs({ selected: '1v1', bgBusy: true, arenaBusyBracket: null });
    expect(m.active).toBe('ravenrift');
    expect(m.commit).toBe(true);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['1v1', '2v2']);
  });

  it('a busy arena bracket pins its tab and locks the others, Ravenrift included', () => {
    const m = buildPvpTabs({ selected: 'ravenrift', bgBusy: false, arenaBusyBracket: '2v2' });
    expect(m.active).toBe('2v2');
    expect(m.commit).toBe(true);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['ravenrift', '1v1']);
  });

  it('the battleground wins the (sim-impossible) double-busy tie', () => {
    const m = buildPvpTabs({ selected: '1v1', bgBusy: true, arenaBusyBracket: '2v2' });
    expect(m.active).toBe('ravenrift');
  });

  it('a live retired bracket (dev Fiesta/Yumi) pins nothing but still locks the rest', () => {
    const m = buildPvpTabs({ selected: '1v1', bgBusy: false, arenaBusyBracket: 'fiesta' });
    expect(m.active).toBe('1v1');
    expect(m.commit).toBe(false);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['ravenrift', '2v2']);
  });
});
