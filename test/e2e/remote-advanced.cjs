// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/remote-advanced.cjs <shots dir>
// Keeper-to-Keeper remote access with three real Keeper apps on one computer
// (desk, laptop, tablet; separate homes):
//   - the laptop reaches the desk through a relay, finds a direct UDP path and
//     sends a file over it;
//   - help mode: the desk shows a code and password, the laptop (not paired for
//     this) connects, sees the screen view-only, the desk allows control and
//     takes it back;
//   - a second viewer (the tablet) joins the laptop's session, view-only;
//   - a terminal on the desk from the laptop, over Link;
//   - `keeper remote exec` refused without "Run commands", allowed with it
//     (after the desk's owner sees the command);
//   - `keeper remote ssh-proxy` pipes bytes;
//   - the audit log on both sides; Get help / Help someone on the Island and in
//     the palette (placement around the system).
const { _electron, chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'k2k-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k2k-e2e-')));
const homes = { a: path.join(ROOT, 'desk'), b: path.join(ROOT, 'laptop'), c: path.join(ROOT, 'tablet') };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(h, d), { recursive: true });
const big = crypto.randomBytes(4_000_000);
fs.writeFileSync(path.join(homes.b, 'Documents/Plans.bin'), big);
const CLI = path.resolve(__dirname, '../../dist-cli/keeper.cjs');

let passed = 0;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (ok) passed++; else { failed++; process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await wait(250);
  }
}

async function launch(home, extraEnv = {}) {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME: home, NODE_OPTIONS: '', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share', KEEPER_LINK_TEST_NO_LAN: '1', KEEPER_SKIP_TOUR: '1', ...extraEnv } });
  let main;
  for (let i = 0; i < 160 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  if (!main) throw new Error('no main window');
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  // The first-run tour would cover the pages.
  const skip = main.getByRole('button', { name: 'Skip tour' });
  if (await skip.count().catch(() => 0)) await skip.first().click().catch(() => undefined);
  return { app, main, errors, home };
}

const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const p = f.split('.');
  let o = window.keeper;
  for (const k of p.slice(0, -1)) o = o[k];
  return o[p[p.length - 1]](...a);
}, [fn, args]);

async function shot(w, name) {
  for (const dark of [false, true]) {
    await w.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }).catch(() => undefined);
    await w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark).catch(() => undefined);
    await w.waitForTimeout(400);
    await w.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` }).catch((e) => console.log('shot', name, e.message));
  }
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'light' })).catch(() => undefined);
}

async function pair(A, B) {
  const inv = await api(A.main, 'link.invite');
  const sa = await api(A.main, 'link.state');
  const before = (await api(A.main, 'link.state')).devices.length;
  const pairing = api(B.main, 'link.pair', { address: `127.0.0.1:${sa.me.port}`, code: inv.code }).catch((e) => console.log('pair error', e.message));
  const pa = await until(async () => (await api(A.main, 'link.pending')).pairs[0], 15000);
  const pb = await until(async () => (await api(B.main, 'link.pending')).pairs[0], 15000);
  if (pa) await api(A.main, 'link.confirmPair', pa.id, true);
  if (pb) await api(B.main, 'link.confirmPair', pb.id, true);
  await pairing;
  return until(async () => (await api(A.main, 'link.state')).devices.length === before + 1, 15000);
}

const idOf = async (from, name) => (await api(from.main, 'link.state')).devices.find((d) => d.name === name)?.id;

function cli(home, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home + '/.config' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    if (opts.onStart) opts.onStart(p);
  });
}

(async () => {
  // A relay on this computer: the laptop and desk are told not to use the local network for Link,
  // so they start on the relay and the direct path has something to replace.
  require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../../core/link/relay.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(ROOT, 'relay.cjs'), logLevel: 'silent' });
  const { RelayServer } = require(path.join(ROOT, 'relay.cjs'));
  const relay = new RelayServer();
  const rs = http.createServer((q, r) => { if (!relay.handleHttp(q, r)) { r.writeHead(404); r.end(); } });
  relay.attach(rs);
  await new Promise((r) => rs.listen(0, '127.0.0.1', r));
  const relayUrl = `http://127.0.0.1:${rs.address().port}`;

  const A = await launch(homes.a);
  const B = await launch(homes.b);
  const C = await launch(homes.c);
  for (const X of [A, B, C]) {
    // Help mode and run-commands are off by default: switch them on for this test.
    await api(X.main, 'features.set', 'remoteHelp', true);
    await api(X.main, 'features.set', 'remoteCommands', true);
  }

  check(!!(await pair(A, B)), 'desk and laptop are paired');
  check(!!(await pair(A, C)), 'desk and tablet are paired');
  check(!!(await pair(B, C)), 'laptop and tablet are paired');
  // Fresh windows: the features just switched on, and no pairing prompts left over from the API pairing.
  for (const X of [A, B, C]) {
    await X.main.reload();
    await X.main.waitForTimeout(2500);
    const skip = X.main.getByRole('button', { name: 'Skip tour' });
    if (await skip.count().catch(() => 0)) await skip.first().click().catch(() => undefined);
  }
  await api(A.main, 'link.rename', 'Desk');
  await api(B.main, 'link.rename', 'Laptop');
  await api(C.main, 'link.rename', 'Tablet');
  await wait(1000);
  const bState = await api(B.main, 'link.state');
  const aState = await api(A.main, 'link.state');
  const deskFromB = bState.devices.find((d) => d.id === aState.me.id).id;
  const laptopFromA = aState.devices.find((d) => d.id === bState.me.id).id;
  const cMe = (await api(C.main, 'link.state')).me.id;
  const tabletFromA = aState.devices.find((d) => d.id === cMe).id;
  const tabletFromB = bState.devices.find((d) => d.id === cMe).id;

  // ---------------------------------------------------------------- the direct carrier
  for (const X of [A, B, C]) await api(X.main, 'link.setSettings', { mode: 'internet', relayUrl, mailbox: '', stun: [] });
  check(!!(await until(async () => relay.listeners.size === 3, 15000)), 'all three listen on the relay');
  const chk = await api(B.main, 'link.check', deskFromB);
  check(chk.ok && (chk.via === 'relay' || chk.via === 'direct'), `the laptop reaches the desk (${chk.via})`);
  const direct = await until(async () => (await api(B.main, 'link.state')).devices.find((d) => d.id === deskFromB).via === 'direct', 25000);
  check(!!direct, 'a direct UDP path replaces the relay');
  // Files from the laptop are accepted without asking (the prompt itself is covered by link.cjs).
  await api(A.main, 'link.setPermissions', laptopFromA, { sendFiles: true, screenView: true, screenControl: true, forward: true }, true);
  const before = ((await api(B.main, 'link.state')).devices.find((d) => d.id === deskFromB).paths || []).find((p) => p.kind === 'direct')?.bytesOut ?? 0;
  const sending = api(B.main, 'link.sendFiles', deskFromB, [path.join(homes.b, 'Documents/Plans.bin')]);
  await sending.catch((e) => console.log('send error', e.message));
  const recv = path.join(homes.a, 'Downloads/Keeper/Plans.bin');
  check(fs.existsSync(recv) && fs.readFileSync(recv).equals(big), 'a 4 MB file arrived intact');
  const after = ((await api(B.main, 'link.state')).devices.find((d) => d.id === deskFromB).paths || []).find((p) => p.kind === 'direct');
  check(!!after && after.active && after.bytesOut - before > 4_000_000, `the file went over the direct path (${after ? Math.round((after.bytesOut - before) / 1e6 * 10) / 10 : 0} MB on it)`);
  await B.app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w?.webContents.send('event:navigate', `devices:${id}`); }, deskFromB);
  await B.main.waitForTimeout(1200);
  const pathsCard = await until(async () => (await B.main.locator('[data-testid=device-paths]').innerText()).includes('Direct'), 8000);
  check(!!pathsCard, 'the device page says the carrier is “Direct”');
  await shot(B.main, 'device-direct');

  // ---------------------------------------------------------------- help mode
  const navigate = (X, route) => X.app.evaluate(({ BrowserWindow }, r) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('view=app')); w?.webContents.send('event:navigate', r); }, route);
  await navigate(A, 'devices:help');
  await A.main.waitForTimeout(1500);
  await A.main.locator('[data-testid=help-start]').click({ timeout: 10000 });
  const code = await until(async () => (await A.main.locator('[data-testid=help-code]').innerText()).replace(/\D/g, ''), 10000);
  const pw = await until(async () => (await A.main.locator('[data-testid=help-password]').innerText()).trim(), 5000);
  check(/^\d{9}$/.test(code || '') && /^[A-Z0-9]{6}$/.test(pw || ''), `Get help shows a 9-digit code and a password (${code} / ${pw})`);
  await shot(A.main, 'help-get');
  await navigate(B, 'devices:help');
  await B.main.waitForTimeout(800);
  await B.main.locator('[data-testid=help-join-code]').fill(code);
  await B.main.locator('[data-testid=help-join-password]').fill('WRONG9');
  await B.main.locator('[data-testid=help-join]').click();
  const wrong = await until(async () => (await B.main.locator('[data-testid=help-card] .danger-text').innerText()), 15000);
  check(!!wrong && /not right|No one/.test(wrong), `a wrong password is refused (“${(wrong || '').trim()}”)`);
  await B.main.locator('[data-testid=help-join-password]').fill(pw);
  await B.main.locator('[data-testid=help-join]').click();
  const helpViewer = await until(async () => B.app.windows().find((w) => w.url().includes('view=screenviewer')), 20000);
  check(!!helpViewer, 'the helper’s viewer opens');
  const helpSess = await until(async () => (await api(B.main, 'screen.state')).sessions.find((s) => s.help && s.state !== 'ended'), 15000);
  check(!!helpSess && helpSess.control === false, 'the help session starts view-only');
  const hostBanner = await until(async () => A.app.windows().find((w) => w.url().includes('view=screenhost')), 15000);
  const bannerText = hostBanner && await until(async () => { const t = await hostBanner.locator('.screen-banner').innerText(); return /helping you/.test(t) ? t : ''; }, 10000);
  check(!!bannerText, `the person being helped sees a banner (“${(bannerText || '').replace(/\s+/g, ' ').trim()}”)`);
  check((await api(A.main, 'link.state')).devices.length === 2 && (await api(B.main, 'link.state')).devices.length === 2, 'no new pairing was made by the help session');
  await helpViewer?.screenshot({ path: `${SHOTS}/help-viewer-viewonly-light.png` }).catch(() => undefined);
  await hostBanner?.locator('[data-testid=banner-grant]').click();
  const granted = await until(async () => (await api(B.main, 'screen.state')).sessions.find((s) => s.id === helpSess.id)?.control === true, 10000);
  check(!!granted, 'the person being helped allows control; the helper gets it');
  const note = helpViewer && await until(async () => /may use their mouse/.test(await helpViewer.locator('.viewer-note').first().innerText()), 5000);
  check(!!note, 'the helper’s viewer says control was given');
  await helpViewer?.screenshot({ path: `${SHOTS}/help-viewer-control-light.png` }).catch(() => undefined);
  await hostBanner?.screenshot({ path: `${SHOTS}/help-banner-light.png` }).catch(() => undefined);
  await hostBanner?.locator('[data-testid=banner-revoke]').click();
  const revoked = await until(async () => (await api(B.main, 'screen.state')).sessions.find((s) => s.id === helpSess.id)?.control === false, 10000);
  check(!!revoked, 'and takes it back');
  await hostBanner?.locator('.screen-banner-stop').click();
  const helpEnded = await until(async () => !(await api(A.main, 'access.helpStatus')).guests.length && !(await api(B.main, 'access.helpStatus')).guests.length, 15000);
  check(!!helpEnded, 'Stop ends the help session completely on both sides');
  await helpViewer?.close().catch(() => undefined);

  // ---------------------------------------------------------------- a browser helps (web viewer)
  const offer2 = await api(A.main, 'access.helpStart');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(offer2.webUrl.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${(await api(A.main, 'link.state')).me.port}`));
  await page.locator('#help-code').fill(offer2.code);
  await page.locator('#help-pw').fill(offer2.password.toLowerCase());
  await page.locator('#help-name').fill('Robin');
  await page.locator('#help-go').click();
  const webPic = await until(async () => page.evaluate(() => { const i = document.getElementById('scr'); return i && i.naturalWidth > 100; }), 25000);
  check(!!webPic, 'a web browser joins with the code and password and sees the screen (view only)');
  await page.screenshot({ path: `${SHOTS}/help-web-light.png` });
  const webBanner = await until(async () => A.app.windows().find((w) => w.url().includes('view=screenhost')), 8000);
  await webBanner?.locator('[data-testid=banner-grant]').click().catch(() => undefined);
  const webCtl = await until(async () => page.evaluate(() => !document.getElementById('scr-controls').classList.contains('hidden')), 10000);
  check(!!webCtl, 'the browser helper gets control when it is given');
  await webBanner?.locator('.screen-banner-stop').click().catch(() => undefined);
  await browser.close();
  check(!pageErrors.length, `the web viewer has no page errors${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);

  // ---------------------------------------------------------------- a second viewer
  await api(A.main, 'link.setPermissions', tabletFromA, { sendFiles: true, screenView: true });
  await api(A.main, 'screen.setPolicy', { unattended: { [laptopFromA]: true } });
  const sid = await api(B.main, 'screen.view', deskFromB, { control: true });
  const live = await until(async () => (await api(B.main, 'screen.state')).sessions.find((s) => s.id === sid && s.state === 'live'), 20000);
  check(!!live, 'the laptop watches the desk (let in without asking)');
  await api(B.main, 'screen.signal', sid, { t: 'invite', device: tabletFromB });
  await wait(3000);
  const watch = await until(async () => (await C.main.locator('[data-testid=invite-watch]').count()) > 0, 15000);
  check(!!watch, 'the tablet is invited to watch');
  await shot(C.main, 'invite');
  if (watch) await C.main.locator('[data-testid=invite-watch]').click();
  const cView = await until(async () => (await api(C.main, 'screen.state')).sessions.find((s) => s.role === 'viewer' && s.state !== 'ended' && s.joined), 20000);
  check(!!cView && cView.control === false, 'the tablet joins, view-only');
  const hosts = await until(async () => { const n = (await api(A.main, 'screen.state')).sessions.filter((s) => s.role === 'host' && s.state !== 'ended').length; return n >= 2 ? n : 0; }, 15000);
  check(hosts >= 2, `the desk sends its screen to two viewers at once (${hosts})`);
  const cWin = await until(async () => C.app.windows().find((w) => w.url().includes('view=screenviewer')), 10000);
  const cPicture = cWin && await until(async () => cWin.evaluate(() => {
    const v = document.querySelector('[data-testid=viewer-video]');
    const c = document.querySelector('[data-testid=viewer-canvas]');
    return (v && v.videoWidth > 0) || (c && c.width > 300);
  }), 25000);
  check(!!cPicture, 'the second viewer gets the picture');
  await api(B.main, 'screen.stop', sid);
  const bothEnd = await until(async () => !(await api(C.main, 'screen.state')).sessions.some((s) => s.state !== 'ended'), 15000);
  check(!!bothEnd, 'when the first viewer ends, the invited one ends too');
  for (const w of [...B.app.windows(), ...C.app.windows()].filter((x) => x.url().includes('view=screenviewer'))) await w.close().catch(() => undefined);

  // ---------------------------------------------------------------- terminal over Link
  const refusedTerm = await B.main.evaluate(async (id) => {
    const tid = await window.keeper.access.termOpen(id, 80, 24);
    return new Promise((r) => { const off = window.keeper.on('access-term-exit', (x, reason) => { if (x === tid) { off(); r(reason); } }); setTimeout(() => r('timeout'), 8000); });
  }, deskFromB);
  check(/does not allow a terminal/.test(refusedTerm || ''), `without “Terminal on this device” the desk refuses (${refusedTerm})`);
  await api(A.main, 'link.setPermissions', laptopFromA, { sendFiles: true, screenView: true, screenControl: true, forward: true, terminal: true });
  await navigate(B, `devices:${deskFromB}`);
  await B.main.waitForTimeout(800);
  await B.main.locator('[data-testid=open-remote-terminal]').click();
  await until(async () => (await B.main.locator('[data-testid=remote-term] .xterm-rows').count()) > 0, 10000);
  await B.main.waitForTimeout(1500);
  await B.main.locator('[data-testid=remote-term] .xterm').click();
  await B.main.keyboard.type('echo k2k-$((6*7)) $HOME\n', { delay: 15 });
  const termOut = await until(async () => { const t = await B.main.locator('[data-testid=remote-term] .xterm-rows').innerText(); return t.includes('k2k-42') ? t : ''; }, 15000);
  check(!!termOut && termOut.includes(homes.a), 'a terminal on the desk runs from the laptop (it prints the desk’s home folder)');
  await shot(B.main, 'remote-terminal');
  await B.main.keyboard.press('Escape');

  // ---------------------------------------------------------------- keeper remote exec
  const deskName = (await api(B.main, 'link.state')).devices.find((d) => d.id === deskFromB).name;
  const r1 = await cli(homes.b, ['remote', 'exec', deskName, '--', 'echo', 'from-cli-$((1+1))']);
  check(r1.code !== 0 && /does not allow/.test(r1.err), `keeper remote exec is refused without “Run commands” (${r1.err.trim()})`);
  await api(A.main, 'link.setPermissions', laptopFromA, { sendFiles: true, screenView: true, screenControl: true, forward: true, terminal: true, runCommands: true });
  const running = cli(homes.b, ['remote', 'exec', deskName, '--', 'echo', 'from-cli-$((1+1))']);
  const ask = await until(async () => (await A.main.locator('[data-testid=command-ask]').count()) > 0, 15000);
  const askText = ask && (await A.main.locator('[data-testid=command-ask]').innerText());
  check(!!askText && askText.includes('echo from-cli'), `the desk’s owner sees the command first (“${(askText || '').trim()}”)`);
  await shot(A.main, 'command-ask');
  if (ask) await A.main.locator('[data-testid=command-allow]').click();
  const r2 = await running;
  check(r2.code === 0 && r2.out.trim() === 'from-cli-2', `…and with it, it runs (${JSON.stringify(r2.out.trim())})`);
  const r3 = await cli(homes.b, ['remote', 'exec', deskName, '--', 'echo', 'from-cli-$((1+1))']);
  check(r3.code === 0 && (await A.main.locator('[data-testid=command-ask]').count()) === 0, 'the same command later runs without asking again');

  // ---------------------------------------------------------------- ssh-proxy
  const echo = net.createServer((s) => s.pipe(s));
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const port = echo.address().port;
  let proxyOut = '';
  const proxy = cli(homes.b, ['remote', 'ssh-proxy', deskName, '--port', String(port)], {
    onStart: (p) => {
      p.stdout.on('data', (d) => (proxyOut += d));
      setTimeout(() => p.stdin.write('SSH-2.0-OpenSSH_test\r\n'), 1500);
      setTimeout(() => p.stdin.end(), 4000);
    },
  });
  await proxy;
  check(proxyOut.includes('SSH-2.0-OpenSSH_test'), 'keeper remote ssh-proxy pipes bytes to the port on the desk and back');
  echo.close();
  const list = await cli(homes.b, ['remote', 'list']);
  check(list.code === 0 && list.out.includes(deskName), 'keeper remote list shows the devices');

  // ---------------------------------------------------------------- the audit log
  const auditA = await api(A.main, 'access.audit', {});
  const auditB = await api(B.main, 'access.audit', {});
  const kinds = (l) => new Set(l.map((e) => e.kind));
  const ka = kinds(auditA);
  const kb = kinds(auditB);
  check(['help', 'screen', 'transfer', 'command', 'terminal'].every((k) => ka.has(k)), `the desk logged help, screen, file, command and terminal (${[...ka].join(', ')})`);
  check(['help', 'transfer', 'command', 'terminal', 'forward'].every((k) => kb.has(k)), `the laptop logged them too (${[...kb].join(', ')})`);
  check(auditA.some((e) => e.kind === 'command' && !e.ok) || auditB.some((e) => e.kind === 'command' && !e.ok), 'the refused command is in the log');
  await navigate(A, 'devices:audit');
  await A.main.waitForTimeout(1000);
  await A.main.locator('[data-testid=audit-card]').scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(A.main, 'audit');

  // ---------------------------------------------------------------- placement around the system
  await navigate(B, 'devices');
  await B.main.waitForTimeout(800);
  await shot(B.main, 'devices-fleet');
  await navigate(A, 'devices:remote');
  await A.main.waitForTimeout(800);
  await A.main.locator('[data-testid=surfaces-card]').scrollIntoViewIfNeeded().catch(() => undefined);
  await shot(A.main, 'surfaces');
  // The command palette.
  await B.main.keyboard.press('Control+K').catch(() => undefined);
  await B.main.waitForTimeout(500);
  await B.main.keyboard.type('help', { delay: 30 });
  await B.main.waitForTimeout(500);
  const palette = await B.main.getByText('Get Help (show a code for a helper)').count();
  check(palette > 0, 'the palette offers Get Help');
  await shot(B.main, 'palette-help');
  await B.main.keyboard.press('Escape');
  // The Island's Controls tab.
  // The Island: a help code waiting shows as an activity with Stop.
  await api(A.main, 'access.helpStart');
  const island = A.app.windows().find((w) => w.url().includes('view=island'));
  if (island) {
    await island.waitForTimeout(1500);
    await island.screenshot({ path: `${SHOTS}/island-help-light.png` }).catch(() => undefined);
    const txt = await island.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`island text mentions the help code: ${/Help code/.test(txt)}`);
  }
  await api(A.main, 'access.helpStop');

  const errs = [...A.errors, ...B.errors, ...C.errors];
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const X of [A, B, C]) await X.app.close().catch(() => undefined);
  relay.close();
  rs.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
