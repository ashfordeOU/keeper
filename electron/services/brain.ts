// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's brain in the app: keeps the passage index in step with the library,
// builds meaning vectors in the background (off the main thread, paused on
// battery and while the person is busy), answers questions with whichever AI
// they chose, and serves the same brain to other AI apps — over MCP through
// `keeper mcp`, and (when turned on) over HTTP on 127.0.0.1.

import { app, powerMonitor } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { BrainHit, BrainStatus } from '../../core/brain-contract';
import { addToConfig, isConnected, MCP_APPS, removeFromConfig, snippets, type McpLaunch } from '../../core/brain/apps';
import { normalizeBrainSettings, type AiConnection, type BrainSettings } from '../../core/brain/config';
import { brainSocketPath, ENDPOINT_FILE, type BrainEndpoint } from '../../core/brain/paths';
import { downloadE5, E5, E5_DOWNLOAD_BYTES, e5Dir, e5Present } from '../../core/brain/e5';
import type { Embedder } from '../../core/brain/engine';
import type { HarnessResult, TraceStep } from '../../core/brain/harness';
import { LocalBrain } from '../../core/brain/local';
import { McpServer, type JsonRpcRequest, type JsonRpcResponse, type McpBackend } from '../../core/brain/mcp';
import type { HarnessEnv } from '../../core/brain/harness';
import '../../core/brain/adapters';
import { COMPATIBLE_PRESETS, createProvider, providerFactories, registerProvider, type ChatMessage, type ChatProvider } from '../../core/brain/providers';
import type { FileIndex } from '../../core/indexer';
import { KeychainLockedError } from '../../core/keychain';
import { getSecret, hasSecret, secretLocked, settings, updateSettings } from '../store';
import { appleProvider, mcpLaunch } from './platform';
import { useBrain } from './platform/brain-adapter';
import { canWork, conditions, pacer, track, whenIdle } from './governor';
import { restMs } from '../../core/governor';

export interface BrainDeps {
  index: () => FileIndex;
  broadcast: (channel: string, ...args: unknown[]) => void;
}

let deps: BrainDeps | null = null;
let lb: LocalBrain | null = null;
let semantic: BrainStatus['semantic'] = 'off';
let download: number | undefined;
let message: string | undefined;
let worker: WorkerEmbedder | null = null;
let syncing = false;
let syncAgain = false;
let stopped = false;
let token = '';
let socketServer: net.Server | null = null;
let httpServer: http.Server | null = null;
let httpPort = 0;
const asks = new Map<string, AbortController>();

// Hooks for the agents layer (electron/services/agents.ts): fallback, privacy
// routing and metering around the chosen AI; skills; agent actions over MCP.
let providerWrapper: ((p: ChatProvider, c: AiConnection) => Promise<ChatProvider>) | null = null;
let skillsProvider: (() => HarnessEnv['skills']) | null = null;
let mcpExtras: (() => Partial<McpBackend>) | null = null;
export function setProviderWrapper(fn: typeof providerWrapper) { providerWrapper = fn; }
export function setSkillsProvider(fn: typeof skillsProvider) { skillsProvider = fn; }
export function setMcpExtras(fn: typeof mcpExtras) { mcpExtras = fn; }

const dataDir = () => app.getPath('userData');
const brainDir = () => path.join(dataDir(), 'brain');
const modelsDir = () => path.join(dataDir(), 'models');

export function brainSettings(): BrainSettings {
  const s = settings();
  return normalizeBrainSettings(s.brain, s.ai);
}

// ---------------------------------------------------------------- the operating system's own model

// Wrapped for the harness. The on-device model has a small window, so Keeper
// looks things up first and hands it the results (no tool calls).
if (process.platform === 'darwin') {
  registerProvider({
    kind: 'platform',
    label: appleProvider.label,
    available: async () => (await appleProvider.available()).ok,
    create: (c) => ({
      id: 'platform', label: appleProvider.label, model: 'on-device', local: true, supportsTools: false, contextTokens: c.contextTokens ?? appleProvider.contextTokens,
      async chat(messages, _tools, opts = {}) {
        const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const msgs = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        const r = await appleProvider.chat({ system, messages: msgs, signal: opts.signal, onDelta: opts.onDelta });
        return { text: r.text, toolCalls: [], stop: 'end' };
      },
    }),
  });
}

// ---------------------------------------------------------------- meaning model in a worker

class WorkerEmbedder implements Embedder {
  readonly id = E5.id;
  readonly dims = E5.dims;
  private w: Worker;
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  ready: Promise<void>;

  constructor() {
    const threads = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
    this.w = new Worker(path.join(__dirname, 'brain-worker.cjs'), { workerData: { modelsDir: modelsDir(), threads } });
    this.ready = new Promise((resolve, reject) => {
      const first = (m: { ready?: boolean; error?: string }) => {
        if (m.ready === undefined) return;
        this.w.off('message', first);
        if (m.ready) resolve();
        else reject(new Error(m.error ?? 'The meaning-search model could not start'));
      };
      this.w.on('message', first);
    });
    this.w.on('message', (m: { id?: number; vectors?: Float32Array[]; error?: string }) => {
      if (m.id === undefined) return;
      const p = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.error) p?.reject(new Error(m.error));
      else p?.resolve(m.vectors!);
    });
    this.w.on('error', (e) => { for (const p of this.waiting.values()) p.reject(e); this.waiting.clear(); });
    this.w.unref();
  }

  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.w.postMessage({ id, texts, kind });
    });
  }

  stop() {
    void this.w.terminate();
  }
}

// ---------------------------------------------------------------- status

let statusTimer: NodeJS.Timeout | undefined;
function statusChanged(now = false) {
  if (statusTimer && !now) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusTimer = undefined; deps?.broadcast('brain-status', status()); }, now ? 0 : 1000);
}

export function status(): BrainStatus {
  const base: BrainStatus = lb ? lb.status() : { files: 0, withText: 0, embedded: 0, pending: 0, semantic };
  return { ...base, semantic, semanticModel: semantic === 'off' ? undefined : E5.label, download, message };
}

// ---------------------------------------------------------------- keeping up

/**
 * Brings the brain in line with the library (called when the library changes): only the
 * files the library says changed, unless it says to look at everything (after loading or a
 * big scan). Reading their text is background work: paced by the governor, and waiting on
 * battery like the rest. Catch-ups come at most every ten seconds while text keeps arriving.
 */
let lastSync = 0;
// The brain's reading is its own stream of background work (its share is measured on its own batches).
const syncPace = pacer();
let syncTimer: NodeJS.Timeout | undefined;
export async function syncBrain(): Promise<void> {
  if (!lb || !brainSettings().enabled) return;
  if (syncing) { syncAgain = true; return; }
  const wait = lastSync + 10_000 - Date.now();
  if (wait > 0) {
    if (!syncTimer) {
      syncTimer = setTimeout(() => { syncTimer = undefined; void syncBrain(); }, wait);
      syncTimer.unref?.();
    }
    return;
  }
  syncing = true;
  try {
    do {
      syncAgain = false;
      const paths = deps!.index().drainChanged();
      await lb.sync({ onProgress: () => statusChanged(), pause: () => syncPace('text'), paths });
      lastSync = Date.now();
    } while (syncAgain && !stopped);
  } finally {
    syncing = false;
    syncPace.idle();
  }
  statusChanged(true);
  void embedLoop();
}

let embedding = false;
async function embedLoop() {
  if (embedding || !lb || !worker || semantic !== 'ready') return;
  embedding = true;
  const lookup = (p: string) => deps!.index().files.get(p);
  try {
    while (!stopped && semantic === 'ready' && lb.engine.pendingCount > 0) {
      if (brainSettings().pauseOnBattery && powerMonitor.isOnBatteryPower()) {
        message = 'Paused while on battery';
        statusChanged();
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      // The governor keeps this light while the person works (and when hot or short of
      // memory) and lets it run fast when they are away. On battery the setting above decides.
      const allowBattery = !brainSettings().pauseOnBattery && powerMonitor.isOnBatteryPower();
      if (!allowBattery && !canWork('embed').ok) {
        message = canWork('embed').reason;
        embedTask.set('waiting', { pending: lb.engine.pendingCount, detail: message });
        statusChanged();
        await whenIdle('embed');
        continue;
      }
      message = undefined;
      embedTask.set('working', { pending: lb.engine.pendingCount, detail: 'Building meaning vectors' });
      // Small batches while the person is using the computer, bigger ones when it is idle.
      const idle = powerMonitor.getSystemIdleTime();
      const t0 = Date.now();
      await lb.engine.embedSome(idle < 10 ? 8 : 32, lookup);
      lb.markDirty();
      statusChanged();
      // Rests in proportion to the batch, so meaning vectors take their share of the time and no more.
      await new Promise((r) => setTimeout(r, Math.max(idle < 10 ? 250 : 20, restMs('embed', conditions(), Date.now() - t0))));
    }
  } catch (e) {
    message = `Meaning search stopped: ${e instanceof Error ? e.message : e}`;
  } finally {
    embedding = false;
    embedTask.set('idle', { pending: lb?.engine.pendingCount ?? 0, detail: undefined });
    statusChanged(true);
    void lb?.save();
  }
}

const embedTask = track('brain-embed', 'Understanding what your files are about', 'embed');

let semanticBusy: Promise<BrainStatus> | null = null;

/** Turns meaning search on (downloading the model the first time) or off. One change at a time. */
export async function setSemantic(on: boolean): Promise<BrainStatus> {
  while (semanticBusy) await semanticBusy.catch(() => undefined);
  semanticBusy = applySemantic(on);
  try {
    return await semanticBusy;
  } finally {
    semanticBusy = null;
  }
}

async function applySemantic(on: boolean): Promise<BrainStatus> {
  if (!lb) return status();
  if (!on) {
    worker?.stop();
    worker = null;
    semantic = 'off';
    await lb.useEmbedder(null);
    message = undefined;
    statusChanged(true);
    return status();
  }
  if (semantic === 'downloading' || semantic === 'ready') return status();
  try {
    if (!(await e5Present(modelsDir()))) {
      semantic = 'downloading';
      download = 0;
      statusChanged(true);
      await downloadE5(modelsDir(), (f) => { download = f; statusChanged(); });
      download = undefined;
    }
    const w = new WorkerEmbedder();
    await w.ready;
    worker = w;
    await lb.useEmbedder(w);
    semantic = 'ready';
    message = undefined;
  } catch (e) {
    semantic = 'unavailable';
    download = undefined;
    message = e instanceof Error ? e.message : String(e);
  }
  statusChanged(true);
  void embedLoop();
  return status();
}

export async function removeModel(): Promise<BrainStatus> {
  await setSemantic(false);
  await fsp.rm(e5Dir(modelsDir()), { recursive: true, force: true });
  await updateSettings({ brain: { ...brainSettings(), semantic: false } });
  return status();
}

export async function rebuild(): Promise<BrainStatus> {
  if (!lb) return status();
  await lb.clear();
  if (worker && semantic === 'ready') await lb.useEmbedder(worker);
  void syncBrain();
  return status();
}

// ---------------------------------------------------------------- AIs

async function providerFor(c: AiConnection): Promise<ChatProvider> {
  const key = c.kind === 'ollama' || c.kind === 'platform' ? undefined : await getSecret(c.id);
  // A key that is saved but the keychain will not open: say that, not "add your key".
  if (key === undefined && c.kind !== 'ollama' && c.kind !== 'platform' && (await secretLocked(c.id).catch(() => false))) throw new KeychainLockedError(process.platform, `the key for ${c.label || c.kind}`);
  const p = createProvider({ kind: c.kind, model: c.model, apiKey: key, baseUrl: c.baseUrl, tools: c.tools, contextTokens: c.contextTokens });
  // The name the person knows it by.
  p.label = c.label || p.label;
  return p;
}

async function activeProvider(): Promise<ChatProvider | null> {
  const b = brainSettings();
  const c = b.connections.find((x) => x.id === b.active);
  if (!c) return null;
  const p = await providerFor(c);
  if (b.localOnly && !p.local) throw new Error(`${c.label} runs on the internet, and you chose to use only AIs on this computer (Settings → AI & Brain).`);
  return providerWrapper ? providerWrapper(p, c) : p;
}

/** One connection by id, as a provider (no fallback or routing). */
export async function providerForConnection(id: string): Promise<ChatProvider> {
  const c = brainSettings().connections.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown AI connection “${id}”`);
  const p = await providerFor(c);
  if (brainSettings().localOnly && !p.local) throw new Error(`${c.label} runs on the internet, and you chose to use only AIs on this computer.`);
  return p;
}

/** Asks Keeper's assistant (for other agents, the gateway and voice assistants), with Keeper's abilities. */
export async function askBrain(question: string, opts: { signal?: AbortSignal; onDelta?: (t: string) => void; history?: ChatMessage[]; client?: string; persona?: string; project?: string } = {}): Promise<HarnessResult> {
  if (!lb) throw new Error('Keeper is still starting');
  const extra = abilityTools?.({ client: opts.client ?? 'assistant', persona: opts.persona, project: opts.project });
  return lb.ask(question, { signal: opts.signal, onDelta: opts.onDelta, history: opts.history, ...(extra ? { extraTools: extra } : {}) });
}

/**
 * Abilities any AI can use through Keeper (the web, pictures, code, memory,
 * schedules), registered by main.ts; undefined when they are switched off.
 */
type ExtraTools = NonNullable<import('../../core/brain/harness').HarnessEnv['extraTools']>;
let abilityTools: ((o: { client: string; persona?: string; project?: string }) => ExtraTools | undefined) | null = null;
export function setAbilityTools(fn: typeof abilityTools) {
  abilityTools = fn;
}

/** Two sets of extra tools offered together, each running its own calls. */
function mergeExtra(a: ExtraTools | undefined, b: ExtraTools | undefined): ExtraTools | undefined {
  if (!a || !b) return a ?? b;
  return {
    specs: [...a.specs, ...b.specs.filter((s) => !a.specs.some((x) => x.name === s.name))],
    run: (c) => (a.specs.some((s) => s.name === c.name) ? a.run(c) : b.run(c)),
    instructions: [a.instructions, b.instructions].filter(Boolean).join('\n\n'),
  };
}

/** The brain over the library, for the knowledge graph (similar files) and agents. */
export function localBrain(): LocalBrain | null {
  return lb;
}

export async function connections(): Promise<{ connections: (AiConnection & { hasKey: boolean; local: boolean; needsKey: boolean })[]; active: string; kinds: { kind: string; label: string; available: boolean }[]; presets: typeof COMPATIBLE_PRESETS }> {
  const b = brainSettings();
  const out = [];
  for (const c of b.connections) {
    let local = false;
    try { local = (await providerFor(c)).local; } catch { /* kind not available here */ }
    const needsKey = !local && c.kind !== 'platform';
    out.push({ ...c, hasKey: needsKey ? await hasSecret(c.id) : true, local, needsKey });
  }
  const kinds = await Promise.all(providerFactories().map(async (f) => ({ kind: String(f.kind), label: f.label, available: f.available ? await f.available().catch(() => false) : true })));
  return { connections: out, active: b.active, kinds, presets: COMPATIBLE_PRESETS };
}

/** Sends one short message to check the connection works. */
export async function testConnection(id: string): Promise<{ ok: boolean; message: string }> {
  const c = brainSettings().connections.find((x) => x.id === id);
  if (!c) return { ok: false, message: 'Unknown connection' };
  try {
    const p = await providerFor(c);
    const r = await p.chat([{ role: 'user', content: 'Reply with the single word: ready' }], [], { maxTokens: 400, signal: AbortSignal.timeout(60_000) });
    return { ok: true, message: `${p.label}${p.model ? ` (${p.model})` : ''} answered: “${r.text.trim().slice(0, 60)}”` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- asking

/** Tools that let the Assistant use the computer (set by main.ts; undefined when that is switched off). */
let computerTools: (() => import('../../core/brain/harness').HarnessEnv['extraTools'] | undefined) | null = null;
export function setComputerTools(fn: typeof computerTools) {
  computerTools = fn;
}

export async function ask(
  reqId: string, question: string, history: ChatMessage[] | undefined, send: (channel: string, ...args: unknown[]) => void,
  o: { computer?: boolean; persona?: string; project?: string } = {},
): Promise<HarnessResult> {
  if (!lb) throw new Error('Keeper is still starting');
  const ctrl = new AbortController();
  asks.set(reqId, ctrl);
  // Using the computer takes many small steps: more rounds than a question about files.
  const computer = o.computer ? computerTools?.() : undefined;
  const extra = mergeExtra(computer, abilityTools?.({ client: 'assistant', persona: o.persona, project: o.project }));
  try {
    const r = await lb.ask(question, {
      signal: ctrl.signal,
      history,
      onDelta: (text) => send('brain-delta', { reqId, text }),
      onStep: (s: TraceStep) => send('brain-step', { reqId, step: s }),
      ...(extra ? { extraTools: extra, maxRounds: computer ? 40 : 16 } : {}),
    });
    // Screenshots stay here: the conversation that goes back to the window (and on to follow-ups) keeps a note instead.
    if (r.messages?.some((m) => m.images?.length)) r.messages = r.messages.map((m) => (m.images?.length ? { ...m, images: undefined, content: `${m.content}\n[screenshot]` } : m));
    return r;
  } finally {
    asks.delete(reqId);
  }
}

export function cancelAsk(reqId: string) {
  asks.get(reqId)?.abort();
}

export function search(query: string, opts: { limit?: number; mode?: 'hybrid' | 'words' | 'meaning' } = {}): Promise<BrainHit[]> {
  return lb ? lb.search({ query, limit: opts.limit ?? 30, mode: opts.mode }) : Promise.resolve([]);
}

// ---------------------------------------------------------------- serving other AI apps

export function mcpServer(): McpServer {
  const b = brainSettings();
  return new McpServer({
    ...(mcpExtras?.() ?? {}),
    env: lb!.harnessEnv(),
    version: app.getVersion(),
    redact: b.mcpRedact,
    status: () => ({ ...status() }),
    savedSearches: () => settings().savedSearches.map((s) => ({ id: s.id, name: s.name, text: s.text })),
    ask: async (q) => {
      const r = await lb!.ask(q);
      return { answer: r.answer, sources: r.sources };
    },
  });
}

const sameToken = (t: string) => {
  const a = Buffer.from(t);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

const extraMethods = new Map<string, (params: Record<string, unknown>, notify: (method: string, params: unknown) => void) => Promise<unknown> | unknown>();

/** Maps an agent's hub token (and terminal) to who it is; set by the agent hub. */
let agentResolver: ((token?: string, session?: string) => string | undefined) | null = null;
export function setAgentResolver(fn: typeof agentResolver) {
  agentResolver = fn;
}

/** Lets other parts of Keeper answer the keeper command through the same socket (e.g. "keeper/sync.status"). */
export function registerKeeperMethod(method: string, fn: (params: Record<string, unknown>) => Promise<unknown> | unknown) {
  extraMethods.set(method, fn);
}

/** Like registerKeeperMethod, for long-running calls that send notifications back to the caller (e.g. the browser extension's link). */
export function registerKeeperStream(method: string, fn: (params: Record<string, unknown>, notify: (method: string, params: unknown) => void) => Promise<unknown> | unknown) {
  extraMethods.set(method, fn);
}

/** Methods only Keeper's own command uses, next to the standard MCP ones. */
async function keeperMethod(m: JsonRpcRequest, notify: (method: string, params: unknown) => void): Promise<JsonRpcResponse | undefined> {
  const id = m.id ?? null;
  const p = (m.params ?? {}) as Record<string, unknown>;
  try {
    if (m.method === 'keeper/status') return { jsonrpc: '2.0', id, result: status() };
    if (m.method === 'keeper/search') return { jsonrpc: '2.0', id, result: await search(String(p.query ?? ''), { limit: Number(p.limit) || 20, mode: p.mode as 'hybrid' }) };
    const extra = extraMethods.get(m.method);
    if (extra) return { jsonrpc: '2.0', id, result: await extra(p, notify) };
    if (m.method === 'keeper/ask') {
      const r = await lb!.ask(String(p.question ?? ''), { onDelta: (text) => notify('keeper/delta', { text }), onStep: (s) => notify('keeper/step', s) });
      return { jsonrpc: '2.0', id, result: { answer: r.answer, sources: r.sources, actions: r.actions, provider: r.provider, model: r.model } };
    }
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
  }
  return undefined;
}

async function startSocket() {
  const sock = brainSocketPath(dataDir());
  if (process.platform !== 'win32' && existsSync(sock)) {
    // A socket left by a crash: only remove it when nothing answers.
    const alive = await new Promise<boolean>((r) => { const c = net.connect(sock, () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
    if (alive) return;
    await fsp.rm(sock, { force: true });
  }
  socketServer = net.createServer((conn) => {
    let buf = '';
    let authed = false;
    let server: McpServer | null = null;
    const write = (o: unknown) => conn.write(JSON.stringify(o) + '\n');
    conn.setEncoding('utf8');
    conn.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg: JsonRpcRequest & { token?: string };
        try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        if (!authed) {
          if (typeof msg.token === 'string' && sameToken(msg.token)) {
            authed = true;
            server = mcpServer();
            // An agent Keeper started presents its hub token (from its environment), and the terminal it runs in.
            const m = msg as { agent?: unknown; session?: unknown };
            server.agent = agentResolver?.(typeof m.agent === 'string' ? m.agent : undefined, typeof m.session === 'string' ? m.session : undefined);
            write({ ok: true });
          }
          else { conn.end(JSON.stringify({ ok: false, error: 'Not allowed' }) + '\n'); return; }
          continue;
        }
        void (async () => {
          const r = (await keeperMethod(msg, (method, params) => write({ jsonrpc: '2.0', method, params }))) ?? (await server!.handle(msg));
          if (r && !conn.destroyed) write(r);
        })();
      }
    });
    conn.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => {
    socketServer!.once('error', () => resolve());
    socketServer!.listen(sock, () => resolve());
  });
  if (process.platform !== 'win32') await fsp.chmod(sock, 0o600).catch(() => undefined);
}

async function writeEndpoint() {
  const e: BrainEndpoint = { socket: brainSocketPath(dataDir()), token, pid: process.pid, version: app.getVersion(), ...(httpPort ? { http: { port: httpPort } } : {}) };
  await fsp.mkdir(brainDir(), { recursive: true });
  const f = path.join(brainDir(), ENDPOINT_FILE);
  await fsp.writeFile(f, JSON.stringify(e, null, 1), { mode: 0o600 });
}

function json(res: http.ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, max = 1024 * 1024): Promise<string> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > max) throw new Error('Request too large');
  }
  return s;
}

async function startHttp(port: number) {
  stopHttp();
  const server = http.createServer(async (req, res) => {
    // Only this computer, and never a web page in a browser (DNS rebinding).
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    const origin = req.headers.origin;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) return json(res, 403, { error: 'Forbidden' });
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7))) return json(res, 401, { error: 'Missing or wrong token' }, { 'www-authenticate': 'Bearer' });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' }, { allow: 'POST' });
        const body = JSON.parse(await readBody(req)) as JsonRpcRequest | JsonRpcRequest[];
        const srv = mcpServer();
        const list = Array.isArray(body) ? body : [body];
        const out = (await Promise.all(list.map((m) => srv.handle(m)))).filter(Boolean);
        const headers: Record<string, string> = list.some((m) => m.method === 'initialize') ? { 'mcp-session-id': randomBytes(16).toString('hex') } : {};
        if (!out.length) { res.writeHead(202, headers); return res.end(); }
        return json(res, 200, Array.isArray(body) ? out : out[0], headers);
      }
      if (url.pathname === '/v1/status' && req.method === 'GET') return json(res, 200, status());
      if (url.pathname === '/v1/search' && req.method === 'GET') {
        return json(res, 200, { results: await search(url.searchParams.get('q') ?? '', { limit: Number(url.searchParams.get('limit')) || 20, mode: (url.searchParams.get('mode') as 'hybrid') || undefined }) });
      }
      if (url.pathname === '/v1/read' && req.method === 'GET') {
        const r = await lb!.read(url.searchParams.get('path') ?? '', { offset: Number(url.searchParams.get('offset')) || 0, maxChars: Math.min(100_000, Number(url.searchParams.get('max')) || 20_000) });
        return json(res, 200, brainSettings().mcpRedact ? { ...r, text: (await import('../../core/brain/redact')).redact(r.text).text } : r);
      }
      if (url.pathname === '/v1/ask' && req.method === 'POST') {
        const { question } = JSON.parse(await readBody(req)) as { question?: string };
        const r = await lb!.ask(String(question ?? ''));
        return json(res, 200, { answer: r.answer, sources: r.sources, actions: r.actions });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  await new Promise<void>((resolve) => {
    server.once('error', () => { httpPort = 0; resolve(); });
    server.listen(port, '127.0.0.1', () => { httpPort = (server.address() as net.AddressInfo).port; resolve(); });
  });
  if (httpPort) httpServer = server;
  await writeEndpoint();
}

function stopHttp() {
  httpServer?.close();
  httpServer = null;
  httpPort = 0;
}

export function serverInfo(): { http: boolean; port: number; token: string; socket: string; snippets: { id: string; label: string; text: string }[] } {
  const l = launch();
  const s = snippets(l);
  if (httpPort) s.push({ id: 'http', label: 'Local API (HTTP)', text: `curl -H "Authorization: Bearer ${token}" "http://127.0.0.1:${httpPort}/v1/search?q=invoices"` });
  return { http: !!httpPort, port: httpPort, token, socket: brainSocketPath(dataDir()), snippets: s };
}

// ---------------------------------------------------------------- connecting AI apps

function launch(): McpLaunch {
  return mcpLaunch();
}

export async function mcpApps(): Promise<{ id: string; label: string; file: string; installed: boolean; connected: boolean }[]> {
  const out = [];
  for (const a of MCP_APPS) {
    const file = a.file(os.homedir(), process.platform, process.env);
    if (!file) continue;
    const text = await fsp.readFile(file, 'utf8').catch(() => undefined);
    out.push({ id: a.id, label: a.label, file, installed: text !== undefined || existsSync(path.dirname(file)), connected: isConnected(text, a.format) });
  }
  return out;
}

/** Adds (or removes) Keeper in an AI app's MCP settings. The old file is kept as a backup first. */
export async function setAppConnected(id: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  const a = MCP_APPS.find((x) => x.id === id);
  const file = a?.file(os.homedir(), process.platform, process.env);
  if (!a || !file) return { ok: false, message: 'Unknown app' };
  const text = await fsp.readFile(file, 'utf8').catch(() => undefined);
  try {
    const next = on ? addToConfig(text, a.format, launch()) : text === undefined ? undefined : removeFromConfig(text, a.format);
    if (next === undefined) return { ok: true, message: `${a.label} did not have Keeper.` };
    if (text !== undefined) await fsp.copyFile(file, `${file}.keeper-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, next);
    return { ok: true, message: on ? `Added Keeper to ${a.label}. Restart ${a.label} to use it.` : `Removed Keeper from ${a.label}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- start and stop

export async function startBrain(d: BrainDeps): Promise<void> {
  deps = d;
  stopped = false;
  lb = new LocalBrain({
    index: d.index,
    dir: brainDir(),
    excluded: () => settings().excluded,
    visibility: () => brainSettings().visibility,
    redactAlways: () => brainSettings().redactAlways,
    provider: activeProvider,
    home: os.homedir(),
    semantic: () => semantic,
    semanticModel: () => (semantic === 'off' ? undefined : E5.label),
    skills: () => skillsProvider?.(),
  });
  await lb.load();
  // Spotlight, GNOME, KRunner and keeper:// links search through the brain too.
  const brain = lb;
  useBrain({ status, search: (o) => brain.search(o), read: (p, o) => brain.read(p, o), ask: (q, o) => brain.ask(q, o) });
  token = await fsp.readFile(path.join(brainDir(), 'token'), 'utf8').catch(() => '');
  if (token.length < 32) {
    token = randomBytes(24).toString('base64url');
    await fsp.mkdir(brainDir(), { recursive: true });
    await fsp.writeFile(path.join(brainDir(), 'token'), token, { mode: 0o600 });
  }
  await startSocket();
  const b = brainSettings();
  if (b.http) await startHttp(b.httpPort);
  else await writeEndpoint();
  if (b.semantic) void setSemantic(true);
  void syncBrain();
}

/** Settings changed: start or stop what they control. */
export async function brainSettingsChanged(next: BrainSettings, prev: BrainSettings) {
  if (!lb) return;
  if (next.semantic !== prev.semantic) await setSemantic(next.semantic);
  if (next.http !== prev.http || next.httpPort !== prev.httpPort) {
    if (next.http) await startHttp(next.httpPort);
    else { stopHttp(); await writeEndpoint(); }
  }
  if (next.enabled && !prev.enabled) void syncBrain();
  statusChanged(true);
}

export function stopBrain() {
  stopped = true;
  worker?.stop();
  socketServer?.close();
  stopHttp();
  for (const c of asks.values()) c.abort();
  try {
    lb?.saveSync();
  } catch {
    /* read-only or full disk: the brain is rebuilt next time */
  }
}

export const MODEL_DOWNLOAD_BYTES = E5_DOWNLOAD_BYTES;
