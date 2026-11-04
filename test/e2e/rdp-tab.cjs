// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, after npm run build and node scripts/fetch-ironrdp.mjs):
//   xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/rdp-tab.cjs /tmp/krdp-home /tmp/krdp-shots
// Remote Desktop in a Keeper tab, end to end, as a core install would run it:
//  - the engine (IronRDP) is not inside: it is served as the downloadable component
//    "ironrdp" from a local release made by scripts/components.mjs, and downloaded
//    (checked against SHA256SUMS.txt) only when the first RDP tab needs it;
//  - a stand-in RDP server on this computer (no real one can run here): it answers the
//    X.224 request, does TLS with its own certificate, and records what arrives;
//  - first connection: the certificate question with its SHA-1 and SHA-256, Trust,
//    then the user name and password; the tab shows "Getting it ready" with progress;
//  - the real engine then loads from keeper-engine://, opens its WebSocket to Keeper's
//    relay, and its Network Level Authentication (CredSSP, NTLM) reaches the stand-in
//    over TLS: the whole path up to the point where a real Windows computer would answer;
//  - the stand-in hangs up: the tab says so, with Reconnect; the certificate is now pinned;
//  - the outside app: Remote Desktop in a tab switched off, and a connection with a
//    Remote Desktop Gateway, open in FreeRDP with the reason;
//  - the engine cannot be downloaded (release gone): the tab falls back to the outside app.
// Light and dark at 1440×900 (and the tab at 1024×768).

const { _electron } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const tls = require('tls');
const { pathToFileURL } = require('url');

fs.mkdirSync(path.resolve(process.argv[2] || '/tmp/krdp-home'), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2] || '/tmp/krdp-home'));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const APP = path.resolve(__dirname, '../..');
const VERSION = require(path.join(APP, 'package.json')).version;
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(200); } return null; }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// The stand-in's certificate (the same one the unit tests use), and what Keeper should show for it.
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgMCWyRlQn9j+C5XlK
iSKpMTmytF23+tFuPKDW/MfApVWhRANCAARwxlgnHbiMWwB26iTY98htBYg7PYQt
jhaFeiNwfPYUlGoOtM1Xf63luHTOoZh7HEe/3c0KE5kaISM2CZFmK3T4
-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIBljCCATugAwIBAgIUTD4Ii1ckx1uv3tNnm+9cxHCaWiEwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJZGVzay50ZXN0MCAXDTI2MTEwNDAzMDIzM1oYDzIxMjYxMDEx
MDMwMjMzWjAUMRIwEAYDVQQDDAlkZXNrLnRlc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARwxlgnHbiMWwB26iTY98htBYg7PYQtjhaFeiNwfPYUlGoOtM1Xf63l
uHTOoZh7HEe/3c0KE5kaISM2CZFmK3T4o2kwZzAdBgNVHQ4EFgQUYhJiXJ4gwoas
8XEusxEmjoh/MR0wHwYDVR0jBBgwFoAUYhJiXJ4gwoas8XEusxEmjoh/MR0wDwYD
VR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglkZXNrLnRlc3QwCgYIKoZIzj0EAwID
SQAwRgIhAMTpsa3r6Z44rMk/qlcspyDllDctMXpuBll7bT3HxNMzAiEAvp8FbLcY
HsTxtn6eg6Ho22iU8FomCV4iMaFfQVJ8TT8=
-----END CERTIFICATE-----`;
const CERT_SHA256 = 'EE:39:59:F6:10:AB:55:E7:BE:3F:AC:9E:3B:0B:66:1F:86:0B:C4:45:D0:7F:C6:64:D1:20:26:A2:17:99:CC:CD';
const CERT_PIN = `sha256/${Buffer.from(CERT_SHA256.replace(/:/g, ''), 'hex').toString('base64')}`;

/** The stand-in: X.224 confirm (HYBRID), TLS, then it records the first message and hangs up a moment later. */
function standIn() {
  const seen = { requests: [], tls: [], tlsStarts: 0 };
  const srv = net.createServer((s) => {
    s.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 4 || buf.length < buf.readUInt16BE(2)) return;
      s.off('data', onData);
      seen.requests.push(buf.subarray(0, buf.readUInt16BE(2)));
      s.write(Buffer.from([3, 0, 0, 19, 14, 0xd0, 0, 0, 0x12, 0x34, 0, 2, 0x1f, 8, 0, 2, 0, 0, 0]));
      const t = new tls.TLSSocket(s, { isServer: true, key: KEY, cert: CERT });
      t.on('error', () => undefined);
      seen.tlsStarts++;
      t.on('data', (x) => { seen.tls.push(x); setTimeout(() => t.destroy(), 300); });
    };
    s.on('data', onData);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ port: srv.address().port, seen, close: () => srv.close() })));
}

(async () => {
  // ---- a release holding only the Remote Desktop engine, as the release workflow packs it
  const vendor = path.join(APP, 'vendor', 'ironrdp', 'current');
  if (!fs.existsSync(path.join(vendor, 'iron-remote-desktop-rdp.js'))) { console.log('FAIL run node scripts/fetch-ironrdp.mjs first'); process.exit(1); }
  const { packComponents } = await import(pathToFileURL(path.join(APP, 'scripts', 'components.mjs')).href);
  const work = path.join(HOME, '.release');
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(vendor, path.join(work, 'staging', 'ironrdp'), { recursive: true });
  const rel = path.join(work, `v${VERSION}`);
  const m = packComponents({ staging: path.join(work, 'staging'), platform: process.platform, arch: process.arch, version: VERSION, out: rel, log: () => undefined });
  fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), fs.readdirSync(rel).map((f) => `${sha(fs.readFileSync(path.join(rel, f)))}  ${f}`).join('\n') + '\n');
  fs.rmSync(path.join(work, 'staging'), { recursive: true, force: true });
  const entry = m.components[0];
  console.log(`  release asset ${entry.file}: ${entry.size} bytes (${entry.unpackedSize} unpacked), sha256 ${entry.sha256}`);
  const served = [];
  let gone = false;
  // Slow on purpose (about 4 s), so the tab's progress can be seen and pictured.
  const feedSrv = http.createServer(async (req, res) => {
    const file = path.join(work, decodeURIComponent(req.url.split('?')[0]));
    served.push(path.basename(file));
    if (gone || !file.startsWith(work) || !fs.existsSync(file)) return void res.writeHead(404).end();
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-length': body.length });
    if (body.length < 100_000) return void res.end(body);
    for (let i = 0; i < body.length; i += 64 * 1024) { res.write(body.subarray(i, i + 64 * 1024)); await wait(110); }
    res.end();
  });
  await new Promise((r) => feedSrv.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${feedSrv.address().port}`;
  const rdp = await standIn();

  const app = await _electron.launch({
    executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share',
      KEEPER_COMPONENTS_DEV: '0', KEEPER_COMPONENTS_FEED: feed, KEEPER_COMPONENTS_DELAY_MS: '600000' },
  });
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (g, f, ...a) => main.evaluate(([gg, ff, args]) => window.keeper[gg][ff](...args), [g, f, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name, el) => { await wait(700); await (el ?? main).screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const both = async (name) => { await shot(`${name}-light`); await dark(true); await shot(`${name}-dark`); await dark(false); };
  const engineInfo = async () => (await k('components', 'list')).find((c) => c.id === 'ironrdp');

  check((await engineInfo())?.state === 'missing', 'the engine is not inside a core install');
  check(!served.length, 'nothing was downloaded while Keeper started');

  const conn = await k('rdc', 'save', { name: 'Office PC', protocol: 'rdp', host: '127.0.0.1', port: rdp.port, user: 'ana', domain: 'WORK', folder: 'Work' });
  await navigate('rdc');
  await main.waitForSelector('[data-testid="rdc-card"]', { timeout: 15000 });

  // ---- the editor: where it opens, and what only the outside app does
  await main.locator('[data-testid="rdc-card"]').first().getByRole('button', { name: 'Edit' }).click();
  await main.waitForSelector('[data-testid="rdc-rdp-where"]', { timeout: 5000 });
  check(await main.locator('[data-testid="rdc-rdp-where"] button.on').textContent() === 'A Keeper tab', 'a new RDP connection opens in a Keeper tab');
  await main.locator('.modal input.mono[placeholder="rdg.example.com"]').fill('rdg.example.com');
  const limits = await main.locator('[data-testid="rdc-rdp-limits"]').textContent({ timeout: 3000 }).catch(() => '');
  check(/Gateway needs the outside app/.test(limits || ''), `the editor says what needs the outside app: “${limits}”`);
  await shot('rdp-editor-light', main.locator('.modal').first());
  await main.locator('.modal input.mono[placeholder="rdg.example.com"]').fill('');
  await main.getByRole('button', { name: 'Cancel' }).click();

  // ---- first connection: the certificate question
  await main.locator('[data-testid="rdc-card"]').first().getByRole('button', { name: 'Connect' }).click();
  await main.waitForSelector('[data-testid="rdc-certq"]', { timeout: 15000 });
  const fp = await main.locator('[data-testid="rdc-cert-fingerprint"]').textContent();
  check(fp.includes(CERT_SHA256) && /SHA-1/.test(fp) && fp.includes('desk.test'), 'the first connection shows the certificate’s name, SHA-1 and SHA-256');
  check(rdp.seen.requests.length === 1 && rdp.seen.tlsStarts === 1, 'Keeper read the certificate with one X.224 and TLS opening');
  await both('rdp-cert');
  await main.getByRole('button', { name: 'Trust and Connect' }).click();
  // No keychain in this test home: the password is asked.
  await main.waitForSelector('[data-testid="rdc-password"]', { timeout: 10000 });
  await main.fill('[data-testid="rdc-password"]', 'correct horse');
  await main.getByRole('button', { name: 'Connect', exact: true }).last().click();

  // ---- the tab: getting the engine, with progress
  await main.waitForSelector('[data-testid="rdc-rdp"]', { timeout: 15000 });
  const ready = await until(() => main.$('[data-testid="rdp-engine"]'), 10000);
  check(!!ready, 'the tab shows “Getting it ready” while the engine downloads');
  if (ready) await both('rdp-ready');
  const installed = await until(async () => (await engineInfo())?.state === 'installed', 60000);
  check(!!installed, 'the engine was downloaded, checked against SHA256SUMS.txt and installed');
  check(served.includes('SHA256SUMS.txt') && served.includes(entry.file), `served: ${[...new Set(served)].join(', ')}`);
  const comp = await k('components', 'check', 'ironrdp');
  check(comp.ok && comp.source === 'installed' && comp.path.includes(path.join('components', 'ironrdp', VERSION)), `the tab uses the downloaded copy: ${comp.output}`);

  // ---- the engine signs in through the relay, over TLS, to the stand-in
  const reached = await until(() => rdp.seen.tls.length > 0, 30000);
  const first = reached ? Buffer.concat(rdp.seen.tls) : Buffer.alloc(0);
  check(rdp.seen.requests.length >= 2 && rdp.seen.tlsStarts >= 2, 'the engine’s X.224 request reached the computer and TLS was set up by the relay');
  const cr = rdp.seen.requests[rdp.seen.requests.length - 1];
  check(cr[5] === 0xe0 && (cr[cr.length - 4] & 2) === 2, 'the engine asked for Network Level Authentication (CredSSP)');
  check(first[0] === 0x30 && first.includes(Buffer.from('NTLMSSP\0')), 'its CredSSP sign-in (NTLM) arrived at the computer through the relay, inside TLS');
  const ended = await until(() => main.$('[data-testid="rdc-rdp"][data-phase="ended"]'), 20000);
  check(!!ended, 'when the computer hangs up, the tab says so and offers Reconnect');
  const endText = await main.locator('[data-testid="rdp-ended"] .fr-line').textContent().catch(() => '');
  check(/closed the connection/.test(endText || '') && !/@|\.rs/.test(endText || ''), `in plain words: “${endText}”`);
  if (ended) await both('rdp-ended');
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await shot('rdp-ended-light-1024');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const st = await k('rdc', 'state');
  check(st.connections.find((c) => c.id === conn.id)?.rdp?.pin === CERT_PIN, 'the trusted certificate is pinned to this connection');
  check(st.sessions.some((s) => s.protocol === 'rdp' && s.kind === 'inapp'), 'the session is listed as in Keeper');

  // ---- Reconnect: no question this time (the pin matches), straight to the computer
  const before = rdp.seen.tls.length;
  await main.locator('[data-testid="rdp-reconnect"]').click();
  check(!!(await until(() => rdp.seen.tls.length > before, 20000)), 'Reconnect goes straight to the computer with the pinned certificate');
  await until(() => main.$('[data-testid="rdc-rdp"][data-phase="ended"]'), 20000);
  for (const s of (await k('rdc', 'state')).sessions) await k('rdc', 'disconnect', s.id);

  // ---- the outside app: switched off in Where it appears, and for a Remote Desktop Gateway
  await navigate('rdc:places');
  await main.waitForSelector('[data-testid="rdc-place-rdp"]', { timeout: 10000 });
  await both('rdp-places');
  await k('rdc', 'setPlaces', { rdpInTab: false });
  const off = await k('rdc', 'connect', conn.id, { password: 'x' });
  check(off.session?.kind === 'external' && /freerdp/.test(off.session.program ?? ''), `switched off: the outside app opens (${off.session?.program ?? off.message})`);
  await k('rdc', 'setPlaces', { rdpInTab: true });
  await k('rdc', 'save', { ...conn, rdp: { gateway: 'rdg.example.com', pin: CERT_PIN } });
  const viaGw = await k('rdc', 'connect', conn.id, { password: 'x' });
  // (FreeRDP then fails here: rdg.example.com does not exist. What counts is that it was the outside app, and why.)
  check(viaGw.session?.kind === 'external' && /^A Remote Desktop Gateway needs the outside app\./.test(viaGw.message ?? ''), `a Remote Desktop Gateway: the outside app, saying why (“${(viaGw.message ?? '').slice(0, 60)}…”)`);
  await k('rdc', 'save', { ...conn, rdp: { pin: CERT_PIN } });
  for (const s of (await k('rdc', 'state')).sessions) await k('rdc', 'disconnect', s.id);

  // ---- the engine cannot be had: the tab opens the outside app instead
  await k('components', 'remove', 'ironrdp');
  gone = true;
  const r = await k('rdc', 'connect', conn.id, { password: 'x' });
  check(r.route?.arg === 'rdp', 'with the engine gone, the connection still starts as a tab');
  await k('rdc', 'openRoute', r.route);
  const out = await until(() => main.$('[data-testid="rdc-rdp"][data-phase="outside"]'), 30000);
  check(!!out, 'the download fails, so the tab says it opened in the outside app');
  const ext = await until(async () => (await k('rdc', 'state')).sessions.find((s) => s.kind === 'external'), 10000);
  check(!!ext, `the outside app took over (${ext?.program ?? 'none'})`);
  if (out) await both('rdp-outside');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  for (const s of (await k('rdc', 'state')).sessions) await k('rdc', 'disconnect', s.id).catch(() => undefined);
  await app.close().catch(() => undefined);
  rdp.close();
  feedSrv.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
