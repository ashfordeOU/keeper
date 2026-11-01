// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More coding agents in the Island, beyond the two whose transcripts
// core/island.ts reads:
//   - any agent or editor that can run a command on its events (hooks):
//     it writes a small status file into ~/.keeper/agents/, and the Island
//     shows it (working, waiting for permission, done, stuck). Keeper can set
//     the hooks up for editors that have them.
//   - Gemini-style CLIs that keep session files (~/.gemini, ~/.qwen)
//   - agents that keep one JSON file per message (~/.local/share/opencode)
// Pure parsers (the window imports this too); core/island-scan.ts reads the files.

import { agentDef } from './agents-detect';
import type { AgentSession, AgentState } from './island';

/** The last part of a path, on any system (no node:path here). */
export function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

export const STATES: AgentState[] = ['working', 'waiting', 'done', 'stuck', 'idle'];

/** The status file an agent hook writes (one per session). */
export interface AgentStatusFile {
  tool: string;
  session?: string;
  project?: string;
  cwd?: string;
  state: AgentState;
  summary?: string;
  /** ms since epoch; the file's own time when missing */
  updatedAt?: number;
  /** a terminal or window to bring forward (an app name) */
  app?: string;
}

/** Hook event names (several editors' vocabularies) → a state. */
export function stateForEvent(event: string): AgentState | undefined {
  const e = event.toLowerCase().replace(/[^a-z]/g, '');
  if (/^(beforesubmitprompt|userpromptsubmit|start|sessionstart|pretooluse|beforeshellexecution|beforemcpexecution|beforereadfile|afterfileedit|posttooluse|working|busy|thinking)$/.test(e)) return 'working';
  if (/^(notification|permissionrequest|waiting|needsinput|askuser|approval)$/.test(e)) return 'waiting';
  if (/^(stop|subagentstop|done|complete|completed|idle|finished|sessionend)$/.test(e)) return 'done';
  if (/^(error|failed|failure|stuck|crash)$/.test(e)) return 'stuck';
  return undefined;
}

export function parseStatusFile(text: string, file: string, mtime: number, now = Date.now()): AgentSession | null {
  let o: Partial<AgentStatusFile>;
  try {
    o = JSON.parse(text) as Partial<AgentStatusFile>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || !o.tool) return null;
  let state = STATES.includes(o.state as AgentState) ? (o.state as AgentState) : stateForEvent(String(o.state ?? '')) ?? 'idle';
  const at = typeof o.updatedAt === 'number' && o.updatedAt > 0 ? o.updatedAt : mtime;
  const age = now - at;
  // A "working" that has not moved for 10 minutes most likely ended without telling.
  if (state === 'working' && age > 10 * 60_000) state = 'idle';
  if ((state === 'done' || state === 'stuck') && age > 60 * 60_000) state = 'idle';
  if (state === 'waiting' && age > 3 * 3600_000) state = 'idle';
  const cwd = typeof o.cwd === 'string' ? o.cwd : undefined;
  return {
    id: file, tool: String(o.tool).slice(0, 40).toLowerCase() as AgentSession['tool'], project: (o.project || (cwd ? baseName(cwd) : '') || String(o.tool)).slice(0, 80),
    cwd, state, summary: String(o.summary ?? '').replace(/\s+/g, ' ').slice(0, 140), updatedAt: at, file,
  };
}

/** Gemini-style CLI session (chats/session-*.json): who spoke last, and any tool call still waiting. */
export function geminiSessionState(json: string, mtime: number, now = Date.now()): { state: AgentState; summary: string } {
  let o: { messages?: { type?: string; content?: unknown; toolCalls?: { status?: string; name?: string }[] }[]; lastUpdated?: string };
  try {
    o = JSON.parse(json);
  } catch {
    return { state: 'idle', summary: '' };
  }
  const msgs = Array.isArray(o.messages) ? o.messages : [];
  const last = msgs[msgs.length - 1];
  const at = o.lastUpdated ? Date.parse(o.lastUpdated) || mtime : mtime;
  const age = now - at;
  if (!last) return { state: 'idle', summary: '' };
  const text = typeof last.content === 'string' ? last.content : Array.isArray(last.content) ? (last.content as { text?: string }[]).map((c) => c.text ?? '').join(' ') : '';
  const summary = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (last.type === 'error' && age < 30 * 60_000) return { state: 'stuck', summary };
  const pending = (last.toolCalls ?? []).find((t) => /awaiting|pending|confirm|scheduled/i.test(t.status ?? ''));
  if (pending && age < 60 * 60_000) return { state: 'waiting', summary: `Wants to use ${pending.name ?? 'a tool'}` };
  if (age < 15_000) return { state: 'working', summary };
  if (last.type === 'gemini' || last.type === 'model' || last.type === 'assistant') return age < 60 * 60_000 ? { state: 'done', summary } : { state: 'idle', summary };
  return age < 2 * 60_000 ? { state: 'working', summary } : { state: 'idle', summary };
}

/** One-file-per-message agents: the newest message says whether it is still answering. */
export function messageDirState(messages: { role?: string; time?: { created?: number; completed?: number }; error?: unknown; path?: { cwd?: string } }[], now = Date.now()): { state: AgentState; cwd?: string; updatedAt: number } {
  const sorted = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  const last = sorted[sorted.length - 1];
  const cwd = [...sorted].reverse().find((m) => m.path?.cwd)?.path?.cwd;
  if (!last) return { state: 'idle', cwd, updatedAt: 0 };
  const at = last.time?.completed ?? last.time?.created ?? 0;
  const age = now - at;
  if (last.error && age < 30 * 60_000) return { state: 'stuck', cwd, updatedAt: at };
  if (last.role === 'assistant' && !last.time?.completed && age < 10 * 60_000) return { state: 'working', cwd, updatedAt: at };
  if (last.role === 'user' && age < 2 * 60_000) return { state: 'working', cwd, updatedAt: at };
  if (last.role === 'assistant' && age < 60 * 60_000) return { state: 'done', cwd, updatedAt: at };
  return { state: 'idle', cwd, updatedAt: at };
}

/** Island ids that differ from the shared agent table's (core/agents-detect.ts). */
const TABLE_ID: Record<string, string> = { gemini: 'gemini-cli', qwen: 'qwen-code' };

/** How each agent is named in the Island: from the one agent table Health and the CLI use too. */
export function agentName(tool: string): string {
  const def = agentDef(TABLE_ID[tool] ?? tool);
  if (def) return def.label;
  return tool.replace(/(^|[-_ ])(\w)/g, (_m, s: string, c: string) => `${s ? ' ' : ''}${c.toUpperCase()}`);
}

// ---------------------------------------------------------------- hooks Keeper can set up

/**
 * The small script a hook runs: reads the event JSON on stdin (editors pass
 * one) and writes ~/.keeper/agents/<tool>-<session>.json. POSIX sh and
 * PowerShell versions; neither needs Keeper itself to be running.
 */
export function hookScriptSh(): string {
  return `#!/bin/sh
# Keeper agent status hook: keeper-agent-status <tool> <event>
# Writes what the agent is doing for Keeper's Island. Reads the event JSON from stdin when there is one.
tool="$1"; event="$2"; dir="$HOME/.keeper/agents"; mkdir -p "$dir"
input=""; if [ ! -t 0 ]; then input=$(cat 2>/dev/null | head -c 65536); fi
pick() { printf '%s' "$input" | tr -d '\\n' | sed -n "s/.*\\"$1\\"[[:space:]]*:[[:space:]]*\\"\\([^\\"]*\\)\\".*/\\1/p" | head -n 1; }
sid=$(pick conversation_id); [ -z "$sid" ] && sid=$(pick session_id); [ -z "$sid" ] && sid="default"
cwd=$(pick cwd); [ -z "$cwd" ] && cwd=$(pick workspace_root); [ -z "$cwd" ] && cwd="$PWD"
msg=$(pick message); [ -z "$msg" ] && msg=$(pick command); [ -z "$msg" ] && msg=$(pick prompt)
esc() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | cut -c1-200; }
sid=$(printf '%s' "$sid" | tr -cd 'A-Za-z0-9_-' | cut -c1-64)
now=$(($(date +%s) * 1000))
printf '{"tool":"%s","session":"%s","cwd":"%s","state":"%s","summary":"%s","updatedAt":%s}\\n' "$(esc "$tool")" "$sid" "$(esc "$cwd")" "$(esc "$event")" "$(esc "$msg")" "$now" > "$dir/$tool-$sid.json.tmp" && mv "$dir/$tool-$sid.json.tmp" "$dir/$tool-$sid.json"
# Hooks that may block (permissions) are let through: Keeper only watches.
case "$event" in beforeShellExecution|beforeMCPExecution|beforeReadFile) printf '{"permission":"allow"}\\n' ;; esac
exit 0
`;
}

export function hookScriptPs(): string {
  return `# Keeper agent status hook: keeper-agent-status.ps1 <tool> <event>
param([string]$tool, [string]$event)
$dir = Join-Path $env:USERPROFILE '.keeper\\agents'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
$in = $null; try { if ([Console]::IsInputRedirected) { $in = [Console]::In.ReadToEnd() | ConvertFrom-Json } } catch {}
$sid = if ($in.conversation_id) { $in.conversation_id } elseif ($in.session_id) { $in.session_id } else { 'default' }
$sid = ($sid -replace '[^A-Za-z0-9_-]', ''); if ($sid.Length -gt 64) { $sid = $sid.Substring(0, 64) }
$cwd = if ($in.cwd) { $in.cwd } elseif ($in.workspace_roots) { $in.workspace_roots[0] } else { (Get-Location).Path }
$msg = if ($in.message) { $in.message } elseif ($in.command) { $in.command } elseif ($in.prompt) { $in.prompt } else { '' }
$o = @{ tool = $tool; session = $sid; cwd = $cwd; state = $event; summary = ([string]$msg).Substring(0, [Math]::Min(200, ([string]$msg).Length)); updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$f = Join-Path $dir "$tool-$sid.json"; ($o | ConvertTo-Json -Compress) | Set-Content -Encoding UTF8 -Path "$f.tmp"; Move-Item -Force "$f.tmp" $f
if ($event -in @('beforeShellExecution','beforeMCPExecution','beforeReadFile')) { '{"permission":"allow"}' }
exit 0
`;
}

/** Events worth a status for an editor's hooks file, and the state each means. */
export const EDITOR_HOOK_EVENTS = ['beforeSubmitPrompt', 'beforeShellExecution', 'beforeMCPExecution', 'afterFileEdit', 'stop'] as const;

/**
 * Adds Keeper's status hooks to an editor's hooks.json (version 1 format:
 * { version, hooks: { event: [{ command }] } }) without touching the person's own hooks.
 */
export function addEditorHooks(existing: string | undefined, command: (event: string) => string): string {
  let o: { version?: number; hooks?: Record<string, { command: string }[]> } = {};
  try {
    o = existing ? JSON.parse(existing) : {};
  } catch {
    throw new Error('The hooks file is not valid JSON; fix or remove it first');
  }
  o.version ??= 1;
  o.hooks ??= {};
  for (const ev of EDITOR_HOOK_EVENTS) {
    const list = (o.hooks[ev] ??= []);
    const cmd = command(ev);
    if (!list.some((h) => /keeper-agent-status/.test(h.command))) list.push({ command: cmd });
  }
  return JSON.stringify(o, null, 2) + '\n';
}

export function removeEditorHooks(existing: string): string {
  const o = JSON.parse(existing) as { hooks?: Record<string, { command: string }[]> };
  for (const [ev, list] of Object.entries(o.hooks ?? {})) {
    o.hooks![ev] = list.filter((h) => !/keeper-agent-status/.test(h.command));
    if (!o.hooks![ev].length) delete o.hooks![ev];
  }
  return JSON.stringify(o, null, 2) + '\n';
}

