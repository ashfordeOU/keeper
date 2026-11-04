// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "By type" on the file list: chips (Documents, Pictures, Videos…) that filter
// what you are looking at, in one folder or Everywhere. The sidebar lists only
// real places; a type is a filter, never a second "Documents". Also the move of
// the old Library routes (All Documents, All Screenshots, Download Sources) onto
// Everywhere + a chip. Plain functions so they are easy to test.

import type { FileKind } from './types';

/** The chips, in the order they show. `web` is files a browser or app recorded a source for. */
export type TypeChipId = 'document' | 'image' | 'video' | 'audio' | 'archive' | 'installer' | 'app' | 'screenshot' | 'web';
/** A chip, a kind with no chip of its own (code, other: old links only), or every file. */
export type TypeFilter = TypeChipId | 'code' | 'other' | 'all';

export interface TypeChip {
  id: TypeChipId;
  label: string;
  /** the icon (core icon names) */
  icon: string;
  /** the kind colour's file kind (screenshots are pictures, the web is downloads) */
  color: FileKind | 'web';
  /** one short line for the tooltip */
  tip: string;
}

export const TYPE_CHIPS: TypeChip[] = [
  { id: 'document', label: 'Documents', icon: 'document', color: 'document', tip: 'Text, PDFs, spreadsheets and slides' },
  { id: 'image', label: 'Pictures', icon: 'image', color: 'image', tip: 'Photos and pictures' },
  { id: 'video', label: 'Videos', icon: 'video', color: 'video', tip: 'Films and clips' },
  { id: 'audio', label: 'Music', icon: 'audio', color: 'audio', tip: 'Songs, podcasts and recordings' },
  { id: 'archive', label: 'Archives', icon: 'archive', color: 'archive', tip: 'Zip files and other packed files' },
  { id: 'installer', label: 'Installers', icon: 'installer', color: 'installer', tip: 'Files that install an app' },
  { id: 'app', label: 'Apps', icon: 'app', color: 'app', tip: 'Apps you can open' },
  { id: 'screenshot', label: 'Screenshots', icon: 'screenshot', color: 'image', tip: 'Pictures of your screen' },
  { id: 'web', label: 'From the web', icon: 'down', color: 'web', tip: 'Files saved from a website or an app' },
];

const EXTRA: Record<'code' | 'other', string> = { code: 'Code', other: 'Other files' };
const CHIP_IDS = new Set<string>(TYPE_CHIPS.map((c) => c.id));

/** A route's arg or a stored value as a filter ('all' when it is none of them). */
export function asTypeFilter(v: unknown): TypeFilter {
  if (typeof v !== 'string' || !v) return 'all';
  if (CHIP_IDS.has(v) || v === 'code' || v === 'other') return v as TypeFilter;
  return 'all';
}

/** The filter's name: "Documents", "From the web", "Everything". */
export function typeLabel(f: TypeFilter): string {
  if (f === 'all') return 'Everything';
  if (f === 'code' || f === 'other') return EXTRA[f];
  return TYPE_CHIPS.find((c) => c.id === f)!.label;
}

/** What the library is asked for: a kind, screenshots, or files with a recorded source; inside a folder or anywhere. */
export interface TypeQuery {
  kind?: FileKind;
  screenshot?: boolean;
  fromWeb?: boolean;
  /** one download source (a site or app), within From the web */
  source?: string;
  /** only files in this folder or inside it */
  under?: string;
}

/** A chip (and where) → the library query. */
export function chipQuery(f: TypeFilter, opts: { under?: string; source?: string } = {}): TypeQuery {
  const q: TypeQuery = {};
  if (f === 'screenshot') q.screenshot = true;
  else if (f === 'web') { q.fromWeb = true; if (opts.source) q.source = opts.source; }
  else if (f !== 'all') q.kind = f;
  if (opts.under) q.under = opts.under;
  return q;
}

/** True when `path` is `dir` itself or inside it (either slash; case-blind for Windows drive paths). */
export function isUnder(path: string, dir: string): boolean {
  if (!dir) return true;
  const win = /^[a-z]:[\\/]/i.test(dir) || dir.startsWith('\\\\');
  const norm = (s: string) => { const x = s.replace(/[\\/]+$/, ''); return win ? x.replace(/\//g, '\\').toLowerCase() : x; };
  const p = norm(path);
  const d = norm(dir);
  if (!d) return true; // the root of the file system
  return p === d || p.startsWith(d + (win ? '\\' : '/'));
}

export interface TypedFile {
  path: string;
  kind: FileKind;
  size: number;
  screenshot?: boolean;
  source?: { id: string };
  dir?: boolean;
}

/** Whether a file passes the query (folders never do: a type is about files). */
export function matchesType(f: TypedFile, q: TypeQuery): boolean {
  if (f.dir) return false;
  if (q.kind && f.kind !== q.kind) return false;
  if (q.screenshot && !f.screenshot) return false;
  if (q.fromWeb && !f.source) return false;
  if (q.source && f.source?.id !== q.source) return false;
  if (q.under && !isUnder(f.path, q.under)) return false;
  return true;
}

export type TypeCounts = Record<TypeChipId | 'all', { count: number; size: number }>;

/** How many files (and how much) each chip holds, for the chips' counts and Home's folder tiles. */
export function typeCounts(files: Iterable<TypedFile>, under?: string): TypeCounts {
  const out = {} as TypeCounts;
  for (const id of ['all', ...CHIP_IDS] as (TypeChipId | 'all')[]) out[id] = { count: 0, size: 0 };
  const add = (id: TypeChipId | 'all', f: TypedFile) => { out[id].count++; out[id].size += f.size; };
  for (const f of files) {
    if (f.dir || (under && !isUnder(f.path, under))) continue;
    add('all', f);
    if (CHIP_IDS.has(f.kind)) add(f.kind as TypeChipId, f);
    if (f.screenshot) add('screenshot', f);
    if (f.source) add('web', f);
  }
  return out;
}

/** The chips worth showing: those with files, plus the one chosen (so it can be cleared). */
export function visibleChips(counts: TypeCounts | undefined, active: TypeFilter): TypeChip[] {
  if (!counts) return TYPE_CHIPS;
  return TYPE_CHIPS.filter((c) => counts[c.id].count > 0 || c.id === active);
}

/** "25k", "1.2k", "312". */
export function shortCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
}

// ---------------------------------------------------------------- old routes

export interface FilesRoute { name: string; arg?: string; q?: string }

/**
 * The Library's old pages, on Everywhere + a chip (route `library`, the chip
 * as its arg; a download source as its q):
 *   screenshots → library:screenshot, downloads → library:web,
 *   source:<id> → library:web with that source. library:<kind> stays.
 * Anything else comes back unchanged.
 */
export function migrateFilesRoute<R extends FilesRoute>(r: R): R {
  if (r.name === 'screenshots') return { ...r, name: 'library', arg: 'screenshot', q: undefined };
  if (r.name === 'downloads') return { ...r, name: 'library', arg: 'web', q: undefined };
  if (r.name === 'source') return { ...r, name: 'library', arg: 'web', q: r.arg || undefined };
  if (r.name === 'library' && r.arg !== undefined && asTypeFilter(r.arg) === 'all') return { ...r, arg: undefined, q: undefined };
  return r;
}

/** The chip a files route shows: Everywhere's arg, or a folder's q. */
export function routeChip(r: FilesRoute): TypeFilter {
  if (r.name === 'library') return asTypeFilter(r.arg);
  if (r.name === 'browse') return asTypeFilter(r.q);
  return 'all';
}

/** Where a chip goes: in a folder it stays in the folder; Everywhere stays Everywhere (a source is kept only under From the web). */
export function chipRoute(scope: { folder?: string }, chip: TypeFilter, source?: string): FilesRoute {
  if (scope.folder !== undefined) return chip === 'all' ? { name: 'browse', arg: scope.folder } : { name: 'browse', arg: scope.folder, q: chip };
  return { name: 'library', ...(chip === 'all' ? {} : { arg: chip }), ...(chip === 'web' && source ? { q: source } : {}) };
}

// ---------------------------------------------------------------- the sidebar's folders

/** Home's three front-door folders, found among the favourites by their place in the home folder. */
export function frontDoorFolders<P extends { name: string; path: string; kind: string }>(favorites: P[], home: string): P[] {
  const want = ['Desktop', 'Documents', 'Downloads'];
  const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return want.map((w) => favorites.find((f) => f.kind === 'folder' && base(f.path) === w && isUnder(f.path, home))).filter((p): p is P => !!p);
}

/** Sections that came out of another one: [new, old]. Connect (other people's machines) came out of Devices (yours). */
export const SECTION_SPLITS: [string, string][] = [['connect', 'devices']];

/**
 * Once per split: a new section starts hidden where the one it came out of was hidden, and sits
 * right after it in a custom order. `done` lists the splits already made (the person may show it later).
 */
export function splitSidebarSections(s: { sidebarOrder?: string[]; sidebarHidden?: string[] }, done: string[]): { sidebarOrder: string[]; sidebarHidden: string[]; sidebarSplits: string[] } {
  let order = [...(s.sidebarOrder ?? [])];
  const hidden = [...(s.sidebarHidden ?? [])];
  for (const [neu, old] of SECTION_SPLITS) {
    if (done.includes(neu)) continue;
    if (hidden.includes(`section:${old}`) && !hidden.includes(`section:${neu}`)) hidden.push(`section:${neu}`);
    const i = order.indexOf(old);
    if (i >= 0 && !order.includes(neu)) order = [...order.slice(0, i + 1), neu, ...order.slice(i + 1)];
  }
  return { sidebarOrder: order, sidebarHidden: hidden, sidebarSplits: [...new Set([...done, ...SECTION_SPLITS.map(([n]) => n)])] };
}

/** Old sidebar section ids that are gone: the Library became chips; Cloud & Servers joined Locations. */
const GONE_SECTIONS = new Set(['library', 'cloud']);

/** Settings → Sidebar's order and hidden list without the sections that are gone (a hidden Library becomes nothing). */
export function migrateSidebarLists(s: { sidebarOrder?: string[]; sidebarHidden?: string[] }): { sidebarOrder: string[]; sidebarHidden: string[] } {
  return {
    sidebarOrder: (s.sidebarOrder ?? []).filter((id) => !GONE_SECTIONS.has(id)),
    sidebarHidden: (s.sidebarHidden ?? []).filter((h) => !(h.startsWith('section:') && GONE_SECTIONS.has(h.slice(8)))),
  };
}
