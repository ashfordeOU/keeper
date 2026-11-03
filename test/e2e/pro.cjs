// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/pro.cjs /tmp/kpro /tmp/kpro-shots [--pro]
// Keeper Pro in the real app, against a stand-in for pro.json and the license
// server on this computer (KEEPER_PRO_CONFIG_URL, KEEPER_LICENSE_SERVER_URL,
// KEEPER_PRO_TEST_KEY: honoured only by unofficial builds).
//
// Without --pro (a normal build, Pro switched off): no Settings section, row,
// search result, palette entry, part or pill mentions it, every Settings section
// is free of it, keeper://license does nothing but open Keeper, and no request
// reaches the stand-in.
//
// With --pro (build with KEEPER_PRO=1 npm run build first): pro.json is read once,
// Settings → Account & Pro shows Keeper Free with See Pro, the upgrade sheet opens
// only when asked, a pasted license makes it Keeper Pro (the seat is counted), and
// Use on another computer removes it. Screenshots in light and dark, 1440×900.

const { _electron } = require('playwright');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PRO = process.argv.includes('--pro');
const args = process.argv.slice(2).filter((a) => a !== '--pro');
fs.mkdirSync(path.resolve(args[0]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(args[0]));
const SHOTS = path.resolve(args[1] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

// ---- a test signing key and the signed files, made the way the server makes them
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const b64url = (b) => Buffer.from(b).toString('base64url');
const signed = (purpose, body) => b64url(crypto.sign(null, Buffer.from(`${purpose}\n${body}`), privateKey));
const emailHash = (e) => crypto.createHash('sha256').update(`keeper-email-v1\n${e.trim().toLowerCase()}`).digest('hex');
function license(over = {}) {
  const body = b64url(JSON.stringify({ v: 1, id: 'lic_e2etest01', plan: 'pro', seats: 2, email: emailHash('ada@example.com'), iat: Date.now() - 1000, exp: Date.now() + 200 * 86400000, via: 'lemonsqueezy', ...over }));
  return `kpl1.${body}.${signed('keeper-license-v1', body)}`;
}
const CONFIG = (() => {
  const body = b64url(JSON.stringify({ v: 1, issued: Date.now() - 1000, enabled: true, rollout: 100, checkout: { provider: 'lemonsqueezy', pro: { month: 'https://ashforde.example/buy/1', year: 'https://ashforde.example/buy/2' }, team: { year: 'https://ashforde.example/buy/3' }, manage: 'https://ashforde.example/billing' } }));
  return JSON.stringify({ config: body, sig: signed('keeper-pro-config-v1', body) });
})();

// ---- the stand-in for keeper.ashforde.org/pro.json and the license server
const hits = [];
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    hits.push({ method: req.method, url: req.url, body: b });
    if (req.url === '/pro.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(CONFIG); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/v1/activate' ? { ok: true, used: 1, seats: 2 } : { ok: true }));
  });
});

const PRO_TEXT = /Keeper Pro|Account & Pro|See Pro|Upgrade|Restore purchase|Enter a license|What Pro adds/;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_PRO_CONFIG_URL: `${base}/pro.json`, KEEPER_LICENSE_SERVER_URL: base, KEEPER_PRO_TEST_KEY: PUB },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, as]) => window.keeper[n][f](...as), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const theme = async (dark) => { await k('settings', 'set', { appearance: dark ? 'dark' : 'light' }); await wait(600); };
  const shot = async (name) => { for (const dark of [false, true]) { await theme(dark); await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) }); } await theme(false); };
  const text = () => main.evaluate(() => document.body.innerText);

  if (!PRO) {
    // ================= Pro switched off: nothing anywhere, nothing sent
    check((await k('pro', 'status')).enabled === false, 'the app says Pro is off');
    await navigate('settings:general');
    await main.waitForSelector('[data-testid="settings-search"]', { timeout: 15000 });
    const sections = await main.locator('[data-testid^="settings-sec-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice('settings-sec-'.length)));
    check(sections.length >= 12 && !sections.includes('account'), `Settings has no Account & Pro section (${sections.join(', ')})`);
    const leaks = [];
    for (const s of sections) {
      await navigate(`settings:${s}`);
      await wait(700);
      // "More settings" open too, so Advanced rows are checked as well.
      for (const more of await main.locator('button:has-text("More settings")').all()) await more.click().catch(() => undefined);
      await wait(300);
      const t = await text();
      const m = t.match(PRO_TEXT);
      if (m) leaks.push(`${s}: ${m[0]}`);
      if (await main.locator('[data-testid^="pro-"]').count()) leaks.push(`${s}: a Pro element`);
    }
    check(leaks.length === 0, `no Settings section mentions Pro${leaks.length ? `: ${leaks.join('; ')}` : ''}`);
    await navigate('settings:account');
    await wait(800);
    check(await main.locator('[data-testid="pro-account"]').count() === 0 && await main.locator('[data-testid="settings-sec-general"][aria-current="page"]').count() === 1, 'a link to Account & Pro opens General instead');
    for (const q of ['pro', 'license', 'upgrade', 'subscription', 'restore purchase']) {
      await main.locator('[data-testid="settings-search"]').fill(q);
      await wait(400);
      const t = await text();
      check(!/Account & Pro|Your plan|What Pro adds/.test(t), `searching Settings for “${q}” finds nothing of Pro`);
    }
    await main.locator('[data-testid="settings-search"]').fill('');
    const parts = await k('features', 'list');
    check(!parts.some((f) => f.id === 'proAccount' && f.on), 'the Account & Pro part is off');
    await navigate('settings:features');
    await wait(800);
    check(!/Account & Pro/.test(await text()), 'Settings → Features does not list it');
    // The command palette.
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:palette'); } });
    await wait(600);
    await main.keyboard.type('license');
    await wait(600);
    check(!/Account & Pro|Your plan|Keeper Pro/.test(await text()), 'the command palette finds nothing of Pro');
    await main.keyboard.press('Escape');
    // Quick Search's own search of features and settings.
    const found = await k('search', 'everything', 'license').catch(() => []);
    check(!JSON.stringify(found).match(/Account & Pro|proAccount|Your plan/), 'Quick Search finds nothing of Pro');
    // keeper://license only opens Keeper.
    await app.evaluate(({ app: a }, url) => a.emit('open-url', { preventDefault() {} }, url), `keeper://license?token=${license()}`);
    await wait(1500);
    check(await main.locator('[data-testid="pro-account"]').count() === 0, 'keeper://license does not show anything of Pro');
    await wait(8000);
    check(hits.length === 0, `no request reached pro.json or the license server (${hits.map((h) => h.url).join(', ') || 'none'})`);
    await navigate('settings:general');
    await wait(600);
    await shot('pro-off-settings');
  } else {
    // ================= Pro switched on (built with KEEPER_PRO=1)
    const s0 = await until(async () => { const s = await k('pro', 'status'); return s.enabled && s.offered ? s : null; }, 20000);
    check(!!s0, 'the app says Pro is on and offered (the signed pro.json was read)');
    check(hits.filter((h) => h.url === '/pro.json').length === 1, `pro.json was read once (${hits.filter((h) => h.url === '/pro.json').length})`);
    await navigate('settings:account');
    await main.waitForSelector('[data-testid="pro-account"]', { timeout: 15000 });
    check((await main.locator('[data-testid="pro-plan"]').innerText()) === 'Keeper Free', 'the plan reads Keeper Free');
    check(await main.locator('[data-testid="pro-sheet"]').count() === 0, 'the upgrade sheet is closed until asked for');
    check(await main.locator('[data-testid="pro-catalog"] [data-testid="pro-pill"]').count() >= 5, 'What Pro adds lists the plans with pills');
    await shot('pro-account');
    await main.setViewportSize({ width: 1024, height: 768 });
    await main.screenshot({ path: path.join(SHOTS, 'pro-account-1024.png') });
    await main.setViewportSize({ width: 1440, height: 900 });
    await main.click('[data-testid="pro-see"]');
    await main.waitForSelector('[data-testid="pro-sheet"]');
    check(/Everything Keeper does today stays free/.test(await main.locator('[data-testid="pro-sheet"]').innerText()), 'the sheet says first that everything stays free');
    check(await main.locator('.pro-choice[aria-checked="true"]').count() === 1, 'one plan is chosen (Pro, yearly)');
    await shot('pro-sheet');
    await main.keyboard.press('Escape');
    await wait(300);
    check(await main.locator('[data-testid="pro-sheet"]').count() === 0, 'Esc closes the sheet');
    // A pasted license.
    await main.click('[data-testid="pro-enter"]');
    await main.locator('input[aria-label="License"]').fill('not a license');
    await main.click('[data-testid="pro-activate"]');
    await wait(800);
    check((await main.locator('[data-testid="pro-plan"]').innerText()) === 'Keeper Free', 'junk is refused');
    await main.locator('input[aria-label="License"]').fill(license());
    await main.click('[data-testid="pro-activate"]');
    check(!!(await until(async () => (await main.locator('[data-testid="pro-plan"]').innerText()) === 'Keeper Pro')), 'a pasted license makes it Keeper Pro');
    check(hits.some((h) => h.url === '/v1/activate' && JSON.parse(h.body).seat), 'the seat is counted with the install’s random reference');
    check(await main.locator('[data-testid="pro-manage"]').count() === 1, 'Manage subscription is the main action now');
    await wait(5000); // the toasts go first
    await shot('pro-licensed');
    await main.click('[data-testid="pro-remove"]');
    await main.click('[data-testid="pro-remove"]');
    check(!!(await until(async () => (await main.locator('[data-testid="pro-plan"]').innerText()) === 'Keeper Free')), 'Use on another computer removes it here');
    check(hits.some((h) => h.url === '/v1/deactivate'), 'the seat is freed');
    // keeper://license from the e-mail.
    await app.evaluate(({ app: a }, url) => a.emit('open-url', { preventDefault() {} }, url), `keeper://license?token=${license()}`);
    check(!!(await until(async () => (await k('pro', 'status')).plan === 'pro')), 'keeper://license?token=… turns it on');
    const ustats = await k('usageStats', 'status');
    check(ustats.next?.pings?.[0]?.usage?.plan === 'pro', 'usage stats carry the plan');
  }

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
