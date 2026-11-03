// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/phone-alerts.cjs /tmp/kpa-home /tmp/kpa-shots
// Drives the real Keeper app's Phone Alerts page against a stand-in ntfy server
// and webhook on this computer: off until switched on, the first run, adding an
// ntfy topic through the sheet and its test arriving with a title and priority,
// a webhook with a secret that arrives as a bearer token but is never written to
// the settings, switching a channel off, removing one. Light and dark.

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
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { got.push({ url: req.url, headers: req.headers, body }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"x"}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

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
  const k = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.alerts[f](...args), [fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'phoneAlerts')?.on === false, 'Phone Alerts is off until switched on');
  await main.evaluate(() => window.keeper.features.set('phoneAlerts', true));
  await navigate('alerts');
  await main.waitForSelector('[data-testid="pa-first"]', { timeout: 15000 });
  check(/Alerts that find you/.test(await main.locator('[data-testid="pa-first"]').innerText()), 'the first run explains it with one main action');
  await shot('alerts-first-light');
  await dark(true); await shot('alerts-first-dark'); await dark(false);

  // Add an ntfy topic through the sheet, pointing at the stand-in server.
  await main.locator('[data-testid="pa-add"]').click();
  await main.waitForSelector('[data-testid="pa-sheet"]');
  check(await main.locator('[data-testid="pa-save-test"]').isDisabled(), 'Save waits for a topic');
  await main.locator('[data-testid="pa-topic"]').fill('keeper-e2e-topic');
  await main.locator('.pa-more summary').first().click();
  await main.locator('[data-testid="pa-server"]').fill(base);
  await main.locator('[data-testid="pa-src-fixit"]').click();
  await shot('alerts-sheet-light');
  await main.locator('[data-testid="pa-save-test"]').click();
  const ntfy = await until(() => got.find((g) => g.url === '/keeper-e2e-topic'));
  check(!!ntfy, 'the test reaches the ntfy topic');
  check(ntfy && ntfy.headers.title === 'Keeper can reach you here' && ntfy.headers.priority === 'default' && /test from Keeper/.test(ntfy.body), 'it carries a title, a normal priority and the text');
  check(ntfy && /^Keeper\/\d/.test(ntfy.headers['user-agent'] || ''), 'it names Keeper as the sender app');
  await main.waitForSelector('[data-testid="pa-card-ntfy"]');
  check(!!(await until(async () => /Delivered/.test(await main.locator('[data-testid="pa-card-ntfy"] [data-testid="pa-last"]').innerText()))), 'the card says it was delivered');
  const ov1 = await k('overview');
  check(ov1.channels[0].sources.includes('fixit') && ov1.channels[0].sources.includes('monitors'), 'the alerts chosen in the sheet are saved');

  // A webhook with a secret.
  const ov2 = await k('save', { id: '', kind: 'webhook', name: 'Home server', on: true, sources: ['backups'], url: `${base}/hook` }, 'very-secret-token-123');
  const hookId = ov2.channels.find((c) => c.kind === 'webhook').id;
  const r = await k('test', hookId);
  const hook = got.find((g) => g.url === '/hook');
  check(r.ok && hook && hook.headers.authorization === 'Bearer very-secret-token-123', 'the webhook gets the secret as a bearer token');
  check(hook && JSON.parse(hook.body).alerts[0].source === 'backups', 'the webhook gets JSON with each alert');
  const cfgDir = path.join(HOME, '.config');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/settings\.json$/.test(e.name)) files.push(p); } };
  walk(cfgDir);
  check(files.length > 0 && files.every((f) => !fs.readFileSync(f, 'utf8').includes('very-secret-token-123')), 'the secret is not in the settings file');
  check(ov2.channels.find((c) => c.id === hookId).hasSecret || ov2.memoryOnly, 'the secret is kept (keychain, or memory where there is none)');

  // A wrong telegram setup is refused with plain words.
  const bad = await main.evaluate(() => window.keeper.alerts.save({ id: '', kind: 'telegram', name: 'T', on: true, sources: [], chatId: 'x' }).then(() => '', (e) => e.message));
  check(/token/i.test(bad), `a Telegram channel without a token is refused ("${bad}")`);

  // Off sends nothing; remove.
  await main.locator('[data-testid="pa-card-webhook"] [role="switch"]').click();
  check(!!(await until(async () => (await k('overview')).channels.find((c) => c.id === hookId).on === false)), 'a channel can be switched off from its card');
  await shot('alerts-list-light');
  await dark(true); await shot('alerts-list-dark');
  await main.setViewportSize({ width: 1024, height: 768 }); await shot('alerts-list-dark-1024'); await main.setViewportSize({ width: 1440, height: 900 });
  await dark(false);
  const ov3 = await k('remove', hookId);
  check(ov3.channels.length === 1, 'a channel can be removed');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
