// SPDX-License-Identifier: AGPL-3.0-or-later
// Mirroring: the same files, as ordinary files, in a folder here and a folder
// on a cloud service or drive — so they also show in the service's own app or
// web page. One way (this computer → there, or there → here) or both ways.
// What the last run saw is remembered, so a change on either side is told
// apart from a deletion, and nothing is deleted that changed meanwhile.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { conflictName } from './folder';
import { IgnoreMatcher } from './ignore';
import type { RemoteStore, StoreEntry } from './ports';
import { archive, type VersionPolicy } from './versions';

export type MirrorDirection = 'up' | 'down' | 'both';

export interface MirrorState {
  /** what both sides looked like after the last run */
  files: Record<string, { lsize: number; lmtime: number; rsize: number; rmtime: number }>;
}

export interface MirrorResult {
  uploaded: string[];
  downloaded: string[];
  deletedHere: string[];
  deletedThere: string[];
  conflicts: string[];
  failed: { path: string; why: string }[];
}

interface Side {
  size: number;
  mtime: number;
}

async function localFiles(root: string, ignore: IgnoreMatcher): Promise<Map<string, Side>> {
  const out = new Map<string, Side>();
  const walk = async (dir: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!ignore.ignored(rel, true)) await walk(abs);
      } else if (e.isFile() && !ignore.ignored(rel)) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.set(rel, { size: st.size, mtime: Math.trunc(st.mtimeMs) });
      }
    }
  };
  await walk(root);
  return out;
}

async function remoteFiles(store: RemoteStore, dir: string, ignore: IgnoreMatcher): Promise<Map<string, Side>> {
  const out = new Map<string, Side>();
  const base = dir.replace(/^\/+|\/+$/g, '');
  const walk = async (d: string) => {
    for (const e of await store.list(d).catch(() => [] as StoreEntry[])) {
      const rel = base ? e.path.slice(base.length + 1) : e.path;
      if (e.isDir) {
        if (!ignore.ignored(rel, true)) await walk(e.path);
      } else if (!ignore.ignored(rel)) out.set(rel, { size: e.size, mtime: Math.trunc(e.mtime) });
    }
  };
  await walk(base);
  return out;
}

/**
 * One run. Local deletions and replacements go to the folder's versions;
 * deletions over there go to the service's own trash where it has one.
 */
export async function mirror(
  localRoot: string,
  store: RemoteStore,
  remoteDir: string,
  direction: MirrorDirection,
  state: MirrorState,
  opts: { ignore?: string[]; versioning?: VersionPolicy; deviceName?: string; signal?: AbortSignal; onFile?: (rel: string, done: number, total: number) => void } = {},
): Promise<MirrorResult> {
  const ignore = new IgnoreMatcher(opts.ignore ?? []);
  const versioning = opts.versioning ?? { type: 'trashcan', days: 30 };
  const R = (rel: string) => (remoteDir.replace(/^\/+|\/+$/g, '') ? `${remoteDir.replace(/^\/+|\/+$/g, '')}/${rel}` : rel);
  const L = (rel: string) => path.join(localRoot, ...rel.split('/'));
  const res: MirrorResult = { uploaded: [], downloaded: [], deletedHere: [], deletedThere: [], conflicts: [], failed: [] };
  await fsp.mkdir(localRoot, { recursive: true });
  const local = await localFiles(localRoot, ignore);
  const remote = await remoteFiles(store, remoteDir, ignore);
  const all = [...new Set([...local.keys(), ...remote.keys(), ...Object.keys(state.files)])].sort();
  const total = all.length;
  let done = 0;

  const upload = async (rel: string) => {
    if (store.putFile) await store.putFile(R(rel), L(rel));
    else await store.put(R(rel), await fsp.readFile(L(rel)));
    const st = await store.stat(R(rel));
    return { size: st?.size ?? 0, mtime: Math.trunc(st?.mtime ?? 0) };
  };
  const download = async (rel: string, to = rel) => {
    const dest = L(to);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.keeper-part`;
    if (store.getFile) await store.getFile(R(rel), tmp);
    else await fsp.writeFile(tmp, await store.get(R(rel)));
    if (to === rel) await archive(localRoot, rel, versioning);
    await fsp.rename(tmp, dest);
    const st = await fsp.stat(dest);
    return { size: st.size, mtime: Math.trunc(st.mtimeMs) };
  };

  for (const rel of all) {
    if (opts.signal?.aborted) break;
    opts.onFile?.(rel, ++done, total);
    const l = local.get(rel);
    const r = remote.get(rel);
    const s = state.files[rel];
    const lChanged = !!l && (!s || l.size !== s.lsize || l.mtime !== s.lmtime);
    const rChanged = !!r && (!s || r.size !== s.rsize || r.mtime !== s.rmtime);
    const lGone = !l && !!s;
    const rGone = !r && !!s;
    try {
      if (!l && !r) {
        delete state.files[rel];
        continue;
      }
      const up = direction !== 'down';
      const down = direction !== 'up';
      if (l && !r) {
        if (rGone && down && !lChanged) {
          // Deleted over there, untouched here.
          await archive(localRoot, rel, versioning);
          delete state.files[rel];
          res.deletedHere.push(rel);
        } else if (up) {
          const rs = await upload(rel);
          state.files[rel] = { lsize: l.size, lmtime: l.mtime, rsize: rs.size, rmtime: rs.mtime };
          res.uploaded.push(rel);
        }
        continue;
      }
      if (!l && r) {
        if (lGone && up && !rChanged) {
          await store.delete(R(rel));
          delete state.files[rel];
          res.deletedThere.push(rel);
        } else if (down) {
          const ls = await download(rel);
          state.files[rel] = { lsize: ls.size, lmtime: ls.mtime, rsize: r.size, rmtime: r.mtime };
          res.downloaded.push(rel);
        }
        continue;
      }
      // Both sides have it.
      if (!lChanged && !rChanged) continue;
      if (lChanged && rChanged && l!.size === r!.size && !s) {
        // First run with the same file on both sides: take it as equal.
        state.files[rel] = { lsize: l!.size, lmtime: l!.mtime, rsize: r!.size, rmtime: r!.mtime };
        continue;
      }
      if (lChanged && (!rChanged || direction === 'up')) {
        if (!up) continue;
        const rs = await upload(rel);
        state.files[rel] = { lsize: l!.size, lmtime: l!.mtime, rsize: rs.size, rmtime: rs.mtime };
        res.uploaded.push(rel);
      } else if (rChanged && (!lChanged || direction === 'down')) {
        if (!down) continue;
        const ls = await download(rel);
        state.files[rel] = { lsize: ls.size, lmtime: ls.mtime, rsize: r!.size, rmtime: r!.mtime };
        res.downloaded.push(rel);
      } else {
        // Changed on both sides: theirs is kept here as a conflict copy, ours goes up.
        const copy = conflictName(rel, 'cloud', Date.now());
        await download(rel, copy);
        const rs = await upload(rel);
        state.files[rel] = { lsize: l!.size, lmtime: l!.mtime, rsize: rs.size, rmtime: rs.mtime };
        res.conflicts.push(copy);
      }
    } catch (e) {
      res.failed.push({ path: rel, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
