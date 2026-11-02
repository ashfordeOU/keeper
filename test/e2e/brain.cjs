// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/brain.cjs /tmp/kb /tmp/kb-shots [models-dir]
// Drives the real Keeper app with a made-up home folder and a stand-in AI
// (a tiny OpenAI-compatible server in this process): the brain reads the
// files, the Assistant asks, the AI calls search_files, the answer cites the
// file. Then `keeper mcp` and `keeper ask` talk to the running app.
// With a models dir holding multilingual-e5-small, meaning search runs too.
const { _electron } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const HOME = process.argv[2];
const SHOTS = process.argv[3];
const MODELS = process.argv[4];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DOCS = path.join(HOME, 'Documents');
const DATA = path.join(HOME, '.config', 'Keeper');
for (const d of [DOCS, path.join(HOME, 'Downloads'), DATA, path.join(HOME, '.cursor')]) fs.mkdirSync(d, { recursive: true });

function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = zlib.deflateRawSync(Buffer.from(text)), n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(text.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(text.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); central.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const LEASE = path.join(DOCS, 'Lease agreement.docx');
fs.writeFileSync(LEASE, zip({ 'word/document.xml': '<w:document><w:body><w:p><w:t>Apartment lease, flat 4B.</w:t></w:p><w:p><w:t>The security deposit is two months of rent (2,400 EUR) and the landlord returns it within 30 days of moving out.</w:t></w:p></w:body></w:document>' }));
fs.writeFileSync(path.join(DOCS, 'kubernetes-plan.md'), '# Migration\n\nMove the payments cluster to Kubernetes in March. Owner: Priya.\n');
fs.writeFileSync(path.join(DOCS, 'router.txt'), 'Home router\nwifi password: blue-otter-42\n');
fs.writeFileSync(path.join(HOME, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

// ---------------------------------------------------------------- a stand-in AI
const seen = [];
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const last = body.messages[body.messages.length - 1];
    const reply = (message) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })); };
    if (!body.tools) return reply({ role: 'assistant', content: 'ready' });
    if (last.role === 'user') return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: JSON.stringify({ query: 'security deposit' }) } }] });
    const found = (last.content.match(/\d+\. (\S.*?\.docx)/) || [])[1] || 'nothing';
    reply({ role: 'assistant', content: `The deposit is two months of rent, 2,400 EUR [[${found}]].` });
  });
});

function runCli(args, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), ...args], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_DATA_DIR: DATA, HOME } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

(async () => {
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  if (MODELS) fs.symlinkSync(path.resolve(MODELS), path.join(DATA, 'models'));
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [DOCS, path.join(HOME, 'Downloads')],
    brain: {
      enabled: true, semantic: !!MODELS, visibility: 'full', active: 'mock', pauseOnBattery: false,
      connections: [
        { id: 'anthropic', kind: 'anthropic', label: 'Claude', model: 'claude-opus-5-5' },
        { id: 'mock', kind: 'openai-compatible', label: 'Test AI (this computer)', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` },
      ],
    },
  }));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  let st;
  for (let i = 0; i < 60; i++) {
    st = await main.evaluate(() => window.keeper.brain.status());
    if (st.withText >= 3 && (!MODELS || (st.semantic === 'ready' && st.pending === 0 && st.embedded > 0))) break;
    await main.waitForTimeout(1000);
  }
  check(st.withText >= 3, `the brain read the text of ${st.withText} files (Word, Markdown, text)`);
  if (MODELS) check(st.semantic === 'ready' && st.embedded >= 3 && st.pending === 0, `meaning search built ${st.embedded} vectors in a worker (${st.semantic})`);

  const words = await main.evaluate(() => window.keeper.brain.search('security deposit landlord'));
  check(words[0] && words[0].path.endsWith('Lease agreement.docx') && /deposit/.test(words[0].snippet || ''), 'word search finds the lease inside a .docx, with the passage');
  if (MODELS) {
    const meaning = await main.evaluate(() => window.keeper.brain.search('how much money do I get back when I move out', { mode: 'meaning' }));
    check(meaning[0] && meaning[0].path.endsWith('Lease agreement.docx'), `meaning search finds the lease without shared words (${meaning.map((h) => path.basename(h.path)).join(', ')})`);
  }

  // The Assistant with the stand-in AI: a tool call, then an answer that cites the file.
  await main.getByRole('button', { name: 'Assistant', exact: true }).click().catch(() => main.locator('.sidebar [title="Assistant"]').click());
  await main.waitForSelector('.composer textarea', { timeout: 10000 });
  await main.fill('.composer textarea', 'How big is my rent deposit?');
  await main.keyboard.press('Enter');
  await main.waitForSelector('.cite', { timeout: 20000 });
  const cite = await main.locator('.cite').first().innerText();
  check(/Lease agreement\.docx/.test(cite), `the answer cites the lease (${cite.trim()})`);
  const toolResult = seen.find((b) => b.messages.some((m) => m.role === 'tool'));
  check(!!toolResult && toolResult.messages.find((m) => m.role === 'tool').content.includes('Lease agreement.docx'), 'the AI called search_files and got the lease back');
  check(seen.some((b) => b.tools && b.tools.some((t) => t.function.name === 'propose_actions')), 'the AI is offered propose_actions (suggestions only)');
  await main.locator('.trace summary').first().click().catch(() => undefined);
  await main.waitForTimeout(400);
  await main.screenshot({ path: `${SHOTS}/assistant.png` });

  // `keeper mcp` and `keeper ask` through the running app.
  const mcp = await runCli(['mcp'], [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_files', arguments: { query: 'kubernetes payments' } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: path.join(DOCS, 'router.txt') } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/etc/passwd' } } }),
  ].join('\n') + '\n');
  const lines = mcp.out.trim().split('\n').map((l) => JSON.parse(l));
  const byId = (id) => lines.find((l) => l.id === id);
  check(byId(1) && byId(1).result.serverInfo.name === 'keeper' && byId(1).result.serverInfo.version !== 'offline', 'keeper mcp: initialize answered by the running app');
  check(byId(2) && byId(2).result.content[0].text.includes('kubernetes-plan.md'), 'keeper mcp: search_files finds the plan');
  check(byId(3) && byId(3).result.content[0].text.includes('[removed]') && !byId(3).result.content[0].text.includes('blue-otter-42'), 'keeper mcp: the Wi-Fi password is blanked for AI apps');
  check(byId(4) && byId(4).result.isError, 'keeper mcp: files outside the library are refused');
  const askOut = await runCli(['ask', 'What is the deposit?']);
  check(askOut.code === 0 && /two months/.test(askOut.out) && /Lease agreement\.docx/.test(askOut.out), 'keeper ask answers through the app and lists the source');

  // Connecting an AI app keeps its other servers and makes a backup.
  const r = await main.evaluate(() => window.keeper.brain.setAppConnected('cursor', true));
  const cursor = JSON.parse(fs.readFileSync(path.join(HOME, '.cursor', 'mcp.json'), 'utf8'));
  check(r.ok && cursor.mcpServers.other && cursor.mcpServers.keeper && cursor.mcpServers.keeper.args.includes('mcp'), 'Connect adds Keeper to Cursor and keeps the other server');
  check(fs.readdirSync(path.join(HOME, '.cursor')).some((f) => f.startsWith('mcp.json.keeper-backup-')), 'Connect saved a backup of the old file first');

  // Settings → AI & Brain, light and dark.
  await main.locator('.sidebar [title="Settings"]').click();
  await main.waitForTimeout(600);
  await main.evaluate(() => document.getElementById('brain')?.scrollIntoView({ block: 'start' }));
  await main.waitForTimeout(800);
  await main.screenshot({ path: `${SHOTS}/brain-settings-light.png` });
  await main.evaluate(() => document.querySelector('.apps')?.scrollIntoView({ block: 'center' }));
  await main.waitForTimeout(400);
  await main.screenshot({ path: `${SHOTS}/brain-apps-light.png` });
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.waitForTimeout(800);
  await main.evaluate(() => document.getElementById('brain')?.scrollIntoView({ block: 'start' }));
  await main.waitForTimeout(400);
  await main.screenshot({ path: `${SHOTS}/brain-settings-dark.png` });
  await main.locator('.sidebar [title="Assistant"]').click().catch(() => undefined);
  await main.waitForTimeout(800);
  await main.screenshot({ path: `${SHOTS}/assistant-dark.png` });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  ai.close();
  // The brain is saved for next time.
  check(fs.existsSync(path.join(DATA, 'brain', 'brain.json')), 'the brain was saved when Keeper quit');
})().catch((e) => { console.error(e); process.exit(1); });
