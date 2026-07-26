// Probe: far-vista terrain layer eyeball check (not part of any suite).
// Usage: BROWSER_PATH=... PORT=5177 node scripts/_probe_far_vista.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const PORT = process.env.PORT || '5177';
const OUT = process.env.SHOTS_DIR || 'far-vista-shots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1760,990', '--use-angle=metal'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`http://localhost:${PORT}/?gfx=high`, { waitUntil: 'networkidle2' });
const ok = await enterOfflineGame(page, { settleMs: 4000 });
if (!ok) {
  console.error('game boot hook never appeared');
  await browser.close();
  process.exit(1);
}
// let zone streaming and the far-tile build make real progress
await new Promise((r) => setTimeout(r, 12000));

const vistaState = () =>
  page.evaluate(() => {
    const g = window.__game;
    const far = g.renderer.farTerrainView;
    return {
      built: far ? far.builtTileCount() : -1,
      planned: far ? far.plannedTileCount() : -1,
      fogFar: g.renderer.scene?.fog?.far ?? null,
      camFar: g.renderer.camera?.far ?? null,
    };
  });

const look = async (yaw, pitch, dist) => {
  await page.evaluate(
    (y, p, d) => {
      const input = window.__game.input;
      input.camYaw = y;
      input.camPitch = p;
      input.camDist = d;
    },
    yaw,
    pitch,
    dist,
  );
  await new Promise((r) => setTimeout(r, 900));
};

const teleport = async (x, z, y) => {
  await page.evaluate(
    (tx, tz, ty) => {
      const sim = window.__game.sim;
      const me = sim.entities.get(sim.playerId);
      me.pos.x = tx;
      me.pos.z = tz;
      me.pos.y = ty;
      me.prevPos = { ...me.pos };
      me.hp = me.maxHp;
    },
    x,
    z,
    y,
  );
  await new Promise((r) => setTimeout(r, 2500));
};

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, JSON.stringify(await vistaState()));
};

// 1. spawn: Eastbrook Vale, looking north up the strip
await look(Math.PI, 0.12, 22);
await shot('spawn-north');
await look(0, 0.12, 22);
await shot('spawn-south');

// 2. the Thornpeak ridge shoulder under the sealed wall: high peaks-biome
// ground (vista fog), overlooking the whole southern strip and the sea.
// y values are precomputed terrainHeight(x, z, 20061) + 0.6.
await teleport(168, 899, 36.6);
for (const [name, yaw] of [
  ['ridge-yaw0', 0],
  ['ridge-yaw90', Math.PI / 2],
  ['ridge-yaw180', Math.PI],
  ['ridge-yaw270', (3 * Math.PI) / 2],
]) {
  await look(yaw, 0.3, 22);
  await shot(name);
}

// 3. Galecrest coast, looking across the columns and the straits
await teleport(420, 360, 3.1);
for (const [name, yaw] of [
  ['gale-yaw90', Math.PI / 2],
  ['gale-yaw270', (3 * Math.PI) / 2],
]) {
  await look(yaw, 0.12, 22);
  await shot(name);
}

await browser.close();
console.log('done ->', OUT);
