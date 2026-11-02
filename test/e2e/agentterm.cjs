// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/agentterm.cjs /tmp/kat /tmp/kat-shots
// Real Keeper, three stand-in agents of different kinds working together:
//   lead     an MCP agent ("claude", account Work) over `keeper mcp`
//   worker   an MCP agent ("codex", account Personal) over `keeper mcp`
//   plain    an agent that only reads its prompt ("aider"), reached through the bridge
// The lead opens a parent terminal and two sub-workers that run in parallel, a
// lock stops the worker clashing with it, they talk in a room, a task goes
// lead → worker → plain (handoff) and plain's answer comes back; a destructive
// command waits for the person (who says no); the person takes a terminal over
// from the Agents view; closing the parent ends its sub-workers.

const { _electron } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kat-'));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const DATA = path.join(HOME, '.config', 'Keeper');
const WORK = path.join(HOME, 'work');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}

/** A stand-in agent speaking MCP through `keeper mcp`, with its hub token in the environment. */
class McpAgent {
  constructor(token) {
    this.p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'mcp'], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_DATA_DIR: DATA, HOME, KEEPER_AGENT_TOKEN: token } });
    this.seq = 0;
    this.waiting = new Map();
    let buf = '';
    this.p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); const w = this.waiting.get(m.id); if (w) { this.waiting.delete(m.id); w(m); } } catch { /* not JSON */ }
      }
    });
  }
  rpc(method, params) {
    const id = ++this.seq;
    return new Promise((resolve) => { this.waiting.set(id, resolve); this.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  async init(name) { await this.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name } }); }
  async tool(name, args = {}) {
    const r = await this.rpc('tools/call', { name, arguments: args });
    const text = (r.result?.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: !!r.result?.isError || !!r.error, structured: r.result?.structuredContent, raw: r };
  }
  close() { this.p.stdin.end(); }
}

(async () => {
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ folders: [WORK], agents: { actions: true, permissions: { terminal: 'allow' } } }));
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', SHELL: '/bin/bash' } });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  // Skip the welcome tour and page tips (they would sit over the buttons).
  await main.evaluate(() => { for (const k of ['tour', 'home', 'terminal']) localStorage.setItem(`coach.${k}`, '1'); });
  await main.reload();
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  // The agent hub starts after the brain: wait until it answers.
  const ready = await until(() => main.evaluate(() => window.keeper.agentterm.state().then(() => true, () => false)), 60000, 500);
  check(ready, 'the agent hub is running');

  // Three agents of different kinds; plain is a prompt-only program Keeper runs in a terminal.
  const lead = await main.evaluate(() => window.keeper.agentterm.addAgent({ name: 'lead', harness: 'claude', account: 'Work', cwd: '' }));
  const worker = await main.evaluate(() => window.keeper.agentterm.addAgent({ name: 'worker', harness: 'codex', account: 'Personal' }));
  const plain = await main.evaluate((cwd) => window.keeper.agentterm.addAgent({ name: 'plain', harness: 'aider', cwd, run: `PS1='$ '; while IFS= read -r -p "> " line; do echo "ANSWER: $(echo "$line" | wc -w) words"; done` }), WORK);
  check(!!lead.token && !!worker.token && !!plain.session, 'three agents have identities (one runs in a Keeper terminal)');

  const L = new McpAgent(lead.token);
  const W = new McpAgent(worker.token);
  await L.init('lead-test');
  await W.init('worker-test');
  const me = await L.tool('hub_whoami');
  check(/lead .*claude.*Work/.test(me.text), `the lead is recognised by its token: ${me.text.split('\n')[0]}`);
  const roster = await W.tool('hub_list_agents');
  check(['lead', 'worker', 'plain'].every((n) => roster.text.includes(n)) && /claude/.test(roster.text) && /codex/.test(roster.text) && /aider/.test(roster.text), 'agents of three different kinds see each other');

  // A parent terminal and two sub-workers running in parallel.
  const parent = await L.tool('term_create', { name: 'lead main', cwd: WORK, group: 'proj' });
  const pid = parent.structured?.id;
  const k1 = (await L.tool('term_create', { name: 'kid one', parent: pid })).structured?.id;
  const k2 = (await L.tool('term_create', { name: 'kid two', parent: pid })).structured?.id;
  check(!!pid && !!k1 && !!k2, 'the lead opened a terminal and two sub-workers');
  const t0 = Date.now();
  const [r1, r2] = await Promise.all([
    L.tool('term_run', { session: k1, command: 'sleep 1; echo one-done' }),
    L.tool('term_run', { session: k2, command: 'sleep 1; echo two-done; exit_code_test=3; (exit 3)' }),
  ]);
  check(r1.text.includes('one-done') && r2.text.includes('two-done'), 'both sub-workers ran their commands');
  check(Date.now() - t0 < 4000, `they ran in parallel (${Date.now() - t0} ms for two 1-second jobs)`);
  check(/exit 3/.test(r2.text), 'the exit code comes back');
  const tree = await L.tool('term_list');
  check(tree.text.includes(k1) && /^\s{2}/m.test(tree.text), 'term_list shows the sub-workers under their parent');

  // A lock keeps the worker from clashing with the lead's sub-worker.
  check(!(await L.tool('hub_lock', { name: 'work/src', session: k1, lease_seconds: 60 })).isError, 'the lead locked work/src');
  const clash = await W.tool('hub_lock', { name: 'work/src' });
  check(clash.isError && /held by @lead/.test(clash.text), 'the worker is told the lead holds the lock');

  // They talk in a room; the @mention reaches the worker's inbox.
  await L.tool('hub_post', { room: 'proj', text: 'sub-workers finished; @worker you can take the next task' });
  const inbox = await W.tool('hub_inbox');
  check(/sub-workers finished/.test(inbox.text), 'the worker got the mention');

  // A task goes lead → worker (claims) → plain (handoff); plain answers through the bridge.
  const task = await L.tool('hub_post_task', { title: 'Count the words', room: 'proj' });
  const tid = task.structured?.id;
  check(!(await W.tool('hub_claim', { task_id: tid })).isError, `the worker claimed ${tid}`);
  const ho = await W.tool('hub_handoff', { task_id: tid, to: 'plain', summary: 'count words in this summary please' });
  check(!ho.isError && /now with @plain/.test(ho.text), 'the worker handed the task to the prompt-only agent');
  const answer = await until(async () => { const r = await W.tool('hub_inbox', { peek: true }); return /ANSWER: \d+ words/.test(r.text) ? r.text : ''; }, 30000, 1000);
  check(!!answer, 'the prompt-only agent answered through the bridge (typed in at its prompt, reply passed back)');

  // A destructive command waits for the person, who says no.
  const rm = L.tool('term_run', { session: pid, command: 'rm -rf ./nothing-here' });
  const prompt = await until(() => main.$('.approval'), 15000);
  check(!!prompt && /rm -rf/.test(await prompt.innerText()), 'the person is asked before rm -rf');
  if (prompt) await main.click('.approval button:has-text("Don\'t allow")');
  const refused = await rm;
  check(refused.isError && /did not allow/.test(refused.text), 'the command was not run');

  // The Agents view: the person takes the parent terminal over.
  await main.click('.sidebar [title="Terminal"]');
  await main.waitForSelector('.term-bar', { timeout: 20000 });
  await main.click('.term-bar button:has-text("Agents")');
  await main.waitForSelector('.agent-board .ab-term', { timeout: 10000 });
  const boardText = await main.$eval('.agent-board', (e) => e.textContent);
  check(boardText.includes('lead main') && boardText.includes('kid one') && boardText.includes('plain'), 'the Agents view lists the agents and their terminals');
  await main.screenshot({ path: path.join(SHOTS, 'agents-light.png') });
  await main.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await sleep(300);
  await main.screenshot({ path: path.join(SHOTS, 'agents-dark.png') });
  await main.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await main.click('.ab-tabs button:has-text("Task board")');
  await sleep(300);
  await main.screenshot({ path: path.join(SHOTS, 'tasks-light.png') });
  await main.click('.ab-tabs button:has-text("Rooms")');
  await sleep(500);
  await main.screenshot({ path: path.join(SHOTS, 'rooms-light.png') });
  await main.click('.ab-tabs button:has-text("Agents & terminals")');
  const row = await main.$(`.ab-term:has-text("${pid}")`);
  await row.$('button:has-text("Take over")').then((b) => b.click());
  await sleep(500);
  const blocked = await L.tool('term_write', { session: pid, text: 'echo x\r' });
  check(blocked.isError && /taken over/.test(blocked.text), 'after the person takes over, the agent cannot type');
  await main.evaluate((id) => window.keeper.agentterm.takeOver(id, true), pid);
  const back = await L.tool('term_run', { session: pid, command: 'echo handed-back' });
  check(back.text.includes('handed-back'), 'handed back, the agent works again');

  // Closing the parent ends the sub-workers and frees their lock.
  await L.tool('term_close', { session: pid });
  const after = await L.tool('term_list');
  check(!after.text.includes(k1) && !after.text.includes(k2), 'closing the parent ended both sub-workers');
  check(!(await W.tool('hub_lock', { name: 'work/src' })).isError, 'the lock went with its terminal');

  // The keeper command uses the same tools.
  const cli = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'hub', 'agents'], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', KEEPER_DATA_DIR: DATA, HOME } });
    let o = '';
    p.stdout.on('data', (d) => (o += d));
    p.on('close', () => resolve(o));
  });
  check(/@lead/.test(cli) && /@plain/.test(cli), 'keeper hub agents lists the agents');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  L.close();
  W.close();
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
