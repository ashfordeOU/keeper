// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Backups that work on any storage: a folder, a drive, a NAS, a server or any
// cloud service Keeper connects to. Files are cut into pieces by content, each
// piece is compressed and encrypted on this device and stored once, however
// many files or backups use it. A backup of unchanged files therefore uploads
// almost nothing, and the storage only ever sees random-looking bytes.
//
// Layout in the destination folder:
//   keeper-backup.json      format, piece size, the key wrapped by password and recovery key
//   packs/xx/<id>           pieces, packed together (encrypted)
//   index/<id>              which pieces are in which pack, and where (encrypted)
//   snapshots/<time>-<id>   one per backup: every file and its pieces (encrypted)

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';
import { makeWraps, newRecoveryKey, unwrapKey, type VaultHeader } from '../vault';
import { BACKUP_CHUNKS, chunkFile, type ChunkParams } from './chunker';
import { IgnoreMatcher } from './ignore';
import type { RemoteStore } from './ports';

export const CONFIG_FILE = 'keeper-backup.json';

export interface RepoConfig {
  format: 'keeper-backup';
  version: 1;
  id: string;
  created: number;
  chunks: ChunkParams;
  wraps: VaultHeader['wraps'];
}

export interface SnapshotFile {
  /** "<source name>/<path inside it>" */
  path: string;
  size: number;
  mtime: number;
  mode: number;
  chunks: string[];
}

export interface Snapshot {
  id: string;
  time: number;
  host: string;
  /** source names → where they were on this computer */
  sources: Record<string, string>;
  files: SnapshotFile[];
  stats: { files: number; bytes: number; newBytes: number; storedBytes: number; seconds: number };
}

export type SnapshotSummary = Omit<Snapshot, 'files'> & { name: string };

export interface BackupProgress {
  phase: 'reading' | 'uploading' | 'restoring' | 'verifying' | 'cleaning';
  file?: string;
  files: number;
  bytes: number;
  totalBytes?: number;
}

export class BackupError extends Error {
  constructor(public code: 'wrong-key' | 'damaged' | 'not-a-backup' | 'exists' | 'cancelled', message: string) {
    super(message);
  }
}

const IV = 12;
const TAG = 16;

function seal(key: Buffer, data: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function open(key: Buffer, blob: Buffer, aad: string): Buffer {
  try {
    const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(blob.subarray(IV, IV + TAG));
    return Buffer.concat([d.update(blob.subarray(IV + TAG)), d.final()]);
  } catch {
    throw new BackupError('damaged', 'Part of the backup has been changed or damaged.');
  }
}

const sealJson = (key: Buffer, obj: unknown, aad: string) => seal(key, gzipSync(Buffer.from(JSON.stringify(obj))), aad);
const openJson = <T>(key: Buffer, blob: Buffer, aad: string): T => JSON.parse(gunzipSync(open(key, blob, aad)).toString('utf8')) as T;

const hex = (n: number) => randomBytes(n).toString('hex');
const packPath = (id: string) => `packs/${id.slice(0, 2)}/${id}`;

interface IndexEntry {
  pack: string;
  offset: number;
  length: number;
}

async function listAll(store: RemoteStore, dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await store.list(dir).catch(() => [])) {
    if (e.isDir) out.push(...(await listAll(store, e.path)));
    else out.push(e.path);
  }
  return out;
}

export interface RetentionPolicy {
  last?: number;
  hourly?: number;
  daily?: number;
  weekly?: number;
  monthly?: number;
  yearly?: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { last: 3, daily: 7, weekly: 4, monthly: 12, yearly: 3 };

/** Which backups a retention rule keeps (newest of each hour/day/week/… up to the counts). */
export function keepSnapshots(snaps: { id: string; time: number }[], p: RetentionPolicy): Set<string> {
  const sorted = [...snaps].sort((a, b) => b.time - a.time);
  const keep = new Set<string>(sorted.slice(0, p.last ?? 0).map((s) => s.id));
  const bucket = (t: number, kind: keyof RetentionPolicy) => {
    const d = new Date(t);
    if (kind === 'hourly') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    if (kind === 'daily') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (kind === 'weekly') {
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
    }
    if (kind === 'monthly') return `${d.getFullYear()}-${d.getMonth()}`;
    return `${d.getFullYear()}`;
  };
  for (const kind of ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const) {
    const n = p[kind] ?? 0;
    const seen = new Set<string>();
    for (const s of sorted) {
      if (seen.size >= n) break;
      const b = bucket(s.time, kind);
      if (seen.has(b)) continue;
      seen.add(b);
      keep.add(s.id);
    }
  }
  return keep;
}

export class BackupRepo {
  private encKey: Buffer;
  private macKey: Buffer;
  /** every piece already stored */
  private index = new Map<string, IndexEntry>();
  private indexLoaded = false;
  /** pieces waiting to be written, as one pack */
  private pending: { id: string; blob: Buffer }[] = [];
  private pendingBytes = 0;
  /** packs are written once they reach this size */
  packSize = 16 << 20;

  private constructor(readonly store: RemoteStore, readonly config: RepoConfig, master: Buffer) {
    this.encKey = Buffer.from(hkdfSync('sha256', master, Buffer.from(config.id), 'keeper-backup enc', 32));
    this.macKey = Buffer.from(hkdfSync('sha256', master, Buffer.from(config.id), 'keeper-backup mac', 32));
  }

  static async exists(store: RemoteStore): Promise<boolean> {
    return !!(await store.stat(CONFIG_FILE).catch(() => null));
  }

  /** Starts a new backup store. Returns it and the recovery key to show the person once. */
  static async init(store: RemoteStore, password: string, opts: { recovery?: string; kdf?: { N: number; r: number; p: number } } = {}): Promise<{ repo: BackupRepo; recovery: string }> {
    if (await BackupRepo.exists(store)) throw new BackupError('exists', 'There is already a backup here.');
    const master = randomBytes(32);
    const recovery = opts.recovery ?? newRecoveryKey();
    const config: RepoConfig = { format: 'keeper-backup', version: 1, id: hex(16), created: Date.now(), chunks: BACKUP_CHUNKS, wraps: await makeWraps(master, { password, recovery }, opts.kdf) };
    await store.put(CONFIG_FILE, Buffer.from(JSON.stringify(config, null, 2)));
    return { repo: new BackupRepo(store, config, master), recovery };
  }

  /** Opens an existing backup with its password or recovery key. */
  static async open(store: RemoteStore, secret: { password?: string; recovery?: string }): Promise<BackupRepo> {
    let config: RepoConfig;
    try {
      config = JSON.parse((await store.get(CONFIG_FILE)).toString('utf8')) as RepoConfig;
    } catch {
      throw new BackupError('not-a-backup', 'There is no Keeper backup here.');
    }
    if (config.format !== 'keeper-backup') throw new BackupError('not-a-backup', 'There is no Keeper backup here.');
    let master: Buffer;
    try {
      master = await unwrapKey({ wraps: config.wraps } as VaultHeader, secret);
    } catch {
      throw new BackupError('wrong-key', secret.recovery ? 'That recovery key does not open this backup.' : 'That password does not open this backup.');
    }
    return new BackupRepo(store, config, master);
  }

  /** Adds (or replaces) the password, keeping the recovery key. */
  async changePassword(password: string, recovery: string) {
    const master = await unwrapKey({ wraps: this.config.wraps } as VaultHeader, { recovery });
    this.config.wraps = await makeWraps(master, { password, recovery });
    await this.store.put(CONFIG_FILE, Buffer.from(JSON.stringify(this.config, null, 2)));
  }

  private pieceId(data: Buffer) {
    return createHmac('sha256', this.macKey).update(data).digest('hex');
  }

  async loadIndex() {
    if (this.indexLoaded) return;
    for (const p of await listAll(this.store, 'index')) {
      const name = p.split('/').pop()!;
      const entries = openJson<[string, number, number][]>(this.encKey, await this.store.get(p), `index:${name}`);
      for (const [id, offset, length] of entries) this.index.set(id, { pack: name, offset, length });
    }
    this.indexLoaded = true;
  }

  /** Stores a piece unless it is already there; returns its id and the bytes added. */
  private async addPiece(data: Buffer): Promise<{ id: string; added: number }> {
    const id = this.pieceId(data);
    if (this.index.has(id) || this.pending.some((p) => p.id === id)) return { id, added: 0 };
    const packed = deflateRawSync(data, { level: 3 });
    const body = packed.length < data.length * 0.95 ? Buffer.concat([Buffer.from([1]), packed]) : Buffer.concat([Buffer.from([0]), data]);
    const blob = seal(this.encKey, body, `piece:${id}`);
    this.pending.push({ id, blob });
    this.pendingBytes += blob.length;
    if (this.pendingBytes >= this.packSize) await this.flush();
    return { id, added: blob.length };
  }

  /** Writes the waiting pieces as one pack, then its index. */
  async flush() {
    if (!this.pending.length) return;
    const pack = hex(16);
    const entries: [string, number, number][] = [];
    let off = 0;
    for (const p of this.pending) {
      entries.push([p.id, off, p.blob.length]);
      off += p.blob.length;
    }
    await this.store.put(packPath(pack), Buffer.concat(this.pending.map((p) => p.blob)));
    await this.store.put(`index/${pack}`, sealJson(this.encKey, entries, `index:${pack}`));
    for (const [id, offset, length] of entries) this.index.set(id, { pack, offset, length });
    this.pending = [];
    this.pendingBytes = 0;
  }

  private async readPiece(id: string, cache?: Map<string, Buffer>): Promise<Buffer> {
    await this.loadIndex();
    const e = this.index.get(id);
    if (!e) throw new BackupError('damaged', 'A piece of this backup is missing.');
    let blob: Buffer;
    const packBuf = cache?.get(e.pack);
    if (packBuf) blob = packBuf.subarray(e.offset, e.offset + e.length);
    else blob = await this.store.get(packPath(e.pack), { start: e.offset, end: e.offset + e.length });
    const body = open(this.encKey, blob, `piece:${id}`);
    const data = body[0] === 1 ? inflateRawSync(body.subarray(1)) : body.subarray(1);
    if (this.pieceId(data) !== id) throw new BackupError('damaged', 'A piece of this backup does not match.');
    return data;
  }

  // ---------------------------------------------------------------- backups

  async snapshots(): Promise<SnapshotSummary[]> {
    const out: SnapshotSummary[] = [];
    for (const p of await listAll(this.store, 'snapshots')) {
      const name = p.split('/').pop()!;
      try {
        const s = openJson<Snapshot>(this.encKey, await this.store.get(p), `snapshot:${name}`);
        const { files, ...rest } = s;
        void files;
        out.push({ ...rest, name });
      } catch {
        /* a damaged backup is skipped here; verify reports it */
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  async snapshot(name: string): Promise<Snapshot> {
    return openJson<Snapshot>(this.encKey, await this.store.get(`snapshots/${name}`), `snapshot:${name}`);
  }

  /**
   * Backs up the sources (name → folder). Files whose size and date match the
   * last backup of the same sources are not read again.
   */
  async backup(
    sources: Record<string, string>,
    opts: { ignore?: string[]; host?: string; signal?: AbortSignal; onProgress?: (p: BackupProgress) => void; pace?: () => Promise<void>; now?: number } = {},
  ): Promise<SnapshotSummary> {
    const started = Date.now();
    await this.loadIndex();
    const host = opts.host ?? os.hostname();
    const prevSummary = (await this.snapshots()).find((s) => s.host === host && Object.keys(s.sources).sort().join() === Object.keys(sources).sort().join());
    const prev = new Map<string, SnapshotFile>();
    if (prevSummary) for (const f of (await this.snapshot(prevSummary.name)).files) prev.set(f.path, f);
    const ignore = new IgnoreMatcher(opts.ignore ?? []);
    const files: SnapshotFile[] = [];
    const stats = { files: 0, bytes: 0, newBytes: 0, storedBytes: 0, seconds: 0 };
    const progress = (file?: string) => opts.onProgress?.({ phase: 'reading', file, files: stats.files, bytes: stats.bytes });
    for (const [name, root] of Object.entries(sources)) {
      const walk = async (dir: string) => {
        for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (opts.signal?.aborted) throw new BackupError('cancelled', 'The backup was stopped.');
          const abs = path.join(dir, e.name);
          const rel = path.relative(root, abs).split(path.sep).join('/');
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) {
            if (!ignore.ignored(rel, true)) await walk(abs);
            continue;
          }
          if (!e.isFile() || ignore.ignored(rel)) continue;
          const st = await fsp.stat(abs).catch(() => null);
          if (!st) continue;
          const key = `${name}/${rel}`;
          const old = prev.get(key);
          let chunks: string[];
          if (old && old.size === st.size && Math.trunc(old.mtime) === Math.trunc(st.mtimeMs) && old.chunks.every((c) => this.index.has(c))) {
            chunks = old.chunks;
          } else {
            await opts.pace?.();
            chunks = [];
            progress(key);
            try {
              await chunkFile(abs, this.config.chunks, async (_c, data) => {
                const r = await this.addPiece(Buffer.from(data));
                chunks.push(r.id);
                if (r.added) {
                  stats.newBytes += data.length;
                  stats.storedBytes += r.added;
                }
              }, opts.signal);
            } catch (e) {
              if (opts.signal?.aborted) throw new BackupError('cancelled', 'The backup was stopped.');
              // A file that vanished or cannot be read is left out of this backup.
              if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EBUSY') continue;
              throw e;
            }
          }
          files.push({ path: key, size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o777, chunks });
          stats.files++;
          stats.bytes += st.size;
          if (stats.files % 50 === 0) progress(key);
        }
      };
      await walk(root);
    }
    opts.onProgress?.({ phase: 'uploading', files: stats.files, bytes: stats.bytes });
    await this.flush();
    const time = opts.now ?? Date.now();
    stats.seconds = Math.round((Date.now() - started) / 100) / 10;
    const snap: Snapshot = { id: hex(8), time, host, sources, files, stats };
    const name = `${new Date(time).toISOString().replace(/[:.]/g, '-')}-${snap.id}`;
    await this.store.put(`snapshots/${name}`, sealJson(this.encKey, snap, `snapshot:${name}`));
    const { files: _f, ...rest } = snap;
    void _f;
    return { ...rest, name };
  }

  /**
   * Restores a backup (or the files under `include` paths) into `target`.
   * Existing files are not overwritten unless `overwrite` is set; restored files get their old dates back.
   */
  async restore(
    name: string,
    target: string,
    opts: { include?: string[]; overwrite?: boolean; signal?: AbortSignal; onProgress?: (p: BackupProgress) => void } = {},
  ): Promise<{ files: number; bytes: number; skipped: string[] }> {
    const snap = await this.snapshot(name);
    const wanted = snap.files.filter((f) => !opts.include?.length || opts.include.some((p) => f.path === p || f.path.startsWith(p.replace(/\/?$/, '/'))));
    const totalBytes = wanted.reduce((n, f) => n + f.size, 0);
    const out = { files: 0, bytes: 0, skipped: [] as string[] };
    for (const f of wanted) {
      if (opts.signal?.aborted) throw new BackupError('cancelled', 'The restore was stopped.');
      const dest = path.resolve(target, ...f.path.split('/'));
      if (!dest.startsWith(path.resolve(target) + path.sep)) {
        out.skipped.push(f.path);
        continue;
      }
      if (!opts.overwrite && (await fsp.stat(dest).then(() => true, () => false))) {
        out.skipped.push(f.path);
        continue;
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.keeper-part`;
      const fh = await fsp.open(tmp, 'w');
      try {
        for (const c of f.chunks) {
          const data = await this.readPiece(c);
          await fh.write(data);
          out.bytes += data.length;
          opts.onProgress?.({ phase: 'restoring', file: f.path, files: out.files, bytes: out.bytes, totalBytes });
        }
      } finally {
        await fh.close();
      }
      if (process.platform !== 'win32') await fsp.chmod(tmp, f.mode || 0o644).catch(() => undefined);
      await fsp.utimes(tmp, new Date(), new Date(f.mtime)).catch(() => undefined);
      await fsp.rename(tmp, dest);
      out.files++;
    }
    return out;
  }

  /**
   * Checks the backup can be restored. `full` reads every piece; otherwise a
   * sample of pieces plus every backup's list of files.
   */
  async verify(opts: { full?: boolean; sample?: number; onProgress?: (p: BackupProgress) => void } = {}): Promise<{ ok: boolean; problems: string[]; checked: number }> {
    await this.loadIndex();
    const problems: string[] = [];
    const used = new Set<string>();
    for (const s of await listAll(this.store, 'snapshots')) {
      const name = s.split('/').pop()!;
      try {
        for (const f of (await this.snapshot(name)).files) for (const c of f.chunks) used.add(c);
      } catch {
        problems.push(`Backup ${name} cannot be read`);
      }
    }
    for (const c of used) if (!this.index.has(c)) problems.push(`A piece used by a backup is missing (${c.slice(0, 12)}…)`);
    let ids = [...this.index.keys()];
    if (!opts.full) ids = ids.sort(() => Math.random() - 0.5).slice(0, opts.sample ?? 200);
    let checked = 0;
    for (const id of ids) {
      try {
        await this.readPiece(id);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
      checked++;
      if (checked % 50 === 0) opts.onProgress?.({ phase: 'verifying', files: checked, bytes: 0 });
    }
    return { ok: !problems.length, problems: [...new Set(problems)], checked };
  }

  /** Removes backups the rule no longer keeps, then packs nothing uses. */
  async forget(policy: RetentionPolicy): Promise<{ removed: string[]; freedBytes: number }> {
    const snaps = await this.snapshots();
    const keep = keepSnapshots(snaps.map((s) => ({ id: s.name, time: s.time })), policy);
    const removed: string[] = [];
    for (const s of snaps) {
      if (keep.has(s.name)) continue;
      await this.store.delete(`snapshots/${s.name}`);
      removed.push(s.name);
    }
    const freedBytes = await this.prune();
    return { removed, freedBytes };
  }

  /** Deletes packs no remaining backup uses (packs still partly used stay whole). */
  async prune(): Promise<number> {
    await this.loadIndex();
    const used = new Set<string>();
    for (const s of await listAll(this.store, 'snapshots')) {
      const name = s.split('/').pop()!;
      for (const f of (await this.snapshot(name)).files) for (const c of f.chunks) used.add(c);
    }
    const byPack = new Map<string, string[]>();
    for (const [id, e] of this.index) byPack.set(e.pack, [...(byPack.get(e.pack) ?? []), id]);
    let freed = 0;
    for (const [pack, ids] of byPack) {
      if (ids.some((id) => used.has(id))) continue;
      const st = await this.store.stat(packPath(pack));
      freed += st?.size ?? 0;
      await this.store.delete(`index/${pack}`);
      await this.store.delete(packPath(pack));
      for (const id of ids) this.index.delete(id);
    }
    return freed;
  }
}
