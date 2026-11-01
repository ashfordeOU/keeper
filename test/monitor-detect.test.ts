// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENTS, detectAgents, matchAgent, serversOnPorts } from '../core/agents-detect';
import { gitRootOf, groupDevServers, looksLikeDevServer, restartPlan, serverKind, splitCommandLine } from '../core/monitor-devservers';
import { USAGE_TOOLS } from '../core/island-tools/usage';

const id = (name: string, command = '') => matchAgent({ name, command })?.id;

describe('agent detection table', () => {
  it('has unique ids and keeps the ids the Island already uses', () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
    const island = readFileSync('core/island.ts', 'utf8');
    for (const a of AGENTS.slice(0, 2)) expect(island).toContain(`'${a.id}'`);
    expect(AGENTS[0].usage).toBe(USAGE_TOOLS[0].id);
  });

  it('recognises terminal agents by name and by script path', () => {
    expect(id(USAGE_TOOLS[0].id)).toBe(AGENTS[0].id);
    expect(id('codex')).toBe('codex');
    expect(id('node', 'node /usr/lib/node_modules/@openai/codex/bin/codex.js')).toBe('codex');
    expect(id('node', 'node /opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js')).toBe('gemini-cli');
    expect(id('gemini')).toBe('gemini-cli');
    expect(id('python3', '/usr/bin/python3 -m aider --model x')).toBe('aider');
    expect(id('aider')).toBe('aider');
    expect(id('opencode')).toBe('opencode');
    expect(id('cursor-agent')).toBe('cursor-agent');
    expect(id('node', 'node C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\index.js')).toBe('copilot-cli');
    expect(id('node', '/home/a/.npm/node_modules/@sourcegraph/amp/dist/main.js')).toBe('amp');
    expect(id('goose')).toBe('goose');
    expect(id('kiro-cli')).toBe('kiro-cli');
    expect(id('qwen')).toBe('qwen-code');
  });

  it('recognises editors and local model servers', () => {
    expect(id('Cursor')).toBe('cursor');
    expect(id('Windsurf.exe')).toBe('windsurf');
    expect(id('ollama')).toBe('ollama');
    expect(id('LM Studio')).toBe('lm-studio');
    expect(id('llama-server')).toBe('llama-cpp');
    expect(id('python3', 'python3 -m vllm.entrypoints.openai.api_server --model x')).toBe('vllm');
    expect(id('python', 'python -m sglang.launch_server')).toBe('sglang');
    expect(id('koboldcpp')).toBe('koboldcpp');
  });

  it('does not mistake ordinary programs for agents', () => {
    expect(id('node', 'node server.js')).toBeUndefined();
    expect(id('server')).toBeUndefined();
    expect(id('chat')).toBeUndefined();
    expect(id('bash', `bash -c echo ${USAGE_TOOLS[0].id}ette`)).toBeUndefined();
    expect(id('python3', 'python3 manage.py runserver')).toBeUndefined();
    expect(id('vim', 'vim aider.md')).toBeUndefined();
  });

  it('folds helpers into one session with everything it started', () => {
    const procs = [
      { pid: 1, ppid: 0, name: 'launchd' },
      { pid: 10, ppid: 1, name: 'zsh' },
      { pid: 11, ppid: 10, name: 'codex', cpu: 5, memory: 100 },
      { pid: 12, ppid: 11, name: 'codex', cpu: 1, memory: 10 },
      { pid: 13, ppid: 11, name: 'node', command: 'node vite', cpu: 20, memory: 50 },
      { pid: 14, ppid: 13, name: 'esbuild', cpu: 2, memory: 5 },
      { pid: 20, ppid: 1, name: 'ollama', cpu: 0.5, memory: 4000 },
    ];
    const a = detectAgents(procs);
    expect(a.map((x) => x.agent.id)).toEqual(['codex', 'ollama']);
    expect(a[0].pids.sort()).toEqual([11, 12, 13, 14]);
    expect(a[0].cpu).toBe(28);
    expect(a[0].memory).toBe(165);
    expect(detectAgents(procs, ['server']).map((x) => x.agent.id)).toEqual(['ollama']);
  });

  it('names model servers by their unique ports only', () => {
    expect(serversOnPorts([{ port: 11434, pid: 5 }, { port: 8080, pid: 6 }, { port: 1234, pid: 7 }]).map((x) => x.agent.id)).toEqual(['ollama', 'lm-studio']);
  });
});

describe('dev servers', () => {
  const exists = (p: string) => ['/home/u/app/.git', '/home/u/mono/.git'].includes(p);

  it('finds the git root above a folder', () => {
    expect(gitRootOf('/home/u/app/web/src', exists)).toBe('/home/u/app');
    expect(gitRootOf('/tmp/x', exists)).toBeUndefined();
  });

  it('knows common kinds of server', () => {
    expect(serverKind('node', 'node /x/node_modules/.bin/vite --port 5173')).toEqual({ kind: 'Vite', web: true });
    expect(serverKind('python3', 'python3 manage.py runserver')).toMatchObject({ kind: 'Django' });
    expect(serverKind('postgres', '/usr/lib/postgresql/16/bin/postgres -D x')).toEqual({ kind: 'PostgreSQL', web: false });
    expect(serverKind('weird', '')).toEqual({ kind: 'weird', web: false });
  });

  it('groups by project, folds IPv4 and IPv6, and flags idle and exposed servers', () => {
    const g = groupDevServers([
      { port: 5173, pid: 100, name: 'node', command: 'node vite', cwd: '/home/u/app/web', address: '127.0.0.1', established: 2, cpu: 3 },
      { port: 5173, pid: 100, name: 'node', command: 'node vite', cwd: '/home/u/app/web', address: '::1' },
      { port: 5432, pid: 200, name: 'postgres', cwd: '/home/u/app', address: '0.0.0.0', established: 0, cpu: 0 },
      { port: 8000, pid: 300, name: 'python3', command: 'python3 -m uvicorn main:app', cwd: '/home/u/other', address: '0.0.0.0', established: 0 },
      { port: 631, pid: 400, name: 'cupsd', cwd: '/', mine: false },
      { port: 9000, pid: 500, name: 'node', command: 'node server.js', cwd: '/home/u' },
    ], (cwd) => gitRootOf(cwd, exists), { home: '/home/u' });
    expect(g.map((p) => p.name)).toEqual(['app', 'other', 'Other servers']);
    expect(g[0].servers.map((s) => s.port)).toEqual([5173, 5432]);
    expect(g[0].servers[0]).toMatchObject({ kind: 'Vite', url: 'http://127.0.0.1:5173', idle: false, exposed: false });
    expect(g[0].servers[1]).toMatchObject({ kind: 'PostgreSQL', url: undefined, idle: true, exposed: true });
    expect(g[1].servers[0].url).toBe('http://localhost:8000');
    expect(g[2].servers.map((s) => s.port)).toEqual([9000]);
  });

  it('leaves out system services unless asked', () => {
    expect(looksLikeDevServer({ port: 631, pid: 1, name: 'cupsd' }, '/home/u')).toBe(false);
    expect(looksLikeDevServer({ port: 3000, pid: 1, name: 'node' }, '/home/u')).toBe(true);
    expect(looksLikeDevServer({ port: 3000, pid: 1, name: 'node', mine: false }, '/home/u')).toBe(false);
  });

  it('splits command lines like a shell', () => {
    expect(splitCommandLine('node "my app/server.js" --port 3000 \'a b\'')).toEqual(['node', 'my app/server.js', '--port', '3000', 'a b']);
    expect(splitCommandLine('a "" b')).toEqual(['a', '', 'b']);
  });

  it('plans a restart only when it knows how', () => {
    expect(restartPlan({ name: 'node', argv: ['node', 'vite'], cwd: '/p' })).toEqual({ file: 'node', args: ['vite'], cwd: '/p' });
    expect(restartPlan({ name: 'node', command: 'node vite', cwd: undefined })).toHaveProperty('error');
    expect(restartPlan({ name: 'postgres', command: 'postgres -D x', cwd: '/p' })).toHaveProperty('error');
  });
});
