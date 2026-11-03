// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/focus-block.cjs /tmp/kfb-home /tmp/kfb-shots
// Drives the real Keeper app's Focus blocking: the page (lists, a site added,
// schedules, settings), a block started by hand that reaches the firewall's DNS
// filter (a blocked name gets no address; a pass lets it through), a Focus
// session that blocks its list and cannot be stopped in strict mode, the small
// window over a blocked app (through the test hook), and the browser
// extension's block page, in light and dark.

const { _electron } = require('playwright');
const dgram = require('dgram');
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
  const up = dgram.createSocket('udp4');
  up.on('message', (m, r) => up.send(answerA(m, '10.20.30.40'), r.port, r.address));
  await new Promise((r) => up.bind(0, '127.0.0.1', r));
  const upPort = up.address().port;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_FW_FAKE: '1', KEEPER_FOCUS_TEST: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, args]) => window.keeper[n][f](...args), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(500); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  // ---------------------------------------------------------------- off by default, then on
  check((await k('features', 'list')).find((f) => f.id === 'focusBlock')?.on === false, 'Focus blocking is off until switched on');
  await k('features', 'set', 'focusBlock', true);
  await k('features', 'set', 'focus', true);
  await wait(500);
  check(await main.locator('.sidebar [title="Focus Blocking"]').count() + await main.locator('.sidebar >> text=Focus Blocking').count() > 0, 'Focus Blocking has a sidebar entry once on');
  await navigate('blocking');
  await main.waitForSelector('[data-testid="focus-block-page"]', { timeout: 15000 });
  check(await main.locator('[data-testid="fb-list-social"]').count() === 1, 'starter lists are there (Social)');

  // ---------------------------------------------------------------- a site added in the interface is saved
  await main.locator('[data-testid="fb-add-site-social"]').fill('https://www.distracting.test/feed');
  await main.locator('[data-testid="fb-add-site-social"]').press('Enter');
  check(!!(await until(async () => (await main.locator('[data-testid="fb-list-social"] .chip:has-text("distracting.test")').count()) === 1)), 'a site typed as an address is added as its domain');
  const file = path.join(HOME, '.config', 'Keeper', 'focus-block.json');
  const saved = await until(() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } });
  check(!!saved && saved.lists.find((l) => l.id === 'social').sites.includes('distracting.test'), 'the list is saved in focus-block.json');
  await k('focusBlock', 'saveList', { id: 'games', name: 'Games', sites: ['games.test'], apps: ['Steam'] });
  await shot('focus-block-lists-light');

  // ---------------------------------------------------------------- a block by hand reaches the DNS filter
  await k('fw', 'setSettings', { customUpstreams: [{ id: 'local-test', name: 'Local test server', kind: 'udp', address: `127.0.0.1:${upPort}` }], upstream: 'local-test', dnsPort: 0 });
  const fw = await k('fw', 'setSettings', { dnsFilter: true });
  check(fw.dns.running, `the DNS filter runs on port ${fw.dns.port}`);
  check(firstA(await ask(fw.dns.port, 'www.distracting.test')) === '10.20.30.40', 'before the block the site resolves');
  await main.locator('[data-testid="fb-start-list"]').selectOption('social');
  await main.locator('[data-testid="fb-start-30"]').click();
  check(!!(await until(async () => /Blocking distractions/.test(await main.locator('[data-testid="fb-hero"]').innerText()))), 'the page says blocking is on');
  const blockedAnswer = await until(async () => { const a = firstA(await ask(fw.dns.port, 'www.distracting.test')); return a === null || a === '0.0.0.0' ? a ?? 'none' : null; });
  check(!!blockedAnswer, `during the block the DNS filter answers no address (${blockedAnswer})`);
  check(firstA(await ask(fw.dns.port, 'example.test')) === '10.20.30.40', 'other sites still resolve');
  const log = await k('fw', 'queryLog', 20);
  check(log.some((e) => /Focus blocking/.test(e.blockedBy ?? '')), 'the query log says Focus blocking stopped it');
  const isl = await k('island', 'state');
  check(isl.alerts.some((a) => /Blocking distractions/.test(a.title)), 'the Island says blocking started');
  await shot('focus-block-on-light');

  // A short visit (not strict): the site resolves again for a few minutes.
  const pass = await k('focusBlock', 'pass', 'distracting.test');
  check(pass.ok && pass.until > Date.now(), 'a short visit is granted');
  check(!!(await until(async () => firstA(await ask(fw.dns.port, 'www.distracting.test')) === '10.20.30.40')), 'during the visit the site resolves');
  let st = await k('focusBlock', 'stop');
  check(!st.block.on, 'Stop blocking ends a block started by hand');
  check(!!(await until(async () => firstA(await ask(fw.dns.port, 'www.distracting.test')) === '10.20.30.40')), 'after the block the site resolves');

  // ---------------------------------------------------------------- a Focus session in strict mode
  await k('settings', 'set', { focusBlock: { withFocus: true, strict: true, passMinutes: 5, waitSeconds: 10, closeApps: false } });
  await k('focusBlock', 'setFocusList', 'games');
  await k('island', 'focus', 'start', 25);
  st = await until(async () => { const s = await k('focusBlock', 'status'); return s.block.on ? s : null; });
  check(!!st && st.block.reasons.some((r) => r.kind === 'focus') && st.block.strict, 'a Focus session blocks its list, strictly');
  const strictPass = await k('focusBlock', 'pass', 'games.test');
  check(!strictPass.ok && /Strict mode/.test(strictPass.message), 'strict mode refuses a short visit');
  const stopErr = await main.evaluate(() => window.keeper.focusBlock.stop().then(() => '', (e) => String(e.message ?? e)));
  check(/Strict mode/.test(stopErr), 'strict mode refuses Stop blocking');
  const after = await k('island', 'focus', 'stop');
  check(after.mode === 'focus', 'strict mode keeps the Focus session running when Stop is pressed');
  await navigate('blocking');
  await wait(800);
  check(await main.locator('[data-testid="fb-stop"]').isDisabled(), 'the Stop button is disabled in strict mode');

  // The small window over a blocked app.
  await k('focusBlock', 'testFront', 'Steam');
  const bw = await until(() => app.windows().find((w) => w.url().includes('view=blocked')), 10000);
  check(!!bw, 'a blocked app coming to the front gets Keeper’s window over it');
  if (bw) {
    await bw.waitForSelector('[data-testid="fb-window"]', { timeout: 10000 }).catch(() => undefined);
    const txt = await bw.locator('[data-testid="fb-window"]').innerText().catch(() => '');
    check(/Steam can wait/.test(txt) && !/Let me in/.test(txt), `the window names the app and offers no short visit in strict mode (${txt.replace(/\s+/g, ' ').slice(0, 80)})`);
    await bw.screenshot({ path: path.join(SHOTS, 'focus-block-window-light.png') });
    await k('focusBlock', 'dismiss');
  }
  const counted = await k('focusBlock', 'status');
  check(counted.blockedToday >= 1, `blocked moments are counted (${counted.blockedToday})`);
  await shot('focus-block-strict-light');

  // ---------------------------------------------------------------- settings, schedules, dark
  await main.locator('.tab:has-text("Schedules"), [role="tab"]:has-text("Schedules")').first().click();
  await main.locator('[data-testid="fb-add-schedule"]').click();
  check(!!(await until(async () => (await main.locator('[data-testid="fb-schedule"]').count()) === 1)), 'a schedule is added');
  await shot('focus-block-schedules-light');
  await main.locator('.tab:has-text("Settings"), [role="tab"]:has-text("Settings")').first().click();
  await shot('focus-block-settings-light');
  await k('settings', 'set', { appearance: 'dark' });
  await main.locator('.tab:has-text("Lists"), [role="tab"]:has-text("Lists")').first().click();
  await shot('focus-block-strict-dark');
  await k('focusBlock', 'testFront', 'Steam');
  const bw2 = await until(() => app.windows().find((w) => w.url().includes('view=blocked')), 10000);
  if (bw2) { await wait(800); await bw2.screenshot({ path: path.join(SHOTS, 'focus-block-window-dark.png') }); await k('focusBlock', 'dismiss'); }

  // ---------------------------------------------------------------- the browser extension's block page
  // Its page with the browser's storage and messaging stood in for (light and dark follow the system).
  const ext = path.resolve(__dirname, '../../browser-extension');
  const html = fs.readFileSync(path.join(ext, 'blocked.html'), 'utf8').replace('<script src="blocked.js"></script>', `<script>window.chrome = { storage: { local: { get: async () => ({ focusBlock: { sites: ['distracting.test'], until: Date.now() + 40 * 60000, strict: false, waitSeconds: 2, passMinutes: 5, why: 'Focus session' } }) }, onChanged: { addListener() {} } }, runtime: { sendMessage: async () => ({ ok: false, message: 'Keeper did not answer. Is it running?' }) } };</script><script src="${'file://' + path.join(ext, 'blocked.js')}"></script>`);
  const harness = path.join(HOME, 'blocked-harness.html');
  fs.writeFileSync(harness, html);
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ BrowserWindow }, f) => { const w = new BrowserWindow({ width: 1440, height: 900, show: true, title: 'block-page' }); void w.loadURL(`file://${f}?site=distracting.test&u=https://www.distracting.test/feed`); }, harness);
    const page = await until(() => app.windows().find((w) => w.url().includes('blocked-harness.html')), 10000);
    if (!page) { check(false, `the block page opens (${theme})`); continue; }
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForSelector('#pass:not([hidden])', { timeout: 5000 }).catch(() => undefined);
    const t = await page.locator('main').innerText();
    check(/distracting\.test/.test(t) && /Let me in for 5 minutes/.test(t) && /Focus session/.test(t), `the block page names the site and offers a short visit (${theme})`);
    if (theme === 'light') {
      await page.click('#pass');
      check(await page.locator('#confirm').isDisabled(), 'the short visit waits a few seconds first');
      check(!!(await until(async () => !(await page.locator('#confirm').isDisabled()), 5000)), 'then it can be confirmed');
      await page.click('#cancel');
    }
    await page.screenshot({ path: path.join(SHOTS, `focus-block-page-${theme}.png`) });
    await page.close();
  }

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  up.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
