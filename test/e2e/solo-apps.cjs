// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/solo-apps.cjs /tmp/kp-solo /tmp/kp-solo-shots
// Light apps (core/solo.ts, docs/SOLO.md): Keeper started by an app icon with --keeper-solo=mail runs
// only Mail. Checked here: the Mail window opens, named "Keeper Mail", with a window class of its own;
// no main window, no Island, widgets or other part processes, no library index (its calls are not
// answered), no tray; Mail's calls answer. A second app icon (--keeper-solo=notes) joins the same
// process. Then Keeper itself is started: the light app saves, quits and Keeper takes over (one
// process, the parts start, the Mail and Notes windows open again in it). With Keeper running, an
// app icon (--keeper-solo=calendar) just opens its page there and starts nothing of its own.
// Screenshots: solo-mail-{light,dark}.png in the shots folder.
const { _electron, chromium } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-solo');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-solo-shots');
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = path.resolve(ROOT, 'node_modules/.bin/electron');
const DATA = path.join(HOME, '.config', 'Keeper');
const CDP = 9400 + Math.floor(Math.random() * 400);
const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_RUNTIME_DIR: path.join(HOME, 'run') };
fs.mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(250);
  }
}

/** Keeper's processes for this test's data folder: pid and command line. */
function keeperProcs() {
  const out = [];
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      // Chromium's helper processes rewrite their command line as one string: split on spaces too.
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split(/[\0 ]/).filter(Boolean);
      if (cmd.some((a) => a === `--user-data-dir=${DATA}`) || (cmd.some((a) => a.includes(DATA)) && cmd.some((a) => /--type=|--keeper-role=/.test(a)))) out.push({ pid: +p, cmd });
    } catch { /* gone */ }
  }
  return out;
}
const mainProcs = () => keeperProcs().filter((p) => !p.cmd.some((a) => a.startsWith('--type=') || a.startsWith('--keeper-role=')) && !/node$/.test(p.cmd[0]));
const partProcs = () => keeperProcs().filter((p) => p.cmd.some((a) => a.startsWith('--keeper-role=')));
const instancePid = () => {
  const dir = path.join(env.XDG_RUNTIME_DIR, 'keeper-instance');
  try { const f = fs.readdirSync(dir).find((x) => x.startsWith('instance-')); return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).pid; } catch { return undefined; }
};

/** Another start of Keeper with these arguments: it hands them to the running one, or takes over. */
function start(args, detached = false) {
  const p = spawn(ELECTRON, [ROOT, '--no-sandbox', `--user-data-dir=${DATA}`, ...args], { env, stdio: 'ignore', detached });
  if (detached) p.unref();
  return new Promise((r) => { p.on('exit', (c) => r(c)); setTimeout(() => r('still running'), 20_000); });
}

const windowsOf = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).map((w) => ({ id: w.id, url: w.webContents.getURL(), title: w.getTitle(), visible: w.isVisible() })));
const pageOf = (app, page) => until(async () => app.windows().find((w) => { try { const u = new URL(w.url()); return u.searchParams.get('view') === 'page' && u.searchParams.get('page') === page; } catch { return false; } }));

(async () => {
  // 1. Keeper Mail on its own.
  const app = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox', `--user-data-dir=${DATA}`, '--keeper-solo=mail'], env: { ...env, KEEPER_SOLO_QUIT_ON_CLOSE: '1' } });
  const mail = await pageOf(app, 'mail');
  check(!!mail, 'Keeper Mail opens the Mail window');
  await mail.waitForSelector('[data-testid="page-window-title"]', { timeout: 30_000 });
  await wait(4000);
  const wins = await windowsOf(app);
  check(wins.length === 1 && wins[0].title === 'Keeper Mail', `one window, named after the app icon (${wins.map((w) => w.title).join(', ')})`);
  check(!wins.some((w) => /view=app\b/.test(w.url)), 'no main window');
  check((await mail.locator('.content .mail, .content [data-testid="mail-compose"], .content .pim-setup, .content .empty').count()) > 0, 'the window shows the Mail page');
  const accounts = await mail.evaluate(() => window.keeper.pim.accounts().then((a) => Array.isArray(a)));
  check(accounts === true, "Mail's calls are answered (pim.accounts)");
  const lib = await mail.evaluate(() => window.keeper.library.status().then(() => 'answered', (e) => String(e.message || e)));
  check(lib !== 'answered', `the library index is not running (library.status: ${lib.slice(0, 60)})`);
  const island = await mail.evaluate(() => window.keeper.island?.state?.().then(() => 'answered', () => 'no') ?? 'no');
  check(island === 'no', 'the Island service is not running');
  check(await mail.locator('[data-testid="open-keeper"]').count() === 1, 'its top bar offers Open Keeper');
  const solo = await mail.evaluate(() => window.keeper.solo.info());
  check(solo && solo.apps.join() === 'mail', `the window knows it is a light app (${JSON.stringify(solo)})`);
  check(partProcs().length === 0, `no Island, widgets or Mail part processes (${partProcs().map((p) => p.cmd.find((a) => a.startsWith('--keeper-role'))).join(', ') || 'none'})`);
  const tray = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check(tray === 1, 'no other windows (Quick Search, Island, widgets, glance)');
  check(!fs.existsSync(path.join(DATA, 'index.json')), 'no library index written');
  // The window class (Linux): the dock groups it under Keeper Mail's desktop entry, not Keeper's.
  try {
    const id = execFileSync('xdotool', ['search', '--name', '^Keeper Mail$'], { encoding: 'utf8' }).trim().split('\n')[0];
    const cls = execFileSync('xprop', ['-id', id, 'WM_CLASS'], { encoding: 'utf8' });
    check(/keeper-mail/.test(cls), `its window class is its own (${cls.trim()})`);
  } catch (e) {
    check(false, `window class readable (${e.message.split('\n')[0]})`);
  }
  const pid = await app.evaluate(() => process.pid);
  check(instancePid() === pid, 'the light app holds Keeper\'s one-per-person lock');

  // Screenshots, light and dark.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await wait(1200);
  await mail.screenshot({ path: path.join(SHOTS, 'solo-mail-light.png') });
  await mail.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(1500);
  await mail.screenshot({ path: path.join(SHOTS, 'solo-mail-dark.png') });
  await mail.evaluate(() => window.keeper.settings.set({ appearance: 'system' }));

  // 2. A second app icon joins the same light app.
  const code = await start(['--keeper-solo=notes']);
  check(code !== 'still running', `the second app icon hands over and quits (${code})`);
  const notes = await pageOf(app, 'notes');
  check(!!notes, 'Keeper Notes opens its window in the same light app');
  check((await windowsOf(app)).some((w) => w.title === 'Keeper Notes'), 'named Keeper Notes');
  check(mainProcs().length === 1, `still one Keeper process (${mainProcs().map((p) => p.cmd.slice(0, 4).join(' ')).join(' | ')})`);
  const info2 = await mail.evaluate(() => window.keeper.solo.info());
  check(info2.apps.join() === 'mail,notes', `it now serves Mail and Notes (${info2.apps.join()})`);

  // The other app icons join too, each with its own part answering its window.
  for (const [id, page, probe] of [['files', 'browse', 'library.status'], ['terminal', 'terminal', 'terminal.settings'], ['rdc', 'rdc', 'rdc.state'], ['studio', 'studio', 'studio.options']]) {
    await start([`--keeper-solo=${id}`]);
    const w = await pageOf(app, page);
    check(!!w, `Keeper ${id} opens its window in the light app`);
    if (!w) continue;
    await w.waitForSelector('[data-testid="page-window-title"]', { timeout: 30_000 }).catch(() => undefined);
    const [g, m] = probe.split('.');
    const r = await until(() => w.evaluate(([g2, m2]) => window.keeper[g2][m2]().then(() => 'answered', (e) => String(e.message || e)), [g, m]).then((x) => (x === 'answered' ? x : undefined)), 15_000);
    check(r === 'answered', `and its calls are answered (${probe})`);
  }
  await wait(1500);
  check(mainProcs().length === 1, 'still one Keeper process with six app icons');

  // 3. Keeper itself takes over: one process, its parts start, the windows come back there.
  const closed = new Promise((r) => app.process().once('exit', () => r(true)));
  await start([`--remote-debugging-port=${CDP}`], true);
  check(await Promise.race([closed, wait(20_000).then(() => false)]), 'the light app quits when Keeper starts');
  const full = await until(async () => { const m = mainProcs(); return m.length === 1 && !m[0].cmd.some((a) => a.startsWith('--keeper-solo')) ? m[0] : undefined; }, 30_000);
  check(!!full, 'Keeper itself is running in its place (one process)');
  const reopen = full?.cmd.find((a) => a.startsWith('--keeper-reopen='))?.slice(16).split(',') ?? [];
  check(['mail', 'notes', 'browse', 'terminal', 'rdc', 'studio'].every((p) => reopen.includes(p)), `it was told which windows to open again (${reopen.join(',')})`);
  check(await until(async () => instancePid() === full?.pid, 15_000), 'and holds the lock');
  const parts = await until(async () => (partProcs().length ? partProcs() : undefined), 40_000);
  check(!!parts, `Keeper's parts start (${(parts ?? []).map((p) => p.cmd.find((a) => a.startsWith('--keeper-role'))).join(', ')})`);
  let browser;
  try {
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${CDP}`), 30_000);
    const urls = async () => browser.contexts().flatMap((c) => c.pages()).map((p) => p.url());
    const both = await until(async () => { const u = await urls(); return u.some((x) => /view=page/.test(x) && /page=mail/.test(x)) && u.some((x) => /view=page/.test(x) && /page=notes/.test(x)) ? u : undefined; }, 30_000);
    check(!!both, 'Keeper opens the Mail and Notes windows again');
    // 4. With Keeper running, an app icon opens its page there.
    const c4 = await start(['--keeper-solo=calendar']);
    check(c4 !== 'still running', `an app icon hands over to the running Keeper (${c4})`);
    const cal = await until(async () => (await urls()).some((x) => /view=page/.test(x) && /page=calendar/.test(x)), 20_000);
    check(!!cal, 'and Calendar opens in a window of Keeper\'s');
    check(mainProcs().length === 1, 'still one Keeper process');
  } catch (e) {
    check(false, `reaching Keeper after the take-over (${e.message})`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
  for (const p of keeperProcs()) try { process.kill(p.pid, 'SIGTERM'); } catch { /* gone */ }
  await wait(3000);
  for (const p of keeperProcs()) try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ }
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  for (const p of keeperProcs()) try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(1);
});
