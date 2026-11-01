// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading coding agents' session and status files (Node only; the parsers are
// in core/island.ts and core/island-agents.ts, which the Island window imports).

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentStateFromTail, type AgentSession, type AgentState } from './island';
import { geminiSessionState, messageDirState, parseStatusFile } from './island-agents';

async function tail(file: string, bytes = 64 * 1024): Promise<string[]> {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    return size > len ? lines.slice(1) : lines;
  } finally {
    await fh.close();
  }
}

async function recentJsonl(dir: string, maxAgeMs: number, depth = 4): Promise<string[]> {
  const out: string[] = [];
  const now = Date.now();
  async function go(d: string, level: number) {
    let list;
    try {
      list = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && level < depth) await go(p, level + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && now - st.mtimeMs < maxAgeMs) out.push(p);
      }
    }
  }
  await go(dir, 0);
  return out;
}

/** Sessions of Claude Code (~/.claude/projects) and Codex (~/.codex/sessions) active in the last few hours. */
export async function scanAgentSessions(home = os.homedir(), now = Date.now()): Promise<AgentSession[]> {
  const sources: { tool: AgentSession['tool']; dir: string }[] = [
    { tool: 'claude-code', dir: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'projects') },
    { tool: 'codex', dir: path.join(process.env.CODEX_HOME ?? path.join(home, '.codex'), 'sessions') },
  ];
  const sessions: AgentSession[] = [];
  for (const s of sources) {
    for (const file of await recentJsonl(s.dir, 6 * 3600_000)) {
      try {
        const st = await fsp.stat(file);
        const { state, summary, cwd } = agentStateFromTail(await tail(file), st.mtimeMs, now);
        if (state === 'idle') continue;
        const project = cwd ? path.basename(cwd) : path.basename(path.dirname(file)).replace(/^-/, '').split('-').pop() ?? 'session';
        sessions.push({ id: file, tool: s.tool, project, cwd, state, summary, updatedAt: st.mtimeMs, file });
      } catch {
        /* unreadable */
      }
    }
  }
  const order: Record<AgentState, number> = { waiting: 0, stuck: 1, working: 2, done: 3, idle: 4 };
  return sessions.sort((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------- more agents

async function listFiles(dir: string, re: RegExp, maxAge: number, depth: number, now: number): Promise<{ file: string; mtime: number }[]> {
  const out: { file: string; mtime: number }[] = [];
  async function go(d: string, level: number) {
    let list;
    try {
      list = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && level < depth) await go(p, level + 1);
      else if (e.isFile() && re.test(e.name)) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && now - st.mtimeMs < maxAge) out.push({ file: p, mtime: st.mtimeMs });
      }
    }
  }
  await go(dir, 0);
  return out;
}

export function statusDir(home = os.homedir()): string {
  return process.env.KEEPER_AGENT_STATUS_DIR ?? path.join(home, '.keeper', 'agents');
}

/** Sessions of the other agents active in the last few hours (none of these start a program). */
export async function scanMoreAgents(home = os.homedir(), now = Date.now()): Promise<AgentSession[]> {
  const out: AgentSession[] = [];
  const maxAge = 6 * 3600_000;
  for (const f of await listFiles(statusDir(home), /\.json$/, maxAge, 0, now)) {
    const s = parseStatusFile(await fsp.readFile(f.file, 'utf8').catch(() => ''), f.file, f.mtime, now);
    if (s && s.state !== 'idle') out.push(s);
  }
  for (const [tool, dir] of [['gemini', path.join(home, '.gemini', 'tmp')], ['qwen', path.join(home, '.qwen', 'tmp')]] as const) {
    for (const f of await listFiles(dir, /^session-.*\.json$/, maxAge, 2, now)) {
      const { state, summary } = geminiSessionState(await fsp.readFile(f.file, 'utf8').catch(() => ''), f.mtime, now);
      if (state === 'idle') continue;
      out.push({ id: f.file, tool: tool as AgentSession['tool'], project: path.basename(path.dirname(path.dirname(f.file))).slice(0, 12), state, summary, updatedAt: f.mtime, file: f.file });
    }
  }
  const oc = path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'opencode', 'storage', 'message');
  let sessions: string[] = [];
  try {
    sessions = await fsp.readdir(oc);
  } catch {
    /* not installed */
  }
  for (const sid of sessions) {
    const files = await listFiles(path.join(oc, sid), /\.json$/, maxAge, 0, now);
    if (!files.length) continue;
    const newest = files.sort((a, b) => b.mtime - a.mtime).slice(0, 6);
    const msgs = await Promise.all(newest.map((f) => fsp.readFile(f.file, 'utf8').then((t) => JSON.parse(t), () => ({}))));
    const st = messageDirState(msgs, now);
    if (st.state === 'idle') continue;
    out.push({ id: `opencode:${sid}`, tool: 'opencode' as AgentSession['tool'], project: st.cwd ? path.basename(st.cwd) : 'session', cwd: st.cwd, state: st.state, summary: '', updatedAt: st.updatedAt || newest[0].mtime, file: newest[0].file });
  }
  return out;
}
