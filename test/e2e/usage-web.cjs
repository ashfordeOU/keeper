// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/usage-web.cjs /tmp/kuw /tmp/kuw-shots
// Drives the real Keeper app's web sign-in accounts against a local stand-in for claude.ai and
// chatgpt.com (KEEPER_USAGE_STUB, honoured only in unofficial builds):
//   - "Add account" with a web login opens the provider's own sign-in page in a window of its own,
//     in a partition of the account's own (persist:usage-<id>); two Claude accounts sign in side by
//     side and each request carries only its own account's cookie
//   - the name defaults to the signed-in email
//   - nothing is asked for usage until the account's unofficial switch is on; then 5-hour and weekly
//     limits per account, by name
//   - signed out on the site: "Sign in again", and nothing more is sent
//   - ChatGPT: the Codex limits from the web session
//   - removing an account wipes its partition
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = fs.realpathSync(fs.mkdirSync(path.resolve(process.argv[2] || '/tmp/kuw'), { recursive: true }) || path.resolve(process.argv[2] || '/tmp/kuw'));
const SHOTS = path.resolve(process.argv[3] || '/tmp/kuw-shots');
const APP = path.resolve(__dirname, '../..');
const FIX = path.join(__dirname, '..', 'fixtures', 'usage-tracker');
for (const f of fs.readdirSync(HOME)) fs.rmSync(path.join(HOME, f), { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

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
function findDirs(root, name, out = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    if (e.name === name) out.push(p);
    else findDirs(p, name, out);
  }
  return out;
}

// ---- a stand-in for the two sites: each sign-in gets a cookie of its own
const hits = [];
let logins = 0;
const signedOut = new Set();
const cookieOf = (req, name) => (req.headers.cookie ?? '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
const usageFor = { 'sk-ant-1': 42, 'sk-ant-2': 90 };
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, cookie: req.headers.cookie ?? '', auth: req.headers.authorization ?? '' });
  const send = (body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const fix = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
  const u = req.url;
  // claude.ai
  if (u.startsWith('/claude.ai/login')) {
    logins += 1;
    res.setHeader('set-cookie', `sessionKey=sk-ant-${logins}; Path=/; HttpOnly; SameSite=Lax`);
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><title>Signed in</title><p>Signed in to the stand-in.</p>');
  }
  const sk = cookieOf(req, 'sessionKey');
  if (u.startsWith('/claude.ai/api/')) {
    if (!sk || signedOut.has(sk)) return send({ type: 'error', error: { type: 'account_session_invalid' } }, 401);
    if (u === '/claude.ai/api/account') return send({ ...fix('claude-web-account.json'), email_address: sk === 'sk-ant-1' ? 'work@example.com' : 'personal@example.com' });
    if (u === '/claude.ai/api/organizations') return send(fix('claude-web-organizations.json').slice(0, 2));
    if (u === '/claude.ai/api/organizations/org-max-1/usage') {
      const body = fix('claude-web-usage.json');
      body.five_hour = { utilization: usageFor[sk], resets_at: new Date(Date.now() + 2 * H).toISOString() };
      body.seven_day = { utilization: 30, resets_at: new Date(Date.now() + 4 * 24 * H).toISOString() };
      return send(body);
    }
  }
  // chatgpt.com
  if (u.startsWith('/chatgpt.com/auth/login')) {
    res.setHeader('set-cookie', 'next-auth.session-token=gpt-1; Path=/; HttpOnly; SameSite=Lax');
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><title>Signed in</title>');
  }
  if (u === '/chatgpt.com/api/auth/session') return send(cookieOf(req, 'next-auth.session-token') ? fix('chatgpt-session.json') : {});
  if (u === '/chatgpt.com/backend-api/wham/usage') {
    const want = `Bearer ${fix('chatgpt-session.json').accessToken}`;
    return req.headers.authorization === want ? send(fix('chatgpt-wham-usage.json')) : send({}, 401);
  }
  send({}, 404);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stub = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_USAGE_STUB: stub, KEEPER_USAGE_SIGNIN_HIDDEN: '1' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  const u = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.aiUsage[f](...args), [fn, a]);
  const stOf = (o, id) => o.states[id];

  // ---- two Claude accounts, each signed in in its own partition
  const a = await u('signIn', { provider: 'claude-web', name: '' });
  check(a.ok && /work@example\.com/.test(a.message), `first Claude account signed in (${a.message})`);
  const b = await u('signIn', { provider: 'claude-web', name: 'Claude — Personal' });
  check(b.ok, `second Claude account signed in (${b.message})`);
  const list = b.accounts;
  const A = list.find((x) => x.id === a.accountId);
  const B = list.find((x) => x.id === b.accountId);
  check(A?.name === 'work@example.com' && B?.name === 'Claude — Personal', `names: the email by default, or the one given (${A?.name}, ${B?.name})`);
  check(!!A?.signedIn && !!B?.signedIn && !A.online && !B.online, 'both signed in; reading usage is still off');
  check(findDirs(HOME, `usage-${A.id}`).length === 1 && findDirs(HOME, `usage-${B.id}`).length === 1, 'each account has a partition folder of its own');
  const ids = hits.filter((h) => h.url === '/claude.ai/api/account').map((h) => cookieOf({ headers: { cookie: h.cookie } }, 'sessionKey'));
  check(ids.join(',') === 'sk-ant-1,sk-ant-2', `each sign-in carries only its own cookie (${ids.join(', ')})`);

  // ---- nothing is asked for usage until opted in
  let o = await u('refresh');
  check(/turn on “Read usage from claude\.ai”/.test(stOf(o, A.id)?.message ?? ''), `opt-in needed first (${stOf(o, A.id)?.message})`);
  check(!hits.some((h) => /\/usage$/.test(h.url)), 'no usage request before the switch is on');
  await u('saveAccount', { ...A, online: true });
  await u('saveAccount', { ...B, online: true });
  o = await until(async () => { const x = await u('overview'); return stOf(x, A.id)?.limits.length && stOf(x, B.id)?.limits.length ? x : null; }, 15_000, 500);
  const five = (id) => stOf(o, id)?.limits.find((l) => l.key === '5h')?.usedPercent;
  check(!!o && five(A.id) === 42 && five(B.id) === 90, `each account reads its own limits (${o && five(A.id)}%, ${o && five(B.id)}%)`);
  check(!!o && stOf(o, A.id).plan === 'Max 20×' && /unofficial/.test(stOf(o, A.id).source), `plan and an honest source (${o && stOf(o, A.id).source})`);
  const usageHits = hits.filter((h) => /\/usage$/.test(h.url));
  check(usageHits.every((h) => /sessionKey=sk-ant-[12]$/.test(h.cookie) && !h.cookie.includes(';')), 'each usage request carries exactly one account\'s cookie');
  check(o && o.summary.runningOut.some((i) => i.accountName === 'Claude — Personal' && i.limit.key === '5h'), 'running out is named by the account');
  // The service interval holds: a refresh soon after does not ask again.
  const before = hits.length;
  await u('refresh');
  check(hits.length === before, 'no request again before the service interval');

  // ---- signed out on the site: Sign in again, and nothing more is sent
  signedOut.add('sk-ant-2');
  await u('setSettings', { apiEveryMin: 5 });
  // Ask now, as the next scheduled look would.
  await u('saveAccount', { ...B, online: false });
  await u('saveAccount', { ...B, online: true });
  o = await until(async () => { const x = await u('overview'); return stOf(x, B.id)?.needsSignIn ? x : null; }, 10_000, 500);
  check(!!o && /Signed out of claude\.ai/.test(stOf(o, B.id).message), `signed out: "${o && stOf(o, B.id).message}"`);
  const after = hits.length;
  await u('refresh', B.id);
  check(hits.length === after, 'nothing more is sent for a signed-out account');

  // ---- ChatGPT, with the Codex limits from the web
  const g = await u('signIn', { provider: 'chatgpt-web', name: '', online: true });
  check(g.ok && g.accounts.find((x) => x.id === g.accountId)?.name === 'me@example.com', `ChatGPT signed in (${g.message})`);
  o = await until(async () => { const x = await u('overview'); return stOf(x, g.accountId)?.limits.length ? x : null; }, 10_000, 500);
  check(!!o && stOf(o, g.accountId).limits.find((l) => l.key === 'weekly')?.usedPercent === 92 && stOf(o, g.accountId).plan === 'Pro', 'ChatGPT: Codex 5-hour and weekly limits and the plan');

  // ---- the page and the glance name each account
  const card = (await u('glanceState')).card;
  check(!!card && /Pl|CP|GP|CW/.test(card.value) && /Claude — Personal|me@example\.com/.test(card.detail + card.tooltip), `the glance names accounts (${card?.value} · ${card?.detail})`);
  await main.locator('.sidebar button[title="Usage"]').first().click().catch(() => undefined);
  await main.mouse.move(1000, 600);
  await main.waitForSelector('[data-testid=usage-page]', { timeout: 8000 }).catch(() => undefined);
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'usage-web-overview.png') });
  check((await main.locator('[data-testid=usage-signin-again]').count()) >= 1, 'the page offers Sign in again');

  // ---- removing an account wipes its partition
  await u('removeAccount', A.id);
  await wait(800);
  check(findDirs(HOME, `usage-${A.id}`).length === 0, 'the removed account\'s partition is gone');
  check(findDirs(HOME, `usage-${B.id}`).length === 1, 'the other account keeps its own');
  for (const x of (await u('overview')).accounts) await u('removeAccount', x.id);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
