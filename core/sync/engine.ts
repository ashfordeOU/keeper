// SPDX-License-Identifier: AGPL-3.0-or-later
// Folder sync between Keeper devices. Each device keeps a record of its copy
// (see folder.ts) and asks the others what changed since it last looked. Files
// are rebuilt from pieces: pieces already on this device (from any file, so a
// rename or a small edit costs almost nothing) and the rest from the other
// device. Every piece is checked against its hash, written to a temporary file
// and only then moved into place; what it replaces is kept as a version.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { sha256 } from './chunker';
import { changesSince, conflictName, scanFolder, type FileRecord, type FolderState, type ScanResult } from './folder';
import { IgnoreMatcher } from './ignore';
import { Rpc } from './rpc';
import { archive, type VersionPolicy } from './versions';
import { bumpVV, compareVV, mergeVV } from './vv';

export type SyncMode = 'two-way' | 'send-only' | 'receive-only';

export interface FolderConfig {
  id: string;
  /** absolute path on this device */
  root: string;
  label?: string;
  mode: SyncMode;
  /** devices this folder is shared with */
  devices: string[];
  ignore: string[];
  versioning: VersionPolicy;
  paused?: boolean;
}

export interface SyncProgress {
  folderId: string;
  peer: string;
  file?: string;
  /** bytes of the current file */
  done: number;
  total: number;
  /** files waiting in this round */
  queued: number;
}

export interface SyncDeps {
  deviceName(id: string): string;
  save(state: FolderState): Promise<void>;
  /** waits as needed to keep under the bandwidth limit (bytes just moved) */
  throttle?(bytes: number): Promise<void>;
  onProgress?(p: SyncProgress): void;
  onConflict?(c: { folderId: string; path: string; copy: string; peer: string }): void;
  now?(): number;
}

export interface SyncRound {
  peer: string;
  pulled: string[];
  deleted: string[];
  conflicts: string[];
  skipped: { path: string; why: string }[];
  bytes: number;
}

const PART = '.keeper-part';

const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'));

/** Is any folder above `rel` currently locked (a "<name>.keeperlock" sits where the folder was)? */
async function insideLocked(root: string, rel: string): Promise<boolean> {
  const parts = rel.split('/').slice(0, -1);
  for (let i = 1; i <= parts.length; i++) {
    const dir = abs(root, parts.slice(0, i).join('/'));
    if (await fsp.stat(dir + '.keeperlock').then(() => true, () => false)) return true;
  }
  return false;
}

/** Does the file on disk still match what we recorded? (If not, a local edit is waiting to be scanned.) */
async function diskMatches(root: string, r: FileRecord | undefined): Promise<boolean> {
  const st = await fsp.stat(abs(root, r?.path ?? '')).catch(() => null);
  if (!r || r.deleted) return !st || !st.isFile();
  return !!st && st.size === r.size && Math.trunc(st.mtimeMs) === Math.trunc(r.mtime);
}

export class FolderSync {
  readonly ignore: IgnoreMatcher;
  private blockIndex: { seq: number; map: Map<string, { rel: string; offset: number; size: number }[]> } | null = null;
  private busy = false;

  constructor(public cfg: FolderConfig, public state: FolderState, private deps: SyncDeps) {
    this.ignore = new IgnoreMatcher(cfg.ignore);
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  /** Looks at the disk and records what changed. */
  async scan(signal?: AbortSignal): Promise<ScanResult> {
    let extra = '';
    try {
      extra = await fsp.readFile(path.join(this.cfg.root, '.keeperignore'), 'utf8');
    } catch {
      /* no ignore file */
    }
    const ignore = extra ? new IgnoreMatcher([...this.cfg.ignore, extra]) : this.ignore;
    const r = await scanFolder(this.cfg.root, this.state, { ignore, signal });
    if (r.changed.length) await this.deps.save(this.state);
    return r;
  }

  // ---------------------------------------------------------------- serving other devices

  /** Answers another device's requests about this folder. */
  async serve(peer: string, method: string, params: Record<string, unknown>): Promise<{ result?: unknown; body?: Buffer }> {
    if (!this.cfg.devices.includes(peer)) throw new Error('This folder is not shared with that device');
    if (method === 'changes') {
      const since = Number(params.since) || 0;
      const records = this.cfg.paused ? [] : changesSince(this.state, since, { hideLocal: this.cfg.mode === 'receive-only' });
      return { result: { seq: this.state.seq, records } };
    }
    if (method === 'block') {
      const hash = String(params.hash);
      const data = await this.readLocalBlock(hash, String(params.hint ?? ''));
      if (!data) throw new Error('piece not found');
      return { result: { ok: true }, body: data };
    }
    throw new Error(`unknown request ${method}`);
  }

  private blocks() {
    if (this.blockIndex?.seq === this.state.seq) return this.blockIndex.map;
    const map = new Map<string, { rel: string; offset: number; size: number }[]>();
    for (const r of Object.values(this.state.files)) {
      if (r.deleted) continue;
      let off = 0;
      for (const b of r.blocks) {
        const list = map.get(b.hash) ?? [];
        if (list.length < 4) list.push({ rel: r.path, offset: off, size: b.size });
        map.set(b.hash, list);
        off += b.size;
      }
    }
    this.blockIndex = { seq: this.state.seq, map };
    return map;
  }

  /** A piece from any file on this device, checked against its hash (files may have changed since the last scan). */
  private async readLocalBlock(hash: string, hint = ''): Promise<Buffer | null> {
    const list = [...(this.blocks().get(hash) ?? [])].sort((a, b) => (a.rel === hint ? -1 : b.rel === hint ? 1 : 0));
    for (const s of list) {
      try {
        const fh = await fsp.open(abs(this.cfg.root, s.rel), 'r');
        try {
          const buf = Buffer.alloc(s.size);
          const { bytesRead } = await fh.read(buf, 0, s.size, s.offset);
          if (bytesRead === s.size && sha256(buf) === hash) return buf;
        } finally {
          await fh.close();
        }
      } catch {
        /* try the next place */
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- pulling from another device

  /** One round with one device: fetch what changed there and apply it here. */
  async syncWith(peer: string, rpc: Rpc): Promise<SyncRound> {
    const round: SyncRound = { peer, pulled: [], deleted: [], conflicts: [], skipped: [], bytes: 0 };
    if (this.busy || this.cfg.paused) return round;
    this.busy = true;
    try {
      const since = this.state.peers[peer]?.seq ?? 0;
      const { result } = await rpc.call('changes', { folder: this.cfg.id, since });
      const { seq, records } = result as { seq: number; records: FileRecord[] };
      if (this.cfg.mode !== 'send-only') {
        // Files first, deletions last: a renamed file is rebuilt from its old copy before that goes.
        const ordered = [...records.filter((r) => !r.deleted), ...records.filter((r) => r.deleted)];
        let queued = ordered.length;
        for (const r of ordered) {
          queued--;
          if (this.ignore.ignored(r.path)) continue;
          try {
            await this.apply(peer, r, rpc, round, queued);
          } catch (e) {
            round.skipped.push({ path: r.path, why: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      // Only move our bookmark forward when everything went in, so a failed file is tried again next round.
      if (!round.skipped.some((s) => !s.why.startsWith('later:'))) this.state.peers[peer] = { seq, at: this.now() };
      else this.state.peers[peer] = { seq: this.state.peers[peer]?.seq ?? 0, at: this.now() };
      await this.deps.save(this.state);
      return round;
    } finally {
      this.busy = false;
    }
  }

  private record(r: FileRecord, patch: Partial<FileRecord> = {}) {
    this.state.seq++;
    this.state.files[r.path] = { ...r, ...patch, seq: this.state.seq, local: patch.local ?? false };
  }

  private async apply(peer: string, r: FileRecord, rpc: Rpc, round: SyncRound, queued: number) {
    const root = this.cfg.root;
    const local = this.state.files[r.path];
    const order = local ? compareVV(r.version, local.version) : 'newer';
    if (order === 'equal' || order === 'older') return;
    if (!(await diskMatches(root, local))) {
      round.skipped.push({ path: r.path, why: 'later: changed here since the last look' });
      return;
    }
    if (await insideLocked(root, r.path)) {
      round.skipped.push({ path: r.path, why: 'the folder it belongs in is locked' });
      return;
    }

    if (order === 'concurrent' && local) {
      const merged = mergeVV(local.version, r.version);
      if (local.deleted && r.deleted) return this.record(local, { version: merged, local: local.local });
      if (!local.deleted && !r.deleted && local.hash === r.hash) return this.record(local, { version: merged, local: local.local });
      if (r.deleted) {
        // Changed here, deleted there: keeping the change is the safe choice.
        return this.record(local, { version: bumpVV(merged, this.state.device), by: this.state.device, local: true });
      }
      if (!local.deleted && this.cfg.mode !== 'receive-only') {
        // Both changed it. The later edit keeps the name; the other is kept beside it.
        const remoteWins = r.mtime > local.mtime || (r.mtime === local.mtime && r.by > local.by);
        if (remoteWins) {
          const copy = conflictName(r.path, this.deps.deviceName(this.state.device), this.now());
          await fsp.rename(abs(root, r.path), abs(root, copy));
          await this.pull(peer, r, rpc, round, queued, r.path, false);
          this.record(r, { version: merged });
          round.conflicts.push(copy);
          this.deps.onConflict?.({ folderId: this.cfg.id, path: r.path, copy, peer });
        } else {
          const copy = conflictName(r.path, this.deps.deviceName(r.by), this.now());
          await this.pull(peer, r, rpc, round, queued, copy, false);
          this.record(local, { version: bumpVV(merged, this.state.device), by: this.state.device, local: true });
          round.conflicts.push(copy);
          this.deps.onConflict?.({ folderId: this.cfg.id, path: r.path, copy, peer });
        }
        return;
      }
      // Deleted here but changed there (or a receive-only copy): theirs comes in.
      r = { ...r, version: merged };
    }

    if (r.deleted) {
      if (local && !local.deleted) await archive(root, r.path, this.cfg.versioning, this.now());
      this.record(r);
      round.deleted.push(r.path);
      return;
    }
    await this.pull(peer, r, rpc, round, queued, r.path, true);
    this.record(r);
    round.pulled.push(r.path);
  }

  /** Rebuilds `r` at `dest` from pieces here and there; resumes a half-done copy of the same version. */
  private async pull(peer: string, r: FileRecord, rpc: Rpc, round: SyncRound, queued: number, dest: string, versionOld: boolean) {
    const root = this.cfg.root;
    const target = abs(root, dest);
    const dir = path.dirname(target);
    await fsp.mkdir(dir, { recursive: true });
    const part = path.join(dir, `.${path.basename(target)}${PART}`);
    const side = `${part}.json`;
    let done = 0;
    try {
      const s = JSON.parse(await fsp.readFile(side, 'utf8')) as { hash: string; bytes: number };
      const st = await fsp.stat(part);
      if (s.hash === r.hash && st.size >= s.bytes) done = s.bytes;
    } catch {
      /* nothing to resume */
    }
    const fh = await fsp.open(part, done ? 'r+' : 'w');
    const whole = createHash('sha256');
    // How far the copy got with every piece checked: what a later round resumes from.
    let good = done;
    try {
      if (done) {
        // Re-hash what is already there so the final check covers the whole file.
        const buf = Buffer.alloc(Math.min(done, 4 << 20));
        for (let at = 0; at < done; ) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, done - at), at);
          whole.update(buf.subarray(0, bytesRead));
          at += bytesRead;
        }
      }
      let offset = 0;
      let sinceSave = 0;
      for (const b of r.blocks) {
        if (offset + b.size <= done) {
          offset += b.size;
          continue;
        }
        let data = await this.readLocalBlock(b.hash, r.path);
        if (!data) {
          const res = await rpc.call('block', { folder: this.cfg.id, hash: b.hash, hint: r.path });
          data = res.body;
          if (sha256(data) !== b.hash) throw new Error('a piece arrived damaged');
          round.bytes += data.length;
          await this.deps.throttle?.(data.length);
        }
        await fh.write(data, 0, data.length, offset);
        whole.update(data);
        offset += data.length;
        good = offset;
        sinceSave += data.length;
        if (sinceSave >= 4 << 20) {
          sinceSave = 0;
          await fsp.writeFile(side, JSON.stringify({ hash: r.hash, bytes: offset }));
        }
        this.deps.onProgress?.({ folderId: this.cfg.id, peer, file: r.path, done: offset, total: r.size, queued });
      }
      await fh.truncate(offset);
    } catch (e) {
      await fh.sync().catch(() => undefined);
      await fsp.writeFile(side, JSON.stringify({ hash: r.hash, bytes: good })).catch(() => undefined);
      throw e;
    } finally {
      await fh.close();
    }
    if (whole.digest('hex') !== r.hash) {
      await fsp.rm(part, { force: true });
      await fsp.rm(side, { force: true });
      throw new Error('the copy did not match; it will be fetched again');
    }
    if (process.platform !== 'win32') await fsp.chmod(part, r.mode & 0o777).catch(() => undefined);
    await fsp.utimes(part, new Date(), new Date(r.mtime)).catch(() => undefined);
    if (versionOld) await archive(root, dest, this.cfg.versioning, this.now());
    await fsp.rename(part, target);
    await fsp.rm(side, { force: true });
  }
}
