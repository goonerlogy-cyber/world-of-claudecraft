// Thin DOM painter for the Ravenrift (battleground) queue window.
//
// The consumer half of the pure-core + thin-painter split (arena_window.ts is
// the family template): it paints #battleground-window from the structured
// BgWindowView, owns the window's view-state (the all-time-board cache + fetch
// throttle, the render-skip signature, the WCAG focus opener), and wires the
// queue / leave / close dispatch back through IWorld + injected callbacks. It
// holds no Sim reference and reaches into Hud only through its deps.
//
// A cold sig-diffed innerHTML window (NOT an elided-writer hot painter): it
// redraws while open from hud.update()'s mediumHud band and skips the DOM
// rebuild when the content signature is unchanged.

import { audio } from '../../../game/audio';
import type { PlayerClass } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { classDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import {
  type BgAllTimeEntry,
  type BgAllTimeRow,
  type BgWindowAction,
  type BgWindowView,
  buildBgWindowView,
} from './battleground_window_view';

// Best-effort all-time board pull is throttled to this interval.
const LEADERBOARD_REFETCH_MS = 15000;

// Render-skip sentinel for the offline panel (the arena_window.ts pattern: the
// live sig is a JSON array string, so this token can never collide with it).
const BG_OFFLINE_SIG = 'bg-offline';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/** Hud-supplied glue; the window renders entirely from IWorld + these callbacks. */
export interface BattlegroundWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class BattlegroundWindow {
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  private allTime: BgAllTimeEntry[] | null = null;
  private lbFetchedAt = 0;

  constructor(private readonly deps: BattlegroundWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Open if closed, close if open (the keybind / minimap button). */
  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    // Dialog identity is a static property of the stable root: set once on open.
    markDialogRoot(root, { labelledBy: 'battleground-title' });
    root.style.display = 'block';
    this.lastSig = '';
    this.fetchLeaderboard();
    this.render();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /** Language switch: clear the render-skip sig so the next render rebuilds. */
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  // Best-effort all-time board pull; silently no-ops offline (live standing only).
  private fetchLeaderboard(): void {
    const now = performance.now();
    if (now - this.lbFetchedAt < LEADERBOARD_REFETCH_MS) return;
    this.lbFetchedAt = now;
    fetch('/api/battleground/leaderboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) {
          this.allTime = d.leaders;
          this.lastSig = '';
        }
      })
      .catch(() => {
        /* offline or no server: standing only */
      });
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    const view = buildBgWindowView({
      info: world.bgInfo,
      playerName: world.player.name,
      party: world.partyInfo,
      allTime: this.allTime,
    });

    if (view.kind === 'offline') {
      if (this.lastSig === BG_OFFLINE_SIG) return;
      this.lastSig = BG_OFFLINE_SIG;
      el.innerHTML = this.offlineHtml();
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    this.fetchLeaderboard();
    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    el.innerHTML = this.liveHtml(view);
    this.wire(el);
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelector('[data-act="queue"]')?.addEventListener('click', () => {
      this.deps.world().bgQueueJoin();
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().bgQueueLeave();
      audio.click();
    });
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) ----------

  private titleHtml(): string {
    return `<div class="panel-title"><span id="battleground-title">${esc(t('hudChrome.bg.title'))} <span class="bg-mode-tag">${esc(t('hudChrome.bg.modeTag'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.bg.close'))}">${svgIcon('close')}</button></div>`;
  }

  private offlineHtml(): string {
    return `${this.titleHtml()}<div class="bg-note">${esc(t('hudChrome.bg.offlineNote'))}</div>`;
  }

  private liveHtml(view: Extract<BgWindowView, { kind: 'live' }>): string {
    const rank =
      `<div class="bg-rank"><span class="rating">${esc(num(view.rating))}</span>` +
      `<span class="wl">${esc(
        t('hudChrome.bg.ratingSummary', { wins: num(view.wins), losses: num(view.losses) }),
      )}</span></div>` +
      `<div class="bg-captures">${esc(t('hudChrome.bg.careerCaptures', { count: num(view.captures) }))}</div>`;
    const allTimeSection =
      view.allTime && view.allTime.length > 0
        ? `<div class="bg-sub">${esc(t('hudChrome.bg.ladderAllTime'))}</div>${this.ladderHtml(view.allTime)}`
        : `<div class="bg-sub">${esc(t('hudChrome.bg.ladderAllTime'))}</div><div class="ladder-empty">${esc(t('hudChrome.bg.noRanked'))}</div>`;
    return this.titleHtml() + rank + this.actionHtml(view.action) + allTimeSection;
  }

  private actionHtml(action: BgWindowAction): string {
    if (action.kind === 'in-match') {
      return `<div class="bg-queue-status">${svgIcon('battleground')} ${esc(
        t('hudChrome.bg.matchInProgress', {
          crimson: num(action.scoreCrimson),
          azure: num(action.scoreAzure),
        }),
      )}</div>`;
    }
    if (action.kind === 'queued') {
      const partyNote =
        action.queuedParty > 1
          ? ` ${esc(t('hudChrome.bg.queuedParty', { count: num(action.queuedParty) }))}`
          : '';
      return (
        `<button class="btn leave" data-act="leave">${esc(t('hudChrome.bg.leaveQueue'))}</button>` +
        `<div class="bg-queue-status">${esc(
          t('hudChrome.bg.searching', { count: num(action.queueSize) }),
        )}${partyNote}</div>`
      );
    }
    const label =
      action.partySize > 1
        ? t('hudChrome.bg.enterQueueParty', { count: num(action.partySize) })
        : t('hudChrome.bg.enterQueue');
    return (
      `<button class="btn" data-act="queue">${esc(label)}</button>` +
      `<div class="bg-note">${esc(t('hudChrome.bg.queueNote'))}</div>`
    );
  }

  private ladderHtml(rows: BgAllTimeRow[]): string {
    return rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hudChrome.bg.playerLevelClassTitle', {
              name: r.name,
              level: num(r.level),
              className: cls,
            }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(num(r.wins))}-${esc(num(r.losses))}</span></div>`
        );
      })
      .join('');
  }
}
