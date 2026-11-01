// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's abilities in the app: the person's settings and keys, memories and
// costs on disk, the sealed code runner, the scheduler for timed requests, and
// the members a team can draw on. Every AI reaches the same abilities through
// here: the Assistant, MCP clients, the gateway and agent-to-agent callers.

import { app, Notification } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatProvider } from '../../../core/brain/providers';
import { normalizeAbilities, type AbilitiesSettings, type ScheduledTask } from '../../../core/abilities/config';
import type { Memory } from '../../../core/abilities/memory';
import { memoryBlock, visibleMemories } from '../../../core/abilities/memory';
import { personaPrompt, projectPrompt } from '../../../core/abilities/personas';
import { summarizeCosts, type CostEntry } from '../../../core/abilities/policy';
import { abilityTools, runAbility, type AbilityContext, type AbilityResult } from '../../../core/abilities/run';
import type { Runtimes } from '../../../core/abilities/sandbox';
import { dueTasks, nextRun, parseSchedule } from '../../../core/abilities/schedule';
import { runTeam, type Member, type TeamResult, type TeamSpec, type TranscriptEntry } from '../../../core/abilities/teams';
import { getSecret, setSecret, settings, updateSettings } from '../../store';
import { brainSettings, localBrain, providerForConnection } from '../brain';
import { featureOn } from '../features';

export interface AbilityDeps {
  broadcast(channel: string, ...args: unknown[]): void;
  alert(title: string, detail?: string): void;
  /** the person's approval prompt (shared with agent actions) */
  approve(client: string, action: string, description: string): Promise<'once' | 'always' | 'deny'>;
  ocr(file: string): Promise<string>;
  /** asks Keeper's assistant with the abilities on (for scheduled tasks) */
  ask(prompt: string, o: { connection?: string; system?: string; signal?: AbortSignal }): Promise<{ answer: string }>;
}

let deps: AbilityDeps | null = null;
const dir = () => path.join(app.getPath('userData'), 'abilities');

export function abilitySettings(): AbilitiesSettings {
  return normalizeAbilities(settings().abilities);
}

export async function saveAbilities(patch: Partial<AbilitiesSettings>): Promise<AbilitiesSettings> {
  await updateSettings({ abilities: { ...abilitySettings(), ...patch } });
  scheduleNext();
  deps?.broadcast('abilities-changed');
  return abilitySettings();
}

export function abilitiesOn(): boolean {
  return featureOn('abilities') && abilitySettings().enabled;
}

// ---------------------------------------------------------------- keys

const KEY = (name: string) => `ability:${name}`;
export const KEY_NAMES = ['search:brave', 'search:tavily', 'search:exa', 'search:kagi', 'search:google', 'xai', 'images:openai', 'images:gemini', 'images:stability', 'bluesky', 'voice'] as const;

export async function keyStatus(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const k of KEY_NAMES) out[k] = !!(await getSecret(KEY(k)));
  // The xAI connection the person already has for chat works for search and pictures too.
  if (!out.xai) out.xai = !!(await xaiFromConnections());
  if (!out['images:openai']) out['images:openai'] = !!(await getSecret('openai'));
  return out;
}

async function xaiFromConnections(): Promise<string | undefined> {
  const c = brainSettings().connections.find((x) => /x\.ai/.test(x.baseUrl ?? '') || x.id === 'xai');
  return c ? getSecret(c.id) : undefined;
}

async function key(name: string): Promise<string | undefined> {
  const own = await getSecret(KEY(name));
  if (own) return own;
  if (name === 'xai') return xaiFromConnections();
  if (name === 'images:openai') return getSecret('openai');
  if (name === 'images:xai') return xaiFromConnections();
  if (name === 'images:gemini') return getSecret('gemini');
  return undefined;
}

export async function setKey(name: string, value: string): Promise<boolean> {
  if (!(KEY_NAMES as readonly string[]).includes(name)) throw new Error('Unknown key');
  return setSecret(KEY(name), value);
}

// ---------------------------------------------------------------- memories and costs on disk

let memories: Memory[] = [];
let costs: CostEntry[] = [];
let saving: Promise<void> = Promise.resolve();

async function load() {
  await fsp.mkdir(dir(), { recursive: true });
  memories = await fsp.readFile(path.join(dir(), 'memories.json'), 'utf8').then((s) => JSON.parse(s) as Memory[], () => []);
  costs = await fsp.readFile(path.join(dir(), 'costs.json'), 'utf8').then((s) => JSON.parse(s) as CostEntry[], () => []);
}

function persist(name: 'memories' | 'costs') {
  saving = saving.then(async () => {
    const file = path.join(dir(), `${name}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(name === 'memories' ? memories : costs.slice(-5000)), { mode: 0o600 });
    await fsp.rename(tmp, file);
  }).catch(() => undefined);
}

export function listMemories(): Memory[] {
  return memories;
}

export async function setMemories(list: Memory[]) {
  memories = list;
  persist('memories');
  deps?.broadcast('abilities-memories');
}

export function costSummary(days = 30) {
  return summarizeCosts(costs, Date.now() - days * 86_400_000);
}

// ---------------------------------------------------------------- the sealed code runner

let rt: Runtimes | null = null;

async function runtimes(): Promise<Runtimes> {
  if (rt) return rt;
  const which = (cmd: string) => {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || undefined : undefined;
  };
  const unshare = process.platform === 'linux' && spawnSync('unshare', ['-rn', 'true'], { timeout: 3000 }).status === 0;
  rt = {
    // Keeper's own program runs scripts as plain Node when asked to.
    node: process.execPath,
    nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    python: which('python3') ?? which('python'),
    unshare,
    sandboxExec: process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'),
  };
  return rt;
}

// ---------------------------------------------------------------- saving files and speaking

async function saveFile(kind: 'images' | 'research', name: string, data: Buffer | string): Promise<string> {
  const s = abilitySettings();
  const folder = kind === 'images'
    ? s.images.folder || path.join(app.getPath('pictures'), 'Keeper AI')
    : s.research.folder || path.join(app.getPath('documents'), 'Keeper Research');
  await fsp.mkdir(folder, { recursive: true });
  let file = path.join(folder, name);
  for (let i = 2; existsSync(file); i++) file = path.join(folder, name.replace(/(\.[^.]+)$/, ` ${i}$1`));
  await fsp.writeFile(file, data);
  return file;
}

function speak(text: string): Promise<void> {
  const s = abilitySettings().voice;
  if (s.tts === 'off') return Promise.resolve();
  // The window speaks with the system's voices when it is open; otherwise the system's own speech command.
  deps?.broadcast('abilities-speak', { text, voice: s.ttsVoice });
  return new Promise((resolve) => {
    let p;
    if (process.platform === 'darwin') p = spawn('say', s.ttsVoice ? ['-v', s.ttsVoice, text] : [text], { stdio: 'ignore' });
    else if (process.platform === 'win32') p = spawn('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd())'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    else p = spawn('spd-say', ['-w', text], { stdio: 'ignore' });
    p.on('error', () => resolve());
    p.on('close', () => resolve());
    if (process.platform === 'win32') p.stdin?.end(text);
  });
}

// ---------------------------------------------------------------- the context every ability call gets

export interface CallOptions {
  client: string;
  persona?: string;
  project?: string;
  localModel?: boolean;
  signal?: AbortSignal;
  progress?(text: string): void;
}

export function contextFor(o: CallOptions): AbilityContext {
  const s = abilitySettings();
  const lb = localBrain();
  const project = s.projects.find((p) => p.id === o.project);
  return {
    settings: s,
    fetch,
    key,
    client: o.client,
    persona: o.persona,
    project: o.project,
    localModel: !!o.localModel,
    signal: o.signal,
    progress: o.progress,
    approve: async (name, summary) => {
      const d = await (deps?.approve(o.client, name, summary) ?? Promise.resolve('deny' as const));
      if (d === 'always') void saveAbilities({ permissions: { ...abilitySettings().permissions, [name]: 'allow' } });
      return d !== 'deny';
    },
    model: async (): Promise<ChatProvider> => providerForConnection(brainSettings().active),
    allowed: (p) => {
      if (!lb) return false;
      if (project && !project.folders.some((f) => p === f || p.startsWith(f.replace(/[\\/]+$/, '') + path.sep))) return false;
      return lb.harnessEnv().allowed(p);
    },
    readFile: async (p) => {
      const st = await fsp.stat(p);
      if (st.size > 30_000_000) throw new Error('That file is too large to use here');
      return fsp.readFile(p);
    },
    askDocument: async (p, q) => {
      if (!lb) throw new Error('Keeper is still starting');
      const hits = await lb.search({ query: q, within: [p], limit: 6 });
      const own = hits.filter((h) => h.path === p);
      if (!own.length) {
        const r = await lb.harnessEnv().read(p, 0, 6000);
        return r.text ? `No passage matched closely; the start of the file:\n${r.text}` : 'No text could be read from that file.';
      }
      return own.map((h, i) => `(${i + 1})${h.heading ? ` ${h.heading}:` : ''} ${h.snippet ?? ''}`).join('\n\n');
    },
    ocr: (p) => deps?.ocr(p) ?? Promise.resolve(''),
    saveFile,
    memories: { get: () => memories, set: setMemories },
    addTask: async (t) => { await saveAbilities({ tasks: [...abilitySettings().tasks, t] }); },
    speak,
    runtimes,
    recordCost: (e) => { costs.push(e); persist('costs'); },
  };
}

export async function callAbility(name: string, args: Record<string, unknown>, o: CallOptions): Promise<AbilityResult> {
  if (!abilitiesOn()) return { content: 'Abilities are switched off in Keeper.', summary: 'off', isError: true };
  const r = await runAbility(name, args, contextFor(o));
  deps?.broadcast('abilities-used', { name, client: o.client, summary: r.summary, error: !!r.isError, at: Date.now() });
  return r;
}

/** Tools for the harness (Keeper's Assistant), plus instructions with memories, persona and project. */
export function harnessAbilities(o: CallOptions) {
  if (!abilitiesOn()) return undefined;
  const t = abilityTools(() => contextFor(o));
  return { ...t, run: async (c: { id: string; name: string; args: Record<string, unknown> }) => {
    const r = await callAbility(c.name, c.args, o);
    return { content: r.isError ? `Error: ${r.content}` : r.content, summary: r.summary, images: r.images };
  }, instructions: `${t.instructions}${systemExtras(o) ? `\n\n${systemExtras(o)}` : ''}` };
}

/** What the persona, project and memories add to an AI's instructions. */
export function systemExtras(o: CallOptions): string {
  const s = abilitySettings();
  const persona = s.personas.find((p) => p.id === o.persona);
  const project = s.projects.find((p) => p.id === o.project);
  const mem = s.memory.on && persona?.memoryScope !== 'none'
    ? memoryBlock(visibleMemories(memories, { persona: o.persona, project: o.project, localModel: !!o.localModel, cloudAllowed: s.memory.cloud }))
    : '';
  return [personaPrompt(persona), projectPrompt(project), mem].filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------- scheduled tasks

let timer: NodeJS.Timeout | undefined;
const running = new Set<string>();

function scheduleNext() {
  clearTimeout(timer);
  if (!deps || !abilitiesOn()) return;
  const now = Date.now();
  let soonest = Infinity;
  for (const t of abilitySettings().tasks) {
    if (!t.enabled) continue;
    try {
      const created = (t as ScheduledTask & { createdAt?: number }).createdAt ?? now;
      const n = nextRun(parseSchedule(t.when, created), t.lastRun ?? created, t.lastRun);
      if (n !== undefined) soonest = Math.min(soonest, n);
    } catch {
      /* a schedule that cannot be read never runs; the page says why */
    }
  }
  if (soonest === Infinity) return;
  // Wake for the next task, and at least hourly so sleep and clock changes are caught.
  timer = setTimeout(() => void runDue(), Math.max(1000, Math.min(soonest - now, 3_600_000)));
  timer.unref?.();
}

export async function runDue(now = Date.now()) {
  const due = dueTasks(abilitySettings().tasks as (ScheduledTask & { createdAt?: number })[], now);
  for (const t of due) await runTask(t.id).catch(() => undefined);
  scheduleNext();
}

export async function runTask(id: string): Promise<string> {
  const t = abilitySettings().tasks.find((x) => x.id === id);
  if (!t || !deps || running.has(id)) return '';
  running.add(id);
  try {
    const system = systemExtras({ client: 'schedule', persona: t.persona, project: t.project });
    let answer: string;
    try {
      answer = (await deps.ask(t.prompt, { connection: t.connection, system })).answer;
    } catch (e) {
      answer = `Could not run: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (t.deliver.includes('island')) deps.alert(t.name, answer.replace(/\s+/g, ' ').slice(0, 200));
    if (t.deliver.includes('notification') && Notification.isSupported()) new Notification({ title: t.name, body: answer.replace(/\s+/g, ' ').slice(0, 240) }).show();
    if (t.deliver.includes('file')) await saveFile('research', `${t.name.replace(/[\\/:*?"<>|]+/g, ' ')} — ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.md`, `# ${t.name}\n\n${answer}\n`);
    const tasks = abilitySettings().tasks.map((x) => (x.id === id ? { ...x, lastRun: Date.now(), lastResult: answer.slice(0, 2000), enabled: x.once ? false : x.enabled } : x));
    await saveAbilities({ tasks });
    deps.broadcast('abilities-task-ran', { id, answer });
    return answer;
  } finally {
    running.delete(id);
  }
}

// ---------------------------------------------------------------- teams

/** Other kinds of member (live agent sessions in the Terminal) plug in here. */
const memberSources: (() => Promise<Member[]>)[] = [];
export function addTeamMemberSource(fn: () => Promise<Member[]>) {
  memberSources.push(fn);
}

export async function teamMembers(): Promise<Member[]> {
  const b = brainSettings();
  const out: Member[] = [];
  for (const c of b.connections) {
    const hasKey = !!(await getSecret(c.id)) || c.kind === 'ollama' || c.kind === 'platform' || /localhost|127\.0\.0\.1/.test(c.baseUrl ?? '');
    if (!hasKey) continue;
    const local = c.kind === 'ollama' || c.kind === 'platform' || /localhost|127\.0\.0\.1/.test(c.baseUrl ?? '');
    out.push({
      id: c.id, label: `${c.label}${c.model ? ` · ${c.model}` : ''}`, local,
      strengths: local ? ['private', 'fast'] : /claude|anthropic/i.test(c.kind + c.model) ? ['code', 'writing'] : /gpt|openai/i.test(c.kind + c.model) ? ['writing', 'code'] : /grok|x\.ai/i.test((c.baseUrl ?? '') + c.model) ? ['research'] : [],
      ask: async (prompt, o) => {
        const p = await providerForConnection(c.id);
        const r = await p.chat([...(o.system ? [{ role: 'system' as const, content: o.system }] : []), { role: 'user', content: prompt }], [], { signal: o.signal, maxTokens: 2000 });
        return r.text;
      },
    });
  }
  for (const src of memberSources) out.push(...(await src().catch(() => [])));
  return out;
}

const teamRuns = new Map<string, AbortController>();

export async function runTeamById(runId: string, teamId: string | TeamSpec, prompt: string): Promise<TeamResult> {
  const spec = typeof teamId === 'string' ? abilitySettings().teams.find((t) => t.id === teamId) : teamId;
  if (!spec) throw new Error('No team with that id');
  const ctrl = new AbortController();
  teamRuns.set(runId, ctrl);
  try {
    return await runTeam(spec, await teamMembers(), prompt, { signal: ctrl.signal, onEntry: (e: TranscriptEntry) => deps?.broadcast('abilities-team', { runId, entry: e }) });
  } finally {
    teamRuns.delete(runId);
  }
}

export function cancelTeam(runId: string) {
  teamRuns.get(runId)?.abort();
}

// ---------------------------------------------------------------- start and stop

export async function startAbilities(d: AbilityDeps) {
  deps = d;
  await load();
  scheduleNext();
}

export function stopAbilities() {
  clearTimeout(timer);
  for (const c of teamRuns.values()) c.abort();
  deps = null;
}

/** Keeps an eye on the person's own changes to schedules (from the page). */
export function abilitiesSettingsChanged() {
  scheduleNext();
}

void os;
