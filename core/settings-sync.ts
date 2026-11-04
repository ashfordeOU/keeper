// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings that follow you between your computers, over Keeper Link (end to
// end encrypted, no server): typed snippets, themes and the look, Quick Search
// links and commands, Automations, saved searches and the mode. Each item
// (one snippet, one link, one rule, one look setting) carries when and where
// it last changed; the newest wins, and what it replaced goes to "Older
// versions". Never secrets, and never a path that only exists on one computer:
// paths in your home folder travel as "~/…" and come back under the other
// computer's home folder; any other path stays behind.

import { createHash } from 'node:crypto';

export type SyncCategory = 'snippets' | 'look' | 'launcher' | 'rules' | 'searches' | 'mode';

export const SYNC_CATEGORIES: { id: SyncCategory; label: string; hint: string }[] = [
  { id: 'snippets', label: 'Typed snippets', hint: 'What you type and what it becomes' },
  { id: 'look', label: 'Themes and look', hint: 'Theme, colours, font and corners' },
  { id: 'launcher', label: 'Quick Search links and commands', hint: 'Your saved links and your own commands' },
  { id: 'rules', label: 'Automations', hint: 'Rules that tidy folders in your home folder' },
  { id: 'searches', label: 'Saved searches', hint: 'Searches you keep in the sidebar' },
  { id: 'mode', label: 'Mode', hint: 'Standard, Simple, Focus and the others' },
];

export const DEFAULT_CATEGORIES: SyncCategory[] = ['snippets', 'look', 'launcher', 'searches'];

/** Look settings that travel (each one item). */
export const LOOK_KEYS = ['appearance', 'theme', 'accent', 'font', 'density', 'corners', 'themeSeasons', 'look'] as const;

export interface SyncItem {
  value: unknown;
  /** when it last changed, and on which computer (Keeper Link's id) */
  at: number;
  by: string;
  hash: string;
  /** removed (kept so the removal travels too) */
  gone?: boolean;
}

export type SyncDoc = Partial<Record<SyncCategory, Record<string, SyncItem>>>;

export interface OlderVersion {
  cat: SyncCategory;
  key: string;
  /** a name for the list ("Snippet ;addr", "Theme") */
  label: string;
  value: unknown;
  at: number;
  by: string;
  /** when it was replaced */
  replaced: number;
}

export const OLDER_MAX = 40;

const SECRET_KEY = /secret|token|passw|apikey|api_key|accesskey|access_key|privatekey|private_key|credential|cookie|bearer/i;

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
export const hashOf = (v: unknown) => createHash('sha256').update(stable(v) ?? 'undefined').digest('base64url').slice(0, 16);

const ABS = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/** A value as it travels: no secret keys, home paths as "~/…"; null when it holds a path only this computer has. */
export function portable(v: unknown, home: string): unknown | null {
  const h = home.replace(/[\\/]+$/, '');
  let ok = true;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      if (x === h) return '~';
      if (x.startsWith(h + '/') || x.startsWith(h + '\\')) return '~/' + x.slice(h.length + 1).replace(/\\/g, '/');
      if (ABS.test(x) && x.length > 1 && !/^\/\//.test(x)) ok = false;
      return x;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  const out = walk(v);
  return ok ? out : null;
}

/** A value that arrived, with "~/…" under this computer's home folder. */
export function local(v: unknown, home: string, sep = home.includes('\\') ? '\\' : '/'): unknown {
  const h = home.replace(/[\\/]+$/, '');
  if (typeof v === 'string') return v === '~' ? h : v.startsWith('~/') ? h + sep + v.slice(2).split('/').join(sep) : v;
  if (Array.isArray(v)) return v.map((x) => local(x, home, sep));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, local(x, home, sep)]));
  return v;
}

// ---------------------------------------------------------------- reading and writing the parts that travel

/** The parts of Keeper's settings that travel, as plain data (the service reads them from settings and the snippets). */
export interface SyncSource {
  snippets?: { id: string; abbr?: string; trigger?: string; text: string }[];
  look?: Record<string, unknown>;
  launcher?: { links: { id: string }[]; commands: { id: string }[] };
  rules?: { id: string }[];
  searches?: { id?: string; name?: string; query?: string }[];
  mode?: unknown;
}

const byId = <T extends { id?: string; name?: string }>(list: T[] | undefined, prefix = ''): [string, T][] => (list ?? []).map((x, i) => [`${prefix}${x.id ?? x.name ?? String(i)}`, x]);

/** Items of one category, keyed. Items holding a path only this computer has are left out. */
export function itemsOf(cat: SyncCategory, src: SyncSource, home: string): Record<string, unknown> {
  let pairs: [string, unknown][] = [];
  if (cat === 'snippets') pairs = byId(src.snippets);
  else if (cat === 'look') pairs = LOOK_KEYS.filter((k) => src.look?.[k] !== undefined).map((k) => [k, src.look![k]]);
  else if (cat === 'launcher') pairs = [...byId(src.launcher?.links, 'link:'), ...byId(src.launcher?.commands, 'command:')];
  else if (cat === 'rules') pairs = byId(src.rules);
  else if (cat === 'searches') pairs = byId(src.searches);
  else if (cat === 'mode' && src.mode !== undefined) pairs = [['mode', src.mode]];
  const out: Record<string, unknown> = {};
  for (const [k, v] of pairs) {
    const p = portable(v, home);
    if (p !== null) out[k] = p;
  }
  return out;
}

/** The new values for one category, in the shape the service writes back. Items not in the doc (paths only this computer has) stay. */
export function applyItems(cat: SyncCategory, items: Record<string, SyncItem>, src: SyncSource, home: string): Partial<SyncSource> {
  const live = Object.entries(items).filter(([, i]) => !i.gone).sort(([a], [b]) => a.localeCompare(b));
  const val = (i: SyncItem) => local(i.value, home);
  const keepLocalOnly = <T extends { id?: string; name?: string }>(list: T[] | undefined, prefix = '') => byId(list, prefix).filter(([k]) => !(k in items)).map(([, x]) => x);
  const merged = <T extends { id?: string; name?: string }>(list: T[] | undefined, prefix = ''): T[] => {
    // Keep this computer's order for what it has, add new ones at the end.
    const order = byId(list, prefix).map(([k]) => k);
    const fromDoc = live.filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9)).map(([, i]) => val(i) as T);
    return [...fromDoc, ...keepLocalOnly(list, prefix)];
  };
  switch (cat) {
    case 'snippets': return { snippets: merged(src.snippets) };
    case 'look': return { look: Object.fromEntries(live.map(([k, i]) => [k, val(i)])) };
    case 'launcher': return { launcher: { links: merged(src.launcher?.links, 'link:'), commands: merged(src.launcher?.commands, 'command:') } };
    case 'rules': return { rules: merged(src.rules) };
    case 'searches': return { searches: merged(src.searches) };
    case 'mode': return live.length ? { mode: val(live[0][1]) } : {};
  }
}

// ---------------------------------------------------------------- noticing changes and merging

/**
 * Marks what changed here since the doc was made: changed values and removals get this computer's
 * time. Something seen for the first time gets `firstAt` (0: no age, so a real change elsewhere wins).
 */
export function stamp(doc: SyncDoc, now: Partial<Record<SyncCategory, Record<string, unknown>>>, at: number, me: string, firstAt = at): SyncDoc {
  const out: SyncDoc = { ...doc };
  for (const [cat, items] of Object.entries(now) as [SyncCategory, Record<string, unknown>][]) {
    const prev = doc[cat] ?? {};
    const next: Record<string, SyncItem> = { ...prev };
    for (const [k, v] of Object.entries(items)) {
      const h = hashOf(v);
      if (!prev[k]) next[k] = { value: v, at: firstAt, by: me, hash: h };
      else if (prev[k].gone || prev[k].hash !== h) next[k] = { value: v, at, by: me, hash: h };
    }
    for (const [k, i] of Object.entries(prev)) if (!(k in items) && !i.gone) next[k] = { value: null, at, by: me, hash: 'gone', gone: true };
    out[cat] = next;
  }
  return out;
}

const newer = (a: SyncItem, b: SyncItem) => a.at > b.at || (a.at === b.at && a.by > b.by);

/** A name for an item in the Older versions list. */
export function itemLabel(cat: SyncCategory, key: string, value: unknown): string {
  const v = (value ?? {}) as Record<string, unknown>;
  if (cat === 'snippets') return `Snippet ${String(v.abbr || v.trigger || key)}`;
  if (cat === 'look') return key === 'theme' ? 'Theme' : key === 'appearance' ? 'Light or dark' : key[0].toUpperCase() + key.slice(1);
  if (cat === 'launcher') return `${key.startsWith('command:') ? 'Command' : 'Link'} ${String(v.keyword || v.name || key.split(':')[1])}`;
  if (cat === 'rules') return `Automation ${String(v.name || key)}`;
  if (cat === 'searches') return `Saved search ${String(v.name || v.query || key)}`;
  return 'Mode';
}

/**
 * Merges another computer's doc into this one: per item, the newer change wins
 * (ties go to the computer with the larger id, the same on both sides). What a
 * winner replaces here goes to Older versions. Only the categories given take part.
 */
export function mergeDocs(mine: SyncDoc, theirs: SyncDoc, cats: SyncCategory[], replacedAt = Date.now()): { doc: SyncDoc; changed: SyncCategory[]; older: OlderVersion[] } {
  const doc: SyncDoc = { ...mine };
  const changed = new Set<SyncCategory>();
  const older: OlderVersion[] = [];
  for (const cat of cats) {
    const a = mine[cat] ?? {};
    const b = theirs[cat] ?? {};
    const next: Record<string, SyncItem> = { ...a };
    for (const [k, t] of Object.entries(b)) {
      const m = a[k];
      if (m && !newer(t, m)) continue;
      if (m && m.hash === t.hash && !!m.gone === !!t.gone) { next[k] = t; continue; }
      next[k] = t;
      changed.add(cat);
      if (m && !m.gone) older.push({ cat, key: k, label: itemLabel(cat, k, m.value), value: m.value, at: m.at, by: m.by, replaced: replacedAt });
    }
    doc[cat] = next;
  }
  return { doc, changed: [...changed], older };
}

/** Adds to Older versions, newest first, at most OLDER_MAX. */
export function keepOlder(list: OlderVersion[], add: OlderVersion[]): OlderVersion[] {
  return [...add.sort((x, y) => y.replaced - x.replaced), ...list].slice(0, OLDER_MAX);
}

/** Only the categories asked for, so a computer never learns more than it shares. */
export function onlyCats(doc: SyncDoc, cats: SyncCategory[]): SyncDoc {
  return Object.fromEntries(cats.filter((c) => doc[c]).map((c) => [c, doc[c]])) as SyncDoc;
}
