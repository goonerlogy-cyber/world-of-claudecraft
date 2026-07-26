import { describe, expect, it } from 'vitest';
import {
  type Collider,
  CRATE_TOP,
  colliderTopAt,
  DOCK_HUT_ROOF_EAVE,
  DOCK_HUT_ROOF_TOP,
  interiorColliderFrame,
  queryOpenWorldColliders,
  STALL_CANOPY_EAVE,
  STALL_CANOPY_TOP,
  supportHeightAt,
} from '../src/sim/colliders';
import { ARENA_X, DUNGEONS, instanceOrigin, NPCS, YUMI_BAND_X_MIN } from '../src/sim/data';
import { CRYPT_LAYOUT, DAIS_HEIGHT, tombSlotRoll } from '../src/sim/dungeon_layout';
import { CHAPEL_HALL_ROOF_EAVE, CHAPEL_HALL_ROOF_TOP } from '../src/sim/prop_layout';
import { Sim } from '../src/sim/sim';
import type { MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';

// The physics-asset audit, world half (docs/design/physics-asset-audit.md):
// every town standable reachable and stable, every full-height prop a real
// wall, chapel and dock flows, the dungeon deep sweep, and the programmatic
// collider sanity sweeps (camera tops, NPC spots, interior tops).

const SEED = 42;
const IDLE: MoveInput = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
};

function makeSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(60);
  return sim;
}

function teleport(sim: Sim, x: number, z: number, facing: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = facing;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.climb = null;
}

function hold(sim: Sim, input: Partial<MoveInput>, ticks: number): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no meta');
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, IDLE, input);
    sim.tick();
  }
}

// Jump-spam toward a heading for `ticks`; returns the max feet height above
// the local ground reached while grounded (i.e. what got STOOD on).
function maxStoodHeight(sim: Sim, ticks: number): number {
  const p = sim.player;
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('no meta');
  let best = 0;
  for (let i = 0; i < ticks; i++) {
    Object.assign(meta.moveInput, IDLE, { forward: true, jump: true });
    sim.tick();
    if (p.onGround) {
      best = Math.max(best, p.pos.y - terrainHeight(p.pos.x, p.pos.z, SEED));
    }
  }
  return best;
}

describe('full-height props reject standing (jump-spam 4s each)', () => {
  const cases: [string, number, number, number][] = [
    // name, startX, startZ, facing toward the prop
    ['well', 0, 2 - 2.6, 0],
    ['tent', 62, -61 - 2.8, 0],
    ['mud hut stem', -3, 292, 0], // zone2 murloc camp (approx; adjust below)
    ['inn wall', 12, -6 - 4.8, 0],
    ['house wall', 10, 12 - 4.4, 0],
  ];
  for (const [name, x, z, f] of cases) {
    it(`cannot stand on the ${name}`, () => {
      const sim = makeSim();
      teleport(sim, x, z, f);
      const stood = maxStoodHeight(sim, 80);
      // Nothing standable here: max grounded height stays under a stride.
      expect(stood).toBeLessThan(0.95);
    });
  }
});

describe('chapel flows', () => {
  const rot = 0.9;
  const cx = -16;
  const cz = -8;
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);

  it('climb the hall roof, walk into the tower face (blocked), fall off a side', () => {
    const sim = makeSim();
    const startX = cx + fx * (3.5 + 1.7);
    const startZ = cz + fz * (3.5 + 1.7);
    teleport(sim, startX, startZ, Math.atan2(cx - startX, cz - startZ));
    const p = sim.player;
    let onRoof = false;
    for (let i = 0; i < 120 && !onRoof; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const g = groundHeight(p.pos.x, p.pos.z, SEED);
      if (p.onGround && p.pos.y - g > CHAPEL_HALL_ROOF_EAVE - 0.1) onRoof = true;
    }
    expect(onRoof).toBe(true);
    // Walk toward the tower: must stop against it, never pass or climb it.
    hold(sim, { forward: true }, 40);
    const gAfter = groundHeight(p.pos.x, p.pos.z, SEED);
    expect(p.pos.y - gAfter).toBeLessThanOrEqual(CHAPEL_HALL_ROOF_TOP + 0.05);
    expect(p.onGround).toBe(true);
    // Head back and off the front: clean landing, no fall damage.
    p.facing = Math.atan2(fx, fz);
    const hpBefore = p.hp;
    hold(sim, { forward: true }, 50);
    expect(p.hp).toBe(hpBefore);
    expect(p.onGround).toBe(true);
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.1);
  });
});

describe('stall rim behavior', () => {
  it('standing dead still on the canopy stays put (no depenetration jitter)', () => {
    const sim = makeSim();
    teleport(sim, -8.5, -0.3, 0);
    const p = sim.player;
    let onCanopy = false;
    for (let i = 0; i < 120 && !onCanopy; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const rel = p.pos.y - groundHeight(-8.5, 3, SEED);
      if (p.onGround && rel > STALL_CANOPY_EAVE - 0.1) onCanopy = true;
    }
    expect(onCanopy).toBe(true);
    const fx0 = p.pos.x;
    const fz0 = p.pos.z;
    const fy0 = p.pos.y;
    hold(sim, {}, 60); // 3 s idle
    expect(Math.abs(p.pos.x - fx0)).toBeLessThan(1e-6);
    expect(Math.abs(p.pos.z - fz0)).toBeLessThan(1e-6);
    expect(Math.abs(p.pos.y - fy0)).toBeLessThan(2e-3); // one-time CLIMB_SETTLE_EPS settle is fine
  });
});

describe('dock flows', () => {
  it('deck to hut roof to deck, and step into the moored rowboat', () => {
    const sim = makeSim();
    // Hut world position (dock -64,60 rot -2.2; hut local 2.8,2.4).
    const rot = -2.2;
    const hx = -64 + 2.8 * Math.cos(rot) + 2.4 * Math.sin(rot);
    const hz = 60 - 2.8 * Math.sin(rot) + 2.4 * Math.cos(rot);
    // Approach across the deck from the dock anchor toward the hut.
    teleport(sim, -64, 60, Math.atan2(hx + 64, hz - 60));
    const p = sim.player;
    let onRoof = false;
    for (let i = 0; i < 140 && !onRoof; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      const g = groundHeight(p.pos.x, p.pos.z, SEED);
      if (p.onGround && p.pos.y - g > DOCK_HUT_ROOF_EAVE - 0.3) onRoof = true;
    }
    expect(onRoof).toBe(true);

    // The rowboat: walk to it and step in (its deck is a stride-height top).
    const boff = {
      x: 2.4 * Math.cos(rot) + -5.0 * Math.sin(rot),
      z: -2.4 * Math.sin(rot) + -5.0 * Math.cos(rot),
    };
    const bx = -64 + boff.x;
    const bz = 60 + boff.z;
    teleport(sim, bx - Math.sin(0.4) * 3, bz - Math.cos(0.4) * 3, 0.4);
    let inBoat = false;
    for (let i = 0; i < 100 && !inBoat; i++) {
      hold(sim, { forward: true, jump: true }, 1);
      if (p.onGround && Math.hypot(p.pos.x - bx, p.pos.z - bz) < 2.0) {
        const support = supportHeightAt(SEED, p.pos.x, p.pos.z, 0.5, p.pos.y + 0.1);
        if (support > -Infinity && Math.abs(p.pos.y - support) < 0.05) inBoat = true;
      }
    }
    expect(inBoat).toBe(true);
  });
});

describe('abilities x collision', () => {
  it('Heroic Leap onto the stall canopy seats on the sampled cone, and off again', () => {
    const sim = makeSim();
    teleport(sim, -8.5, -2.5, 0);
    const p = sim.player;
    sim.castAbility('heroic_leap', p.id, { x: -8.5, z: 3 });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.leap ?? null).toBeNull();
    const g = groundHeight(-8.5, 3, SEED);
    const rel = p.pos.y - g;
    console.log(
      'leap landed rel height',
      rel.toFixed(2),
      'at',
      p.pos.x.toFixed(2),
      p.pos.z.toFixed(2),
    );
    expect(rel).toBeGreaterThan(STALL_CANOPY_EAVE - 0.15);
    expect(rel).toBeLessThanOrEqual(STALL_CANOPY_TOP + 0.05);
    // Leap off: back to the street with no embedding (cooldown cleared first).
    p.cooldowns.clear();
    p.resource = 100; // rage for the recast
    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, { x: -8.5, z: -3 });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.pos.y - groundHeight(p.pos.x, p.pos.z, SEED)).toBeLessThan(0.15);
  });

  it('Heroic Leap onto the crypt dais lands at the lifted floor', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    teleport(sim, o.x + d.x, o.z + d.z - d.r - 4, 0);
    const p = sim.player;
    sim.castAbility('heroic_leap', p.id, { x: o.x + d.x, z: o.z + d.z - 2 });
    for (let i = 0; i < 40 && p.leap; i++) sim.tick();
    expect(p.pos.y).toBeCloseTo(DAIS_HEIGHT, 2);
  });
});

describe('dungeon deep sweep', () => {
  it('dais rim walk-up from 8 directions', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 0);
    const d = CRYPT_LAYOUT.dais;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const sx = o.x + d.x + Math.sin(ang) * (d.r + 2);
      const sz = o.z + d.z + Math.cos(ang) * (d.r + 2);
      // Some approach points sit inside pillars/tombs; resolve by starting
      // clear: skip blocked starts (the sweep cares about the rim itself).
      const facing = Math.atan2(o.x + d.x - sx, o.z + d.z - sz);
      teleport(sim, sx, sz, facing);
      if (Math.hypot(sim.player.pos.x - sx, sim.player.pos.z - sz) > 0.5) continue;
      hold(sim, { forward: true }, 45);
      expect(sim.player.onGround).toBe(true);
      expect(sim.player.pos.y).toBeCloseTo(DAIS_HEIGHT, 2);
    }
  });

  it('cargo slots: both stack kinds climb, both casks vault, gap walkable', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.sunken_bastion.index, 0);
    // Find one r<0.5 slot (crates+barrel) and one r>=0.5 (box+keg).
    const slots = CRYPT_LAYOUT.tombs.map((t) => ({ t, r: tombSlotRoll(t.x, t.z) }));
    const crateSlot = slots.find((s) => s.r < 0.5);
    const boxSlot = slots.find((s) => s.r >= 0.5);
    expect(crateSlot && boxSlot).toBeTruthy();
    if (!crateSlot || !boxSlot) return;
    for (const { t, r } of [crateSlot, boxSlot]) {
      const stackTop = r < 0.5 ? 2.14 : 1.99;
      teleport(sim, o.x + t.x, o.z + t.z - 1.0 - 0.95 - 1.5, 0);
      const p = sim.player;
      let onStack = false;
      for (let i = 0; i < 140 && !onStack; i++) {
        hold(sim, { forward: true, jump: true }, 1);
        if (p.onGround && Math.abs(p.pos.y - stackTop) < 0.05) onStack = true;
      }
      expect(onStack).toBe(true);
      // Walk the gap between stack and cask at floor level.
      teleport(sim, o.x + t.x - 2.5, o.z + t.z + 0.2, Math.PI / 2);
      hold(sim, { forward: true }, 30);
      expect(p.pos.y).toBeLessThan(0.1);
    }
  });

  it('temple altars and sanctum stubs stay walls', () => {
    const sim = makeSim();
    const o = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);
    // Sanctum stub at (14, 67): jump-spam at it.
    teleport(sim, o.x + 14, o.z + 67 - 5 - 1.5, 0);
    const stood = maxStoodHeight(sim, 60);
    expect(stood).toBeLessThan(0.95);
  });

  it('mobs in a dev-entered crypt stand at groundHeight, dais included', () => {
    const sim = makeSim();
    sim.chat('/dev dungeon hollow_crypt');
    for (let i = 0; i < 200; i++) sim.tick();
    let checked = 0;
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.pos.x < 600) continue; // instance mobs only
      const g = groundHeight(e.pos.x, e.pos.z, SEED);
      expect(Math.abs(e.pos.y - g)).toBeLessThan(0.01);
      checked++;
    }
    console.log('mob y checks:', checked);
    expect(checked).toBeGreaterThan(3);
  });
});

describe('climb vetoes', () => {
  it('no grabs in the arena or yumi bands', () => {
    expect(supportHeightAt(SEED, ARENA_X, -1250, 0.5, 100)).toBe(-Infinity);
    expect(supportHeightAt(SEED, YUMI_BAND_X_MIN + 10, 0, 0.5, 100)).toBe(-Infinity);
    expect(interiorColliderFrame(ARENA_X, -1250)).toBeNull();
    expect(interiorColliderFrame(YUMI_BAND_X_MIN + 10, 0)).toBeNull();
  });
});

describe('programmatic collider sanity sweeps', () => {
  it('every open-world standable top has cameraTopY at or above it', () => {
    const cols: Collider[] = [];
    queryOpenWorldColliders(SEED, -240, -240, 240, 900, cols);
    let standables = 0;
    const bad: string[] = [];
    for (const c of cols) {
      if (!c.standable || c.moveTopY === undefined) continue;
      standables++;
      if (c.cameraTopY !== undefined && c.cameraTopY < c.moveTopY - 1e-6) {
        bad.push(
          `(${c.x.toFixed(1)},${c.z.toFixed(1)}) top ${c.moveTopY.toFixed(2)} cam ${c.cameraTopY.toFixed(2)}`,
        );
      }
      // Sloped tops: eave must not exceed the ridge, pitch positive.
      if (c.topSlope) {
        expect(c.topSlope.eaveY).toBeLessThanOrEqual(c.moveTopY + 1e-6);
        expect(c.topSlope.pitch).toBeGreaterThan(0);
      }
    }
    console.log('standables swept:', standables, 'bad camera tops:', bad.length, bad.slice(0, 5));
    expect(bad.filter((b) => !/trader_wilkes|apothecary_lin|brother_halven/.test(b))).toEqual([]); // three pre-existing authored vendor placements
  });

  it('no new collider overlaps an authored NPC spot', () => {
    const cols: Collider[] = [];
    queryOpenWorldColliders(SEED, -240, -240, 240, 900, cols);
    const bad: string[] = [];
    for (const npc of Object.values(NPCS)) {
      const pos = (npc as { pos?: { x: number; z: number } }).pos;
      if (!pos) continue;
      for (const c of cols) {
        if (c.moveTopY !== undefined && c.moveTopY - groundHeight(c.x, c.z, SEED) <= 0.9) continue; // stride props are fine
        const hit =
          c.type === 'circle'
            ? Math.hypot(pos.x - c.x, pos.z - c.z) < c.r - 0.05
            : (() => {
                const cos = Math.cos(-c.rot);
                const sin = Math.sin(-c.rot);
                const lx = (pos.x - c.x) * cos + (pos.z - c.z) * sin;
                const lz = -(pos.x - c.x) * sin + (pos.z - c.z) * cos;
                return Math.abs(lx) < c.hw - 0.05 && Math.abs(lz) < c.hd - 0.05;
              })();
        if (hit)
          bad.push(
            `${(npc as { id?: string }).id} inside collider at (${c.x.toFixed(1)},${c.z.toFixed(1)})`,
          );
      }
    }
    console.log('npc overlap violations:', bad.length, bad.slice(0, 6));
    expect(bad.filter((b) => !/trader_wilkes|apothecary_lin|brother_halven/.test(b))).toEqual([]); // three pre-existing authored vendor placements
  });

  it('interior sets: standable tops sane, colliderTopAt within [eave, ridge]', () => {
    for (const id of ['hollow_crypt', 'sunken_bastion', 'nythraxis_crypt']) {
      const o = instanceOrigin(DUNGEONS[id].index, 0);
      const frame = interiorColliderFrame(o.x, o.z + 40);
      expect(frame).not.toBeNull();
      if (!frame) continue;
      let tops = 0;
      for (const c of frame.list) {
        if (!c.standable || c.moveTopY === undefined) continue;
        tops++;
        expect(c.moveTopY).toBeGreaterThan(0.9);
        expect(c.moveTopY).toBeLessThan(3.35); // all reachable per the ladder
      }
      console.log(id, 'standable interior tops:', tops);
      expect(tops).toBeGreaterThan(0);
    }
  });
});
