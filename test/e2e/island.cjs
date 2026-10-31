// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/island.cjs /tmp/ki /tmp/ki-shots
// Drives the real Keeper app: where the Island sits, that a closed Island covers
// only itself, and that activities, the Live Activity card and the panel open and close.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The whole X screen, so the transparent Island is seen over the desktop.
const screenshot = (name) => { try { execFileSync('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); } catch { /* no ImageMagick */ } };

(async () => {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  let main;
  let isl;
  for (let i = 0; i < 60 && !(main && isl); i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  check(!!isl, 'an Island window opens');
  const errors = [];
  isl.on('pageerror', (e) => errors.push(e.message));
  // Keep the main window out of the way of the screenshots.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) w.minimize(); });
  await wait(2500);

  const islandBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=island')).getBounds());
  const display = await app.evaluate(({ screen }) => { const d = screen.getPrimaryDisplay(); return { bounds: d.bounds, workArea: d.workArea }; });
  const layout = await isl.evaluate(() => window.keeper.island.layout());
  check(!!layout && layout.edge === 'top', `layout: ${layout?.anchor} — ${layout?.reason}`);

  // Idle: a small pill, top centre, and the window no bigger than the pill.
  let b = await islandBounds();
  const centre = display.bounds.x + display.bounds.width / 2;
  check(Math.abs(b.x + b.width / 2 - centre) <= 1, `centred on the screen (window centre ${b.x + b.width / 2}, screen ${centre})`);
  check(b.y === (display.workArea.y > display.bounds.y ? display.workArea.y : display.bounds.y), `at the top (y=${b.y})`);
  check(b.width <= layout.pill.width + 2 && b.height <= layout.pill.height + 2, `closed window hugs the pill (${b.width}×${b.height}, pill ${layout.pill.width}×${layout.pill.height})`);
  screenshot('1-idle');

  // A focus timer becomes the activity in the pill.
  await isl.evaluate(() => window.keeper.island.focus('start', 25));
  await wait(1800);
  const pillText = await isl.locator('.cmp').innerText();
  check(/2[45]:\d\d/.test(pillText), `timer shows in the pill ("${pillText.replace(/\s+/g, ' ').trim()}")`);
  screenshot('2-timer');

  // A long job reported by Keeper adds a second activity: the bubble.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:progress', { task: 'convert', phase: 'holiday.mov', done: 420, total: 1000 }); });
  await wait(900);
  check(await isl.locator('.isl-bubble').count() === 1, 'a second activity shows as a bubble beside the pill');
  b = await islandBounds();
  check(Math.abs(b.x + b.width / 2 - centre) <= 1, `pill stays centred with the bubble (window ${b.width} wide)`);
  screenshot('3-split');

  // Click: the Live Activity card for the timer, in a bigger window.
  await isl.locator('.isl-content').click();
  await wait(900);
  check(await isl.locator('.live-card').count() === 1, 'clicking opens the Live Activity card');
  b = await islandBounds();
  check(b.width >= 600, `the window grows for the card (${b.width}×${b.height})`);
  screenshot('4-live-card');

  // More: the full panel.
  await isl.locator('.live-card button', { hasText: 'More' }).click();
  await wait(800);
  check(await isl.locator('.isl-panel .tabs').count() === 1, '“More” opens the full panel');
  screenshot('5-panel');

  // Pointer leaves: back to the pill, and the window shrinks again.
  await isl.mouse.move(5, 300);
  await isl.locator('.isl-content').dispatchEvent('mouseleave');
  await wait(1600);
  b = await islandBounds();
  check(await isl.locator('.cmp').count() === 1 && b.width < 600, `closes back to the pill (${b.width}×${b.height})`);

  // Bigger in Settings: the layout follows.
  await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, size: 'large' } }); });
  await wait(1500);
  const big = await isl.evaluate(() => window.keeper.island.layout());
  check(big.scale > 1, `size "large" scales the Island (${big.scale})`);

  // Finish the job and the timer.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:progress', { task: 'convert', phase: 'Done', done: 1, total: 1 }); });
  await isl.evaluate(() => window.keeper.island.focus('stop'));
  await wait(2000);
  check(await isl.locator('.isl-bubble').count() === 0, 'the bubble goes when the job is done');

  const prev = await main.evaluate(() => window.keeper.island.placementPreview());
  check(prev.displays.length >= 1 && prev.wanted.length >= 1, `Settings preview sees ${prev.displays.length} screen(s): ${prev.displays.map((d) => `${d.info.bounds.width}×${d.info.bounds.height} ${d.placement.anchor}`).join(', ')}`);
  check(errors.length === 0, `no page errors in the Island${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
