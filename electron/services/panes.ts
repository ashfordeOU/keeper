// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Side by Side (core/panes.ts): compares two folders, each on this computer or
// on a connection, syncs them after a preview, and copies or moves between
// them when a connection is involved (two local folders use the usual copy
// and move with its questions and Undo, src/fileops.tsx). Nothing is deleted
// by a sync; a replaced file on this computer goes to the Trash first.

import { app, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareFolders, decodePane, diffCounts, pairKey, rootedStore, syncPlan, walkSide, type DiffRow, type PaneSpec, type SyncDirection, type SyncedState } from '../../core/panes';
import { FolderStore, type RemoteStore } from '../../core/sync/ports';
import { connectionFs, list as listConnections } from './remote';
import { storeFromRemoteFs } from './sync/remote-adapter';

type Broadcast = (channel: string, ...args: unknown[]) => void;
let broadcast: Broadcast = () => undefined;

export function initPanes(b: Broadcast) {
  broadcast = b;
}

async function storeFor(p: PaneSpec): Promise<RemoteStore> {
  if (p.kind === 'local') return new FolderStore(p.path);
  const c = listConnections().connections.find((x) => x.id === p.id);
  if (!c) throw new Error('That connection no longer exists');
  return rootedStore(storeFromRemoteFs(await connectionFs(p.id), c.name), p.path);
}

function spec(s: string): PaneSpec {
  const p = decodePane(s);
  if (!p) throw new Error('Not a folder Keeper knows');
  return p;
}

// ---------------------------------------------------------------- what Keeper last synced, per pair

const syncedFile = () => path.join(app.getPath('userData'), 'panes-synced.json');
let synced: Record<string, { at: number; files: SyncedState }> | null = null;

async function loadSynced() {
  if (synced) return synced;
  try {
    synced = JSON.parse(await fsp.readFile(syncedFile(), 'utf8'));
  } catch {
    synced = {};
  }
  return synced!;
}

async function saveSynced() {
  if (!synced) return;
  // At most 40 pairs; the ones synced longest ago go first.
  const keep = Object.entries(synced).sort((a, b) => b[1].at - a[1].at).slice(0, 40);
  synced = Object.fromEntries(keep);
  await fsp.writeFile(syncedFile(), JSON.stringify(synced), { mode: 0o600 }).catch(() => undefined);
}

// ---------------------------------------------------------------- compare

export async function compare(left: string, right: string, opts: { deep?: boolean; hidden?: boolean } = {}): Promise<{ rows: DiffRow[]; truncated: boolean; counts: ReturnType<typeof diffCounts> }> {
  const [L, R] = [spec(left), spec(right)];
  const [ls, rs] = await Promise.all([storeFor(L), storeFor(R)]);
  const walkOpts = { deep: opts.deep !== false, hidden: !!opts.hidden };
  const [a, b] = await Promise.all([walkSide(ls, walkOpts), walkSide(rs, walkOpts)]);
  const state = (await loadSynced())[pairKey(L, R)]?.files;
  const rows = compareFolders(a.items, b.items, { synced: state });
  return { rows: rows.filter((r) => r.state !== 'same' || !r.isDir), truncated: a.truncated || b.truncated, counts: diffCounts(rows) };
}

// ---------------------------------------------------------------- copying one thing between two stores

const tmpFile = () => path.join(os.tmpdir(), `keeper-pane-${randomBytes(6).toString('hex')}`);

async function copyFile(src: RemoteStore, dst: RemoteStore, from: string, to: string, srcSpec: PaneSpec, dstSpec: PaneSpec, mtime?: number): Promise<void> {
  // A file on this computer is read where it is; anything else is fetched to a temporary file first.
  const localSrc = srcSpec.kind === 'local' ? path.join(srcSpec.path, ...from.split('/')) : null;
  const tmp = localSrc ? null : tmpFile();
  try {
    if (tmp) {
      if (src.getFile) await src.getFile(from, tmp);
      else await fsp.writeFile(tmp, await src.get(from));
    }
    const file = localSrc ?? tmp!;
    if (dst.putFile) await dst.putFile(to, file);
    else await dst.put(to, await fsp.readFile(file));
    // On this computer the copy keeps the original's date, so the next compare sees them as the same.
    if (dstSpec.kind === 'local' && mtime) {
      const t = new Date(mtime);
      await fsp.utimes(path.join(dstSpec.path, ...to.split('/')), t, t).catch(() => undefined);
    }
  } finally {
    if (tmp) await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Copies a folder and what is inside it. Returns how many files went. */
async function copyTree(src: RemoteStore, dst: RemoteStore, from: string, to: string, srcSpec: PaneSpec, dstSpec: PaneSpec, onFile: (rel: string, src: { size: number; mtime: number }) => Promise<void> | void): Promise<number> {
  await dst.mkdir(to);
  let n = 0;
  for (const e of await src.list(from)) {
    const name = e.path.split('/').pop()!;
    const target = to ? `${to}/${name}` : name;
    if (e.isDir) n += await copyTree(src, dst, e.path, target, srcSpec, dstSpec, onFile);
    else {
      await copyFile(src, dst, e.path, target, srcSpec, dstSpec, e.mtime);
      await onFile(target, { size: e.size, mtime: Math.trunc(e.mtime) });
      n++;
    }
  }
  return n;
}

/** A name not yet taken in the folder: "Report 2.pdf", "Report 3.pdf"… */
async function freeName(dst: RemoteStore, rel: string): Promise<string> {
  if (!(await dst.stat(rel))) return rel;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const base = rel.slice(dir.length);
  const dot = base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  for (let i = 2; i < 1000; i++) {
    const cand = `${dir}${stem} ${i}${ext}`;
    if (!(await dst.stat(cand))) return cand;
  }
  return `${dir}${stem} ${Date.now()}${ext}`;
}

async function trashLocal(p: string) {
  await shell.trashItem(p);
}

/**
 * Copies (or moves) items from one side to the other when a connection is
 * involved. A file whose name is already there is kept beside it with a
 * number; a folder already there is filled in. A move removes the original
 * only after its copy is done: to the Trash on this computer, to the
 * service's own trash where it has one.
 */
export async function copy(from: string, to: string, names: string[], move = false): Promise<{ done: number; failed: string[] }> {
  const [S, D] = [spec(from), spec(to)];
  const [src, dst] = await Promise.all([storeFor(S), storeFor(D)]);
  const failed: string[] = [];
  let done = 0;
  const total = names.length;
  const task = D.kind === 'remote' ? 'upload' : 'download';
  for (const [i, name] of names.entries()) {
    broadcast('progress', { task, phase: `${move ? 'Moving' : 'Copying'} ${name}`, done: i, total });
    try {
      const st = await src.stat(name);
      if (!st) throw new Error('It is no longer there');
      if (st.isDir) {
        await copyTree(src, dst, name, name, S, D, () => undefined);
      } else {
        await copyFile(src, dst, name, await freeName(dst, name), S, D, st.mtime);
      }
      if (move) {
        if (S.kind === 'local') await trashLocal(path.join(S.path, ...name.split('/')));
        else await src.delete(name);
      }
      done++;
    } catch (e) {
      failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  broadcast('progress', { task, phase: 'Done', done: total, total });
  broadcast('remote-changed');
  return { done, failed };
}

// ---------------------------------------------------------------- sync

/** Syncs the two sides in one direction or both, after the person saw the plan. Only the ticked rows when `only` is given. */
export async function sync(left: string, right: string, direction: SyncDirection, opts: { deep?: boolean; hidden?: boolean; only?: string[] } = {}): Promise<{ done: number; failed: string[] }> {
  const [L, R] = [spec(left), spec(right)];
  const [ls, rs] = await Promise.all([storeFor(L), storeFor(R)]);
  const walkOpts = { deep: opts.deep !== false, hidden: !!opts.hidden };
  const [a, b] = await Promise.all([walkSide(ls, walkOpts), walkSide(rs, walkOpts)]);
  const all = await loadSynced();
  const key = pairKey(L, R);
  const state: SyncedState = { ...(all[key]?.files ?? {}) };
  // The plan is made again here from a fresh look, never trusted from the page.
  const plan = syncPlan(compareFolders(a.items, b.items, { synced: state }), direction, opts.only ? new Set(opts.only) : undefined);
  const failed: string[] = [];
  let done = 0;
  const total = plan.steps.length;
  for (const [i, s] of plan.steps.entries()) {
    broadcast('progress', { task: 'sync', phase: s.rel, done: i, total });
    const [src, dst, srcSpec, dstSpec] = s.from === 'left' ? [ls, rs, L, R] : [rs, ls, R, L];
    try {
      const remember = async (rel: string, mine: { size: number; mtime: number }) => {
        const after = await dst.stat(rel);
        if (!after) return;
        const theirs = { size: after.size, mtime: Math.trunc(after.mtime) };
        state[rel] = s.from === 'left' ? { l: mine, r: theirs } : { l: theirs, r: mine };
      };
      if (s.isDir) {
        await copyTree(src, dst, s.rel, s.rel, srcSpec, dstSpec, remember);
      } else {
        const st = await src.stat(s.rel);
        if (!st) throw new Error('It is no longer there');
        if (s.op === 'replace' && dstSpec.kind === 'local') await trashLocal(path.join(dstSpec.path, ...s.rel.split('/')));
        await copyFile(src, dst, s.rel, s.rel, srcSpec, dstSpec, st.mtime);
        await remember(s.rel, { size: st.size, mtime: Math.trunc(st.mtime) });
      }
      done++;
    } catch (e) {
      failed.push(`${s.rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  all[key] = { at: Date.now(), files: state };
  await saveSynced();
  broadcast('progress', { task: 'sync', phase: 'Done', done: total, total });
  broadcast('remote-changed');
  return { done, failed };
}

export const panesApi = { compare, copy, sync };
