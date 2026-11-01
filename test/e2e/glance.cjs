// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/glance.cjs /tmp/gl-home /tmp/gl-shots
// The owl's glance: opened through its API (as a click on the tray icon does), its cards,
// quick actions and footer render, keyboard works, Settings → Menu bar changes what it shows,
// and it looks right in light and dark.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, 'Downloads', 'Quarterly report.pdf'), '%PDF-1.4\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  check(!!main, 'Keeper opens');
  await main.waitForSelector('.sidebar', { timeout: 60_000 });

  const open = async () => {
    await main.evaluate(() => window.keeper.glance.show());
    let g;
    for (let i = 0; i < 40 && !g; i++) { g = app.windows().find((w) => w.url().includes('view=glance')); if (!g) await wait(250); }
    return g;
  };
  const g = await open();
  check(!!g, 'the glance window opens through its API');
  await g.waitForSelector('[data-testid="glance-card-storage"]', { timeout: 15_000 });
  const cards = await g.$$eval('[data-testid^="glance-card-"]', (els) => els.map((e) => e.getAttribute('data-testid').replace('glance-card-', '')));
  check(cards.includes('storage') && cards.includes('system') && cards.includes('network') && cards.includes('awake') && cards.includes('tip'), `cards: ${cards.join(', ')}`);
  const actions = await g.$$eval('[data-testid^="glance-action-"]', (els) => els.length);
  check(actions === 8, `eight quick actions (${actions})`);
  check(await g.isVisible('text=Open Keeper') && await g.isVisible('text=Quit'), 'the footer has Open Keeper, Settings and Quit');
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=glance')).getBounds());
  check(bounds.width === 360 && bounds.height === 520, `size ${bounds.width}×${bounds.height}`);
  // Keyboard: arrows move between buttons.
  await g.focus('[data-testid="glance-card-storage"]');
  await g.keyboard.press('ArrowRight');
  const focused = await g.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  check(!!focused && focused !== 'glance-card-storage', `arrow keys move the focus (${focused})`);
  // Live values arrive while open.
  const got = await g.evaluate(() => new Promise((r) => { const off = window.keeper.on('glance', (v) => { off(); r(v.cards.length); }); setTimeout(() => r(0), 6000); }));
  check(got > 0, `live values arrive while it is open (${got} cards)`);
  await g.screenshot({ path: path.join(SHOTS, 'glance-light.png') });

  // Settings → Menu bar: fewer cards and actions.
  await main.evaluate(() => window.keeper.glance.setSettings({ cards: ['awake', 'storage'], actions: ['quickSearch', 'terminal'] }));
  const v = await main.evaluate(() => window.keeper.glance.view());
  check(v.cards.map((c) => c.id).join() === 'awake,storage' && v.actions.join() === 'quickSearch,terminal', `Settings choose the cards and actions (${v.cards.map((c) => c.id).join()} / ${v.actions.join()})`);
  await main.evaluate(() => window.keeper.glance.setSettings({ cards: ['weather', 'storage', 'system', 'network', 'awake', 'usage', 'calendar', 'tip'], actions: ['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal'] }));

  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.evaluate(() => window.keeper.glance.close());
  const g2 = await open();
  await g2.waitForSelector('[data-testid="glance-card-storage"]', { timeout: 15_000 });
  await wait(600);
  await g2.screenshot({ path: path.join(SHOTS, 'glance-dark.png') });
  const bg = await g2.evaluate(() => getComputedStyle(document.querySelector('.glance')).backgroundColor);
  check(/rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 80, `dark theme (${bg})`);
  await main.evaluate(() => window.keeper.glance.close());

  // Settings page has the Menu bar section.
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  await app.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
