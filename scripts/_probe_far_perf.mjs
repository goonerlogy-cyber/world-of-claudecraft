// Probe: far-vista perf sample (not part of any suite).
// Usage: PORT=5177 node scripts/_probe_far_perf.mjs
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const PORT = process.env.PORT || '5177';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1760,990', '--use-angle=metal'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`http://localhost:${PORT}/?gfx=${process.env.GFX || 'high'}`, {
  waitUntil: 'networkidle2',
});
if (!(await enterOfflineGame(page, { settleMs: 4000 }))) {
  console.error('no boot');
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 15000));

const sample = (label) =>
  page
    .evaluate(async () => {
      // settle, then average frame stats over ~4 seconds
      await new Promise((r) => setTimeout(r, 1500));
      const g = window.__game;
      const frames = [];
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const s = g.renderer.perfStats();
          frames.push({ calls: s.calls, tris: s.triangles, frameMs: s.lastFrame?.frameMs ?? 0 });
          if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const avg = (k) => frames.reduce((a, f) => a + f[k], 0) / frames.length;
      const sorted = frames.map((f) => f.frameMs).sort((a, b) => a - b);
      return {
        n: frames.length,
        calls: Math.round(avg('calls')),
        tris: Math.round(avg('tris')),
        frameP50: sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
        frameP95: sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        farTiles: g.renderer.farTerrainView ? g.renderer.farTerrainView.builtTileCount() : -1,
      };
    })
    .then((r) => console.log(label, JSON.stringify(r)));

await sample('spawn');
await page.evaluate(() => {
  const sim = window.__game.sim;
  const me = sim.entities.get(sim.playerId);
  me.pos.x = 168;
  me.pos.z = 899;
  me.pos.y = 36.6;
  me.prevPos = { ...me.pos };
  me.hp = me.maxHp;
  const input = window.__game.input;
  input.camYaw = Math.PI / 2;
  input.camPitch = 0.3;
  input.camDist = 22;
});
await new Promise((r) => setTimeout(r, 4000));
await sample('ridge');
await browser.close();
