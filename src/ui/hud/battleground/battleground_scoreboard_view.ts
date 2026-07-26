// Pure, host-agnostic view model for the in-match Ravenrift scoreboard strip:
// both team scores, the two flag states (with carrier), the team roster pips,
// the match clock, and the personal wave-respawn / spawn-protection readouts.
// Snapshot-driven from bgInfo.match so it self-heals on reconnect; the one-shot
// juice (banners, cues) rides the bg SimEvents in hud.handleEvents, never this
// model (the vale_cup_hud_view.ts contract).
//
// Fairness invariant: while a match is visible the whole strip paints on every
// graphics tier, driven from the same model for every player (flag states and
// the carrier marker are actionable information).
//
// DOM-free and i18n-free: states are raw tokens the painter localizes, and
// `sig` is the STRUCTURAL identity (roster + my team), excluding the per-second
// clock / score / flag states, which the painter writes through elided slots.

import type { BgInfo } from '../../../world_api';

export interface BgScoreboardPip {
  name: string;
  me: boolean;
  dead: boolean;
  carrying: boolean;
}

export interface BgScoreboardView {
  active: boolean;
  state: 'countdown' | 'active';
  myTeam: number;
  scoreCrimson: number;
  scoreAzure: number;
  capsToWin: number;
  /** Form-up seconds remaining (state 'countdown'), else 0. */
  countdown: number;
  /** Remaining match time, split for the painter's clock key. */
  minutes: number;
  seconds: number;
  /** Flag states by home team (0 = Crimson, 1 = Azure). */
  flagStates: ['home' | 'carried' | 'dropped', 'home' | 'carried' | 'dropped'];
  carrierNames: [string | null, string | null];
  pipsCrimson: BgScoreboardPip[];
  pipsAzure: BgScoreboardPip[];
  /** Seconds until my team's wave revives me (>0 only while I am dead). */
  respawnIn: number;
  /** Seconds of my spawn protection left (0 = none). */
  protectedFor: number;
  /** Structural identity: rebuild the skeleton only when this changes. */
  sig: string;
}

const INACTIVE: BgScoreboardView = {
  active: false,
  state: 'countdown',
  myTeam: 0,
  scoreCrimson: 0,
  scoreAzure: 0,
  capsToWin: 0,
  countdown: 0,
  minutes: 0,
  seconds: 0,
  flagStates: ['home', 'home'],
  carrierNames: [null, null],
  pipsCrimson: [],
  pipsAzure: [],
  respawnIn: 0,
  protectedFor: 0,
  sig: 'off',
};

export function buildBgScoreboardView(info: BgInfo | null, myPid: number): BgScoreboardView {
  const m = info?.match ?? null;
  if (!m) return INACTIVE;
  const left = Math.max(0, Math.floor(m.timeLeft));
  const pip = (p: (typeof m.players)[number]): BgScoreboardPip => ({
    name: p.name,
    me: p.pid === myPid,
    dead: p.dead,
    carrying: p.carrying,
  });
  const crimson = m.players.filter((p) => p.team === 0);
  const azure = m.players.filter((p) => p.team === 1);
  return {
    active: true,
    state: m.state,
    myTeam: m.myTeam,
    scoreCrimson: m.scores[0],
    scoreAzure: m.scores[1],
    capsToWin: m.capsToWin,
    countdown: Math.max(0, Math.ceil(m.countdown)),
    minutes: Math.floor(left / 60),
    seconds: left % 60,
    flagStates: [m.flags[0].state, m.flags[1].state],
    carrierNames: [m.flags[0].carrierName, m.flags[1].carrierName],
    pipsCrimson: crimson.map(pip),
    pipsAzure: azure.map(pip),
    respawnIn: m.respawnIn,
    protectedFor: m.protectedFor,
    sig: `${m.myTeam}|${crimson.map((p) => p.pid).join(',')}|${azure.map((p) => p.pid).join(',')}`,
  };
}
