// SPDX-License-Identifier: AGPL-3.0-or-later
// Named shelves: places to park files on the way somewhere else. Pure state
// changes, so the Island, the tray and the tests share one set of rules.

export interface Shelf {
  id: string;
  name: string;
  color: string;
  /** file paths, in the order the user arranged them */
  items: string[];
  pinned?: boolean;
  createdAt: number;
}

export interface ShelfStore {
  shelves: Shelf[];
  /** id of the shelf the Island shows */
  active: string;
  /** recently closed shelves, newest first, so a close can be undone */
  closed: Shelf[];
}

export const SHELF_COLORS = ['#8b8bff', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a78bfa', '#2dd4bf'];
const MAX_CLOSED = 10;

let counter = 0;
const newId = () => `sh${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newStore(now = Date.now()): ShelfStore {
  const first: Shelf = { id: 'main', name: 'Shelf', color: SHELF_COLORS[0], items: [], createdAt: now };
  return { shelves: [first], active: first.id, closed: [] };
}

/** Repairs a store read from disk; anything malformed falls back to defaults. */
export function normalizeStore(raw: unknown, now = Date.now()): ShelfStore {
  const r = raw as Partial<ShelfStore> | undefined;
  const ok = (s: unknown): s is Shelf => !!s && typeof (s as Shelf).id === 'string' && Array.isArray((s as Shelf).items);
  const shelves = Array.isArray(r?.shelves) ? r!.shelves.filter(ok) : [];
  if (!shelves.length) return newStore(now);
  const active = shelves.some((s) => s.id === r?.active) ? r!.active! : shelves[0].id;
  return { shelves, active, closed: Array.isArray(r?.closed) ? r!.closed.filter(ok).slice(0, MAX_CLOSED) : [] };
}

const mapShelf = (st: ShelfStore, id: string, fn: (s: Shelf) => Shelf): ShelfStore => ({ ...st, shelves: st.shelves.map((s) => (s.id === id ? fn(s) : s)) });

export function activeShelf(st: ShelfStore): Shelf {
  return st.shelves.find((s) => s.id === st.active) ?? st.shelves[0];
}

export function createShelf(st: ShelfStore, name?: string, now = Date.now()): { store: ShelfStore; shelf: Shelf } {
  const shelf: Shelf = { id: newId(), name: name?.trim() || `Shelf ${st.shelves.length + 1}`, color: SHELF_COLORS[st.shelves.length % SHELF_COLORS.length], items: [], createdAt: now };
  return { store: { ...st, shelves: [...st.shelves, shelf], active: shelf.id }, shelf };
}

export function renameShelf(st: ShelfStore, id: string, name: string): ShelfStore {
  const n = name.trim();
  return n ? mapShelf(st, id, (s) => ({ ...s, name: n.slice(0, 60) })) : st;
}

export function setShelfColor(st: ShelfStore, id: string, color: string): ShelfStore {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? mapShelf(st, id, (s) => ({ ...s, color })) : st;
}

export function togglePin(st: ShelfStore, id: string): ShelfStore {
  return mapShelf(st, id, (s) => ({ ...s, pinned: !s.pinned }));
}

/** Closing keeps the shelf in "recently closed"; the last shelf is emptied instead of removed. */
export function closeShelf(st: ShelfStore, id: string): ShelfStore {
  const shelf = st.shelves.find((s) => s.id === id);
  if (!shelf) return st;
  const closed = shelf.items.length ? [shelf, ...st.closed.filter((c) => c.id !== id)].slice(0, MAX_CLOSED) : st.closed;
  if (st.shelves.length === 1) return { shelves: [{ ...shelf, items: [] }], active: shelf.id, closed };
  const shelves = st.shelves.filter((s) => s.id !== id);
  return { shelves, active: st.active === id ? shelves[0].id : st.active, closed };
}

export function reopenShelf(st: ShelfStore, id: string): ShelfStore {
  const shelf = st.closed.find((c) => c.id === id);
  if (!shelf) return st;
  const closed = st.closed.filter((c) => c.id !== id);
  // An empty default shelf is simply replaced.
  const shelves = st.shelves.length === 1 && !st.shelves[0].items.length ? [shelf] : [...st.shelves.filter((s) => s.id !== id), shelf];
  return { shelves, active: shelf.id, closed };
}

export function addItems(st: ShelfStore, paths: string[], id = st.active): ShelfStore {
  return mapShelf(st, id, (s) => ({ ...s, items: [...s.items, ...paths.filter((p, i) => p && !s.items.includes(p) && paths.indexOf(p) === i)] }));
}

export function removeItem(st: ShelfStore, path: string, id = st.active): ShelfStore {
  return mapShelf(st, id, (s) => ({ ...s, items: s.items.filter((p) => p !== path) }));
}

export function clearShelf(st: ShelfStore, id = st.active): ShelfStore {
  return mapShelf(st, id, (s) => ({ ...s, items: [] }));
}

/** Moves an item to a new position within its shelf. */
export function moveItem(st: ShelfStore, from: number, to: number, id = st.active): ShelfStore {
  return mapShelf(st, id, (s) => {
    if (from < 0 || from >= s.items.length) return s;
    const items = [...s.items];
    const [it] = items.splice(from, 1);
    items.splice(Math.max(0, Math.min(items.length, to)), 0, it);
    return { ...s, items };
  });
}

/** After a file is renamed or moved, every shelf follows it. */
export function renamePath(st: ShelfStore, from: string, to: string): ShelfStore {
  const fix = (s: Shelf) => ({ ...s, items: s.items.map((p) => (p === from ? to : p)) });
  return { ...st, shelves: st.shelves.map(fix), closed: st.closed.map(fix) };
}

/** Drops paths that no longer exist. */
export function prune(st: ShelfStore, exists: (p: string) => boolean): ShelfStore {
  const fix = (s: Shelf) => ({ ...s, items: s.items.filter(exists) });
  return { ...st, shelves: st.shelves.map(fix), closed: st.closed.map(fix).filter((s) => s.items.length) };
}

/** Fills {files} (quoted, space separated), {file} (first) and {dir} in a user command template. */
export function fillCommand(template: string, paths: string[], quote: (s: string) => string): string {
  const dir = paths[0] ? paths[0].replace(/[\\/][^\\/]*$/, '') : '';
  return template
    .replace(/\{files\}/g, paths.map(quote).join(' '))
    .replace(/\{file\}/g, paths[0] ? quote(paths[0]) : '')
    .replace(/\{dir\}/g, dir ? quote(dir) : '');
}

export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const winQuote = (s: string) => `"${s.replace(/"/g, '""')}"`;
