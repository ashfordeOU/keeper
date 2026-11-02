// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/abilities.cjs /tmp/kab /tmp/kab-shots
// Drives the real Keeper app with a stand-in AI (OpenAI-compatible), a stand-in
// SearXNG and a stand-in Stable Diffusion web UI, all on this computer:
// the Assistant searches the web and cites; a picture is made after the person
// allows it; a scheduled request fires into the Island; a team of two AIs
// answers side by side.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kab-'));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const DATA = path.join(HOME, '.config', 'Keeper');
const DOCS = path.join(HOME, 'Documents');
for (const d of [DATA, DOCS, SHOTS, path.join(HOME, 'Pictures'), path.join(HOME, 'Downloads')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(DOCS, 'notes.md'), '# Notes\nBirds to look up: owls.\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------- stand-ins
const seen = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const json = (v) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url.startsWith('/search')) return json({ results: [{ title: 'Owls of the world', url: 'https://owls.example/world', content: 'Owls are nocturnal birds of prey; there are about 250 species.', publishedDate: '2026-10-20' }] });
    if (req.url.startsWith('/sdapi/v1/txt2img')) return json({ images: [PNG] });
    if (!req.url.startsWith('/v1/chat/completions')) { res.writeHead(404); return res.end(); }
    const body = JSON.parse(raw);
    seen.push(body);
    const reply = (message) => json({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });
    // After a tool that returns a picture, the harness adds a message carrying the picture; the tool result is just before it.
    const msgs = body.messages.filter((m) => !(m.role === 'user' && Array.isArray(m.content)));
    const last = msgs[msgs.length - 1];
    const user = [...msgs].reverse().find((m) => m.role === 'user');
    const text = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
    const has = (n) => (body.tools || []).some((t) => t.function?.name === n);
    if (!body.tools?.length) return reply({ role: 'assistant', content: `Answer from ${body.model}: owls hunt at night.` });
    if (last.role === 'tool') {
      if (/^Saved /.test(last.content)) return reply({ role: 'assistant', content: `Here is your owl: ${last.content.replace(/^.*?(\[\[.*?\]\]).*$/s, '$1')}` });
      if (/untrusted_web_content/.test(last.content)) return reply({ role: 'assistant', content: 'There are about 250 kinds of owl [1] (https://owls.example/world).' });
      return reply({ role: 'assistant', content: `Done: ${last.content.slice(0, 80)}` });
    }
    if (/briefing/i.test(text)) return reply({ role: 'assistant', content: 'Your briefing: two meetings, light rain later.' });
    if (/draw/i.test(text) && has('image_generate')) return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c_img', type: 'function', function: { name: 'image_generate', arguments: JSON.stringify({ prompt: 'a small owl' }) } }] });
    if (has('web_search')) return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c_web', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'how many owl species' }) } }] });
    return reply({ role: 'assistant', content: 'ok' });
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [DOCS, path.join(HOME, 'Pictures')],
    brain: {
      enabled: true, semantic: false, visibility: 'full', active: 'fake-a', pauseOnBattery: false,
      connections: [
        { id: 'fake-a', kind: 'openai-compatible', label: 'Test AI A', model: 'model-a', baseUrl: `${base}/v1` },
        { id: 'fake-b', kind: 'openai-compatible', label: 'Test AI B', model: 'model-b', baseUrl: `${base}/v1` },
      ],
    },
    abilities: {
      enabled: true,
      search: { provider: 'searxng', searxngUrl: base, googleCx: '', region: '', safe: true },
      images: { provider: 'automatic1111', model: '', localUrl: base, size: '512x512', folder: path.join(HOME, 'Pictures', 'Keeper AI') },
    },
  }));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  console.log('window', main.url());
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  // The first-run tour covers the window; skip it, and the first-visit tips too.
  await main.waitForTimeout(2500);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  await main.evaluate(() => { for (const k of ['assistant', 'agents', 'home', 'settings']) try { localStorage.setItem(`coach.${k}`, '1'); } catch { /* ignore */ } });
  for (let i = 0; i < 40; i++) { if ((await main.evaluate(() => window.keeper.brain.status())).files > 0) break; await main.waitForTimeout(500); }

  // ---------------------------------------------------------------- the Assistant searches the web with the stand-in AI
  const list = await main.evaluate(() => window.keeper.abilities.list());
  check(list.length >= 12 && list.some((a) => a.name === 'web_search' && a.permission === 'allow'), `${list.length} abilities offered; web search allowed`);
  await main.locator('.sidebar [title="Assistant"]').click();
  await main.waitForSelector('.composer textarea', { timeout: 15000 });
  await main.waitForTimeout(1500);
  // A starter question (typing into the box is being reworked elsewhere); the stand-in AI searches the web for any question.
  await main.locator('.chips .chip').first().click();
  await main.waitForFunction(() => /250 kinds of owl/.test(document.body.innerText), null, { timeout: 30000 }).catch(async (e) => {
    console.log('DEBUG requests', seen.length, JSON.stringify(seen.map((b) => ({ tools: (b.tools || []).map((t) => t.function?.name), last: b.messages[b.messages.length - 1] }))).slice(0, 3000));
    await main.screenshot({ path: path.join(SHOTS, 'debug-assistant.png') });
    console.log('DEBUG page', (await main.locator('.main > .content').innerText()).slice(0, 1500), 'ERRORS', errors.join(' | '));
    throw e;
  });
  const asked = seen.find((b) => (b.tools || []).some((t) => t.function?.name === 'web_search'));
  check(!!asked, 'the AI is offered web_search next to the file tools');
  const toolMsg = seen.flatMap((b) => b.messages).find((m) => m.role === 'tool' && /owls\.example/.test(m.content));
  check(!!toolMsg && /<untrusted_web_content>/.test(toolMsg.content), 'search results reach the AI wrapped as untrusted web text');
  check(/\[1\]/.test(await main.locator('.chat').innerText()), 'the answer cites the web result [1]');
  await main.screenshot({ path: path.join(SHOTS, 'assistant-web-light.png') });

  // ---------------------------------------------------------------- a picture, after the person allows it
  // The same path the Assistant uses (its harness with the abilities), asked directly.
  const drawn = main.evaluate(() => window.keeper.brain.ask('e2e-draw', 'Please draw an owl'));
  const allow = main.getByRole('button', { name: 'Allow once' });
  await allow.waitFor({ timeout: 20000 });
  check(true, 'making a picture asks first (Allow once / Always allow / Don\'t allow)');
  await main.screenshot({ path: path.join(SHOTS, 'approval-image-light.png') });
  await allow.click();
  const drawnAnswer = await drawn;
  check(/Here is your owl/.test(drawnAnswer.answer), `the AI answers with the picture (${drawnAnswer.answer.slice(0, 80)})`);
  const picDir = path.join(HOME, 'Pictures', 'Keeper AI');
  const pics = fs.existsSync(picDir) ? fs.readdirSync(picDir) : [];
  check(pics.length === 1 && /small-owl\.png$/.test(pics[0]), `the picture was saved in the library (${pics.join(', ')})`);

  // ---------------------------------------------------------------- memory
  await main.evaluate(() => window.keeper.abilities.addMemory('Prefers metric units'));
  const mem = await main.evaluate(() => window.keeper.abilities.memories());
  check(mem.length === 1 && mem[0].by === 'you', 'a memory is kept, visible and editable');

  // ---------------------------------------------------------------- a scheduled request fires into the Island
  await main.evaluate(() => window.keeper.abilities.saveTask({ name: 'Morning briefing', prompt: 'Give me my briefing', when: 'in 1 minute', deliver: ['island'], enabled: true }));
  let fired;
  for (let i = 0; i < 90 && !fired; i++) {
    const st = await main.evaluate(() => window.keeper.island.state());
    fired = (st.alerts || []).find((a) => a.title === 'Morning briefing');
    if (!fired) await main.waitForTimeout(1000);
  }
  check(!!fired && /briefing: two meetings/.test(fired.detail || ''), `the scheduled request ran and its answer reached the Island (${fired ? fired.detail : 'nothing'})`);
  const tasks = (await main.evaluate(() => window.keeper.abilities.settings())).tasks;
  check(tasks[0] && tasks[0].enabled === false && tasks[0].lastRun > 0, 'a one-off request switches itself off after running');

  // ---------------------------------------------------------------- a team: two AIs side by side
  await main.evaluate(() => window.keeper.abilities.saveTeam({ name: 'Second opinion', strategy: 'compare', members: ['fake-a', 'fake-b'] }));
  await main.locator('.sidebar [title="Agents"]').click();
  await main.getByRole('button', { name: 'Teams', exact: true }).click();
  await main.getByRole('button', { name: 'Ask the team' }).first().click();
  await main.fill('.modal textarea', 'Tell me about owls');
  await main.keyboard.press('Enter');
  await main.waitForSelector('.abil-compare .card', { timeout: 20000 }).catch(async (e) => { await main.screenshot({ path: path.join(SHOTS, 'debug-team.png') }); throw e; });
  const cards = await main.locator('.abil-compare .card').allInnerTexts();
  check(cards.length === 2 && /model-a/.test(cards.join()) && /model-b/.test(cards.join()), `two AIs answered side by side (${cards.length})`);
  await main.screenshot({ path: path.join(SHOTS, 'team-compare-light.png') });
  await main.keyboard.press('Escape');

  // ---------------------------------------------------------------- the pages, light and dark
  for (const mode of ['light', 'dark']) {
    await main.evaluate((m) => window.keeper.settings.set({ appearance: m }), mode);
    await main.waitForTimeout(400);
    for (const tab of ['Abilities', 'Teams', 'Schedules', 'Personas & projects', 'Memory']) {
      await main.getByRole('button', { name: tab, exact: true }).click();
      await main.waitForTimeout(500);
      await main.screenshot({ path: path.join(SHOTS, `${tab.toLowerCase().replace(/[^a-z]+/g, '-')}-${mode}.png`) });
    }
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  server.close();
})().catch((e) => { console.log('FAIL', e.stack || e); process.exitCode = 1; server.close(); });
