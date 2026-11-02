// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/suite.cjs <scratch dir> <screenshots dir>
// Keeper as a suite (docs/SUITE.md): the Island and desktop widgets run in
// processes of their own. Drives the real app and checks that
//   • both parts start, and their windows work (calls answered by the app);
//   • killing the Island's process (SIGKILL) brings it back, and the app does not notice;
//   • switching a part off stops its process, switching it on starts it again;
//   • killing the app's main process (SIGKILL) leaves the Island and the widgets
//     running, on screen, and the watchdog's new Keeper picks them up again.
const { _electron, chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/ksuite-'));
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
const HOME = path.join(ROOT, 'home');
const APP = path.resolve(__dirname, '../..');
const PART_PORT = 9800 + Math.floor(Math.random() * 300) * 2;
const APP_PORT = PART_PORT - 1;
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const userData = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(userData, { recursive: true });
// One clock on the desktop, so the widgets' part has something to show.
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ widgets: [{ id: 'w-clock', kind: 'clock', bounds: { x: 60, y: 120, width: 220, height: 220 }, locked: true, allWorkspaces: false, style: {}, options: {} }] }));

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } if (Date.now() - t > ms) return null; await sleep(step); } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const screenshot = (name) => { try { execFileSync('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); } catch { /* no ImageMagick */ } };

/** Keeper's main processes for this test (the app and its parts), from their command lines. */
function keeperProcesses() {
  const out = [];
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      // Chromium rewrites its main process's title, joining the arguments with spaces.
      const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split(/[\0 ]/);
      if (!/electron$/.test(a[0]) || a.some((x) => x.startsWith('--type=')) || !a.includes(APP)) continue;
      const role = (a.find((x) => x.startsWith('--keeper-role=')) ?? '--keeper-role=app').slice('--keeper-role='.length);
      if (role !== 'app' && !a.includes(`--user-data-dir=${userData}`)) continue;
      out.push({ pid: Number(p), role });
    } catch { /* gone */ }
  }
  return out;
}
const pidOf = (role) => keeperProcesses().find((p) => p.role === role)?.pid;
function descendants(pid) {
  const kids = new Map();
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try { const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8'); const pp = +st.slice(st.lastIndexOf(')') + 2).split(' ')[1]; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(+p); } catch { /* gone */ }
  }
  const out = [];
  const walk = (x) => { for (const c of kids.get(x) ?? []) { out.push(c); walk(c); } };
  walk(pid);
  return out;
}

/** A part's windows, through its debugging port (tests only: KEEPER_PART_CDP_PORT_BASE). */
async function partPage(port, view) {
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 4000 }).catch(() => null), 30000, 500);
  if (!browser) return { browser: null, page: null };
  const page = await until(async () => { for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes(`view=${view}`)) return p; return null; }, 20000, 300);
  return { browser, page };
}

const env = {
  ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_SKIP_TOUR: '1',
  KEEPER_WATCHDOG: '1', KEEPER_WATCHDOG_EXTRA: `--remote-debugging-port=${APP_PORT} --no-sandbox`, KEEPER_PART_CDP_PORT_BASE: String(PART_PORT), KEEPER_SUITE: 'separate',
};

(async () => {
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const browsers = [];
  try {
    const main = await until(() => app.windows().find((x) => /view=app/.test(x.url())), 60000);
    await main.waitForSelector('.sidebar', { timeout: 60000 });
    const appPid = await app.evaluate(() => process.pid);
    // ---------------------------------------------------------------- 1. both parts run
    const parts = await until(async () => { const l = await main.evaluate(() => window.keeper.suite.parts()); return l.every((p) => p.state === 'running') ? l : null; }, 40000, 500);
    check(!!parts, `the Island and the widgets run in processes of their own (${parts ? parts.map((p) => `${p.id} pid ${p.pid}, ${(p.memory / 1048576).toFixed(0)} MB in ${p.processes} processes`).join('; ') : 'not running'})`);
    const islandPid = pidOf('island');
    const widgetsPid = pidOf('widgets');
    check(!!islandPid && !!widgetsPid && islandPid !== appPid && widgetsPid !== appPid, `separate processes: app ${appPid}, Island ${islandPid}, widgets ${widgetsPid}`);
    check(app.windows().every((w) => !/view=(island|widget)\b/.test(w.url())), 'the app’s own process has no Island or widget window');
    let isl = await partPage(PART_PORT, 'island');
    browsers.push(isl.browser);
    check(!!isl.page, 'the Island’s window is in the Island’s process');
    await isl.page.waitForSelector('.isl-content', { timeout: 20000 });
    // Placed by its own process as it would be by the app: centred at the top, the window no bigger than the pill.
    await sleep(1500);
    const bounds = await isl.page.evaluate(() => ({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight }));
    const layout = await isl.page.evaluate(() => window.keeper.island.layout());
    const scr = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
    check(!!layout && Math.abs(bounds.left + bounds.width / 2 - (scr.x + scr.width / 2)) <= 1 && bounds.top === scr.y && bounds.width <= layout.pill.width + 2, `the Island is placed at the top centre and hugs the pill (${bounds.left},${bounds.top} ${bounds.width}×${bounds.height})`);
    // A call from the Island's window is answered by the app (a focus timer), and the app's event reaches it back.
    await isl.page.evaluate(() => window.keeper.island.focus('start', 25));
    const pill = await until(() => isl.page.locator('.cmp').innerText().then((t) => (/2[45]:\d\d/.test(t) ? t : null)), 8000);
    check(!!pill, `the Island's calls reach the app and its state comes back (pill "${(pill ?? '').replace(/\s+/g, ' ').trim()}")`);
    const wid = await partPage(PART_PORT + 1, 'widget');
    browsers.push(wid.browser);
    check(!!wid.page, 'the clock widget’s window is in the widgets’ process');
    const current = await wid.page.evaluate(() => window.keeper.widgets.current()).catch(() => null);
    check(current?.id === 'w-clock', 'the widget knows which widget it is (answered in its own process)');
    screenshot('1-parts');

    // ---------------------------------------------------------------- 2. the Island crashes
    process.kill(islandPid, 'SIGKILL');
    const newIsland = await until(() => { const p = pidOf('island'); return p && p !== islandPid ? p : null; }, 20000, 250);
    check(!!newIsland, `after SIGKILL the Island's process is started again (pid ${islandPid} → ${newIsland})`);
    const back = await until(async () => { const l = await main.evaluate(() => window.keeper.suite.parts()); const p = l.find((x) => x.id === 'island'); return p.state === 'running' && p.pid === newIsland ? p : null; }, 20000, 500);
    check(!!back && back.restarts >= 1 && !!back.lastCrash, `the suite page shows the restart and the crash (${back ? `${back.restarts} restart(s), last: ${back.lastCrash?.reason}` : 'no'})`);
    check(alive(appPid) && (await main.evaluate(() => window.keeper.library.status().then((s) => typeof s.files === 'number'))), 'the app was not touched (same process, still answering)');
    check(alive(widgetsPid), 'the widgets were not touched');

    // ---------------------------------------------------------------- 3. off and on again
    await main.evaluate(() => window.keeper.features.set('widgets', false));
    const gone = await until(() => !alive(widgetsPid) && !pidOf('widgets'), 10000);
    check(!!gone, 'switching Desktop widgets off ends their process');
    const offState = (await main.evaluate(() => window.keeper.suite.parts())).find((p) => p.id === 'widgets');
    check(offState.state === 'off' && !offState.pid, `and the suite page says it is off (${offState.state})`);
    await main.evaluate(() => window.keeper.features.set('widgets', true));
    const widgetsAgain = await until(() => pidOf('widgets'), 20000);
    check(!!widgetsAgain && widgetsAgain !== widgetsPid, `switching them on starts it again (pid ${widgetsAgain})`);
    const widPage = await partPage(PART_PORT + 1, 'widget');
    browsers.push(widPage.browser);
    check(!!widPage.page, 'with the clock widget on the desktop again');

    // ---------------------------------------------------------------- 4. the app crashes
    isl = await partPage(PART_PORT, 'island');
    browsers.push(isl.browser);
    await isl.page.waitForSelector('.isl-content', { timeout: 20000 });
    const islandNow = pidOf('island');
    const widgetsNow = pidOf('widgets');
    const watchdogs = () => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((p) => { try { const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); return a.includes('watchdog.cjs') && a.includes(userData); } catch { return false; } });
    check(watchdogs().length >= 1, 'the watchdog is running');
    process.kill(appPid, 'SIGKILL');
    await until(() => !alive(appPid), 5000, 100);
    await sleep(1500);
    check(alive(islandNow) && alive(widgetsNow), `after SIGKILL of the app, the Island (${islandNow}) and widgets (${widgetsNow}) are still running`);
    const shown = await isl.page.locator('.isl-content').count().catch(() => 0);
    check(shown === 1, 'and the Island is still on screen, answering its page');
    screenshot('2-app-killed');
    const newApp = await until(() => { const p = pidOf('app'); return p && p !== appPid ? p : null; }, 45000, 500);
    check(!!newApp, `the watchdog started Keeper again (pid ${newApp})`);
    const reconnected = await until(() => isl.page.evaluate(() => window.keeper.suite.parts()).then((l) => {
      const i = l.find((p) => p.id === 'island');
      const w = l.find((p) => p.id === 'widgets');
      return i.state === 'running' && i.pid === islandNow && w.state === 'running' && w.pid === widgetsNow ? l : null;
    }), 45000, 1000);
    check(!!reconnected, 'the new Keeper adopted the running Island and widgets (same processes, not started twice)');
    check(keeperProcesses().filter((p) => p.role === 'island').length === 1 && keeperProcesses().filter((p) => p.role === 'widgets').length === 1, 'one copy of each part');
    const answered = await isl.page.evaluate(() => window.keeper.island.state().then((s) => !!s)).catch(() => false);
    check(answered, 'the Island’s calls are answered by the new Keeper');
    screenshot('3-app-back');
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    for (const b of browsers) await b?.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    // Everything this test started, including what the watchdog started.
    const all = keeperProcesses().map((p) => p.pid);
    for (const p of [...all, ...all.flatMap(descendants)]) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
    for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try { const a = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); if (a.includes('watchdog.cjs') && a.includes(userData)) process.kill(Number(d), 'SIGKILL'); } catch { /* gone */ }
    }
  }
  console.log(failed ? `${failed} check(s) failed` : 'all suite checks passed');
  process.exit(failed ? 1 : 0);
})();
