// DRAFT ONLY: Ravenrift v4 "immersive scale" proposal blueprint. Standalone,
// reads nothing from src/, writes one PNG to the session scratchpad. Not for
// commit; the real layout lands in battleground_layout.ts only after sign-off.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const OUT =
  process.env.DRAFT_OUT ??
  '/private/tmp/claude-501/-Users-seanghods-repos-world-of-claudecraft/8ca091e8-c324-4ed8-8d7f-3f8c934f7f99/scratchpad/ravenrift-v4-draft.png';

// 100 x 280 yards: WSG-proportioned, tuned for 5v5 density. Flag to flag is
// 236yd, roughly a 34s base-speed run (today: 96yd, ~14s).
const HALF_X = 50;
const HALF_Z = 140;
const FLAG_Z = 118;
const POSTERN = 3;

const mirror = (s) => ({ ...s, x: -s.x, z: -s.z });
const withMirrors = (list) => [...list, ...list.map(mirror)];

// Keeps: larger enclosures (32yd wide), postern in the west wall (Crimson).
const keepSouth = [
  { x: 0, z: -128, hw: 16, hd: 1 },
  { x: 16, z: -119, hw: 1, hd: 9 },
  { x: -16, z: -124.25, hw: 1, hd: 3.75 }, // postern split
  { x: -16, z: -113.75, hw: 1, hd: 3.75 },
];
const barricades = withMirrors([{ x: -3, z: -106, hw: 8, hd: 1, low: true }]);

// Curtains at z = +-45: three crossings each, all wider at this scale.
//   main gate 10yd (x 8..18), flank arch 5yd (x 38..43),
//   gatehouse 16x18 straddling the wall (x -34..-18), offset 5yd doors.
const curtainSouth = [
  { x: -41.5, z: -55, hw: 7.5, hd: 1 }, // rampart to gatehouse
  { x: -5, z: -55, hw: 13, hd: 1 }, // gatehouse to main gate
  { x: 28, z: -55, hw: 10, hd: 1 }, // main gate to flank arch
  { x: 46, z: -55, hw: 3, hd: 1 }, // arch to rampart
];
const gatehouseSouth = [
  { x: -33, z: -55, hw: 1, hd: 9 }, // west wall
  { x: -19, z: -55, hw: 1, hd: 9 }, // east wall
  { x: -29, z: -64, hw: 4, hd: 1 }, // field-side wall (door x -25..-20)
  { x: -23.5, z: -46, hw: 4.5, hd: 1 }, // courtyard-side wall (door x -33..-28)
];

// The Ruin Courtyard: 100 x 90, a real place now. Bigger hollow heart,
// two breaker pairs, six pillars, flank-rune cover.
const heart = { x: 0, z: 0, hw: 8, hd: 8 };
const courtyardWalls = withMirrors([
  { x: -16, z: -22, hw: 7, hd: 1 }, // breaker foot
  { x: 26, z: -30, hw: 1, hd: 7 }, // breaker upright
]);
const pillars = withMirrors([
  { x: -30, z: -14 },
  { x: 30, z: -14 },
  { x: 0, z: -42 },
]);

// Field chambers (100 x 65 each): a staggered S-approach instead of a straight
// run, plus the wing baffle at the keep mouth.
const fieldWalls = withMirrors([
  { x: -30, z: -98, hw: 9, hd: 1 }, // wing baffle by the mouth
  { x: 10, z: -84, hw: 12, hd: 1 }, // S-approach walls
  { x: -18, z: -70, hw: 12, hd: 1 },
]);
const crates = withMirrors([
  { x: -10, z: -102 },
  { x: 14, z: -76 },
  { x: -42, z: -60 },
  { x: 41, z: -4 }, // flank-rune cover
  { x: -26, z: -58 }, // gatehouse ambush crates
  { x: -30, z: -50 },
]);

const perimeter = [
  { x: -HALF_X, z: 0, hw: 1, hd: HALF_Z },
  { x: HALF_X, z: 0, hw: 1, hd: HALF_Z },
  { x: 0, z: -HALF_Z, hw: HALF_X, hd: 1 },
  { x: 0, z: HALF_Z, hw: HALF_X, hd: 1 },
];

const walls = [
  ...perimeter,
  ...withMirrors(keepSouth),
  ...barricades,
  ...withMirrors(curtainSouth),
  ...withMirrors(gatehouseSouth),
  ...courtyardWalls,
  heart,
  ...fieldWalls,
];
const runes = [
  { x: 0, z: -91 },
  { x: 0, z: 91 },
  { x: -38, z: 0 },
  { x: 38, z: 0 },
];
const flags = [
  { x: 0, z: -FLAG_Z, c: '#d1413a' },
  { x: 0, z: FLAG_Z, c: '#3a78d1' },
];
const spawnsSouth = [
  { x: -7, z: -125 },
  { x: 0, z: -126 },
  { x: 7, z: -125 },
  { x: -3.5, z: -122 },
  { x: 3.5, z: -122 },
];

// ---- rendering -------------------------------------------------------------
const SCALE = 6;
const ML = 300;
const MR = 260;
const MT = 130;
const MB = 130;
const CRIMSON = '#d1413a';
const AZURE = '#3a78d1';
const GOLD = '#ffd24a';
const WALL = '#2c3444';
const LOW_WALL = '#7d6a52';
const PAPER = '#f3ead8';
const INK = '#3a3020';
const W = HALF_X * 2 * SCALE + ML + MR;
const H = HALF_Z * 2 * SCALE + MT + MB;
const sx = (x) => ML + (x + HALF_X) * SCALE;
const sy = (z) => MT + (HALF_Z - z) * SCALE;
const parts = [];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function rect(x, z, hw, hd, fill, opacity = 1, rx = 0) {
  parts.push(
    `<rect x="${sx(x - hw)}" y="${sy(z + hd)}" width="${hw * 2 * SCALE}" height="${hd * 2 * SCALE}" fill="${fill}" opacity="${opacity}"${rx ? ` rx="${rx}"` : ''}/>`,
  );
}
function circle(x, z, r, fill, stroke = null) {
  parts.push(
    `<circle cx="${sx(x)}" cy="${sy(z)}" r="${r * SCALE}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2"` : ''}/>`,
  );
}
function label(x, z, text, size = 15, color = INK, anchor = 'middle', weight = 600) {
  parts.push(
    `<text x="${sx(x)}" y="${sy(z)}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}" font-family="Georgia, serif">${esc(text)}</text>`,
  );
}
function callout(x, z, tx, tz, text, color = INK) {
  parts.push(
    `<line x1="${sx(x)}" y1="${sy(z)}" x2="${sx(tx)}" y2="${sy(tz)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="4 3"/>`,
  );
  label(tx, tz + (tz > z ? 1.6 : -2.4), text, 14, color, tx < x ? 'end' : 'start');
}

parts.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/>`);
rect(0, -124, HALF_X, 16, CRIMSON, 0.1);
rect(0, 124, HALF_X, 16, AZURE, 0.1);
rect(0, -82.5, HALF_X, 27.5, CRIMSON, 0.05);
rect(0, 82.5, HALF_X, 27.5, AZURE, 0.05);
rect(0, 0, HALF_X, 55, '#5e7a3a', 0.12);
// the ~120yd view-distance ring from each flag stand (what one player can see)
for (const f of flags) {
  parts.push(
    `<circle cx="${sx(f.x)}" cy="${sy(f.z)}" r="${120 * SCALE}" fill="none" stroke="${f.c}" stroke-width="1.6" stroke-dasharray="8 6" opacity="0.5"/>`,
  );
}

for (const s of walls) {
  const ruin = Math.min(s.hw, s.hd) > 1;
  rect(s.x, s.z, s.hw, s.hd, s.low ? LOW_WALL : ruin ? '#6b5b45' : WALL, ruin ? 0.85 : 1, 2);
}
for (const p of pillars) circle(p.x, p.z, 1.2, WALL);
for (const c of crates) rect(c.x, c.z, 1, 1, '#8a6a3c', 1, 2);
for (const f of flags) {
  circle(f.x, f.z, 2, f.c, INK);
  const fx = sx(f.x);
  const fy = sy(f.z);
  parts.push(
    `<line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy - 24}" stroke="${INK}" stroke-width="3"/>`,
    `<path d="M ${fx} ${fy - 24} h 16 l -5 5 5 5 h -16 z" fill="${f.c}" stroke="${INK}" stroke-width="1"/>`,
  );
}
for (const sp of spawnsSouth) circle(sp.x, sp.z, 0.8, CRIMSON);
for (const sp of spawnsSouth) circle(-sp.x, -sp.z, 0.8, AZURE);
for (const r of runes) {
  circle(r.x, r.z, 1.4, 'none', GOLD);
  circle(r.x, r.z, 0.7, GOLD);
}

label(0, HALF_Z + 12, 'RAVENRIFT v4 DRAFT: IMMERSIVE SCALE', 26, INK);
label(
  0,
  HALF_Z + 6,
  '100 x 280 yards. Courtyard 110 deep, each field 55: the heart of the map is twice a field.',
  14,
  '#6b5b45',
);
label(0, 122, 'AZURE KEEP', 15, AZURE);
label(0, -124, 'CRIMSON KEEP', 15, CRIMSON);
label(0, 74, 'AZURE FIELD', 17, AZURE, 'middle', 700);
label(0, -76, 'CRIMSON FIELD', 17, CRIMSON, 'middle', 700);
label(0, 46, 'THE RUIN COURTYARD', 17, '#5e7a3a', 'middle', 700);

callout(-16, -119, -56, -123, `postern gap (${POSTERN}yd)`, INK);
callout(-3, -106, -56, -109, 'mouth barricade (low)', LOW_WALL);
callout(-30, -98, -56, -96, 'wing baffle', INK);
callout(10, -84, 56, -86, 'staggered S-approach', INK);
callout(-18, -70, -56, -72, '(two walls per field)', INK);
callout(0, -91, 56, -93, 'approach rune', '#8a6a3c');
callout(13, -55, 56, -59, 'main gate (10yd)', INK);
callout(40.5, -55, 56, -51, 'flank arch (5yd)', INK);
callout(-26, -55, -56, -56, 'gatehouse 16x18 (offset doors)', INK);
callout(0, 8, 56, 12, 'heart ruin 16x16 (hollow)', '#6b5b45');
callout(16, 22, 56, 28, 'sightline breakers (two pairs)', INK);
callout(38, 0, 56, -3, 'flank rune + cover', '#8a6a3c');
callout(0, 120, 56, 128, 'view-distance ring: ~120yd', AZURE);
label(56, 124.5, '(fog past this; enemies fade in)', 13, AZURE, 'start');
label(
  0,
  -(HALF_Z + 7),
  'Same three-chamber structure, WSG-proportioned. In-band interest raised so the sim tracks the whole match;',
  13.5,
  '#6b5b45',
);
label(
  0,
  -(HALF_Z + 12),
  'the CLIENT sees to ~120yd with distance fog, like the open world. Point-symmetric as always.',
  13.5,
  '#6b5b45',
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.goto(`data:text/html,<body style="margin:0">${encodeURIComponent(svg)}</body>`);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();
console.log(`wrote ${OUT}`);
