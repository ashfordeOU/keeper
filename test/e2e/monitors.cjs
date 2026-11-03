// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/monitors.cjs /tmp/kmo-home /tmp/kmo-shots
// Drives the real Keeper app's Monitors page against a small web server on this
// computer: off until switched on, the first run, importing a plain list, a
// website and a port checked and up, a word on the page added through the
// sheet, the site answering 503 twice → down, with the alert reaching a phone
// (a stand-in ntfy server), back up again, pausing, ping where the system has
// none says so plainly. Light and dark, 1440×900 and 1024×768.

const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

(async () => {
  let healthy = true;
  const pushed = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { pushed.push({ url: req.url, title: req.headers.title, priority: req.headers.priority, body: b }); res.end('{}'); }); return; }
    if (req.url === '/ok') { res.writeHead(healthy ? 200 : 503, { 'content-type': 'text/plain' }); return res.end(healthy ? 'fine' : 'down for maintenance'); }
    if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body><h1>Welcome to the shop</h1></body></html>'); }
    if (req.url === '/old') { res.writeHead(301, { location: '/page' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.monitors[f](...args), [fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(800); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const byName = async (n) => (await k('overview')).monitors.find((m) => m.name === n);

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'monitors')?.on === false, 'Monitors is off until switched on');
  check(!fs.existsSync(path.join(HOME, '.config', 'Keeper', 'monitors.json')), 'nothing is stored while it is off');
  await main.evaluate(() => window.keeper.features.set('monitors', true));
  await navigate('monitors');
  await main.waitForSelector('[data-testid="mo-first"]', { timeout: 15000 });
  await shot('monitors-first-light');
  await dark(true); await shot('monitors-first-dark'); await dark(false);

  // Phone alerts to a stand-in ntfy server, sent at once.
  await main.evaluate(() => window.keeper.features.set('phoneAlerts', true));
  await main.evaluate((b) => window.keeper.alerts.save({ id: '', kind: 'ntfy', name: 'Phone', on: true, sources: ['monitors'], server: b, topic: 'mon-e2e' }), base);
  await main.evaluate(() => window.keeper.alerts.setBatch(0));

  // Import a plain list.
  await main.locator('[data-testid="mo-import"]').first().click();
  await main.locator('[data-testid="mo-import-text"]').fill(`Shop, ${base}/ok\ntcp 127.0.0.1:${port}\nping 127.0.0.1\nnonsense line here`);
  check(/3 to add · 1 not understood/.test(await main.locator('[data-testid="mo-import-sheet"]').innerText()), 'the import sheet previews what it understood');
  await main.locator('[data-testid="mo-import-go"]').click();
  check(!!(await until(async () => (await byName('Shop'))?.rt.state === 'up' && (await byName(`127.0.0.1:${port}`))?.rt.state === 'up', 20000)), 'the imported website and port are checked and up');
  const shop = await byName('Shop');
  check(typeof shop.rt.last.ms === 'number' && shop.rt.last.status === 200, `a check keeps its response time and answer (${shop.rt.last.ms} ms, ${shop.rt.last.status})`);
  const pingMon = await until(async () => { const m = await byName('127.0.0.1'); return m && m.rt.last ? m : null; }, 20000);
  check(!!pingMon && (pingMon.rt.last.ok || (/Ping is not available/.test(pingMon.rt.last.message) && pingMon.rt.state === 'paused' && !pingMon.on)), `ping is checked, or is paused with a plain reason where the system has no ping (${pingMon && (pingMon.rt.last.message || 'up')})`);
  check(!pushed.some((p) => /127\.0\.0\.1 is down/.test(p.title || '')), 'no ping program is not reported as an outage');

  // A word on the page, added through the sheet (and a redirect followed).
  await main.locator('[data-testid="mo-add"]').first().click();
  await main.locator('[data-testid="mo-target"]').fill(`${base}/old`);
  await main.locator('[data-testid="mo-name"]').fill('Shop front');
  await main.locator('.xmore summary').click();
  await main.locator('[data-testid="mo-keyword"]').fill('Welcome');
  await main.locator('[data-testid="mo-save"]').click();
  check(!!(await until(async () => (await byName('Shop front'))?.rt.last?.ok === true, 15000)), 'a word on the page is found after following a redirect');

  // Down: two failed checks in a row; the alert reaches the phone.
  healthy = false;
  await k('checkNow', shop.id);
  check((await byName('Shop')).rt.state === 'up', 'one failed check is a blip, not an outage');
  await k('checkNow', shop.id);
  const down = await byName('Shop');
  check(down.rt.state === 'down' && /503/.test(down.rt.last.message), `two in a row make it down (${down.rt.last.message})`);
  const push = await until(() => pushed.find((p) => p.url === '/mon-e2e' && /Shop is down/.test(p.title || '')), 10000);
  check(!!push && push.priority === 'high' && /503/.test(push.body), 'the phone gets "Shop is down" with high priority');
  await main.locator('[data-testid="mo-row"]', { hasText: 'Shop' }).first().click();
  await main.waitForSelector('[data-testid="mo-detail"]');
  check(/Down for/.test(await main.locator('[data-testid="mo-state"]').innerText()), 'the panel says it is down and for how long');
  await shot('monitors-down-light');
  await dark(true); await shot('monitors-down-dark');
  await main.setViewportSize({ width: 1024, height: 768 }); await shot('monitors-down-dark-1024'); await main.setViewportSize({ width: 1440, height: 900 });
  await dark(false);

  // Back up.
  healthy = true;
  await k('checkNow', shop.id);
  check((await byName('Shop')).rt.state === 'up', 'one good check and it is up again');
  check(!!(await until(() => pushed.find((p) => /Shop is back up/.test(p.title || '')), 10000)), 'the phone hears it is back up');
  const d = await k('detail', shop.id);
  check(d.series.length === 48 && d.recent.length >= 4 && d.monitor.uptime24 < 100 && d.monitor.uptime24 > 0, `uptime and the chart come from the checks (${d.monitor.uptime24}%)`);
  await shot('monitors-up-light');

  // Pause.
  await main.locator('[data-testid="mo-detail"] [role="switch"]').click();
  check(!!(await until(async () => (await byName('Shop')).rt.state === 'paused')), 'a monitor can be paused from its panel');
  const text = await k('exportList');
  check(text.includes(`Shop, ${base}/ok`) && text.includes(`tcp 127.0.0.1:${port}`), 'the list can be copied in the same form');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
