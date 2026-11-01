// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One table of AI coding agents, AI command-line tools, editors with agents
// built in and local model servers, with how to recognise each running
// process. Health → Dev & agents, the CLI (`keeper agents --running`), AI
// abilities and the Island all read this table, so a new agent is one line.
// Pure: give it a process list (pid, parent, name, command), get sessions back.

import { USAGE_TOOLS, type UsageTool } from './island-tools/usage';

export type AgentKind = 'cli' | 'ide' | 'server' | 'app';

export interface AgentDef {
  id: string;
  label: string;
  kind: AgentKind;
  /** exact process names (lower case, without .exe) */
  names?: string[];
  /** matches the full command line (script paths of Node and Python agents) */
  command?: RegExp;
  /** a local model server's usual port */
  ports?: number[];
  /** where it keeps session files, relative to the home folder (for session status) */
  sessions?: string;
  /** usage meter in the Island's AI usage tool */
  usage?: UsageTool;
}

// The two agents Keeper has always followed keep the ids the Island already uses.
const [first, second] = USAGE_TOOLS;
const firstId = `${first.id}-code`;
const firstBin = first.id;
const word = (w: string) => new RegExp(`(^|[\\\\/\\s"'])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.exe|\\.cmd|\\.js|\\.mjs|\\.cjs|\\.py)?(\\s|"|'|$)`, 'i');
const pkg = (p: string) => new RegExp(`node_modules[\\\\/]${p.replace(/\//g, '[\\\\/]')}([\\\\/]|$)`, 'i');

export const AGENTS: AgentDef[] = [
  // ---------------------------------------------------------------- terminal agents and AI CLIs
  { id: firstId, label: first.label, kind: 'cli', names: [firstBin], command: word(firstBin), sessions: `.${firstBin}/projects`, usage: first.id },
  { id: second.id, label: second.label, kind: 'cli', names: [second.id], command: new RegExp(`${word(second.id).source}|${pkg('@openai/' + second.id).source}`, 'i'), sessions: `.${second.id}/sessions`, usage: second.id },
  { id: 'gemini-cli', label: 'Gemini CLI', kind: 'cli', names: ['gemini'], command: new RegExp(`${pkg('@google/gemini-cli').source}|${word('gemini').source}`, 'i'), sessions: '.gemini/tmp', usage: 'gemini' },
  { id: 'aider', label: 'Aider', kind: 'cli', names: ['aider'], command: /(^|[\\/\s])aider(\.exe)?(\s|$)|-m\s+aider\b/i },
  { id: 'opencode', label: 'OpenCode', kind: 'cli', names: ['opencode'], command: new RegExp(`${pkg('opencode-ai').source}|${word('opencode').source}`, 'i'), sessions: '.local/share/opencode' },
  { id: 'cursor-agent', label: 'Cursor Agent CLI', kind: 'cli', names: ['cursor-agent'], command: word('cursor-agent'), usage: 'cursor' },
  { id: 'copilot-cli', label: 'Copilot CLI', kind: 'cli', command: pkg('@github/copilot'), usage: 'copilot' },
  { id: 'amp', label: 'Amp', kind: 'cli', command: pkg('@sourcegraph/amp') },
  { id: 'goose', label: 'Goose', kind: 'cli', names: ['goose'], sessions: '.local/share/goose/sessions' },
  { id: 'kiro-cli', label: 'Kiro CLI', kind: 'cli', names: ['kiro-cli'], command: word('kiro-cli') },
  { id: 'qwen-code', label: 'Qwen Code', kind: 'cli', names: ['qwen'], command: pkg('@qwen-code/qwen-code'), sessions: '.qwen/tmp' },
  { id: 'crush', label: 'Crush', kind: 'cli', names: ['crush'] },
  { id: 'cline-cli', label: 'Cline CLI', kind: 'cli', names: ['cline'], command: pkg('cline') },
  { id: 'droid', label: 'Factory Droid', kind: 'cli', names: ['droid'] },
  { id: 'auggie', label: 'Augment CLI', kind: 'cli', names: ['auggie'], command: pkg('@augmentcode/auggie') },
  { id: 'plandex', label: 'Plandex', kind: 'cli', names: ['plandex', 'pdx'] },
  { id: 'open-interpreter', label: 'Open Interpreter', kind: 'cli', names: ['interpreter'], command: /-m\s+interpreter\b|[\\/]interpreter(\.exe)?(\s|$)/i },
  { id: 'grok-cli', label: 'Grok CLI', kind: 'cli', command: pkg('@vibe-kit/grok-cli'), usage: 'grok' },
  { id: 'antigravity-cli', label: 'Antigravity CLI', kind: 'cli', names: ['agy'], command: word('antigravity-cli') },
  { id: 'llm-cli', label: 'llm', kind: 'cli', command: /(^|[\\/\s])llm(\.exe)?\s+(prompt|chat|-m)\b/i },

  // ---------------------------------------------------------------- editors with agents built in
  { id: 'cursor', label: 'Cursor', kind: 'ide', names: ['cursor'], usage: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', kind: 'ide', names: ['windsurf'] },
  { id: 'kiro', label: 'Kiro', kind: 'ide', names: ['kiro'] },
  { id: 'antigravity', label: 'Antigravity', kind: 'ide', names: ['antigravity'] },
  { id: 'trae', label: 'Trae', kind: 'ide', names: ['trae'] },
  { id: 'zed', label: 'Zed', kind: 'ide', names: ['zed', 'zed-editor'] },
  { id: 'copilot-ls', label: 'Copilot (editor)', kind: 'ide', names: ['copilot-language-server'], command: pkg('@github/copilot-language-server'), usage: 'copilot' },
  { id: 'codeium', label: 'Codeium / Windsurf plugin', kind: 'ide', names: ['language_server_macos_arm', 'language_server_macos_x64', 'language_server_linux_x64', 'language_server_windows_x64'] },
  { id: 'continue', label: 'Continue', kind: 'ide', command: /[\\/]\.continue[\\/]|continue-binary/i },
  { id: 'tabnine', label: 'Tabnine', kind: 'ide', names: ['tabnine', 'tabnine-deep-local'] },

  // ---------------------------------------------------------------- local model servers
  { id: 'ollama', label: 'Ollama', kind: 'server', names: ['ollama', 'ollama app', 'ollama_llama_server'], ports: [11434] },
  { id: 'lm-studio', label: 'LM Studio', kind: 'server', names: ['lm studio', 'lmstudio', 'lms', 'llmster'], ports: [1234] },
  { id: 'llama-cpp', label: 'llama.cpp server', kind: 'server', names: ['llama-server', 'llama-cli', 'server'], command: /(^|[\\/])llama-(server|cli)(\.exe)?(\s|$)/i, ports: [8080] },
  { id: 'llamafile', label: 'llamafile', kind: 'server', command: /\.llamafile(\.exe)?(\s|$)/i, ports: [8080] },
  { id: 'vllm', label: 'vLLM', kind: 'server', names: ['vllm'], command: /vllm(\.entrypoints\.\w+(\.\w+)*|\s+serve)\b/i, ports: [8000] },
  { id: 'sglang', label: 'SGLang', kind: 'server', command: /sglang\.launch_server/i, ports: [30000] },
  { id: 'mlx-lm', label: 'MLX LM server', kind: 'server', command: /mlx_lm\.server/i, ports: [8080] },
  { id: 'localai', label: 'LocalAI', kind: 'server', names: ['local-ai', 'localai'], ports: [8080] },
  { id: 'jan', label: 'Jan', kind: 'server', names: ['jan'], ports: [1337] },
  { id: 'koboldcpp', label: 'KoboldCpp', kind: 'server', names: ['koboldcpp'], command: /koboldcpp(\.py|\.exe)?(\s|$)/i, ports: [5001] },
  { id: 'textgen-webui', label: 'Text generation web UI', kind: 'server', command: /text-generation-webui|oobabooga/i, ports: [7860] },
  { id: 'gpt4all', label: 'GPT4All', kind: 'server', names: ['gpt4all', 'chat'], command: /gpt4all/i, ports: [4891] },
  { id: 'tabby', label: 'Tabby', kind: 'server', names: ['tabby'], command: /(^|[\\/])tabby(\.exe)?\s+serve\b/i, ports: [8080] },
  { id: 'open-webui', label: 'Open WebUI', kind: 'app', names: ['open-webui'], command: /open[-_]webui/i, ports: [8080] },
];

export const AGENT_IDS = new Set(AGENTS.map((a) => a.id));

/** The table entry for an id, or undefined. */
export function agentDef(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

export interface ProcLike {
  pid: number;
  ppid: number;
  name: string;
  command?: string;
  cpu?: number;
  memory?: number;
  cwd?: string;
}

const norm = (name: string) => name.toLowerCase().replace(/\.(exe|app|cmd)$/i, '').trim();

/**
 * Which agent a single process is, or undefined. A plain process name wins;
 * then the command line (Node and Python agents run as `node …/cli.js`).
 * Generic names ("server", "chat") only count when the command line agrees.
 */
export function matchAgent(p: Pick<ProcLike, 'name' | 'command'>): AgentDef | undefined {
  const n = norm(p.name);
  const cmd = p.command ?? '';
  const generic = new Set(['server', 'chat', 'lms', 'jan']);
  for (const a of AGENTS) {
    if (a.names?.includes(n) && (!generic.has(n) || !a.command || a.command.test(cmd))) return a;
  }
  // Editors' helper processes carry the editor name in their path ("Cursor Helper (Plugin)").
  for (const a of AGENTS) if (a.command && cmd && a.command.test(cmd)) return a;
  return undefined;
}

export interface AgentSessionProc {
  /** stable within one reading: `${agent}:${rootPid}` */
  key: string;
  agent: AgentDef;
  /** the process that started the session */
  pid: number;
  /** it and everything it started (helpers, shells, dev servers, tests) */
  pids: number[];
  cpu: number;
  memory: number;
  command?: string;
  cwd?: string;
}

/** Running agents, one entry per session: helpers of the same agent fold into the top-most one. */
export function detectAgents(procs: ProcLike[], kinds?: AgentKind[]): AgentSessionProc[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map<number, number[]>();
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid]);
  const matched = new Map<number, AgentDef>();
  for (const p of procs) {
    const a = matchAgent(p);
    if (a && (!kinds || kinds.includes(a.kind))) matched.set(p.pid, a);
  }
  const out: AgentSessionProc[] = [];
  for (const [pid, agent] of matched) {
    // Skip when an ancestor is the same agent (its helper), at most 30 steps up.
    let up = byPid.get(pid)?.ppid;
    let nested = false;
    for (let i = 0; up && i < 30; i++) {
      if (matched.get(up)?.id === agent.id) {
        nested = true;
        break;
      }
      up = byPid.get(up)?.ppid;
    }
    if (nested) continue;
    const tree: number[] = [];
    const visit = (p: number, depth: number) => {
      if (depth > 40 || tree.includes(p)) return;
      tree.push(p);
      for (const c of kids.get(p) ?? []) visit(c, depth + 1);
    };
    visit(pid, 0);
    const root = byPid.get(pid)!;
    const rows = tree.map((p) => byPid.get(p)).filter((p): p is ProcLike => !!p);
    out.push({
      key: `${agent.id}:${pid}`, agent, pid, pids: tree,
      cpu: Math.round(rows.reduce((s, r) => s + (r.cpu ?? 0), 0) * 10) / 10,
      memory: rows.reduce((s, r) => s + (r.memory ?? 0), 0),
      command: root.command, cwd: root.cwd,
    });
  }
  const order: Record<AgentKind, number> = { cli: 0, ide: 1, server: 2, app: 3 };
  return out.sort((a, b) => order[a.agent.kind] - order[b.agent.kind] || b.cpu - a.cpu);
}

/** Local model servers that answer on their usual port (from a list of listening ports). */
export function serversOnPorts(listening: { port: number; pid: number }[]): { agent: AgentDef; port: number; pid: number }[] {
  const out: { agent: AgentDef; port: number; pid: number }[] = [];
  for (const l of listening) {
    const a = AGENTS.find((x) => x.kind === 'server' && x.ports?.includes(l.port) && x.ports.length === 1 && l.port !== 8080 && l.port !== 8000);
    if (a) out.push({ agent: a, port: l.port, pid: l.pid });
  }
  return out;
}
