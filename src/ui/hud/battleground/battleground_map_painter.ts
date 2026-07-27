// Canvas painter for the M-key world map's Ravenrift surface (the delve
// schematic's routing sibling): the field schematic from the layout record
// (walls, keeps, graveyard plots, rune pads, flag stands) with the honest
// marker set the pure model provides (self + teammates only; the fog's
// no-scouting rule owns everything else). Statics are drawn from the same
// battleground_layout data the colliders use, so the map can never drift
// from the real field.
//
// Colors resolve from CSS tokens once (the minimap_painter caching rule:
// static :root tokens, no runtime mutation) and the two team hues ride the
// shared --color-team-* tokens.

import {
  BG_BASES,
  BG_GRAVEYARDS,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  battlegroundWallSegments,
} from '../../../sim/battleground_layout';
import type { BgMapModel } from './battleground_map_view';

const MAP_COLOR_TOKENS = {
  teamRed: '--color-team-red',
  teamBlue: '--color-team-blue',
  wall: '--color-minimap-outline',
  player: '--color-minimap-player',
  dead: '--color-minimap-party-dead',
} as const;

type BgMapColors = Record<keyof typeof MAP_COLOR_TOKENS, string>;

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

  /** Draw the full-field schematic + markers into the square map canvas. */
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

    // field wash: the home half very slightly warmer so the orientation reads
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colors.wall;
    ctx.fillRect(px(-model.halfX), py(model.halfZ), model.halfX * 2 * s, model.halfZ * 2 * s);
    ctx.restore();

    // walls (every collider-backed segment, graveyard rails included)
    ctx.fillStyle = colors.wall;
    for (const w of battlegroundWallSegments()) {
      const x = w.x * flip;
      const z = w.z * flip;
      ctx.fillRect(px(x - w.hw), py(z + w.hd), w.hw * 2 * s, w.hd * 2 * s);
    }

    // graveyard plots: a faint team-tinted wash inside their rails
    for (const plot of BG_GRAVEYARDS) {
      const x = plot.x * flip;
      const z = plot.z * flip;
      ctx.save();
      ctx.globalAlpha = 0.18;
      // tint by MAP side, not home team id: the bottom (own) side reads in
      // your color regardless of which team you are
      ctx.fillStyle = z < 0 ? this.ownTint(model, colors) : this.foeTint(model, colors);
      ctx.fillRect(px(x - plot.hw), py(z + plot.hd), plot.hw * 2 * s, plot.hd * 2 * s);
      ctx.restore();
    }

    // rune pads: small diamonds (sprint + power sites are public knowledge)
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (const r of [...BG_SPEED_RUNES, ...BG_POWER_RUNES]) {
      const x = px(r.x * flip);
      const y = py(r.z * flip);
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 3, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // flag STANDS (static; live flag positions are deliberately not mapped).
    // The stands are the objective, so they read LARGE: a bold banner glyph
    // with a dark edge so it holds on both the pale keep floor and the wash.
    for (const base of BG_BASES) {
      const x = px(base.flag.x * flip);
      const y = py(base.flag.z * flip);
      const mine = base.team === model.myTeam;
      ctx.save();
      ctx.strokeStyle = '#00000090';
      ctx.lineWidth = 2;
      ctx.fillStyle = mine ? this.ownTint(model, colors) : this.foeTint(model, colors);
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

    // teammates: team-color discs (hollow when dead, a ring when carrying)
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
        ctx.fillStyle = this.ownTint(model, colors);
        ctx.fill();
      }
      if (mate.carrying) {
        ctx.strokeStyle = colors.player;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, MATE_R + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // self: the standard player arrow, rotated with the oriented facing
    const self = model.self;
    if (self) {
      ctx.save();
      ctx.translate(px(self.x), py(self.z));
      ctx.rotate(self.facing);
      ctx.fillStyle = colors.player;
      ctx.beginPath();
      ctx.moveTo(0, -SELF_R - 2);
      ctx.lineTo(SELF_R - 1, SELF_R);
      ctx.lineTo(0, SELF_R * 0.45);
      ctx.lineTo(-SELF_R + 1, SELF_R);
      ctx.closePath();
      ctx.fill();
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
