// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The app's end of the suite channel. Parts (the Island, widgets) connect here,
// prove they belong to this run of Keeper, and then:
//
//   • their windows' calls (window.keeper.*) run here, through the very same
//     handlers the main window uses (every ipcMain.handle is noted as it is
//     registered, so nothing has to be listed twice);
//   • the events Keeper sends its windows reach the parts' windows too;
//   • the app can ask a part to do something (open the Island on a tab…).
//
// Imported first thing by main.ts, before any handler is registered.

import { app, ipcMain } from 'electron';
import { rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type net from 'node:net';
import { partDef, tokenMatches, validHello, type PartRole, type SenderInfo, type SuiteMessage } from '../../core/suite';
import { relaunchCommand } from '../resilience';
import { clearCoreInfo, listen, newToken, socketPath, suiteDir, writeCoreInfo, type Peer } from './channel';

type Handler = (e: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

// Every handler registered from now on is also callable from the parts.
const origHandle = ipcMain.handle.bind(ipcMain);
const origRemove = ipcMain.removeHandler.bind(ipcMain);
(ipcMain as { handle: unknown }).handle = (channel: string, fn: Handler) => {
  origHandle(channel, fn as never);
  handlers.set(channel, fn);
  channelsChanged();
};
(ipcMain as { removeHandler: unknown }).removeHandler = (channel: string) => {
  origRemove(channel);
  handlers.delete(channel);
};

/** A connected part. */
interface Conn { role: PartRole; pid: number; peer: Peer; seq: number; pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> }

const conns = new Map<PartRole, Conn>();
let token = '';
let server: net.Server | null = null;
const listeners = { hello: new Set<(role: PartRole, pid: number) => void>(), bye: new Set<(role: PartRole, pid: number) => void>() };

export function onPartHello(fn: (role: PartRole, pid: number) => void) { listeners.hello.add(fn); }

/** Parts without windows (Mail and calendars) need none of the windows' channels or events, only the settings. */
const windowless = (role: PartRole) => role === 'mail';

/** What a part tells the app (`note`), by part. */
const notes = new Map<PartRole, (name: string, args: unknown[]) => void>();
export function onPartNote(role: PartRole, fn: (name: string, args: unknown[]) => void) { notes.set(role, fn); }

/** Where a keeper:// link a part received goes (main.ts: the same place as the app's own open-url). */
let openUrl: ((url: string) => void) | null = null;
export function onPartOpenUrl(fn: (url: string) => void) { openUrl = fn; }

/** The app's answers for parts only (`suite:<name>`): never reachable from a window. */
const partHandlers = new Map<string, { roles: PartRole[]; fn: (...args: unknown[]) => unknown }>();
export function handleForParts(name: string, roles: PartRole[], fn: (...args: never[]) => unknown) { partHandlers.set(`suite:${name}`, { roles, fn: fn as (...args: unknown[]) => unknown }); }

/** Resolves once the part is connected (at once if it is), or rejects after `ms`. */
export function whenPart(role: PartRole, ms: number): Promise<void> {
  if (conns.has(role)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const go = (r: PartRole) => { if (r === role) { clearTimeout(t); listeners.hello.delete(go); resolve(); } };
    const t = setTimeout(() => { listeners.hello.delete(go); reject(new Error(`${partDef(role).name} is starting again; try once more in a moment`)); }, ms);
    listeners.hello.add(go);
  });
}
export function onPartBye(fn: (role: PartRole, pid: number) => void) { listeners.bye.add(fn); }
export const partConnected = (role: PartRole) => conns.has(role);
export const partPid = (role: PartRole) => conns.get(role)?.pid;

let settingsNow: () => unknown = () => ({});

const sendChannels = () => ipcMain.eventNames().filter((n): n is string => typeof n === 'string');

let channelsTimer: NodeJS.Timeout | undefined;
function channelsChanged() {
  if (!conns.size || channelsTimer) return;
  channelsTimer = setTimeout(() => {
    channelsTimer = undefined;
    for (const c of conns.values()) if (!windowless(c.role)) c.peer.send({ t: 'channels', channels: [...handlers.keys()], sends: sendChannels() });
  }, 200);
}

/** What a handler sees as `event.sender` for a call from a part's window: enough to answer it. */
function senderFor(c: Conn, s?: SenderInfo) {
  const id = s?.id ?? 0;
  const wc = {
    id: -1_000_000 - id,
    fromPart: c.role,
    send: (channel: string, ...args: unknown[]) => { c.peer.send({ t: 'event', channel, args, to: id }); },
    getURL: () => s?.url ?? '',
    isDestroyed: () => c.peer.isClosed,
    isLoading: () => false,
    getOSProcessId: () => c.pid,
    on: () => wc, once: () => wc, off: () => wc, removeListener: () => wc,
  };
  return { sender: wc, senderFrame: null, processId: c.pid, frameId: 0, returnValue: undefined as unknown, preventDefault: () => undefined, reply: wc.send };
}

async function onCall(c: Conn, m: Extract<SuiteMessage, { t: 'call' }>) {
  if (m.channel.startsWith('suite:')) {
    const h = partHandlers.get(m.channel);
    if (!h || !h.roles.includes(c.role)) return c.peer.send({ t: 'result', id: m.id, ok: false, error: `No handler registered for '${m.channel}'` });
    try {
      c.peer.send({ t: 'result', id: m.id, ok: true, value: (await h.fn(...m.args)) ?? null });
    } catch (e) {
      c.peer.send({ t: 'result', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  // A part without windows has no window that could ask for the app's handlers.
  if (windowless(c.role)) return c.peer.send({ t: 'result', id: m.id, ok: false, error: `No handler registered for '${m.channel}'` });
  const fn = handlers.get(m.channel);
  if (!fn) return c.peer.send({ t: 'result', id: m.id, ok: false, error: `No handler registered for '${m.channel}'` });
  try {
    const value = await fn(senderFor(c, m.sender), ...m.args);
    c.peer.send({ t: 'result', id: m.id, ok: true, value });
  } catch (e) {
    c.peer.send({ t: 'result', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

function onPeer(peer: Peer) {
  let conn: Conn | null = null;
  // Say who you are within five seconds, or goodbye.
  const t = setTimeout(() => { if (!conn) peer.close(); }, 5000);
  peer.onMessage((m) => {
    if (!conn) {
      clearTimeout(t);
      if (!validHello(m) || !tokenMatches(m.token, token)) {
        peer.send({ t: 'denied', reason: 'not this Keeper' });
        peer.close();
        return;
      }
      // A second copy of a part (should not happen: each holds its own lock) replaces the first.
      conns.get(m.role)?.peer.close();
      conn = { role: m.role, pid: m.pid, peer, seq: 0, pending: new Map() };
      const c = conn;
      conns.set(m.role, c);
      peer.send({ t: 'welcome', settings: settingsNow(), channels: windowless(m.role) ? [] : [...handlers.keys()], sends: windowless(m.role) ? [] : sendChannels() });
      void peer.closedP.then(() => {
        if (conns.get(c.role) === c) conns.delete(c.role);
        for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(new Error('the part stopped')); }
        c.pending.clear();
        for (const fn of listeners.bye) fn(c.role, c.pid);
      });
      for (const fn of listeners.hello) fn(c.role, c.pid);
      return;
    }
    const c = conn;
    switch (m.t) {
      case 'call': void onCall(c, m); break;
      case 'note': {
        // A keeper:// link macOS handed to a part instead of the app (any copy of the bundle can get it).
        if (m.name === 'open-url') { if (typeof m.args[0] === 'string' && /^keeper:\/\//i.test(m.args[0])) openUrl?.(m.args[0]); break; }
        try { notes.get(c.role)?.(m.name, m.args); } catch (e) { console.error(`[suite] ${c.role} note ${m.name}`, e); }
        break;
      }
      case 'send': {
        if (windowless(c.role)) break;
        const ev = senderFor(c, m.sender);
        ipcMain.emit(m.channel, ev, ...m.args);
        break;
      }
      case 'result': {
        const p = c.pending.get(m.id);
        if (!p) break;
        c.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.error));
        break;
      }
      case 'ping': peer.send({ t: 'pong' }); break;
      default: break;
    }
  });
}

/** Starts listening for parts (once the app is ready). */
export async function startHub(getSettings: () => unknown): Promise<boolean> {
  settingsNow = getSettings;
  if (server) return true;
  const userData = app.getPath('userData');
  token = newToken();
  const socket = socketPath(userData, `app-${process.pid}`);
  try {
    server = await listen(socket, onPeer);
  } catch (e) {
    console.error('[suite] could not open the channel', (e as Error).message);
    return false;
  }
  writeCoreInfo(userData, { pid: process.pid, socket, token, version: app.getVersion(), cmd: relaunchCommand() });
  // An earlier Keeper's "stopped on purpose" (from the watchdog) no longer applies.
  try { rmSync(path.join(suiteDir(userData), 'app-stopped.json'), { force: true }); } catch { /* none */ }
  app.on('will-quit', () => {
    clearCoreInfo(userData);
    server?.close();
    if (process.platform !== 'win32') try { unlinkSync(socket); } catch { /* gone */ }
  });
  return true;
}

/** An event for every window of every part (the windows here get it from the caller). */
export function partBroadcast(channel: string, args: unknown[]) {
  for (const c of conns.values()) if (!windowless(c.role) || channel === 'event:settings-changed') c.peer.send({ t: 'event', channel, args });
}

/** Sends an event to one part's windows. */
export function partEvent(role: PartRole, channel: string, args: unknown[]) {
  conns.get(role)?.peer.send({ t: 'event', channel, args });
}

/** Asks a part to do something; rejects if the part is not connected or does not answer in time. */
export function partCommand<T = unknown>(role: PartRole, name: string, args: unknown[] = [], timeoutMs = 10_000): Promise<T> {
  const c = conns.get(role);
  if (!c) return Promise.reject(new Error(`the ${role} part is not running`));
  const id = ++c.seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { c.pending.delete(id); reject(new Error(`the ${role} part did not answer`)); }, timeoutMs);
    c.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    c.peer.send({ t: 'cmd', id, name, args });
  });
}

/** For tests and the Processes page: which channels the parts can call. */
export const hubChannels = () => [...handlers.keys()];
