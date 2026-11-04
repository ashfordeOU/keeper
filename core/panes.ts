// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Side by Side: two folders next to each other, each on this computer or on a
// cloud or server connection, to copy and move between them and to compare
// them. Pure: where each side is (and how it sits in a route), what differs
// between the two, and what a sync would do. Nothing is ever deleted by a
// sync; the main process (electron/services/panes.ts) carries it out.

import { normalizeRemote } from './remote/paths';
import type { RemoteStore, StoreEntry } from './sync/ports';

/** One side: a folder on this computer, or a folder inside a connection. */
export type PaneSpec = { kind: 'local'; path: string } | { kind: 'remote'; id: string; path: string };

/**
 * In a route a side is one string: a local path as it is (it starts with "/",
 * a drive letter or "\\"), or "@<connection id>:<path>" for a connection.
 */
export function encodePane(p: PaneSpec): string {
  return p.kind === 'remote' ? `@${p.id}:${normalizeRemote(p.path)}` : p.path;
}

export function decodePane(s: string | undefined): PaneSpec | null {
  if (!s) return null;
  if (s.startsWith('@')) {
    const i = s.indexOf(':');
    if (i <= 1) return null;
    return { kind: 'remote', id: s.slice(1, i), path: normalizeRemote(s.slice(i + 1)) };
  }
  return { kind: 'local', path: s };
}

/** The Side by Side page for two sides. */
export function panesRoute(left: PaneSpec, right: PaneSpec): { name: 'panes'; arg: string; q: string } {
  return { name: 'panes', arg: encodePane(left), q: encodePane(right) };
}

export const samePane = (a: PaneSpec, b: PaneSpec) => encodePane(a) === encodePane(b);

/** A side's folder one level up, or null at the top. */
export function paneParent(p: PaneSpec, sep = '/'): PaneSpec | null {
  if (p.kind === 'remote') {
    const n = normalizeRemote(p.path);
    if (n === '/') return null;
    return { ...p, path: normalizeRemote(n.slice(0, n.lastIndexOf('/')) || '/') };
  }
  const trimmed = p.path.replace(/[\\/]+$/, '');
  if (!trimmed || /^[A-Za-z]:$/.test(trimmed)) return null;
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0) return null;
  const up = trimmed.slice(0, i);
  if (!up) return { kind: 'local', path: '/' };
  return { kind: 'local', path: /^[A-Za-z]:$/.test(up) ? up + sep : up };
}

/** A folder inside a side. */
export function paneChild(p: PaneSpec, name: string, sep = '/'): PaneSpec {
  if (p.kind === 'remote') return { ...p, path: normalizeRemote(`${p.path}/${name}`) };
  return { kind: 'local', path: p.path.endsWith(sep) || p.path.endsWith('/') ? p.path + name : p.path + sep + name };
}

/** The folder's own name, for titles ("Downloads", or the connection's name at its top). */
export function paneTitle(p: PaneSpec, connectionName?: string): string {
  if (p.kind === 'remote') {
    const base = normalizeRemote(p.path).split('/').filter(Boolean).pop();
    return base ?? connectionName ?? 'Connection';
  }
  return p.path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || p.path;
}

// ---------------------------------------------------------------- compare

/** One thing in a side, by its path inside the compared folder ("Photos/a.jpg"). */
export interface CompareItem {
  rel: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export type DiffState = 'same' | 'left-only' | 'right-only' | 'left-newer' | 'right-newer' | 'different';

export interface DiffRow {
  rel: string;
  isDir: boolean;
  state: DiffState;
  left?: { size: number; mtime: number };
  right?: { size: number; mtime: number };
}

/** What a pair of folders looked like right after Keeper last synced them, so a copy's new date is not taken for a change. */
export type SyncedState = Record<string, { l: { size: number; mtime: number }; r: { size: number; mtime: number } }>;

/** Dates within this of each other count as the same (FAT disks keep 2 seconds, some servers whole seconds). */
export const TIME_SLACK_MS = 2000;

const near = (a: number, b: number, slack: number) => Math.abs(a - b) <= slack;

/**
 * What differs between two folder listings. A folder on one side only is one
 * row (what is inside it comes along when it is copied), so its contents are
 * left out. Folders on both sides are "same": their contents have rows of
 * their own when the listing went inside them.
 */
export function compareFolders(left: CompareItem[], right: CompareItem[], opts: { slackMs?: number; synced?: SyncedState } = {}): DiffRow[] {
  const slack = opts.slackMs ?? TIME_SLACK_MS;
  const L = new Map(left.map((i) => [i.rel, i]));
  const R = new Map(right.map((i) => [i.rel, i]));
  const rows: DiffRow[] = [];
  const oneSided = new Set<string>();
  const insideOneSided = (rel: string) => {
    for (let i = rel.lastIndexOf('/'); i > 0; i = rel.lastIndexOf('/', i - 1)) if (oneSided.has(rel.slice(0, i))) return true;
    return false;
  };
  const keys = [...new Set([...L.keys(), ...R.keys()])].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  for (const rel of keys) {
    if (insideOneSided(rel)) continue;
    const l = L.get(rel);
    const r = R.get(rel);
    const side = (x: CompareItem) => ({ size: x.size, mtime: x.mtime });
    if (l && !r) {
      rows.push({ rel, isDir: l.isDir, state: 'left-only', left: side(l) });
      if (l.isDir) oneSided.add(rel);
      continue;
    }
    if (r && !l) {
      rows.push({ rel, isDir: r.isDir, state: 'right-only', right: side(r) });
      if (r.isDir) oneSided.add(rel);
      continue;
    }
    if (!l || !r) continue;
    if (l.isDir !== r.isDir) {
      // A folder here and a file there with the same name: never replaced automatically.
      rows.push({ rel, isDir: l.isDir, state: 'different', left: side(l), right: side(r) });
      continue;
    }
    if (l.isDir) {
      rows.push({ rel, isDir: true, state: 'same', left: side(l), right: side(r) });
      continue;
    }
    const was = opts.synced?.[rel];
    if (was && was.l.size === l.size && near(was.l.mtime, l.mtime, slack) && was.r.size === r.size && near(was.r.mtime, r.mtime, slack)) {
      rows.push({ rel, isDir: false, state: 'same', left: side(l), right: side(r) });
      continue;
    }
    let state: DiffState;
    if (near(l.mtime, r.mtime, slack)) state = l.size === r.size ? 'same' : 'different';
    else state = l.mtime > r.mtime ? 'left-newer' : 'right-newer';
    rows.push({ rel, isDir: false, state, left: side(l), right: side(r) });
  }
  return rows;
}

export function diffCounts(rows: DiffRow[]): Record<DiffState, number> {
  const out: Record<DiffState, number> = { same: 0, 'left-only': 0, 'right-only': 0, 'left-newer': 0, 'right-newer': 0, different: 0 };
  for (const r of rows) out[r.state]++;
  return out;
}

/** A short word for a row's state, from the left side's point of view or the right's. */
export function diffLabel(state: DiffState): string {
  switch (state) {
    case 'left-only': return 'Only on the left';
    case 'right-only': return 'Only on the right';
    case 'left-newer': return 'Newer on the left';
    case 'right-newer': return 'Newer on the right';
    case 'different': return 'Same date, other size';
    default: return 'The same';
  }
}

// ---------------------------------------------------------------- sync

export type SyncDirection = 'left-to-right' | 'right-to-left' | 'both';

export interface SyncStep {
  /** copy: not there yet; replace: an older copy there is replaced (it goes to the Trash on this computer) */
  op: 'copy' | 'replace';
  from: 'left' | 'right';
  rel: string;
  isDir: boolean;
  /** bytes to send; 0 for a folder (its size is not known before it is walked) */
  bytes: number;
}

export interface SyncPlan {
  steps: SyncStep[];
  /** rows left alone, and why ("newer on the other side", "same date, other size") */
  skipped: { rel: string; why: string }[];
}

/**
 * What a sync in this direction would do. One way: what is missing or older on
 * the other side is copied; what is newer there is left alone. Both ways: the
 * newer copy wins and what is missing on either side is copied. A file whose
 * date is the same but whose size is not is never replaced by guessing.
 * Nothing is ever deleted. `only` limits it to the rows the person ticked.
 */
export function syncPlan(rows: DiffRow[], direction: SyncDirection, only?: Set<string>): SyncPlan {
  const steps: SyncStep[] = [];
  const skipped: SyncPlan['skipped'] = [];
  const toRight = direction !== 'right-to-left';
  const toLeft = direction !== 'left-to-right';
  for (const r of rows) {
    if (r.state === 'same' || (only && !only.has(r.rel))) continue;
    const bytesOf = (s?: { size: number }) => (r.isDir ? 0 : s?.size ?? 0);
    switch (r.state) {
      case 'left-only':
        if (toRight) steps.push({ op: 'copy', from: 'left', rel: r.rel, isDir: r.isDir, bytes: bytesOf(r.left) });
        else skipped.push({ rel: r.rel, why: 'Only on the left' });
        break;
      case 'right-only':
        if (toLeft) steps.push({ op: 'copy', from: 'right', rel: r.rel, isDir: r.isDir, bytes: bytesOf(r.right) });
        else skipped.push({ rel: r.rel, why: 'Only on the right' });
        break;
      case 'left-newer':
        if (toRight) steps.push({ op: 'replace', from: 'left', rel: r.rel, isDir: false, bytes: bytesOf(r.left) });
        else skipped.push({ rel: r.rel, why: 'Newer on the left' });
        break;
      case 'right-newer':
        if (toLeft) steps.push({ op: 'replace', from: 'right', rel: r.rel, isDir: false, bytes: bytesOf(r.right) });
        else skipped.push({ rel: r.rel, why: 'Newer on the right' });
        break;
      case 'different':
        skipped.push({ rel: r.rel, why: r.isDir || r.left?.size === undefined ? 'A folder on one side, a file on the other' : 'Same date, other size: check it yourself' });
        break;
    }
  }
  return { steps, skipped };
}

/** "Copies 4 items, replaces 2 older ones · 12 MB · nothing is deleted" in parts the page can lay out. */
export function planSummary(plan: SyncPlan): { copies: number; replaces: number; bytes: number; skipped: number; toLeft: number; toRight: number } {
  let copies = 0, replaces = 0, bytes = 0, toLeft = 0, toRight = 0;
  for (const s of plan.steps) {
    if (s.op === 'copy') copies++;
    else replaces++;
    bytes += s.bytes;
    if (s.from === 'left') toRight++;
    else toLeft++;
  }
  return { copies, replaces, bytes, skipped: plan.skipped.length, toLeft, toRight };
}

/** After a step is done: the state both sides are now in, for the next compare. */
export function rememberSynced(state: SyncedState, rel: string, l: { size: number; mtime: number }, r: { size: number; mtime: number }): SyncedState {
  return { ...state, [rel]: { l, r } };
}

/** Pairs remembered (by their two sides); the oldest go when there are too many. */
export function pairKey(a: PaneSpec, b: PaneSpec): string {
  return `${encodePane(a)}\u0000${encodePane(b)}`;
}

// ---------------------------------------------------------------- walking a side

/** A store whose top is a folder inside another store (a connection's subfolder, say). */
export function rootedStore(store: RemoteStore, base: string): RemoteStore {
  const b = base.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const inner = (p: string) => {
    const rel = p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (rel.split('/').some((x) => x === '..')) throw new Error('path escapes the folder');
    return b ? (rel ? `${b}/${rel}` : b) : rel;
  };
  const outer = (p: string) => (b && p.startsWith(b + '/') ? p.slice(b.length + 1) : p === b ? '' : p);
  const back = (e: StoreEntry): StoreEntry => ({ ...e, path: outer(e.path) });
  return {
    label: store.label,
    list: async (d) => (await store.list(inner(d))).map(back),
    stat: async (p) => {
      const e = await store.stat(inner(p));
      return e ? back(e) : null;
    },
    get: async (p, range) => store.get(inner(p), range),
    put: async (p, data) => store.put(inner(p), data),
    delete: async (p) => store.delete(inner(p)),
    rename: async (a, c) => store.rename(inner(a), inner(c)),
    mkdir: async (p) => store.mkdir(inner(p)),
    putFile: store.putFile ? async (p, f) => store.putFile!(inner(p), f) : undefined,
    getFile: store.getFile ? async (p, f) => store.getFile!(inner(p), f) : undefined,
  };
}

/** Names never compared or copied: system clutter and Keeper's own working files. */
const CLUTTER = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes|\.fseventsd|\$RECYCLE\.BIN|\.keeper-versions|\.keeper-sync)$|\.keeper-part(\.json)?$|\.part$/i;

/**
 * Everything in a side, by path inside it: the folder itself only, or (deep)
 * the folders inside it too, up to `limit` items. `truncated` says the limit
 * was reached, so the page can say the comparison is partial.
 */
export async function walkSide(store: RemoteStore, opts: { deep: boolean; hidden: boolean; limit?: number; signal?: { aborted: boolean } }): Promise<{ items: CompareItem[]; truncated: boolean }> {
  const limit = opts.limit ?? 20_000;
  const items: CompareItem[] = [];
  let truncated = false;
  const walk = async (dir: string) => {
    const list = await store.list(dir);
    list.sort((a, b) => a.path.localeCompare(b.path));
    const subdirs: string[] = [];
    for (const e of list) {
      const name = e.path.split('/').pop() ?? e.path;
      if (CLUTTER.test(name) || (!opts.hidden && name.startsWith('.'))) continue;
      if (items.length >= limit) {
        truncated = true;
        return;
      }
      items.push({ rel: e.path.replace(/^\/+/, ''), isDir: e.isDir, size: e.isDir ? 0 : e.size, mtime: Math.trunc(e.mtime) });
      if (e.isDir) subdirs.push(e.path);
    }
    if (!opts.deep) return;
    for (const d of subdirs) {
      if (opts.signal?.aborted || truncated) return;
      await walk(d);
    }
  };
  await walk('');
  return { items, truncated };
}

// ---------------------------------------------------------------- the interface ↔ main-process contract

/** Sides travel as their route strings (encodePane). */
export interface PanesApi {
  /** what differs between the two sides (rows that are the same are left out, except files) */
  compare(left: string, right: string, opts?: { deep?: boolean; hidden?: boolean }): Promise<{ rows: DiffRow[]; truncated: boolean; counts: Record<DiffState, number> }>;
  /** copies or moves names (paths inside `from`) into `to`, when a connection is one of the two */
  copy(from: string, to: string, names: string[], move?: boolean): Promise<{ done: number; failed: string[] }>;
  /** syncs after a fresh look; never deletes */
  sync(left: string, right: string, direction: SyncDirection, opts?: { deep?: boolean; hidden?: boolean; only?: string[] }): Promise<{ done: number; failed: string[] }>;
}

/** ⌘T / Ctrl+T: on a folder (here, on a connection, or side by side) the new tab opens the same place, as file managers do; elsewhere Hello. */
export function newTabRoute(cur: { name: string; arg?: string; q?: string } | undefined): { name: string; arg?: string; q?: string } {
  if (cur && (cur.name === 'browse' || cur.name === 'panes' || (cur.name === 'remote' && cur.arg))) return { name: cur.name, arg: cur.arg, q: cur.q };
  return { name: 'home' };
}
