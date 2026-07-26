// Pure view model for the merged PvP window's tab strip: Ravenrift first (the
// primary tab), then the two ranked arena brackets. It decides which tab is
// pinned (a live queue or match commits its own tab) and which tabs are locked
// while one mode is busy, so the UI can never queue two PvP modes at once.
// DOM-free and i18n-free (root CLAUDE.md pure-core contract); the painter in
// arena_window.ts renders and wires it.

import type { ArenaFormat } from '../world_api';

/** The merged window's tabs, in display order: Ravenrift is primary. */
export type PvpTabId = 'ravenrift' | '1v1' | '2v2';
export const PVP_TABS: readonly PvpTabId[] = ['ravenrift', '1v1', '2v2'];

export interface PvpTabState {
  id: PvpTabId;
  active: boolean;
  locked: boolean;
}

export interface PvpTabsInput {
  /** The painter's current selection. */
  selected: PvpTabId;
  /** The battleground is queued or in a match. */
  bgBusy: boolean;
  /** The arena bracket that is queued or in a match, if any. */
  arenaBusyBracket: ArenaFormat | null;
}

export interface PvpTabsModel {
  tabs: PvpTabState[];
  /** The resolved selection (a busy mode pins its own tab). */
  active: PvpTabId;
  /** True when the painter should adopt `active` as its stored selection. */
  commit: boolean;
}

/**
 * Resolve the strip. A busy mode pins its tab; the battleground wins a
 * (sim-impossible) tie. A busy arena bracket the strip no longer offers (a
 * dev-started Fiesta or Protect Yumi bout) pins nothing: the selection stays
 * where it is, and every other tab still locks while the bout runs.
 */
export function buildPvpTabs(input: PvpTabsInput): PvpTabsModel {
  const offeredArena: PvpTabId | null =
    input.arenaBusyBracket === '1v1' || input.arenaBusyBracket === '2v2'
      ? input.arenaBusyBracket
      : null;
  const pinned: PvpTabId | null = input.bgBusy ? 'ravenrift' : offeredArena;
  const active = pinned ?? input.selected;
  const busy = input.bgBusy || input.arenaBusyBracket !== null;
  return {
    tabs: PVP_TABS.map((id) => ({ id, active: id === active, locked: busy && id !== active })),
    active,
    commit: pinned !== null,
  };
}
