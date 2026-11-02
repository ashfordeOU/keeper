// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/fw.cjs /tmp/kfw /tmp/kfw-shots [app folder]
// Drives the real Keeper app's firewall with a test enforcement backend
// (KEEPER_FW_FAKE: nothing on this computer is changed): the DNS filter on a
// high port answers through a local upstream and blocks a name added in the
// interface; an alert from a (test) blocked attempt is answered with Deny and
// becomes a rule that is applied; rules, history, map and Network Activity's
// Map tab render; the keeper command reads the firewall's state.

const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'kfw-')));
const SHOTS = path.resolve(process.argv[3] || HOME);
const APP = path.resolve(process.argv[4] || path.resolve(__dirname, '../..'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(200); } return fn(); }

/** A minimal DNS message: query and A-record answer. */
function query(name, id) {
  const head = Buffer.alloc(12); head.writeUInt16BE(id, 0); head.writeUInt16BE(0x0100, 2); head.writeUInt16BE(1, 4);
  const labels = Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0, 0, 1, 0, 1])]);
  return Buffer.concat([head, labels]);
}
function answerA(q, ip) {
  const head = Buffer.from(q.subarray(0, 12)); head.writeUInt16BE(0x8180, 2); head.writeUInt16BE(1, 6);
  const rr = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, ...ip.split('.').map(Number)]);
  return Buffer.concat([head, q.subarray(12), rr]);
}
const firstA = (m) => { const qd = 12 + m.subarray(12).indexOf(0) + 5; return m.readUInt16BE(6) ? [...m.subarray(qd + 12, qd + 16)].join('.') : null; };
function ask(port, name) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    const t = setTimeout(() => { s.close(); reject(new Error('no answer')); }, 4000);
    s.on('message', (m) => { clearTimeout(t); s.close(); resolve(m); });
    s.send(query(name, 4321), port, '127.0.0.1');
  });
}

(async () => {
  // A local "upstream" DNS server: every name is 10.20.30.40.
  const up = dgram.createSocket('udp4');
  let upstreamAsked = 0;
  up.on('message', (m, r) => { upstreamAsked++; up.send(answerA(m, '10.20.30.40'), r.port, r.address); });
  await new Promise((r) => up.bind(0, '127.0.0.1', r));
  const upPort = up.address().port;

  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_FW_FAKE: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) { main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }); if (!main) await wait(500); }
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  // A first-run tour may be showing; skip it.
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const fw = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.fw[f](...args), [fn, a]);

  // ---- DNS filter through a local upstream, a name blocked from the interface
  await fw('setSettings', { customUpstreams: [{ id: 'local-test', name: 'Local test server', kind: 'udp', address: `127.0.0.1:${upPort}` }], upstream: 'local-test', dnsPort: 0 });
  let s = await fw('setSettings', { dnsFilter: true });
  check(s.dns.running && s.dns.port > 1024, `DNS filter running on port ${s.dns.port}`);
  const okAns = firstA(await ask(s.dns.port, 'example.test'));
  check(okAns === '10.20.30.40' && upstreamAsked >= 1, `a normal name is answered through the upstream (${okAns})`);
  await main.click('.sidebar [title="Firewall"]');
  await main.waitForSelector('.fw-status');
  await main.click('.fw-tabs >> text=Blocklists & DNS');
  await main.fill('input[placeholder="example.com"]', 'blocked.test');
  await main.locator('input[placeholder="example.com"] + button').click();
  await wait(400);
  const blocked = firstA(await ask(s.dns.port, 'ads.blocked.test'));
  check(blocked === '0.0.0.0', `a domain blocked in the interface (and its subdomains) answers 0.0.0.0 (${blocked})`);
  await until(() => main.locator('.fw-log-row.blocked').count(), 6000);
  check(await main.locator('.fw-log-row.blocked').count() > 0, 'the query log shows the blocked question');
  await main.screenshot({ path: path.join(SHOTS, 'dns-light.png') });

  // ---- alert → Deny → rule applied
  await fw('setSettings', { enforce: true, alerts: true });
  await fw('testInject', { app: { path: '/usr/bin/curl' }, host: 'tracker.test', ip: '203.0.113.9', port: 443 });
  await main.click('.fw-tabs >> text=Overview');
  const card = await until(() => main.locator('.fw-alert').count(), 6000);
  check(card > 0, 'the alert appears: curl wants to connect to tracker.test');
  // Real connections in this machine can raise alerts too; use the test's.
  const mine = main.locator('.fw-alert', { hasText: 'tracker.test' });
  check(await until(() => mine.count(), 6000) > 0, 'the alert names the app and host');
  await main.screenshot({ path: path.join(SHOTS, 'alert-light.png') });
  await mine.first().locator('button:has-text("Deny")').click();
  s = await until(async () => { const x = await fw('status'); return x.state.groups[0].rules.some((r) => r.host === '=tracker.test' && r.verdict === 'deny') ? x : null; }, 6000);
  check(!!s, 'Deny made a rule: curl → tracker.test, port 443, deny');
  check(s && s.enforcement.active && /applied/i.test(s.enforcement.message ?? ''), `the rules were applied (${s?.enforcement.message})`);
  const nft = path.join(HOME, '.config', 'Keeper', 'firewall', 'fake-applied.nft');
  check(fs.existsSync(nft) && fs.readFileSync(nft, 'utf8').includes('table inet keeper'), 'the test backend received an nftables table');

  // ---- an address rule from the editor shows in the list and in nftables
  await main.click('.fw-tabs >> text=Rules');
  await main.click('button:has-text("New rule")');
  await main.fill('input[placeholder="203.0.113.7 or 10.0.0.0/8"]', '198.51.100.0/24');
  await main.fill('input[placeholder="any, 443, 8000-8080"]', '22');
  await main.click('.modal button:has-text("Save")');
  await until(() => fs.readFileSync(nft, 'utf8').includes('198.51.100.0/24'), 6000);
  check(fs.readFileSync(nft, 'utf8').includes('ip daddr 198.51.100.0/24 tcp dport 22'), 'an address rule from the editor reaches nftables');
  check((await main.locator('.fw-rule').allInnerTexts()).some((t) => t.includes('tracker.test')), 'the rules list shows the new rule');
  await main.click('button:has-text("Tidy up")');
  await main.waitForSelector('.fw-tidy');
  check(true, 'tidy up runs');
  await main.screenshot({ path: path.join(SHOTS, 'rules-light.png') });

  // ---- connections (list and map), history
  await main.click('.fw-tabs >> text=Connections');
  await main.waitForSelector('.search-box input');
  await main.click('.seg button:has-text("Map")');
  check(await main.locator('.world-map canvas').count() === 1, 'the connections map draws');
  await main.click('.fw-tabs >> text=History');
  await main.waitForSelector('.fw-chart');
  check(await main.locator('.fw-bar').count() > 100, 'the history chart has a day of minutes');

  // ---- Network Activity: the Map tab
  await main.evaluate(() => window.dispatchEvent(new CustomEvent('keeper:go', { detail: 'netactivity' })));
  const navNet = main.locator('.sidebar .nav-item', { hasText: /Network Activity|Network activity/ });
  if (await navNet.count()) await navNet.first().click();
  await wait(800);
  const mapTab = main.locator('[role=tab]:has-text("Map")');
  if (await mapTab.count()) { await mapTab.first().click(); await wait(600); }
  check(await main.locator('.net-map, .world-map').count() + await main.getByText('Countries are needed for the map').count() > 0, 'Network Activity has a Map tab (map, or the one-time country table offer)');

  // ---- the keeper command
  try {
    const out = execFileSync(process.execPath, [path.join(APP, 'dist-cli/keeper.cjs'), 'fw', 'status', '--json'], { env, encoding: 'utf8', timeout: 15_000 });
    const j = JSON.parse(out);
    check(j.enforcement?.active === true && j.dns?.running === true, 'keeper fw status reads the running app');
  } catch (e) { check(false, `keeper fw status: ${String(e.message).split('\n')[0]}`); }

  // ---- dark
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await main.click('.sidebar [title="Firewall"]');
  await main.click('.fw-tabs >> text=Overview');
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'overview-dark.png') });
  await main.click('.fw-tabs >> text=Rules');
  await wait(300);
  await main.screenshot({ path: path.join(SHOTS, 'rules-dark.png') });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  up.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
