// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/usage-stats.cjs /tmp/kus /tmp/kus-shots
// Drives the real Keeper app's anonymous usage stats against a stand-in server
// on this computer (KEEPER_TELEMETRY_URL, honoured only by unofficial builds):
// the setup's stats choice with its viewer; with the switch on
// exactly one report arrives and it matches the allowlist; after switching it
// off nothing more is sent; with KEEPER_TELEMETRY=0 nothing is sent at all; and
// Settings → Privacy shows the report. Screenshots in light and dark, plus the
// server's dashboard with sample data.
const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '../..');
const BASE = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'kus'));
const SHOTS = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'kus-shots'));
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(BASE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const INTERVAL = 3000;

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}

// The allowlist, read from the one schema the app and the server share.
const SCHEMA_SRC = fs.readFileSync(path.join(APP, 'core/telemetry.ts'), 'utf8');
// Keeper Pro's fields (PRO_USAGE_SCHEMA) come after it and are sent only by builds with Pro switched on.
const ALLOWED = new Set([...SCHEMA_SRC.slice(SCHEMA_SRC.indexOf('export const USAGE_SCHEMA'), SCHEMA_SRC.indexOf('export const PRO_USAGE_SCHEMA')).matchAll(/^ {2}'?([a-zA-Z0-9.]+)'?: \{ rule:/gm)].map((m) => m[1]));
const PRIVATE = [/[\\/]/, /[^\s@]+@[^\s@]+/, /\b\d{1,3}(\.\d{1,3}){3}\b/, /[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*/i];
function problems(p) {
  const out = [];
  const seen = new Set();
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [kk, vv] of Object.entries(v)) { seen.add(`${k}.${kk}`); if (!ALLOWED.has(`${k}.${kk}`)) out.push(`unknown field ${k}.${kk}`); if (kk === 'pages') for (const pk of Object.keys(vv)) if (PRIVATE.some((re) => re.test(pk))) out.push(`page name ${pk}`); }
    else { seen.add(k); if (!ALLOWED.has(k)) out.push(`unknown field ${k}`); }
  }
  for (const a of ALLOWED) if (!seen.has(a)) out.push(`missing ${a}`);
  const strings = JSON.stringify(p).match(/"(?:[^"\\]|\\.)*"/g).map((s) => JSON.parse(s)).filter((s) => s !== p.id && !ALLOWED.has(s) && !['v', 'id', 'day', 'build', 'system', 'usage', 'health'].includes(s) && !/^[a-zA-Z]+$/.test(s));
  for (const s of strings) if (PRIVATE.some((re) => re.test(s))) out.push(`value looks private: ${s}`);
  return out;
}

// ---- the stand-in server
const pings = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/ping') {
      try { pings.push({ at: Date.now(), headers: req.headers, body: JSON.parse(body) }); } catch { pings.push({ at: Date.now(), bad: body }); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    } else { res.writeHead(404); res.end(); }
  });
});

async function launch(name, extraEnv) {
  fs.mkdirSync(path.join(BASE, name), { recursive: true });
  const home = fs.realpathSync(path.join(BASE, name));
  for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const env = { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: home, NODE_OPTIONS: '', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share', KEEPER_TELEMETRY_URL: `http://127.0.0.1:${server.address().port}/v1/ping`, KEEPER_TELEMETRY_INTERVAL_MS: String(INTERVAL), ...extraEnv };
  delete env.DO_NOT_TRACK;
  if (!extraEnv.KEEPER_TELEMETRY) delete env.KEEPER_TELEMETRY;
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  return { app, main, errors, home };
}

const navigate = (app, r) => app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) if (!/view=(island|widget|quick)/.test(w.webContents.getURL())) w.webContents.send('event:navigate', route); }, r);
const theme = async (main, dark) => { await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark); await wait(500); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  check(ALLOWED.size >= 25, `the allowlist has ${ALLOWED.size} fields`);

  // ================= on (the default)
  {
    const { app, main, errors } = await launch('on', {});
    // Setup: the usage stats choice under "Also", unticked until the person ticks it, with
    // "See what's sent" showing every field; ticking it and going through setup switches it on.
    await main.getByText('Welcome to Keeper').waitFor({ timeout: 10_000 });
    await main.click('[data-testid="setup-start"]');
    const box = main.locator('[data-testid="setup-also-usageStats"]');
    await box.waitFor({ timeout: 5000 });
    check(!(await box.isChecked()), 'setup offers usage stats, unticked until you tick it');
    await main.click('[data-testid="setup-see-stats"]');
    await main.waitForSelector('.tour-ustats-scroll [data-testid="ustats-next"]');
    check(await main.locator('.tour-ustats-scroll .ustats-row').count() >= ALLOWED.size, 'setup can show exactly what is sent, field by field');
    for (const dark of [false, true]) { await theme(main, dark); await main.screenshot({ path: path.join(SHOTS, `tour-viewer-${dark ? 'dark' : 'light'}.png`) }); }
    await theme(main, false);
    await box.check();
    await main.click('[data-testid="setup-continue"]');
    await main.waitForSelector('[data-testid="setup-later"], [data-testid="setup-approvals-next"]', { timeout: 20_000 });
    await main.click(await main.locator('[data-testid="setup-later"]').count() ? '[data-testid="setup-later"]' : '[data-testid="setup-approvals-next"]');
    await main.click('[data-testid="setup-connect-skip"]');
    await main.click('[data-testid="setup-done"]');
    const turnedOn = await until(async () => (await main.evaluate(() => window.keeper.usageStats.status())).on, 10_000);
    check(!!turnedOn, 'ticking it in setup switches usage stats on');

    // Exactly one report arrives, and it matches the allowlist.
    const got = await until(async () => (pings.length ? pings : null), 90_000, 500);
    check(!!got, `a report arrives at the stand-in server (${pings.length})`);
    await wait(INTERVAL * 4);
    check(pings.length === 1, `exactly one report arrives (${pings.length})`);
    const first = pings[0];
    const body = first?.body;
    check(body && Object.keys(body).join() === 'pings' && body.pings.length === 1, 'the request carries one day');
    const p = body?.pings?.[0];
    const bad = p ? problems(p) : ['no payload'];
    check(bad.length === 0, `the report has every allowlisted field and nothing else, with nothing that looks private${bad.length ? `: ${bad.join('; ')}` : ''}`);
    check(!first?.headers.cookie && !first?.headers.authorization, 'no cookies or credentials are sent');
    console.log('INFO report:', JSON.stringify(p));
    check(p?.build.official === false, 'this build reports itself as unofficial');
    check(p?.usage.features.includes('usageStats') && p?.usage.pages.home, 'features and pages are counted');

    // Settings → Privacy: the switch and the viewer, showing what was sent.
    await navigate(app, 'settings:privacy');
    await main.waitForSelector('[data-testid="ustats-panel"]');
    const st = await main.evaluate(() => window.keeper.usageStats.status());
    check(st.on && st.last && st.last.body.pings[0].id === p?.id, 'Settings knows the last report sent');
    check((await main.locator('[data-testid="ustats-id"]').innerText()) === p?.id, 'Settings shows the anonymous ID');
    await main.click('[data-testid="ustats-see"]');
    await main.waitForSelector('[data-testid="ustats-viewer"]');
    await main.getByRole('tab', { name: 'Last sent' }).click();
    await main.waitForSelector('[data-testid="ustats-last"]');
    const lastText = await main.locator('[data-testid="ustats-last"]').innerText();
    check(lastText.includes(p.id) && lastText.includes(p.system.cpu) && lastText.includes(p.build.version), 'the viewer shows the report that was sent');
    await main.locator('[data-testid="ustats-last"]').getByRole('button', { name: /exact text/ }).click();
    const raw = await main.locator('[data-testid="ustats-last-json"]').innerText();
    check(JSON.stringify(JSON.parse(raw)) === JSON.stringify(body), 'the exact text matches the request byte for byte (as JSON)');
    await main.getByRole('tab', { name: 'Next report' }).click();
    for (const dark of [false, true]) {
      await theme(main, dark);
      await main.locator('#privacy').scrollIntoViewIfNeeded();
      await main.evaluate(() => document.getElementById('privacy')?.scrollIntoView({ block: 'start' }));
      await wait(300);
      await main.screenshot({ path: path.join(SHOTS, `settings-viewer-${dark ? 'dark' : 'light'}.png`) });
    }
    await main.click('[data-testid="ustats-see"]');
    for (const dark of [false, true]) {
      await theme(main, dark);
      await main.evaluate(() => document.getElementById('privacy')?.scrollIntoView({ block: 'start' }));
      await wait(300);
      await main.screenshot({ path: path.join(SHOTS, `settings-${dark ? 'dark' : 'light'}.png`) });
    }
    await theme(main, false);

    // The firewall lists the connection like any other app's (its Settings tab).
    await navigate(app, 'firewall:settings');
    const fwCard = await until(async () => (await main.locator('[data-testid="ustats-conn"]').count()) > 0, 10_000);
    check(!!fwCard, 'the firewall lists Keeper’s usage stats connection');
    if (fwCard) await main.locator('[data-testid="ustats-conn"]').scrollIntoViewIfNeeded().catch(() => undefined);
    await main.screenshot({ path: path.join(SHOTS, 'firewall-own-connections-light.png') });

    // So does Privacy & Security → Connections.
    await navigate(app, 'protection:connections');
    const secCard = await until(async () => (await main.locator('[data-testid="ustats-conn"]').count()) > 0, 30_000, 500);
    check(!!secCard, 'Privacy & Security → Connections lists it too');
    if (secCard) await main.screenshot({ path: path.join(SHOTS, 'privacy-center-connections-light.png') });
    await navigate(app, 'firewall:settings');
    await until(async () => (await main.locator('[data-testid="ustats-conn"]').count()) > 0, 10_000);

    // Block it in the firewall: a new ID (which would send again) sends nothing while blocked.
    if (fwCard) {
      await main.click('[data-testid="ustats-block"]');
      const blocked = await until(async () => { const s = await main.evaluate(() => window.keeper.usageStats.status()); return s.blockedByFirewall ? s : null; });
      check(!!blocked, 'Block adds a firewall rule for the connection');
      const rules = (await main.evaluate(() => window.keeper.fw.status())).state.groups.flatMap((g) => g.rules);
      check(rules.some((r) => r.verdict === 'deny' && r.host === '=127.0.0.1'), 'the rule shows in the firewall’s rules like any other');
      await main.evaluate(() => window.keeper.usageStats.resetId());
      const tried = await until(async () => { const s = await main.evaluate(() => window.keeper.usageStats.status()); return /blocked/i.test(s.lastAttempt?.result ?? '') ? s : null; }, 60_000, 500);
      check(!!tried && pings.length === 1, `while blocked, nothing is sent (${tried?.lastAttempt?.result ?? 'no attempt'}; ${pings.length} report)`);
      await main.screenshot({ path: path.join(SHOTS, 'firewall-blocked-light.png') });
    }

    // Switch it off, then allow the connection again and reset the ID: nothing more is sent.
    await navigate(app, 'settings:privacy');
    await main.waitForSelector('[data-testid="ustats-panel"] button[role="switch"]');
    await main.click('[data-testid="ustats-panel"] button[role="switch"]');
    const off = await until(async () => { const s = await main.evaluate(() => window.keeper.usageStats.status()); return !s.on ? s : null; });
    check(!!off && off.offReason === 'switch', 'the switch turns it off');
    if (fwCard) await main.evaluate(() => window.keeper.usageStats.setBlocked(false));
    const features = await main.evaluate(() => window.keeper.features.list());
    check(features.find((f) => f.id === 'usageStats')?.on === false, 'Settings → Features shows it off too');
    await main.click('[data-testid="ustats-reset"]');
    const reset = await until(async () => { const s = await main.evaluate(() => window.keeper.usageStats.status()); return s.installId !== p.id ? s : null; });
    check(!!reset, 'Reset my anonymous ID makes a new ID');
    // Pages opened while off are not counted.
    await navigate(app, 'search');
    await wait(INTERVAL * 6);
    check(pings.length === 1, `after switching off, no more reports (${pings.length})`);
    const usage = await main.evaluate(() => window.keeper.usage.get());
    check(usage.checks.find((c) => c.name === 'usageStats.daily')?.everyMs === null, 'its regular check is stopped while off');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await app.close();
  }

  // ================= KEEPER_TELEMETRY=0
  {
    const before = pings.length;
    const { app, main, errors } = await launch('env-off', { KEEPER_TELEMETRY: '0' });
    await main.click('[data-testid="setup-skip"]', { timeout: 5000 }).catch(() => undefined);
    await navigate(app, 'settings:privacy');
    await main.waitForSelector('[data-testid="ustats-panel"]');
    const s = await main.evaluate(() => window.keeper.usageStats.status());
    check(!s.on && s.offReason === 'env' && s.locked, 'KEEPER_TELEMETRY=0 switches it off and the switch cannot turn it on');
    check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'usageStats')?.on === false, 'Settings → Features shows it off');
    check(await main.locator('[data-testid="ustats-locked"]').count() === 1 && (await main.locator('[data-testid="ustats-panel"]').innerText()).includes('KEEPER_TELEMETRY=0'), 'Settings says why it is off');
    await main.evaluate(() => document.getElementById('privacy')?.scrollIntoView({ block: 'start' }));
    await main.screenshot({ path: path.join(SHOTS, 'settings-env-off-light.png') });
    await wait(INTERVAL * 6);
    check(pings.length === before, `with KEEPER_TELEMETRY=0 nothing is sent at all (${pings.length - before})`);
    const usage = await main.evaluate(() => window.keeper.usage.get());
    check(!usage.checks.some((c) => c.name === 'usageStats.daily'), 'and no regular check is registered');
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

    // ================= the server's dashboard, with sample data
    for (const dark of [false, true]) {
      const file = path.join(SHOTS, `dashboard-${dark ? 'dark' : 'light'}.png`);
      const r = await app.evaluate(async ({ BrowserWindow }, { url }) => {
        const w = new BrowserWindow({ width: 1280, height: 1500, show: false, webPreferences: { offscreen: false } });
        await w.loadURL(url);
        await new Promise((r) => setTimeout(r, 800));
        const img = await w.webContents.capturePage();
        const n = await w.webContents.executeJavaScript('document.querySelectorAll(".bar").length');
        w.destroy();
        return { n, png: img.toPNG().toString('base64') };
      }, { url: `file://${path.join(APP, 'server/telemetry/dashboard/index.html')}?sample=1&theme=${dark ? 'dark' : 'light'}` }).catch((e) => { console.log('INFO dashboard:', e.message); return { n: 0 }; });
      if (r.png) fs.writeFileSync(file, Buffer.from(r.png, 'base64'));
      const ok = r.n;
      check(ok > 20, `the dashboard renders sample data (${dark ? 'dark' : 'light'}, ${ok} bars)`);
    }
    await app.close();
  }

  server.close();
  console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exitCode = 1; server.close(); });
