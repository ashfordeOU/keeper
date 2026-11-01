// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/agents.cjs /tmp/ka /tmp/ka-shots
// Drives the real Keeper app with a made-up home folder and a stand-in AI
// (an OpenAI-compatible server in this process):
//   - the Assistant reads a skill only when it uses it;
//   - an agent connected over MCP asks to move a file, Keeper asks the person,
//     they allow it, the file moves, and undo puts it back; a Trash request is
//     declined and nothing happens;
//   - the knowledge graph links notes and shows a node's connections;
//   - the model gateway answers OpenAI- and Anthropic-style requests, the
//     brain model cites a file, and the A2A agent card and SendMessage work.
const { _electron } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = process.argv[2];
const SHOTS = process.argv[3];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DOCS = path.join(HOME, 'Documents');
const DOWN = path.join(HOME, 'Downloads');
const NOTES = path.join(DOCS, 'Notes');
const DATA = path.join(HOME, '.config', 'Keeper');
for (const d of [DOCS, DOWN, NOTES, DATA, path.join(DOCS, 'Invoices')]) fs.mkdirSync(d, { recursive: true });

fs.writeFileSync(path.join(NOTES, 'Home.md'), '# Home\nProjects: [[Apartment move]] and [[Tax 2025]]. #index\n');
fs.writeFileSync(path.join(NOTES, 'Apartment move.md'), 'Moving in March. See [[Lease summary]]. Lena Fischer helps with the van. #home\n');
fs.writeFileSync(path.join(NOTES, 'Lease summary.md'), 'Lease with Acme Property GmbH ends 28 February. Ask Lena Fischer. Back to [[Apartment move]]. #home\n');
fs.writeFileSync(path.join(NOTES, 'Tax 2025.md'), 'Receipts from Acme Property GmbH. Deadline 31 July. #tax\n');
const INVOICE = path.join(DOWN, 'Invoice 4471.pdf');
fs.writeFileSync(INVOICE, '%PDF-1.4 invoice 4471 from Acme Corp total 4200 EUR');
const OLD = path.join(DOWN, 'old-build.zip');
fs.writeFileSync(OLD, 'zip');
const SKILL_DIR = path.join(DATA, 'skills', 'file-invoices');
fs.mkdirSync(SKILL_DIR, { recursive: true });
fs.writeFileSync(path.join(SKILL_DIR, 'SKILL.md'), '---\nname: file-invoices\ndescription: Use when the person asks to file invoices; finds PDF invoices in Downloads.\n---\n\n# File invoices\n\nSECRET-STEP: search_files for "invoice pdf", then suggest moving them to ~/Documents/Invoices.\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

// ---------------------------------------------------------------- a stand-in AI
const seen = [];
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const msgs = body.messages;
    const last = msgs[msgs.length - 1];
    const reply = (message) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })); };
    const tools = (body.tools || []).map((t) => t.function.name);
    if (!tools.length) return reply({ role: 'assistant', content: `stand-in answer to: ${last.content}` });
    const toolTurns = msgs.filter((m) => m.role === 'tool').length;
    if (last.role === 'user' && tools.includes('use_skill') && /invoice/i.test(last.content)) return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'k1', type: 'function', function: { name: 'use_skill', arguments: JSON.stringify({ name: 'file-invoices' }) } }] });
    if (last.role === 'user' || (toolTurns === 1 && /SECRET-STEP/.test(last.content))) return reply({ role: 'assistant', content: null, tool_calls: [{ id: `s${toolTurns}`, type: 'function', function: { name: 'search_files', arguments: JSON.stringify({ query: 'invoice' }) } }] });
    const found = (last.content.match(/\d+\. (\S.*?\.pdf)/) || [])[1] || 'nothing';
    reply({ role: 'assistant', content: `Found the invoice [[${found}]].` });
  });
});

/** `keeper mcp` with stdin kept open until every answer is in. */
function mcpSession(lines, expect) {
  const p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'mcp'], { env: { ...process.env, KEEPER_DATA_DIR: DATA, HOME } });
  let out = '';
  const answers = new Map();
  const done = new Promise((resolve) => {
    p.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i);
        out = out.slice(i + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) answers.set(m.id, m); } catch { /* ignore */ }
        if (expect.every((id) => answers.has(id))) { p.stdin.end(); resolve(answers); }
      }
    });
    p.on('close', () => resolve(answers));
  });
  for (const l of lines) p.stdin.write(JSON.stringify(l) + '\n');
  return done;
}

async function post(port, token, pathname, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

(async () => {
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [DOCS, DOWN],
    brain: {
      enabled: true, semantic: false, visibility: 'full', active: 'mock', pauseOnBattery: false,
      connections: [{ id: 'mock', kind: 'openai-compatible', label: 'Test AI (this computer)', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` }],
    },
    agents: { gateway: true, a2a: true, actions: true, learn: true },
  }));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  // The first-run tour covers the window; skip it.
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  await main.waitForTimeout(2500);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  for (let i = 0; i < 60; i++) {
    const st = await main.evaluate(() => window.keeper.brain.status());
    if (st.withText >= 5) break;
    await main.waitForTimeout(1000);
  }

  // ---- the Assistant uses a skill, reading it only when needed
  await main.locator('.sidebar [title="Assistant"]').click();
  await main.waitForSelector('.composer textarea', { timeout: 10000 });
  await main.fill('.composer textarea', 'Please file my invoices');
  await main.keyboard.press('Enter');
  await main.waitForSelector('.cite', { timeout: 20000 });
  const first = seen.find((b) => b.tools && b.messages[b.messages.length - 1].role === 'user' && /invoices/.test(b.messages[b.messages.length - 1].content));
  check(!!first && first.messages[0].content.includes('file-invoices: Use when') && !first.messages[0].content.includes('SECRET-STEP'), 'the skill list (names only) went up front, not the skill itself');
  check(seen.some((b) => b.messages.some((m) => m.role === 'tool' && m.content.includes('SECRET-STEP'))), 'the AI read the skill with use_skill when it chose to');
  check(/Invoice 4471\.pdf/.test(await main.locator('.cite').first().innerText()), 'the answer cites the invoice');
  check(await main.locator('button', { hasText: 'Save as skill' }).count() > 0, '“Save as skill” is offered under the answer');

  // ---- an agent asks to move a file: Keeper asks first, then it moves, then undo
  const session = mcpSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Test Agent', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'move_files', arguments: { paths: [INVOICE], to: path.join(DOCS, 'Invoices') } } },
  ], [1, 2, 3]);
  await main.waitForSelector('.approval', { timeout: 15000 });
  const prompt = await main.locator('.approval').innerText();
  check(/Test Agent/.test(prompt) && /move “Invoice 4471\.pdf” to/.test(prompt), `Keeper asks before an agent moves a file (“${prompt.split('\n').find((l) => /wants/.test(l)) ?? prompt.slice(0, 80)}”)`);
  check(fs.existsSync(INVOICE), 'nothing has moved while Keeper is asking');
  await main.screenshot({ path: `${SHOTS}/approval-light.png` });
  await main.locator('.approval button', { hasText: 'Allow once' }).click();
  const a1 = await session;
  const names = (a1.get(2)?.result?.tools ?? []).map((t) => t.name);
  check(names.includes('move_files') && names.includes('graph_neighbors') && names.includes('why_slow'), 'agents see the action, graph and performance tools');
  const moved = path.join(DOCS, 'Invoices', 'Invoice 4471.pdf');
  check(/Moved 1/.test(a1.get(3)?.result?.content?.[0]?.text ?? '') && fs.existsSync(moved) && !fs.existsSync(INVOICE), 'after “Allow once” the file moved');
  const hist = await main.evaluate(() => window.keeper.history.list());
  check(hist.some((h) => /Test Agent: moved 1 item/.test(h.title)), 'the move is in History under the agent\'s name');

  const session2 = mcpSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Test Agent', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'undo_last', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'trash_files', arguments: { paths: [OLD] } } },
  ], [1, 2, 3]);
  await main.waitForSelector('.approval', { timeout: 15000 });
  check(/send “old-build\.zip” to the Trash/.test(await main.locator('.approval').innerText()) && (await main.locator('.approval.destructive').count()) === 1, 'a Trash request is marked as able to lose work');
  await main.locator('.approval button', { hasText: "Don't allow" }).click();
  const a2 = await session2;
  check(/Undone/.test(a2.get(2)?.result?.content?.[0]?.text ?? '') && fs.existsSync(INVOICE) && !fs.existsSync(moved), 'undo_last put the file back (undo needs no approval)');
  check(a2.get(3)?.result?.isError && fs.existsSync(OLD), 'declining leaves the file where it was, and the agent is told');
  const audit = await main.evaluate(() => window.keeper.agents.audit());
  check(audit.some((e) => e.status === 'denied' && e.action === 'trash_files') && audit.some((e) => e.status === 'done' && e.action === 'move_files'), 'what agents did (and were refused) is listed');

  // ---- knowledge graph
  const g = await main.evaluate(() => window.keeper.agents.graph());
  const link = (a, b) => g.edges.some((e) => e.type === 'link' && [e.a, e.b].includes(`f:${a}`) && [e.a, e.b].includes(`f:${b}`));
  check(link(path.join(NOTES, 'Home.md'), path.join(NOTES, 'Apartment move.md')) && link(path.join(NOTES, 'Lease summary.md'), path.join(NOTES, 'Apartment move.md')), 'the graph links notes by their [[links]] (and back)');
  check(g.nodes.some((n) => n.type === 'entity' && n.label === 'Lena Fischer') && g.nodes.some((n) => n.type === 'tag' && n.label === '#home'), 'names mentioned in two notes and #tags become nodes');
  await main.locator('.sidebar [title="Knowledge Graph"]').click();
  await main.waitForSelector('.graph-canvas', { timeout: 10000 });
  await main.waitForTimeout(1500);
  await main.fill('.graph-page input[placeholder="Find in the graph"]', 'Lease');
  await main.keyboard.press('Enter');
  await main.waitForSelector('.graph-side', { timeout: 5000 });
  const side = await main.locator('.graph-side').innerText();
  check(/Lease summary\.md/.test(side) && /Apartment move\.md/.test(side), 'finding a node shows its links (Lease summary → Apartment move)');
  await main.screenshot({ path: `${SHOTS}/graph-light.png` });

  // ---- the gateway and A2A
  const gw = await main.evaluate(() => window.keeper.agents.gateway());
  check(gw.on && gw.port > 0 && gw.token.length >= 32, `the gateway listens on 127.0.0.1:${gw.port} with a token`);
  const unauth = await fetch(`http://127.0.0.1:${gw.port}/v1/models`);
  check(unauth.status === 401, 'without the token the gateway refuses');
  const c1 = await post(gw.port, gw.token, '/v1/chat/completions', { model: 'keeper/mock', messages: [{ role: 'user', content: 'Say hi' }] });
  check(c1.status === 200 && JSON.parse(c1.text).choices[0].message.content === 'stand-in answer to: Say hi', '/v1/chat/completions answers through the chosen connection');
  const c2 = await post(gw.port, gw.token, '/v1/chat/completions', { model: 'keeper/brain', stream: true, messages: [{ role: 'user', content: 'Which invoice did I get?' }] });
  check(c2.status === 200 && /Invoice 4471\.pdf/.test(c2.text) && /data: \[DONE\]/.test(c2.text), 'keeper/brain streams an answer grounded in the files');
  const c3 = await post(gw.port, gw.token, '/v1/messages', { model: 'keeper/mock', max_tokens: 100, messages: [{ role: 'user', content: 'Hello' }] }, { 'anthropic-version': '2023-06-01' });
  check(c3.status === 200 && JSON.parse(c3.text).content[0].text === 'stand-in answer to: Hello', '/v1/messages answers in the Anthropic format');
  const card = await (await fetch(`http://127.0.0.1:${gw.port}/.well-known/agent-card.json`)).json();
  check(card.name === 'Keeper' && card.supportedInterfaces[0].protocolBinding === 'JSONRPC' && card.skills.some((s) => s.id === 'file-invoices'), 'the A2A agent card lists Keeper and its skills');
  const t = await post(gw.port, gw.token, '/a2a', { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'Which invoice came in?' }] } } }, { 'A2A-Version': '1.0' });
  const task = JSON.parse(t.text).result.task;
  check(task.status.state === 'TASK_STATE_COMPLETED' && /Invoice 4471/.test(task.artifacts[0].parts[0].text), 'another agent hands Keeper a task over A2A and gets the answer');
  const evil = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: gw.port, path: '/v1/models', headers: { authorization: `Bearer ${gw.token}`, host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0)));
  check(evil === 403, 'requests for another host name are refused (no DNS rebinding)');

  // ---- the Agents page, light and dark
  for (const [tab, name] of [['connect', 'agents-connect'], ['services', 'agents-services'], ['permissions', 'agents-permissions'], ['skills', 'agents-skills'], ['gateway', 'agents-gateway'], ['learning', 'agents-learning']]) {
    await main.locator('.sidebar [title="Agents"]').click();
    await main.locator('.agents-tabs button', { hasText: { connect: 'Agents & apps', services: 'AI services', permissions: 'What agents may do', skills: 'Skills', gateway: 'Gateway', learning: 'Learning' }[tab] }).click();
    await main.waitForTimeout(500);
    await main.screenshot({ path: `${SHOTS}/${name}-light.png` });
  }
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await main.waitForTimeout(600);
  await main.locator('.agents-tabs button', { hasText: 'What agents may do' }).click();
  await main.waitForTimeout(400);
  await main.screenshot({ path: `${SHOTS}/agents-permissions-dark.png` });
  await main.locator('.sidebar [title="Knowledge Graph"]').click();
  await main.waitForTimeout(1500);
  await main.screenshot({ path: `${SHOTS}/graph-dark.png` });

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  ai.close();
})().catch((e) => { console.error(e); process.exit(1); });
