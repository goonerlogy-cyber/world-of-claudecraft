import { describe, expect, it } from 'vitest';
import { isBgPos } from '../src/sim/data';
import { BATTLEGROUND_LOSS_HONOR, BATTLEGROUND_WIN_HONOR } from '../src/sim/pvp';
import { eloDelta, Sim } from '../src/sim/sim';
import type { BgMatch } from '../src/sim/social/battleground';
import {
  BG_CARRIER_VULN_DELAY,
  BG_CARRIER_VULN_INTERVAL,
  BG_MAX_DURATION,
  BG_SPAWN_PROTECTION,
  BG_WAVE_OFFSET,
  BG_WAVE_PERIOD,
  updateBattleground,
} from '../src/sim/social/battleground';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function tp(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

// Ten solo players, queued, advanced one tick so matchmaking seats a 5v5.
function tenInQueue(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids: number[] = [];
  const classes = ['warrior', 'mage', 'priest', 'rogue', 'hunter'] as const;
  for (let i = 0; i < 10; i++) {
    const pid = sim.addPlayer(classes[i % 5], `P${i}`);
    tp(sim, pid, (i % 5) * 2 - 4, -40);
    pids.push(pid);
  }
  for (const pid of pids) sim.bgQueueJoin(pid);
  sim.tick(); // matchmakeBg seats them
  return { sim, pids };
}

function toActive(sim: Sim, match: BgMatch) {
  for (let i = 0; i < 20 * 12 && match.state !== 'active'; i++) sim.tick();
}

function stripProtection(sim: Sim, pid: number) {
  const e = sim.entities.get(pid)!;
  e.auras = e.auras.filter((a) => a.kind !== 'spawn_protection');
}

function kill(sim: Sim, pid: number, killerPid: number | null = null) {
  stripProtection(sim, pid);
  const e = sim.entities.get(pid)!;
  const killer = killerPid !== null ? sim.entities.get(killerPid)! : null;
  sim.ctx.dealDamage(killer, e, 9_999_999, false, 'physical', null, 'hit');
}

// Grab the enemy flag with a deliberate press, then run it home for a capture.
function captureOnce(sim: Sim, match: BgMatch, carrier: number) {
  const azure = match.flags[1];
  const crimsonHome = match.flags[0].home;
  tp(sim, carrier, azure.pos.x, azure.pos.z);
  sim.bgFlagAction(carrier);
  sim.tick();
  tp(sim, carrier, crimsonHome.x, crimsonHome.z);
  sim.tick();
}

describe('Ravenrift: queue + matchmaking', () => {
  it('needs ten players; then forms two teams of five and seats them in the battleground band', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    for (let i = 0; i < 9; i++) {
      const pid = sim.addPlayer('warrior', `W${i}`);
      tp(sim, pid, 0, -40);
      pids.push(pid);
      sim.bgQueueJoin(pid);
    }
    sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null); // 9 is not enough

    const tenth = sim.addPlayer('mage', 'Tenth');
    tp(sim, tenth, 0, -40);
    sim.bgQueueJoin(tenth);
    sim.tick();
    const match = sim.bgMatchFor(pids[0])!;
    expect(match).toBeTruthy();
    expect(match.teams[0]).toHaveLength(5);
    expect(match.teams[1]).toHaveLength(5);
    for (const pid of [...match.teams[0], ...match.teams[1]]) {
      expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
    }
    expect(match.state).toBe('countdown');
  });

  it('keeps a queued party together on one team, filled with solos', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    const party = [leader];
    for (let i = 0; i < 3; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      sim.partyInvite(m, leader);
      sim.partyAccept(m);
      party.push(m);
    }
    const solos: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = sim.addPlayer('rogue', `Solo${i}`);
      tp(sim, s, 0, -40);
      solos.push(s);
      sim.bgQueueJoin(s);
    }
    sim.bgQueueJoin(leader); // queues the whole party as one group
    sim.tick();
    const match = sim.bgMatchFor(leader)!;
    expect(match).toBeTruthy();
    const teamOfLeader = match.teams[0].includes(leader) ? 0 : 1;
    for (const m of party) expect(match.teams[teamOfLeader]).toContain(m);
  });

  it('refuses to queue from inside an instance, while dead, or twice', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 900, -1250); // a dungeon instance band
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);

    tp(sim, a, 0, -40);
    kill(sim, a);
    sim.bgQueueJoin(a);
    expect(sim.bgInfoFor(a)!.queued).toBe(false);

    const b = sim.addPlayer('mage', 'B');
    tp(sim, b, 0, -40);
    sim.bgQueueJoin(b);
    sim.bgQueueJoin(b); // idempotent re-queue
    expect(sim.bgInfoFor(b)!.queued).toBe(true);
    expect(sim.bgInfoFor(b)!.queueSize).toBe(1);
    sim.bgQueueLeave(b);
    expect(sim.bgInfoFor(b)!.queued).toBe(false);
  });
});

describe('Ravenrift: deliberate pickup + automatic return', () => {
  it('walking over a flag never picks it up; the deliberate press does', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.state).toBe('active');
    const raider = match.teams[0][0];
    const azure = match.flags[1];
    tp(sim, raider, azure.pos.x, azure.pos.z);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(match.flags[1].state).toBe('home'); // strafing through does nothing
    sim.bgFlagAction(raider);
    sim.tick();
    expect(match.flags[1].state).toBe('carried');
    expect(match.flags[1].carrier).toBe(raider);
  });

  it('the flag action errors politely with no flag in reach and never grabs the OWN flag', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const crimson = match.teams[0][0];
    // own flag: pressing on it does nothing (only a dropped own flag returns, by proximity)
    tp(sim, crimson, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(crimson);
    sim.tick();
    expect(match.flags[0].state).toBe('home');
    expect(match.flags[1].state).toBe('home');
  });

  it('grab, run it home, score; first to five captures wins and cleans up', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const returnPos = match.returns.get(carrier)!;

    let ended = false;
    for (let cap = 0; cap < 5; cap++) {
      captureOnce(sim, match, carrier);
      expect(match.scores[0]).toBe(cap + 1);
      if (cap < 4) expect(match.flags[1].state).toBe('home'); // captured flag resets home
    }
    ended = sim.bgMatchFor(carrier) === null;
    expect(ended).toBe(true);
    expect(match.scores[0]).toBe(5);
    // restored to the overworld exactly where they queued
    const e = sim.entities.get(carrier)!;
    expect(isBgPos(e.pos.x)).toBe(false);
    expect(e.pos.x).toBeCloseTo(returnPos.x, 3);
    expect(e.pos.z).toBeCloseTo(returnPos.z, 3);
    // meta recorded the result + captures
    expect(sim.meta(carrier)!.bgWins).toBe(1);
    expect(sim.meta(carrier)!.bgCaptures).toBe(5);
    expect(sim.meta(match.teams[1][0])!.bgLosses).toBe(1);
  });

  it('a dropped flag auto-returns home after 12 seconds untouched', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    // carry it away from everyone, then die
    tp(sim, enemy, match.flags[0].home.x + 10, match.flags[0].home.z + 20);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    for (let i = 0; i < 20 * 12 + 2 && match.flags[0].state === 'dropped'; i++) sim.tick();
    expect(match.flags[0].state).toBe('home');
  });

  it('the flag OWN team returns a dropped flag by proximity, instantly', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const enemy = match.teams[1][0];
    tp(sim, enemy, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(enemy);
    sim.tick();
    tp(sim, enemy, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, enemy);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const defender = match.teams[0][1];
    tp(sim, defender, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // walk-over return, no press needed
  });

  it('same-tick race: an automatic return beats a pickup press', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const thief = match.teams[1][0];
    tp(sim, thief, match.flags[0].home.x, match.flags[0].home.z);
    sim.bgFlagAction(thief);
    sim.tick();
    tp(sim, thief, match.flags[0].home.x + 12, match.flags[0].home.z + 25);
    sim.tick();
    kill(sim, thief);
    sim.tick();
    expect(match.flags[0].state).toBe('dropped');
    const dropX = match.flags[0].pos.x;
    const dropZ = match.flags[0].pos.z;
    // a defender stands on it AND an enemy presses in the same tick
    const defender = match.teams[0][1];
    const secondThief = match.teams[1][1];
    tp(sim, defender, dropX, dropZ);
    tp(sim, secondThief, dropX, dropZ);
    stripProtection(sim, secondThief);
    sim.bgFlagAction(secondThief);
    sim.tick();
    expect(match.flags[0].state).toBe('home'); // the return won the race
    expect(match.flags[0].carrier).toBe(null);
  });

  it('flags and invisibility never mix: a grab reveals, going hidden drops', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const e = sim.entities.get(runner)!;
    const hide = () =>
      sim.ctx.applyAura(e, {
        id: 'stealth',
        name: 'Stealth',
        kind: 'stealth',
        value: 0.5,
        remaining: 3600,
        duration: 3600,
        sourceId: e.id,
        school: 'physical',
      });
    // a stealthed runner CAN press the grab, but the grab is a revealing act:
    // the stealth aura is stripped in the same tick the carry starts
    hide();
    expect(e.stealthed).toBe(true);
    tp(sim, runner, match.flags[1].home.x, match.flags[1].home.z);
    stripProtection(sim, runner);
    sim.bgFlagAction(runner);
    sim.tick();
    expect(match.flags[1].carrier).toBe(runner);
    expect(e.stealthed).toBe(false);
    expect(e.auras.some((a) => a.kind === 'stealth')).toBe(false);
    // going hidden WHILE carrying (stealth, vanish, invisibility: every source
    // rides the stealth aura kind) drops the flag at the carrier's feet; the
    // runner stays hidden but flagless, so the enemy team never chases an
    // entity their snapshots cannot see
    hide();
    expect(e.stealthed).toBe(true);
    sim.tick();
    expect(match.flags[1].state).toBe('dropped');
    expect(match.flags[1].carrier).toBe(null);
    expect(e.stealthed).toBe(true); // the hide itself survives; the flag does not
    expect(match.flags[1].pos.x).toBeCloseTo(e.pos.x, 3);
    expect(match.flags[1].pos.z).toBeCloseTo(e.pos.z, 3);
    // and the dropped flag then behaves like any drop: an enemy re-press takes it
    const azure = match.teams[1].find((pid) => pid !== runner)!;
    tp(sim, azure, match.flags[1].pos.x, match.flags[1].pos.z);
    stripProtection(sim, azure);
    sim.bgFlagAction(azure);
    sim.tick();
    expect(match.flags[1].state).toBe('home'); // own team: proximity return wins
  });
});

describe('Ravenrift: death, wave respawn, spawn protection', () => {
  it('carrier death drops the flag in place and releasing does nothing', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    expect(match.flags[1].carrier).toBe(carrier);
    kill(sim, carrier);
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.dead).toBe(true);
    expect(match.flags[1].state).toBe('dropped');
    sim.releaseSpirit(carrier); // no graveyard run in a battleground
    expect(e.dead).toBe(true);
    expect(e.ghost).toBeFalsy();
  });

  it('wave respawn: 10s period, the two team clocks offset by 5s, whole wave together', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    expect(match.waveIn[0]).toBeCloseTo(BG_WAVE_PERIOD, 1);
    expect(match.waveIn[1]).toBeCloseTo(BG_WAVE_OFFSET, 1);
    // kill one member of each team plus a second Crimson a moment later
    const c1 = match.teams[0][0];
    const c2 = match.teams[0][1];
    const a1 = match.teams[1][0];
    kill(sim, c1);
    kill(sim, a1);
    sim.tick();
    for (let i = 0; i < 20; i++) sim.tick(); // 1s later
    kill(sim, c2);
    sim.tick();
    // Azure's first wave fires at 5s: a1 back up, both Crimson still down
    while (match.waveIn[1] < BG_WAVE_PERIOD - 0.5 || sim.entities.get(a1)!.dead) {
      sim.tick();
      if (match.timer > 6) break;
    }
    expect(sim.entities.get(a1)!.dead).toBe(false);
    expect(sim.entities.get(c1)!.dead).toBe(true);
    expect(sim.entities.get(c2)!.dead).toBe(true);
    // Crimson's wave fires at 10s: BOTH fallen Crimson respawn together
    while (sim.entities.get(c1)!.dead && match.timer < 11) sim.tick();
    expect(sim.entities.get(c1)!.dead).toBe(false);
    expect(sim.entities.get(c2)!.dead).toBe(false); // died later, joined the same wave
    // respawned at the keep spawn ring, not where they fell
    expect(isBgPos(sim.entities.get(c1)!.pos.x)).toBe(true);
  });

  it('a death just after a wave waits for the NEXT wave (never respawns instantly)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const victim = match.teams[0][0];
    // wait for Crimson's first wave to fire, then die immediately after
    while (match.timer < BG_WAVE_PERIOD + 0.2) sim.tick();
    kill(sim, victim);
    sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(true);
    // still dead 8s later; alive after the full next tick at 20s
    while (match.timer < BG_WAVE_PERIOD + 8) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(true);
    while (match.timer < BG_WAVE_PERIOD * 2 + 0.5) sim.tick();
    expect(sim.entities.get(victim)!.dead).toBe(false);
  });

  it('spawn protection: applies at the gate spawn and on wave respawn, blocks damage and CC, expires', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const guarded = match.teams[0][0];
    const attacker = match.teams[1][0];
    const e = sim.entities.get(guarded)!;
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(true);
    // damage while protected: nothing lands
    const hpBefore = e.hp;
    stripProtection(sim, attacker); // the attacker acting is its own break, keep it clean
    sim.ctx.dealDamage(sim.entities.get(attacker)!, e, 5000, false, 'physical', null, 'hit');
    expect(e.hp).toBe(hpBefore);
    // hostile CC while protected: rejected
    sim.ctx.applyAura(e, {
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      value: 0,
      remaining: 3,
      duration: 3,
      sourceId: attacker,
      school: 'physical',
    });
    expect(e.auras.some((a) => a.kind === 'stun')).toBe(false);
    // it expires on its own after BG_SPAWN_PROTECTION seconds
    for (let i = 0; i < Math.ceil(BG_SPAWN_PROTECTION * 20) + 3; i++) sim.tick();
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(false);
    const hp2 = e.hp;
    sim.ctx.dealDamage(sim.entities.get(attacker)!, e, 500, false, 'physical', null, 'hit');
    expect(e.hp).toBeLessThan(hp2);
  });

  it('spawn protection breaks early on the protected player OWN first hostile action', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const eager = match.teams[0][0];
    const target = match.teams[1][0];
    const e = sim.entities.get(eager)!;
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(true);
    stripProtection(sim, target);
    sim.ctx.dealDamage(e, sim.entities.get(target)!, 50, false, 'physical', null, 'hit');
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(false);
  });
});

describe('Ravenrift: carrier vulnerability (Focused Assault lineage)', () => {
  it('stacks after 45s of continuous holding, one more every 15s, and amplifies damage taken', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    const attacker = match.teams[1][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    tp(sim, carrier, match.flags[1].home.x + 6, match.flags[1].home.z - 8); // off the stand
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    // fast-forward the hold clock to just before the threshold
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY - 0.2;
    for (let i = 0; i < 8; i++) sim.tick();
    let vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln).toBeTruthy();
    expect(vuln!.stacks).toBe(1);
    // one more interval, one more stack (uncapped)
    match.flags[1].carrySeconds += BG_CARRIER_VULN_INTERVAL;
    sim.tick();
    vuln = e.auras.find((a) => a.id === 'bg_carrier_vulnerability');
    expect(vuln!.stacks).toBe(2);
    expect(vuln!.value).toBeCloseTo(0.2, 5);
    // decisive damage check: two stacks take 20% more than clean (sub-lethal
    // amounts, or the overkill clamp equalizes both hits)
    stripProtection(sim, attacker);
    const atk = sim.entities.get(attacker)!;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const withVuln = e.maxHp - e.hp;
    expect(withVuln).toBeGreaterThan(0);
    expect(e.dead).toBe(false);
    // drop the flag (death), stacks clear, same hit lands clean
    kill(sim, carrier);
    sim.tick();
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
    e.dead = false;
    e.hp = e.maxHp;
    sim.ctx.dealDamage(
      atk,
      e,
      40,
      false,
      'shadow',
      null,
      'hit',
      false,
      undefined,
      true,
      false,
      true,
    );
    const clean = e.maxHp - e.hp;
    expect(withVuln / clean).toBeCloseTo(1.2, 1);
  });

  it('clears on capture and on return', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const carrier = match.teams[0][0];
    tp(sim, carrier, match.flags[1].home.x, match.flags[1].home.z);
    sim.bgFlagAction(carrier);
    sim.tick();
    match.flags[1].carrySeconds = BG_CARRIER_VULN_DELAY + 1;
    sim.tick();
    const e = sim.entities.get(carrier)!;
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(true);
    // capture clears the stacks
    tp(sim, carrier, match.flags[0].home.x, match.flags[0].home.z);
    sim.tick();
    expect(match.scores[0]).toBe(1);
    expect(e.auras.some((a) => a.id === 'bg_carrier_vulnerability')).toBe(false);
  });
});

describe('Ravenrift: runes, hostility, and the match clock', () => {
  it('stepping on a sprint rune grants 1.4x haste for 8s and the rune recharges over 22s', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const runner = match.teams[0][0];
    const rune = match.runes[0];
    expect(rune.active).toBe(true);
    tp(sim, runner, rune.pos.x, rune.pos.z);
    sim.tick();
    const e = sim.entities.get(runner)!;
    const sprint = e.auras.find((a) => a.id === 'bg_sprint_rune');
    expect(sprint).toBeTruthy();
    expect(sprint!.value).toBeCloseTo(1.4, 5);
    expect(sprint!.duration).toBeCloseTo(8, 5);
    expect(rune.active).toBe(false); // consumed, now recharging
    tp(sim, runner, rune.pos.x + 20, rune.pos.z); // step away
    rune.cooldown = 0.1; // fast-forward the 22s recharge
    sim.tick();
    sim.tick();
    expect(match.runes[0].active).toBe(true);
    expect(match.runes[0].cooldown).toBeLessThanOrEqual(0);
  });

  it('enemies are hostile, teammates are not (and cannot be healed cross-team)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const a = sim.entities.get(match.teams[0][0])!;
    const mate = sim.entities.get(match.teams[0][1])!;
    const foe = sim.entities.get(match.teams[1][0])!;
    expect(sim.isHostileTo(a, foe)).toBe(true);
    expect(sim.isHostileTo(a, mate)).toBe(false);
    expect(sim.isHostileTo(foe, a)).toBe(true);
  });

  it('an equal score at the 720s cap is a draw: Elo moves by the 0.5 draw math, no W/L', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    // skew the team averages so the draw math must move points
    for (const pid of match.teams[0]) sim.meta(pid)!.bgRating = 1600;
    for (const pid of match.teams[1]) sim.meta(pid)!.bgRating = 1400;
    match.ratingAvg = [1600, 1400];
    toActive(sim, match);
    captureOnce(sim, match, match.teams[0][0]);
    // give Azure an equalizer via the mirror path
    const azureRunner = match.teams[1][0];
    tp(sim, azureRunner, match.flags[0].pos.x, match.flags[0].pos.z);
    sim.bgFlagAction(azureRunner);
    sim.tick();
    tp(sim, azureRunner, match.flags[1].home.x, match.flags[1].home.z);
    sim.tick();
    expect(match.scores).toEqual([1, 1]);
    match.timer = BG_MAX_DURATION - 0.1;
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.bgMatchFor(pids[0])).toBe(null);
    const expected = eloDelta(1600, 1400, 0.5); // negative: the favorite dropped a draw
    expect(expected).toBeLessThan(0);
    for (const pid of match.teams[0]) {
      expect(sim.meta(pid)!.bgRating).toBe(1600 + expected);
      expect(sim.meta(pid)!.bgWins).toBe(0);
      expect(sim.meta(pid)!.bgLosses).toBe(0);
    }
    for (const pid of match.teams[1]) expect(sim.meta(pid)!.bgRating).toBe(1400 - expected);
  });

  it('team Elo is zero-sum on a decisive result', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const before = [...match.teams[0], ...match.teams[1]].reduce(
      (s, p) => s + sim.meta(p)!.bgRating,
      0,
    );
    const winners = [...match.teams[0]];
    const losers = [...match.teams[1]];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winners[0]);
    const after = [...winners, ...losers].reduce((s, p) => s + sim.meta(p)!.bgRating, 0);
    expect(after).toBe(before); // zero-sum (no one near the floor)
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(losers[0])!.bgRating).toBeLessThan(1500);
  });

  it('a team that fully leaves forfeits: rating moves, no honor is paid', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winners = [...match.teams[0]];
    const honorBefore = sim.meta(winners[0])!.honor;
    for (const pid of [...match.teams[1]]) sim.removePlayer(pid);
    expect(sim.bgMatchFor(winners[0])).toBe(null);
    expect(sim.meta(winners[0])!.bgRating).toBeGreaterThan(1500);
    expect(sim.meta(winners[0])!.bgWins).toBe(1);
    expect(sim.meta(winners[0])!.honor).toBe(honorBefore); // forfeits pay nothing
  });
});

describe('Ravenrift: review-hardening pins', () => {
  it('the battleground phase draws ZERO rng (the tick-position justification)', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    // Drive the phase DIRECTLY (not sim.tick, whose other phases draw) across
    // countdown tail, wave respawns, a rune claim, and a capture: the shared
    // rng state must not move by a single draw.
    const rngState = () => (sim.rng as unknown as { s: number }).s;
    const runner = match.teams[0][0];
    tp(sim, runner, match.runes[0].pos.x, match.runes[0].pos.z);
    kill(sim, match.teams[1][1]);
    const timerBefore = match.timer;
    const before = rngState();
    for (let i = 0; i < 20 * 15; i++) updateBattleground(sim.ctx);
    expect(rngState()).toBe(before); // zero draws across 15s of battleground
    expect(match.timer).toBeGreaterThan(timerBefore + 10); // and the phase really ran
    expect(sim.entities.get(match.teams[1][1])!.dead).toBe(false); // wave fired
  });

  it('a single deserter takes the rating loss and the recorded L; the team fights on', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const leaver = match.teams[1][0];
    const stayer = match.teams[1][1];
    const before = sim.meta(leaver)!.bgRating;
    // the server's pre-save path resolves the desertion while the meta is live
    sim.bgResolveDesertion(leaver);
    expect(sim.meta(leaver)!.bgRating).toBeLessThan(before); // the loss delta landed
    expect(sim.meta(leaver)!.bgLosses).toBe(1);
    const afterFirst = sim.meta(leaver)!.bgRating;
    sim.bgResolveDesertion(leaver); // idempotent: already off the roster
    expect(sim.meta(leaver)!.bgRating).toBe(afterFirst);
    // the match continues a player down; nobody else was scored yet
    expect(sim.bgMatchFor(stayer)).toBe(match);
    expect(sim.bgMatchFor(leaver)).toBe(null);
    expect(match.teams[1]).toHaveLength(4);
    expect(sim.meta(stayer)!.bgLosses).toBe(0);
  });

  it('an over-size group (a raid) is refused with a message, never silently truncated', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    tp(sim, leader, 0, -40);
    const members = [leader];
    for (let i = 0; i < 5; i++) {
      const m = sim.addPlayer('priest', `Mate${i}`);
      tp(sim, m, 0, -40);
      members.push(m);
    }
    // assemble a six-member group directly on the PartyMachine (raid-size
    // groups exceed the normal invite cap; the offline staging precedent)
    const machine = (
      sim as unknown as {
        party: { parties: Map<number, unknown>; partyByPid: Map<number, number> };
      }
    ).party;
    machine.parties.set(77, { id: 77, leader, members: [...members] });
    for (const m of members) machine.partyByPid.set(m, 77);
    sim.bgQueueJoin(leader); // group of six
    expect(sim.bgInfoFor(leader)!.queued).toBe(false);
    expect(sim.bgInfoFor(leader)!.queueSize).toBe(0);
  });

  it('a queued player who walks into an instance is evicted with the leave notice', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    tp(sim, a, 0, -40);
    sim.bgQueueJoin(a);
    sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(true);
    tp(sim, a, 900, -1250); // a dungeon instance band
    const evs = sim.tick();
    expect(sim.bgInfoFor(a)!.queued).toBe(false);
    expect(evs.some((e) => e.type === 'bgUnqueued' && e.pid === a)).toBe(true);
  });

  it('spawn protection breaks on a hostile SILENCE too (the broad control set), and on pet damage', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const caster = match.teams[0][0];
    const target = match.teams[1][0];
    const e = sim.entities.get(caster)!;
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(true);
    // casting a silence (not a stun: the broad Ice Block predicate) breaks it
    sim.ctx.applyAura(sim.entities.get(target)!, {
      id: 'test_silence',
      name: 'Test Silence',
      kind: 'silence',
      value: 0,
      remaining: 2,
      duration: 2,
      sourceId: caster,
      school: 'shadow',
    });
    expect(e.auras.some((a) => a.kind === 'spawn_protection')).toBe(false);
    // and pet damage resolves to the owning player (the gate protection every
    // fighter still carries right after gates-open is the fixture)
    const owner = match.teams[1][1];
    const oe = sim.entities.get(owner)!;
    expect(oe.auras.some((a) => a.kind === 'spawn_protection')).toBe(true);
    const pet = sim.entities.get(match.teams[0][1])!;
    const petLike = { ...pet, kind: 'mob' as const, ownerId: owner, id: 999999 };
    sim.ctx.dealDamage(
      petLike as typeof pet,
      sim.entities.get(caster)!,
      5,
      false,
      'physical',
      null,
      'hit',
    );
    expect(oe.auras.some((a) => a.kind === 'spawn_protection')).toBe(false);
  });

  it('a live participant cannot enter a delve mid-match', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const pid = match.teams[0][0];
    sim.enterDelve('collapsed_reliquary', 'tier1', pid);
    sim.tick();
    expect(sim.bgMatchFor(pid)).toBe(match); // still in the match, not in a delve
    expect(isBgPos(sim.entities.get(pid)!.pos.x)).toBe(true);
  });

  it('the honor DR window round-trips through CharacterState and clears on UTC rollover', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winner);
    const daily = sim.meta(winner)!.honorArenaDaily!;
    expect(daily.bgResultsByOpponent).toBeTruthy();
    expect(Object.values(daily.bgResultsByOpponent!)).toEqual([1]);
    // persists across a save/load round trip (the anti-win-trading window)
    const state = sim.serializeCharacter(winner)!;
    expect(state.honorArenaDaily!.bgResultsByOpponent).toEqual(daily.bgResultsByOpponent);
    const sim2 = makeWorld();
    const reloaded = sim2.addPlayer('warrior', 'Reload', { state });
    expect(sim2.meta(reloaded)!.honorArenaDaily!.bgResultsByOpponent).toEqual(
      daily.bgResultsByOpponent,
    );
  });
});

describe('Ravenrift: honor + persistence', () => {
  it('a played-out win pays BATTLEGROUND_WIN_HONOR, the losers BATTLEGROUND_LOSS_HONOR, repeat-decayed', () => {
    const { sim, pids } = tenInQueue();
    const match = sim.bgMatchFor(pids[0])!;
    toActive(sim, match);
    const winner = match.teams[0][0];
    const loser = match.teams[1][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, match, winner);
    expect(sim.meta(winner)!.honor).toBe(BATTLEGROUND_WIN_HONOR);
    expect(sim.meta(winner)!.lifetimeHonor).toBe(BATTLEGROUND_WIN_HONOR);
    expect(sim.meta(loser)!.honor).toBe(BATTLEGROUND_LOSS_HONOR);

    // the same ten rematch: the repeat vs the SAME opposing team pays half
    for (const pid of pids) sim.bgQueueJoin(pid);
    sim.tick();
    const rematch = sim.bgMatchFor(winner)!;
    expect(rematch).toBeTruthy();
    toActive(sim, rematch);
    const winner2 = rematch.teams[0][0];
    for (let cap = 0; cap < 5; cap++) captureOnce(sim, rematch, winner2);
    const w2meta = sim.meta(winner2)!;
    const firstAward = rematch.teams[0].includes(winner)
      ? BATTLEGROUND_WIN_HONOR
      : BATTLEGROUND_LOSS_HONOR;
    expect(w2meta.honor).toBe(firstAward + Math.floor(BATTLEGROUND_WIN_HONOR * 0.5));
  });

  it('battleground standing round-trips through CharacterState and stays absent until first result', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('druid', 'Keeper');
    // untouched standing: the save carries NO bg fields (byte-stable saves)
    const clean = sim.serializeCharacter(a)!;
    expect(clean.bgRating).toBeUndefined();
    expect(clean.bgWins).toBeUndefined();
    sim.meta(a)!.bgRating = 1633;
    sim.meta(a)!.bgWins = 7;
    sim.meta(a)!.bgCaptures = 19;
    const state = sim.serializeCharacter(a)!;
    expect(state.bgRating).toBe(1633);
    expect(state.bgWins).toBe(7);
    expect(state.bgLosses).toBe(0);
    expect(state.bgCaptures).toBe(19);
    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('druid', 'Keeper', { state });
    expect(sim2.meta(a2)!.bgRating).toBe(1633);
    expect(sim2.meta(a2)!.bgWins).toBe(7);
    expect(sim2.meta(a2)!.bgCaptures).toBe(19);
  });
});
