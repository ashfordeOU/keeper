// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/net.cjs /tmp/kp /tmp/kp-shots [app folder]
// Drives the real Keeper app: Network Activity must attribute connections to
// the right program and interface (one of Keeper's own and one from another
// process), the VPN page must load and judge the route, a WireGuard file must
// be read with its keys hidden, and reading must cost little while the page is
// open and nothing once it is closed.

const { _electron } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const HOME = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'kp-net-'));
const SHOTS = process.argv[3] || HOME;
const APP = process.argv[4] || path.resolve(__dirname, '../..');
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const stat = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return null; } };
const ticks = (pid) => { const s = stat(pid); if (!s) return 0; const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return Number(f[11]) + Number(f[12]); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(250); } return fn(); }
function tree(root) {
  const kids = new Map();
  for (const n of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    const s = stat(n); if (!s) continue;
    const pp = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]);
    kids.set(pp, [...(kids.get(pp) ?? []), Number(n)]);
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
  return out;
}

/** The address of the interface with the default route, so the test server is reached over a real interface, not loopback. */
function outsideAddress() {
  const r = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((f) => f[1] === '00000000');
  const iface = r?.[0] ?? Object.keys(os.networkInterfaces()).find((n) => n !== 'lo');
  const a = (os.networkInterfaces()[iface] ?? []).find((x) => x.family === 'IPv4');
  return { iface, address: a?.address };
}

(async () => {
  const out = outsideAddress();
  check(!!out.address, `test interface ${out.iface} has an address (${out.address})`);
  // A server on the real interface, and a separate program connected to it.
  const server = net.createServer((s) => { const t = setInterval(() => s.write(Buffer.alloc(32 * 1024)), 200); s.on('close', () => clearInterval(t)); s.on('error', () => undefined); s.resume(); });
  await new Promise((r) => server.listen(0, out.address, r));
  const port = server.address().port;
  const client = spawn(process.execPath, ['-e', `const s=require('net').connect(${port}, '${out.address}'); s.on('data',()=>{}); setInterval(()=>s.write('x'.repeat(4096)),300);`], { stdio: 'ignore' });

  const app = await _electron.launch({ executablePath: path.resolve(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) { main = app.windows().find((w) => w.url().includes('view=app')); if (!main) await wait(500); }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const electronPid = await app.evaluate(() => process.pid);

  // Keeper's own connection, made from its main process to the internet.
  const PUB = { address: '1.1.1.1', port: 443 };
  const reached = await app.evaluate(({}, a) => new Promise((res) => { const s = process.getBuiltinModule('net').connect(a.port, a.address); s.setTimeout(5000); s.on('connect', () => res(true)); s.on('error', () => res(false)); s.on('timeout', () => res(false)); global.__kpTestSock = s; }), PUB);
  await wait(800);

  // ---- the API on its own
  const s1 = await main.evaluate(() => window.keeper.net.sample());
  await wait(1200);
  const s = await main.evaluate(() => window.keeper.net.sample());
  if (reached) {
    const mine = s.flows.find((f) => f.pid === electronPid && f.remote === PUB.address && f.remotePort === PUB.port);
    check(!!mine && mine.app === 'Keeper', `Keeper's own internet connection is attributed to Keeper (pid ${electronPid}): ${mine ? `${mine.app} → ${mine.remote}:${mine.remotePort}` : 'missing'}`);
    check(mine && mine.iface === out.iface && mine.path === 'direct' && mine.scope === 'internet', `…leaving through ${mine?.iface} (expected ${out.iface}), direct, to the internet (${mine?.path}, ${mine?.scope})`);
  } else console.log('SKIP no direct internet connection here; Keeper\'s own connection not checked');
  const theirs = s.flows.find((f) => f.pid === client.pid && f.remotePort === port);
  const local = s.flows.find((f) => f.pid === client.pid && f.remotePort === port);
  check(!local || local.path === 'local', `a connection to this computer's own address counts as staying on it (${local?.path}, via ${local?.iface})`);
  check(!!theirs && theirs.app === 'node', `another program's connection is attributed to it (pid ${client.pid}, "${theirs?.app}")`);
  check(!!theirs && theirs.state === 'Established' && theirs.path !== 'vpn', `its state is right (${theirs?.state}, ${theirs?.path})`);
  const listen = s.flows.find((f) => f.localPort === port && f.scope === 'listening');
  check(!!listen && listen.pid === process.pid, `the test's listening server shows as listening, owned by the test runner (${listen?.pid} = ${process.pid})`);
  check(s.apps.some((a) => a.app === 'Keeper' && a.conns >= 1), 'apps view groups Keeper with its connections');
  const eth = s.ifaces.find((i) => i.name === out.iface);
  check(!!eth && typeof eth.rxRate === 'number', `interface ${out.iface} has a measured rate (${eth?.rxRate?.toFixed(0)} B/s in)`);
  check(['connection', 'interface'].includes(s.amounts), `amounts reported honestly: "${s.amounts}"${s.notes.length ? ' — ' + s.notes.join(' ') : ''}`);
  void s1;

  const csv = await app.evaluate(async ({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    return file;
  }, path.join(HOME, 'connections.csv'));
  const saved = await main.evaluate(() => window.keeper.net.exportCsv());
  check(saved === csv && fs.readFileSync(csv, 'utf8').split('\n')[0].startsWith('app,pid,protocol'), 'Export writes a CSV with a header');

  // ---- VPN status and a WireGuard file
  const v = await main.evaluate(() => window.keeper.net.vpnStatus());
  const hasNm = fs.existsSync('/usr/bin/nmcli') || fs.existsSync('/bin/nmcli');
  check(hasNm ? Array.isArray(v.vpns) : v.notes.some((n) => /NetworkManager/.test(n)), hasNm ? `VPN list from NetworkManager (${v.vpns.length})` : `no NetworkManager here, and the page says so: "${v.notes[0]}"`);
  check(v.verdict && !v.verdict.vpnUp && v.verdict.v4Iface === out.iface && /No VPN/.test(v.verdict.summary), `route verdict: "${v.verdict?.summary}"`);
  const key = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
  const prev = await main.evaluate((k) => window.keeper.net.importText(`[Interface]\nPrivateKey = ${k}\nAddress = 10.9.0.2/32\n[Peer]\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = vpn.example.org:51820\n`, 'trip.conf'), key);
  check(!JSON.stringify(prev).includes(key) && prev.summary.redacted.includes('(hidden)') && prev.summary.fullTunnel && prev.summary.coversV6, 'WireGuard file read: full tunnel incl. IPv6, private key never sent to the page');

  // ---- countries and networks: the real download and table build, from a local copy of the DB-IP files
  if (process.env.KEEPER_GEO_FEED) {
    const t0 = Date.now();
    await main.evaluate(() => window.keeper.net.geoDownload());
    const g = await until(async () => { const x = await main.evaluate(() => window.keeper.net.geoStatus()); return x.state === 'ready' || x.state === 'error' ? x : null; }, 120_000);
    check(g && g.state === 'ready' && g.ranges > 100_000, `country table built in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${g?.state} ${g?.ranges ?? ''} ${g?.message ?? ''}`);
    const files = ['countries.bin', 'networks.bin'].map((f) => { try { return fs.statSync(path.join(HOME, '.config', 'Keeper', 'network', f)).size; } catch { return 0; } });
    console.log(`INFO tables on disk: ${files.map((b) => (b / 1e6).toFixed(1) + ' MB').join(', ')}`);
    if (reached) {
      const s2 = await main.evaluate(() => window.keeper.net.sample());
      const f = s2.flows.find((x) => x.remote === '1.1.1.1');
      check(f && f.country && /AS13335/.test(f.asn ?? ''), `1.1.1.1 gets a country and network: ${f?.country} · ${f?.asn}`);
    }
  } else console.log('SKIP KEEPER_GEO_FEED not set; the country download was not exercised');

  // ---- the pages
  await main.locator('.sidebar [title="Privacy & Security"]').click(); await main.locator('[data-testid="hub-tab-netactivity"]').click();
  await main.locator('.net-row.apps').first().waitFor({ timeout: 15_000 });
  await main.waitForTimeout(2500);
  const pageText = await main.locator('.content').innerText();
  check(/Keeper/.test(pageText) && /node/.test(pageText), 'Network Activity lists Keeper and the other program');
  await main.screenshot({ path: `${SHOTS}/linux-apps.png` });
  await main.locator('.net-row.apps', { hasText: 'node' }).first().click();
  await main.waitForTimeout(800);
  const sub = await main.locator('.net-sub').innerText().catch(() => '');
  check(sub.includes(String(port)), 'opening an app shows where it connects');
  await main.locator('button[role=tab]', { hasText: 'Connections' }).click();
  await main.waitForTimeout(2200);
  await main.screenshot({ path: `${SHOTS}/linux-connections.png` });
  await main.locator('button[role=tab]', { hasText: 'Health' }).click();
  await main.waitForTimeout(7000);
  const health = await main.locator('.net-health').innerText().catch(() => '');
  check(/Interfaces/.test(health) && health.includes(out.iface), 'Health shows the interfaces');
  await main.screenshot({ path: `${SHOTS}/linux-health.png` });
  await main.locator('.sidebar [title="Privacy & Security"]').click(); await main.locator('[data-testid="hub-tab-vpn"]').click();
  await main.waitForTimeout(2000);
  const vt = await main.locator('.content').innerText();
  check(/Not connected to a VPN/.test(vt), 'VPN page loads and says no VPN is connected');
  await main.screenshot({ path: `${SHOTS}/linux-vpn.png` });

  // ---- cost: reading every 2 s with the page open, against the app on Home
  const measure = async (ms) => {
    const pids = tree(electronPid);
    const a = pids.map(ticks);
    const t = Date.now();
    await main.waitForTimeout(ms);
    const b = pids.map(ticks);
    const pct = (i) => ((b[i] - a[i]) / 100) / ((Date.now() - t) / 1000) * 100;
    return { main: pct(0), all: pids.reduce((x, _, i) => x + pct(i), 0) };
  };
  await main.evaluate(() => localStorage.setItem('net.tab', '"apps"'));
  await main.locator('.sidebar [title="Privacy & Security"]').click(); await main.locator('[data-testid="hub-tab-netactivity"]').click();
  await main.waitForTimeout(3000);
  const open = await measure(20_000);
  await main.locator('.sidebar [title="Hello"]').click();
  await main.waitForTimeout(3000);
  const idle = await measure(20_000);
  const f = (x) => x.toFixed(2);
  console.log(`INFO ${os.cpus().length} cores, software drawing (no GPU), ${s.flows.length} sockets`);
  console.log(`INFO main process above idle: ${f(open.main - idle.main)}% of one core; whole app above idle: ${f(open.all - idle.all)}% of one core`);
  check(open.main - idle.main < 2, 'reading connections every 2 s costs under 2% of one core');
  check(idle.main < 3, `with the page closed the main process is quiet (${f(idle.main)}% of one core)`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  client.kill();
  server.close();
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
