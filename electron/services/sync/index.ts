// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sync between your Keeper devices, backups and mirrors, run in the background.
// The device network (Keeper Link), cloud connections and the background-work
// rules are handed in by main.ts, so this works with whatever is available.

import { randomBytes } from 'node:crypto';
import { watch, promises as fsp, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BackupJobStatus, ConflictInfo, MirrorJobStatus, StoreChoice, SyncApi, SyncFolderStatus, SyncOverview } from '../../../core/api-sync';
import { BackupError, BackupRepo, DEFAULT_RETENTION, type BackupProgress } from '../../../core/sync/backup';
import { phoneAlert } from '../phone-alerts';
import { check321, defaultSyncSettings, normalizeSyncSettings, type BackupJobSetting, type MirrorJobSetting, type StoreTarget, type SyncFolderSetting, type SyncSettings } from '../../../core/sync/config';
import { FolderSync, type SyncProgress } from '../../../core/sync/engine';
import { emptyState, isConflictName, type FolderState } from '../../../core/sync/folder';
import { mirror, type MirrorState } from '../../../core/sync/mirror';
import { SyncNode } from '../../../core/sync/node';
import { FolderStore, type PeerTransport, type RemoteStore } from '../../../core/sync/ports';
import { archive, cleanVersions, DEFAULT_POLICY, listVersions, restoreVersion } from '../../../core/sync/versions';
import { getSecret, setSecret, settings, updateSettings } from '../../store';
import { featureOn, onFeature } from '../features';
import { startJob } from '../governor';

export interface SyncServiceDeps {
  userData: string;
  broadcast(channel: string, ...args: unknown[]): void;
  /** Keeper Link (or the test loopback); null when no device network is available */
  transport(): { transport: PeerTransport | null; kind: SyncOverview['transport']; message?: string };
  /** a cloud or server connection as a store */
  openConnection?(id: string): Promise<RemoteStore>;
  /** connections the person has set up, for choosing a destination */
  connections?(): StoreChoice[];
  /** background-work rules: wait until work may run, and a gentle pause between items */
  whenIdle?(kind: 'scan' | 'hash'): Promise<void>;
  pace?(kind: 'scan' | 'hash'): Promise<void>;
  /** a regular check that slows down when nobody is around; returns a stop function */
  poll?(name: string, everyMs: number, fn: () => unknown): () => void;
  onBattery?(): boolean;
  idleSeconds?(): number;
}

const DAY = 24 * 3600_000;
const TEST_EVERY = 90 * DAY;

let deps: SyncServiceDeps;
let node: SyncNode | null = null;
let transportKind: SyncOverview['transport'] = 'none';
let transportMessage: string | undefined;
let deviceId = '';
const folders = new Map<string, FolderSync>();
const folderInfo = new Map<string, Pick<SyncFolderStatus, 'state' | 'message' | 'lastScan' | 'progress'> & { peers: Map<string, { lastSync?: number; state: 'idle' | 'syncing' | 'error'; message?: string }> }>();
const watchers = new Map<string, FSWatcher>();
const backupState = new Map<string, Pick<BackupJobStatus, 'state' | 'progress' | 'snapshots' | 'storedBytes'>>();
const backupRuns = new Map<string, AbortController>();
const repos = new Map<string, BackupRepo>();
const mirrorState = new Map<string, Pick<MirrorJobStatus, 'state' | 'progress'>>();
const mirrorRuns = new Map<string, AbortController>();
/** Settings → Features → Sync and backup: when off, nothing scans, uploads or prunes. */
const syncOn = () => featureOn('sync');
const stops: (() => void)[] = [];
let syncing = false;
let offers: SyncOverview['offers'] = [];
const ignoredOffers = new Set<string>();
let syncAgain = false;
let debounce: NodeJS.Timeout | undefined;

const conf = (): SyncSettings => {
  const c = normalizeSyncSettings(settings().sync, defaultSyncSettings(os.hostname()));
  // Until the person names it, this device goes by the computer's own name.
  return c.deviceName === defaultSyncSettings().deviceName ? { ...c, deviceName: os.hostname() } : c;
};
async function save(patch: Partial<SyncSettings>) {
  await updateSettings({ sync: { ...conf(), ...patch } });
  changed();
}
function changed() {
  deps.broadcast('sync-changed');
}
const stateFile = (id: string) => path.join(deps.userData, 'sync', 'folders', `${id}.json`);
const mirrorFile = (id: string) => path.join(deps.userData, 'sync', 'mirrors', `${id}.json`);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(file: string, v: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v));
  await fsp.rename(tmp, file);
}

// ---------------------------------------------------------------- bandwidth

let bucket = { tokens: 0, at: Date.now() };
async function throttle(bytes: number) {
  const limit = conf().bandwidthKBps * 1024;
  if (!limit) return;
  const now = Date.now();
  bucket.tokens = Math.min(limit, bucket.tokens + ((now - bucket.at) / 1000) * limit);
  bucket.at = now;
  bucket.tokens -= bytes;
  if (bucket.tokens < 0) await new Promise((r) => setTimeout(r, (-bucket.tokens / limit) * 1000));
}

// ---------------------------------------------------------------- folders

function peerName(id: string) {
  if (id === deviceId) return conf().deviceName;
  return node?.transport.listPeers().find((p) => p.id === id)?.name ?? id.slice(0, 8);
}

async function loadFolder(f: SyncFolderSetting) {
  const state = await readJson<FolderState>(stateFile(f.id), emptyState(f.id, deviceId));
  state.device = deviceId;
  let saveTimer: NodeJS.Timeout | undefined;
  const fs = new FolderSync({ id: f.id, root: f.path, label: f.label, mode: f.mode, devices: f.devices, ignore: f.ignore, versioning: f.versioning ?? DEFAULT_POLICY, paused: f.paused || conf().paused }, state, {
    deviceName: peerName,
    save: async (s) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void writeJson(stateFile(f.id), s), 1500);
    },
    throttle,
    onProgress: (p: SyncProgress) => {
      const info = folderInfo.get(f.id);
      if (info) info.progress = { file: p.file ?? '', done: p.done, total: p.total, queued: p.queued };
      deps.broadcast('progress', { task: 'sync', phase: `${f.label}: ${p.file ?? ''}`, done: p.done, total: p.total || 1, current: p.file });
    },
    onConflict: () => changed(),
  });
  folders.set(f.id, fs);
  folderInfo.set(f.id, { state: 'idle', peers: new Map() });
  node?.add(fs);
  // Changes on disk arrive at once; a slow regular look catches anything the system missed.
  try {
    const w = watch(f.path, { recursive: true }, (_e, name) => {
      const n = String(name ?? '');
      if (n.includes('.keeper-versions') || n.includes('.keeper-sync') || n.endsWith('.keeper-part') || n.endsWith('.keeper-part.json')) return;
      soon();
    });
    w.on('error', () => undefined);
    watchers.set(f.id, w);
  } catch {
    /* watching is not available here; the regular look still runs */
  }
}

function unloadFolder(id: string) {
  watchers.get(id)?.close();
  watchers.delete(id);
  folders.delete(id);
  folderInfo.delete(id);
  node?.remove(id);
}

async function reloadFolders() {
  for (const id of [...folders.keys()]) unloadFolder(id);
  if (!syncOn()) return;
  for (const f of conf().folders) await loadFolder(f);
}

function soon(ms = 2500) {
  clearTimeout(debounce);
  debounce = setTimeout(() => void runSync(), ms);
}

/** Scan every folder, then a round with every online device. */
async function runSync() {
  if (syncing) {
    syncAgain = true;
    return;
  }
  const c = conf();
  if (!syncOn() || c.paused || (c.pauseOnBattery && deps.onBattery?.())) return;
  syncing = true;
  try {
    await deps.whenIdle?.('scan');
    for (const [id, f] of folders) {
      if (f.cfg.paused) continue;
      const info = folderInfo.get(id)!;
      info.state = 'scanning';
      try {
        await f.scan();
        info.lastScan = Date.now();
        info.state = 'idle';
        info.message = undefined;
      } catch (e) {
        info.state = 'error';
        info.message = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'The folder is not there (a drive unplugged?)' : e instanceof Error ? e.message : String(e);
      }
    }
    if (node) {
      for (const [, info] of folderInfo) if (info.state === 'idle') info.state = 'syncing';
      changed();
      const rounds = await node.syncAll();
      for (const r of rounds as (typeof rounds[number] & { folder?: string })[]) {
        const info = r.folder ? folderInfo.get(r.folder) : undefined;
        if (!info) continue;
        const bad = r.skipped.filter((s) => !s.why.startsWith('later:'));
        info.peers.set(r.peer, { lastSync: Date.now(), state: bad.length ? 'error' : 'idle', message: bad[0]?.why });
      }
      for (const [, info] of folderInfo) if (info.state === 'syncing') info.state = 'idle';
      offers = (await node.offers()).filter((o) => !ignoredOffers.has(o.id));
      for (const [, info] of folderInfo) info.progress = undefined;
      deps.broadcast('progress', { task: 'sync', phase: 'Up to date', done: 1, total: 1 });
    }
  } finally {
    syncing = false;
    changed();
    if (syncAgain) {
      syncAgain = false;
      soon(1000);
    }
  }
}

// ---------------------------------------------------------------- stores

async function storeFor(t: StoreTarget): Promise<RemoteStore> {
  if (t.kind === 'folder') {
    await fsp.mkdir(t.path, { recursive: true });
    return new FolderStore(t.path);
  }
  if (!deps.openConnection) throw new Error('Cloud and server connections are not available in this version yet.');
  const base = await deps.openConnection(t.connectionId);
  return subStore(base, t.path);
}

/** A store limited to one folder inside another store. */
function subStore(s: RemoteStore, dir: string): RemoteStore {
  const d = dir.replace(/^\/+|\/+$/g, '');
  if (!d) return s;
  const j = (p: string) => (p.replace(/^\/+/, '') ? `${d}/${p.replace(/^\/+/, '')}` : d);
  const strip = <T extends { path: string }>(e: T): T => ({ ...e, path: e.path.slice(d.length + 1) });
  return {
    label: `${s.label}/${d}`,
    list: async (p) => (await s.list(j(p))).map(strip),
    stat: async (p) => {
      const e = await s.stat(j(p));
      return e ? { ...e, path: p } : null;
    },
    get: (p, r) => s.get(j(p), r),
    put: (p, b) => s.put(j(p), b),
    delete: (p) => s.delete(j(p)),
    rename: (a, b) => s.rename(j(a), j(b)),
    mkdir: (p) => s.mkdir(j(p)),
    quota: s.quota ? () => s.quota!() : undefined,
    putFile: s.putFile ? (p, f) => s.putFile!(j(p), f) : undefined,
    getFile: s.getFile ? (p, f) => s.getFile!(j(p), f) : undefined,
  };
}

function destLabel(t: StoreTarget): string {
  if (t.kind === 'folder') return t.path;
  const c = deps.connections?.().find((x) => x.id === t.connectionId);
  return `${c?.label ?? t.label ?? 'Connection'}${t.path && t.path !== '/' ? ` › ${t.path.replace(/^\/+/, '')}` : ''}`;
}

/** For the 3-2-1 check. */
function kindOf(t: StoreTarget): 'drive' | 'cloud' | 'device' | 'local' {
  if (t.kind === 'connection') return 'cloud';
  const p = t.path.toLowerCase();
  if (/clouddocs|icloud|dropbox|onedrive|google ?drive|googledrive|nextcloud|cloudstorage|proton ?drive|box sync/.test(p)) return 'cloud';
  if (/^\/(volumes|media|mnt|run\/media)\//.test(p) || (/^[a-z]:\\/.test(p) && !p.startsWith(os.homedir().slice(0, 2).toLowerCase()))) return 'drive';
  return 'local';
}

// ---------------------------------------------------------------- backups

async function repoFor(job: BackupJobSetting, password?: string): Promise<BackupRepo> {
  const cached = repos.get(job.id);
  if (cached && !password) return cached;
  const pw = password ?? (await getSecret(`backup:${job.id}`));
  if (!pw) throw new BackupError('wrong-key', 'Enter this backup’s password to continue.');
  const repo = await BackupRepo.open(await storeFor(job.dest), isRecovery(pw) ? { recovery: pw } : { password: pw });
  repos.set(job.id, repo);
  return repo;
}

const isRecovery = (s: string) => /^[0-9A-Za-z]{4}(-?[0-9A-Za-z]{4}){7}$/.test(s.trim());

function jobPatch(id: string, patch: Partial<BackupJobSetting>) {
  return save({ backups: conf().backups.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
}

async function runBackupJob(id: string, password?: string) {
  const job = conf().backups.find((b) => b.id === id);
  if (!job || backupRuns.has(id) || !syncOn()) return;
  const ac = new AbortController();
  backupRuns.set(id, ac);
  const work = startJob(`Backup: ${job.name}`, { id: `backup-${id}` });
  backupState.set(id, { ...backupState.get(id), state: 'running', progress: { phase: 'Starting', files: 0, bytes: 0 } });
  changed();
  const report = (p: BackupProgress) => {
    backupState.set(id, { ...backupState.get(id), state: 'running', progress: { phase: p.phase, file: p.file, files: p.files, bytes: p.bytes, totalBytes: p.totalBytes } });
    deps.broadcast('progress', { task: 'backup', phase: `${job.name}: ${p.files.toLocaleString()} files`, done: p.bytes, total: p.totalBytes ?? Math.max(p.bytes, 1) * 2, current: p.file });
  };
  try {
    await deps.whenIdle?.('hash');
    const repo = await repoFor(job, password);
    const sources = Object.fromEntries(job.sources.map((s) => [s.name, s.path]));
    const snap = await repo.backup(sources, { ignore: job.ignore, signal: ac.signal, onProgress: report, pace: () => deps.pace?.('hash') ?? Promise.resolve() });
    await repo.forget(job.retention ?? DEFAULT_RETENTION);
    const list = await repo.snapshots();
    backupState.set(id, { state: 'idle', snapshots: list.length, storedBytes: undefined });
    await jobPatch(id, { lastRun: Date.now(), lastOk: true, lastMessage: `${snap.stats.files.toLocaleString()} files · ${fmt(snap.stats.newBytes)} new` });
    // Back to normal after a failure: say so once.
    if (job.lastOk === false) phoneAlert('backups', `Backup “${job.name}” works again`, `${snap.stats.files.toLocaleString()} files backed up`, { good: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if ((e as BackupError).code !== 'wrong-key' && !ac.signal.aborted) phoneAlert('backups', `Backup “${job.name}” failed`, msg, { urgent: true });
    backupState.set(id, { ...backupState.get(id), state: (e as BackupError).code === 'wrong-key' ? 'waiting' : 'error', progress: undefined });
    await jobPatch(id, { lastRun: Date.now(), lastOk: false, lastMessage: msg });
  } finally {
    work.end();
    backupRuns.delete(id);
    deps.broadcast('progress', { task: 'backup', phase: 'Done', done: 1, total: 1 });
    changed();
  }
}

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : n < 1 << 30 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / (1 << 30)).toFixed(2)} GB`);

/** When a scheduled backup should run next (undefined: manual or waiting for a drive). */
function nextRun(b: BackupJobSetting): number | undefined {
  if (b.paused || b.schedule === 'manual' || b.schedule === 'drive') return undefined;
  const last = b.lastRun ?? 0;
  return last + (b.schedule === 'hourly' ? 3600_000 : DAY);
}

const drivesSeen = new Map<string, boolean>();
async function scheduledBackups() {
  if (!syncOn()) return;
  for (const b of conf().backups) {
    if (b.paused || backupRuns.has(b.id)) continue;
    if (!(await getSecret(`backup:${b.id}`))) continue;
    let due = false;
    if (b.schedule === 'drive' && b.dest.kind === 'folder') {
      const root = b.dest.path.split(path.sep).slice(0, 3).join(path.sep) || b.dest.path;
      const here = await fsp.stat(root).then(() => true, () => false);
      // Plugging the drive in starts a backup (at most one a day).
      due = here && !drivesSeen.get(b.id) && Date.now() - (b.lastRun ?? 0) > 6 * 3600_000;
      drivesSeen.set(b.id, here);
    } else if (b.schedule === 'idle') {
      due = Date.now() - (b.lastRun ?? 0) >= DAY && (deps.idleSeconds?.() ?? 600) >= 300;
    } else {
      const n = nextRun(b);
      due = n !== undefined && Date.now() >= n;
    }
    if (due) void runBackupJob(b.id);
  }
}

// ---------------------------------------------------------------- mirrors

async function runMirrorJob(id: string) {
  const m = conf().mirrors.find((x) => x.id === id);
  if (!m || mirrorState.get(id)?.state === 'running' || !syncOn()) return;
  const ac = new AbortController();
  mirrorRuns.set(id, ac);
  const work = startJob(`Mirror: ${m.name}`, { id: `mirror-${id}` });
  mirrorState.set(id, { state: 'running' });
  changed();
  try {
    await deps.whenIdle?.('scan');
    const store = await storeFor(m.dest);
    const state = await readJson<MirrorState>(mirrorFile(id), { files: {} });
    const r = await mirror(m.local, store, '', m.direction, state, {
      ignore: m.ignore,
      deviceName: conf().deviceName,
      signal: ac.signal,
      onFile: (rel, done, total) => {
        mirrorState.set(id, { state: 'running', progress: { file: rel, done, total } });
        if (done % 20 === 0) deps.broadcast('progress', { task: 'mirror', phase: m.name, done, total, current: rel });
      },
    });
    await writeJson(mirrorFile(id), state);
    const moved = r.uploaded.length + r.downloaded.length + r.deletedHere.length + r.deletedThere.length;
    mirrorState.set(id, { state: r.failed.length ? 'error' : 'idle' });
    await save({ mirrors: conf().mirrors.map((x) => (x.id === id ? { ...x, lastRun: Date.now(), lastMessage: r.failed.length ? `${r.failed.length} could not be copied: ${r.failed[0].why}` : moved ? `${r.uploaded.length} up, ${r.downloaded.length} down${r.conflicts.length ? `, ${r.conflicts.length} conflicts kept` : ''}` : 'Already the same' } : x)) });
  } catch (e) {
    mirrorState.set(id, { state: 'error' });
    await save({ mirrors: conf().mirrors.map((x) => (x.id === id ? { ...x, lastRun: Date.now(), lastMessage: e instanceof Error ? e.message : String(e) } : x)) });
  } finally {
    work.end();
    mirrorRuns.delete(id);
    deps.broadcast('progress', { task: 'mirror', phase: 'Done', done: 1, total: 1 });
    changed();
  }
}

// ---------------------------------------------------------------- phones (through the Link web companion)

const uploads = new Map<string, { file: string; part: string; size: number; mtime: number; sha256?: string; name: string }>();

/**
 * A phone starts sending a photo or video. Returns where to continue from
 * (bytes already here), or `duplicate` when the same file is already in the folder.
 */
export async function phoneUploadBegin(meta: { device: string; name: string; size: number; mtime: number; sha256?: string }): Promise<{ id: string; have: number; duplicate?: boolean }> {
  const c = conf().phoneUploads;
  if (!c.enabled) throw new Error('Phone uploads are turned off on this computer');
  const folder = c.folder || path.join(os.homedir(), 'Pictures', 'From phones');
  const month = new Date(meta.mtime || Date.now());
  const dir = path.join(folder, meta.device.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40) || 'Phone', `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  const name = path.basename(meta.name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '-') || 'upload';
  const file = path.join(dir, name);
  const st = await fsp.stat(file).catch(() => null);
  if (st && st.size === meta.size) return { id: '', have: meta.size, duplicate: true };
  await fsp.mkdir(dir, { recursive: true });
  const id = randomBytes(12).toString('hex');
  const part = path.join(dir, `.${name}.keeper-part`);
  const have = await fsp.stat(part).then((s) => Math.min(s.size, meta.size), () => 0);
  uploads.set(id, { file, part, size: meta.size, mtime: meta.mtime, sha256: meta.sha256, name });
  return { id, have };
}

export async function phoneUploadPart(id: string, offset: number, data: Buffer): Promise<number> {
  const u = uploads.get(id);
  if (!u) throw new Error('Unknown upload');
  const fh = await fsp.open(u.part, 'a+');
  try {
    const { size } = await fh.stat();
    if (offset !== size) return size;
    await fh.write(data, 0, data.length, offset);
    return offset + data.length;
  } finally {
    await fh.close();
  }
}

export async function phoneUploadFinish(id: string): Promise<{ path: string }> {
  const u = uploads.get(id);
  if (!u) throw new Error('Unknown upload');
  const st = await fsp.stat(u.part);
  if (st.size !== u.size) throw new Error('The upload is not complete');
  if (u.sha256) {
    const { createHash } = await import('node:crypto');
    const h = createHash('sha256').update(await fsp.readFile(u.part)).digest('hex');
    if (h !== u.sha256) {
      await fsp.rm(u.part, { force: true });
      throw new Error('The upload arrived damaged; it will be sent again');
    }
  }
  let dest = u.file;
  for (let i = 2; await fsp.stat(dest).then(() => true, () => false); i++) dest = u.file.replace(/(\.[^.]*)?$/, ` ${i}$1`);
  if (u.mtime) await fsp.utimes(u.part, new Date(), new Date(u.mtime)).catch(() => undefined);
  await fsp.rename(u.part, dest);
  uploads.delete(id);
  return { path: dest };
}

// ---------------------------------------------------------------- status

async function folderStatus(f: SyncFolderSetting): Promise<SyncFolderStatus> {
  const fs = folders.get(f.id);
  const info = folderInfo.get(f.id);
  const files = fs ? Object.values(fs.state.files).filter((r) => !r.deleted) : [];
  const peers = node?.transport.listPeers() ?? [];
  return {
    ...f,
    state: f.paused || conf().paused ? 'paused' : info?.state ?? 'idle',
    message: info?.message,
    files: files.length,
    bytes: files.reduce((n, r) => n + r.size, 0),
    conflicts: files.filter((r) => isConflictName(r.path)).length,
    lastScan: info?.lastScan,
    progress: info?.progress,
    peers: f.devices.map((id) => {
      const p = peers.find((x) => x.id === id);
      const s = info?.peers.get(id);
      return { id, name: p?.name ?? id.slice(0, 8), online: !!p?.online, via: p?.via, lastSync: s?.lastSync, state: !p?.online ? 'offline' : s?.state ?? 'idle', message: s?.message };
    }),
  };
}

async function overview(): Promise<SyncOverview> {
  const c = conf();
  const t = deps.transport();
  return {
    deviceId,
    deviceName: c.deviceName,
    paused: c.paused,
    transport: transportKind,
    transportMessage: transportMessage ?? t.message,
    peers: node?.transport.listPeers() ?? [],
    folders: await Promise.all(c.folders.map(folderStatus)),
    backups: await Promise.all(c.backups.map(async (b) => ({
      ...b,
      ...(backupState.get(b.id) ?? { state: 'idle' as const }),
      nextRun: nextRun(b),
      needsPassword: !(await getSecret(`backup:${b.id}`).catch(() => undefined)) && !repos.has(b.id),
      destLabel: destLabel(b.dest),
      testDue: !!b.lastOk && Date.now() - (b.lastTest ?? b.created) > TEST_EVERY,
    }))),
    mirrors: c.mirrors.map((m) => ({ ...m, ...(mirrorState.get(m.id) ?? { state: 'idle' as const }), destLabel: destLabel(m.dest) })),
    check321: check321(c, kindOf),
    waitingFor: c.paused ? 'Paused' : c.pauseOnBattery && deps.onBattery?.() ? 'On battery' : undefined,
    bandwidthKBps: c.bandwidthKBps,
    pauseOnBattery: c.pauseOnBattery,
    offers: offers.filter((o) => !c.folders.some((f) => f.id === o.id)),
    phoneUploads: { ...c.phoneUploads, folder: c.phoneUploads.folder || path.join(os.homedir(), 'Pictures', 'From phones') },
  };
}

function folderOf(absPath: string): { f: SyncFolderSetting; rel: string } | null {
  for (const f of conf().folders) {
    const rel = path.relative(f.path, absPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { f, rel: rel.split(path.sep).join('/') };
  }
  return null;
}

const original = (copy: string) => copy.replace(/ \(conflict, [^)]*\)(?=(\.[^./]*)?$)/, '');

// ---------------------------------------------------------------- the API

export const syncApi: SyncApi = {
  overview,
  async setPaused(paused) {
    await save({ paused });
    for (const f of folders.values()) f.cfg.paused = paused || !!conf().folders.find((x) => x.id === f.cfg.id)?.paused;
    if (!paused) soon(200);
    return overview();
  },
  async setOptions(patch) {
    await save(patch);
    return overview();
  },
  async addFolder(input) {
    const st = await fsp.stat(input.path).catch(() => null);
    if (!st?.isDirectory()) throw new Error('Choose a folder that exists');
    if (conf().folders.some((f) => f.path === input.path || input.path.startsWith(f.path + path.sep) || f.path.startsWith(input.path + path.sep))) throw new Error('This folder is already synced, or inside one that is');
    if (input.id && conf().folders.some((f) => f.id === input.id)) throw new Error('This shared folder is already set up here');
    const f: SyncFolderSetting = { id: input.id && /^[\w-]{4,64}$/.test(input.id) ? input.id : randomBytes(6).toString('hex'), path: input.path, label: input.label || path.basename(input.path), mode: input.mode, devices: input.devices, ignore: input.ignore ?? [], versioning: input.versioning ?? DEFAULT_POLICY };
    await save({ folders: [...conf().folders, f] });
    await loadFolder(f);
    soon(200);
    return overview();
  },
  async updateFolder(id, patch) {
    await save({ folders: conf().folders.map((f) => (f.id === id ? { ...f, ...patch, id } : f)) });
    unloadFolder(id);
    const f = conf().folders.find((x) => x.id === id);
    if (f) await loadFolder(f);
    soon(200);
    return overview();
  },
  async removeFolder(id) {
    unloadFolder(id);
    await save({ folders: conf().folders.filter((f) => f.id !== id) });
    await fsp.rm(stateFile(id), { force: true });
    return overview();
  },
  async ignoreOffer(id) {
    ignoredOffers.add(id);
    offers = offers.filter((o) => o.id !== id);
    return overview();
  },
  async rescan() {
    await runSync();
  },
  async conflicts(folderId) {
    const f = conf().folders.find((x) => x.id === folderId);
    const fs = folders.get(folderId);
    if (!f || !fs) return [];
    const out: ConflictInfo[] = [];
    for (const r of Object.values(fs.state.files)) {
      if (r.deleted || !isConflictName(r.path)) continue;
      const orig = fs.state.files[original(r.path)];
      out.push({ path: original(r.path), copy: r.path, size: orig && !orig.deleted ? orig.size : 0, mtime: orig?.mtime ?? 0, copySize: r.size, copyMtime: r.mtime });
    }
    return out;
  },
  async resolveConflict(folderId, copy, keep) {
    const f = conf().folders.find((x) => x.id === folderId);
    if (!f || !isConflictName(copy)) throw new Error('Not a conflict copy');
    const abs = (rel: string) => path.join(f.path, ...rel.split('/'));
    const orig = original(copy);
    if (keep === 'mine') await archive(f.path, copy, f.versioning ?? DEFAULT_POLICY);
    else if (keep === 'theirs') {
      await archive(f.path, orig, f.versioning ?? DEFAULT_POLICY);
      await fsp.rename(abs(copy), abs(orig));
    } else {
      // Keep both under ordinary names.
      let n = 2;
      let to = orig.replace(/(\.[^./]*)?$/, ` ${n}$1`);
      while (await fsp.stat(abs(to)).then(() => true, () => false)) to = orig.replace(/(\.[^./]*)?$/, ` ${++n}$1`);
      await fsp.rename(abs(copy), abs(to));
    }
    soon(200);
  },
  async versions(folderId, rel) {
    const f = conf().folders.find((x) => x.id === folderId);
    return f ? listVersions(f.path, rel) : [];
  },
  async restoreVersion(folderId, vrel) {
    const f = conf().folders.find((x) => x.id === folderId);
    if (!f) throw new Error('No such folder');
    const to = await restoreVersion(f.path, vrel, f.versioning ?? DEFAULT_POLICY);
    soon(200);
    return to;
  },
  async versionsFor(absPath) {
    const hit = folderOf(absPath);
    if (!hit) return null;
    return { folderId: hit.f.id, rel: hit.rel, versions: await listVersions(hit.f.path, hit.rel) };
  },
  async destinations() {
    const home = os.homedir();
    const out: StoreChoice[] = [];
    const candidates: [string, string][] = [
      [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'iCloud Drive'],
      [path.join(home, 'iCloudDrive'), 'iCloud Drive'],
      [path.join(home, 'Dropbox'), 'Dropbox folder'],
      [path.join(home, 'OneDrive'), 'OneDrive folder'],
      [path.join(home, 'Google Drive'), 'Google Drive folder'],
      [path.join(home, 'Nextcloud'), 'Nextcloud folder'],
    ];
    for (const [p, label] of candidates) if (await fsp.stat(p).then((s) => s.isDirectory(), () => false)) out.push({ kind: 'folder', label, detail: 'cloud folder', path: p });
    const vols = process.platform === 'darwin' ? ['/Volumes'] : process.platform === 'linux' ? [`/media/${os.userInfo().username}`, `/run/media/${os.userInfo().username}`, '/mnt'] : [];
    for (const v of vols) {
      for (const e of await fsp.readdir(v, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && e.name !== 'Macintosh HD') out.push({ kind: 'folder', label: e.name, detail: 'drive', path: path.join(v, e.name) });
      }
    }
    for (const c of deps.connections?.() ?? []) out.push(c);
    return out;
  },
  async addBackup(input) {
    const id = randomBytes(6).toString('hex');
    const job: BackupJobSetting = { id, name: input.name || 'Backup', sources: input.sources, dest: input.dest, schedule: input.schedule, retention: input.retention ?? DEFAULT_RETENTION, ignore: input.ignore ?? [], created: Date.now() };
    const store = await storeFor(job.dest);
    let recovery: string | undefined;
    if (await BackupRepo.exists(store)) {
      // An existing backup there: join it (same password), so several computers can share one destination.
      repos.set(id, await BackupRepo.open(store, isRecovery(input.password) ? { recovery: input.password } : { password: input.password }));
    } else {
      const r = await BackupRepo.init(store, input.password);
      repos.set(id, r.repo);
      recovery = r.recovery;
    }
    if (input.remember) await setSecret(`backup:${id}`, input.password);
    await save({ backups: [...conf().backups, job] });
    return { overview: await overview(), recovery };
  },
  async updateBackup(id, patch) {
    // Where it is stored and when it was made stay: a new place is a new backup.
    const { name, sources, schedule, retention, ignore, paused } = patch;
    const clean = Object.fromEntries(Object.entries({ name, sources, schedule, retention, ignore, paused }).filter(([, v]) => v !== undefined)) as Partial<BackupJobSetting>;
    if (clean.sources && !clean.sources.length) throw new Error('Choose at least one folder to back up');
    await jobPatch(id, clean);
    return overview();
  },
  async removeBackup(id) {
    backupRuns.get(id)?.abort();
    repos.delete(id);
    await setSecret(`backup:${id}`, '');
    await save({ backups: conf().backups.filter((b) => b.id !== id) });
    return overview();
  },
  async runBackup(id, password) {
    if (password) await repoFor(conf().backups.find((b) => b.id === id)!, password);
    void runBackupJob(id);
    return overview();
  },
  async cancelBackup(id) {
    backupRuns.get(id)?.abort();
  },
  async snapshots(id, password) {
    const job = conf().backups.find((b) => b.id === id);
    if (!job) return [];
    const list = await (await repoFor(job, password)).snapshots();
    backupState.set(id, { ...(backupState.get(id) ?? { state: 'idle' }), snapshots: list.length });
    return list;
  },
  async snapshotFiles(id, name, password) {
    const job = conf().backups.find((b) => b.id === id);
    if (!job) return [];
    return (await (await repoFor(job, password)).snapshot(name)).files.map((f) => ({ path: f.path, size: f.size, mtime: f.mtime }));
  },
  async restore(id, name, opts) {
    const job = conf().backups.find((b) => b.id === id);
    if (!job) throw new Error('No such backup');
    const repo = await repoFor(job, opts.password);
    const target = opts.target ?? path.join(os.homedir(), 'Restored', `${job.name} ${new Date().toISOString().slice(0, 10)}`);
    const r = await repo.restore(name, target, {
      include: opts.include,
      overwrite: opts.overwrite,
      onProgress: (p) => deps.broadcast('progress', { task: 'restore', phase: `Restoring ${p.file ?? ''}`, done: p.bytes, total: p.totalBytes || 1, current: p.file }),
    });
    deps.broadcast('progress', { task: 'restore', phase: 'Done', done: 1, total: 1 });
    await jobPatch(id, { lastTest: Date.now() });
    return { ...r, target };
  },
  async verifyBackup(id, full, password) {
    const job = conf().backups.find((b) => b.id === id);
    if (!job) throw new Error('No such backup');
    const r = await (await repoFor(job, password)).verify({ full });
    if (r.ok) await jobPatch(id, { lastTest: Date.now() });
    return r;
  },
  async addMirror(input) {
    const m: MirrorJobSetting = { id: randomBytes(6).toString('hex'), name: input.name || path.basename(input.local), local: input.local, dest: input.dest, direction: input.direction, schedule: input.schedule, ignore: input.ignore ?? [] };
    await save({ mirrors: [...conf().mirrors, m] });
    void runMirrorJob(m.id);
    return overview();
  },
  async updateMirror(id, patch) {
    // The two folders stay (the mirror's record of what was copied belongs to them): a new pair is a new mirror.
    const { name, direction, schedule, ignore, paused } = patch;
    const clean = Object.fromEntries(Object.entries({ name, direction, schedule, ignore, paused }).filter(([, v]) => v !== undefined)) as Partial<MirrorJobSetting>;
    await save({ mirrors: conf().mirrors.map((m) => (m.id === id ? { ...m, ...clean, id } : m)) });
    return overview();
  },
  async removeMirror(id) {
    await save({ mirrors: conf().mirrors.filter((m) => m.id !== id) });
    await fsp.rm(mirrorFile(id), { force: true });
    return overview();
  },
  async runMirror(id) {
    void runMirrorJob(id);
    return overview();
  },
};

// ---------------------------------------------------------------- start and stop

async function loadDeviceId(): Promise<string> {
  const file = path.join(deps.userData, 'sync', 'device.json');
  const d = await readJson<{ id?: string }>(file, {});
  if (d.id) return d.id;
  const id = randomBytes(16).toString('hex');
  await writeJson(file, { id });
  return id;
}

export async function startSync(d: SyncServiceDeps) {
  deps = d;
  const t = d.transport();
  transportKind = t.transport ? t.kind : 'none';
  transportMessage = t.message;
  deviceId = t.transport?.selfId ?? (await loadDeviceId());
  if (t.transport) {
    node = new SyncNode(t.transport);
    stops.push(() => node?.close());
    if (t.transport.onPeersChanged) stops.push(t.transport.onPeersChanged(() => { changed(); soon(1000); }));
  }
  await reloadFolders();
  const every = (name: string, ms: number, fn: () => unknown) => {
    if (d.poll) stops.push(d.poll(name, ms, fn));
    else {
      const h = setInterval(fn, ms);
      h.unref?.();
      stops.push(() => clearInterval(h));
    }
  };
  every('sync.round', 5 * 60_000, () => runSync());
  every('sync.backups', 15 * 60_000, () => scheduledBackups());
  every('sync.mirrors', 60 * 60_000, () => {
    for (const m of conf().mirrors) if (!m.paused && m.schedule !== 'manual') void runMirrorJob(m.id);
  });
  every('sync.versions', 24 * 3600_000, async () => {
    if (!syncOn()) return;
    for (const f of conf().folders) await cleanVersions(f.path, f.versioning ?? DEFAULT_POLICY).catch(() => undefined);
  });
  // Switching "Sync and backup" off stops watching folders and cancels running backups and
  // mirrors; switching it back on picks the folders up again.
  stops.push(onFeature('sync', (on) => {
    if (on) {
      void reloadFolders().then(() => soon(1000));
      return;
    }
    pauseAll();
    changed();
  }));
  if (conf().folders.length && syncOn()) soon(3000);
}

function pauseAll() {
  for (const id of [...folders.keys()]) unloadFolder(id);
  for (const ac of backupRuns.values()) ac.abort();
  for (const ac of mirrorRuns.values()) ac.abort();
  clearTimeout(debounce);
}

export function stopSync() {
  for (const s of stops.splice(0)) s();
  pauseAll();
}

/**
 * Switches sync onto a device network once it is ready (Keeper Link starts
 * after sync). Folders are re-attached; nothing on disk changes.
 */
export async function attachTransport(t: PeerTransport, kind: SyncOverview['transport'], message?: string) {
  node?.close();
  node = new SyncNode(t);
  transportKind = kind;
  transportMessage = message;
  if (t.onPeersChanged) stops.push(t.onPeersChanged(() => { changed(); soon(1000); }));
  if (deviceId !== t.selfId) {
    // The device's identity now comes from the network; folder records follow it.
    deviceId = t.selfId;
  }
  await reloadFolders();
  changed();
  soon(1000);
}

/** Cloud and server connections, once Keeper's connections are ready. */
export function attachConnections(open: (id: string) => Promise<RemoteStore>, list: () => StoreChoice[]) {
  deps.openConnection = open;
  deps.connections = list;
  changed();
}

/** For the command line through the running app. */
export function syncStatusLine(): Promise<SyncOverview> {
  return overview();
}
