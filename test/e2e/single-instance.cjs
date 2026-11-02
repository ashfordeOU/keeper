// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/single-instance.cjs /tmp/si-home
// One Keeper per person: a second start with ANOTHER data folder (another copy of Keeper)
// hands its link to the running one and quits; only one main window and one Keeper main
// process are left. A start with a different person's home (a test run) is a Keeper of its own.
const { _electron } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = path.resolve(ROOT, 'node_modules/.bin/electron');
const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keeper main processes (Electron without --type=) running this checkout, with their data folders. */
function keeperMains() {
  const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.includes(ROOT) && /electron/i.test(l) && !l.includes('--type=') && !l.includes('node_modules/.bin') && !l.includes('single-instance.cjs') && !/playwright|ELECTRON_RUN_AS_NODE|watchdog|terminal-host/.test(l)).map((l) => l.trim());
}

(async () => {
  const app = await _electron.launch({ executablePath: ELECTRON, args: [ROOT, '--no-sandbox', `--user-data-dir=${HOME}/.config/Keeper`], env });
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  check(!!main, 'the first Keeper opens its window');
  await wait(2000);
  const before = keeperMains();

  // Another copy: a different data folder, the same person.
  const t0 = Date.now();
  const second = spawn(ELECTRON, [ROOT, '--no-sandbox', `--user-data-dir=${HOME}/other-copy`, 'keeper://awake/toggle'], { env, stdio: 'ignore' });
  const code = await new Promise((r) => { second.on('exit', (c) => r(c)); setTimeout(() => r('still running'), 20_000); });
  check(code !== 'still running', `the second start quits by itself (${code}, after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (code === 'still running') second.kill('SIGKILL');
  check(!fs.existsSync(path.join(HOME, 'other-copy', 'session', 'running.json')), 'the second start never got as far as starting Keeper');
  await wait(1500);
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('view=app')).length);
  check(wins === 1, `one main window (${wins})`);
  const after = keeperMains();
  check(after.length === before.length && before.length >= 1, `one Keeper main process in the process tree (${after.length}: ${after.map((l) => l.split(' ')[0]).join(', ')})`);
  // Its link reached the running Keeper.
  const awake = await main.evaluate(() => window.keeper.awake.status()).catch(() => null);
  check(!!awake && awake.on === true, 'the second start\'s keeper:// link was handled by the running Keeper (Keep Awake is on)');
  await main.evaluate(() => window.keeper.awake.stop()).catch(() => undefined);

  // Crash breadcrumbs are kept from the start (session/breadcrumbs.json), with the regular checks and recent log lines.
  const crumbs = (() => { try { return JSON.parse(fs.readFileSync(path.join(HOME, '.config/Keeper/session/breadcrumbs.json'), 'utf8')); } catch { return null; } })();
  check(!!crumbs && Array.isArray(crumbs.polls) && Array.isArray(crumbs.lines) && crumbs.pid > 0, `crash breadcrumbs are written (${crumbs?.polls?.length ?? 0} checks, ${crumbs?.lines?.length ?? 0} lines, ${crumbs?.memoryMB?.rss ?? '?'} MB)`);
  await app.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
