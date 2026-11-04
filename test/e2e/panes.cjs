// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/panes.cjs /tmp/kp-home /tmp/kp-shots
// Drives the real Keeper app's Side by Side: opened from a folder's More menu,
// the right side moved to another folder with its place picker, a file copied
// across with F5 (the usual copy, so it lands for real), Differences listing
// only what differs, a two-way sync after its preview (the replaced file in
// the Trash, nothing deleted), a WebDAV connection on the right side with a
// file copied up to it, and ⌘T / Ctrl+T on a folder opening the same folder
// in a new tab. Light and dark at 1440×900.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const SERVER = HOME + '-server';
fs.rmSync(SERVER, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(path.join(SERVER, 'Shared'), { recursive: true });
fs.writeFileSync(path.join(SERVER, 'Shared', 'Welcome.txt'), 'hello from the NAS\n');

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

// Two copies of a trip folder that drifted apart.
const L = path.join(HOME, 'Documents', 'Trip');
const R = path.join(HOME, 'Downloads', 'Trip');
const old = new Date(Date.now() - 5 * 86400e3);
const put = (p, text, when = old) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); fs.utimesSync(p, when, when); };
put(path.join(L, 'Itinerary.txt'), 'Day 1: arrive.\n');
put(path.join(R, 'Itinerary.txt'), 'Day 1: arrive.\n');
put(path.join(L, 'Budget.txt'), 'Hotel 420, trains 95, food 180.\n', new Date());
put(path.join(R, 'Budget.txt'), 'Hotel 420.\n');
put(path.join(L, 'Photos', 'Harbour.txt'), 'Boats at dusk.\n');
put(path.join(R, 'Tickets.txt'), 'Train 08:14, seat 42.\n');
put(path.join(L, 'Packing list.txt'), 'Passport, charger, umbrella.\n');

(async () => {
  const dav = await require('../servers/webdav-server.cjs').start(SERVER);
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  // The sidebar as a rail: pictures show demo data only, never this computer's own place names.
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => {
    for (const dark of [false, true]) {
      await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
      await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await wait(700);
      await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };
  const rowNames = (side) => main.locator(`[data-testid="pane-${side}"] .pane-row .pane-name`).allInnerTexts();

  try {
    await main.evaluate(() => window.keeper.features.set('filePanes', true));
    await wait(300);
    check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'filePanes')?.on === true, 'Side by Side is on');

    // ---- opened from a folder's More menu: this folder on the left, the one above on the right
    await navigate(`browse:${L}`);
    await main.waitForSelector('[data-testid="folder-more"]', { timeout: 15000 });
    await main.locator('[data-testid="folder-more"]').click();
    await main.getByRole('menuitem', { name: 'Side by Side' }).click();
    await main.waitForSelector('[data-testid="pane-left"] .pane-row', { timeout: 15000 });
    check((await rowNames('left')).some((n) => n.includes('Itinerary.txt')), 'the left side shows the folder');
    check((await rowNames('right')).some((n) => n.includes('Trip')), 'the right side shows the folder above it');
    check(await main.locator('.panes-page .btn.primary').count() === 1, 'one main action');

    // ---- the right side moves: Downloads from its place picker, then into Trip
    await main.locator('[data-testid="pane-right"] .pane-place').selectOption({ label: 'Downloads' });
    await main.waitForSelector('[data-testid="pane-right"] .pane-row:has-text("Trip")', { timeout: 10000 });
    await main.locator('[data-testid="pane-right"] .pane-row', { hasText: 'Trip' }).dblclick();
    await until(async () => (await rowNames('right')).some((n) => n.includes('Tickets.txt')));
    check((await rowNames('right')).some((n) => n.includes('Tickets.txt')), 'a double-click opens a folder on that side');

    // ---- F5 copies the chosen file to the other side
    await main.locator('[data-testid="pane-left"] .pane-row', { hasText: 'Packing list.txt' }).click();
    check(await main.locator('[data-testid="pane-copy"]').innerText().then((t) => /Copy\s*→/.test(t)), 'Copy points at the other side');
    await shot('gapsfiles-panes');
    await main.keyboard.press('F5');
    check(!!(await until(() => fs.existsSync(path.join(R, 'Packing list.txt')))), 'F5 copied the file across');
    await until(async () => (await rowNames('right')).some((n) => n.includes('Packing list.txt')), 8000);
    check((await rowNames('right')).some((n) => n.includes('Packing list.txt')), 'and the right side shows it');

    // ---- Differences: only what differs
    await main.locator('[data-testid="pane-mode-diff"]').click();
    await main.waitForSelector('[data-testid="pane-diff"] .pane-diff-row[data-state]', { timeout: 15000 });
    const states = await main.locator('.pane-diff-row[data-state]').evaluateAll((els) => els.map((e) => `${e.querySelector('.pane-name').textContent.trim()}=${e.dataset.state}`));
    check(states.includes('Budget.txt=left-newer'), `the edited budget is newer on the left (${states.join(', ')})`);
    check(states.includes('Tickets.txt=right-only') && states.includes('Photos=left-only'), 'one-sided items are listed once');
    check(!states.some((s) => s.startsWith('Itinerary.txt') || s.startsWith('Packing list.txt')), 'what is the same is left out');
    await main.getByRole('radio', { name: 'Both ways' }).click();
    const plan = await main.locator('[data-testid="pane-plan"]').innerText();
    check(/Copies 2/.test(plan) && /replaces 1/.test(plan) && /Nothing is deleted/.test(plan), `the plan says what will happen (“${plan}”)`);
    await shot('gapsfiles-panes-diff');
    await main.locator('[data-testid="pane-sync"]').click();
    await main.waitForSelector('[data-testid="pane-sync-sheet"]', { timeout: 5000 });
    await main.locator('[data-testid="pane-sync-go"]').click();
    await until(() => fs.existsSync(path.join(L, 'Tickets.txt')) && fs.existsSync(path.join(R, 'Photos', 'Harbour.txt')));
    check(fs.readFileSync(path.join(R, 'Budget.txt'), 'utf8').includes('trains 95'), 'the newer budget replaced the older one');
    check(fs.existsSync(path.join(L, 'Tickets.txt')) && fs.existsSync(path.join(R, 'Photos', 'Harbour.txt')), 'what was missing is now on both sides');
    const trash = path.join(HOME, '.local/share/Trash/files');
    check(fs.existsSync(trash) && fs.readdirSync(trash).some((n) => n.startsWith('Budget')), 'the replaced budget went to the Trash');
    check(fs.existsSync(path.join(L, 'Budget.txt')) && fs.existsSync(path.join(R, 'Itinerary.txt')), 'nothing was deleted');
    await main.waitForSelector('[data-testid="pane-diff"] .empty, [data-testid="pane-diff"] [data-testid="empty-state"]', { timeout: 15000 }).catch(() => undefined);
    check(/These folders match/.test(await main.locator('[data-testid="pane-diff"]').innerText()), 'afterwards they match');

    // ---- a connection on the right: a file copied up to the server
    await main.evaluate(([port, base]) => window.keeper.remote.save({ kind: 'webdav', name: 'Studio NAS', host: '127.0.0.1', port, root: base, user: 'ana', password: 'secret', secure: false, device: 'server' }), [dav.port, dav.base]);
    await main.locator('[role="radio"]', { hasText: 'Files' }).click();
    await until(async () => (await main.locator('[data-testid="pane-right"] .pane-place option', { hasText: 'Studio NAS' }).count()) > 0, 8000);
    await main.locator('[data-testid="pane-right"] .pane-place').selectOption({ label: 'Studio NAS' });
    await main.waitForSelector('[data-testid="pane-right"] .pane-row:has-text("Shared")', { timeout: 15000 });
    await main.locator('[data-testid="pane-right"] .pane-row', { hasText: 'Shared' }).dblclick();
    await main.waitForSelector('[data-testid="pane-right"] .pane-row:has-text("Welcome.txt")', { timeout: 15000 });
    check(true, 'the right side browses a WebDAV connection');
    await main.locator('[data-testid="pane-left"] .pane-row', { hasText: 'Itinerary.txt' }).click();
    await main.locator('[data-testid="pane-copy"]').click();
    check(!!(await until(() => fs.existsSync(path.join(SERVER, 'Shared', 'Itinerary.txt')))), 'Copy → uploaded the file to the server');
    await main.locator('[data-testid="pane-right"] .pane-row', { hasText: 'Welcome.txt' }).click({ timeout: 10000 });
    await main.locator('[data-testid="pane-copy"]').click();
    check(!!(await until(() => fs.existsSync(path.join(L, 'Welcome.txt')))), '← Copy downloaded a file from the server');
    await main.locator('[data-testid="pane-mode-diff"]').click();
    await main.waitForSelector('[data-testid="pane-diff"] .pane-diff-foot', { timeout: 15000 });
    check(/difference/.test(await main.locator('.pane-diff-head').innerText()), 'Differences works with a connection on one side');

    // ---- ⌘T / Ctrl+T on a folder: the same folder in a new tab
    await navigate(`browse:${R}`);
    await main.waitForSelector('[data-testid="folder-more"]', { timeout: 15000 });
    // The main process passes ⌘T / Ctrl+T on as "tab-key" (electron/resilience.ts); sent the same way here.
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:tab-key', { key: 't', shift: false }); } });
    const tabs = await until(async () => { const t = await main.locator('.tab-strip [role="tab"]').allInnerTexts(); return t.length >= 2 ? t : null; }, 5000);
    check(!!tabs && tabs.filter((t) => t.includes('Trip')).length >= 2, `the new tab shows the same folder (${(tabs ?? []).join(' | ')})`);
  } catch (e) {
    console.log('FAIL', e.message);
    failed++;
    await main.screenshot({ path: path.join(SHOTS, 'panes-error.png') }).catch(() => undefined);
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  await dav.close();
  fs.rmSync(SERVER, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
