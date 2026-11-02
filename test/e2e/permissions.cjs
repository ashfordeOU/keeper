// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/permissions.cjs /tmp/kp /tmp/kp-shots
// (without KEEPER_SKIP_TOUR: the first-run tour is part of the test)
// The Permissions step of the first-run tour (the choice, the live list,
// Skip), Settings → Permissions from the palette, Allow (stubbed, so nothing
// is opened on this computer), and a feature pointing to its row.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kp-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const STUB = path.join(HOME, 'opened.jsonl');
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_SKIP_TOUR: '', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_PERMISSIONS_OPEN_STUB: STUB },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  await sleep(1200);
  const theme = async (dark) => { await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark); await sleep(450); };
  const both = async (name) => { for (const dark of [false, true]) { await theme(dark); await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) }); } await theme(false); };

  // ---- the first-run tour: Welcome → usage stats → Permissions
  check(await main.getByText('Welcome to Keeper').count() > 0, 'the first-run tour opens');
  const tour = main.locator('.tour');
  await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Next' }).click();
  await sleep(300);
  check(await tour.getByRole('heading', { name: 'Permissions' }).count() === 1, 'the tour has a Permissions step');
  check(await main.locator('[data-testid="tour-perm-all"]').count() === 1 && await main.locator('[data-testid="tour-perm-later"]').count() === 1, 'it offers "Set up everything now" and "Only what I turn on"');
  await both('perm-tour-choice');
  await main.click('[data-testid="tour-perm-all"]');
  await main.waitForSelector('.tour [data-testid="permissions-panel"] .perm-row', { timeout: 20000 });
  await sleep(1500);
  const states = await main.locator('.tour .perm-row').evaluateAll((rows) => rows.map((r) => `${r.getAttribute('data-testid')}=${r.getAttribute('data-state')}`));
  console.log('  ' + states.join(' '));
  check(states.length === 6, `the Linux list has all six entries (${states.length})`);
  check(states.every((s) => /=(allowed|missing|denied|notNeeded|unknown|unavailable|info)$/.test(s)), 'every row shows a status');
  check(await main.locator('.tour .perm-row .badge').first().textContent().then((t) => t.trim().length > 2), 'statuses are written out');
  const settings = JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/settings.json'), 'utf8'));
  check(settings.permissionsSetup === 'all', 'the choice is kept');
  await both('perm-tour-list');
  // Skip goes on with the tour.
  await main.click('[data-testid="tour-perm-skip"]');
  await sleep(300);
  check(await tour.getByRole('heading', { name: 'Find anything' }).count() === 1, 'Skip this step goes on with the tour');
  await tour.getByRole('button', { name: 'Skip tour' }).click();
  await sleep(300);
  check(await main.locator('.tour').count() === 0, 'the tour can be skipped');

  // ---- Settings → Permissions from the palette
  await main.keyboard.press('Control+k');
  await main.keyboard.type('Permissions');
  await sleep(300);
  await main.keyboard.press('Enter');
  await main.waitForSelector('#permissions', { timeout: 10000 });
  await main.waitForSelector('.settings-section [data-testid="permissions-panel"] .perm-row', { timeout: 20000 });
  check(true, 'the palette opens Settings → Permissions');
  check(await main.locator('.settings-section .perm-choice [aria-checked="true"]').textContent().then((t) => /everything/i.test(t)), 'Settings shows the choice made in the tour');
  await main.locator('#permissions').scrollIntoViewIfNeeded();
  await sleep(400);
  await both('perm-settings');

  // ---- Allow / Test (stubbed: written to a file instead of being opened)
  const row = main.locator('.settings-section .perm-row').filter({ has: main.locator('.perm-act button') }).first();
  if (await row.count()) {
    const id = (await row.getAttribute('data-testid')).replace(/^perm-/, '');
    await row.locator('.perm-act button').first().click();
    await sleep(500);
    const lines = fs.existsSync(STUB) ? fs.readFileSync(STUB, 'utf8') : '';
    check(lines.includes(`"request":"${id}"`), `Allow / Test asks for ${id}`);
  } else check(true, 'nothing to allow on this desktop');

  // ---- a feature points to its row
  await main.evaluate(() => { location.hash = ''; });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', 'home'); });
  await sleep(500);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:permission-needed', { id: 'atspi', feature: 'notifyMirror' }); });
  const toast = main.locator('.toast', { hasText: 'Open Permissions' });
  await toast.waitFor({ timeout: 5000 });
  check(/Accessibility bus/.test(await toast.textContent()), 'a feature that needs a permission shows which one');
  await toast.getByRole('button', { name: 'Open Permissions' }).click();
  await main.waitForSelector('[data-testid="perm-atspi"].lit', { timeout: 10000 });
  check(true, 'Open Permissions highlights that row');
  await sleep(600);
  await main.screenshot({ path: path.join(SHOTS, 'perm-highlight-light.png') });

  // ---- polling stops when the screen is closed
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', 'home'); });
  await sleep(500);
  check(await main.locator('[data-testid="permissions-panel"]').count() === 0, 'leaving the page closes the screen (and its checks)');

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
