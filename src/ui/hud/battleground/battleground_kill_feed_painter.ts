// Thin DOM painter for the Ravenrift kill feed: a short top-right stack of
// death calls, event-pushed and expiry-pruned through the pure core
// (battleground_kill_feed_view.ts). The per-frame update is a no-op unless a
// line actually expired (the core returns the same array otherwise), so the
// frame budget only ever pays on a death or an expiry, never per tick.
//
// Fairness: paints identically on every graphics tier; a kill call is
// actionable information and is never tier-gated. Colors live in the
// stylesheet (components.css), keyed by the KILLER's team class.

import { esc } from '../../esc';
import { t } from '../../i18n';
import {
  type BgKillFeedLine,
  pruneBgKillLines,
  pushBgKillLine,
} from './battleground_kill_feed_view';

export interface BattlegroundKillFeedDeps {
  /** The HUD layer the feed mounts into (the #ui element). */
  layer(): HTMLElement | null;
}

export class BattlegroundKillFeed {
  private root: HTMLElement | null = null;
  private lines: BgKillFeedLine[] = [];

  constructor(private readonly deps: BattlegroundKillFeedDeps) {}

  /** A death landed (the bgKill event): stack its line now. */
  push(kill: Omit<BgKillFeedLine, 'expiresAt'>, now: number): void {
    this.lines = pushBgKillLine(this.lines, kill, now);
    this.render();
  }

  /** Per-frame expiry sweep; elided unless a line actually lapsed. */
  update(now: number): void {
    const pruned = pruneBgKillLines(this.lines, now);
    if (pruned === this.lines) return;
    this.lines = pruned;
    this.render();
  }

  /** Match over (or left): drop the stack immediately. */
  clear(): void {
    if (this.lines.length === 0) return;
    this.lines = [];
    this.render();
  }

  private render(): void {
    const root = this.ensureRoot();
    if (!root) return;
    root.innerHTML = this.lines.map((l) => this.lineHtml(l)).join('');
  }

  private lineHtml(l: BgKillFeedLine): string {
    const team = l.killerTeam ?? l.victimTeam;
    const cls = l.killerTeam === null ? 'plain' : team === 0 ? 'crimson' : 'azure';
    const text =
      l.killerName === null
        ? t('hudChrome.bg.killFeedFallen', { victim: l.victimName })
        : t('hudChrome.bg.killFeed', { killer: l.killerName, victim: l.victimName });
    return `<div class="bgkf-line ${cls}">${esc(text)}</div>`;
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'bg-killfeed';
    // Transient combat chatter: never a live region (the combat log carries
    // the same lines durably for assistive tech and scrollback).
    el.setAttribute('aria-hidden', 'true');
    layer.appendChild(el);
    this.root = el;
    return el;
  }
}
