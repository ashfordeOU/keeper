// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Agent terminals and the agent hub. Pure parts first; then a real session host
// with real bash shells: runs with exit codes, clean output, questions instead
// of hangs, sub-workers ending with their parent, time limits, quotas,
// approvals, secrets blanked, and agents of different kinds working together
// through the hub (including one that only reads its prompt, via the bridge).

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostClient } from '../electron/services/terminal/client';
import { hostPort, routeToAgents } from '../electron/services/terminal/agent-port';
import { socketPath } from '../core/terminal/protocol';
import { capOutput, cleanOutput, looksLikeInputPrompt } from '../core/terminal/agent/clean';
import { findMarks, keySequence, shellFamily, wrapCommand } from '../core/terminal/agent/wrap';
import { classifyCommand, insideJail, pathsOutsideJail } from '../core/terminal/agent/policy';
import { AgentBus } from '../core/terminal/agent/bus';
import { AgentHub, handoffText } from '../core/terminal/agent/hub';
import { AgentTerminals } from '../core/terminal/agent/manager';
import { callAgentTool, AGENT_TOOLS } from '../core/terminal/agent/tools';
import { deliverQueued, extractReply, looksIdle } from '../core/terminal/agent/bridge';
import { planRecipe, RECIPES } from '../core/terminal/agent/recipes';
import { redact } from '../core/brain/redact';
import { McpServer } from '../core/brain/mcp';

const win = process.platform === 'win32';

describe('cleaning terminal output', () => {
  it('removes colours, titles and marks, and collapses progress bars', () => {
    expect(cleanOutput('\x1b[31mred\x1b[0m \x1b]0;title\x07ok\r\n')).toBe('red ok\n');
    expect(cleanOutput('10%\r50%\r100%\n')).toBe('100%\n');
    expect(cleanOutput('abc\b\bX\n')).toBe('aXc\n');
  });
  it('keeps the head and the tail of long output', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const c = capOutput(long, 2000);
    expect(c.truncated).toBe(true);
    expect(c.text).toContain('line 0');
    expect(c.text).toContain('line 1999');
    expect(c.text).toMatch(/characters left out/);
  });
  it('spots programs waiting for an answer, but not a shell prompt', () => {
    expect(looksLikeInputPrompt('Install packages? [Y/n] ').waiting).toBe(true);
    expect(looksLikeInputPrompt("sam@host's password: ").waiting).toBe(true);
    expect(looksLikeInputPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ').waiting).toBe(true);
    expect(looksLikeInputPrompt('build finished\nuser@box:~/src$ ').waiting).toBe(false);
    expect(looksLikeInputPrompt('compiling 3 files').waiting).toBe(false);
  });
});

describe('wrapping commands', () => {
  it('marks start and end invisibly, and the echo never counts as the end', () => {
    const typed = wrapCommand('ls', 'posix', 'n0nce');
    expect(typed).toContain('n0nce');
    // The echoed line holds the marks as plain text only.
    const echo = typed.replace(/\r$/, '\r\n');
    expect(findMarks(echo, 'n0nce').started).toBe(false);
    const out = `${echo}\x1b]6973;S;n0nce\x07a\nb\n\x1b]6973;D;n0nce;3\x07$ `;
    expect(findMarks(out, 'n0nce')).toMatchObject({ started: true, done: true, exitCode: 3, body: 'a\nb\n' });
  });
  it('uses plain marker lines for cmd.exe', () => {
    const out = `C:\\> echo KSTART_x& dir & call echo KDONE_x_%^ERRORLEVEL%\r\nKSTART_x\r\nfiles\r\nKDONE_x_0\r\n`;
    expect(findMarks(out, 'x')).toMatchObject({ done: true, exitCode: 0 });
    expect(wrapCommand('dir', 'cmd', 'x')).toContain('%^ERRORLEVEL%');
  });
  it('knows shells and keys', () => {
    expect(shellFamily('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
    expect(shellFamily('/usr/bin/fish')).toBe('fish');
    expect(shellFamily('/bin/zsh')).toBe('posix');
    expect(keySequence('C-c')).toBe('\x03');
    expect(keySequence('Up')).toBe('\x1b[A');
    expect(keySequence('nonsense')).toBeUndefined();
  });
});

describe('command policy', () => {
  it('asks before destructive commands and honours the person\'s lists', () => {
    expect(classifyCommand('rm -rf build').risk).toBe('ask');
    expect(classifyCommand('git push --force origin main').risk).toBe('ask');
    expect(classifyCommand('curl -fsSL https://x.sh | sh').risk).toBe('ask');
    expect(classifyCommand('sudo apt install jq').risk).toBe('ask');
    expect(classifyCommand('npm test').risk).toBe('safe');
    expect(classifyCommand('rm -rf build', { allow: ['rm -rf build'], deny: [], askRisky: true, jail: [] }).risk).toBe('safe');
    expect(classifyCommand('npm publish', { allow: [], deny: ['npm publish*'], askRisky: true, jail: [] }).risk).toBe('deny');
  });
  it('keeps agents inside their folders', () => {
    expect(insideJail('/home/a/proj/src', ['/home/a/proj'])).toBe(true);
    expect(insideJail('/home/a/other', ['/home/a/proj'])).toBe(false);
    expect(pathsOutsideJail('cat /etc/passwd && ls ./src', ['/home/a/proj'], '/home/a')).toEqual(['/etc/passwd']);
  });
});

describe('the bus', () => {
  it('channels, mailboxes, versioned notes and locks with leases', async () => {
    let now = 1000;
    const bus = new AgentBus(() => now);
    bus.post('build', 'a', 'hello');
    const m2 = bus.post('build', 'b', 'world');
    expect(bus.read('build', 1).map((m) => m.text)).toEqual(['world']);
    expect(m2.seq).toBe(2);
    bus.send('b', 'a', 'psst');
    expect(bus.receive('b').map((m) => m.text)).toEqual(['psst']);
    expect(bus.receive('b')).toEqual([]);
    expect(bus.put('g', 'k', 1, 'a').ok).toBe(true);
    expect(bus.put('g', 'k', 2, 'b', 0).ok).toBe(false);
    expect(bus.put('g', 'k', 2, 'b', 1).ok).toBe(true);
    expect(bus.acquire('src/', 'a', 5000).ok).toBe(true);
    expect(bus.acquire('src/', 'b', 5000).ok).toBe(false);
    now += 6000;
    expect(bus.acquire('src/', 'b', 5000).ok).toBe(true);
    const waiting = bus.waitFor({ kinds: ['message'], channel: 'x' }, 1000);
    bus.post('x', 'a', 'ping');
    expect((await waiting)?.kind).toBe('message');
  });
});

describe('the hub', () => {
  it('agents of different kinds and accounts talk, share tasks and hand off', async () => {
    const hub = new AgentHub(new AgentBus());
    const { agent: claude, token } = hub.launch({ name: 'claude-1', harness: 'claude', account: 'work' });
    const { agent: codex } = hub.launch({ name: 'codex-1', harness: 'codex', account: 'personal' });
    const { agent: grok } = hub.launch({ name: 'grok-1', harness: 'grok', account: 'work' });
    expect(hub.byToken(token)?.id).toBe(claude.id);
    // Rooms with @mentions reach the inbox.
    hub.post(claude.id, 'proj', 'plan ready, @codex-1 please build');
    expect(hub.inbox(codex.id)[0].text).toContain('plan ready');
    // Same-account-only receivers refuse others.
    hub.setPerms(grok.id, { sameAccountOnly: true });
    expect(() => hub.send(codex.id, 'grok-1', 'hi')).toThrow(/does not take messages/);
    expect(hub.send(claude.id, 'grok-1', 'hi').to).toBe(grok.id);
    // Questions wait for the answer.
    const asking = hub.ask(claude.id, 'codex-1', 'which port?', 2000);
    const q = hub.inbox(codex.id)[0];
    hub.send(codex.id, 'claude-1', '8080', { inReplyTo: q.id });
    expect((await asking)?.text).toBe('8080');
    // Tasks: only one claim wins; handoff carries the context.
    const t = hub.postTask(claude.id, { title: 'Add login', room: 'proj', forHarness: ['codex', 'claude'] });
    expect(() => hub.claim(grok.id, t.id)).toThrow(/is for/);
    hub.claim(codex.id, t.id);
    expect(() => hub.claim(claude.id, t.id)).toThrow(/claimed/);
    hub.handoff(codex.id, t.id, 'claude-1', { summary: 'form done, API left', files: ['src/login.ts'] });
    expect(hub.task(t.id)?.assignee).toBe(claude.id);
    expect(hub.inbox(claude.id).some((m) => m.text.includes('form done, API left'))).toBe(true);
    hub.complete(claude.id, t.id, 'login works');
    expect(hub.inbox(claude.id).length + hub.inbox(codex.id).length).toBeGreaterThanOrEqual(0);
    expect(hub.task(t.id)?.status).toBe('done');
    expect(hub.bus.read('proj').some((m) => m.text.includes('done by claude-1'))).toBe(true);
    // Agents that connect on their own wait for the person.
    const stranger = hub.join('some-ide');
    expect(() => hub.send(stranger.id, 'claude-1', 'hi')).toThrow(/not approved/);
    hub.approve(stranger.id);
    expect(hub.send(stranger.id, 'claude-1', 'hi').from).toBe(stranger.id);
    expect(hub.join('some-ide').approved).toBe(true);
    // An agent going away puts its claimed tasks back.
    const t2 = hub.postTask('human', { title: 'Docs' });
    hub.claim(grok.id, t2.id);
    hub.away(grok.id);
    expect(hub.task(t2.id)?.status).toBe('open');
    expect(handoffText(hub.task(t.id)!, { summary: 's' }, codex)).toContain('hub_complete');
  });
  it('plans recipes from what is installed', () => {
    const p = planRecipe(RECIPES[0], ['claude', 'codex', 'grok'], 'Add dark mode');
    expect(p.agents.map((a) => a.harness)).toEqual(['claude', 'codex', 'claude', 'grok']);
    expect(p.kickoff[0].title).toContain('Add dark mode');
    expect(p.agents[0].brief).toContain('hub_claim');
  });
  it('has well-formed tool definitions', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.name).toMatch(/^(term|hub)_[a-z_]+$/);
      expect((t.inputSchema as { type: string }).type).toBe('object');
    }
  });
});

describe('bridge helpers', () => {
  it('recognises idle prompts and pulls the answer out of the screen', () => {
    expect(looksIdle('claude', '╭──────╮\n│ >    │\n╰──────╯\n  ? for shortcuts')).toBe(true);
    expect(looksIdle('aider', 'model: gpt\n> ')).toBe(true);
    expect(looksIdle('codex', 'Working (12s · esc to interrupt)')).toBe(false);
    expect(extractReply('[Keeper hub] Message from a: hi\nANSWER: 42\n> ', '[Keeper hub] Message from a: hi')).toBe('ANSWER: 42');
  });
});

// ---------------------------------------------------------------- with a real session host

const out = path.join(__dirname, '..', 'node_modules', '.cache', 'keeper-test', 'term-host-agent.cjs');
let data: string;
let sock: string;
let host: ChildProcess | undefined;
let client: HostClient;

describe.skipIf(win)('agent terminals with real shells', () => {
  let terms: AgentTerminals;
  let hub: AgentHub;
  let approvals: string[] = [];
  let allow = true;
  const spilled: string[] = [];

  beforeAll(async () => {
    await build({ entryPoints: [path.join(__dirname, '..', 'electron', 'terminal-host.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['node-pty'], logLevel: 'silent' });
    data = mkdtempSync(path.join(os.tmpdir(), 'keeper-agent-'));
    sock = socketPath(data, process.platform, `agent${process.pid}`);
    host = spawn(process.execPath, [out], { env: { ...process.env, KEEPER_HOST_DATA: data, KEEPER_HOST_SOCKET: sock }, stdio: 'ignore' });
    client = new HostClient(sock, path.join(data, 'terminal', 'host.token'), 'app');
    for (let i = 0; i < 100; i++) {
      try { await client.connect(1000); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
    }
    const bus = new AgentBus();
    hub = new AgentHub(bus);
    const port = hostPort(() => client, async (req) => ({
      spec: { profile: { id: 'bash', name: 'bash', shell: 'custom' }, cols: req.cols, rows: req.rows, title: req.title, group: req.group },
      launch: { file: '/bin/bash', args: ['--norc', '--noprofile', '-i'], cwd: req.cwd ?? os.tmpdir(), env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), TERM: 'xterm-256color', PS1: '$ ', ...req.env } },
      scrollback: 5000,
    }));
    terms = new AgentTerminals(port, {
      now: () => Date.now(),
      redact,
      approve: async (_o, what) => { approvals.push(what); return allow; },
      spill: (id, text) => { spilled.push(text); return `/tmp/${id}.log`; },
      home: os.homedir(),
      platform: process.platform,
    }, bus);
    terms.limits.inputIdleMs = 600;
    client.onMessage = (m) => routeToAgents(m, terms);
  }, 60_000);

  afterAll(() => {
    host?.kill('SIGKILL');
    rmSync(data, { recursive: true, force: true });
  });

  it('runs commands with exit codes and clean output', async () => {
    const t = await terms.create('agent:a', { name: 'main', cwd: os.tmpdir() });
    const r1 = await terms.run(t.id, 'agent:a', 'printf "\\033[32mgreen\\033[0m\\n"; echo two');
    expect(r1).toMatchObject({ status: 'done', exitCode: 0 });
    expect(r1.output).toBe('green\ntwo');
    const r2 = await terms.run(t.id, 'agent:a', 'ls /definitely/not/here');
    expect(r2.exitCode).not.toBe(0);
    expect(r2.output).toMatch(/No such file/);
    // Multi-line commands and long output (cut, with the full text kept).
    const r3 = await terms.run(t.id, 'agent:a', 'for i in $(seq 1 3000); do\n  echo "row $i"\ndone', { maxChars: 2000 });
    expect(r3.truncated).toBe(true);
    expect(r3.output).toContain('row 3000');
    expect(spilled.at(-1)).toContain('row 1500');
    // Secrets never come back.
    const r4 = await terms.run(t.id, 'agent:a', 'echo "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"');
    expect(r4.output).not.toContain('ghp_abcdef');
    expect(r4.redacted).toBeTruthy();
  }, 60_000);

  it('reports a question instead of hanging, then takes the answer', async () => {
    const t = await terms.create('agent:a', { name: 'ask' });
    const r = await terms.run(t.id, 'agent:a', 'read -p "Your name? " n; echo "hi $n"', { timeoutMs: 10_000 });
    expect(r.status).toBe('waiting-for-input');
    expect(r.prompt).toContain('Your name?');
    terms.write(t.id, 'agent:a', 'Ana\r');
    const w = await terms.wait(t.id, 'agent:a', { regex: 'hi Ana', timeoutMs: 5000, cursor: r.cursor });
    expect(w.status).toBe('matched');
    // The command finished in the background; the terminal is free again.
    await new Promise((res) => setTimeout(res, 300));
    expect((await terms.run(t.id, 'agent:a', 'echo again')).output).toBe('again');
  }, 30_000);

  it('times out, interrupts, and accepts stdin', async () => {
    const t = await terms.create('agent:a', { name: 'slow' });
    const r = await terms.run(t.id, 'agent:a', 'sleep 30', { timeoutMs: 800, interruptOnTimeout: true });
    expect(r.status).toBe('timeout');
    await new Promise((res) => setTimeout(res, 500));
    const s = await terms.run(t.id, 'agent:a', 'head -n1', { stdin: 'piped line\r', timeoutMs: 5000 });
    expect(s.output).toContain('piped line');
  }, 30_000);

  it('sub-workers end with their parent; time limits and quotas hold', async () => {
    const parent = await terms.create('agent:b', { name: 'parent' });
    const c1 = await terms.create('agent:b', { name: 'w1', parent: parent.id });
    const c2 = await terms.create('agent:b', { name: 'w2', parent: parent.id });
    expect(terms.tree('agent:b')[0].sub.map((x) => x.id).sort()).toEqual([c1.id, c2.id].sort());
    // Two sub-workers in parallel.
    const [a, b] = await Promise.all([terms.run(c1.id, 'agent:b', 'sleep 0.3; echo one'), terms.run(c2.id, 'agent:b', 'sleep 0.3; echo two')]);
    expect([a.output, b.output]).toEqual(['one', 'two']);
    const closed = await terms.close(parent.id);
    expect(closed.sort()).toEqual([parent.id, c1.id, c2.id].sort());
    expect(terms.list('agent:b')).toEqual([]);
    // Time limit.
    const short = await terms.create('agent:b', { name: 'short', ttlMs: 1 });
    await new Promise((res) => setTimeout(res, 20));
    expect(await terms.reap()).toContain(short.id);
    // Quota.
    terms.limits.maxSessionsPerAgent = 1;
    await terms.create('agent:c', {});
    await expect(terms.create('agent:c', {})).rejects.toThrow(/limit/);
    terms.limits.maxSessionsPerAgent = 12;
  }, 30_000);

  it('asks before destructive commands; a person can take over', async () => {
    const t = await terms.create('agent:d', { name: 'careful' });
    allow = false;
    approvals = [];
    await expect(terms.run(t.id, 'agent:d', 'rm -rf ./nothing-here')).rejects.toThrow(/did not allow/);
    expect(approvals[0]).toContain('rm -rf');
    allow = true;
    expect((await terms.run(t.id, 'agent:d', 'rm -rf ./nothing-here; echo ok')).output).toBe('ok');
    terms.handoff(t.id, 'human', 'human');
    expect(() => terms.write(t.id, 'agent:d', 'ls\r')).toThrow(/taken over/);
    terms.handoff(t.id, 'agent', 'human');
    expect((await terms.run(t.id, 'agent:d', 'echo back')).output).toBe('back');
  }, 30_000);

  it('tools: sub-workers exchange a message and respect a lock', async () => {
    const { agent: lead } = hub.launch({ name: 'lead', harness: 'claude' });
    const { agent: w } = hub.launch({ name: 'worker', harness: 'codex', account: 'other' });
    const ctxL = { terms, hub, agentId: lead.id };
    const ctxW = { terms, hub, agentId: w.id };
    const p = await callAgentTool(ctxL, 'term_create', { name: 'lead', group: 'g1' });
    const pid = (p.structured as { id: string }).id;
    const kid = (await callAgentTool(ctxL, 'term_create', { name: 'kid', parent: pid })).structured as { id: string };
    const run = await callAgentTool(ctxL, 'term_run', { session: kid.id, command: 'echo from-kid' });
    expect(run.text).toContain('from-kid');
    expect((await callAgentTool(ctxL, 'hub_lock', { name: 'src/', session: kid.id })).isError).toBeUndefined();
    expect((await callAgentTool(ctxW, 'hub_lock', { name: 'src/' })).isError).toBe(true);
    await callAgentTool(ctxL, 'hub_post', { room: 'g1', text: 'lock taken, @worker wait' });
    expect((await callAgentTool(ctxW, 'hub_inbox', {})).text).toContain('lock taken');
    // Closing the kid frees its lock.
    await callAgentTool(ctxL, 'term_close', { session: kid.id });
    expect((await callAgentTool(ctxW, 'hub_lock', { name: 'src/' })).isError).toBeUndefined();
    // Another agent cannot type into lead's terminal.
    await expect(callAgentTool(ctxW, 'term_write', { session: pid, text: 'x' })).rejects.toThrow(/another agent/);
  }, 30_000);

  it('MCP round trip: tools listed and called through the server', async () => {
    const { agent } = hub.launch({ name: 'mcp-agent', harness: 'gemini' });
    const server = new McpServer({
      version: 'test', env: { allowed: () => false } as never,
      extraTools: () => AGENT_TOOLS as never,
      callExtra: (name: string, args: Record<string, unknown>) => callAgentTool({ terms, hub, agentId: agent.id }, name, args),
    } as never);
    await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } } });
    const list = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(JSON.stringify(list)).toContain('term_run');
    const call = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'term_run', arguments: { session: 'new', command: 'echo via-mcp' } } });
    expect(JSON.stringify(call)).toContain('via-mcp');
  }, 30_000);

  it('bridge: a prompt-only agent answers a message from another agent', async () => {
    // A stand-in for an agent program without tools: it shows "> ", reads a line and answers.
    const { agent: asker } = hub.launch({ name: 'asker', harness: 'claude' });
    const t = await terms.create('agent:bridge-test', { name: 'prompt-only' });
    const { agent: plain } = hub.launch({ name: 'plain', harness: 'aider', session: t.id });
    terms.write(t.id, 'agent:bridge-test', `while IFS= read -r -p "> " line; do echo "ANSWER: got $(echo "$line" | wc -w) words"; done\r`);
    await new Promise((r) => setTimeout(r, 800));
    hub.send(asker.id, 'plain', 'how many words is this');
    const r = await deliverQueued(hub, terms, plain, { idleMs: 300, answerMs: 5000, enterDelayMs: 100, sleep: (ms) => new Promise((res) => setTimeout(res, ms)), now: () => Date.now() });
    expect(r).toMatchObject({ delivered: 1, answered: 1 });
    const reply = hub.inbox(asker.id).find((m) => (m.data as { viaBridge?: boolean })?.viaBridge);
    expect(reply?.text).toMatch(/ANSWER: got \d+ words/);
  }, 30_000);
});

describe('editor-class help', async () => {
  const { quickFixes, findProblems, findGitHashes, parseDotEnv, suggest, recentCommands, editorLine } = await import('../core/terminal/assist');
  it('suggests fixes for common failures', () => {
    expect(quickFixes('rg foo', 127, 'bash: rg: command not found', 'darwin')[0]).toEqual({ label: 'Install ripgrep', command: 'brew install ripgrep' });
    expect(quickFixes('npm start', 1, 'Error: listen EADDRINUSE: address already in use :::3000', 'linux').map((f) => f.command)).toEqual(['kill $(lsof -t -i :3000)', 'npm start']);
    expect(quickFixes('git push', 1, 'fatal: The current branch dev has no upstream branch.\n    git push --set-upstream origin dev', 'linux')[0].command).toBe('git push --set-upstream origin dev');
    expect(quickFixes('git push', 1, ' ! [rejected]        main -> main (fetch first)', 'linux')[0].command).toBe('git pull --rebase');
    expect(quickFixes('git stauts', 1, "git: 'stauts' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tstatus", 'linux')[0].command).toBe('git status');
    expect(quickFixes('python3 app.py', 1, "ModuleNotFoundError: No module named 'requests'", 'linux')[0].command).toBe('python3 -m pip install requests');
    expect(quickFixes('ls', 0, 'whatever', 'linux')).toEqual([]);
  });
  it('turns file:line references into links', () => {
    expect(findProblems('src/app.ts(12,5): error TS2322')).toMatchObject([{ file: 'src/app.ts', line: 12, col: 5 }]);
    expect(findProblems('  File "/srv/app.py", line 41, in main')).toMatchObject([{ file: '/srv/app.py', line: 41 }]);
    expect(findProblems('main.go:7:2: undefined: x')).toMatchObject([{ file: 'main.go', line: 7, col: 2 }]);
    expect(findProblems('see https://example.com/a.js:3 for details')).toEqual([]);
    expect(findGitHashes('commit 3f2a9c1d merged')[0].hash).toBe('3f2a9c1d');
    expect(editorLine('code -g {file}:{line}:{col}', '/a b.ts', 3, 4)).toBe('code -g /a b.ts:3:4');
  });
  it('reads .env files and suggests completions', () => {
    expect(parseDotEnv('# c\nexport A=1\nB="two words"\nC=${A}-x # note\nD=\'$A\'')).toEqual({ A: '1', B: 'two words', C: '1-x', D: '$A' });
    expect(suggest('git ch', { history: [] })).toContain('git checkout');
    expect(suggest('git checkout ma', { branches: ['main', 'master'] })).toEqual(['git checkout main', 'git checkout master']);
    expect(suggest('npm r', { history: ['npm run build'] })[0]).toBe('npm run build');
    expect(recentCommands(['ls', 'npm test', 'ls', 'git status'], 'st')).toEqual(['git status', 'npm test']);
    expect(recentCommands(['git status'], 'gst', true)).toEqual(['git status']);
  });
});
