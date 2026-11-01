// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's connections: cloud services, servers, home servers, NAS boxes and
// other computers. Remembers them (passwords and sign-in tokens in the
// system keychain, never in plain files), opens them when needed, keeps an
// eye on their health without waking the computer for it, and moves files
// to and from them.

import { app, powerMonitor, shell } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { cacheKey, evictionPlan, type CachedFile } from '../../../core/remote/cache';
import { joinRemote, localSafeName, normalizeRemote } from '../../../core/remote/paths';
import { formFor, needsSignIn, providerCatalog, type FormField, type ProviderInfo } from '../../../core/remote/providers';
import type { Connection, ConnectionInput, ConnState, ConnStatus, RemoteEntry, RemoteFs, Transfer } from '../../../core/remote/types';
import { getSecret, setSecret } from '../../store';
import { lowerPriority, onMemoryPressure, pace, poll, pollNow } from '../governor';
import { FtpFs } from './ftp';
import { findRclone, RcloneDaemon, RcloneFs, remoteNameFor } from './rclone';
import { HostKeyChanged, readKey, SftpFs, type HostKeys } from './sftp';
import { WebDavFs } from './webdav';

type Emit = (channel: string, ...args: unknown[]) => void;

let emit: Emit = () => undefined;
const dataDir = () => path.join(app.getPath('userData'), 'remote');
const cacheDir = () => path.join(app.getPath('userData'), 'remote-cache');
const offlineRoot = () => path.join(app.getPath('home'), 'Keeper Offline');
const CACHE_LIMIT = 2 * 1024 ** 3;

let connections: Connection[] = [];
const status = new Map<string, ConnStatus>();
const pool = new Map<string, Promise<RemoteFs>>();
/** Passwords kept only until Keeper quits, when the system has no keychain to keep them in. */
const sessionSecrets = new Map<string, string>();
const transfers = new Map<string, Transfer & { abort?: AbortController }>();
const watchers = new Map<string, FSWatcher>();
const openNow = new Set<string>();

// ---------------------------------------------------------------- storage

async function load() {
  try {
    connections = JSON.parse(await fsp.readFile(path.join(dataDir(), 'connections.json'), 'utf8'));
  } catch {
    connections = [];
  }
}

async function save() {
  await fsp.mkdir(dataDir(), { recursive: true });
  const file = path.join(dataDir(), 'connections.json');
  await fsp.writeFile(file + '.tmp', JSON.stringify(connections, null, 2), { mode: 0o600 });
  await fsp.rename(file + '.tmp', file);
  emit('remote-changed');
}

/** Stores a secret in the keychain; without one, keeps it for this session only. Returns false in that case. */
async function putSecret(name: string, value: string | undefined): Promise<boolean> {
  if (value === undefined) return true;
  if (await setSecret(name, value)) {
    sessionSecrets.delete(name);
    return true;
  }
  if (value) sessionSecrets.set(name, value);
  return false;
}

async function secret(name: string): Promise<string | undefined> {
  return sessionSecrets.get(name) ?? (await getSecret(name));
}

const hostKeysFile = () => path.join(dataDir(), 'known_hosts.json');
let hostKeyCache: Record<string, string> | null = null;
const hostKeys: HostKeys = {
  get: (h) => hostKeyCache?.[h],
  set: (h, fp) => {
    hostKeyCache = { ...(hostKeyCache ?? {}), [h]: fp };
    void fsp.mkdir(dataDir(), { recursive: true }).then(() => fsp.writeFile(hostKeysFile(), JSON.stringify(hostKeyCache, null, 2), { mode: 0o600 }));
  },
};

// ---------------------------------------------------------------- rclone

let daemon: RcloneDaemon | null = null;
let providersJson: unknown = null;

async function rclone(): Promise<RcloneDaemon> {
  if (daemon) return daemon;
  const binary = findRclone({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
  if (!binary) throw new Error('Cloud services need the rclone program, which is missing from this copy of Keeper. Reinstall Keeper, or install rclone and restart.');
  let pass = await secret('remote.rclone.configPass');
  if (!pass) {
    pass = randomBytes(24).toString('base64url');
    await putSecret('remote.rclone.configPass', pass);
  }
  daemon = new RcloneDaemon({ binary, config: path.join(dataDir(), 'rclone.conf'), cacheDir: path.join(dataDir(), 'rclone-cache'), configPass: pass, onSpawn: (c) => lowerPriority(c) });
  return daemon;
}

export function rcloneAvailable(): boolean {
  return !!findRclone({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
}

/** Every provider rclone knows, for "Add a connection". */
export async function providers(): Promise<ProviderInfo[]> {
  if (!providersJson) providersJson = await (await (await rclone()).rc()).call('config/providers');
  return providerCatalog(providersJson);
}

export async function providerForm(prefix: string, sub?: string): Promise<FormField[]> {
  if (!providersJson) await providers();
  return formFor(providersJson, prefix, sub);
}

// ---------------------------------------------------------------- status

function setStatus(id: string, patch: Partial<ConnStatus>) {
  const s = { ...(status.get(id) ?? { id, state: 'idle' as ConnState }), ...patch, id };
  status.set(id, s);
  emit('remote-status', s);
}

function explain(e: unknown): { state: ConnState; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof HostKeyChanged) return { state: 'error', message: msg };
  if (needsSignIn(msg) || /All configured authentication methods failed|530 |Login incorrect|did not accept the user name or password/i.test(msg)) {
    return { state: 'needs-sign-in', message: 'Sign in again to keep using this connection.' };
  }
  if (/ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|did not answer|Timed out|getaddrinfo/i.test(msg)) {
    return { state: 'offline', message: 'Can’t reach it right now. Keeper tries again when the network changes.' };
  }
  return { state: 'error', message: msg.split('\n')[0] };
}

// ---------------------------------------------------------------- opening

function find(id: string): Connection {
  const c = connections.find((x) => x.id === id);
  if (!c) throw new Error('That connection no longer exists');
  return c;
}

async function openFs(c: Connection): Promise<RemoteFs> {
  const password = await secret(`remote.${c.id}.password`);
  switch (c.kind) {
    case 'sftp': {
      const privateKey = c.keyFile ? await readKey(c.keyFile) : undefined;
      return SftpFs.open(c, { password, privateKey, passphrase: await secret(`remote.${c.id}.passphrase`) }, hostKeys);
    }
    case 'ftp':
      return FtpFs.open(c, password);
    case 'webdav':
      return WebDavFs.open(c, password);
    case 'rclone':
      return new RcloneFs(await rclone(), c, remoteNameFor(c.id));
    case 'smb':
      throw new Error('Shared folders are opened by the system; use Browse.');
  }
}

/** The open file system for a connection, opening it (once) when needed. */
async function fsFor(id: string): Promise<RemoteFs> {
  let p = pool.get(id);
  if (!p) {
    const c = find(id);
    setStatus(id, { state: 'connecting', message: undefined });
    p = openFs(c);
    pool.set(id, p);
    p.then(() => setStatus(id, { state: 'connected', message: undefined, checkedAt: Date.now() }), (e) => {
      pool.delete(id);
      setStatus(id, { ...explain(e), checkedAt: Date.now() });
    });
  }
  return p;
}

/** Runs an operation; a dropped connection is opened again once. */
async function withFs<T>(id: string, fn: (fs: RemoteFs) => Promise<T>): Promise<T> {
  try {
    return await fn(await fsFor(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not connected|No SFTP|closed|ECONNRESET|socket hang up|EPIPE|Client network socket disconnected/i.test(msg)) {
      await drop(id);
      return fn(await fsFor(id));
    }
    const ex = explain(e);
    if (ex.state !== 'error') setStatus(id, ex);
    throw e;
  }
}

async function drop(id: string) {
  const p = pool.get(id);
  pool.delete(id);
  try {
    await (await p)?.close();
  } catch {
    /* already closed */
  }
}

// ---------------------------------------------------------------- managing connections

export function list(): { connections: Connection[]; status: ConnStatus[] } {
  return { connections, status: connections.map((c) => status.get(c.id) ?? { id: c.id, state: 'idle' }) };
}

/** Adds or changes a connection. Secrets go to the keychain; the result says whether they could be kept. */
export async function save_(input: ConnectionInput): Promise<{ connection: Connection; remembered: boolean }> {
  const id = input.id ?? randomUUID().slice(0, 8);
  const existing = connections.find((c) => c.id === id);
  const { password, passphrase, secrets, ...rest } = input;
  const conn: Connection = { ...existing, ...rest, id, name: rest.name.trim() || rest.host || 'Connection', createdAt: existing?.createdAt ?? Date.now() };
  let remembered = await putSecret(`remote.${id}.password`, password);
  remembered = (await putSecret(`remote.${id}.passphrase`, passphrase)) && remembered;
  if (conn.kind === 'rclone') {
    if (!conn.provider) throw new Error('Choose a service');
    const rc = await (await rclone()).rc();
    const token = await secret(`remote.${id}.token`);
    const parameters: Record<string, string> = { ...(conn.options ?? {}), ...(secrets ?? {}), ...(token ? { token } : {}) };
    // rclone keeps its own (encrypted) copy of the settings it needs; obscure hides passwords inside it.
    await rc.call(existing ? 'config/update' : 'config/create', { name: remoteNameFor(id), type: conn.provider, parameters, opt: { obscure: true, nonInteractive: true } });
  }
  connections = existing ? connections.map((c) => (c.id === id ? conn : c)) : [...connections, conn];
  await drop(id);
  await save();
  setStatus(id, { state: 'idle', message: remembered ? undefined : 'The password is kept until Keeper quits: this computer has no keychain for it.' });
  return { connection: conn, remembered };
}

/** Signs in through the browser for a cloud service (rclone opens the page) and keeps the token. */
let authAbort: AbortController | null = null;
export async function signIn(provider: string, id?: string, client?: { id?: string; secret?: string }): Promise<{ token: string; id: string }> {
  authAbort?.abort();
  authAbort = new AbortController();
  const token = await (await rclone()).authorize(provider, client?.id, client?.secret, authAbort.signal);
  const key = id ?? randomUUID().slice(0, 8);
  await putSecret(`remote.${key}.token`, token);
  if (id && connections.some((c) => c.id === id)) {
    await (await (await rclone()).rc()).call('config/update', { name: remoteNameFor(id), parameters: { token }, opt: { nonInteractive: true } });
    await drop(id);
    void check(id);
  }
  return { token: 'ok', id: key };
}

export function cancelSignIn() {
  authAbort?.abort();
}

export async function remove(id: string): Promise<void> {
  const c = connections.find((x) => x.id === id);
  if (!c) return;
  await drop(id);
  if (c.kind === 'rclone' && daemon) {
    try {
      await (await daemon.rc()).call('config/delete', { name: remoteNameFor(id) });
    } catch {
      /* not there */
    }
  }
  for (const k of ['password', 'passphrase', 'token']) await putSecret(`remote.${id}.${k}`, '');
  connections = connections.filter((x) => x.id !== id);
  status.delete(id);
  await save();
}

/** Tries a connection without saving it: for the "Test" button. */
export async function test(input: ConnectionInput): Promise<{ ok: boolean; message?: string; entries?: number }> {
  const conn: Connection = { ...input, id: input.id ?? `test-${randomUUID().slice(0, 6)}`, name: input.name || 'Test', createdAt: Date.now() };
  let fs: RemoteFs | null = null;
  try {
    if (conn.kind === 'sftp') fs = await SftpFs.open(conn, { password: input.password, privateKey: conn.keyFile ? await readKey(conn.keyFile) : undefined, passphrase: input.passphrase }, hostKeys);
    else if (conn.kind === 'ftp') fs = await FtpFs.open(conn, input.password);
    else if (conn.kind === 'webdav') fs = await WebDavFs.open(conn, input.password);
    else return { ok: true };
    const n = (await fs.list('/')).length;
    return { ok: true, entries: n };
  } catch (e) {
    return { ok: false, message: explain(e).message };
  } finally {
    await fs?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- files

const offlineDir = (c: Connection, p: string) => path.join(offlineRoot(), localSafeName(c.name), ...normalizeRemote(p).split('/').filter(Boolean).map(localSafeName));

export async function listDir(id: string, dir: string): Promise<RemoteEntry[]> {
  const c = find(id);
  const d = normalizeRemote(dir);
  const entries = await withFs(id, (fs) => fs.list(d));
  const offline = c.offline ?? [];
  setStatus(id, { state: 'connected', message: undefined, checkedAt: Date.now() });
  return entries.map((e) => ({ ...e, offline: offline.some((o) => e.path === o || e.path.startsWith(o === '/' ? '/' : o + '/')) || undefined }));
}

export function stat(id: string, p: string) {
  return withFs(id, (fs) => fs.stat(p));
}

export function mkdir(id: string, dir: string, name: string) {
  return withFs(id, (fs) => fs.mkdir(joinRemote(dir, name)));
}

export function rename(id: string, p: string, name: string) {
  const parent = normalizeRemote(p).slice(0, normalizeRemote(p).lastIndexOf('/')) || '/';
  return withFs(id, (fs) => fs.rename(p, joinRemote(parent, name)));
}

export async function removeEntries(id: string, items: { path: string; isDir: boolean }[]): Promise<{ removed: number; failed: string[] }> {
  let removed = 0;
  const failed: string[] = [];
  for (const it of items) {
    try {
      await withFs(id, (fs) => fs.remove(it.path, it.isDir));
      removed++;
    } catch (e) {
      failed.push(`${it.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { removed, failed };
}

export async function quota(id: string) {
  const q = await withFs(id, async (fs) => fs.quota?.());
  if (q) setStatus(id, { quota: q });
  return q;
}

/** Downloads a file into the cache (or uses the offline copy) and returns where it is on this computer. */
async function fetchToCache(id: string, e: RemoteEntry, onProgress?: (n: number) => void, signal?: AbortSignal): Promise<string> {
  const c = find(id);
  const off = offlineDir(c, e.path);
  if (c.offline?.some((o) => e.path === o || e.path.startsWith(o + '/'))) {
    try {
      const st = await fsp.stat(off);
      if (st.size === e.size) return off;
    } catch {
      /* not synced yet */
    }
  }
  const dir = path.join(cacheDir(), id, cacheKey(id, e.path, e.size, e.mtime));
  const file = path.join(dir, localSafeName(e.name));
  try {
    const st = await fsp.stat(file);
    if (st.size === e.size) {
      const now = new Date();
      void fsp.utimes(file, now, now).catch(() => undefined);
      return file;
    }
  } catch {
    /* not cached */
  }
  await fsp.mkdir(dir, { recursive: true });
  const fs = await fsFor(id);
  const tmp = file + '.part';
  if (fs instanceof RcloneFs) {
    await fs.copyToLocal(e.path, tmp, (n) => onProgress?.(n));
  } else {
    const src = await withFs(id, (f) => f.read(e.path, { signal }));
    let n = 0;
    (src as NodeJS.ReadableStream).on('data', (b: Buffer) => onProgress?.((n += b.length)));
    await pipeline(src, createWriteStream(tmp), { signal });
  }
  await fsp.rename(tmp, file);
  void trimCache();
  return file;
}

let trimming = false;
async function trimCache() {
  if (trimming) return;
  trimming = true;
  try {
    const files: CachedFile[] = [];
    const walk = async (d: string) => {
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          const st = await fsp.stat(p).catch(() => null);
          if (st) files.push({ path: p, size: st.size, used: st.mtimeMs });
        }
      }
    };
    await walk(cacheDir());
    for (const p of evictionPlan(files, CACHE_LIMIT, (f) => openNow.has(f) || f.endsWith('.part'))) await fsp.rm(p, { force: true });
  } finally {
    trimming = false;
  }
}

/** A thumbnail for a remote picture or video: fetched only when it is on screen. */
export async function thumbnail(id: string, e: RemoteEntry, size: number, render: (p: string, size: number) => Promise<string | null>): Promise<string | null> {
  // Big originals are not downloaded just for a thumbnail.
  if (e.size > 40 * 1024 * 1024) return null;
  try {
    return await render(await fetchToCache(id, e), size);
  } catch {
    return null;
  }
}

/**
 * Opens a file with its usual app. Saving it there sends the change back to
 * the server; if the file changed on the server meanwhile, the edit is kept
 * as a separate copy instead of overwriting.
 */
export async function open(id: string, e: RemoteEntry): Promise<string> {
  const local = await fetchToCache(id, e);
  const err = await shell.openPath(local);
  if (err) throw new Error(err);
  watchBack(id, e, local);
  return local;
}

/** Downloads a file for previewing; returns the local path. */
export function preview(id: string, e: RemoteEntry): Promise<string> {
  return fetchToCache(id, e);
}

function watchBack(id: string, e: RemoteEntry, local: string) {
  if (watchers.has(local)) return;
  openNow.add(local);
  let base = { size: e.size, mtime: e.mtime };
  let timer: NodeJS.Timeout | undefined;
  let lastLocal = 0;
  try {
    const w = watch(local, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const st = await fsp.stat(local).catch(() => null);
        if (!st || st.mtimeMs === lastLocal) return;
        lastLocal = st.mtimeMs;
        try {
          const now = await stat(id, e.path);
          const changedThere = now && (now.size !== base.size || Math.abs(now.mtime - base.mtime) > 2000);
          const target = changedThere ? conflictName(e.path) : e.path;
          await uploadFile(id, local, target, `Saving ${e.name}`);
          const after = await stat(id, target);
          if (!changedThere && after) base = { size: after.size, mtime: after.mtime };
          emit('remote-saved', { id, path: target, conflict: !!changedThere });
        } catch (err) {
          emit('remote-saved', { id, path: e.path, error: err instanceof Error ? err.message : String(err) });
        }
      }, 1500);
    });
    watchers.set(local, w);
    // Stop watching after a working day.
    setTimeout(() => {
      w.close();
      watchers.delete(local);
      openNow.delete(local);
    }, 8 * 3600_000).unref?.();
  } catch {
    /* the file system cannot be watched here: edits stay local */
  }
}

function conflictName(p: string): string {
  const n = normalizeRemote(p);
  const dir = n.slice(0, n.lastIndexOf('/')) || '/';
  const base = n.slice(n.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  const name = dot > 0 ? `${base.slice(0, dot)} (edited ${stamp})${base.slice(dot)}` : `${base} (edited ${stamp})`;
  return joinRemote(dir, name);
}

// ---------------------------------------------------------------- transfers

function startTransfer(label: string, direction: Transfer['direction'], total: number) {
  const t: Transfer & { abort?: AbortController } = { id: randomUUID().slice(0, 8), label, direction, bytes: 0, total, state: 'running', abort: new AbortController() };
  transfers.set(t.id, t);
  let last = 0;
  const update = (patch: Partial<Transfer>) => {
    Object.assign(t, patch);
    const now = Date.now();
    if (t.state !== 'running' || now - last > 250) {
      last = now;
      const { abort: _a, ...pub } = t;
      emit('remote-transfer', pub);
    }
    if (t.state !== 'running') setTimeout(() => transfers.delete(t.id), 60_000).unref?.();
  };
  update({});
  return { t, update };
}

export function listTransfers(): Transfer[] {
  return [...transfers.values()].map(({ abort: _a, ...t }) => t);
}

export function cancelTransfer(tid: string) {
  const t = transfers.get(tid);
  t?.abort?.abort();
}

async function uploadFile(id: string, local: string, target: string, label?: string): Promise<void> {
  const st = await fsp.stat(local);
  const { t, update } = startTransfer(label ?? `Uploading ${path.basename(local)}`, 'up', st.size);
  try {
    const fs = await fsFor(id);
    if (fs instanceof RcloneFs) {
      await fs.copyFromLocal(local, target, (n) => update({ bytes: n }));
    } else {
      const src = createReadStream(local);
      let n = 0;
      src.on('data', (b) => update({ bytes: (n += (b as Buffer).length) }));
      t.abort?.signal.addEventListener('abort', () => src.destroy(new Error('Cancelled')));
      await withFs(id, (f) => f.write(target, src, st.size));
    }
    update({ state: 'done', bytes: st.size });
  } catch (e) {
    update({ state: t.abort?.signal.aborted ? 'cancelled' : 'failed', message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Uploads files and folders from this computer into a folder on the connection. */
export async function upload(id: string, dir: string, locals: string[]): Promise<{ done: number; failed: string[] }> {
  let done = 0;
  const failed: string[] = [];
  const put = async (local: string, target: string) => {
    const st = await fsp.stat(local);
    if (st.isDirectory()) {
      await withFs(id, (fs) => fs.mkdir(target)).catch(() => undefined);
      for (const name of await fsp.readdir(local)) await put(path.join(local, name), joinRemote(target, name));
    } else {
      await uploadFile(id, local, target);
      done++;
    }
  };
  for (const l of locals) {
    try {
      await put(l, joinRemote(dir, path.basename(l)));
    } catch (e) {
      failed.push(`${path.basename(l)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  emit('remote-changed');
  return { done, failed };
}

/** Downloads entries into a folder on this computer (Downloads when none is given). */
export async function download(id: string, entries: RemoteEntry[], to?: string): Promise<{ done: number; failed: string[]; folder: string }> {
  // Without XDG user folders Electron names the home folder itself; ~/Downloads is what people expect then.
  const dl = app.getPath('downloads');
  const fallback = path.join(app.getPath('home'), 'Downloads');
  const folder = to ?? (dl === app.getPath('home') && existsSync(fallback) ? fallback : dl);
  let done = 0;
  const failed: string[] = [];
  const get = async (e: RemoteEntry, into: string) => {
    if (e.isDir) {
      const d = path.join(into, localSafeName(e.name));
      await fsp.mkdir(d, { recursive: true });
      for (const child of await listDir(id, e.path)) await get(child, d);
      return;
    }
    const { t, update } = startTransfer(`Downloading ${e.name}`, 'down', e.size);
    try {
      const cached = await fetchToCache(id, e, (n) => update({ bytes: n }), t.abort?.signal);
      let target = path.join(into, localSafeName(e.name));
      for (let i = 2; existsSync(target); i++) {
        const ext = path.extname(e.name);
        target = path.join(into, `${localSafeName(path.basename(e.name, ext))} ${i}${ext}`);
      }
      await fsp.copyFile(cached, target);
      update({ state: 'done', bytes: e.size });
      done++;
    } catch (err) {
      update({ state: t.abort?.signal.aborted ? 'cancelled' : 'failed', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
  for (const e of entries) {
    try {
      await get(e, folder);
    } catch (err) {
      failed.push(`${e.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { done, failed, folder };
}

// ---------------------------------------------------------------- offline folders

/** Keeps a folder on this computer too (in "Keeper Offline" in the home folder), refreshed when the computer is idle. */
export async function setOffline(id: string, p: string, on: boolean): Promise<string | null> {
  const c = find(id);
  const n = normalizeRemote(p);
  c.offline = on ? [...new Set([...(c.offline ?? []), n])] : (c.offline ?? []).filter((x) => x !== n);
  await save();
  if (!on) return null;
  const local = offlineDir(c, n);
  void syncOffline(id, n).catch(() => undefined);
  return local;
}

async function syncOffline(id: string, p: string) {
  const c = find(id);
  const local = offlineDir(c, p);
  await fsp.mkdir(local, { recursive: true });
  const fs = await fsFor(id);
  if (fs instanceof RcloneFs) {
    const { update } = startTransfer(`Keeping “${path.basename(local)}” offline`, 'down', 0);
    try {
      await fs.copyFolderToLocal(p, local, (b, total) => update({ bytes: b, total }));
      update({ state: 'done' });
    } catch (e) {
      update({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  // Built-in connections: fetch what is new or a different size, gently.
  const walk = async (dir: string, into: string) => {
    for (const e of await listDir(id, dir)) {
      await pace('sources');
      const target = path.join(into, localSafeName(e.name));
      if (e.isDir) {
        await fsp.mkdir(target, { recursive: true });
        await walk(e.path, target);
        continue;
      }
      const st = await fsp.stat(target).catch(() => null);
      if (st && st.size === e.size) continue;
      const cached = await fetchToCache(id, e);
      await fsp.copyFile(cached, target);
    }
  };
  await walk(p, local);
}

// ---------------------------------------------------------------- library search

interface CatalogItem { p: string; n: string; s: number; m: number; d: boolean }
const catalogs = new Map<string, CatalogItem[]>();

/** Names, sizes and dates of a connection's files, for library search (only when the person asked for it). */
async function buildCatalog(id: string) {
  const items: CatalogItem[] = [];
  const queue = ['/'];
  while (queue.length && items.length < 100_000) {
    const dir = queue.shift()!;
    await pace('sources');
    let entries: RemoteEntry[];
    try {
      entries = await withFs(id, (fs) => fs.list(dir));
    } catch {
      continue;
    }
    for (const e of entries) {
      items.push({ p: e.path, n: e.name, s: e.size, m: e.mtime, d: e.isDir });
      if (e.isDir && !e.name.startsWith('.')) queue.push(e.path);
    }
  }
  catalogs.set(id, items);
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.writeFile(path.join(dataDir(), `catalog-${id}.json`), JSON.stringify(items));
}

export async function search(q: string, limit = 50): Promise<{ id: string; name: string; entry: RemoteEntry }[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: { id: string; name: string; entry: RemoteEntry }[] = [];
  for (const c of connections.filter((x) => x.includeInLibrary)) {
    let items = catalogs.get(c.id);
    if (!items) {
      try {
        items = JSON.parse(await fsp.readFile(path.join(dataDir(), `catalog-${c.id}.json`), 'utf8')) as CatalogItem[];
        catalogs.set(c.id, items);
      } catch {
        continue;
      }
    }
    for (const it of items) {
      const n = it.n.toLowerCase();
      if (words.every((w) => n.includes(w))) out.push({ id: c.id, name: c.name, entry: { name: it.n, path: it.p, size: it.s, mtime: it.m, isDir: it.d } });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------- health

/** A light check: can Keeper still reach it, and is the sign-in still good? */
export async function check(id: string): Promise<ConnStatus> {
  const c = find(id);
  if (c.kind === 'smb') return status.get(id) ?? { id, state: 'idle' };
  try {
    await withFs(id, (fs) => fs.list('/'));
    const q = await withFs(id, async (fs) => fs.quota?.()).catch(() => undefined);
    setStatus(id, { state: 'connected', message: undefined, quota: q ?? status.get(id)?.quota, checkedAt: Date.now() });
  } catch (e) {
    setStatus(id, { ...explain(e), checkedAt: Date.now() });
  }
  return status.get(id)!;
}

async function healthRound() {
  for (const c of connections) {
    // Only connections in use (opened this session, kept offline or searched) are checked; others stay asleep.
    const used = pool.has(c.id) || c.offline?.length || c.includeInLibrary;
    if (!used || c.kind === 'smb') continue;
    await check(c.id);
    for (const p of c.offline ?? []) await syncOffline(c.id, p).catch(() => undefined);
    if (c.includeInLibrary) await buildCatalog(c.id).catch(() => undefined);
  }
}

export async function initRemote(broadcast: Emit) {
  emit = broadcast;
  await load();
  try {
    hostKeyCache = JSON.parse(await fsp.readFile(hostKeysFile(), 'utf8'));
  } catch {
    hostKeyCache = {};
  }
  poll('remote-health', { baseMs: 15 * 60_000, pauseWhenLocked: true, idleFactor: 2, maxMs: 60 * 60_000 }, healthRound, { now: false, feature: 'remote' });
  // After sleep the old connections are dead: open them fresh on next use and look again.
  powerMonitor.on('resume', () => {
    for (const id of [...pool.keys()]) void drop(id);
    pollNow('remote-health');
  });
  onMemoryPressure(() => catalogs.clear());
}

export async function stopRemote() {
  for (const w of watchers.values()) w.close();
  watchers.clear();
  for (const id of [...pool.keys()]) await drop(id);
  await daemon?.stop();
}

/** For connections that the system mounts (SMB): remember where it ended up. */
export async function setMountPath(id: string, mountPath: string | undefined) {
  const c = find(id);
  c.mountPath = mountPath;
  await save();
}

export { save_ as saveConnection };
/** A connection's files, for sync and backups (electron/services/sync/remote-adapter.ts). */
export { fsFor as connectionFs };
