// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/suite.cjs <scratch dir> <screenshots dir>
// Keeper as a suite (docs/SUITE.md): the Island, desktop widgets and Mail and
// calendars run in processes of their own. Drives the real app and checks that
//   • the parts start, and their windows work (calls answered by the app);
//   • the Island's open model works in its own process (the window grown while the pointer
//     rests, then open; the trackpad tap reaches the app; a field takes the keyboard);
//   • killing the Island's process (SIGKILL) brings it back, and the app does not notice;
//   • killing the Mail process brings it back, and a message scheduled with Send later
//     still goes (against a local Dovecot and SMTP server, when Dovecot is installed);
//   • switching a part off stops its process, switching it on starts it again;
//   • killing the app's main process (SIGKILL) leaves the Island, the widgets and Mail
//     running (Send later fires while the app is away), and the watchdog's new Keeper
//     picks them up again.
const { _electron, chromium } = require('playwright');
const { execFileSync } = require('child_process');
const { SMTPServer } = require('smtp-server');
const { startDovecot } = require('../servers/dovecot.cjs');
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
  ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_SKIP_TOUR: '1',
  KEEPER_WATCHDOG: '1', KEEPER_WATCHDOG_EXTRA: `--remote-debugging-port=${APP_PORT} --no-sandbox`, KEEPER_PART_CDP_PORT_BASE: String(PART_PORT), KEEPER_SUITE: 'separate',
};

(async () => {
  // A mail account against local servers, for Send later across crashes.
  const dovecot = await startDovecot().catch(() => null);
  const sent = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    // The password must come through the Mail process's restart (kept in the app's memory where there is no keychain).
    onAuth: (a, _s, cb) => (a.username === 'ana' && a.password === 'secret' ? cb(null, { user: 'ana' }) : cb(new Error('Invalid login'))),
    onData: (stream, _s, cb) => { const c = []; stream.on('data', (x) => c.push(x)); stream.on('end', () => { sent.push(Buffer.concat(c).toString()); cb(); }); },
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const smtpPort = smtp.server.address().port;
  const wasSent = (subject) => sent.some((m) => m.includes(`Subject: ${subject}`));
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const browsers = [];
  try {
    const main = await until(() => app.windows().find((x) => /view=app/.test(x.url())), 60000);
    await main.waitForSelector('.sidebar', { timeout: 60000 });
    const appPid = await app.evaluate(() => process.pid);
    // ---------------------------------------------------------------- 1. the parts run
    const parts = await until(async () => { const l = await main.evaluate(() => window.keeper.suite.parts()); return l.length === 3 && l.every((p) => p.state === 'running') ? l : null; }, 40000, 500);
    check(!!parts, `the Island, the widgets and Mail run in processes of their own (${parts ? parts.map((p) => `${p.id} pid ${p.pid}, ${(p.memory / 1048576).toFixed(0)} MB in ${p.processes} processes`).join('; ') : 'not running'})`);
    const islandPid = pidOf('island');
    const widgetsPid = pidOf('widgets');
    const mailPid = pidOf('mail');
    check(!!islandPid && !!widgetsPid && !!mailPid && ![islandPid, widgetsPid, mailPid].includes(appPid), `separate processes: app ${appPid}, Island ${islandPid}, widgets ${widgetsPid}, Mail ${mailPid}`);
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
    // The open model, in the Island's own process: the pointer resting on the pill grows the window
    // to the open size at once (island.prepare, answered in the part), it opens after the rest, and the
    // trackpad tap (island.haptic) goes over the channel to the app.
    await app.evaluate(({ ipcMain }) => { globalThis.__haptics = 0; ipcMain.on('island.haptic', () => { globalThis.__haptics++; }); });
    await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, hoverOpen: true, hoverDelayMs: 450 } }); });
    await sleep(1200);
    const islBounds = () => isl.page.evaluate(() => ({ width: window.outerWidth, height: window.outerHeight }));
    const closedW = (await islBounds()).width;
    const pillAt = await isl.page.evaluate(() => { const r = document.querySelector('.isl-content').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await isl.page.mouse.move(pillAt.x, pillAt.y);
    await sleep(200);
    const waitingW = (await islBounds()).width;
    const openNow = () => isl.page.locator('.live-card, .isl-panel').count();
    check(waitingW > closedW && !(await openNow()), `the pointer resting on the pill grows the Island's window before it opens (${closedW} → ${waitingW})`);
    check(!!(await until(async () => (await openNow()) === 1, 4000, 50)), 'then the Island opens, in its own process');
    check(!!(await until(() => app.evaluate(() => globalThis.__haptics > 0), 4000, 100)), 'and its trackpad tap reached the app over the channel');
    const focusable = await isl.page.evaluate(() => { window.keeper.island.takeFocus(); return new Promise((r) => setTimeout(() => r(document.hasFocus()), 600)); });
    check(focusable, 'the open Island takes the keyboard when asked (takeFocus, in its own process)');
    await isl.page.mouse.move(-50, 2000);
    await isl.page.locator('.isl-content').dispatchEvent('mouseleave');
    check(!!(await until(async () => (await openNow()) === 0 && (await isl.page.locator('.cmp').count()) === 1, 6000, 100)), 'and closes again to the pill when the pointer leaves');
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

    // ---------------------------------------------------------------- 2b. Mail crashes; Send later still goes
    let accId = null;
    if (dovecot) {
      const acc = await main.evaluate(([imapPort, smtpPort]) => window.keeper.pim.addAccount({
        kind: 'imap', email: 'ana@example.org', name: 'Ana', password: 'secret',
        imap: { host: '127.0.0.1', port: imapPort, security: 'none', user: 'ana' }, smtp: { host: '127.0.0.1', port: smtpPort, security: 'none', user: 'ana' },
      }), [dovecot.port, smtpPort]).catch((e) => { console.error(e); return null; });
      accId = acc?.id ?? null;
      check(!!accId, 'a mail account is added (through the Mail process)');
    } else console.log('SKIP Send later checks: Dovecot is not installed');
    if (accId) {
      const later = await main.evaluate((acc) => window.keeper.pim.send({ account: acc, to: [{ address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Suite later one', body: 'Later.', sendAt: Date.now() + 12_000 }), accId);
      check(!!later?.id && (await main.evaluate(() => window.keeper.pim.outbox())).some((o) => o.id === later.id), 'a message is scheduled with Send later');
      await sleep(1500);
      process.kill(mailPid, 'SIGKILL');
      const newMail = await until(() => { const p = pidOf('mail'); return p && p !== mailPid ? p : null; }, 20000, 250);
      check(!!newMail, `after SIGKILL the Mail process is started again (pid ${mailPid} → ${newMail})`);
      const listed = await until(async () => (await main.evaluate(() => window.keeper.pim.outbox())).length > 0, 20000, 500);
      check(!!listed, 'the scheduled message is still in the outbox after the restart');
      check(!!(await until(() => wasSent('Suite later one'), 40000, 500)), 'and Send later still fires: the message reached the SMTP server');
      check(alive(appPid) && alive(widgetsPid), 'the app and the widgets were not touched by the Mail crash');
    }

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
    // Mail and calendars: one switch on the suite page turns its three features; all off ends the process.
    const mailBefore = pidOf('mail');
    await main.evaluate(async () => { for (const f of ['mail', 'calendars', 'alarms']) await window.keeper.features.set(f, false); });
    check(!!(await until(() => !alive(mailBefore) && !pidOf('mail'), 10000)), 'switching Mail and calendars off ends its process');
    const mailOff = (await main.evaluate(() => window.keeper.suite.parts())).find((p) => p.id === 'mail');
    check(mailOff.state === 'off' && !mailOff.on, `and the suite page says it is off (${mailOff.state})`);
    await main.evaluate(async () => { for (const f of ['mail', 'calendars', 'alarms']) await window.keeper.features.set(f, true); });
    const mailAgain = await until(() => pidOf('mail'), 20000);
    check(!!mailAgain && mailAgain !== mailBefore, `switching it on starts it again (pid ${mailAgain})`);
    if (accId) check(!!(await until(async () => (await main.evaluate(() => window.keeper.pim.accounts())).some((a) => a.email === 'ana@example.org'), 20000, 500)), 'with the mail account still there');

    // ---------------------------------------------------------------- 4. the app crashes
    isl = await partPage(PART_PORT, 'island');
    browsers.push(isl.browser);
    await isl.page.waitForSelector('.isl-content', { timeout: 20000 });
    const islandNow = pidOf('island');
    const widgetsNow = pidOf('widgets');
    const mailNow = pidOf('mail');
    if (accId) await main.evaluate((acc) => window.keeper.pim.send({ account: acc, to: [{ address: 'bob@example.org' }], cc: [], bcc: [], subject: 'Suite later two', body: 'While Keeper is away.', sendAt: Date.now() + 6_000 }), accId);
    if (accId) await sleep(1000);
    const watchdogs = () => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((p) => { try { const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); return a.includes('watchdog.cjs') && a.includes(userData); } catch { return false; } });
    check(watchdogs().length >= 1, 'the watchdog is running');
    process.kill(appPid, 'SIGKILL');
    await until(() => !alive(appPid), 5000, 100);
    await sleep(1500);
    check(alive(islandNow) && alive(widgetsNow) && alive(mailNow), `after SIGKILL of the app, the Island (${islandNow}), widgets (${widgetsNow}) and Mail (${mailNow}) are still running`);
    if (accId) check(!!(await until(() => wasSent('Suite later two'), 20000, 300)) && !alive(appPid), 'Send later fires while the app is away (from the Mail process)');
    const shown = await isl.page.locator('.isl-content').count().catch(() => 0);
    check(shown === 1, 'and the Island is still on screen, answering its page');
    screenshot('2-app-killed');
    const newApp = await until(() => { const p = pidOf('app'); return p && p !== appPid ? p : null; }, 45000, 500);
    check(!!newApp, `the watchdog started Keeper again (pid ${newApp})`);
    const reconnected = await until(() => isl.page.evaluate(() => window.keeper.suite.parts()).then((l) => {
      const i = l.find((p) => p.id === 'island');
      const w = l.find((p) => p.id === 'widgets');
      const m = l.find((p) => p.id === 'mail');
      return i.state === 'running' && i.pid === islandNow && w.state === 'running' && w.pid === widgetsNow && m.state === 'running' && m.pid === mailNow ? l : null;
    }), 45000, 1000);
    check(!!reconnected, 'the new Keeper adopted the running Island, widgets and Mail (same processes, not started twice)');
    check(['island', 'widgets', 'mail'].every((r) => keeperProcesses().filter((p) => p.role === r).length === 1), 'one copy of each part');
    if (accId) check((await isl.page.evaluate(() => window.keeper.pim.accounts()).catch(() => [])).some((a) => a.email === 'ana@example.org'), 'the new Keeper reaches Mail and its account');
    const answered = await isl.page.evaluate(() => window.keeper.island.state().then((s) => !!s)).catch(() => false);
    check(answered, 'the Island’s calls are answered by the new Keeper');
    screenshot('3-app-back');

    // ---------------------------------------------------------------- 5. Force Quit (as on a Mac: not started again)
    // The watchdog writes app-stopped.json when a Mac's Keeper was stopped without a crash report;
    // here the watchdog is stopped first and the note written by hand.
    const app2 = pidOf('app');
    for (const w of watchdogs()) try { process.kill(Number(w), 'SIGKILL'); } catch { /* gone */ }
    process.kill(app2, 'SIGKILL');
    await until(() => !alive(app2), 5000, 100);
    fs.writeFileSync(path.join(userData, 'suite', 'app-stopped.json'), JSON.stringify({ pid: app2, at: Date.now() }));
    await sleep(8000);
    const mailStill = pidOf('mail');
    check(!pidOf('app') && alive(islandNow) && alive(widgetsNow) && !!mailStill, 'after a Force Quit Keeper stays stopped, and the Island, widgets and Mail keep running');
    check(!pidOf('app'), 'the Island’s own calls on its timers do not start Keeper again');
    // A click on the Island starts Keeper again, which picks the parts up.
    await isl.page.click('.isl-content', { timeout: 5000 }).catch((e) => console.error(e.message));
    const woke = await until(() => pidOf('app'), 30000, 500);
    check(!!woke, `clicking the Island starts Keeper again (pid ${woke})`);
    const again = await until(() => isl.page.evaluate(() => window.keeper.suite.parts()).then((l) => (l.every((p) => p.state === 'running') && l.find((p) => p.id === 'island').pid === islandNow ? l : null)), 45000, 1000);
    check(!!again, 'and that Keeper adopted the parts that stayed');
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    smtp.close();
    dovecot?.stop();
    for (const b of browsers) await b?.close().catch(() => undefined);
    // The first Keeper was killed on purpose: closing it may never answer.
    await Promise.race([app.close().catch(() => undefined), sleep(5000)]);
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
