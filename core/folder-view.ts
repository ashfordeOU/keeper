// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How folders and collections are laid out, the way Finder and File Explorer
// do it: folders first, then files, sorted by name unless the person picks
// another order; a folder's tree in list view; the Library's results grouped
// under the folders they live in. Plain functions so they are easy to test.

/** Icons, list (with disclosure triangles), columns or gallery. */
export type FileView = 'grid' | 'list' | 'columns' | 'gallery';
export const FILE_VIEWS: FileView[] = ['grid', 'list', 'columns', 'gallery'];

export type SortKey = 'name' | 'date' | 'size' | 'kind';
export interface Sort { key: SortKey; desc: boolean }

/** Kinds whose files are mostly words: a page of tiny text tells nothing, so they open as a list. */
const LIST_FIRST = new Set(['document', 'archive', 'installer', 'app', 'code', 'other', 'audio', 'web', '']);

/**
 * Which remembered view a page uses: real folders share one; each type (a chip,
 * Everywhere or in a folder: `q` on a folder's route) has its own.
 */
export function viewScope(route: { name: string; arg?: string; q?: string }): string {
  if (route.name === 'browse') return route.q ? `library:${route.q}` : 'browse';
  if (route.name === 'library') return `library:${route.arg ?? ''}`;
  if (route.name === 'screenshots') return 'library:screenshot';
  return 'files';
}

/** The views a page offers: columns need real folders. */
export function viewsFor(scope: string): FileView[] {
  return scope === 'browse' ? FILE_VIEWS : ['grid', 'list', 'gallery'];
}

/** The view a page shows: the person's choice for it, else a sensible one for what it holds. */
export function resolveView(scope: string, saved: Record<string, string | undefined>, fallback: 'grid' | 'list' = 'grid'): FileView {
  const v = saved[scope] as FileView | undefined;
  if (v && viewsFor(scope).includes(v)) return v;
  if (v === 'columns') return 'list';
  if (scope.startsWith('library:')) return LIST_FIRST.has(scope.slice(8)) ? 'list' : 'grid';
  return fallback;
}

/** Natural, case-insensitive name order ("note 2" before "note 10"). */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface Sortable { name: string; size: number; mtime: number; kind?: string; ext?: string; dir?: boolean }

/**
 * Folders first, then files, each in the chosen order. Folders have no size of
 * their own here, so "Biggest first" keeps them by name; ties fall back to name.
 */
export function sortFoldersFirst<T extends Sortable>(items: T[], sort: Sort = { key: 'name', desc: false }): T[] {
  const d = sort.desc ? -1 : 1;
  const cmp = (a: T, b: T): number => {
    if (!!a.dir !== !!b.dir) return a.dir ? -1 : 1;
    const byName = compareNames(a.name, b.name);
    switch (sort.key) {
      case 'date': return d * (a.mtime - b.mtime) || byName;
      case 'size': return a.dir ? byName : d * (a.size - b.size) || byName;
      case 'kind': return a.dir ? byName : d * ((a.ext || a.kind || '').localeCompare(b.ext || b.kind || '')) || byName;
      default: return d * byName;
    }
  };
  return [...items].sort(cmp);
}

/** The folder a path is in ('' for a root). Works with / and \ alike. */
export function parentOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 0) return p.length > 1 ? '/' : '';
  // C:\file → C:\
  if (/^[A-Za-z]:$/.test(p.slice(0, i))) return p.slice(0, i + 1);
  return p.slice(0, i);
}

/** A folder as people say it: ~/Documents/Notes for one in the home folder. */
export function prettyFolder(dir: string, home?: string): string {
  if (home && (dir === home || dir.startsWith(home + '/') || dir.startsWith(home + '\\'))) return '~' + dir.slice(home.length);
  return dir;
}

export interface FolderGroup<T> { dir: string; files: T[] }

/**
 * The Library's results under the folders they live in. Folders are in name
 * order of their whole path (so a folder's subfolders follow it); the files in
 * each keep the order they came in (the chosen sort).
 */
export function groupByFolder<T extends { path: string }>(files: T[]): FolderGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const f of files) {
    const dir = parentOf(f.path);
    const list = by.get(dir);
    if (list) list.push(f);
    else by.set(dir, [f]);
  }
  return [...by.entries()].sort((a, b) => comparePaths(a[0], b[0])).map(([dir, list]) => ({ dir, files: list }));
}

/** Path order, one folder level at a time, so /a/b sorts right after /a and before /a b. */
function comparePaths(a: string, b: string): number {
  const pa = a.split(/[\\/]/), pb = b.split(/[\\/]/);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const c = compareNames(pa[i], pb[i]);
    if (c) return c;
  }
  return pa.length - pb.length;
}

/** How many folders a set of files is spread across. */
export function countFolders(files: { path: string }[]): number {
  return new Set(files.map((f) => parentOf(f.path))).size;
}

export interface TreeRow<T> { item: T; depth: number; expanded: boolean; loading: boolean }

/**
 * A folder's contents with its open subfolders' contents shown in place under
 * them (list view's disclosure triangles). `children` gives an open folder's
 * items (already sorted), or undefined while they load.
 */
export function flattenTree<T extends { path: string; dir?: boolean }>(top: T[], expanded: ReadonlySet<string>, children: (dir: string) => T[] | undefined, depth = 0): TreeRow<T>[] {
  const out: TreeRow<T>[] = [];
  for (const item of top) {
    const open = !!item.dir && expanded.has(item.path);
    const kids = open ? children(item.path) : undefined;
    out.push({ item, depth, expanded: open, loading: open && !kids });
    // Guard against a link loop: never deeper than 32 levels.
    if (kids && depth < 32) out.push(...flattenTree(kids, expanded, children, depth + 1));
  }
  return out;
}

const PLAIN_TEXT = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'log', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'srt', 'vtt', 'tex', 'org', 'rst', 'adoc', 'nfo', 'env', 'properties']);

/** Plain text: a drawn page of it is unreadable at icon size, so lists and icons show a clean type icon. */
export function isPlainText(ext: string): boolean {
  return PLAIN_TEXT.has(ext.toLowerCase());
}

const NOUN: Record<string, [string, string]> = {
  image: ['picture', 'pictures'], video: ['video', 'videos'], audio: ['music or audio file', 'music and audio files'], document: ['document', 'documents'],
  archive: ['archive', 'archives'], installer: ['installer', 'installers'], app: ['app', 'apps'], code: ['code file', 'code files'], other: ['other file', 'other files'],
  screenshot: ['screenshot', 'screenshots'], web: ['file saved from the web', 'files saved from the web'], all: ['file', 'files'],
};

/** "this Mac", "this PC" or "this computer". */
export function thisComputer(platform?: string): string {
  return platform === 'darwin' ? 'this Mac' : platform === 'win32' ? 'this PC' : 'this computer';
}

/** The one line under a collection's title: "Every document on this Mac, wherever it is. 24,407 in 1,203 folders." */
export function kindIntro(kind: string, count: number, folders: number, platform?: string): string {
  const [one, many] = NOUN[kind] ?? ['file', 'files'];
  const lead = `Every ${one} on ${thisComputer(platform)}, wherever it is.`;
  if (!count) return `${lead} No ${many} found yet.`;
  const n = count.toLocaleString('en-US');
  const where = `${folders.toLocaleString('en-US')} folder${folders === 1 ? '' : 's'}`;
  return `${lead} ${n} in ${where}.`;
}
