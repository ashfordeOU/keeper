// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/crash-reports.cjs /tmp/kcr-home /tmp/kcr-shots
// Drives the real Keeper app's crash reports against a stand-in server on this
// computer (KEEPER_CRASH_URL): off by default and nothing collected while off;
// switched on in Settings → Privacy; an error in the main process and one in a
// window become reports with the error's name and cleaned stack frames, never the
// message, a folder or the user's name; "See what's sent" shows them field by
// field; they arrive together with no cookies; off deletes what was waiting.

const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
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
  const got = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: b }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, CI: '', KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_CRASH_URL: `${base}/v1/crash`, KEEPER_TELEMETRY_URL: `${base}/v1/ping`, XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(800); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const status = () => main.evaluate(() => window.keeper.crashReports.status());
  const user = os.userInfo().username;
  // A main-process error whose message and stack carry a folder and the user's name.
  const mainError = () => app.evaluate((_e, u) => {
    const e = new TypeError(`Cannot read 'x' of /home/${u}/Documents/Private plan.pdf`);
    e.stack = `TypeError: Cannot read 'x' of /home/${u}/Documents/Private plan.pdf\n    at readPlan (/home/${u}/apps/Keeper/resources/app.asar/dist-electron/main-Q1.mjs:120:7)\n    at ${u}Helper (/opt/x/main.cjs:5:5)\n    at async Promise.all (index 0)`;
    process.emit('uncaughtException', e);
  }, user);

  let s = await status();
  check(!s.on && !s.next, 'crash reports are off by default, with nothing waiting');
  await mainError();
  await wait(300);
  s = await status();
  check(!s.next && !fs.existsSync(path.join(HOME, '.config', 'Keeper', 'crash-reports.json')), 'while off, nothing is collected or written');

  // Settings → Privacy: the switch.
  await navigate('settings:privacy');
  await main.waitForSelector('[data-testid="crash-panel"]', { timeout: 15000 });
  await main.locator('[data-testid="crash-panel"] [role="switch"]').click();
  check(!!(await until(async () => (await status()).on)), 'switching it on in Settings → Privacy');

  await mainError();
  // A window error: a promise nobody caught in the main window.
  await main.evaluate(() => { Promise.reject(new RangeError('the secret name of a file')); });
  s = await until(async () => { const x = await status(); return x.next && x.next.reports.length >= 2 ? x : null; });
  check(!!s, 'an error in the main process and one in a window are both waiting');
  const reports = s ? s.next.reports : [];
  const mainR = reports.find((r) => r.process === 'main');
  const winR = reports.find((r) => r.process === 'window');
  check(mainR && mainR.kind === 'exception' && mainR.name === 'TypeError' && mainR.stack[0] === 'at readPlan (main-Q1.mjs:120:7)', `the main process's report has the error's name and a clean frame (${mainR && mainR.stack.join(' | ')})`);
  check(winR && winR.kind === 'window-error' && winR.name === 'RangeError', 'the window’s report has its error’s name');
  const text = JSON.stringify(s && s.next);
  check(!text.includes(user) && !/Private plan|secret name|Documents|\/home\//.test(text), 'no message, folder or user name in what waits');
  check(['version', 'channel', 'os', 'osVersion', 'arch', 'process', 'kind', 'name', 'stack', 'count', 'first', 'last'].join() === Object.keys(mainR || {}).join(), 'each report has exactly the documented fields');

  // See what's sent.
  await main.locator('[data-testid="crash-see"]').click();
  await main.waitForSelector('[data-testid="crash-next"]');
  check(/TypeError/.test(await main.locator('[data-testid="crash-next"]').innerText()), '“See what’s sent” shows the waiting reports field by field');
  await main.locator('[data-testid="crash-panel"]').scrollIntoViewIfNeeded();
  await shot('crash-light');
  await dark(true); await shot('crash-dark'); await dark(false);

  // They go out together.
  await main.evaluate(() => window.keeper.crashReports.sendNow());
  const sent = await until(() => got.find((g) => g.url === '/v1/crash'), 10000);
  check(!!sent, 'the reports arrive at the server together');
  const body = sent ? JSON.parse(sent.body) : null;
  check(body && body.v === 1 && Object.keys(body).join() === 'v,reports' && body.reports.length >= 2, 'one request with the waiting reports and nothing else');
  check(sent && !sent.headers.cookie && !sent.headers.authorization, 'no cookies or credentials are sent');
  s = await status();
  check(!s.next && s.last && s.last.body.reports.length >= 2, 'nothing waits after sending; the last send is kept to look at');

  // Off deletes what was waiting.
  await mainError();
  await until(async () => (await status()).next);
  await main.locator('[data-testid="crash-panel"] [role="switch"]').click();
  s = await until(async () => { const x = await status(); return !x.on ? x : null; });
  check(s && !s.next, 'switching it off deletes what was waiting');

  const others = errors.filter((m) => !/the secret name of a file/.test(m));
  check(others.length === 0, `no page errors besides the one made on purpose (${others.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
