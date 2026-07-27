// Orkadia visual E2E: enter offline, walk into the Drakelands war-camp gate, and
// screenshot the green/black orc portal, the interior hall, an orc pack, and the
// warlord on the dais. Needs `npm run dev` running (offline enables devCommands).
//
//   BROWSER_PATH=<chrome> GAME_URL=http://localhost:5173 node scripts/orkadia_shots.mjs

import fs from 'node:fs';
import { chromium } from 'playwright';
import { enterOfflineGame } from './enter_offline_game.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots/orkadia';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const vp = { width: 1280, height: 760 };
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || undefined,
  channel: process.env.BROWSER_PATH ? undefined : 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: vp });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

async function tick(frames = 45) {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);
}
async function shot(name) {
  await tick(30);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

console.log('loading + entering offline...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await enterOfflineGame(page, { charName: 'Warbreaker', settleMs: 2500 });
await page.waitForFunction(() => !!window.__game?.world?.player, { timeout: 30000, polling: 200 });
await page
  .locator('.tut-skip')
  .click()
  .catch(() => {});
await page.evaluate(() => {
  const w = window.__game.world;
  w.chat('/dev level 22', w.player.id);
  w.chat('/dev god', w.player.id);
});

// Teleport to the Orkadia war-camp gate in the Drakelands and let the zone stream.
const door = await page.evaluate(async () => {
  const w = window.__game.world;
  const d = [...w.entities.values()].find(
    (e) => e.templateId === 'dungeon_door' && e.dungeonId === 'orkadia',
  );
  if (!d) throw new Error('orkadia door not found in overworld');
  // Stand a few yards south of the gate, facing north toward the portal.
  w.player.pos = { x: d.pos.x, y: 0, z: d.pos.z - 7 };
  w.player.prevPos = { ...w.player.pos };
  w.player.facing = Math.PI; // look toward -z... set below by facing the door
  w.rebucket(w.player);
  return { x: d.pos.x, z: d.pos.z };
});
await tick(120); // let the Drakelands terrain + door portal build
await page.evaluate((dd) => {
  const w = window.__game.world;
  w.player.facing = Math.atan2(dd.x - w.player.pos.x, dd.z - w.player.pos.z);
}, door);
await tick(40);
await shot('orkadia-portal');

// Walk into the gate to enter the instance.
await page.evaluate((dd) => {
  const w = window.__game.world;
  w.player.pos = { x: dd.x, y: 0, z: dd.z };
  w.player.prevPos = { ...w.player.pos };
  w.rebucket(w.player);
}, door);
await tick(120);
const inside = await page.evaluate(() => {
  const w = window.__game.world;
  // player x should have crossed the dungeon threshold once inside an instance.
  return { x: w.player.pos.x, z: w.player.pos.z };
});
console.log('inside at', inside);
await shot('orkadia-interior');

// Face and frame an orc pack (a marauder), then the warlord on the dais.
async function frameMob(templateId, name) {
  const ok = await page.evaluate((tid) => {
    const w = window.__game.world;
    const mob = [...w.entities.values()].find((e) => e.templateId === tid && !e.dead);
    if (!mob) return false;
    // stand a few yards in front of the mob, facing it.
    w.player.pos = { x: mob.pos.x + 4, y: 0, z: mob.pos.z - 4 };
    w.player.prevPos = { ...w.player.pos };
    w.player.facing = Math.atan2(mob.pos.x - w.player.pos.x, mob.pos.z - w.player.pos.z);
    w.rebucket(w.player);
    if (w.targetEntity) w.targetEntity(mob.id);
    return true;
  }, templateId);
  if (!ok) {
    console.log('no', templateId, 'to frame');
    return;
  }
  await tick(80);
  await shot(name);
}

await frameMob('orkadia_marauder', 'orkadia-mobs');
await frameMob('orkadia_warlord', 'orkadia-boss');

console.log(
  errors.length ? `PAGE ERRORS (${errors.length}):\n${errors.join('\n')}` : 'no page errors',
);
await browser.close();
