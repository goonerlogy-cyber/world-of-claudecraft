// Canvas painter for the M-key world map's Ravenrift surface (the delve
// schematic's routing sibling): an illustrated field plan drawn from the same
// battleground_layout data the colliders use (walls, keeps, graveyard plots,
// flag stands), so the map can never drift from the real field,
// plus the honest marker set the pure model provides (self + teammates only;
// the fog's no-scouting rule owns everything else).
//
// The terrain palette is hardcoded here the way map_terrain.ts hardcodes the
// world-map biome colours: sand flagstone ground, slate stone walls, dirt
// graveyards, sampled from the real field dressing. Only the two team hues
// resolve from CSS tokens (the minimap_painter caching rule: static :root
// tokens, no runtime mutation) so they ride the shared --color-team-*.

import {
  BG_BASES,
  BG_CURTAIN_Z,
  BG_GRAVEYARDS,
  battlegroundWallSegments,
  keepInteriorBounds,
} from '../../../sim/battleground_layout';
import type { BgMapModel } from './battleground_map_view';

const MAP_COLOR_TOKENS = {
  teamRed: '--color-team-red',
  teamBlue: '--color-team-blue',
  dead: '--color-minimap-party-dead',
} as const;

type BgMapColors = Record<keyof typeof MAP_COLOR_TOKENS, string>;

// Field palette (see header): ground reads light so the slate walls and the
// team-colour marks always separate from it, killing the black-on-black look.
const GROUND_LIGHT = '#c6b99d';
const GROUND_DARK = '#a99c80';
const KEEP_FLOOR = '#a49c8f';
const GRAVE_DIRT = '#8a7a5e';
const WALL_FILL = '#333a48';
const WALL_LOW_FILL = '#4e576a';
const FENCE_FILL = '#6d5a41';
const FIELD_EDGE = '#262c38';
const INK = '#00000090'; // dark edge that holds glyphs on the pale ground
const CARRY_RING = '#ffb03c'; // the scoreboard's .carried orange

const FIELD_PAD_PX = 18;
const MATE_R = 4;
const SELF_R = 6;

export class BattlegroundMapPainter {
  private colors: BgMapColors | null = null;

  private resolveColors(): BgMapColors | null {
    if (this.colors) return this.colors;
    const style = getComputedStyle(document.documentElement);
    const out = {} as Record<string, string>;
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      const v = style.getPropertyValue(token).trim();
      if (!v) return null; // stylesheet not applied yet: draw next frame
      out[key] = v;
    }
    this.colors = out as BgMapColors;
    return this.colors;
  }

  /** Draw the full-field plan + markers into the square map canvas. */
  paint(ctx: CanvasRenderingContext2D, model: BgMapModel, canvasSize: number): void {
    const colors = this.resolveColors();
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    if (!model.active || !colors) return;
    // Fit the tall field (2*halfX wide, 2*halfZ deep) into the square canvas;
    // +z (the away half) points UP, so map y = -z.
    const s = Math.min(
      (canvasSize - FIELD_PAD_PX * 2) / (model.halfX * 2),
      (canvasSize - FIELD_PAD_PX * 2) / (model.halfZ * 2),
    );
    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const px = (x: number): number => cx + x * s;
    const py = (z: number): number => cy - z * s;
    const flip = model.myTeam === 0 ? 1 : -1;
    const left = cx - model.halfX * s;
    const top = cy - model.halfZ * s;
    const fieldW = model.halfX * 2 * s;
    const fieldH = model.halfZ * 2 * s;

    // Ground: sand flagstone, lighter through the Ruin Courtyard so the three
    // chambers read even before the curtain walls are drawn over it.
    const ground = ctx.createLinearGradient(0, top, 0, top + fieldH);
    ground.addColorStop(0, GROUND_DARK);
    ground.addColorStop(0.5, GROUND_LIGHT);
    ground.addColorStop(1, GROUND_DARK);
    ctx.fillStyle = ground;
    ctx.fillRect(left, top, fieldW, fieldH);

    // Keep floors: cooler stone inside each keep (bounds are team-symmetric,
    // so the flip never moves the union).
    ctx.fillStyle = KEEP_FLOOR;
    for (const team of [0, 1] as const) {
      const b = keepInteriorBounds(team);
      ctx.fillRect(px(b.minX), py(b.maxZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    }

    // Team end washes: your colour bleeds up from the bottom edge, theirs down
    // from the top, fading out at the curtain line, so orientation reads at a
    // glance without hiding the ground.
    const own = this.ownTint(model, colors);
    const foe = this.foeTint(model, colors);
    for (const [tint, edgeZ] of [
      [own, -model.halfZ],
      [foe, model.halfZ],
    ] as const) {
      const wash = ctx.createLinearGradient(0, py(edgeZ), 0, py(Math.sign(edgeZ) * BG_CURTAIN_Z));
      wash.addColorStop(0, tint);
      wash.addColorStop(1, '#00000000');
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = wash;
      ctx.fillRect(left, top, fieldW, fieldH);
      ctx.restore();
    }

    // Mid line: the halfway mark, dashed so it never reads as a wall.
    ctx.save();
    ctx.strokeStyle = '#00000026';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, py(0));
    ctx.lineTo(left + fieldW, py(0));
    ctx.stroke();
    ctx.restore();

    // Graveyard plots: dirt inside the rails with a faint side tint (by MAP
    // side, not home team id: the bottom, own, side reads in your colour).
    for (const plot of BG_GRAVEYARDS) {
      const x = plot.x * flip;
      const z = plot.z * flip;
      const gx = px(x - plot.hw);
      const gy = py(z + plot.hd);
      ctx.fillStyle = GRAVE_DIRT;
      ctx.fillRect(gx, gy, plot.hw * 2 * s, plot.hd * 2 * s);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = z < 0 ? own : foe;
      ctx.fillRect(gx, gy, plot.hw * 2 * s, plot.hd * 2 * s);
      ctx.restore();
    }

    // Walls (every collider-backed segment): full ramparts in dark slate, low
    // barricades a lighter slate, graveyard fence rails in weathered wood.
    for (const w of battlegroundWallSegments()) {
      const x = w.x * flip;
      const z = w.z * flip;
      ctx.fillStyle = w.fence ? FENCE_FILL : w.low ? WALL_LOW_FILL : WALL_FILL;
      ctx.fillRect(px(x - w.hw), py(z + w.hd), w.hw * 2 * s, w.hd * 2 * s);
    }

    // Field frame on top of the walls, so the perimeter reads as one edge.
    // Pillars, crates, and the rune pads stay OFF the plan on purpose: the
    // map answers routes and objectives, small furniture is just noise.
    ctx.strokeStyle = FIELD_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, fieldW, fieldH);

    // Flag STANDS (static; live flag positions are deliberately not mapped).
    // The stands are the objective, so they read LARGE: a bold banner glyph
    // with a dark edge so it holds on both the keep floor and the wash.
    for (const base of BG_BASES) {
      const x = px(base.flag.x * flip);
      const y = py(base.flag.z * flip);
      const mine = base.team === model.myTeam;
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.fillStyle = mine ? own : foe;
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x + 10, y - 7.5);
      ctx.lineTo(x, y - 3);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.fillRect(x - 1.5, y - 12, 2.5, 14);
      ctx.restore();
    }

    // Teammates: team-colour discs (hollow when dead, an orange ring when
    // carrying), each with a dark edge so they hold on the pale ground.
    for (const mate of model.mates) {
      const x = px(mate.x);
      const y = py(mate.z);
      ctx.beginPath();
      ctx.arc(x, y, MATE_R, 0, Math.PI * 2);
      if (mate.dead) {
        ctx.strokeStyle = colors.dead;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = own;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (mate.carrying) {
        ctx.strokeStyle = CARRY_RING;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, MATE_R + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Self: the standard player arrow, rotated with the oriented facing,
    // white with a dark edge so it survives the light sand.
    const self = model.self;
    if (self) {
      ctx.save();
      ctx.translate(px(self.x), py(self.z));
      ctx.rotate(self.facing);
      ctx.beginPath();
      ctx.moveTo(0, -SELF_R - 2);
      ctx.lineTo(SELF_R - 1, SELF_R);
      ctx.lineTo(0, SELF_R * 0.45);
      ctx.lineTo(-SELF_R + 1, SELF_R);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  private ownTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamRed : colors.teamBlue;
  }

  private foeTint(model: BgMapModel, colors: BgMapColors): string {
    return model.myTeam === 0 ? colors.teamBlue : colors.teamRed;
  }
}
