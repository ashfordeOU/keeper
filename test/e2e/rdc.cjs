// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1600x900x24" node test/e2e/rdc.cjs [/tmp/krdc] [shots folder]
// Remote Desktops end to end, with real servers on this computer:
//  - a real VNC server (x11vnc) on a second X display showing a small Tk window:
//    the picture renders in a Keeper tab, and typing and the pointer reach the server;
//  - a real sshd on a high port: first-connection fingerprint question, then an SSH terminal tab that runs a command;
//  - a .rdp file (UTF-16, as Windows saves it) imported, and the exact FreeRDP arguments;
//  - FreeRDP run against a port where nothing listens: the error comes back, and the password
//    never shows on a command line;
//  - .vnc files opened as the file manager would, the quick-connect window, the palette and the tray menu;
//  - a second Keeper reaching the VNC server "through Keeper Link" (a Link port forward);
//  - nothing keeps running for Remote Desktops once the page is closed.
const { _electron } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(process.argv[2] ? path.dirname(path.resolve(process.argv[2])) : os.tmpdir(), 'krdc-')));
const SHOTS = process.argv[3] || process.env.KEEPER_SHOTS || path.join(os.tmpdir(), 'keeper-rdc-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const homes = { a: path.join(ROOT, 'desk'), b: path.join(ROOT, 'laptop') };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(h, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await wait(200);
  }
}
const procs = [];
const bg = (cmd, args, env = {}) => { const p = spawn(cmd, args, { stdio: 'ignore', env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', ...env } }); procs.push(p); return p; };

// ---------------------------------------------------------------- servers
const VNC_DISPLAY = ':77';
const VNC_PORT = 5917;
const VNC_PW = 'kpass1';
const typedFile = path.join(ROOT, 'typed.txt');
function startVnc() {
  bg('Xvfb', [VNC_DISPLAY, '-screen', '0', '640x400x24', '-nolisten', 'tcp']);
  execFileSync('sleep', ['1']);
  const tcl = path.join(ROOT, 'app.tcl');
  fs.writeFileSync(tcl, `wm geometry . 640x400+0+0\n. configure -background "#3366cc"\nentry .e -width 30 -font {Helvetica 20}\nplace .e -x 40 -y 40\nbind .e <KeyRelease> { set f [open "${typedFile}" w]; puts -nonewline $f [.e get]; close $f }\n`);
  bg('wish', [tcl], { DISPLAY: VNC_DISPLAY });
  const pw = path.join(ROOT, 'vncpasswd');
  execFileSync('x11vnc', ['-storepasswd', VNC_PW, pw], { stdio: 'ignore' });
  bg('x11vnc', ['-display', VNC_DISPLAY, '-rfbport', String(VNC_PORT), '-rfbauth', pw, '-forever', '-shared', '-localhost', '-noxdamage', '-o', path.join(ROOT, 'x11vnc.log')]);
}
const SSH_PORT = 2299;
function startSshd() {
  const d = path.join(ROOT, 'sshd');
  fs.mkdirSync(d, { recursive: true });
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(d, 'host')]);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(d, 'client')]);
  fs.copyFileSync(path.join(d, 'client.pub'), path.join(d, 'authorized_keys'));
  const cfg = path.join(d, 'sshd_config');
  fs.writeFileSync(cfg, `Port ${SSH_PORT}\nListenAddress 127.0.0.1\nHostKey ${d}/host\nAuthorizedKeysFile ${d}/authorized_keys\nPermitRootLogin yes\nStrictModes no\nUsePAM no\nPasswordAuthentication no\nPidFile ${d}/pid\n`);
  fs.mkdirSync('/run/sshd', { recursive: true });
  bg('/usr/sbin/sshd', ['-D', '-f', cfg, '-e']);
  return path.join(d, 'client');
}

async function launch(home, extraEnv = {}) {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: home, NODE_OPTIONS: '', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share', KEEPER_E2E_KEEP_QUICK: '1', KEEPER_SKIP_TOUR: '1', ...extraEnv } });
  let main;
  for (let i = 0; i < 240 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  if (!main) { await app.close().catch(() => undefined); throw new Error('no main window'); }
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 4000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 860 }).catch(() => undefined);
  return { app, main, errors };
}
const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const p = f.split('.');
  let o = window.keeper;
  for (const k of p.slice(0, -1)) o = o[k];
  return o[p[p.length - 1]](...a);
}, [fn, args]);
const theme = async (w, mode) => { await api(w, 'settings.set', { appearance: mode }); await wait(600); };
const shot = async (w, name) => { for (const m of ['light', 'dark']) { await theme(w, m); await w.screenshot({ path: `${SHOTS}/${name}-${m}.png` }); } await theme(w, 'light'); };

/** Average colour of the middle of a VNC canvas in a window. */
const canvasColour = (w, x = 0.75, y = 0.75) => w.evaluate(([x, y]) => {
  const c = [...document.querySelectorAll('[data-testid=rdc-canvas]')].pop();
  if (!c || !c.width) return null;
  const d = c.getContext('2d').getImageData(Math.round(c.width * x), Math.round(c.height * y), 8, 8).data;
  const s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return s.map((v) => Math.round(v / (d.length / 4)));
}, [x, y]);
const near = (c, want) => c && c.every((v, i) => Math.abs(v - want[i]) < 24);

async function pair(A, B) {
  const inv = await api(A.main, 'link.invite');
  const sa = await api(A.main, 'link.state');
  const pairing = api(B.main, 'link.pair', { address: `127.0.0.1:${sa.me.port}`, code: inv.code }).catch((e) => console.log('pair error', e.message));
  const pa = await until(async () => (await api(A.main, 'link.pending')).pairs[0], 15000);
  const pb = await until(async () => (await api(B.main, 'link.pending')).pairs[0], 15000);
  if (pa) await api(A.main, 'link.confirmPair', pa.id, true);
  if (pb) await api(B.main, 'link.confirmPair', pb.id, true);
  await pairing;
  return until(async () => (await api(A.main, 'link.state')).devices.length === 1 && (await api(B.main, 'link.state')).devices.length === 1, 15000);
}

(async () => {
  startVnc();
  const clientKey = startSshd();
  await wait(1500);
  const A = await launch(homes.a);
  const { main } = A;

  // ---------------------------------------------------------------- the page, and VNC in a tab
  const vncConn = await api(main, 'rdc.save', { name: 'Test desktop', protocol: 'vnc', host: '127.0.0.1', port: VNC_PORT, folder: 'Lab', tags: ['test'], color: '#a855f7', favourite: true });
  await api(main, 'rdc.save', { name: 'Office PC', protocol: 'rdp', host: 'office-pc.example', user: 'ana', folder: 'Work', rdp: { multimon: true } });
  await main.locator('.nav-item', { hasText: 'Remote Desktops' }).first().click();
  await main.waitForSelector('[data-testid=rdc-card]', { timeout: 15000 });
  const dot = await until(async () => (await main.locator('[data-testid=rdc-card]', { hasText: 'Test desktop' }).locator('.rdc-dot.online').count()) > 0, 10000);
  check(!!dot, 'the status dot shows the VNC server answering (a light knock while the page is open)');
  await theme(main, 'dark');
  check((await main.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'settings.set({ appearance: "dark" }) reaches the window (startup is not held up by the tray)');
  await theme(main, 'light');
  await shot(main, 'rdc-list');
  await main.locator('[data-testid=rdc-card]', { hasText: 'Test desktop' }).getByRole('button', { name: 'Connect' }).click();
  const asked = await until(async () => (await main.locator('[data-testid=rdc-password]').count()) > 0, 10000);
  check(!!asked, 'VNC asks for the password (nothing stored)');
  await main.fill('[data-testid=rdc-password]', VNC_PW);
  await main.getByRole('button', { name: 'Connect', exact: true }).last().click();
  const blue = await until(async () => { const c = await canvasColour(main); return near(c, [51, 102, 204]) ? c : null; }, 20000);
  check(!!blue, `the VNC picture renders in a Keeper tab (pixel ${JSON.stringify(blue)} ≈ the server's #3366cc)`);
  const tabsNow = await main.locator('.tab-strip .tab').count().catch(() => 0);
  check(tabsNow >= 2, `the session opened in a new Keeper tab (${tabsNow} tabs)`);

  // Pointer: click into the entry on the remote screen, then type.
  const box = await main.locator('[data-testid=rdc-canvas]').boundingBox();
  const sx = box.width / 640, sy = box.height / 400;
  await main.mouse.click(box.x + 80 * sx, box.y + 58 * sy);
  await wait(400);
  await main.mouse.move(box.x + 300 * sx, box.y + 200 * sy);
  const moved = await until(async () => {
    const out = execFileSync('xdotool', ['getmouselocation', '--shell'], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', DISPLAY: VNC_DISPLAY }, encoding: 'utf8' });
    const x = Number(/X=(\d+)/.exec(out)[1]), y = Number(/Y=(\d+)/.exec(out)[1]);
    return Math.abs(x - 300) <= 3 && Math.abs(y - 200) <= 3 ? `${x},${y}` : null;
  }, 8000);
  check(!!moved, `the pointer reaches the VNC server (remote pointer at ${moved})`);
  await main.locator('[data-testid=rdc-canvas]').focus();
  await main.keyboard.type('Hello42', { delay: 40 });
  const typed = await until(async () => { const t = fs.readFileSync(typedFile, 'utf8'); return t === 'Hello42' ? t : null; }, 8000);
  check(!!typed, `typing reaches the VNC server (the remote text box says “${typed ?? (fs.existsSync(typedFile) ? fs.readFileSync(typedFile, 'utf8') : '')}”)`);
  await wait(800);
  await shot(main, 'rdc-vnc');

  // The same desktop with “fast” pictures: Tight (fill, zlib and JPEG rectangles), JPEG drawn by the window's image decoder.
  const fastConn = await api(main, 'rdc.save', { name: 'Test desktop (Tight)', protocol: 'vnc', host: '127.0.0.1', port: VNC_PORT, vnc: { picture: 'fast' } });
  const fastRes = await api(main, 'rdc.connect', fastConn.id, { password: VNC_PW });
  const tightBlue = await until(async () => { const c = await canvasColour(main); return near(c, [51, 102, 204]) ? c : null; }, 20000);
  const xlog = fs.existsSync(path.join(ROOT, 'x11vnc.log')) ? fs.readFileSync(path.join(ROOT, 'x11vnc.log'), 'utf8') : '';
  check(!!tightBlue && /Using tight encoding/.test(xlog), `with “fast” pictures the server used Tight (its log: ${/Using JPEG[^\n]*/.exec(xlog)?.[0] ?? 'no JPEG line'}) and the picture renders (pixel ${JSON.stringify(tightBlue)})`);
  await shot(main, 'rdc-vnc-tight');
  if (fastRes?.session) await api(main, 'rdc.disconnect', fastRes.session.id);
  await wait(500);

  // ---------------------------------------------------------------- SSH in a terminal tab against a real sshd
  const sshConn = await api(main, 'rdc.save', { name: 'Local sshd', protocol: 'ssh', host: '127.0.0.1', port: SSH_PORT, user: os.userInfo().username, auth: 'key', keyFile: clientKey });
  await main.locator('.tab-strip .tab').first().click().catch(() => undefined);
  await main.locator('.nav-item', { hasText: 'Remote Desktops' }).first().click();
  await main.locator('[data-testid=rdc-card]', { hasText: 'Local sshd' }).getByRole('button', { name: 'Connect' }).click();
  const fp = await until(async () => (await main.locator('[data-testid=rdc-fingerprint]').count()) && main.locator('[data-testid=rdc-fingerprint]').innerText(), 10000);
  const realFp = execFileSync('ssh-keygen', ['-lf', path.join(ROOT, 'sshd', 'host.pub')], { encoding: 'utf8' }).split(' ')[1];
  check(!!fp && fp.includes(realFp), `first connection shows the server's fingerprint to compare (${fp})`);
  await main.screenshot({ path: `${SHOTS}/rdc-hostkey-light.png` });
  await main.getByRole('button', { name: 'Trust and Connect' }).click();
  const term = await until(async () => (await api(main, 'rdc.state')).sessions.find((s) => s.kind === 'terminal' && s.state === 'connected'), 10000);
  check(!!term, 'the SSH connection opens as a terminal session');
  let out = '';
  if (term) {
    await until(async () => { out = (await api(main, 'terminal.attach', term.terminal)).data; return /\$ |# |continue connecting/.test(out); }, 15000);
    if (/continue connecting/.test(out)) await api(main, 'terminal.input', term.terminal, 'yes\r');
    await api(main, 'terminal.input', term.terminal, 'echo RDC_SSH_$((40+2))\r');
    await until(async () => { out = (await api(main, 'terminal.attach', term.terminal)).data; return out.includes('RDC_SSH_42'); }, 15000);
  }
  check(out.includes('RDC_SSH_42') && !/continue connecting/.test(out), 'a command runs over SSH in the terminal tab (no second host-key question: Keeper recorded the key)');
  const onTerminal = await main.evaluate(() => !!document.querySelector('.xterm'));
  check(onTerminal, 'the terminal tab is showing');
  await wait(600);
  await shot(main, 'rdc-ssh');
  void sshConn;

  // ---------------------------------------------------------------- .rdp import and FreeRDP's arguments
  const rdpFile = path.join(homes.a, 'Documents', 'Imported desk.rdp');
  const rdpText = 'full address:s:rdp-imported.example:3390\r\nusername:s:CORP\\bob\r\nuse multimon:i:1\r\nscreen mode id:i:2\r\nredirectclipboard:i:1\r\naudiomode:i:2\r\n';
  fs.writeFileSync(rdpFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(rdpText, 'utf16le')]));
  const imp = await api(main, 'rdc.importFile', rdpFile);
  const imported = imp && imp.added[0];
  check(!!imported && imported.host === 'rdp-imported.example' && imported.user === 'bob' && imported.domain === 'CORP', `a .rdp file (UTF-16) imports: ${imported && `${imported.name} → ${imported.user}@${imported.host}:${imported.port}`}`);
  const cmd = imported && await api(main, 'rdc.command', imported.id);
  console.log('   ', cmd && [cmd.file, ...cmd.args].join(' '));
  check(!!cmd && /xfreerdp3$/.test(cmd.file) && ['/v:rdp-imported.example:3390', '/u:bob', '/d:CORP', '/f', '/multimon', '+clipboard', '/audio-mode:2', '/cert:tofu'].every((a) => cmd.args.includes(a)), 'the generated xfreerdp3 arguments match the file');
  const secret = 'Zx9-secret-RDP';
  const rdpBad = await api(main, 'rdc.save', { name: 'Nothing here', protocol: 'rdp', host: '127.0.0.1', port: 3391, user: 'bob' });
  let sawArgs = '';
  const watcher = setInterval(() => {
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); if (c.includes('xfreerdp')) sawArgs += c.replace(/\0/g, ' ') + '\n'; } catch { /* gone */ }
    }
  }, 30);
  const bad = await api(main, 'rdc.connect', rdpBad.id, { password: secret });
  clearInterval(watcher);
  console.log('   ', bad.session && bad.session.error);
  check(!!bad.session && bad.session.state === 'error' && !!bad.session.error, `FreeRDP against a closed port reports the error back (“${bad.session && bad.session.error}”)`);
  check(!!sawArgs && sawArgs.includes('/from-stdin') && !sawArgs.includes(secret) && !JSON.stringify(bad).includes(secret), `the password went to FreeRDP's input, never its command line (${sawArgs.split('\n')[0].slice(0, 120)}…)`);

  // ---------------------------------------------------------------- where it appears: places, quick connect, palette, tray, files
  await main.locator('.tab-strip .tab').first().click().catch(() => undefined);
  await main.evaluate(() => window.keeper.rdc.state());
  await main.locator('.nav-item', { hasText: 'Remote Desktops' }).first().click();
  await main.getByRole('button', { name: 'Where it appears' }).click();
  await main.waitForSelector('[data-testid=rdc-place-tray]');
  const tray = await api(main, 'rdc.trayPreview');
  const trayLabels = JSON.stringify(tray);
  check(/Remote Desktops/.test(trayLabels) && /Test desktop/.test(trayLabels) && /Quick Connect/.test(trayLabels) && /Open now/.test(trayLabels), 'the tray menu lists Quick Connect, the favourite, recent ones and what is open');
  await shot(main, 'rdc-places');
  await api(main, 'rdc.showQuick');
  const quick = await until(async () => A.app.windows().find((w) => w.url().includes('view=rdc-quick')), 10000);
  check(!!quick, 'the quick-connect window opens (the global shortcut runs the same)');
  if (quick) {
    await quick.waitForSelector('[data-testid=rdc-quickwin]');
    await quick.keyboard.type('Test');
    await wait(400);
    for (const m of ['light', 'dark']) { await theme(main, m); await quick.screenshot({ path: `${SHOTS}/rdc-quickconnect-${m}.png` }); }
    await theme(main, 'light');
    check((await quick.locator('.rdc-quickwin-row', { hasText: 'Test desktop' }).count()) > 0, 'the quick-connect window finds saved connections as you type');
    await api(quick, 'rdc.closeQuick');
  }
  const shortcutOk = await A.app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+R'));
  check(shortcutOk, 'the global quick-connect shortcut is registered');
  await main.keyboard.press('Control+K');
  await main.keyboard.type('Quick Connect');
  await wait(400);
  check((await main.locator('.q-row', { hasText: 'Quick Connect to a Remote Desktop' }).count()) > 0, 'the command palette offers Quick Connect');
  for (const m of ['light', 'dark']) { await theme(main, m); await main.screenshot({ path: `${SHOTS}/rdc-palette-${m}.png` }); }
  await theme(main, 'light');
  await main.keyboard.press('Escape');

  // A .vnc file, as a double-click in the file manager would open it (password from the file).
  const vncFile = path.join(homes.a, 'Desktop', 'Lab screen.vnc');
  const obf = execFileSync('od', ['-An', '-tx1', path.join(ROOT, 'vncpasswd')], { encoding: 'utf8' }).replace(/\s+/g, '');
  fs.writeFileSync(vncFile, `[Connection]\nHost=127.0.0.1::${VNC_PORT}\nPassword=${obf}\n`);
  const before = (await api(main, 'rdc.state')).sessions.filter((s) => s.kind === 'inapp' && s.state === 'connected').length;
  const tabsBefore = await main.locator('.tab-strip .tab').count();
  const fr = await api(main, 'rdc.openFile', vncFile);
  const tabsAfter = await until(async () => { const n = await main.locator('.tab-strip .tab').count(); return n > tabsBefore ? n : null; }, 8000);
  const after = (await api(main, 'rdc.state')).sessions.filter((s) => s.kind === 'inapp' && s.state === 'connected').length;
  check(!!fr && !!fr.route && after === before + 1 && !!tabsAfter, `a .vnc file opens straight into a VNC tab (${tabsBefore} → ${tabsAfter} tabs)`);
  // The same through a second launch with the file as argument (what double-click does).
  const second = spawn(path.resolve(__dirname, '../../node_modules/.bin/electron'), [path.resolve(__dirname, '../..'), '--no-sandbox', vncFile], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: homes.a, XDG_CONFIG_HOME: homes.a + '/.config', XDG_DATA_HOME: homes.a + '/.local/share', NODE_OPTIONS: '' }, stdio: 'ignore' });
  const viaArgv = await until(async () => (await api(main, 'rdc.state')).sessions.filter((s) => s.kind === 'inapp' && s.state === 'connected').length === after + 1, 20000);
  second.kill();
  check(!!viaArgv, 'launching Keeper with a .vnc file (double-click) connects in the running Keeper');
  const desktopFile = path.join(homes.a, '.local/share/kio/servicemenus/keeper-rdc.desktop');
  void desktopFile;

  // ---------------------------------------------------------------- through Keeper Link, from a second Keeper
  const B = await launch(homes.b);
  check(!!(await pair(A, B)), 'two Keeper apps are paired over Keeper Link');
  const deskId = (await api(B.main, 'link.state')).devices[0].id;
  const laptopId = (await api(A.main, 'link.state')).devices[0].id;
  const allow = await api(A.main, 'rdc.hostViaLink', laptopId, true);
  check(allow.ok, `the desk lets the laptop reach its ports through Link (${allow.message.slice(0, 80)}…)`);
  const viaLink = await api(B.main, 'rdc.save', { name: 'Desk over Link', protocol: 'vnc', host: 'localhost', port: VNC_PORT, gateway: { kind: 'link', device: deskId } });
  const lr = await api(B.main, 'rdc.connect', viaLink.id, { password: VNC_PW });
  check(!!lr.session && /Keeper Link/.test(lr.session.via || ''), `the laptop connects “${lr.session && lr.session.via}”`);
  if (lr.route) await api(B.main, 'rdc.openRoute', lr.route);
  const blueB = await until(async () => { const c = await canvasColour(B.main); return near(c, [51, 102, 204]) ? c : null; }, 20000);
  check(!!blueB, `the VNC picture arrives through the Link forward (pixel ${JSON.stringify(blueB)})`);
  const fwd = (await api(B.main, 'link.state')).forwards;
  check(fwd.some((f) => f.port === VNC_PORT && f.active), 'a Link port forward carries it');
  await B.main.screenshot({ path: `${SHOTS}/rdc-via-link-light.png` });
  if (lr.session) await api(B.main, 'rdc.disconnect', lr.session.id);
  await until(async () => !(await api(B.main, 'link.state')).forwards.some((f) => f.port === VNC_PORT), 8000);
  check(!(await api(B.main, 'link.state')).forwards.some((f) => f.port === VNC_PORT), 'disconnecting removes the forward');

  // ---------------------------------------------------------------- nothing left running when the page is closed
  // Close every Remote Desktops tab but the first, then show the page, then leave it.
  for (let i = 0; i < 6 && (await main.locator('.tab-strip .tab').count()) > 1; i++) await main.locator('.tab-strip .tab').last().locator('.tab-close').click({ timeout: 3000 }).catch(() => undefined);
  // (a dialog from the pairing may cover the window: click through the DOM)
  await main.evaluate(() => document.querySelector('.nav-item[title="Remote Desktops"]')?.click());
  await wait(800);
  const live = async () => JSON.stringify(await api(main, 'features.live'));
  const whileOpen = await live();
  console.log('   live checks while open:', (whileOpen.match(/rdc[^"]*/g) || []).join(', '));
  await main.evaluate(() => document.querySelector('.nav-item')?.click());
  await wait(1200);
  // Other Keeper tabs still show sessions; close those tabs' pages too.
  const closed = await live();
  check(/rdc-status/.test(whileOpen), 'status checks run while the page is open');
  check(!/"rdc-status"[^}]*"everyMs":\d/.test(closed), 'no Remote Desktops check runs once the page is closed');

  check(A.errors.length === 0 && B.errors.length === 0, `no page errors ${JSON.stringify([...A.errors, ...B.errors]).slice(0, 300)}`);
  await A.app.close().catch(() => undefined);
  await B.app.close().catch(() => undefined);
  const leftover = execFileSync('sh', ['-c', 'ps -eo args | grep -c "[x]freerdp3" || true'], { encoding: 'utf8' }).trim();
  check(leftover === '0', 'no FreeRDP left running after quit');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { for (const p of procs) p.kill(); });
