// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/page-windows.cjs /tmp/kp-pw /tmp/kp-pw-shots
// Pages in windows of their own and the separate app icons (core/page-window.ts, core/launchers.ts):
// Mail opens in a window of its own from the sidebar's right-click menu, shows the Mail page and no
// sidebar, and is named "Mail — Keeper"; asking again brings that window forward instead of making a
// second one; a second start with --keeper-open=calendar (Keeper Calendar on Windows and Linux) and
// a keeper://open/notes link open their pages' windows in the running Keeper; a window's size and
// place are kept in settings and used when it opens again; closing page windows never quits Keeper;
// Keeper Mail is added to the app menu and removed again; and a Keeper started with --keeper-open
// shows only that page's window.
const { _electron } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-pw');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-pw-shots');
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = path.resolve(ROOT, 'node_modules/.bin/electron');
const DATA = path.join(HOME, '.config', 'Keeper');
const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const root = (name) => { try { execFileSync('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); } catch { /* no ImageMagick */ } };

/** Keeper's windows as the main process sees them. */
const windowsOf = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({
  id: w.id, url: w.webContents.getURL(), title: w.getTitle(), visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds(),
})));
const pageWins = async (app, page) => (await windowsOf(app)).filter((w) => /[?&]view=page\b/.test(w.url) && (!page || new URL(w.url).searchParams.get('page') === page));
async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(250);
  }
}
const pageOf = (app, page) => until(async () => app.windows().find((w) => { try { const u = new URL(w.url()); return u.searchParams.get('view') === 'page' && u.searchParams.get('page') === page; } catch { return false; } }));
const settingsFile = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8')); } catch { return {}; } };

/** Another start of Keeper with these arguments: it hands them to the running one and quits. */
async function secondStart(args) {
  const p = spawn(ELECTRON, [ROOT, '--no-sandbox', `--user-data-dir=${DATA}`, ...args], { env, stdio: 'ignore' });
  return new Promise((r) => { p.on('exit', (c) => r(c)); setTimeout(() => { p.kill('SIGKILL'); r('still running'); }, 20_000); });
}

(async () => {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox', `--user-data-dir=${DATA}`], env });
  const main = await until(async () => app.windows().find((w) => w.url().includes('view=app')), 30_000);
  check(!!main, 'Keeper opens its main window');
  await main.waitForSelector('nav.sidebar', { timeout: 30_000 });
  await wait(2500);

  // 1. Right-click Mail in the sidebar → Open in New Window.
  const row = main.locator('nav.sidebar .nav-item[data-nav-key="nav:mail"]').first();
  check(await row.count() === 1, 'Mail is in the sidebar');
  await row.click({ button: 'right' });
  const item = main.locator('.menu button, .menu [role="menuitem"]', { hasText: 'Open in New Window' }).first();
  check(await item.count() === 1, 'its right-click menu offers Open in New Window');
  await item.click();
  const mail = await pageOf(app, 'mail');
  check(!!mail, 'Mail opens in a window of its own');
  await mail.waitForSelector('.topbar', { timeout: 20_000 });
  await wait(2500);
  const [mw] = await pageWins(app, 'mail');
  check(mw?.title === 'Mail — Keeper', `the window is named after its page ("${mw?.title}")`);
  check(mw?.visible === true, 'the Mail window is on screen');
  check(await mail.locator('nav.sidebar').count() === 0, 'the page window has no sidebar');
  check(await mail.locator('.tab-strip').count() === 0, 'the page window has no tabs');
  check((await mail.locator('[data-testid="page-window-title"]').textContent())?.trim() === 'Mail', 'its top bar names the page');
  const mailShown = await mail.locator('.content .mail, .content [data-testid="mail-compose"], .content .pim-setup, .content .empty').count();
  check(mailShown > 0, 'the window shows the Mail page');
  check(await mail.locator('[data-testid="open-in-window"]').count() === 0, 'a page window has no Open in New Window button of its own');
  await mail.screenshot({ path: path.join(SHOTS, 'page-window-mail.png') });
  root('page-window-desktop');

  // Events reach page windows too: a settings change made in the main window shows in the Mail window.
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  const dark = await until(() => mail.evaluate(() => document.documentElement.dataset.appearance === 'dark' || document.documentElement.classList.contains('dark') || getComputedStyle(document.body).backgroundColor !== 'rgb(246, 245, 242)'), 8000);
  check(!!dark, 'a setting changed in the main window reaches the page window (broadcast)');
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'system' }));

  // 2. Asking again brings that window forward instead of making a second one.
  await main.bringToFront();
  const again = await main.evaluate(() => window.keeper.windows.openPage({ name: 'mail' }, 'Mail'));
  check(again && again.created === false && again.key === 'mail', 'asking for Mail again reuses its window');
  await wait(800);
  check((await pageWins(app, 'mail')).length === 1, 'still one Mail window');
  const focused = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '');
  check(/view=page/.test(focused) && /page=mail/.test(focused), 'the Mail window is brought to the front');
  const list = await main.evaluate(() => window.keeper.windows.list());
  check(list.length === 1 && list[0].key === 'mail', 'windows.list names the open page window');

  // 3. A second start with --keeper-open=calendar (Keeper Calendar on Windows and Linux).
  const code = await secondStart(['--keeper-open=calendar']);
  check(code !== 'still running', `the second start hands over and quits (${code})`);
  const cal = await pageOf(app, 'calendar');
  check(!!cal, '--keeper-open=calendar opens Calendar in a window of its own in the running Keeper');
  if (cal) {
    await cal.waitForSelector('[data-testid="page-window-title"]', { timeout: 20_000 });
    check((await cal.locator('[data-testid="page-window-title"]').textContent())?.trim() === 'Calendar', 'the Calendar window shows Calendar');
  }
  check((await windowsOf(app)).filter((w) => w.url.includes('view=app')).length === 1, 'and no second main window');
  // …and keeper://open/notes (Keeper Notes on a Mac).
  await secondStart(['keeper://open/notes']);
  check(!!(await pageOf(app, 'notes')), 'keeper://open/notes opens Notes in a window of its own');
  // Anything that is not one of Keeper's pages opens nothing.
  await secondStart(['--keeper-open=../../etc']);
  await wait(1500);
  check((await pageWins(app)).length === 3, 'an unknown page opens no window');

  // 4. Size and place are kept per page.
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /page=mail/.test(x.webContents.getURL())); w.setBounds({ x: 140, y: 120, width: 820, height: 640 }); w.emit('resized'); });
  const saved = await until(async () => { const p = settingsFile().pageWindows?.mail; return p && p.width === 820 && p.height === 640 ? p : undefined; }, 8000);
  check(!!saved, `the Mail window's size is kept in settings (${saved ? `${saved.width}×${saved.height} at ${saved.x},${saved.y}` : 'not saved'})`);

  // 5. Closing page windows never quits Keeper; the main window is still there.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/view=page/.test(w.webContents.getURL())) w.close(); });
  await wait(1500);
  check((await pageWins(app)).length === 0, 'the page windows close');
  const alive = await main.evaluate(() => window.keeper.windows.list()).catch(() => null);
  check(Array.isArray(alive), 'Keeper keeps running after its page windows close');
  // Reopened, Mail comes back at the size it had.
  await main.evaluate(() => window.keeper.windows.openPage({ name: 'mail' }));
  await pageOf(app, 'mail');
  await wait(1500);
  const [back] = await pageWins(app, 'mail');
  check(back && back.bounds.width === 820 && back.bounds.height === 640, `Mail opens again at its kept size (${back?.bounds.width}×${back?.bounds.height})`);

  // 6. Keeper Mail in the app menu (Linux: a desktop entry), and removed again.
  const before = await main.evaluate(() => window.keeper.launchers.list());
  check(before.length === 3 && before.every((l) => !l.installed), 'three app icons offered, none added yet');
  const after = await main.evaluate(() => window.keeper.launchers.add('mail'));
  const entry = path.join(HOME, '.local/share/applications/keeper-mail.desktop');
  const text = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
  check(after.find((l) => l.page === 'mail')?.installed === true && /^Exec=.*--keeper-open=mail$/m.test(text) && /^Name=Keeper Mail$/m.test(text), 'Keeper Mail is added to the app menu with --keeper-open=mail');
  const icon = /^Icon=(.*)$/m.exec(text)?.[1];
  check(!!icon && fs.existsSync(icon), 'with an icon of its own');
  // Settings → Features in a window of its own lists them, Keeper Mail as added.
  await main.evaluate(() => window.keeper.windows.openPage({ name: 'settings', arg: 'features' }));
  const sw = await pageOf(app, 'settings');
  const listed = sw && await until(async () => (await sw.locator('[data-testid="launchers"] [data-launcher]').count()) === 3, 20_000);
  check(!!listed, 'Settings → Features lists the three app icons');
  if (listed) {
    check((await sw.locator('[data-launcher="mail"]').textContent())?.includes('Added'), 'with Keeper Mail marked as added');
    await sw.locator('[data-testid="launchers"]').scrollIntoViewIfNeeded();
    await sw.screenshot({ path: path.join(SHOTS, 'app-icons-settings.png') });
  }
  await main.evaluate(() => window.keeper.launchers.remove('mail'));
  check(!fs.existsSync(entry) && !(icon && fs.existsSync(icon)), 'removing Keeper Mail deletes what Keeper made');
  // Something else at that place is left alone.
  fs.writeFileSync(entry, '[Desktop Entry]\nName=Keeper Mail\nExec=someone-elses\n');
  const foreign = await main.evaluate(() => window.keeper.launchers.list());
  check(foreign.find((l) => l.page === 'mail')?.foreign === true, 'a file Keeper did not make is reported, not taken over');
  const refused = await main.evaluate(() => window.keeper.launchers.remove('mail').then(() => 'removed', (e) => String(e.message || e)));
  check(refused !== 'removed' && fs.existsSync(entry), 'and is never deleted');
  fs.rmSync(entry, { force: true });

  await app.close();
  await wait(1500);

  // 7. Keeper started by a separate app icon: only that page's window shows.
  const app2 = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox', `--user-data-dir=${DATA}`, '--keeper-open=notes'], env });
  const notes = await pageOf(app2, 'notes');
  check(!!notes, 'Keeper started with --keeper-open=notes opens the Notes window');
  await wait(4000);
  const wins = await windowsOf(app2);
  const mainWin = wins.find((w) => w.url.includes('view=app'));
  check(!mainWin || !mainWin.visible, 'and leaves the main window hidden');
  check(wins.some((w) => /page=notes/.test(w.url) && w.visible), 'the Notes window is on screen');
  await app2.close();

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
