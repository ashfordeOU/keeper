// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What a synced folder holds, file by file: size, date, the pieces it is made
// of and who changed it last. Scanning compares the disk with this record and
// notes every change with the device's own counter.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { chunkFile, SYNC_CHUNKS, type ChunkParams } from './chunker';
import { IgnoreMatcher } from './ignore';
import { bumpVV, type VersionVector } from './vv';

export interface BlockRef {
  hash: string;
  size: number;
}

export interface FileRecord {
  /** relative, forward slashes */
  path: string;
  size: number;
  mtime: number;
  /** permission bits (only the executable bit is carried between systems) */
  mode: number;
  /** SHA-256 of the whole file ('' once deleted) */
  hash: string;
  blocks: BlockRef[];
  deleted: boolean;
  version: VersionVector;
  /** the device that made the last change */
  by: string;
  /** this device's counter when the record last changed here */
  seq: number;
  /** the last change was made on this device (receive-only folders keep these to themselves) */
  local: boolean;
}

export interface FolderState {
  folderId: string;
  device: string;
  /** grows with every change recorded here */
  seq: number;
  files: Record<string, FileRecord>;
  /** how far we have read each device's changes */
  peers: Record<string, { seq: number; at: number }>;
}

export function emptyState(folderId: string, device: string): FolderState {
  return { folderId, device, seq: 0, files: {}, peers: {} };
}

export const toRel = (p: string) => p.split(path.sep).join('/');

export interface ScanResult {
  changed: string[];
  /** files still being written; scanned again next time */
  busy: string[];
  scanned: number;
}

/** Files changed in the last moment may still be being written. */
const SETTLE_MS = 1500;

/**
 * Brings `state` in line with the disk. Unchanged files (same size, date and
 * permissions) are not read again; a file whose date changed but whose bytes
 * did not keeps its version.
 */
export async function scanFolder(
  root: string,
  state: FolderState,
  opts: { ignore?: IgnoreMatcher; params?: ChunkParams; signal?: AbortSignal; now?: number; onFile?: (rel: string) => void | Promise<void> } = {},
): Promise<ScanResult> {
  const ignore = opts.ignore ?? new IgnoreMatcher();
  const now = opts.now ?? Date.now();
  const seen = new Set<string>();
  const out: ScanResult = { changed: [], busy: [], scanned: 0 };
  const walk = async (dir: string) => {
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      if (opts.signal?.aborted) throw new Error('cancelled');
      const abs = path.join(dir, e.name);
      const rel = toRel(path.relative(root, abs));
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!ignore.ignored(rel, true)) await walk(abs);
        continue;
      }
      if (!e.isFile() || ignore.ignored(rel, false)) continue;
      seen.add(rel);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      out.scanned++;
      const prev = state.files[rel];
      const mode = st.mode & 0o777;
      if (prev && !prev.deleted && prev.size === st.size && Math.trunc(prev.mtime) === Math.trunc(st.mtimeMs) && prev.mode === mode) continue;
      if (now - st.mtimeMs < SETTLE_MS) {
        out.busy.push(rel);
        if (prev && !prev.deleted) continue;
        // A brand-new file still being written waits for the next look.
        seen.delete(rel);
        continue;
      }
      await opts.onFile?.(rel);
      const { chunks, hash, size } = await chunkFile(abs, opts.params ?? SYNC_CHUNKS, undefined, opts.signal);
      if (prev && !prev.deleted && prev.hash === hash && prev.mode === mode) {
        // Touched, not changed.
        state.files[rel] = { ...prev, mtime: st.mtimeMs };
        continue;
      }
      state.seq++;
      state.files[rel] = {
        path: rel, size, mtime: st.mtimeMs, mode, hash,
        blocks: chunks.map((c) => ({ hash: c.hash, size: c.size })),
        deleted: false, version: bumpVV(prev?.version ?? {}, state.device), by: state.device, seq: state.seq, local: true,
      };
      out.changed.push(rel);
    }
  };
  await walk(root);
  for (const r of Object.values(state.files)) {
    if (r.deleted || seen.has(r.path) || out.busy.includes(r.path)) continue;
    // Gone from disk (and not because it is now ignored): record the deletion.
    if (ignore.ignored(r.path, false)) continue;
    state.seq++;
    state.files[r.path] = { ...r, size: 0, hash: '', blocks: [], deleted: true, mtime: now, version: bumpVV(r.version, state.device), by: state.device, seq: state.seq, local: true };
    out.changed.push(r.path);
  }
  return out;
}

/** Records changed since `since`, as another device asks for them. Receive-only folders keep their own edits back. */
export function changesSince(state: FolderState, since: number, opts: { hideLocal?: boolean } = {}): FileRecord[] {
  return Object.values(state.files)
    .filter((r) => r.seq > since && !(opts.hideLocal && r.local))
    .sort((a, b) => a.seq - b.seq);
}

/** "Holiday (conflict, Anna's laptop, 2026-10-31 14.05).jpg" */
export function conflictName(rel: string, deviceName: string, when: number): string {
  const d = new Date(when);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const base = rel.slice(dir.length);
  const dot = base.lastIndexOf('.');
  const [name, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  const who = deviceName.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
  return `${dir}${name} (conflict, ${who}, ${stamp})${ext}`;
}

export const isConflictName = (rel: string) => / \(conflict, [^)]*\)(\.[^./]*)?$/.test(rel);
