// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/island-tools.cjs /tmp/kit /tmp/kit-shots
// Drives the real Keeper app's Island tools: every tool opens, the converter
// answers, emoji copy, a note survives a restart, the teleprompter scrolls,
// sales from a stand-in payment service, AI usage from fixture files, and the
// tool order the person chose is kept.
const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fixtures
const now = Date.now();
const claudeDir = path.join(HOME, '.claude');
fs.mkdirSync(path.join(claudeDir, 'projects', 'demo'), { recursive: true });
const tl = (min, id, i, o) => JSON.stringify({ type: 'assistant', timestamp: new Date(now - min * 60_000).toISOString(), requestId: id, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: i, output_tokens: o } } });
fs.writeFileSync(path.join(claudeDir, 'projects', 'demo', 'session.jsonl'), [tl(30, 'a', 1200, 300), tl(10, 'b', 800, 200)].join('\n'));
const codexDir = path.join(HOME, '.codex');
const day = new Date(now);
const sess = path.join(codexDir, 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
fs.mkdirSync(sess, { recursive: true });
fs.writeFileSync(path.join(sess, 'rollout-test.jsonl'), JSON.stringify({ timestamp: new Date(now).toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 42, window_minutes: 300, resets_in_seconds: 3600 }, secondary: { used_percent: 17, window_minutes: 10080, resets_in_seconds: 400000 } } } }) + '\n');

// A stand-in payment service answering like Stripe's charges list.
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/v1/charges')) { res.writeHead(404); return res.end(); }
  const secs = Math.floor(now / 1000);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ has_more: false, data: [
    { id: 'ch_1', created: secs - 600, amount: 1000, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, livemode: true },
    { id: 'ch_2', created: secs - 300, amount: 2050, amount_refunded: 0, currency: 'usd', status: 'succeeded', paid: true, livemode: true },
    { id: 'ch_3', created: secs - 200, amount: 999, currency: 'usd', status: 'failed', paid: false, livemode: true },
  ] }));
});

async function launch(port) {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_SALES_BASE: `http://127.0.0.1:${port}`, KEEPER_CLAUDE_DIR: claudeDir, KEEPER_CODEX_DIR: codexDir },
  });
  let main;
  let isl;
  for (let i = 0; i < 80 && !(main && isl); i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && !u.includes('view=') || u.includes('view=app'); });
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  return { app, main, isl };
}

async function openPanel(app, isl, tab = 'home') {
  await app.evaluate(({ BrowserWindow }, t) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=island')) w.webContents.send('event:island-open', t); }, tab);
  for (let i = 0; i < 20 && !(await isl.locator('.isl-panel').count()); i++) await wait(250);
  await wait(500);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let { app, main, isl } = await launch(port);
  check(!!isl && !!main, 'Keeper and its Island window open');
  const errors = [];
  isl.on('pageerror', (e) => errors.push(e.message));
  await wait(2500);

  // Every tool on.
  await main.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ island: { ...s.island, toolsOff: [], hoverOpen: false } })));
  await wait(800);
  await openPanel(app, isl, 'home');
  check(await isl.locator('.isl-panel').count() === 1, 'the Island opens into its panel');
  const titles = await isl.$$eval('.isl-panel .tabs button[title]', (els) => els.map((e) => e.getAttribute('title')).filter((t) => t && !/awake/i.test(t)));
  check(titles.length >= 20, `all ${titles.length} tools are offered (${titles.join(', ')})`);
  let empty = [];
  for (const t of titles) {
    await isl.locator(`.isl-panel .tabs button[title="${t}"]`).click();
    await wait(t === 'Emoji' ? 1200 : 500);
    const html = await isl.locator('.isl-panel .body').innerHTML();
    if (html.length < 40) empty.push(t);
    await isl.screenshot({ path: path.join(SHOTS, `app-${t.toLowerCase().replace(/[^a-z]+/g, '-')}.png`) });
  }
  check(empty.length === 0, `every tool shows something${empty.length ? ` (empty: ${empty.join(', ')})` : ''}`);

  // Converter
  await isl.locator('.isl-panel .tabs button[title="Convert"]').click(); await wait(300);
  await isl.fill('.convert input', '5 ft in cm'); await wait(300);
  const conv = await isl.locator('.conv-ans').first().innerText().catch(() => '');
  check(conv === '152.4 cm', `the converter answers 5 ft in cm = ${conv}`);
  await isl.fill('.convert input', '100 c'); await wait(200);
  check((await isl.locator('.conv-ans').first().innerText().catch(() => '')) === '212 °F', '100 °C is 212 °F');

  // Emoji search and copy
  await isl.locator('.isl-panel .tabs button[title="Emoji"]').click(); await wait(1200);
  await isl.fill('.emoji input', 'pizza'); await wait(400);
  await isl.locator('.emoji .egrid button').first().click(); await wait(500);
  const clip = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  check(clip === '🍕', `emoji search finds pizza and copies it (${clip})`);

  // AI usage from fixture files
  await isl.locator('.isl-panel .tabs button[title="AI Usage"]').click(); await wait(1500);
  const usage = await isl.locator('.usage').innerText();
  check(/Codex[\s\S]*42%[\s\S]*17%/.test(usage), 'Codex limits are read from its session file (42% session, 17% weekly)');
  check(/Claude Code[\s\S]*2\.5k tokens/.test(usage), 'Claude Code tokens are counted from its session file (2.5k)');

  // Sales from the stand-in service
  await isl.evaluate(() => window.keeper.islandTools.setSalesProvider('stripe', 'rk_test_123'));
  await isl.locator('.isl-panel .tabs button[title="Sales"]').click(); await wait(1800);
  const sales = await isl.locator('.sales').innerText();
  check(/\$30\.50/.test(sales) && /2 sales/.test(sales), `sales today are totalled, failed charges left out (${(sales.match(/\$[\d.,]+/) ?? [''])[0]})`);
  await isl.screenshot({ path: path.join(SHOTS, 'app-sales-connected.png') });

  // A quick note
  await isl.locator('.isl-panel .tabs button[title="Notes"]').click(); await wait(400);
  await isl.locator('.notes button[title="New note"]').click(); await wait(300);
  await isl.locator('.notes textarea').fill('# Keeper test note\nremember the milk');
  await wait(1200);

  // Teleprompter scrolls
  await isl.locator('.isl-panel .tabs button[title="Prompter"]').click(); await wait(400);
  await isl.locator('.prompter-edit button', { hasText: 'New' }).click(); await wait(300);
  await isl.locator('.prompter-edit textarea').fill(Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the script, read slowly and clearly.`).join('\n'));
  await isl.locator('.prompter-edit button', { hasText: 'Done' }).click(); await wait(300);
  await isl.locator('.prompter button', { hasText: 'Start' }).click(); await wait(6000);
  const tr = await isl.locator('.ptext').evaluate((e) => e.style.transform);
  const y = Number((tr.match(/translateY\((-?[\d.]+)px\)/) ?? [])[1] ?? 0);
  check(y < -10, `the teleprompter scrolls after its countdown (${tr})`);
  await isl.screenshot({ path: path.join(SHOTS, 'app-prompter-running.png') });

  // Reorder: move Notes left twice through the tab's menu.
  const before = await isl.$$eval('.isl-panel .tabs button[title]', (els) => els.map((e) => e.getAttribute('title')));
  for (let i = 0; i < 2; i++) {
    await isl.locator('.isl-panel .tabs button[title="Notes"]').click({ button: 'right' }); await wait(250);
    await isl.locator('.tab-menu button', { hasText: 'Move left' }).click(); await wait(500);
  }
  const after = await isl.$$eval('.isl-panel .tabs button[title]', (els) => els.map((e) => e.getAttribute('title')));
  check(after.indexOf('Notes') === before.indexOf('Notes') - 2, `a tool moves left from its tab's menu (${before.indexOf('Notes')} → ${after.indexOf('Notes')})`);

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await app.close();
  await wait(1000);

  // After a restart: the note and the order are still there.
  ({ app, main, isl } = await launch(port));
  await wait(2500);
  const store = await isl.evaluate(() => window.keeper.islandTools.store());
  check(store.notes.some((n) => n.text.includes('remember the milk')), 'the quick note is still there after a restart');
  await openPanel(app, isl, 'home');
  const again = await isl.$$eval('.isl-panel .tabs button[title]', (els) => els.map((e) => e.getAttribute('title')));
  check(again.indexOf('Notes') === after.indexOf('Notes'), 'the tool order is kept after a restart');
  await app.close();
  server.close();
})().catch((e) => { console.error(e); process.exitCode = 1; server.close(); });
