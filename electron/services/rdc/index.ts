// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops: saved connections, opening them (VNC and web consoles in
// Keeper tabs, SSH/Mosh/Telnet/serial/PowerShell in terminal tabs, RDP/SPICE/
// X2Go and outside viewers as their own windows), gateways, Wake-on-LAN,
// import and export, and letting others reach this computer.
//
// Costs nothing while the page is closed: status knocks run only while a page
// asks for them, VNC asks for pictures only while a tab shows them, and every
// program Keeper starts is tracked and stopped when Keeper quits.

import { app, dialog, safeStorage, type WebContents } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchPlan, NoEngine, portOf, visibleParts, type LaunchCtx, type LaunchPlan } from '../../../core/rdc/clients';
import { engineInfo, ENGINES, type EngineInfo, type Os } from '../../../core/rdc/engines';
import { decodeText, detectFormat, exportText, importText, redact, type Format, type Imported } from '../../../core/rdc/formats';
import { findConnection } from '../../../core/rdc/list';
import { probePorts } from '../../../core/rdc/probe';
import { guessFromPorts, GUESS_PORTS, parseTarget } from '../../../core/rdc/uri';
import { defaultPort, type ConnectResult, type Connection, type Online, type RdcSession } from '../../../core/rdc/types';
import type { QuickResult, RdcState, VncInput } from '../../../core/rdc/api';
import type { HostId } from '../../../core/rdc/hosting';
import { magicPacket } from '../../../core/screen/wol';
import { getSecret, setSecret } from '../../store';
import { trackHelper } from '../../helpers-registry';
import { featureOn } from '../features';
import { poll } from '../governor';
import type { Endpoint } from './gateway';
import type { VncSession } from './vnc';
import { rdcTrayChanged } from './places';

// The parts that only work during a session or while sharing this screen load on first use:
// the SSH gateway and host keys, the in-app VNC client, web consoles, and hosting.
let gatewayMod: typeof import('./gateway') | null = null;
let hostMod: typeof import('./host') | null = null;
let webMod: typeof import('./web') | null = null;
const gatewayLib = async () => (gatewayMod ??= await import('./gateway'));
const hostLib = async () => (hostMod ??= await import('./host'));
const webLib = async () => (webMod ??= await import('./web'));

const OS = process.platform as Os;
type Broadcast = (channel: string, ...args: unknown[]) => void;

interface Live {
  info: RdcSession;
  endpoint?: Endpoint;
  vnc?: VncSession;
  child?: ChildProcess;
  close(): void;
}

let broadcast: Broadcast = () => undefined;
let connections: Connection[] | null = null;
const live = new Map<string, Live>();
const children = new Set<ChildProcess>();
let engineCache: { at: number; list: { def: (typeof ENGINES)[number]; found: { path: string; bin: string } | null }[] } | null = null;

// ---------------------------------------------------------------- storage

const dataDir = () => path.join(app.getPath('userData'), 'rdc');
const file = () => path.join(dataDir(), 'connections.json');

export function keychainAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
}

async function load(): Promise<Connection[]> {
  if (connections) return connections;
  try {
    const raw = JSON.parse(await fsp.readFile(file(), 'utf8')) as { connections?: Connection[] };
    connections = Array.isArray(raw.connections) ? raw.connections : [];
  } catch {
    connections = [];
  }
  return connections;
}

let saving: Promise<void> = Promise.resolve();
async function persist() {
  const list = connections ?? [];
  saving = saving.then(async () => {
    await fsp.mkdir(dataDir(), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, connections: list }, null, 1), { mode: 0o600 });
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  await saving;
  broadcast('rdc-changed');
  rdcTrayChanged();
}

const secretName = (id: string) => `rdc:${id}`;

// ---------------------------------------------------------------- programs

async function which(bin: string): Promise<string | null> {
  if (path.isAbsolute(bin)) return existsSync(bin) ? bin : null;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  // Programs in the usual places even when Keeper was started without a full PATH (from the Dock, say).
  if (OS !== 'win32') dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/snap/bin');
  const exts = OS === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const d of dirs) for (const e of exts) {
    const p = path.join(d, bin.toLowerCase().endsWith(e) ? bin : bin + e);
    try {
      const st = await fsp.stat(p);
      if (st.isFile()) return p;
    } catch { /* not here */ }
  }
  return null;
}

/** wsl.exe, when WSL's default distribution has this program (asked once, with a time limit). */
async function wslWith(program: string): Promise<string | null> {
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (!existsSync(exe)) return null;
  const out = await new Promise<string>((resolve) => {
    execFile(exe, ['--exec', 'sh', '-c', `command -v ${program}`], { timeout: 8000, windowsHide: true }, (e, o) => resolve(e ? '' : String(o)));
  });
  return out.trim() ? exe : null;
}

async function detect(refresh = false) {
  if (engineCache && !refresh && Date.now() - engineCache.at < 5 * 60_000) return engineCache.list;
  const list = await Promise.all(ENGINES.map(async (def) => {
    for (const bin of def.bins[OS] ?? []) {
      const p = await which(bin);
      if (p) return { def, found: { path: p, bin: path.basename(bin).replace(/\.exe$/i, '').toLowerCase() } };
    }
    if (def.id === 'mosh' && OS === 'win32') {
      const wsl = await wslWith('mosh');
      if (wsl) return { def, found: { path: wsl, bin: 'wsl' } };
    }
    return { def, found: null };
  }));
  engineCache = { at: Date.now(), list };
  return list;
}

async function foundMap(): Promise<LaunchCtx['found']> {
  const out: LaunchCtx['found'] = {};
  for (const e of await detect()) if (e.found) out[e.def.id] = e.found;
  return out;
}

export async function engines(refresh = false): Promise<EngineInfo[]> {
  return (await detect(refresh)).map((e) => engineInfo(e.def, OS, e.found));
}

function track(child: ChildProcess) {
  children.add(child);
  trackHelper(child);
  child.once('exit', () => children.delete(child));
}

// ---------------------------------------------------------------- Keeper Link

async function linkApi() {
  return (await import('../link')).link;
}

async function linkForward(device: string, host: string, port: number) {
  const { freePort } = await import('./gateway');
  const link = await linkApi();
  const st = await link.state();
  const dev = st.devices.find((d) => d.id === device || d.name === device);
  if (!dev) throw new Error('That Keeper device is not paired any more');
  const localPort = await freePort();
  const f = await link.addForward({ device: dev.id, kind: 'port', localPort, host, port });
  if (f.error) {
    void link.removeForward(f.id);
    throw new Error(`Keeper Link: ${f.error}`);
  }
  return { localPort, name: dev.name, remove: () => void link.removeForward(f.id).catch(() => undefined) };
}

// ---------------------------------------------------------------- sessions

function emitChanged() {
  broadcast('rdc-changed');
  rdcTrayChanged();
}

function addSession(info: RdcSession, l: Omit<Live, 'info'>): Live {
  const entry: Live = { info, ...l };
  live.set(info.id, entry);
  emitChanged();
  return entry;
}

function endSession(sid: string, state: 'closed' | 'error' = 'closed', error?: string) {
  const l = live.get(sid);
  if (!l) return;
  if (l.info.state !== 'closed' && l.info.state !== 'error') {
    l.info.state = state;
    if (error) l.info.error = error;
  }
  l.endpoint?.close();
  l.endpoint = undefined;
  emitChanged();
}

function stamp() {
  return Date.now().toString(36);
}

async function tmpDir(): Promise<string> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-rdc-'));
  await fsp.chmod(d, 0o700).catch(() => undefined);
  return d;
}

async function writeFiles(p: LaunchPlan) {
  for (const f of p.files ?? []) await fsp.writeFile(f.path, f.content, { mode: f.mode });
}

function cleanup(p: LaunchPlan, dir: string, after = p.cleanupMs ?? 30_000) {
  const t = setTimeout(() => void fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined), after);
  t.unref?.();
}

const touch = async (id: string) => {
  const list = await load();
  const c = list.find((x) => x.id === id);
  if (c) {
    c.lastUsed = Date.now();
    void persist();
  }
};

async function startExternal(c: Connection, plan: LaunchPlan, dir: string, endpoint: Endpoint, secret?: string): Promise<ConnectResult> {
  await writeFiles(plan);
  const child = spawn(plan.file, plan.args, { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, ...plan.env }, detached: false, windowsHide: false });
  track(child);
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-4000); });
  child.stdin?.on('error', () => undefined);
  if (plan.stdin !== undefined) child.stdin?.end(plan.stdin);
  else child.stdin?.end();
  cleanup(plan, dir);
  const info: RdcSession = { id: randomUUID(), connId: c.id, name: c.name, protocol: c.protocol, kind: 'external', state: 'connecting', started: Date.now(), program: plan.engine, pid: child.pid, via: endpoint.via };
  const l = addSession(info, { endpoint, child, close: () => child.kill() });
  // A program that gives up straight away (wrong address, refused) says why on its error output.
  const early = await new Promise<{ code: number | null; error?: Error } | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 2500);
    child.once('exit', (code) => { clearTimeout(t); resolve({ code }); });
    child.once('error', (error) => { clearTimeout(t); resolve({ code: -1, error }); });
  });
  if (early && (early.code !== 0 || early.error)) {
    const why = redact(early.error?.message ?? (stderr.split(/\r?\n/).filter((x) => /error|fail|refused|unable|cannot|could not/i.test(x)).slice(-3).join(' ').trim() || stderr.trim().split(/\r?\n/).slice(-2).join(' ')), [secret]).slice(0, 400);
    endSession(info.id, 'error', why || `${plan.engine} stopped (code ${early.code})`);
    return { session: l.info, message: l.info.error };
  }
  if (early) endSession(info.id, 'closed');
  else {
    l.info.state = 'connected';
    child.once('exit', (code) => endSession(info.id, code ? 'error' : 'closed', code ? redact(stderr.trim().split(/\r?\n/).slice(-1)[0] ?? '', [secret]).slice(0, 300) : undefined));
    emitChanged();
  }
  return { session: l.info, message: plan.note };
}

async function startTerminal(c: Connection, plan: LaunchPlan, dir: string, endpoint: Endpoint): Promise<ConnectResult> {
  await writeFiles(plan);
  const term = await import('../terminal');
  const s = await term.createSession({
    profile: { id: `rdc-${c.id}`, name: c.name, shell: 'custom', command: plan.file, args: plan.args, env: plan.env, badge: c.protocol === 'serial' ? '⌁' : undefined, color: c.color },
    title: c.name,
  });
  cleanup(plan, dir);
  const info: RdcSession = { id: randomUUID(), connId: c.id, name: c.name, protocol: c.protocol, kind: 'terminal', state: 'connected', started: Date.now(), terminal: s.id, program: plan.engine, via: endpoint.via };
  addSession(info, { endpoint, close: () => void term.kill(s.id).catch(() => undefined) });
  return { session: info, route: { name: 'terminal', q: `session:${s.id}` }, message: plan.note };
}

/** A saved connection by id, or one made on the spot (from the quick-connect bar or the keeper command). */
async function resolveConn(target: string | Connection): Promise<Connection> {
  if (typeof target !== 'string') return { ...target, id: target.id || `tmp-${stamp()}`, created: target.created || Date.now() };
  const list = await load();
  const c = findConnection(list, target);
  if (c) return c;
  const t = parseTarget(target);
  if (!t) throw new Error(`No connection called “${target}”`);
  const q = await quick(target);
  if (!q.conn) throw new Error(q.message ?? 'Could not tell how to connect');
  return q.conn;
}

export async function connect(target: string | Connection, opts: { password?: string; external?: boolean; trustKey?: string; trustCert?: string; viewer?: WebContents } = {}): Promise<ConnectResult> {
  if (!featureOn('remoteDesktops')) throw new Error('Remote Desktops are switched off (Settings → Features)');
  const c = await resolveConn(target);
  if (c.protocol === 'keeper') return { message: 'Keeper devices open from the Remote Desktops page or Devices.', route: { name: 'devices', arg: c.host } };
  const saved = !c.id.startsWith('tmp-');
  let password = opts.password;
  if (password === undefined && saved && !c.askEveryTime && c.hasPassword) password = await getSecret(secretName(c.id));
  if (saved) void touch(c.id);

  if (c.protocol === 'web') {
    const sid = randomUUID();
    const url = c.web?.url || `https://${c.host.includes(':') ? `[${c.host}]` : c.host}${c.port && c.port !== 443 ? `:${c.port}` : ''}/`;
    const w = await webLib();
    w.openWeb({ sid, connId: c.id, url, pin: () => connections?.find((x) => x.id === c.id)?.web?.pin ?? c.web?.pin, notify: (s, e) => broadcast('rdc-web', s, e) });
    const info: RdcSession = { id: sid, connId: c.id, name: c.name, protocol: 'web', kind: 'web', state: 'connected', started: Date.now() };
    addSession(info, { close: () => w.closeWeb(sid) });
    return { session: info, route: { name: 'rdc', arg: 'web', q: sid } };
  }

  const { HostKeyQuestion, knownHostsFile, openEndpoint, verifyHostKey } = await gatewayLib();
  let endpoint: Endpoint;
  try {
    endpoint = await openEndpoint(c, { secret: (n) => getSecret(n), linkForward, trustedKey: opts.trustKey });
  } catch (e) {
    if (e instanceof HostKeyQuestion) return { hostKey: e.key };
    throw e;
  }
  try {
    if (c.protocol === 'vnc' && !opts.external && !c.vnc?.external) {
      const sid = randomUUID();
      const info: RdcSession = { id: sid, connId: c.id, name: c.name, protocol: 'vnc', kind: 'inapp', state: 'connecting', started: Date.now(), via: endpoint.via };
      const { VncSession } = await import('./vnc');
      const vnc = new VncSession(sid, {
        host: endpoint.host, port: endpoint.port, password, username: c.user, shared: c.vnc?.shared !== false, viewOnly: c.vnc?.viewOnly, picture: c.vnc?.picture,
        onState: (st, i) => {
          const l = live.get(sid);
          if (!l) return;
          if (st === 'connected') Object.assign(l.info, { state: 'connected', width: i?.width, height: i?.height, desktop: i?.desktop });
          else endSession(sid, st, i?.error);
          emitChanged();
        },
      });
      addSession(info, { endpoint, vnc, close: () => vnc.close() });
      try {
        await vnc.start();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        live.delete(sid);
        endpoint.close();
        emitChanged();
        if (msg === 'PASSWORD_NEEDED') return { needPassword: true };
        throw new Error(msg);
      }
      if (opts.viewer) vnc.attach(opts.viewer);
      return { session: info, route: { name: 'rdc', arg: 'vnc', q: sid } };
    }

    // SSH and Mosh: compare the server's key first (ssh would ask in the terminal; with a stored password it cannot).
    if ((c.protocol === 'ssh' || c.protocol === 'mosh') && !c.jump?.length && c.gateway?.kind !== 'ssh') {
      await verifyHostKey(endpoint.host, endpoint.port, opts.trustKey, endpoint.aliasOf ? { host: endpoint.aliasOf, port: 22 } : undefined);
    }
    const dir = await tmpDir();
    let plan: LaunchPlan;
    try {
      plan = launchPlan(c, { os: OS, found: await foundMap(), host: endpoint.host, port: endpoint.port, password, tmp: dir, home: os.homedir(), aliasOf: endpoint.aliasOf, stamp: stamp(),
        // ssh reads the account's own home, not $HOME: point it at the file Keeper checked when they differ.
        knownHosts: os.userInfo().homedir !== os.homedir() ? knownHostsFile() : undefined });
    } catch (e) {
      void fsp.rm(dir, { recursive: true, force: true });
      throw e;
    }
    if (plan.where === 'terminal') return await startTerminal(c, plan, dir, endpoint);
    return await startExternal(c, plan, dir, endpoint, password);
  } catch (e) {
    endpoint.close();
    if (e instanceof HostKeyQuestion) return { hostKey: e.key };
    if (e instanceof NoEngine) throw new Error(e.message);
    throw e;
  }
}

export function disconnect(sid: string) {
  const l = live.get(sid);
  if (!l) return;
  l.close();
  endSession(sid, 'closed');
  live.delete(sid);
  emitChanged();
}

/** The exact command a connection would run (no secret ever shows: a stored password shows as "from standard input" or a private file). */
export async function command(target: string | Connection) {
  try {
    const c = await resolveConn(target);
    const hasPw = !!c.hasPassword && !c.askEveryTime;
    const placeholder = '<password>';
    const dir = path.join(os.tmpdir(), 'keeper-rdc-XXXX');
    const port = portOf(c);
    const plan = launchPlan(c, { os: OS, found: await foundMap(), host: c.gateway?.kind === 'mesh' ? c.gateway.address : c.gateway && c.gateway.kind !== 'none' ? '127.0.0.1' : c.host, port, password: hasPw ? placeholder : undefined, tmp: dir, home: os.homedir() });
    return { file: plan.file, args: plan.args, engine: plan.engine, note: plan.note, stdin: plan.stdin !== undefined, files: (plan.files ?? []).map((f) => f.path) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- VNC tabs

export function vncAttach(sid: string, wc: WebContents) {
  const l = live.get(sid);
  if (!l?.vnc || l.info.state !== 'connected') return null;
  l.vnc.attach(wc);
  return { width: l.vnc.width, height: l.vnc.height, desktop: l.vnc.desktop, viewOnly: l.vnc.viewOnly };
}

export const vnc = {
  detach: (sid: string, wc?: WebContents) => live.get(sid)?.vnc?.detach(wc),
  input: (sid: string, ev: VncInput[]) => live.get(sid)?.vnc?.input(Array.isArray(ev) ? ev.slice(0, 500) : []),
  ack: (sid: string, seq: number) => live.get(sid)?.vnc?.ack(seq),
  clipboard: async (sid: string, text: string) => live.get(sid)?.vnc?.clipboard(String(text).slice(0, 1 << 20)),
  keys: async (sid: string, combo: string) => live.get(sid)?.vnc?.keys(combo),
  setViewOnly: async (sid: string, on: boolean) => { const v = live.get(sid)?.vnc; if (v) v.viewOnly = on; },
};

export const web = {
  // A web console exists only after connect() loaded the module.
  show: (sid: string, wc: WebContents, rect: { x: number; y: number; width: number; height: number } | null) => webMod?.showWeb(sid, wc, rect) ?? null,
  action: async (sid: string, a: 'back' | 'forward' | 'reload' | 'home' | 'external') => webMod?.webAction(sid, a),
};

// ---------------------------------------------------------------- the list

/** What is known in memory right now, with no file, keychain or terminal-host access: for the tray menu. */
export function snapshot(): { connections: Connection[]; sessions: RdcSession[] } {
  return { connections: connections ?? [], sessions: [...live.values()].map((l) => l.info) };
}

/** Reads the saved list in the background (once), so the tray can show it. */
export function preload(): void {
  void load().then(() => rdcTrayChanged()).catch(() => undefined);
}

export async function state(): Promise<RdcState> {
  const list = await load();
  // Terminal tabs that ended show as closed.
  const terms = [...live.values()].filter((l) => l.info.kind === 'terminal' && l.info.state === 'connected');
  if (terms.length) {
    const term = await import('../terminal');
    const running = new Map((await term.listSessions().catch(() => [])).map((s) => [s.id, s]));
    for (const l of terms) {
      const s = running.get(l.info.terminal ?? '');
      if (!s || s.exit) l.info.state = 'closed';
    }
  }
  return { connections: list, sessions: [...live.values()].map((l) => l.info).sort((a, b) => b.started - a.started), keychain: keychainAvailable(), platform: OS };
}

function cleanPatch<T extends Partial<Connection>>(c: T): T {
  const out = { ...c };
  delete (out as Partial<Connection>).hasPassword;
  if (out.port !== undefined && (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535)) delete out.port;
  if (out.name !== undefined) out.name = String(out.name).slice(0, 200).trim();
  return out;
}

export async function save(c: Partial<Connection> & { name: string; protocol: Connection['protocol']; host: string }): Promise<Connection> {
  const list = await load();
  const patch = cleanPatch(c);
  if (!patch.host?.trim()) throw new Error('Enter a computer name or address');
  if (patch.port === defaultPort(patch.protocol)) delete patch.port;
  const i = c.id ? list.findIndex((x) => x.id === c.id) : -1;
  let out: Connection;
  if (i >= 0) {
    out = { ...list[i], ...patch, id: list[i].id, created: list[i].created, hasPassword: list[i].hasPassword };
    list[i] = out;
  } else {
    out = { ...patch, id: randomUUID(), created: Date.now(), name: patch.name || patch.host } as Connection;
    list.push(out);
  }
  if (out.askEveryTime && out.hasPassword) {
    await setSecret(secretName(out.id), '');
    out.hasPassword = false;
  }
  await persist();
  return out;
}

export async function remove(ids: string[]) {
  const list = await load();
  for (const id of ids) {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) continue;
    if (list[i].hasPassword) await setSecret(secretName(id), '').catch(() => false);
    list.splice(i, 1);
  }
  await persist();
}

export async function duplicate(id: string) {
  const c = (await load()).find((x) => x.id === id);
  if (!c) throw new Error('Not found');
  const { id: _i, created: _c, hasPassword: _h, lastUsed: _l, ...rest } = c;
  return save({ ...rest, name: `${c.name} copy` });
}

export async function setPassword(id: string, password: string | null): Promise<boolean> {
  const list = await load();
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error('Not found');
  if (!password) {
    await setSecret(secretName(id), '');
    c.hasPassword = false;
    await persist();
    return true;
  }
  if (!keychainAvailable()) return false;
  const ok = await setSecret(secretName(id), password);
  c.hasPassword = ok;
  if (ok) c.askEveryTime = false;
  await persist();
  return ok;
}

export async function quick(text: string): Promise<QuickResult> {
  const t = parseTarget(text);
  if (!t) return { message: 'Type a computer name, an address, or a link like rdp://host, vnc://host:5901 or ssh user@host' };
  const make = (protocol: Connection['protocol'], port?: number): Connection => ({
    id: `tmp-${stamp()}`, created: Date.now(), name: t.host, protocol, host: t.host, user: t.user,
    port: port && port !== defaultPort(protocol) ? port : undefined, ...(t.extra ?? {}),
  });
  if (!t.guess && t.protocol) return { conn: make(t.protocol, t.port) };
  const ports = t.port ? [t.port] : GUESS_PORTS;
  const probed = await probePorts(t.host, ports, { timeoutMs: 600 });
  const open = probed.filter((p) => p.open).map((p) => p.port);
  const g = guessFromPorts(open);
  if (!g) return { probed, message: open.length ? `Port ${open.join(', ')} answers, but Keeper cannot tell which protocol it speaks. Type it as rdp://, vnc:// or ssh://.` : `Nothing answers at ${t.host} on the usual ports (RDP, VNC, SSH, PowerShell). Is it on, and on this network?` };
  return { conn: make(g.protocol, g.port), probed };
}

export const probe = (host: string, ports?: number[]) => probePorts(host, (ports?.length ? ports : GUESS_PORTS).slice(0, 64), { timeoutMs: 700 });

// ---------------------------------------------------------------- status dots (only while a page asks)

const watchers = new Set<number>();
let stopPoll: (() => void) | null = null;
let lastStatus: Record<string, Online> = {};

async function checkAll() {
  const list = await load();
  const out: Record<string, Online> = {};
  let devices: Map<string, boolean> | null = null;
  const knock: { id: string; host: string; port: number }[] = [];
  for (const c of list) {
    const g = c.gateway;
    if (c.protocol === 'keeper' || g?.kind === 'link') {
      if (!devices) devices = new Map((await Promise.resolve().then(async () => (await linkApi()).state()).catch(() => ({ devices: [] as { id: string; online: boolean }[] }))).devices.map((d) => [d.id, d.online] as [string, boolean]));
      const dev = c.protocol === 'keeper' ? c.host : (g as { device: string }).device;
      out[c.id] = devices.has(dev) ? (devices.get(dev) ? 'online' : 'offline') : 'unknown';
    } else if (c.protocol === 'serial') out[c.id] = existsSync(c.host) ? 'online' : OS === 'win32' ? 'unknown' : 'offline';
    else if (g?.kind === 'proxy') out[c.id] = 'unknown';
    else if (g?.kind === 'ssh') knock.push({ id: c.id, host: g.host, port: g.port ?? 22 });
    else knock.push({ id: c.id, host: g?.kind === 'mesh' ? g.address : c.host, port: c.protocol === 'web' ? (c.web?.url ? Number(new URL(c.web.url).port) || (c.web.url.startsWith('http:') ? 80 : 443) : portOf(c)) : portOf(c) });
  }
  // A few at a time, each a single short knock.
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < knock.length) {
      const k = knock[i++];
      const [r] = await probePorts(k.host, [k.port], { timeoutMs: 800 });
      out[k.id] = r.open ? 'online' : 'offline';
    }
  }));
  lastStatus = out;
  broadcast('rdc-status', out);
}

export function watch(wc: WebContents, on: boolean): Record<string, Online> {
  if (on) {
    if (!watchers.has(wc.id)) {
      watchers.add(wc.id);
      wc.once('destroyed', () => { watchers.delete(wc.id); if (!watchers.size) { stopPoll?.(); stopPoll = null; } });
    }
    if (!stopPoll) stopPoll = poll('rdc-status', { baseMs: 30_000, pauseWhenLocked: true, idleFactor: 4, maxMs: 5 * 60_000 }, () => checkAll(), { feature: 'remoteDesktops' });
  } else {
    watchers.delete(wc.id);
    if (!watchers.size) { stopPoll?.(); stopPoll = null; }
  }
  return lastStatus;
}

export const watching = () => !!stopPoll;

// ---------------------------------------------------------------- Wake-on-LAN

export async function wake(id: string): Promise<{ sent: number }> {
  const c = (await load()).find((x) => x.id === id);
  if (!c?.mac) throw new Error('Add the computer’s network card address (MAC) in its settings first');
  const pkt = Buffer.from(magicPacket(c.mac));
  const targets = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) {
    if (a.family !== 'IPv4' || a.internal) continue;
    const ip = a.address.split('.').map(Number);
    const m = a.netmask.split('.').map(Number);
    targets.add(ip.map((x, k) => (x & m[k]) | (~m[k] & 255)).join('.'));
  }
  const sock = dgram.createSocket('udp4');
  await new Promise<void>((r) => sock.bind(() => { sock.setBroadcast(true); r(); }));
  let sent = 0;
  for (const t of targets) for (const port of [9, 7]) {
    await new Promise<void>((r) => sock.send(pkt, port, t, (e) => { if (!e) sent++; r(); }));
  }
  sock.close();
  return { sent };
}

// ---------------------------------------------------------------- import and export

async function addImported(items: Imported[]): Promise<{ added: Connection[]; secrets: number; skipped: number }> {
  const list = await load();
  const added: Connection[] = [];
  let secrets = 0;
  let skipped = 0;
  for (const it of items) {
    const dupe = list.find((x) => x.protocol === it.conn.protocol && x.host === it.conn.host && (x.port ?? 0) === (it.conn.port ?? 0) && (x.user ?? '') === (it.conn.user ?? ''));
    if (dupe) { skipped++; continue; }
    const c: Connection = { ...it.conn, id: randomUUID(), created: Date.now() };
    list.push(c);
    added.push(c);
    if (it.secret && keychainAvailable() && (await setSecret(secretName(c.id), it.secret))) {
      c.hasPassword = true;
      secrets++;
    }
  }
  await persist();
  return { added, secrets, skipped };
}

/** Adds one connection read from a file (double-clicked .rdp/.vnc), or finds the same one already saved. */
export async function importConn(conn: Omit<Connection, 'id' | 'created'>, secret?: string): Promise<Connection> {
  const list = await load();
  const same = list.find((x) => x.protocol === conn.protocol && x.host === conn.host && (x.port ?? 0) === (conn.port ?? 0) && (x.user ?? '') === (conn.user ?? ''));
  if (same) return same;
  const r = await addImported([{ conn, secret }]);
  return r.added[0];
}

export async function importTextIn(text: string, format?: Format, fileName = '') {
  const f = format ?? detectFormat(text, fileName);
  if (!f) throw new Error('Keeper does not recognise this file. It reads .rdp, .vnc, ssh config and Keeper’s own JSON.');
  return addImported(importText(text, f, fileName));
}

export async function importFile(p?: string) {
  let files = p ? [p] : [];
  if (!files.length) {
    const r = await dialog.showOpenDialog({ title: 'Import connections', properties: ['openFile', 'multiSelections', 'showHiddenFiles'], defaultPath: path.join(os.homedir(), '.ssh'), filters: [{ name: 'Connections', extensions: ['rdp', 'vnc', 'json', 'conf', '*'] }] });
    if (r.canceled) return null;
    files = r.filePaths;
  }
  const total = { added: [] as Connection[], secrets: 0, skipped: 0 };
  for (const f of files) {
    const text = decodeText(new Uint8Array(await fsp.readFile(f)));
    const r = await importTextIn(text, undefined, f);
    total.added.push(...r.added);
    total.secrets += r.secrets;
    total.skipped += r.skipped;
  }
  return total;
}

export async function exportTextOut(ids: string[], format: Format) {
  const list = await load();
  const chosen = ids.length ? list.filter((c) => ids.includes(c.id)) : list;
  return exportText(chosen, format);
}

export async function exportTo(ids: string[], format: Format) {
  const list = await load();
  const first = list.find((c) => c.id === ids[0]);
  const name = format === 'json' ? 'connections.json' : format === 'ssh' ? 'ssh_config' : `${(first?.name ?? 'connection').replace(/[^\w.-]+/g, '-')}.${format}`;
  const r = await dialog.showSaveDialog({ title: 'Export connections', defaultPath: path.join(app.getPath('documents'), name) });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, await exportTextOut(ids, format), { mode: 0o600 });
  return r.filePath;
}

// ---------------------------------------------------------------- this computer

const hostDeps = () => ({
  which,
  track,
  dataDir: app.getPath('userData'),
  linkDevices: async () => {
    const st = await (await linkApi()).state();
    return st.devices.filter((d) => d.permissions.forward).map((d) => ({ device: d.id, name: d.name }));
  },
});

export const hosting = {
  status: () => {
    if (!featureOn('rdcHosting')) throw new Error('Turn on “Remote Desktop into this computer” in Settings → Features first');
    return hostLib().then((h) => h.hostStatus(hostDeps()));
  },
  set: (id: HostId, on: boolean, o?: { password?: string; localOnly?: boolean }) => {
    if (!featureOn('rdcHosting')) throw new Error('Turn on “Remote Desktop into this computer” in Settings → Features first');
    return hostLib().then((h) => h.hostSet(hostDeps(), id, on, o));
  },
  fix: (check: 'nla' | 'lockout') => hostLib().then((h) => h.hostFix(check)),
  async viaLink(device: string, on: boolean) {
    const link = await linkApi();
    const st = await link.state();
    const d = st.devices.find((x) => x.id === device || x.name === device);
    if (!d) return { ok: false, message: 'That device is not paired' };
    await link.setPermissions(d.id, { ...d.permissions, forward: on });
    return { ok: true, message: on ? `${d.name} can now reach Remote Desktop and VNC here through Keeper Link (no ports opened to the internet). On ${d.name}, add this computer with “Through Keeper Link” and the address localhost.` : `${d.name} can no longer reach ports here.` };
  },
};

// ---------------------------------------------------------------- start and stop

export function initRdc(d: { broadcast: Broadcast }) {
  broadcast = d.broadcast;
}

/** Everything Keeper started for remote desktops ends with Keeper. */
export function stopRdc() {
  stopPoll?.();
  stopPoll = null;
  for (const l of live.values()) { try { l.vnc?.close(); l.endpoint?.close(); } catch { /* closing */ } }
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
  live.clear();
  webMod?.closeAllWeb();
  hostMod?.stopHostVnc();
}

/** For tests and `keeper rdc`: how many programs are running now. */
export const runningPrograms = () => children.size;

export { visibleParts };
