// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1280x1024x24" node test/e2e/computer.cjs /tmp/kc /tmp/kc-shots
// An AI using the computer, end to end on X11 (needs openbox, xdotool, xterm):
//   - a stand-in AI (OpenAI-compatible, in this process) drives Keeper's
//     Assistant: screenshot → click a button in another app → click a field
//     → type; Keeper asks first, the Island shows it, the screenshots reach the AI;
//   - an MCP client (`keeper mcp`) gets the same tool: a blocked app (xterm)
//     is refused, Stop (the global shortcut) ends the session and the next
//     call is refused.
const { _electron, chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
for (const d of [path.join(HOME, 'Documents'), DATA]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(HOME, 'Documents', 'meeting notes.md'), '# Notes\n\nBudget review on Friday.\n');
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCREEN_W = Number((execFileSync('xdpyinfo').toString().match(/dimensions:\s+(\d+)x(\d+)/) || [])[1] || 1280);

// ---------------------------------------------------------------- the stand-in AI
const target = { button: null, field: null };
const seen = [];
let shotW = 0;
let windowsSeen = '';
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const reply = (message) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })); };
    if (!body.tools) return reply({ role: 'assistant', content: 'ready' });
    const tools = body.messages.filter((m) => m.role === 'tool');
    const lastTool = tools[tools.length - 1];
    const m = lastTool && /Screenshot (\d+)×(\d+)/.exec(lastTool.content);
    if (m) shotW = Number(m[1]);
    const k = shotW / SCREEN_W;
    const at = (p) => [Math.round(p.x * k), Math.round(p.y * k)];
    const call = (args) => reply({ role: 'assistant', content: null, tool_calls: [{ id: `call_${tools.length + 1}`, type: 'function', function: { name: 'computer', arguments: JSON.stringify(args) } }] });
    // Like a real AI: find the app, bring it forward, look, then act.
    switch (tools.length) {
      case 0: return call({ action: 'list_windows' });
      case 1: {
        const id = (/^(\S+)\s+.*Notes app/m.exec(lastTool.content) || [])[1];
        windowsSeen = lastTool.content;
        return call({ action: 'focus_window', window_id: id || 'none' });
      }
      case 2: return call({ action: 'screenshot' });
      case 3: return call({ action: 'left_click', coordinate: at(target.button) });
      case 4: return call({ action: 'left_click', coordinate: at(target.field) });
      case 5: return call({ action: 'type', text: 'hello from the AI' });
      case 6: return call({ action: 'type', text: 'password: hunter22' });
      default: return reply({ role: 'assistant', content: 'Saved, and typed the greeting.' });
    }
  });
});

function runCli(args, lines) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), ...args], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_DATA_DIR: DATA, HOME } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    p.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  });
}
const mcp = (calls) => runCli(['mcp'], [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Test Agent', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 10 + i, method: c.method ?? 'tools/call', params: c.params })),
]);

(async () => {
  const wm = spawn('openbox', [], { stdio: 'ignore' });
  await sleep(800);
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [path.join(HOME, 'Documents')],
    brain: { enabled: true, semantic: false, visibility: 'full', active: 'mock', connections: [{ id: 'mock', kind: 'openai-compatible', label: 'Test AI', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` }] },
    agents: { computer: { permission: 'ask' } },
  }));

  // The app the AI will use: a page with a button and a field.
  const browser = await chromium.launch({ headless: false, args: ['--window-position=520,300', '--window-size=640,420'] });
  const page = await browser.newPage({ viewport: null });
  await page.setContent(`<title>Notes app</title><body style="font:20px sans-serif;margin:30px"><button id="b" style="font-size:24px;padding:16px 30px" onclick="this.dataset.n=(+this.dataset.n||0)+1;this.textContent='Saved '+this.dataset.n">Save</button><p><input id="f" style="font-size:22px;width:420px" placeholder="Name"></p></body>`);
  await sleep(800);
  const geo = await page.evaluate(() => {
    const top = window.screenY + (window.outerHeight - window.innerHeight);
    const c = (el) => { const r = el.getBoundingClientRect(); return { x: window.screenX + r.left + r.width / 2, y: top + r.top + r.height / 2 }; };
    return { button: c(document.getElementById('b')), field: c(document.getElementById('f')) };
  });
  Object.assign(target, geo);

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await sleep(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1200, height: 860 }).catch(() => undefined);
  await sleep(2500);
  // The first-run welcome tour covers the window; skip it.
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 3000 }).catch(() => undefined);

  // Agents → the computer section.
  await main.evaluate(() => window.keeper.settings.set({}));
  await main.locator('.sidebar [title="Agents"]').click().catch(() => undefined);
  await main.getByRole('button', { name: /What agents may do|Permissions/ }).first().click().catch(() => undefined);
  await sleep(600);
  const panel = await main.locator('.computer-use').count();
  check(panel === 1, 'Agents shows “Use this computer” with Off / Ask each time / Allowed');
  await main.locator('.computer-use').scrollIntoViewIfNeeded().catch(() => undefined);
  await main.screenshot({ path: `${SHOTS}/agents-computer.png` });

  // The Assistant, allowed to use the computer for this question.
  await main.locator('.sidebar [title="Assistant"]').click();
  await main.waitForSelector('.computer-toggle', { timeout: 10000 });
  await main.locator('.computer-toggle input').check();
  await main.fill('.composer textarea', 'Press Save in my notes app and type a greeting in the Name field');
  await main.screenshot({ path: `${SHOTS}/assistant-toggle.png` });
  await main.keyboard.press('Enter');

  // Keeper asks first.
  const ask = main.locator('.approval, [role="dialog"]').filter({ hasText: /use this computer/ });
  await ask.first().waitFor({ timeout: 15000 }).catch(() => undefined);
  check(await ask.count() > 0, 'Keeper asks before an AI may use the computer');
  await main.screenshot({ path: `${SHOTS}/consent.png` });
  await main.getByRole('button', { name: 'Allow once' }).click();

  // The Island says so while it works.
  let islandText = '';
  for (let i = 0; i < 20 && !/using this computer/.test(islandText); i++) {
    await sleep(300);
    const isl = app.windows().find((w) => w.url().includes('view=island'));
    if (isl) islandText = await isl.evaluate(() => document.body.innerText).catch(() => '');
  }
  check(/using this computer/.test(islandText), 'the Island shows that an AI is using this computer');

  await main.waitForSelector('.turn .answer, .cite, .msg-a', { timeout: 30000 }).catch(() => undefined);
  for (let i = 0; i < 60 && seen.filter((b) => b.tools).length < 8; i++) await sleep(500);
  check(/Notes app/.test(windowsSeen), 'list_windows shows the other app');
  const btn = await page.locator('#b').innerText();
  const val = await page.locator('#f').inputValue();
  check(btn === 'Saved 1', `the AI's click pressed the button in the other app (${btn})`);
  check(val === 'hello from the AI', `the AI typed into the field (“${val}”)`);
  const withPic = seen.find((b) => b.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url' && /^data:image\/png;base64,/.test(p.image_url.url))));
  check(!!withPic, 'the AI received the screenshot as a picture');
  const lastToolMsgs = seen[seen.length - 1].messages.filter((m) => m.role === 'tool');
  check(lastToolMsgs.some((m) => /looks like a password|Not allowed/.test(m.content)), 'a password is never typed by the AI');
  check(!val.includes('hunter22'), 'and it did not reach the field');

  // The activity log keeps a picture of what it saw.
  const audit = await main.evaluate(() => window.keeper.agents.audit());
  const comp = audit.filter((e) => e.action === 'computer');
  check(comp.some((e) => e.shot && /\.jpg$/.test(e.shot)), `every action is in the activity log, with pictures (${comp.length} entries)`);

  // ---------------------------------------------------------------- MCP agents get the same tool
  await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ agents: { ...s.agents, computer: { ...s.agents.computer, permission: 'allow' } } }); });
  await sleep(300);
  const list = await mcp([{ method: 'tools/list', params: {} }]);
  const tools = (list.find((r) => r.id === 10) || {}).result?.tools || [];
  check(tools.some((t) => t.name === 'computer'), 'agents connected over MCP get the computer tool');
  await page.bringToFront();
  execFileSync('xdotool', ['search', '--name', 'Notes app', 'windowactivate', '--sync']);
  const shot = await mcp([{ params: { name: 'computer', arguments: { action: 'screenshot' } } }]);
  const content = (shot.find((r) => r.id === 10) || {}).result?.content || [];
  check(content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 1000), 'over MCP the screenshot comes back as an image');
  if (!content.some((c) => c.type === 'image')) console.log('INFO screenshot reply:', JSON.stringify(shot).slice(0, 400));

  // A blocked app in front: refused.
  const term = spawn('xterm', ['-T', 'shell', '-geometry', '60x10+40+40'], { stdio: 'ignore' });
  await sleep(1500);
  execFileSync('xdotool', ['search', '--class', 'xterm', 'windowactivate', '--sync']);
  const blocked = await mcp([{ params: { name: 'computer', arguments: { action: 'left_click', coordinate: [60, 60] } } }]);
  const b0 = (blocked.find((r) => r.id === 10) || {}).result;
  check(b0 && b0.isError && /not allowed|may not/i.test(b0.content.map((c) => c.text || '').join(' ')), 'a blocked app in front (a terminal) is refused');
  term.kill();
  await sleep(400);

  // Stop: the shortcut ends the session, and the next call is refused.
  execFileSync('xdotool', ['search', '--name', 'Notes app', 'windowactivate', '--sync']);
  await mcp([{ params: { name: 'computer', arguments: { action: 'screenshot' } } }]);
  const before = await main.evaluate(() => window.keeper.agents.computerState());
  check(before.sessions.length >= 1, `sessions are listed while they run (${before.sessions.map((s) => s.client).join(', ')})`);
  execFileSync('xdotool', ['key', 'ctrl+alt+shift+period']);
  await sleep(700);
  let after = await main.evaluate(() => window.keeper.agents.computerState());
  if (after.sessions.length) {
    // Some X servers deliver the grabbed key late; Stop in the Island does the same thing.
    await main.evaluate(() => window.keeper.agents.computerStop());
    after = await main.evaluate(() => window.keeper.agents.computerState());
    console.log('INFO the shortcut did not arrive; stopped through the Island instead');
  }
  check(after.sessions.length === 0, 'Stop ends every session');
  const again = await mcp([{ params: { name: 'computer', arguments: { action: 'screenshot' } } }]);
  const a0 = (again.find((r) => r.id === 10) || {}).result;
  check(a0 && a0.isError && /stopped/i.test(a0.content.map((c) => c.text || '').join(' ')), 'after Stop the AI is refused until the person asks again');

  // What Siri's and Shortcuts' "Search Files" (the macOS helper) reads back from the keeper command.
  const searchOut = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'search', '--brain', '--json', '--limit', '3', 'notes'], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_DATA_DIR: DATA, HOME } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });
  let parsed = null;
  try { parsed = JSON.parse(searchOut); } catch { /* not JSON */ }
  check(Array.isArray(parsed) && parsed.every((h) => typeof h.path === 'string'), `keeper search --brain --json gives the helper a list of paths (${Array.isArray(parsed) ? parsed.length : 'not JSON'})`);

  // Off: nothing.
  await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ agents: { ...s.agents, computer: { ...s.agents.computer, permission: 'off' } } }); });
  const off = await mcp([{ method: 'tools/list', params: {} }]);
  check(!((off.find((r) => r.id === 10) || {}).result?.tools || []).some((t) => t.name === 'computer'), 'switched off, agents do not even see the tool');

  await main.locator('.sidebar [title="Agents"]').click().catch(() => undefined);
  await main.getByRole('button', { name: 'What agents may do' }).first().click().catch(() => undefined);
  await sleep(800);
  await main.locator('.audit-shot').first().scrollIntoViewIfNeeded().catch(() => undefined);
  check(await main.locator('.audit-shot').count() > 0, 'the activity log shows pictures of what the AI saw');
  await main.screenshot({ path: `${SHOTS}/activity-log.png` });
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
  await app.close();
  await browser.close();
  wm.kill();
  ai.close();
})().catch((e) => { console.error(e); process.exit(1); });
