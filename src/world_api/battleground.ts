// Ravenrift: the ranked 5v5 capture-the-flag battleground. The HUD reads
// `bgInfo` (queue state + the live match view) and sends the queue commands
// plus the deliberate flag-action press. The persistent ladder is served over
// REST (`GET /api/battleground/leaderboard`), not this facet.
import type { PlayerClass } from '../sim/types';

export interface BgFlagInfo {
  state: 'home' | 'carried' | 'dropped';
  carrierPid: number | null;
  carrierName: string | null;
  carrierTeam: number | null; // 0 = Crimson, 1 = Azure
}

export interface BgPlayerInfo {
  pid: number;
  name: string;
  cls: PlayerClass;
  team: number; // 0 = Crimson, 1 = Azure
  carrying: boolean;
  dead: boolean;
  // Deliberately NO hp/mhp: the scoreboard reads dead/carrying only, and the
  // bg self key is match-wide (never interest-scoped), so shipping enemy
  // health here would leak actionable state past the ~120yd interest rule.
}

export interface BgMatchInfo {
  state: 'countdown' | 'active';
  myTeam: number; // 0 = Crimson, 1 = Azure
  capsToWin: number;
  scores: [number, number]; // [Crimson, Azure]
  flags: [BgFlagInfo, BgFlagInfo]; // indexed by home team
  players: BgPlayerInfo[];
  countdown: number; // whole seconds left in the form-up gate (0 once live)
  timeLeft: number; // whole seconds until the match cap resolves on score
  waveIn: [number, number]; // whole seconds to each team's next respawn wave
  respawnIn: number; // = waveIn[myTeam] while you are dead, else 0
  protectedFor: number; // whole seconds of your spawn protection left (0 = none)
}

export interface BgInfo {
  rating: number;
  wins: number;
  losses: number;
  captures: number; // career flag captures
  queued: boolean;
  queueSize: number; // champions waiting across all groups
  queuedParty: number; // size of your own queued group
  match: BgMatchInfo | null;
}

export interface IWorldBattleground {
  bgInfo: BgInfo | null;
  bgQueueJoin(): void;
  bgQueueLeave(): void;
  /** The deliberate battleground action press: pick up a grabbable flag within reach. */
  bgFlagAction(): void;
}
