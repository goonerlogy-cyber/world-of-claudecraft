// Per-entity visuals for the Ravenrift battleground ground objects (sim kind
// 'object', templateId 'bg_flag' / 'bg_rune'). Built by renderer.createView's
// bg_ arm with objectPoolKey = null (stateful, never pooled), so views come and
// go with interest churn: every geometry and material here is a module-level
// cache marked shared (shared_resource.ts) so removeView's per-view disposal
// never frees them out from under the next build.
//
// Graphics fairness: a carried flag's position is actionable info, so the flag
// is plainly visible on EVERY tier (unlit pennant + pole). High tiers only
// boost the pennant color for bloom pop (cosmetic); the rune's point light is
// likewise cosmetic richness on top of the always-on additive glow.
import * as THREE from 'three';
import { surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const FLAG_POLE_H = 3.2;
const FLAG_POLE_R = 0.055;
const PENNANT_W = 1.15;
const PENNANT_H = 0.75;
const PENNANT_BLOOM_BOOST = 1.6; // high-tier color multiplier (bloom pop only)
const RUNE_DISC_R = 1.05;
const RUNE_DISC_Y = 0.08;
const RUNE_RING_R = 0.55;
const RUNE_RING_TUBE = 0.06;
const RUNE_RING_Y = 1.15;
const RUNE_LIGHT_INTENSITY = 1.6;
const RUNE_LIGHT_DISTANCE = 8;

let flagPoleGeo: THREE.CylinderGeometry | null = null;
let pennantGeo: THREE.PlaneGeometry | null = null;
let runeDiscGeo: THREE.CircleGeometry | null = null;
let runeRingGeo: THREE.TorusGeometry | null = null;

// Cached per color + tier arm; marked shared so per-view disposal skips them.
const pennantMats = new Map<string, THREE.MeshBasicMaterial>();
const runeGlowMats = new Map<number, THREE.MeshBasicMaterial>();

function pennantMaterial(color: number, lowGfx: boolean): THREE.MeshBasicMaterial {
  const key = `${color}:${lowGfx ? 'low' : 'high'}`;
  let mat = pennantMats.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    if (!lowGfx) mat.color.multiplyScalar(PENNANT_BLOOM_BOOST);
    markSharedMaterial(mat);
    pennantMats.set(key, mat);
  }
  return mat;
}

function runeGlowMaterial(color: number): THREE.MeshBasicMaterial {
  let mat = runeGlowMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    markSharedMaterial(mat);
    runeGlowMats.set(color, mat);
  }
  return mat;
}

/**
 * Build the view body for one battleground ground object. `color` is the sim
 * entity's color (team color for a flag, gold for a rune); `height` feeds the
 * renderer's nameplate anchor.
 */
export function buildBattlegroundObject(
  templateId: string,
  color: number,
  lowGfx: boolean,
): { group: THREE.Group; height: number } {
  const group = new THREE.Group();

  if (templateId === 'bg_rune') {
    runeDiscGeo ??= markSharedGeometry(new THREE.CircleGeometry(RUNE_DISC_R, 24));
    runeRingGeo ??= markSharedGeometry(new THREE.TorusGeometry(RUNE_RING_R, RUNE_RING_TUBE, 8, 24));
    const glow = runeGlowMaterial(color);
    const disc = new THREE.Mesh(runeDiscGeo, glow);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = RUNE_DISC_Y;
    group.add(disc);
    const ring = new THREE.Mesh(runeRingGeo, glow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = RUNE_RING_Y;
    group.add(ring);
    if (!lowGfx) {
      const light = new THREE.PointLight(color, RUNE_LIGHT_INTENSITY, RUNE_LIGHT_DISTANCE, 2);
      light.position.y = RUNE_RING_Y;
      group.add(light);
    }
    return { group, height: RUNE_RING_Y + RUNE_RING_R + 0.3 };
  }

  // bg_flag (and any future bg_ object defaults to the flag body): pole +
  // team-color pennant, bright at every tier.
  flagPoleGeo ??= markSharedGeometry(
    new THREE.CylinderGeometry(FLAG_POLE_R, FLAG_POLE_R * 1.5, FLAG_POLE_H, 6),
  );
  pennantGeo ??= markSharedGeometry(new THREE.PlaneGeometry(PENNANT_W, PENNANT_H));
  const pole = new THREE.Mesh(flagPoleGeo, surfaceMat({ color: 0x5a4632, roughness: 0.9 }));
  pole.position.y = FLAG_POLE_H / 2;
  group.add(pole);
  const pennant = new THREE.Mesh(pennantGeo, pennantMaterial(color, lowGfx));
  pennant.position.set(PENNANT_W / 2 + FLAG_POLE_R, FLAG_POLE_H - PENNANT_H / 2 - 0.1, 0);
  group.add(pennant);
  return { group, height: FLAG_POLE_H + 0.4 };
}
