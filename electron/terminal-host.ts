// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper's terminal session host. A small Node process (started by Keeper with
// ELECTRON_RUN_AS_NODE) that owns the terminals, so they keep running when the
// window closes and, if the person wants, after Keeper quits. It remembers the
// recent output of each terminal and saves it to disk when it stops, so the
// scrollback can be read again later.
//
// It does nothing while terminals are quiet: no timers run unless output is
// waiting to be sent or a save is due.

import { randomUUID } from 'node:crypto';
import { promises as fsp, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ShellIntegration } from '../core/terminal/osc';
import { encode, LineDecoder, PROTOCOL_VERSION, type ClientMsg, type HostMsg } from '../core/terminal/protocol';
import { RingBuffer } from '../core/terminal/ring';
import type { SessionInfo } from '../core/terminal/types';

type Pty = import('node-pty').IPty;

const DATA = process.env.KEEPER_HOST_DATA ?? process.cwd();
const SOCKET = process.env.KEEPER_HOST_SOCKET!;
const TOKEN_FILE = path.join(DATA, 'terminal', 'host.token');
const SAVE_FILE = path.join(DATA, 'terminal', 'sessions.json.gz');
const PID_FILE = path.join(DATA, 'terminal', 'host.pid');
/** With nothing running and nobody connected, the host leaves after this long. */
const IDLE_EXIT_MS = 30_000;
const MAX_RESTORED = 40;

interface Session {
  info: SessionInfo;
  pty?: Pty;
  ring: RingBuffer;
  integration: ShellIntegration;
  subscribers: Set<Client>;
  /** output waiting to be sent, flushed a few milliseconds later in one message */
  pending: string;
  /** characters printed so far (output already sent plus pending) */
  total: number;
  /** where the pending output starts */
  pendingAt: number;
  flush?: NodeJS.Timeout;
  /** the size each client asked for; the latest one wins */
  startup?: string;
}

interface Client {
  sock: net.Socket;
  authed: boolean;
  name: string;
}

const sessions = new Map<string, Session>();
const clients = new Set<Client>();
let keepAlive: 'window' | 'quit' | 'never' = 'window';
let dirty = false;
let saveTimer: NodeJS.Timeout | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let ptyMod: typeof import('node-pty') | undefined;

function loadPty(): typeof import('node-pty') {
  // Loaded on first use, so starting the host (and restoring scrollback) never waits for it.
  if (!ptyMod) {
    // macOS packages of node-pty lose spawn-helper's execute bit; without it no shell starts.
    if (process.platform === 'darwin') {
      try {
        const root = path.dirname(require.resolve('node-pty/package.json')).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
        for (const d of ['prebuilds', 'build']) {
          const dir = path.join(root, d);
          for (const sub of existsSync(dir) ? readdirSync(dir) : []) {
            const helper = path.join(dir, sub, 'spawn-helper');
            if (existsSync(helper) && (statSync(helper).mode & 0o111) !== 0o111) chmodSync(helper, 0o755);
          }
        }
      } catch {
        /* read-only install: the shell will report it */
      }
    }
    ptyMod = require('node-pty') as typeof import('node-pty');
  }
  return ptyMod;
}

const token = (() => {
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  const t = randomUUID() + randomUUID();
  writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  try {
    chmodSync(TOKEN_FILE, 0o600);
  } catch {
    /* Windows: the file sits in the user's own profile folder */
  }
  return t;
})();

function send(c: Client, m: HostMsg) {
  if (!c.sock.destroyed) c.sock.write(encode(m));
}

function list(): SessionInfo[] {
  return [...sessions.values()].map((s) => ({ ...s.info, clients: s.subscribers.size }));
}

function broadcastList() {
  const ss = list();
  for (const c of clients) if (c.authed) send(c, { t: 'sessions', sessions: ss });
}

function markDirty() {
  dirty = true;
  // Save now and then while output flows, so even a crash loses little.
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void save();
    }, 60_000);
    saveTimer.unref();
  }
}

function flushNow(s: Session) {
  if (s.flush) clearTimeout(s.flush);
  s.flush = undefined;
  if (!s.pending) return;
  const data = s.pending;
  const at = s.pendingAt;
  s.pending = '';
  s.pendingAt = s.total;
  for (const c of s.subscribers) send(c, { t: 'data', id: s.info.id, data, at });
}

function onOutput(s: Session, data: string) {
  s.ring.push(data);
  s.info.lastActivity = Date.now();
  for (const ev of s.integration.feed(data)) {
    if (ev.kind === 'cwd') s.info.cwd = ev.path;
    else if (ev.kind === 'title' && ev.title) s.info.title = ev.title.slice(0, 120);
    else if (ev.kind === 'command-start') s.info.running = ev.command ?? '…';
    else if (ev.kind === 'command-end') s.info.running = undefined;
    for (const c of s.subscribers) send(c, { t: 'event', id: s.info.id, ev });
  }
  if (s.startup) {
    // Type the start-up command once the shell has printed something (its prompt).
    const cmd = s.startup;
    s.startup = undefined;
    setTimeout(() => s.pty?.write(cmd + '\r'), 150);
  }
  s.pending += data;
  s.total += data.length;
  // Small batches: smooth for the eye, far fewer messages for fast output.
  if (!s.flush) s.flush = setTimeout(() => flushNow(s), s.pending.length > 64 * 1024 ? 0 : 6);
  markDirty();
}

function create(m: Extract<ClientMsg, { t: 'create' }>): SessionInfo {
  const id = randomUUID().slice(0, 8);
  const pty = loadPty();
  const { launch, spec } = m;
  const p = pty.spawn(launch.file, launch.args, {
    name: 'xterm-256color',
    cols: Math.max(2, spec.cols | 0),
    rows: Math.max(1, spec.rows | 0),
    cwd: existsSync(launch.cwd) ? launch.cwd : (process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()),
    env: { ...launch.env, KEEPER_SESSION: id },
    // Newer Windows: the system pseudo-console.
    useConpty: process.platform === 'win32' ? true : undefined,
  });
  const now = Date.now();
  const s: Session = {
    info: {
      id, title: spec.title ?? spec.profile.name, profileId: spec.profile.id, profileName: spec.profile.name, pid: p.pid,
      cwd: launch.cwd, createdAt: now, lastActivity: now, clients: 0, group: spec.group, cols: spec.cols, rows: spec.rows,
    },
    pty: p,
    ring: new RingBuffer(m.scrollback || 10_000),
    integration: new ShellIntegration(),
    subscribers: new Set(),
    pending: '',
    total: 0,
    pendingAt: 0,
    startup: launch.startup,
  };
  sessions.set(id, s);
  p.onData((d) => onOutput(s, d));
  p.onExit(({ exitCode, signal }) => {
    flushNow(s);
    s.pty = undefined;
    s.info.exit = { code: exitCode, signal, at: Date.now() };
    s.info.running = undefined;
    for (const c of s.subscribers) send(c, { t: 'exit', id, code: exitCode, signal });
    broadcastList();
    markDirty();
    checkIdle();
  });
  broadcastList();
  clearTimeout(idleTimer);
  return s.info;
}

function kill(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty?.kill();
  } catch {
    /* already gone */
  }
  if (s.flush) clearTimeout(s.flush);
  sessions.delete(id);
  broadcastList();
  markDirty();
  checkIdle();
}

async function save() {
  if (!dirty) return;
  dirty = false;
  const data = [...sessions.values()].slice(-MAX_RESTORED).map((s) => ({ info: s.info, buffer: s.ring.snapshot() }));
  const tmp = `${SAVE_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, gzipSync(JSON.stringify(data)), { mode: 0o600 });
  await fsp.rename(tmp, SAVE_FILE);
}

function saveSync() {
  try {
    const data = [...sessions.values()].slice(-MAX_RESTORED).map((s) => ({ info: s.info, buffer: s.ring.snapshot() }));
    writeFileSync(SAVE_FILE, gzipSync(JSON.stringify(data)), { mode: 0o600 });
  } catch {
    /* nothing more can be done while stopping */
  }
}

/** Terminals from last time come back as read-only scrollback with their folder, ready to start again. */
function restore() {
  try {
    const saved = JSON.parse(gunzipSync(readFileSync(SAVE_FILE)).toString('utf8')) as { info: SessionInfo; buffer: string }[];
    for (const { info, buffer } of saved) {
      const ring = new RingBuffer(200_000, 16 * 1024 * 1024);
      ring.push(buffer);
      sessions.set(info.id, {
        info: { ...info, restored: true, pid: undefined, running: undefined, exit: info.exit ?? { code: 0, at: Date.now() } },
        ring, integration: new ShellIntegration(), subscribers: new Set(), pending: '', total: buffer.length, pendingAt: buffer.length,
      });
    }
  } catch {
    /* nothing saved, or saved by an older version */
  }
}

function checkIdle() {
  clearTimeout(idleTimer);
  const live = [...sessions.values()].some((s) => s.pty);
  const anyone = [...clients].some((c) => c.authed);
  if (live || anyone) return;
  idleTimer = setTimeout(() => shutdown(true), IDLE_EXIT_MS);
  idleTimer.unref();
}

let stopping = false;
function shutdown(saveIt: boolean) {
  if (stopping) return;
  stopping = true;
  if (saveIt) {
    dirty = true;
    saveSync();
  }
  for (const s of sessions.values()) {
    try {
      s.pty?.kill();
    } catch {
      /* ignore */
    }
  }
  server.close();
  try {
    if (process.platform !== 'win32') unlinkSync(SOCKET);
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  process.exit(0);
}

function handle(c: Client, m: ClientMsg) {
  if (!c.authed) {
    if (m.t === 'hello' && m.token === token) {
      c.authed = true;
      c.name = m.client;
      clearTimeout(idleTimer);
      send(c, { t: 'welcome', version: PROTOCOL_VERSION, pid: process.pid, sessions: list() });
    } else c.sock.destroy();
    return;
  }
  const reply = (rid: number, data?: unknown, error?: string) => send(c, { t: 'reply', rid, ok: !error, data, error });
  switch (m.t) {
    case 'list':
      return reply(m.rid, list());
    case 'create':
      try {
        const info = create(m);
        return reply(m.rid, info);
      } catch (e) {
        return reply(m.rid, undefined, e instanceof Error ? e.message : String(e));
      }
    case 'attach': {
      const s = sessions.get(m.id);
      if (!s) return reply(m.rid, undefined, 'No such terminal');
      flushNow(s);
      s.subscribers.add(c);
      return reply(m.rid, { data: s.ring.snapshot(), total: s.total, info: { ...s.info, clients: s.subscribers.size } });
    }
    case 'detach':
      sessions.get(m.id)?.subscribers.delete(c);
      return;
    case 'input':
      sessions.get(m.id)?.pty?.write(m.data);
      return;
    case 'resize': {
      const s = sessions.get(m.id);
      if (!s?.pty) return;
      const cols = Math.max(2, Math.min(1000, m.cols | 0));
      const rows = Math.max(1, Math.min(500, m.rows | 0));
      if (cols === s.info.cols && rows === s.info.rows) return;
      s.info.cols = cols;
      s.info.rows = rows;
      try {
        s.pty.resize(cols, rows);
      } catch {
        /* the program just ended */
      }
      return;
    }
    case 'kill':
      kill(m.id);
      return reply(m.rid, true);
    case 'rename': {
      const s = sessions.get(m.id);
      if (s) s.info.title = m.title.slice(0, 120);
      broadcastList();
      return;
    }
    case 'group': {
      const s = sessions.get(m.id);
      if (s) s.info.group = m.group;
      broadcastList();
      return;
    }
    case 'clear':
      sessions.get(m.id)?.ring.clear();
      return;
    case 'info': {
      const s = sessions.get(m.id);
      return s ? reply(m.rid, { ...s.info, clients: s.subscribers.size }) : reply(m.rid, undefined, 'No such terminal');
    }
    case 'keepAlive':
      keepAlive = m.mode;
      return;
    case 'shutdown':
      reply(m.rid, true);
      setTimeout(() => shutdown(m.save), 20);
      return;
    case 'ping':
      return reply(m.rid, { pid: process.pid, sessions: sessions.size });
  }
}

const server = net.createServer((sock) => {
  const c: Client = { sock, authed: false, name: '' };
  clients.add(c);
  sock.setEncoding('utf8');
  const dec = new LineDecoder<ClientMsg>((m) => handle(c, m));
  sock.on('data', (d) => dec.push(d));
  const gone = () => {
    clients.delete(c);
    for (const s of sessions.values()) s.subscribers.delete(c);
    // Keeper quit without asking to keep terminals: end them, keeping their scrollback.
    if (c.name === 'app' && keepAlive !== 'quit' && ![...clients].some((x) => x.authed && x.name === 'app')) {
      shutdown(true);
      return;
    }
    checkIdle();
  };
  sock.on('close', gone);
  sock.on('error', () => sock.destroy());
});

restore();
if (process.platform !== 'win32') {
  try {
    unlinkSync(SOCKET);
  } catch {
    /* no stale socket */
  }
}
server.listen(SOCKET, () => {
  if (process.platform !== 'win32') chmodSync(SOCKET, 0o600);
  writeFileSync(PID_FILE, String(process.pid));
  process.send?.({ ready: true, pid: process.pid });
  checkIdle();
});
server.on('error', (e) => {
  process.send?.({ ready: false, error: String(e) });
  process.exit(1);
});

process.on('SIGTERM', () => shutdown(true));
process.on('SIGINT', () => shutdown(true));
process.on('SIGHUP', () => {
  /* the terminal that started Keeper closed; terminals keep running */
});
process.on('uncaughtException', (e) => {
  try {
    writeFileSync(path.join(DATA, 'terminal', 'host-error.log'), String(e?.stack ?? e));
  } catch {
    /* ignore */
  }
});
// Disconnect from the parent so closing Keeper does not take the host with it (when keeping terminals).
process.on('disconnect', () => undefined);
