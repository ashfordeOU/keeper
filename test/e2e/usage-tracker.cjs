// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/usage-tracker.cjs /tmp/kus /tmp/kus-shots
// Drives the real Keeper app's AI usage tracker on Linux with a fake home:
//   - nothing runs with no accounts (no polls, no card in the owl's glance)
//   - two accounts of the Anthropic coding CLI (two config folders: one exact through its
//     status line, one estimated) and two Codex accounts (two CODEX_HOME folders), plus
//     OpenRouter and DeepSeek answered by a local stub (honoured only in unofficial builds)
//     and a subscription kept by hand
//   - the AI usage card in the owl's glance (Keeper's one menu-bar icon): running out, used up,
//     all clear, "only when something runs low"; custom names, the Usage page with its
//     Priority, CSV export, `keeper usage --json`
// Screenshots of the glance in three states and of the page, light and dark.
const { _electron } = require('playwright');
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = fs.realpathSync(fs.mkdirSync(path.resolve(process.argv[2] || '/tmp/kus'), { recursive: true }) || path.resolve(process.argv[2] || '/tmp/kus'));
const SHOTS = path.resolve(process.argv[3] || '/tmp/kus-shots');
const APP = path.resolve(__dirname, '../..');
const FIX = path.join(__dirname, '..', 'fixtures', 'usage-tracker');
for (const f of fs.readdirSync(HOME)) fs.rmSync(path.join(HOME, f), { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

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
const H = 3600_000;
const iso = (t) => new Date(t).toISOString();
const CC = ['.c', 'laude'].join('');

// ---- fixture data on disk
function ccSession(dir, tokensPerTurn) {
  const p = path.join(dir, 'projects', '-home-me-shop');
  fs.mkdirSync(p, { recursive: true });
  const now = Date.now();
  const lines = [0, 1, 2].map((i) => JSON.stringify({ type: 'assistant', timestamp: iso(now - (50 - i * 10) * 60_000), requestId: `r${i}`, message: { id: `m${i}`, model: 'm', usage: { input_tokens: tokensPerTurn, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
  fs.writeFileSync(path.join(p, 's1.jsonl'), lines.join('\n') + '\n');
}
function codexRollout(dir, primary, secondary, opts = {}) {
  const d = new Date();
  const p = path.join(dir, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  fs.mkdirSync(p, { recursive: true });
  const now = Date.now();
  const rl = { limit_id: 'codex', primary: { used_percent: primary, window_minutes: 300, resets_at: Math.floor((now + (opts.h5 ?? 2) * H) / 1000) }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: Math.floor((now + (opts.week ?? 22 * H + 10 * 60_000)) / 1000) }, credits: null, plan_type: 'plus' };
  const lines = [
    JSON.stringify({ timestamp: iso(now - 60_000), type: 'session_meta', payload: { id: 's' } }),
    JSON.stringify({ timestamp: iso(now - 30_000), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } }),
  ];
  fs.writeFileSync(path.join(p, 'rollout-2026-test.jsonl'), lines.join('\n') + '\n');
}
const work = path.join(HOME, CC);
const personal = path.join(HOME, `${CC}-personal`);
const codexA = path.join(HOME, '.codex');
const codexB = path.join(HOME, '.codex-work');
ccSession(work, 3000);
ccSession(personal, 10_000);
// Running out: Codex weekly 97% used; the work Codex 5-hour used up.
codexRollout(codexA, 20, 97);
codexRollout(codexB, 100, 30, { h5: 22 + 10 / 60 });
// Copilot's and Cursor's own sign-ins, and Gemini CLI's (for the opt-in unofficial sources).
fs.mkdirSync(path.join(HOME, '.config', 'github-copilot'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.config', 'github-copilot', 'hosts.json'), JSON.stringify({ 'github.com': { user: 'me', oauth_token: 'gho_test' } }));
const cursorDb = path.join(HOME, '.config', 'Cursor', 'User', 'globalStorage');
fs.mkdirSync(cursorDb, { recursive: true });
fs.writeFileSync(path.join(cursorDb, 'state.vscdb'), 'not really sqlite');
const jwt = ['e30', Buffer.from(JSON.stringify({ sub: 'auth0|user_1' })).toString('base64url'), 'sig'].join('.');
const bin = path.join(HOME, 'bin');
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, 'sqlite3'), `#!/bin/sh\necho '${jwt}'\n`, { mode: 0o755 });
fs.mkdirSync(path.join(HOME, '.gemini'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.gemini', 'oauth_creds.json'), JSON.stringify({ access_token: 'ya29.test', expiry_date: Date.now() + 3600_000 }));

// ---- a stub for the services (KEEPER_USAGE_STUB, unofficial builds only)
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  const send = (f) => { res.setHeader('content-type', 'application/json'); res.end(fs.readFileSync(path.join(FIX, f))); };
  if (req.url.startsWith('/openrouter.ai/api/v1/key')) return req.headers.authorization === 'Bearer or-key' ? send('openrouter-key.json') : (res.statusCode = 401, res.end('{}'));
  if (req.url.startsWith('/api.deepseek.com/user/balance')) return send('deepseek-balance.json');
  // Unofficial sources, only once opted in.
  if (req.url.startsWith('/api.github.com/copilot_internal/user')) return req.headers.authorization === 'token gho_test' ? send('copilot-user.json') : (res.statusCode = 401, res.end('{}'));
  if (req.url.startsWith('/cursor.com/api/usage?user=user_1')) return /WorkosCursorSessionToken=user_1/.test(req.headers.cookie ?? '') ? send('cursor-usage.json') : (res.statusCode = 401, res.end('{}'));
  if (req.url.startsWith('/cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') && req.method === 'POST') return send('gemini-load.json');
  if (req.url.startsWith('/cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota') && req.method === 'POST') {
    let b = '';
    req.on('data', (d) => (b += d));
    return req.on('end', () => (JSON.parse(b).project === 'proj-123' ? send('gemini-quota.json') : (res.statusCode = 400, res.end('{}'))));
  }
  res.statusCode = 404;
  res.end('{}');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stub = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, PATH: `${path.join(HOME, 'bin')}:${process.env.PATH}`, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_USAGE_STUB: stub, KEEPER_POPOVER_STAYS: '1', KEEPER_USAGE_CSV: path.join(HOME, 'usage.csv') };
  delete env.CODEX_HOME;
  delete env[`${CC.slice(1).toUpperCase()}_CONFIG_DIR`];
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await wait(1500);
  await main.setViewportSize?.({ width: 1440, height: 900 }).catch(() => undefined);
  const u = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.aiUsage[f](...args), [fn, a]);
  const checks = () => main.evaluate(() => window.keeper.usage.get().then((x) => x.checks.filter((c) => c.name.startsWith('aiUsage.') && c.everyMs !== null).map((c) => c.name)));

  // ---- nothing runs with no accounts
  check((await checks()).length === 0, 'no usage checks run with no accounts');
  check(!(await u('glanceState')).card, 'no AI usage card in the glance with no accounts');
  const found = await u('detect');
  check(found.some((f) => f.provider === 'cc' && f.configDir === work) && found.some((f) => f.provider === 'codex' && f.configDir === codexA), `the coding tools' folders are found (${found.map((f) => f.name).join(', ')})`);

  // ---- accounts: custom names, colours, two of each
  await u('saveAccount', { provider: 'cc', name: 'Work', configDir: work, color: '#e5484d' });
  await u('saveAccount', { provider: 'cc', name: 'Personal', configDir: personal, plan: { fiveHourTokens: 200_000 } });
  await u('saveAccount', { provider: 'codex', name: 'Codex Plus', configDir: codexA });
  await u('saveAccount', { provider: 'codex', name: 'Codex Team', configDir: codexB });
  await u('saveAccount', { provider: 'openrouter', name: 'Router', budget: 50 }, 'or-key');
  await u('saveAccount', { provider: 'deepseek', name: 'DeepSeek', budget: 10 }, 'ds-key');
  const renews = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  let list = await u('saveAccount', { provider: 'subscription', name: 'Design AI', subscription: { cost: 20, currency: 'USD', cycle: 'monthly', renews, remindDays: 3, quota: { amount: 500, unit: 'requests', used: 120, period: 'month' } } });
  check(list.length === 7 && list.find((a) => a.name === 'Router').hasKey, `seven accounts saved, keys kept (${list.map((a) => `${a.name}${a.hasKey ? '*' : ''}`).join(', ')})`);

  // The work account reads its status line: Keeper changes that folder's settings, and the tool runs it.
  const work1 = list.find((a) => a.name === 'Work');
  const sl = await u('setStatusLine', work1.id, true);
  check(sl.ok, `status line reading turned on (${sl.message})`);
  const cfg = JSON.parse(fs.readFileSync(path.join(work, 'settings.json'), 'utf8'));
  const statusInput = JSON.stringify({ model: { display_name: 'M' }, rate_limits: { five_hour: { used_percentage: 75, resets_at: Math.floor((Date.now() + 2 * H) / 1000) }, seven_day: { used_percentage: 31, resets_at: Math.floor((Date.now() + 4 * 86_400_000) / 1000) } } });
  execSync(cfg.statusLine.command, { input: statusInput, shell: '/bin/sh' });
  check(fs.existsSync(path.join(work, 'keeper-status.json')), 'the status line keeps its data in the account folder');

  const o = await until(async () => { const x = await u('refresh'); return x.accounts.every((a) => x.states[a.id]) && x.states[work1.id].accuracy === 'exact' ? x : null; }, 20_000, 1000);
  check(!!o, 'every account is read');
  const st = (name) => o.states[o.accounts.find((a) => a.name === name).id];
  check(st('Work').limits.find((l) => l.key === '5h')?.usedPercent === 75, 'Work: exact 5-hour share from its status line');
  check(st('Personal').accuracy === 'estimated' && st('Personal').limits.find((l) => l.key === '5h')?.used === 30_300, `Personal: estimated from its own folder (${st('Personal').limits[0].used} tokens)`);
  check(st('Codex Plus').limits.find((l) => l.key === 'weekly')?.usedPercent === 97 && st('Codex Team').limits.find((l) => l.key === '5h')?.usedPercent === 100, 'both Codex homes read separately');
  check(st('Router').limits.find((l) => l.key === 'credits')?.limit === 50 && st('DeepSeek').limits[0].usedPercent === 25, 'OpenRouter and DeepSeek answered through the stub');
  check(hits.some((h) => h.startsWith('/openrouter.ai/')) && hits.some((h) => h.startsWith('/api.deepseek.com/')), 'only the services\' own endpoints were asked');
  check((await checks()).length === 2, 'checks run once accounts exist');
  check(o.summary.runningOut.some((i) => i.accountName === 'Codex Plus' && i.limit.key === 'weekly') && o.summary.runningOut.some((i) => i.accountName === 'Work') && o.summary.usedUp.some((i) => i.accountName === 'Codex Team'), 'running out and used up are sorted out');

  // ---- the AI usage card in the owl's glance (no menu-bar item of its own)
  const gs = await until(async () => { const t = await u('glanceState'); return t.card ? t : null; }, 5000);
  check(!!gs && gs.text === 'CX 3%  +2' && gs.card.value === 'CX 3%  +2' && gs.card.tone === 'bad', `glance card: "${gs?.card?.value}" (${gs?.card?.detail})`);
  check(gs?.tooltip.includes('Codex Team 5-hour: used up'), 'the summary names custom accounts');
  await u('setSettings', { menuBar: { mode: 'countdown', count: 2 } });
  check((await u('glanceState')).card.value.startsWith('CX Reset 22h'), `countdown: "${(await u('glanceState')).card.value}"`);
  await u('setSettings', { menuBar: { mode: 'urgent', count: 1 } });
  // A glance that has already closed itself (it hides when it loses focus) is just not pictured.
  const shoot = async (pop, name) => { await wait(600); await pop.screenshot({ path: path.join(SHOTS, `${name}.png`), timeout: 10_000 }).catch(() => undefined); };
  // Opens the glance afresh (as a click on the owl does) and returns its AI usage card's text, or null.
  const glanceCard = async () => {
    await main.evaluate(() => window.keeper.glance.close()).catch(() => undefined);
    await main.evaluate(() => window.keeper.glance.show());
    const g = await until(async () => app.windows().find((w) => w.url().includes('view=glance')), 8000);
    await g.waitForSelector('[data-testid=glance]', { timeout: 8000 });
    // A glance shown again keeps its last view until the next live reading (every 2 s).
    await wait(2600);
    await g.waitForSelector('[data-testid^="glance-card-"]', { timeout: 8000 }).catch(() => undefined);
    const card = g.locator('[data-testid="glance-card-usage"]');
    return { g, text: (await card.count()) ? await card.getAttribute('aria-label') : null };
  };
  let gc = await glanceCard();
  check(!!gc.text && gc.text.startsWith('AI usage: CX 3%  +2') && /Codex Plus Weekly/.test(gc.text), `the glance shows the card ("${gc.text}")`);
  gc.g.on('pageerror', (e) => errors.push(`glance: ${e.message}`));
  await shoot(gc.g, 'glance-running-out-light');
  check(!app.windows().some((w) => w.url().includes('ai-usage-popover')), 'no pop-over window of its own');

  // ---- expiring resets: nothing low, a weekly allowance mostly unused resets soon
  codexRollout(codexA, 10, 15, { week: 10 * H });
  codexRollout(codexB, 5, 20, { week: 5 * 86_400_000 });
  execSync(cfg.statusLine.command, { input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor((Date.now() + 3 * H) / 1000) } } }), shell: '/bin/sh' });
  await u('saveAccount', { ...list.find((a) => a.name === 'Router'), id: list.find((a) => a.name === 'Router').id, paused: true });
  await u('saveAccount', { ...list.find((a) => a.name === 'DeepSeek'), paused: true });
  await u('saveAccount', { ...list.find((a) => a.name === 'Design AI'), subscription: { cost: 20, currency: 'USD', cycle: 'monthly', renews, remindDays: 3 } });
  const o2 = await until(async () => { const x = await u('refresh'); return x.summary.allClear && x.summary.expiring.length ? x : null; }, 15_000, 1000);
  check(!!o2 && o2.summary.expiring.some((i) => i.accountName === 'Codex Plus' && i.limit.key === 'weekly'), 'expiring: unused weekly allowance about to reset');
  gc = await glanceCard();
  check(!!gc.text && /AI usage: All clear/.test(gc.text), `glance: all clear ("${gc.text}")`);
  await shoot(gc.g, 'glance-expiring-light');
  const notes = (await u('glanceState')).notices;
  check(notes.some((n) => /Codex Team 5-hour reset: \d+% available/.test(n)), `a reset is announced (${notes.join(' | ')})`);
  check(notes.some((n) => /Design AI renews in 2 days/.test(n)), 'a renewal reminder is sent');

  // ---- all clear, nothing expiring
  codexRollout(codexA, 10, 15, { week: 5 * 86_400_000 });
  const o3 = await until(async () => { const x = await u('refresh'); return x.summary.allClear && !x.summary.expiring.length ? x : null; }, 15_000, 1000);
  check(!!o3, 'all clear');
  check((await u('glanceState')).card?.value === 'All clear', 'the card says all clear');
  await u('setSettings', { menuBar: { hideWhenClear: true } });
  check(!!(await until(async () => !(await u('glanceState')).card, 4000)) && (await glanceCard()).text === null, 'no card when all is clear (if chosen)');
  await u('setSettings', { menuBar: { hideWhenClear: false } });
  // Switched off in Settings → Menu bar: the glance leaves the card out.
  await main.evaluate(async () => { const g = await window.keeper.glance.settings(); await window.keeper.glance.setSettings({ cards: g.cards.filter((c) => c !== 'usage') }); });
  check((await glanceCard()).text === null, 'the card can be switched off');
  await main.evaluate(async () => { const g = await window.keeper.glance.settings(); await window.keeper.glance.setSettings({ cards: [...g.cards, 'usage'] }); });
  gc = await glanceCard();
  await shoot(gc.g, 'glance-all-clear-light');
  await main.evaluate(() => window.keeper.glance.close());

  // ---- the Usage page
  await main.locator('.sidebar button[title="Usage"]').first().click();
  // The compact sidebar opens over the page while the pointer rests on it: move away.
  await main.mouse.move(1000, 600);
  await wait(500);
  await main.waitForSelector('[data-testid=usage-page]', { timeout: 8000 });
  check(await main.locator('[data-testid=usage-account-card]').count() === 7, 'the page shows every account');
  await main.screenshot({ path: path.join(SHOTS, 'page-overview-light.png') });
  await main.locator('.usage-page button[role=tab]:has-text("Accounts")').click();
  check(await main.locator('[data-testid=usage-account-row]').count() === 7, 'Accounts lists them in order');
  await main.locator('[data-testid=usage-account-row]').filter({ hasText: 'Personal' }).locator('button:has-text("Edit")').click();
  await main.waitForSelector('[data-testid=usage-editor]');
  await main.screenshot({ path: path.join(SHOTS, 'page-editor-light.png') });
  await main.keyboard.press('Escape');
  await main.locator('.usage-page button[role=tab]:has-text("Subscriptions")').click();
  check((await main.locator('[data-testid=usage-monthly-total]').first().innerText()).includes('$20'), 'subscriptions: a monthly total');
  await main.locator('.usage-page button[role=tab]:has-text("Costs")').click();
  await wait(400);
  await main.screenshot({ path: path.join(SHOTS, 'page-costs-light.png') });
  const csv = await u('exportCsv');
  check(csv.path && fs.readFileSync(csv.path, 'utf8').includes('Codex Plus,codex,weekly'), `CSV export (${csv.rows} rows)`);

  // ---- keeper usage --json
  const cli = (args) => execFileSync(process.execPath, [path.join(APP, 'dist-cli/keeper.cjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME, XDG_CONFIG_HOME: HOME + '/.config' }, timeout: 30_000 });
  const j = JSON.parse(cli(['usage', '--json']));
  check(j.allClear === true && j.accounts.length === 7 && j.accounts.some((a) => a.name === 'Codex Team' && a.limits.some((l) => l.key === 'weekly')), 'keeper usage --json');
  check(/Codex Plus/.test(cli(['usage'])), 'keeper usage (text)');

  // ---- dark
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.locator('.usage-page button[role=tab]:has-text("Overview")').click();
  await wait(1200);
  await main.screenshot({ path: path.join(SHOTS, 'page-overview-dark.png') });
  await shoot((await glanceCard()).g, 'glance-all-clear-dark');
  codexRollout(codexA, 10, 15, { week: 10 * H });
  await until(async () => (await u('refresh')).summary.expiring.length > 0, 10_000, 1000);
  codexRollout(codexA, 20, 97);
  codexRollout(codexB, 100, 30, { h5: 22 });
  await until(async () => (await u('refresh')).summary.runningOut.length > 0, 10_000, 1000);
  gc = await glanceCard();
  check(!!gc.text && /AI usage: CX/.test(gc.text), `dark: the card follows the newest readings ("${gc.text}")`);
  await shoot(gc.g, 'glance-running-out-dark');
  await main.evaluate(() => window.keeper.glance.close());
  await wait(800);
  const pageText = await main.locator('[data-testid=usage-page]').innerText();
  check(/Running out/i.test(pageText) && /Used up/i.test(pageText) && pageText.includes('Codex Plus'), 'the Usage page lists what is running out and used up');
  await main.screenshot({ path: path.join(SHOTS, 'page-running-out-dark.png') });
  // The Island's ring activity follows the most urgent limit.
  const isl = await main.evaluate(() => window.keeper.island.state()).catch(() => null);
  check(!isl || (isl.usageAlert && /Codex/.test(isl.usageAlert.title)), `the Island gets a usage activity (${isl?.usageAlert?.title ?? 'no Island here'})`);

  // ---- unofficial sources: nothing is asked until the person opts in
  const before = hits.length;
  let ul = await u('saveAccount', { provider: 'copilot', name: 'Copilot' });
  ul = await u('saveAccount', { provider: 'cursor', name: 'Cursor' });
  ul = await u('saveAccount', { provider: 'gemini-cli', name: 'Gemini' });
  const off = await u('refresh');
  const stOf = (x, name) => x.states[x.accounts.find((a) => a.name === name).id];
  check(/Unofficial source: turn on/.test(stOf(off, 'Copilot').message ?? '') && /Unofficial source/.test(stOf(off, 'Cursor').message ?? '') && !stOf(off, 'Gemini').limits.some((l) => l.key.startsWith('quota:')), 'unofficial sources stay off until opted in');
  check(!hits.slice(before).some((h) => /github|cursor|cloudcode/.test(h)), 'nothing unofficial is asked before opting in');
  for (const name of ['Copilot', 'Cursor', 'Gemini']) await u('saveAccount', { ...off.accounts.find((a) => a.name === name), online: true });
  const on = await until(async () => { const x = await u('refresh'); return stOf(x, 'Copilot').limits.length && stOf(x, 'Cursor').limits.length && stOf(x, 'Gemini').limits.some((l) => l.key.startsWith('quota:')) ? x : null; }, 15_000, 1000);
  check(!!on && stOf(on, 'Copilot').limits[0].usedPercent === 88 && /unofficial/.test(stOf(on, 'Copilot').source), `Copilot opted in: premium requests (${on && stOf(on, 'Copilot').limits.map((l) => l.label).join(', ')})`);
  check(!!on && stOf(on, 'Cursor').limits[0].used === 410, 'Cursor opted in: requests with the app’s own sign-in');
  check(!!on && stOf(on, 'Gemini').limits.some((l) => l.key === 'quota:gemini-2.5-pro:requests'), 'Gemini CLI opted in: Code Assist quota');
  await main.locator('.usage-page button[role=tab]:has-text("Accounts")').click();
  await main.locator('[data-testid=usage-account-row]').filter({ has: main.locator('.meta b', { hasText: /^Cursor$/ }) }).locator('button:has-text("Edit")').click();
  await main.waitForSelector('[data-testid=usage-optin-explain]');
  check(/undocumented.*Unofficial; may break/.test(await main.locator('[data-testid=usage-optin-explain]').innerText()), 'the opt-in says it is unofficial and may break');
  await main.screenshot({ path: path.join(SHOTS, 'page-editor-unofficial-dark.png') });
  await main.keyboard.press('Escape');
  await main.locator('[data-testid=usage-account-row]').filter({ has: main.locator('.meta b', { hasText: /^Work$/ }) }).locator('button:has-text("Edit")').click();
  check(/settings\.json.*restores/.test(await main.locator('[data-testid=usage-statusline-explain]').innerText()), 'the status-line switch says it edits settings.json and restores it');
  await main.keyboard.press('Escape');
  await main.locator('.usage-page button[role=tab]:has-text("Costs")').click();
  await wait(500);
  await main.screenshot({ path: path.join(SHOTS, 'page-costs-dark.png') });

  // ---- removing everything stops all work
  await u('setStatusLine', work1.id, false);
  check(!('statusLine' in JSON.parse(fs.readFileSync(path.join(work, 'settings.json'), 'utf8'))), 'the status line setting is put back');
  for (const a of await u('overview').then((x) => x.accounts)) await u('removeAccount', a.id);
  await wait(800);
  check((await checks()).length === 0 && !(await u('glanceState')).card, 'no accounts: no checks and no card again');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
