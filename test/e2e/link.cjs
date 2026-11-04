// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/link.cjs /tmp/klink /tmp/klink-shots
// Two real Keeper apps on one computer (separate homes): pair them through the
// windows with a code and the six-digit check, send files both ways, open a
// shared folder, forward a port, use the relay, and pair a phone (an emulated
// iPhone browser) that uploads a file and reads the clipboard.
const { _electron, chromium, devices } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.argv[2];
const SHOTS = process.argv[3];
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const homes = { a: path.join(ROOT, 'desk'), b: path.join(ROOT, 'laptop') };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(h, d), { recursive: true });
fs.mkdirSync(path.join(homes.a, 'Shared/Photos'), { recursive: true });
const photo = crypto.randomBytes(300_000);
fs.writeFileSync(path.join(homes.a, 'Shared/Photos/beach.jpg'), photo);
const bigB = crypto.randomBytes(3_000_000);
fs.writeFileSync(path.join(homes.b, 'Documents/Report.pdf'), bigB);
const smallA = crypto.randomBytes(40_000);
fs.writeFileSync(path.join(homes.a, 'Documents/notes.txt'), smallA);

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

async function launch(home) {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: home, NODE_OPTIONS: '', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share' } });
  let main;
  for (let i = 0; i < 160 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  if (!main) throw new Error('no main window; windows: ' + app.windows().map((w) => w.url()).join(', '));
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  return { app, main, errors };
}

const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const path = f.split('.');
  let o = window.keeper;
  for (const p of path.slice(0, -1)) o = o[p];
  return o[path[path.length - 1]](...a);
}, [fn, args]);

async function shot(w, name, dark) {
  await w.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
  await w.waitForTimeout(450);
  await w.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
}

(async () => {
  const A = await launch(homes.a);
  const B = await launch(homes.b);
  const sa = await api(A.main, 'link.state');
  const sb = await api(B.main, 'link.state');
  check(sa.me.listening && sb.me.listening, `both apps listen for devices (ports ${sa.me.port} and ${sb.me.port})`);
  check(sa.me.id !== sb.me.id, 'each app has its own identity');

  // ---- pair through the windows
  const openDevices = async (w) => { await w.locator('.nav-item[title="Pair a device, phones, access from anywhere"]').click(); await w.waitForTimeout(500); };
  await openDevices(A.main);
  await shot(A.main, 'devices-empty', false);
  await A.main.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  const codeText = await until(async () => (await A.main.locator('[data-testid=link-code]').innerText()).replace(/\D/g, ''));
  check(/^\d{6}$/.test(codeText || ''), `the first app shows a six-digit code (${codeText})`);
  await shot(A.main, 'pair-code', false);
  await shot(A.main, 'pair-code', true);

  await openDevices(B.main);
  await B.main.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  await B.main.locator('.modal').getByRole('button', { name: 'Enter a Code' }).click();
  // Local discovery (mDNS): the first app should show up as waiting to pair.
  const seen = await until(async () => (await B.main.locator('.link-row.pick').count()) > 0, 12000);
  check(!!seen, 'the second app finds the first on the local network (mDNS)');
  if (seen) await B.main.locator('.link-row.pick').first().click();
  else await B.main.locator('input[placeholder^="Address"]').fill(`127.0.0.1:${sa.me.port}`);
  await B.main.locator('input.link-code-input').fill(codeText);
  await shot(B.main, 'pair-enter', false);
  await B.main.getByRole('button', { name: 'Pair', exact: true }).click();
  const sasA = await until(async () => A.main.locator('[data-testid=link-sas]').innerText(), 15000);
  const sasB = await until(async () => B.main.locator('[data-testid=link-sas]').innerText(), 15000);
  check(!!sasA && sasA === sasB, `both windows show the same six digits (${sasA} / ${sasB})`);
  await shot(A.main, 'pair-compare', false);
  await shot(B.main, 'pair-compare', true);
  await A.main.getByRole('button', { name: /They match/ }).click();
  await B.main.getByRole('button', { name: /They match/ }).click();
  const paired = await until(async () => (await api(A.main, 'link.state')).devices.length === 1 && (await api(B.main, 'link.state')).devices.length === 1, 15000);
  check(!!paired, 'both apps list each other as paired');
  const devA = (await api(B.main, 'link.state')).devices[0]; // the desk, as the laptop sees it
  const devB = (await api(A.main, 'link.state')).devices[0];
  check(devA.name !== '' && devB.name !== '', `names: ${devA.name} / ${devB.name}`);

  // ---- files both ways, with the accept prompt
  // sendFiles waits for the accept, so run the click in parallel
  const sending = api(B.main, 'link.sendFiles', devA.id, [path.join(homes.b, 'Documents/Report.pdf')]);
  const offerShown = await until(async () => (await A.main.getByText('is sending a file').count()) > 0, 15000);
  check(!!offerShown, 'the desk asks before saving a file from the laptop');
  await shot(A.main, 'file-offer', false);
  if (offerShown) await A.main.getByRole('button', { name: 'Accept', exact: true }).click();
  await sending.catch((e) => console.log('send error', e.message));
  const recv = path.join(homes.a, 'Downloads/Keeper/Report.pdf');
  check(fs.existsSync(recv) && fs.readFileSync(recv).equals(bigB), 'the 3 MB file arrived intact on the desk');

  const back = api(A.main, 'link.sendFiles', devB.id, [path.join(homes.a, 'Documents/notes.txt')]);
  const offer2 = await until(async () => (await B.main.getByText('is sending a file').count()) > 0, 15000);
  if (offer2) await B.main.getByRole('button', { name: 'Always Accept' }).click();
  await back.catch((e) => console.log('send back error', e.message));
  const recv2 = path.join(homes.b, 'Downloads/Keeper/notes.txt');
  check(fs.existsSync(recv2) && fs.readFileSync(recv2).equals(smallA), 'a file sent the other way arrived too');

  // ---- shared folder: refused until allowed, then readable
  await api(A.main, 'link.addShare', path.join(homes.a, 'Shared'));
  const refused = await api(B.main, 'link.shares', devA.id).then(() => false, (e) => /does not allow/.test(e.message));
  check(refused, 'shared folders stay closed until the desk allows it');
  await api(A.main, 'link.setPermissions', devB.id, { sendFiles: true, browse: true, forward: true, clipboard: true });
  await B.main.locator(`.nav-item.link-side[title^="${devA.name}"]`).first().click();
  await B.main.waitForTimeout(400);
  await B.main.getByRole('button', { name: 'Open', exact: true }).click();
  const listed = await until(async () => (await B.main.getByRole('button', { name: 'Photos' }).count()) > 0, 10000);
  check(!!listed, 'the laptop sees the desk’s shared folder');
  if (listed) {
    await B.main.getByRole('button', { name: 'Photos' }).click();
    await until(async () => (await B.main.getByText('beach.jpg').count()) > 0, 8000);
    await shot(B.main, 'device-detail', false);
    await shot(B.main, 'device-detail', true);
    await B.main.getByRole('button', { name: /Copy here/ }).first().click();
    const got = await until(async () => fs.existsSync(path.join(homes.b, 'Downloads/Keeper/beach.jpg')) && fs.readFileSync(path.join(homes.b, 'Downloads/Keeper/beach.jpg')).equals(photo), 10000);
    check(!!got, 'a file copied out of the shared folder arrives intact');
  }

  // ---- a port on the desk, reached from the laptop
  const web = http.createServer((_q, r) => r.end('hello from a service on the desk'));
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const local = 30000 + Math.floor(Math.random() * 10000);
  const fwd = await api(B.main, 'link.addForward', { device: devA.id, kind: 'port', localPort: local, port: web.address().port });
  check(fwd.active, `forward localhost:${local} → desk:${web.address().port} is on`);
  const body = await fetch(`http://127.0.0.1:${local}/`).then((r) => r.text()).catch((e) => String(e));
  check(body === 'hello from a service on the desk', 'the forwarded port answers from the other device');
  web.close();

  // ---- clipboard
  await B.main.evaluate(() => navigator.clipboard.writeText('copied on the laptop')).catch(() => undefined);
  await api(B.main, 'link.sendClipboard', devA.id).catch((e) => console.log('clip', e.message));
  const clipA = await A.main.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(clipA === 'copied on the laptop', 'the laptop’s clipboard arrived on the desk');

  // ---- the relay, when the local network is not an option
  require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../../core/link/relay.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(ROOT, 'relay.cjs'), logLevel: 'silent' });
  const { RelayServer } = require(path.join(ROOT, 'relay.cjs'));
  const relay = new RelayServer();
  const rs = http.createServer((q, r) => { if (!relay.handleHttp(q, r)) { r.writeHead(404); r.end(); } });
  relay.attach(rs);
  await new Promise((r) => rs.listen(0, '127.0.0.1', r));
  const relayUrl = `http://127.0.0.1:${rs.address().port}`;
  await api(A.main, 'link.setSettings', { mode: 'internet', relayUrl, mailbox: '' });
  await api(B.main, 'link.setSettings', { mode: 'internet', relayUrl, mailbox: '' });
  const both = await until(async () => relay.listeners.size === 2, 10000);
  check(!!both, 'both apps keep a connection to the relay');
  await openDevices(A.main);
  await A.main.getByRole('tab', { name: 'Access from anywhere' }).first().click();
  await A.main.waitForTimeout(500);
  await shot(A.main, 'remote-access', false);
  await shot(A.main, 'remote-access', true);

  // ---- a phone, with no app: the companion page in an emulated iPhone browser
  await openDevices(A.main);
  await A.main.getByRole('button', { name: 'Phone', exact: true }).click();
  await A.main.getByRole('button', { name: /Show QR Code/ }).click();
  const url = await until(async () => A.main.locator('[data-testid=companion-url]').inputValue(), 8000);
  check(!!url && url.includes('/c/#k='), 'the phone QR code holds the page address and a one-time key');
  await shot(A.main, 'phone-qr', false);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await ctx.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  const local127 = url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${(await api(A.main, 'link.state')).me.port}`);
  await phone.goto(local127);
  const askShown = await until(async () => (await A.main.getByText('Allow this phone?').count()) > 0, 10000);
  check(!!askShown, 'the computer asks before letting the phone in');
  await shot(A.main, 'phone-allow', false);
  if (askShown) await A.main.getByRole('button', { name: 'Allow', exact: true }).click();
  const connected = await until(async () => (await phone.locator('#status').innerText()).includes('Connected'), 10000);
  check(!!connected, 'the phone page is connected and encrypted');
  check(!phone.url().includes('k='), 'the one-time key is removed from the phone’s address bar');
  const upload = path.join(ROOT, 'IMG_2041.HEIC');
  fs.writeFileSync(upload, crypto.randomBytes(1_100_000));
  await phone.setInputFiles('#pick', upload);
  const up = await until(async () => fs.existsSync(path.join(homes.a, 'Downloads/Keeper/IMG_2041.HEIC')) && fs.readFileSync(path.join(homes.a, 'Downloads/Keeper/IMG_2041.HEIC')).equals(fs.readFileSync(upload)), 15000);
  check(!!up, 'a 1.1 MB photo from the phone arrived intact');
  await phone.locator('nav button[data-tab=send]').click();
  await phone.screenshot({ path: `${SHOTS}/phone-send.png` });
  await phone.locator('nav button[data-tab=files]').click();
  const sharedOnPhone = await until(async () => (await phone.getByText('Photos').count()) > 0, 8000);
  check(!!sharedOnPhone, 'the phone sees the shared folders');
  await phone.screenshot({ path: `${SHOTS}/phone-files.png` });
  await A.main.evaluate(() => navigator.clipboard.writeText('from the desk')).catch(() => undefined);
  await phone.locator('#nav-more-btn').click();
  await phone.locator('nav button[data-tab=clip]').click();
  await phone.locator('#clip-get').click();
  const phoneClip = await until(async () => (await phone.locator('#clip').inputValue()) === 'from the desk', 6000);
  check(!!phoneClip, 'the phone reads the computer’s clipboard');
  // comes back without the QR code
  await phone.goto(local127.split('#')[0]);
  const again = await until(async () => (await phone.locator('#status').innerText()).includes('Connected'), 10000);
  check(!!again, 'the phone reconnects later with its own key, no QR needed');
  check(phoneErrors.length === 0, 'no errors on the phone page' + (phoneErrors.length ? ': ' + phoneErrors.join('; ') : ''));
  await browser.close();

  await openDevices(A.main);
  await shot(A.main, 'devices', false);
  await shot(A.main, 'devices', true);
  check(A.errors.length === 0 && B.errors.length === 0, 'no page errors' + [...A.errors, ...B.errors].map((e) => '\n  ' + e).join(''));
  await A.app.close();
  await B.app.close();
  relay.close();
  rs.close();
})().catch((e) => {
  console.log('FAIL', e.stack || e);
  process.exit(1);
});
