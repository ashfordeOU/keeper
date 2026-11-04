// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI agents in Keeper. Everything here builds on the brain:
//   - more AI services, a fallback chain, privacy routing and a token meter
//     around whichever AI the person chose;
//   - actions agents may take over MCP (move, rename, tag, Trash, open, run an
//     automation, quit a program…), each behind a permission, with an approval
//     prompt in Keeper and the Island, recorded in History and undoable;
//   - a model gateway (OpenAI- and Anthropic-compatible) and an A2A endpoint on
//     127.0.0.1 for other harnesses and agents;
//   - skills, the knowledge graph, agent launchers with separate profiles, and
//     private usage learning (off unless turned on).

import { app, shell } from 'electron';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { normalizeAgentSettings, type AgentSettings } from '../../core/agents-config';
import { A2AServer, agentCard } from '../../core/brain/a2a';
import { ACTIONS, actionSpec, describeAction, diagnose, permissionFor, SETTABLE, visibleActions, type Permission, type SystemSnapshot } from '../../core/brain/actions';
import { AGENT_CLIS, installedFrom, launchLine, profileDir, type AgentProfile } from '../../core/brain/agents';
import { addUsage, CATALOG, catalogEntry, costOf, modelListRequest, parseModelList, type UsageRecord } from '../../core/brain/catalog';
import {
  anthropicStreamEnd, anthropicStreamStart, anthropicTextDelta, BRAIN_MODEL, fromAnthropicRequest, fromOpenAiRequest, gatewayModels, openAiChunk, openAiStreamEnd,
  resolveModel, toAnthropicResponse, toOpenAiResponse, type AnthropicRequest, type OaiRequest,
} from '../../core/brain/gateway';
import type { McpTool } from '../../core/brain/mcp';
import type { ChatMessage, ChatProvider, ChatResult } from '../../core/brain/providers';
import { fallbackChain, metered, privacyRouter } from '../../core/brain/routing';
import { draftSkill, parseSkill, serializeSkill, skillForModel, validateSkill, type Skill } from '../../core/brain/skills';
import { buildGraph, neighbourhood, searchGraph, type Graph, type GraphFile } from '../../core/graph/build';
import type { FileIndex } from '../../core/indexer';
import { undoMoves, type Journal } from '../../core/journal';
import { habitsSummary, prune, suggest, type Suggestion, type UsageEvent, type UsageInput } from '../../core/learn';
import type { AiConnection } from '../../core/brain/config';
import type { Rule } from '../../core/types';
import { getSecret, setSecret, settings, updateSettings } from '../store';
import { askBrain, brainSettings, localBrain, mcpServer, providerForConnection, setMcpExtras, setProviderWrapper, setSkillsProvider } from './brain';
import { chatWithAbilities, type InjectRunner } from '../../core/abilities/inject';
import { readText, writeText } from './clip';
import type { FileService } from './files';
import { act as procAct, sample as procSample } from './procs';
import { featureOn } from './features';
import { agentTool as graphAgentTool, GRAPH_TOOL_SPECS } from './graph-all';

export interface AgentDeps {
  index: () => FileIndex;
  journal: () => Journal;
  files: () => FileService;
  broadcast: (channel: string, ...args: unknown[]) => void;
  changed: () => void;
  alert?: (title: string, detail?: string) => void;
  runRule?: (id: string) => Promise<{ removed: number; failed: number; journalId?: string }>;
  focus?: (action: 'start' | 'stop' | 'stopwatch' | 'extend', minutes?: number, task?: { taskId?: string; taskTitle?: string }) => void;
  setTags?: (path: string, tags: string[]) => void;
  /** opens Keeper's Terminal with a command (when the Terminal exists) */
  openTerminal?: (o: { cwd?: string; run: string; title?: string }) => Promise<void> | void;
}

let deps: AgentDeps | null = null;
const dataDir = () => path.join(app.getPath('userData'), 'agents');
const skillsDir = () => path.join(app.getPath('userData'), 'skills');

export function agentSettings(): AgentSettings {
  return normalizeAgentSettings(settings().agents);
}

export async function saveAgents(patch: Partial<AgentSettings>): Promise<AgentSettings> {
  const next = { ...agentSettings(), ...patch };
  await updateSettings({ agents: next });
  return next;
}

// ---------------------------------------------------------------- JSON files

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

/** Writes at most every few seconds; flushed on quit. */
function debounced(file: () => string, data: () => unknown, ms = 4000) {
  let timer: NodeJS.Timeout | undefined;
  return {
    soon() {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void writeJson(file(), data()).catch(() => undefined); }, ms);
      timer.unref?.();
    },
    async now() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      await writeJson(file(), data()).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------- usage and cost

let usageRows: UsageRecord[] = [];
const usageSave = debounced(() => path.join(dataDir(), 'usage.json'), () => usageRows);

function recordUsage(id: string, input: number, output: number, error: boolean) {
  usageRows = addUsage(usageRows, id, Date.now(), input, output, error);
  usageSave.soon();
}

export function usageReport(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const prices = agentSettings().prices;
  const by = new Map<string, { id: string; calls: number; input: number; output: number; errors: number }>();
  for (const r of usageRows.filter((x) => x.day >= since)) {
    const t = by.get(r.id) ?? { id: r.id, calls: 0, input: 0, output: 0, errors: 0 };
    t.calls += r.calls; t.input += r.input; t.output += r.output; t.errors += r.errors;
    by.set(r.id, t);
  }
  return [...by.values()].map((t) => ({ ...t, cost: costOf(t, prices[t.id]) })).sort((a, b) => b.calls - a.calls);
}

// ---------------------------------------------------------------- around the chosen AI

async function wrap(p: ChatProvider, c: AiConnection): Promise<ChatProvider> {
  const a = agentSettings();
  const chain: ChatProvider[] = [metered(p, (i, o, e) => recordUsage(c.id, i, o, e))];
  for (const id of a.fallback) {
    if (id === c.id) continue;
    try {
      const q = await providerForConnection(id);
      chain.push(metered(q, (i, o, e) => recordUsage(id, i, o, e)));
    } catch {
      /* a fallback that cannot be made here is skipped */
    }
  }
  let out = fallbackChain(chain, (from, to, why) => deps?.alert?.(`${from.label} failed; ${to.label} answered`, why.slice(0, 120)));
  if (a.privateFolders.length && a.localConnection && a.localConnection !== c.id) {
    try {
      const local = await providerForConnection(a.localConnection);
      if (local.local) out = privacyRouter(out, metered(local, (i, o, e) => recordUsage(a.localConnection, i, o, e)), a.privateFolders, (to) => deps?.alert?.('Private folder: switched to a local AI', to.label));
    } catch {
      /* no local AI available: privacy routing waits until there is one */
    }
  }
  return out;
}

/** The models a connection offers, read live from the service. */
export async function listModels(connId: string): Promise<{ ok: boolean; models: string[]; message?: string }> {
  const c = brainSettings().connections.find((x) => x.id === connId);
  if (!c) return { ok: false, models: [], message: 'Unknown connection' };
  const entry = CATALOG.find((e) => (c.baseUrl && e.baseUrl && c.baseUrl.startsWith(e.baseUrl)) || e.id === c.id) ?? catalogEntry(c.kind === 'ollama' ? 'ollama' : c.kind === 'anthropic' ? 'anthropic' : c.kind === 'gemini' ? 'gemini' : 'custom-openai');
  if (!entry) return { ok: false, models: [], message: 'No model list for this kind of service' };
  const base = c.baseUrl || entry.baseUrl;
  const key = entry.keyless ? undefined : await getSecret(c.id);
  const req = modelListRequest(entry, base, key);
  if (!req) return { ok: false, models: [], message: 'This service has no model list; type the model name.' };
  try {
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false, models: [], message: `${new URL(req.url).hostname} returned ${res.status}` };
    return { ok: true, models: parseModelList(entry.style, await res.json()) };
  } catch (e) {
    return { ok: false, models: [], message: e instanceof Error ? e.message : String(e) };
  }
}

/** Adds a connection from the catalogue (and stores its key in the system keychain). */
export async function addConnection(catalogId: string, o: { model?: string; baseUrl?: string; key?: string; label?: string }): Promise<{ ok: boolean; id: string; message?: string }> {
  const e = catalogEntry(catalogId);
  if (!e) return { ok: false, id: '', message: 'Unknown service' };
  const b = brainSettings();
  let id = e.id;
  for (let i = 2; b.connections.some((c) => c.id === id); i++) id = `${e.id}-${i}`;
  const kind: AiConnection['kind'] = e.style === 'anthropic' ? 'anthropic' : e.style === 'ollama' ? 'ollama' : e.style === 'gemini' ? 'gemini' : e.style === 'bedrock' ? 'bedrock' : e.style === 'openai-responses' ? 'openai-responses' : 'openai-compatible';
  const conn: AiConnection = { id, kind, label: o.label || e.label, model: o.model ?? '', baseUrl: o.baseUrl || e.baseUrl || undefined, tools: e.tools };
  if (o.key) {
    const saved = await setSecret(id, o.key);
    if (!saved) return { ok: false, id, message: 'This computer has no keychain to keep the key safe in.' };
  }
  await updateSettings({ brain: { ...b, connections: [...b.connections, conn] } });
  return { ok: true, id };
}

// ---------------------------------------------------------------- approvals

export interface Approval {
  id: string;
  client: string;
  action: string;
  description: string;
  destructive: boolean;
  at: number;
}

const pending = new Map<string, { a: Approval; resolve: (d: 'once' | 'always' | 'deny') => void; timer: NodeJS.Timeout }>();

function askApproval(client: string, action: string, args: Record<string, unknown>): Promise<'once' | 'always' | 'deny'> {
  const a: Approval = { id: randomUUID(), client, action, description: describeAction(action, args).split(os.homedir()).join('~'), destructive: !!actionSpec(action)?.destructive, at: Date.now() };
  return new Promise((resolve) => {
    // Nobody answered in two minutes: no.
    const timer = setTimeout(() => decide(a.id, 'deny'), 120_000);
    pending.set(a.id, { a, resolve, timer });
    deps?.broadcast('agent-approval', a);
    deps?.alert?.(`${client} wants to ${a.description}`, 'Open Keeper to allow or deny');
  });
}

/** For other parts of Keeper (using the computer): the same prompt, with their own words. */
export function requestApproval(client: string, action: string, description: string, destructive = false): Promise<'once' | 'always' | 'deny'> {
  const a: Approval = { id: randomUUID(), client, action, description, destructive, at: Date.now() };
  return new Promise((resolve) => {
    const timer = setTimeout(() => decide(a.id, 'deny'), 120_000);
    pending.set(a.id, { a, resolve, timer });
    deps?.broadcast('agent-approval', a);
    deps?.alert?.(`${client} wants to ${description}`, 'Open Keeper to allow or deny');
  });
}

export function decide(id: string, d: 'once' | 'always' | 'deny') {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(d);
  deps?.broadcast('agent-approval-done', id);
  if (d === 'always' && p.a.action === 'computer') void saveAgents({ computer: { ...agentSettings().computer, permission: 'allow' } });
  else if (d === 'always') void saveAgents({ permissions: { ...agentSettings().permissions, [p.a.action]: 'allow' } });
}

export function pendingApprovals(): Approval[] {
  return [...pending.values()].map((p) => p.a);
}

// ---------------------------------------------------------------- audit

export interface AuditEntry {
  at: number;
  client: string;
  action: string;
  description: string;
  status: 'done' | 'denied' | 'refused' | 'error' | 'off';
  detail?: string;
  journalId?: string;
  /** using the computer: a small picture of what the AI saw (a file in Keeper's data) */
  shot?: string;
}

let audit: AuditEntry[] = [];
const auditSave = debounced(() => path.join(dataDir(), 'audit.json'), () => audit.slice(0, 500));
const lastChange = new Map<string, string>();

function logAudit(e: AuditEntry) {
  audit.unshift(e);
  if (audit.length > 500) audit.length = 500;
  auditSave.soon();
  deps?.broadcast('agent-audit', e);
}

/** Lets other parts of Keeper (using the computer) write to the same activity log. */
export function recordAgentActivity(e: AuditEntry) {
  logAudit(e);
}

export function auditLog(): AuditEntry[] {
  return audit;
}

// ---------------------------------------------------------------- actions

function inLibrary(p: string): boolean {
  const lb = localBrain();
  if (lb) return lb.harnessEnv().allowed(p);
  return settings().folders.some((f) => p === f || p.startsWith(f + path.sep));
}

const expand = (p: string) => (p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? os.homedir() + p.slice(1) : p);
const paths = (v: unknown) => (Array.isArray(v) ? v.map((x) => expand(String(x))) : []);

async function snapshot(): Promise<SystemSnapshot> {
  const s = await procSample({});
  const top = [...s.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 12).map((r) => ({ pid: r.pid, name: r.name, cpu: r.cpu, memory: r.memory }));
  const byMem = [...s.procs].sort((a, b) => b.memory - a.memory).slice(0, 5).map((r) => ({ pid: r.pid, name: r.name, cpu: r.cpu, memory: r.memory }));
  let disk: { free: number; total: number } | undefined;
  try {
    const st = await fsp.statfs(os.homedir());
    disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch {
    /* not available */
  }
  return {
    cpuPercent: s.system.cpu, cores: os.cpus().length, memUsed: s.system.memUsed, memTotal: s.system.memTotal, swapUsed: s.system.swapUsed,
    diskFree: disk?.free, diskTotal: disk?.total, top: [...top, ...byMem.filter((m) => !top.some((t) => t.pid === m.pid))],
  };
}

const GB = 1024 ** 3;

/** Runs one action for an agent: checks the permission, asks when needed, does it, records it. */
export async function runAction(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; isError?: boolean; structured?: unknown }> {
  const a = agentSettings();
  const spec = actionSpec(name);
  if (!spec) return { text: `Unknown action ${name}`, isError: true };
  const perm = permissionFor(name, a.permissions, a.actions);
  const description = describeAction(name, args);
  if (perm === 'off') {
    logAudit({ at: Date.now(), client, action: name, description, status: 'off' });
    return { text: `The person has not allowed agents to ${spec.label.toLowerCase()} in Keeper.`, isError: true };
  }
  if (perm === 'ask') {
    const d = await askApproval(client, name, args);
    if (d === 'deny') {
      logAudit({ at: Date.now(), client, action: name, description, status: 'denied' });
      return { text: 'The person declined. Do not try again unless they ask.', isError: true };
    }
  }
  try {
    const r = await perform(name, args, client);
    logAudit({ at: Date.now(), client, action: name, description, status: 'done', detail: r.text.slice(0, 300), journalId: r.journalId });
    if (r.journalId) lastChange.set(client, r.journalId);
    return { text: r.text, structured: r.structured };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAudit({ at: Date.now(), client, action: name, description, status: 'error', detail: msg });
    return { text: msg, isError: true };
  }
}

async function perform(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; journalId?: string; structured?: unknown }> {
  const d = deps!;
  const title = (what: string) => `${client}: ${what}`;
  const mustBeInLibrary = (ps: string[]) => {
    const bad = ps.filter((p) => !inLibrary(p));
    if (bad.length) throw new Error(`Outside the folders Keeper manages (or excluded): ${bad.join(', ')}`);
  };
  switch (name) {
    case 'move_files': {
      const ps = paths(args.paths);
      const to = expand(String(args.to ?? ''));
      mustBeInLibrary([...ps, to]);
      const r = await d.files().move(ps, to, title(`moved ${ps.length} item${ps.length === 1 ? '' : 's'} to ${path.basename(to)}`));
      return { text: `Moved ${r.removed}${r.failed ? `, ${r.failed} failed (${r.skipped.join('; ')})` : ''}. Undo with undo_last.`, journalId: r.journalId };
    }
    case 'rename_file': {
      const p = expand(String(args.path ?? ''));
      mustBeInLibrary([p]);
      const to = await d.files().rename(p, String(args.name ?? ''));
      const j = d.journal().list()[0];
      return { text: `Renamed to ${to}. Undo with undo_last.`, journalId: j?.title.startsWith('Renamed') ? j.id : undefined };
    }
    case 'tag_files': {
      const ps = paths(args.paths);
      mustBeInLibrary(ps);
      const tags = (Array.isArray(args.tags) ? args.tags : []).map((t) => String(t).replace(/^#/, '').slice(0, 40)).filter(Boolean);
      for (const p of ps) {
        const f = d.index().files.get(p);
        d.setTags?.(p, [...new Set([...(f?.tags ?? []), ...tags])]);
      }
      d.changed();
      return { text: `Tagged ${ps.length} item${ps.length === 1 ? '' : 's'}.` };
    }
    case 'trash_files': {
      const ps = paths(args.paths);
      mustBeInLibrary(ps);
      const r = await d.files().trash(ps, title(`sent ${ps.length} item${ps.length === 1 ? '' : 's'} to the Trash`));
      return { text: `Sent ${r.removed} to the Trash${r.failed ? `; ${r.failed} refused (${r.skipped.join('; ')})` : ''}. They can be put back from the Trash.`, journalId: r.journalId };
    }
    case 'create_folder': {
      const parent = expand(String(args.in ?? ''));
      mustBeInLibrary([parent]);
      const p = await d.files().newFolder(parent, String(args.name ?? 'New Folder'));
      const j = await d.journal().record(title(`created ${path.basename(p)}`), [{ type: 'create', from: p, size: 0 }]);
      return { text: `Created ${p}.`, journalId: j?.id };
    }
    case 'open_path': {
      const p = expand(String(args.path ?? ''));
      if (!existsSync(p)) throw new Error('No such file, folder or app');
      const appBundle = /\.app$/i.test(p) || p.startsWith('/Applications/') || /\.exe$/i.test(p) || p.startsWith('/usr/share/applications/');
      if (!appBundle) mustBeInLibrary([p]);
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
      return { text: `Opened ${path.basename(p)}.` };
    }
    case 'undo_last': {
      const id = lastChange.get(client);
      const e = id ? d.journal().get(id) : undefined;
      if (!e || e.undone) return { text: 'Nothing of yours to undo.' };
      const r = await undoMoves(e);
      for (const op of e.ops) if (op.type === 'move' && op.to) d.index().rename(op.to, op.from);
      await d.journal().markUndone(e.id);
      lastChange.delete(client);
      d.changed();
      const trashed = e.ops.filter((o) => o.type === 'trash').length;
      return { text: `Undone: ${e.title} (${r.restored} put back${r.failed.length ? `, ${r.failed.length} could not be` : ''}${trashed ? `; ${trashed} item(s) are in the Trash, put them back from there` : ''}).` };
    }
    case 'list_automations': {
      const rules = settings().rules as Rule[];
      return { text: rules.map((r) => `${r.id}: ${r.name}${r.enabled ? '' : ' (off)'}`).join('\n') || 'No automations yet.', structured: rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })) };
    }
    case 'run_automation': {
      if (!d.runRule) throw new Error('Automations cannot be run from here');
      const r = await d.runRule(String(args.id ?? ''));
      return { text: `Done: ${r.removed} item${r.removed === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}.`, journalId: r.journalId };
    }
    case 'focus_timer': {
      if (!d.focus || !featureOn('focus')) throw new Error('The focus timer is not available (Settings → Features)');
      const act = (['start', 'stop', 'stopwatch', 'extend'] as const).find((x) => x === args.action) ?? 'start';
      let task: { taskId: string; taskTitle: string } | undefined;
      if (args.task && act !== 'stop' && act !== 'extend') {
        const t = (await (await import('./pim')).pim.reminders()).find((x) => x.id === String(args.task));
        if (!t) throw new Error('No task with that id (tasks_list shows them)');
        task = { taskId: t.id, taskTitle: t.title };
      }
      const mins = Number(args.minutes) || (act === 'extend' ? 5 : 25);
      d.focus(act, act === 'stopwatch' ? undefined : mins, task);
      const what = act === 'stop' ? 'Stopped the focus timer.' : act === 'extend' ? `Added ${mins} minutes.` : act === 'stopwatch' ? 'Started a focus stopwatch.' : `Started a ${mins}-minute focus timer.`;
      return { text: task ? `${what} For “${task.taskTitle}”.` : what };
    }
    case 'tasks_list':
    case 'task_add':
    case 'task_update':
    case 'task_complete':
    case 'task_delete':
    case 'insights_get':
      return taskAction(name, args);
    case 'island_notes_read':
    case 'island_notes_append':
      return notesAction(name, args);
    case 'set_setting': {
      const key = String(args.key ?? '');
      const check = SETTABLE[key];
      if (!check || !check(args.value)) throw new Error(`Agents can change only: ${Object.keys(SETTABLE).join(', ')} (with a valid value).`);
      const s = settings();
      if (key === 'island.enabled') await updateSettings({ island: { ...s.island, enabled: args.value as boolean } });
      else if (key === 'brain.semantic') await updateSettings({ brain: { ...brainSettings(), semantic: args.value as boolean } });
      else await updateSettings({ [key]: args.value } as never);
      return { text: `Set ${key} to ${JSON.stringify(args.value)}.` };
    }
    case 'clipboard_read':
      return { text: (await readText()) || '(the clipboard has no text)' };
    case 'clipboard_write':
      await writeText(String(args.text ?? ''));
      return { text: 'Copied.' };
    case 'system_snapshot': {
      const s = await snapshot();
      const lines = [
        `Processor: ${Math.round(s.cpuPercent)}% of ${s.cores} cores`,
        `Memory: ${(s.memUsed / GB).toFixed(1)} of ${(s.memTotal / GB).toFixed(1)} GB${s.swapUsed ? `, ${(s.swapUsed / GB).toFixed(1)} GB swap` : ''}`,
        s.diskTotal ? `Disk: ${(s.diskFree! / GB).toFixed(0)} GB free of ${(s.diskTotal / GB).toFixed(0)} GB` : '',
        'Busiest:', ...s.top.slice(0, 8).map((p) => `  ${p.name} (pid ${p.pid}): ${Math.round(p.cpu)}% cpu, ${(p.memory / 1048576).toFixed(0)} MB`),
      ].filter(Boolean);
      return { text: lines.join('\n'), structured: s };
    }
    case 'list_processes': {
      const s = await procSample({});
      const by = args.sort === 'memory' ? 'memory' : 'cpu';
      const rows = [...s.procs].sort((a, b) => b[by] - a[by]).slice(0, Math.min(100, Number(args.limit) || 25));
      return { text: rows.map((r) => `${r.pid}\t${r.name}\t${r.cpu.toFixed(1)}% cpu\t${(r.memory / 1048576).toFixed(0)} MB\t${r.user ?? ''}`).join('\n') };
    }
    case 'why_slow': {
      const f = diagnose(await snapshot());
      return { text: f.map((x) => `[${x.severity}] ${x.text}${x.fix ? ` → can ${x.fix.label.toLowerCase()} (${x.fix.tool} ${JSON.stringify(x.fix.args)})` : ''}`).join('\n'), structured: f };
    }
    case 'quit_app':
    case 'suspend_app': {
      const pid = Number(args.pid);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('That process cannot be touched');
      const action = name === 'quit_app' ? (args.force ? 'forceQuit' : 'quit') : args.resume ? 'resume' : 'suspend';
      const r = await procAct(action as 'quit', [pid]);
      const msg = r.message ?? r.failed.map((f) => f.reason).join('; ');
      if (!r.ok) throw new Error(msg || 'The system refused');
      return { text: msg || `${action} sent to ${pid}.` };
    }
    default:
      throw new Error(`Unknown action ${name}`);
  }
}

// ---------------------------------------------------------------- tasks, Island notes, Insights

async function taskAction(name: string, args: Record<string, unknown>): Promise<{ text: string; structured?: unknown }> {
  if (name === 'insights_get') {
    if (!featureOn('insights')) throw new Error('Insights are switched off (Settings → Features)');
    const i = await (await import('./pim')).pim.insights();
    const peak = i.peak.map((h) => `${h}:00–${h + 1}:00`).join(', ');
    return { text: `Today: ${i.today.tasks} done, ${Math.round(i.today.focusMin)} min focus. This week: ${i.week.tasks} done, ${i.week.focusMin} min focus.${i.streak > 1 ? ` ${i.streak}-day streak.` : ''}${peak ? ` Busiest hours: ${peak}.` : ''}`, structured: i };
  }
  if (!featureOn('calendars')) throw new Error('Calendar and reminders are switched off (Settings → Features)');
  const { pim } = await import('./pim');
  const T = await import('../../core/pim/tasks');
  const all = await pim.reminders();
  const find = () => {
    const t = all.find((x) => x.id === String(args.id ?? ''));
    if (!t) throw new Error('No task with that id (tasks_list shows them)');
    return t;
  };
  const today = T.dayKey(Date.now());
  switch (name) {
    case 'tasks_list': {
      const v = String(args.view ?? 'today');
      let list = v === 'inbox' ? T.inboxTasks(all) : v === 'overdue' ? T.overdueTasks(all) : v === 'upcoming' ? T.upcomingTasks(all, today)
        : v === 'week' ? [...T.tasksByDay(all, T.weekDays(today, (await pim.prefs()).weekStart), today, { withDone: !!args.includeDone }).values()].flat()
          : v === 'all' ? T.sortTasks(all.filter((t) => args.includeDone || !t.done)) : T.todayTasks(all, today, { withDone: !!args.includeDone });
      if (typeof args.project === 'string' && args.project) list = list.filter((t) => t.project === String(args.project).replace(/^#/, ''));
      const rows = list.slice(0, 200).map(T.taskForAi);
      return { text: rows.length ? rows.map((t) => `${t.id}: ${t.done ? '[x] ' : ''}${t.title}${t.plannedFor ? ` · ${t.plannedFor}` : ''}${t.due ? ` · due ${t.due}` : ''}${t.priority ? ` · ${'!'.repeat(t.priority)}` : ''}${t.project ? ` · #${t.project}` : ''}${t.repeat ? ` · repeats ${t.repeat}` : ''}`).join('\n') : 'No tasks here.', structured: rows };
    }
    case 'task_add': {
      const { parseTask } = await import('../../core/pim/quickadd');
      const q = typeof args.text === 'string' && args.text.trim() ? parseTask(args.text) : null;
      const base: Record<string, unknown> = q ? { title: q.title, priority: q.priority, project: q.project, rrule: q.rrule, plannedFor: q.plannedFor, due: q.due } : {};
      for (const [k, v] of Object.entries(args)) if (k !== 'text' && v !== undefined) base[k] = v;
      const t = T.cleanTask(base);
      if (!t.title) throw new Error('A task needs a title or text');
      const saved = await pim.saveReminder({ ...t, created: Date.now() });
      return { text: `Added “${saved.title}” (${saved.id}).`, structured: T.taskForAi(saved) };
    }
    case 'task_update': {
      const { id: _id, ...patch } = args;
      const saved = await pim.saveReminder(T.cleanTask(patch, find()));
      return { text: `Changed “${saved.title}”.`, structured: T.taskForAi(saved) };
    }
    case 'task_complete': {
      const t = find();
      const r = await pim.completeReminder(t.id, args.done !== false);
      return { text: args.done === false ? `Opened “${t.title}” again.` : r && !r.done ? `Checked off “${t.title}”; it repeats, next on ${T.taskDay(r) ?? 'its next date'}.` : `Checked off “${t.title}”.`, structured: r ? T.taskForAi(r) : undefined };
    }
    case 'task_delete': {
      const t = find();
      await pim.deleteReminder(t.id);
      return { text: `Deleted “${t.title}”.` };
    }
  }
  throw new Error(`Unknown action ${name}`);
}

async function notesAction(name: string, args: Record<string, unknown>): Promise<{ text: string; structured?: unknown }> {
  if (!featureOn('islandNotes')) throw new Error('Notes in the Island are switched off (Settings → Features)');
  const tools = await import('./island-tools');
  const N = await import('../../core/island-tools/notes');
  const store = await tools.getStore();
  if (name === 'island_notes_read') {
    const list = N.searchNotes(store.notes, String(args.query ?? '')).slice(0, Math.min(50, Number(args.limit) || 20));
    return { text: list.length ? list.map((n) => `--- ${n.id} (${N.noteTitle(n)}, ${new Date(n.updated).toLocaleString()})\n${n.text}`).join('\n\n') : 'No notes.', structured: list };
  }
  const text = String(args.text ?? '').slice(0, 20_000);
  if (!text.trim()) throw new Error('Nothing to add');
  const { dayKey } = await import('../../core/pim/tasks');
  const target = args.note ? store.notes.find((n) => n.id === String(args.note)) : N.todayPad(store.notes, dayKey(Date.now())).note;
  if (!target) throw new Error('No note with that id (island_notes_read shows them)');
  const next = N.appendToNote(target, text);
  await tools.saveStore({ notes: N.upsert(store.notes, next) });
  deps?.broadcast('island-tools-changed');
  return { text: `Added to “${N.noteTitle(next)}”.` };
}

// ---------------------------------------------------------------- skills

let skills: Skill[] = [];

export async function loadSkills(): Promise<Skill[]> {
  const out: Skill[] = [];
  const dir = skillsDir();
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    try {
      const s = parseSkill(await fsp.readFile(file, 'utf8'));
      if (validateSkill(s, e.name).length) continue;
      s.files = await listFiles(path.join(dir, e.name));
      out.push(s);
    } catch {
      /* not a valid skill: left alone */
    }
  }
  skills = out.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

async function listFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, r)));
    else if (r !== 'SKILL.md') out.push(r);
    if (out.length > 200) break;
  }
  return out;
}

const enabledSkills = () => skills.filter((s) => !agentSettings().skillsOff.includes(s.name));

export function skillsList(): (Skill & { enabled: boolean })[] {
  const off = agentSettings().skillsOff;
  return skills.map((s) => ({ ...s, enabled: !off.includes(s.name) }));
}

export async function saveSkill(text: string, previousName?: string): Promise<{ ok: boolean; errors: string[]; name?: string }> {
  let s: Skill;
  try {
    s = parseSkill(text);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const errors = validateSkill(s);
  if (errors.length) return { ok: false, errors };
  const dir = path.join(skillsDir(), s.name);
  if (previousName && previousName !== s.name && existsSync(path.join(skillsDir(), previousName))) await fsp.rename(path.join(skillsDir(), previousName), dir);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'SKILL.md'), serializeSkill(s));
  await loadSkills();
  return { ok: true, errors: [], name: s.name };
}

export async function removeSkill(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) return;
  await fsp.rm(path.join(skillsDir(), name), { recursive: true, force: true });
  await loadSkills();
}

export async function setSkillEnabled(name: string, on: boolean) {
  const off = new Set(agentSettings().skillsOff);
  if (on) off.delete(name);
  else off.add(name);
  await saveAgents({ skillsOff: [...off] });
}

/** Copies a skill folder in (e.g. from another agent's skills folder). */
export async function importSkill(folder: string): Promise<{ ok: boolean; errors: string[]; name?: string }> {
  try {
    const s = parseSkill(await fsp.readFile(path.join(folder, 'SKILL.md'), 'utf8'));
    const errors = validateSkill(s);
    if (errors.length) return { ok: false, errors };
    await fsp.cp(folder, path.join(skillsDir(), s.name), { recursive: true, force: true });
    await loadSkills();
    return { ok: true, errors: [], name: s.name };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Skill folders other agents keep, to offer importing them. */
export async function otherSkillFolders(): Promise<{ path: string; name: string; from: string }[]> {
  const roots = [
    { from: 'Claude Code', dir: path.join(os.homedir(), '.claude', 'skills') },
    { from: 'Codex', dir: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills') },
    { from: 'Agents', dir: path.join(os.homedir(), '.agents', 'skills') },
  ];
  const out = [];
  for (const r of roots) {
    for (const e of await fsp.readdir(r.dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && existsSync(path.join(r.dir, e.name, 'SKILL.md')) && !skills.some((s) => s.name === e.name)) out.push({ path: path.join(r.dir, e.name), name: e.name, from: r.from });
    }
  }
  return out;
}

export async function exportSkill(name: string, dest: string): Promise<string> {
  const src = path.join(skillsDir(), name);
  const to = path.join(dest, name);
  await fsp.cp(src, to, { recursive: true });
  return to;
}

export function draftSkillFrom(input: { title: string; question: string; answer: string; steps: { tool: string; summary: string; args?: Record<string, unknown> }[] }): string {
  return serializeSkill(draftSkill(input));
}

async function readSkillFile(name: string, file: string): Promise<string | undefined> {
  const root = path.join(skillsDir(), name);
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) return undefined;
  return fsp.readFile(full, 'utf8').then((t) => t.slice(0, 50_000)).catch(() => undefined);
}

// ---------------------------------------------------------------- learning

let events: UsageEvent[] = [];
const eventsSave = debounced(() => path.join(dataDir(), 'learned.json'), () => events, 10_000);

export function record(e: UsageInput) {
  if (!agentSettings().learn) return;
  events.push({ ...e, t: e.t ?? Date.now() } as UsageEvent);
  if (events.length % 50 === 0) events = prune(events, Date.now(), agentSettings().learnDays);
  eventsSave.soon();
}

export function suggestions(): Suggestion[] {
  const s = settings();
  return suggest(events, Date.now(), { pinned: s.pinned, saved: s.savedSearches.map((x) => x.text), dismissed: agentSettings().dismissed });
}

export function learningStatus() {
  return { on: agentSettings().learn, events: events.length, since: events[0]?.t, summary: habitsSummary(events, Date.now()) };
}

export async function forgetLearning() {
  events = [];
  await eventsSave.now();
}

export async function dismissSuggestion(id: string) {
  await saveAgents({ dismissed: [...new Set([...agentSettings().dismissed, id])] });
}

/** Makes what a suggestion offers: an automation (off until reviewed), a pin or a saved search. */
export async function applySuggestion(id: string): Promise<{ ok: boolean; message: string }> {
  const sg = suggestions().find((x) => x.id === id);
  if (!sg) return { ok: false, message: 'That suggestion is gone' };
  const s = settings();
  const m = sg.make;
  if (m.type === 'pin') await updateSettings({ pinned: [...new Set([...s.pinned, m.folder])] });
  else if (m.type === 'saved-search') await updateSettings({ savedSearches: [...s.savedSearches, { id: randomUUID(), name: m.name, text: m.text, createdAt: Date.now() }] });
  else {
    const conditions: Rule['conditions'] = [];
    if (m.ext) conditions.push({ type: 'ext', exts: [m.ext] });
    if (m.nameContains) conditions.push({ type: 'nameMatches', pattern: `*${m.nameContains}*` });
    if (m.trash) conditions.push({ type: 'olderThanDays', days: 14 });
    const rule: Rule = { id: randomUUID(), name: m.name, enabled: false, conditions, action: m.trash ? { type: 'trash' } : { type: 'move', to: m.to! }, scope: [m.scope] };
    await updateSettings({ rules: [...s.rules, rule] });
  }
  await dismissSuggestion(id);
  return { ok: true, message: m.type === 'rule' ? 'Added as an automation (switched off): preview it in Automations, then turn it on.' : 'Done.' };
}

// ---------------------------------------------------------------- knowledge graph

let graphCache: { at: number; key: string; g: Graph } | null = null;

export async function graph(o: { within?: string[]; kinds?: string[]; days?: number; similar?: boolean; maxFiles?: number; focus?: string; depth?: number } = {}): Promise<Graph> {
  const key = JSON.stringify({ ...o, focus: undefined, depth: undefined });
  let g = graphCache && graphCache.key === key && Date.now() - graphCache.at < 60_000 ? graphCache.g : null;
  if (!g) {
    const ix = deps!.index();
    const lb = localBrain();
    const files: GraphFile[] = [];
    for (const f of ix.all()) {
      if (lb && !lb.harnessEnv().allowed(f.path)) continue;
      let text = f.text ?? ix.extras.get(f.path)?.text;
      // Notes carry the links; read their start directly.
      if (!text && /\.(md|markdown|txt)$/i.test(f.name) && f.size < 2_000_000) text = await fsp.readFile(f.path, 'utf8').then((t) => t.slice(0, 60_000)).catch(() => undefined);
      files.push({ path: f.path, name: f.name, kind: f.kind, mtime: f.mtime, tags: f.tags, source: f.source?.name, text });
    }
    g = buildGraph(files, {
      maxFiles: o.maxFiles ?? 2500, within: o.within, kinds: o.kinds, after: o.days ? Date.now() - o.days * 86_400_000 : undefined,
      similar: o.similar !== false && lb?.engine.vectors?.size ? (p) => lb.engine.similarFiles(p, 4) : undefined,
    });
    graphCache = { at: Date.now(), key, g };
  }
  if (o.focus) {
    const id = g.nodes.some((n) => n.id === o.focus) ? o.focus : `f:${o.focus}`;
    return neighbourhood(g, id, o.depth ?? 2);
  }
  return g;
}

// ---------------------------------------------------------------- MCP: actions, graph and skills for agents

// With the graph of everything on, the same two tools cover every kind (electron/services/graph-all.ts).
const graphTools = (): McpTool[] => (featureOn('graphAll') ? (GRAPH_TOOL_SPECS as McpTool[]) : GRAPH_TOOLS);
const GRAPH_TOOLS: McpTool[] = [
  { name: 'graph_neighbors', description: 'Files, tags, people, organisations and folders linked to a file in Keeper\'s knowledge graph (links, backlinks, shared names, similar meaning).', inputSchema: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['path'] }, annotations: { readOnlyHint: true } },
  { name: 'graph_search', description: 'Find nodes (files, tags, people, organisations) in the knowledge graph by name.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
];

// Using the computer (electron/services/computer.ts), registered by main.ts.
let computerHook: { spec: () => { name: string; description: string; parameters: Record<string, unknown> }; run: (client: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean; images?: { mime: string; data: string }[] }> } | null = null;
export function setComputerHook(h: typeof computerHook) {
  computerHook = h;
}

// More tools from other parts of Keeper (agent terminals and the agent hub), registered by main.ts.
interface ToolProvider {
  tools(): McpTool[];
  call(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; isError?: boolean; structured?: unknown; images?: { mime: string; data: string }[] }>;
}
const toolProviders = new Map<string, ToolProvider>();
export function setToolProvider(id: string, p: ToolProvider | null) {
  if (p) toolProviders.set(id, p);
  else toolProviders.delete(id);
}
const providedTools = () => [...toolProviders.values()].flatMap((p) => p.tools());

// Agents Keeper starts get an identity (a token in their environment) from the hub.
let launchIdentity: ((o: { agent: string; label: string; profile?: string; cwd: string }) => Record<string, string>) | null = null;
export function setLaunchIdentity(fn: typeof launchIdentity) {
  launchIdentity = fn;
}

function extraTools(): McpTool[] {
  return [...extraToolsBase(), ...providedTools()];
}

function extraToolsBase(): McpTool[] {
  const a = agentSettings();
  if (computerHook && a.computer.permission !== 'off') {
    const s = computerHook.spec();
    return [...actionTools(a), ...graphTools(), { name: s.name, description: s.description, inputSchema: s.parameters, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, title: 'Use this computer' } }];
  }
  return [...actionTools(a), ...graphTools()];
}

function actionTools(a: AgentSettings): McpTool[] {
  return visibleActions(a.permissions, a.actions).map((x) => ({ name: x.name, description: x.description, inputSchema: x.parameters, annotations: { readOnlyHint: x.readOnly, destructiveHint: !!x.destructive, openWorldHint: false, title: x.label } }));
}

async function callExtra(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; isError?: boolean; structured?: unknown; images?: { mime: string; data: string }[] }> {
  if (name === 'computer' && computerHook) return computerHook.run(client, args);
  for (const p of toolProviders.values()) if (p.tools().some((t) => t.name === name)) return p.call(name, args, client);
  if ((name === 'graph_neighbors' || name === 'graph_search') && featureOn('graphAll')) {
    // Other AI apps: mail only from accounts shared with them.
    const r = await graphAgentTool(name, name === 'graph_neighbors' && args.path ? { ...args, path: expand(String(args.path)) } : args, true);
    if (r) return r;
  }
  if (name === 'graph_neighbors') {
    const p = expand(String(args.path ?? ''));
    if (!inLibrary(p)) return { text: 'That path is outside the library', isError: true };
    const g = await graph({ focus: p, depth: Math.min(3, Number(args.depth) || 1) });
    const lines = g.nodes.filter((n) => n.id !== `f:${p}`).map((n) => `${n.type}: ${n.path ?? n.label}`);
    return { text: lines.join('\n') || 'No links found.', structured: { nodes: g.nodes.length, edges: g.edges.length } };
  }
  if (name === 'graph_search') {
    const hits = searchGraph(await graph({}), String(args.query ?? ''));
    return { text: hits.map((n) => `${n.type}: ${n.path ?? n.label} (${n.degree} links)`).join('\n') || 'Nothing found.' };
  }
  if (ACTIONS.some((x) => x.name === name)) return runAction(name, args, client);
  return { text: `Unknown tool ${name}`, isError: true };
}

// ---------------------------------------------------------------- agent CLIs and profiles

let found: { at: number; map: Record<string, string | undefined> } | null = null;

function which(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const p = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(undefined));
    p.on('close', (code) => resolve(code === 0 ? out.split(/\r?\n/)[0]?.trim() || undefined : undefined));
  });
}

export async function agentClis(refresh = false) {
  if (!found || refresh || Date.now() - found.at > 300_000) {
    const map: Record<string, string | undefined> = {};
    await Promise.all(AGENT_CLIS.map(async (a) => (map[a.command] = await which(a.command))));
    found = { at: Date.now(), map };
  }
  return { agents: installedFrom(found.map), profiles: agentSettings().profiles };
}

export async function saveProfile(p: Omit<AgentProfile, 'id' | 'configDir'> & { id?: string; separate?: boolean }): Promise<AgentProfile[]> {
  const list = agentSettings().profiles.filter((x) => x.id !== p.id);
  const id = p.id ?? randomUUID();
  const configDir = p.separate === false ? undefined : profileDir(app.getPath('userData'), p.agent, p.label, path.sep);
  if (configDir) await fsp.mkdir(configDir, { recursive: true });
  const prof: AgentProfile = { id, agent: p.agent, label: p.label, cwd: p.cwd, env: p.env, configDir };
  await saveAgents({ profiles: [...list, prof] });
  return agentSettings().profiles;
}

export async function removeProfile(id: string) {
  await saveAgents({ profiles: agentSettings().profiles.filter((p) => p.id !== id) });
}

/** Opens an agent in Keeper's Terminal (or the system's), in a folder, with a profile. */
export async function launchAgent(agentId: string, o: { profileId?: string; cwd?: string } = {}): Promise<{ ok: boolean; message: string }> {
  const a = AGENT_CLIS.find((x) => x.id === agentId);
  if (!a) return { ok: false, message: 'Unknown agent' };
  const prof = o.profileId ? agentSettings().profiles.find((p) => p.id === o.profileId) : undefined;
  const cwd = o.cwd || prof?.cwd || os.homedir();
  const ident = launchIdentity?.({ agent: a.id, label: prof ? `${a.label} — ${prof.label}` : a.label, profile: prof?.label, cwd }) ?? {};
  const line = launchLine(a, prof ? { ...prof, env: { ...(prof.env ?? {}), ...ident } } : { id: '', agent: a.id, label: '', env: ident }, process.platform);
  if (deps?.openTerminal) {
    await deps.openTerminal({ cwd, run: line, title: prof ? `${a.label} — ${prof.label}` : a.label });
    return { ok: true, message: `Started ${a.label} in Keeper's Terminal.` };
  }
  return openSystemTerminal(cwd, line).then(() => ({ ok: true, message: `Started ${a.label} in a terminal window.` }), (e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
}

function openSystemTerminal(cwd: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let p;
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${line}`)}\ntell application "Terminal" to activate`;
      p = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      p = spawn('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-Command', line], { cwd, detached: true, stdio: 'ignore', windowsHide: false });
    } else {
      const onPath = (n: string) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, n)));
      const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'].find(onPath);
      if (!term) { reject(new Error('No terminal program was found. Install one, or open Keeper\'s Terminal.')); return; }
      p = spawn(term, term === 'gnome-terminal' ? ['--', 'bash', '-lc', `${line}; exec bash`] : ['-e', `bash -lc ${JSON.stringify(`${line}; exec bash`)}`], { cwd, detached: true, stdio: 'ignore' });
    }
    p.on('error', reject);
    p.unref();
    setTimeout(resolve, 300);
  });
}

// ---------------------------------------------------------------- gateway, A2A and the ask endpoint

let token = '';
let server: http.Server | null = null;
let port = 0;
let a2a: A2AServer | null = null;

const sameToken = (t: string) => {
  const a = Buffer.from(t);
  const b = Buffer.from(token);
  return !!token && a.length === b.length && timingSafeEqual(a, b);
};

function send(res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage, max = 8 * 1024 * 1024): Promise<unknown> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > max) throw new Error('Request too large');
  }
  return s ? JSON.parse(s) : {};
}

function models() {
  const b = brainSettings();
  return gatewayModels(b.connections.map((c) => ({ id: c.id, label: c.label })), b.active);
}

/** A provider for a gateway model (wrapped with the meter and fallback like the assistant). */
async function providerFor(model: string | undefined): Promise<{ p: ChatProvider; brain: boolean; label: string }> {
  const b = brainSettings();
  const r = resolveModel(model, models(), b.active);
  const conn = b.connections.find((c) => c.id === r.connection);
  if (!conn) throw new Error('No AI connection is set up in Keeper');
  const raw = await providerForConnection(conn.id);
  return { p: await wrap(raw, conn), brain: r.brain, label: model || 'keeper/default' };
}

async function chatOrBrain(model: string | undefined, messages: ChatMessage[], tools: { name: string; description: string; parameters: Record<string, unknown> }[], opts: { onDelta?: (t: string) => void; signal?: AbortSignal; maxTokens?: number }): Promise<ChatResult> {
  if (model === BRAIN_MODEL) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) throw new Error('No question');
    const r = await askBrain(lastUser.content, { onDelta: opts.onDelta, signal: opts.signal });
    const sources = r.sources.length ? `\n\nSources:\n${r.sources.slice(0, 8).map((s) => `- ${s.path}`).join('\n')}` : '';
    if (sources) opts.onDelta?.(sources);
    return { text: r.answer + sources, toolCalls: [], stop: 'end' };
  }
  // "<model>+abilities", or the setting: Keeper adds its abilities and runs the ones the AI calls.
  const wantsAbilities = !!model?.endsWith('+abilities');
  const { p } = await providerFor(wantsAbilities ? model!.slice(0, -'+abilities'.length) || undefined : model);
  const runner = gatewayAbilities?.(wantsAbilities);
  if (runner) return chatWithAbilities(p, messages, tools, runner, opts);
  return p.chat(messages, tools, opts);
}

/** Keeper's abilities for gateway clients (registered by main.ts); undefined when not offered. */
let gatewayAbilities: ((asked: boolean) => InjectRunner | undefined) | null = null;
export function setGatewayAbilities(fn: typeof gatewayAbilities) {
  gatewayAbilities = fn;
}

async function startServer() {
  stopServer();
  const a = agentSettings();
  if (!a.gateway) return;
  token = await getSecret('keeper-gateway') ?? '';
  if (token.length < 32) {
    token = randomBytes(24).toString('base64url');
    await setSecret('keeper-gateway', token).catch(() => false);
  }
  a2a = new A2AServer({
    ask: async (q, signal) => {
      const r = await askBrain(q, { signal });
      return { answer: r.answer, sources: r.sources.map((s) => s.path) };
    },
    newId: () => randomUUID(),
    now: () => Date.now(),
  });
  const s = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve) => {
    s.once('error', () => { port = 0; resolve(); });
    s.listen(a.gatewayPort, '127.0.0.1', () => { port = (s.address() as net.AddressInfo).port; resolve(); });
  });
  if (port) server = s;
}

function stopServer() {
  server?.close();
  server = null;
  port = 0;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const a = agentSettings();
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  const allowedHosts = ['127.0.0.1', 'localhost', '[::1]', ...a.remoteHosts];
  // Only this computer (or the tunnel host the person added), and never a web page (DNS rebinding).
  if (!allowedHosts.includes(host)) return send(res, 403, { error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Forbidden origin' });
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const base = `http://${req.headers.host ?? `127.0.0.1:${port}`}`;
  if (req.method === 'GET' && (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/.well-known/agent.json')) {
    if (!a.a2a) return send(res, 404, { error: 'Agent-to-agent is off in Keeper' });
    return send(res, 200, agentCard({ url: `${base}/a2a`, version: app.getVersion(), name: 'Keeper', skills: enabledSkills().map((s) => ({ id: s.name, name: s.name, description: s.description })) }));
  }
  const auth = req.headers.authorization ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.headers['x-api-key'] ?? '');
  if (!sameToken(key)) return send(res, 401, { error: { message: 'Missing or wrong Keeper gateway token', type: 'authentication_error' } }, { 'www-authenticate': 'Bearer' });
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const list = models();
      return send(res, 200, { object: 'list', data: list.map((m) => ({ id: m.id, object: 'model', type: 'model', created: 0, owned_by: 'keeper', display_name: m.label })), has_more: false });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const json = (await body(req)) as OaiRequest;
      const r = fromOpenAiRequest(json);
      const id = `chatcmpl-${randomUUID()}`;
      const requested = json.model;
      const created = Math.floor(Date.now() / 1000);
      if (r.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(openAiChunk(id, requested ?? 'keeper/default', created, { role: 'assistant', content: '' }));
        const out = await chatOrBrain(requested, r.messages, r.tools, { signal: ctrl.signal, maxTokens: r.maxTokens, onDelta: (t) => res.write(openAiChunk(id, requested ?? 'keeper/default', created, { content: t })) });
        res.end(openAiStreamEnd(id, requested ?? 'keeper/default', created, out));
        return;
      }
      const out = await chatOrBrain(requested, r.messages, r.tools, { signal: ctrl.signal, maxTokens: r.maxTokens });
      return send(res, 200, toOpenAiResponse(id, requested ?? 'keeper/default', out, created));
    }
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const json = (await body(req)) as AnthropicRequest;
      const r = fromAnthropicRequest(json);
      const id = `msg_${randomUUID().replace(/-/g, '')}`;
      const model = json.model ?? 'keeper/default';
      if (r.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(anthropicStreamStart(id, model));
        let chars = 0;
        const out = await chatOrBrain(json.model, r.messages, r.tools, { signal: ctrl.signal, maxTokens: r.maxTokens, onDelta: (t) => { chars += t.length; res.write(anthropicTextDelta(t)); } });
        res.end(anthropicStreamEnd(out, Math.ceil(chars / 4)));
        return;
      }
      const out = await chatOrBrain(json.model, r.messages, r.tools, { signal: ctrl.signal, maxTokens: r.maxTokens });
      return send(res, 200, toAnthropicResponse(id, model, out));
    }
    if (req.method === 'POST' && url.pathname === '/v1/ask') {
      const { question } = (await body(req)) as { question?: string };
      const r = await askBrain(String(question ?? ''), { signal: ctrl.signal });
      return send(res, 200, { answer: r.answer, sources: r.sources.map((s) => s.path), provider: r.provider });
    }
    if (req.method === 'POST' && url.pathname === '/a2a') {
      if (!a.a2a) return send(res, 404, { error: 'Agent-to-agent is off in Keeper' });
      const version = String(req.headers['a2a-version'] ?? url.searchParams.get('A2A-Version') ?? '0.3') || '0.3';
      return send(res, 200, await a2a!.handle((await body(req)) as never, version));
    }
    if (req.method === 'POST' && url.pathname === '/mcp') {
      // MCP over HTTP with the agent tools (for agents reached through a tunnel).
      const msg = (await body(req)) as never;
      const srv = mcpServer();
      const list = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(list.map((m) => srv.handle(m)))).filter(Boolean);
      if (!out.length) { res.writeHead(202); return res.end(); }
      return send(res, 200, Array.isArray(msg) ? out : out[0]);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (res.headersSent) { res.end(); return; }
    return send(res, ctrl.signal.aborted ? 499 : 400, { error: { message: msg, type: 'invalid_request_error' } });
  }
}


export async function gatewayInfo() {
  const a = agentSettings();
  const base = port ? `http://127.0.0.1:${port}` : '';
  return {
    on: a.gateway, port, token: port ? token : '', base, a2a: a.a2a, remoteHosts: a.remoteHosts,
    models: models(),
    snippets: port ? [
      { id: 'openai', label: 'OpenAI-compatible tools', text: `OPENAI_BASE_URL=${base}/v1\nOPENAI_API_KEY=${token}` },
      { id: 'anthropic', label: 'Anthropic-compatible tools', text: `ANTHROPIC_BASE_URL=${base}\nANTHROPIC_API_KEY=${token}` },
      { id: 'curl', label: 'Try it', text: `curl ${base}/v1/chat/completions -H "Authorization: Bearer ${token}" -H "content-type: application/json" -d '{"model":"${BRAIN_MODEL}","messages":[{"role":"user","content":"What did I download this week?"}]}'` },
      ...(a.a2a ? [{ id: 'a2a', label: 'Agent card (A2A)', text: `${base}/.well-known/agent-card.json` }] : []),
    ] : [],
  };
}

export async function rotateGatewayToken() {
  token = randomBytes(24).toString('base64url');
  await setSecret('keeper-gateway', token).catch(() => false);
  return gatewayInfo();
}

/** Answers for Siri Shortcuts and similar: plain text. */
export async function askPlain(question: string): Promise<string> {
  return (await askBrain(question)).answer;
}

// ---------------------------------------------------------------- start and stop

export async function startAgents(d: AgentDeps) {
  deps = d;
  await fsp.mkdir(dataDir(), { recursive: true }).catch(() => undefined);
  usageRows = await readJson(path.join(dataDir(), 'usage.json'), [] as UsageRecord[]);
  audit = await readJson(path.join(dataDir(), 'audit.json'), [] as AuditEntry[]);
  events = prune(await readJson(path.join(dataDir(), 'learned.json'), [] as UsageEvent[]), Date.now(), agentSettings().learnDays);
  await loadSkills();
  setProviderWrapper(wrap);
  setSkillsProvider(() => {
    const list = enabledSkills();
    if (!list.length) return undefined;
    return {
      list: () => list.map((s) => ({ name: s.name, description: s.description })),
      load: (name) => { const s = list.find((x) => x.name === name); return s ? skillForModel(s) : undefined; },
      readFile: (name, file) => readSkillFile(name, file),
    };
  });
  setMcpExtras(() => ({
    extraTools,
    callExtra,
    prompts: {
      list: () => enabledSkills().map((s) => ({ name: s.name, description: s.description })),
      get: (name) => { const s = enabledSkills().find((x) => x.name === name); return s ? skillForModel(s) : undefined; },
    },
  }));
  await startServer();
}

export async function agentSettingsChanged(next: AgentSettings, prev: AgentSettings) {
  if (next.gateway !== prev.gateway || next.gatewayPort !== prev.gatewayPort) await startServer();
  if (!next.learn && prev.learn) await forgetLearning();
}

export async function stopAgents() {
  stopServer();
  for (const id of [...pending.keys()]) decide(id, 'deny');
  await Promise.all([usageSave.now(), auditSave.now(), agentSettings().learn ? eventsSave.now() : Promise.resolve()]);
}

export function actionsList() {
  const a = agentSettings();
  return ACTIONS.map((x) => ({ name: x.name, label: x.label, group: x.group, readOnly: x.readOnly, destructive: !!x.destructive, permission: permissionFor(x.name, a.permissions, true) as Permission, default: x.default }));
}

export async function setPermission(name: string, p: Permission) {
  await saveAgents({ permissions: { ...agentSettings().permissions, [name]: p } });
}

export function catalog() {
  return CATALOG;
}
