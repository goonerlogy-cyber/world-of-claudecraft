// Per-frame Ravenrift flag/rune animation + state-transition bursts. The
// renderer constructs one and calls update(time) from the live sync() fx block
// each frame; all math and the transition classifier live in
// battleground_fx_core (pure, Node-tested). This module only touches child
// objects the props builder handed it via `group.userData.bg` (BgObjectRefs):
// the group's own position/rotation stay renderer-owned, so there is nothing
// to fight.
//
// Flag state comes from bgInfo (the IWorld battleground facet), which is
// non-null exactly while the local player is in a match. Outside a match the
// pass early-returns before touching a single view, so the open world pays
// one null check per frame. A flag whose view was not seen this frame has its
// track dropped, so a view that churns out and back can never fire a
// celebration burst for a transition nobody watched.
import * as THREE from 'three';
import { BG_TEAM_COLORS } from '../sim/battleground_layout';
import type { BgInfo } from '../world_api/battleground';
import {
  type BgFlagState,
  carriedLean,
  classifyFlagTransition,
  runeGemPose,
} from './battleground_fx_core';
import type { BgObjectRefs } from './battleground_props';
import type { Vfx } from './vfx';

const CAPTURE_GOLD = 0xffd24a;
const RETURN_GREEN = 0x9fdc7f;
const PICKUP_WHITE = 0xffffff;

// Burst anchor scratch: fireworkBurst reads at.x/y/z synchronously and keeps
// no reference, so one module-level vector serves every transition frame.
const tmpV = new THREE.Vector3();

interface ViewLike {
  group: THREE.Group;
}

interface FlagTrack {
  state: BgFlagState;
  x: number;
  y: number;
  z: number;
  yaw: number; // last applied lean yaw, held across carrier-view gaps
}

export class BattlegroundFx {
  // Last observed state + world position per flag (indexed by home team);
  // the position is last frame's, which is exactly the burst anchor a
  // capture/return needs (the entity has already snapped home this frame).
  private tracks: [FlagTrack | null, FlagTrack | null] = [null, null];

  constructor(
    private readonly sim: { bgInfo: BgInfo | null },
    private readonly views: Map<number, ViewLike>,
    private readonly vfx: Vfx,
  ) {}

  update(time: number): void {
    const match = this.sim.bgInfo?.match ?? null;
    if (!match) {
      // Open world / queue screen: no bg objects exist, pay nothing.
      this.tracks[0] = null;
      this.tracks[1] = null;
      return;
    }
    const seen = [false, false];
    for (const view of this.views.values()) {
      const bg = view.group.userData.bg as BgObjectRefs | undefined;
      if (!bg) continue;
      if (bg.kind === 'rune') {
        const pose = runeGemPose(time);
        bg.gem.rotation.y = pose.spin;
        bg.gem.position.y = bg.gemBaseY + pose.bob;
        continue;
      }
      const flag = match.flags[bg.team];
      if (!flag) continue;
      seen[bg.team] = true;
      const carried = flag.state === 'carried';
      bg.ring.visible = carried;
      const prev = this.tracks[bg.team];
      let yaw = 0;
      if (carried) {
        const lean = carriedLean(time);
        const carrierView = flag.carrierPid !== null ? this.views.get(flag.carrierPid) : undefined;
        // Yaw the lean pivot to the carrier's facing (group yaw is the flag
        // entity's own facing, effectively 0), then tip it back. When the
        // carrier's view is momentarily absent, hold the last yaw instead of
        // snapping to world north.
        yaw =
          carrierView !== undefined
            ? carrierView.group.rotation.y - view.group.rotation.y
            : (prev?.yaw ?? 0);
        bg.lean.rotation.y = yaw;
        bg.lean.rotation.x = -lean.tilt;
        bg.lean.position.y = lean.bob;
      } else {
        bg.lean.rotation.y = 0;
        bg.lean.rotation.x = 0;
        bg.lean.position.y = 0;
      }
      const pos = view.group.position;
      const fx = classifyFlagTransition(prev?.state ?? null, flag.state);
      if (fx === 'pickup') {
        this.vfx.fireworkBurst(
          tmpV.set(pos.x, pos.y + 1.4, pos.z),
          [bg.color, PICKUP_WHITE],
          20,
          0.8,
        );
      } else if (fx === 'capture' && prev) {
        // The burst belongs where the score happened: the carrier's stand,
        // i.e. the flag's position last frame, in the CAPTURING team's color.
        this.vfx.fireworkBurst(
          tmpV.set(prev.x, prev.y + 2, prev.z),
          [BG_TEAM_COLORS[1 - bg.team], CAPTURE_GOLD],
          60,
          1.5,
        );
      } else if (fx === 'return' && prev) {
        this.vfx.fireworkBurst(
          tmpV.set(prev.x, prev.y + 1.2, prev.z),
          [bg.color, RETURN_GREEN],
          14,
          0.6,
        );
      }
      this.tracks[bg.team] = { state: flag.state, x: pos.x, y: pos.y, z: pos.z, yaw };
    }
    // A flag view missing this frame (interest churn, rebuild) invalidates its
    // track: transitions across the gap were not observed, so they never burst.
    if (!seen[0]) this.tracks[0] = null;
    if (!seen[1]) this.tracks[1] = null;
  }
}
