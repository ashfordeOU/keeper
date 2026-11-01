// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick notes and to-dos kept by the Island on this computer.

export interface QuickNote {
  id: string;
  text: string;
  created: number;
  updated: number;
  pinned?: boolean;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  starred: boolean;
  created: number;
  doneAt?: number;
}

export interface Script {
  id: string;
  title: string;
  text: string;
  updated: number;
}

export interface IslandToolsStore {
  notes: QuickNote[];
  todos: Todo[];
  scripts: Script[];
  stocks: string[];
  emojiRecent: string[];
}

export const emptyStore = (): IslandToolsStore => ({ notes: [], todos: [], scripts: [], stocks: ['AAPL', 'MSFT', 'BTC'], emojiRecent: [] });

export function normalizeStore(x: unknown): IslandToolsStore {
  const o = (x ?? {}) as Partial<IslandToolsStore>;
  const base = emptyStore();
  return {
    notes: Array.isArray(o.notes) ? o.notes.filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string') : base.notes,
    todos: Array.isArray(o.todos) ? o.todos.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string') : base.todos,
    scripts: Array.isArray(o.scripts) ? o.scripts.filter((s) => s && typeof s.id === 'string') : base.scripts,
    stocks: Array.isArray(o.stocks) ? o.stocks.filter((s) => typeof s === 'string').slice(0, 40) : base.stocks,
    emojiRecent: Array.isArray(o.emojiRecent) ? o.emojiRecent.filter((s) => typeof s === 'string').slice(0, 40) : base.emojiRecent,
  };
}

/** The first line, as a title. */
export function noteTitle(n: QuickNote): string {
  const first = n.text.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 80) || 'Empty note';
}

/** Pinned first, then newest. */
export function sortNotes(notes: QuickNote[]): QuickNote[] {
  return [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
}

export function searchNotes(notes: QuickNote[], q: string): QuickNote[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = sortNotes(notes);
  return words.length ? list.filter((n) => words.every((w) => n.text.toLowerCase().includes(w))) : list;
}

/** Starred and open first, then open, then done (newest done first). */
export function sortTodos(todos: Todo[]): Todo[] {
  const rank = (t: Todo) => (t.done ? 2 : t.starred ? 0 : 1);
  return [...todos].sort((a, b) => rank(a) - rank(b) || (a.done ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.created - b.created));
}

/** Upserts by id. */
export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [item, ...list];
  const next = [...list];
  next[i] = item;
  return next;
}
