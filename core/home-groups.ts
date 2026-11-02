// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Jump back in: recent files grouped by the project or folder they belong to.
// A project is a code repository's root (the folder above src, packages, docs
// and the like), a folder at the top of Documents, Desktop, Developer or
// another folder people keep projects in, or failing those the folder the
// files share. Only paths are read: nothing touches the disk. Pure.

import { parentOf } from './folder-view';

export type GroupKind = 'project' | 'folder' | 'downloads' | 'other';

export interface RecentGroup<T> {
  /** the group's folder ('' for the leftovers) */
  dir: string;
  name: string;
  kind: GroupKind;
  items: T[];
  /** the newest item's time */
  latest: number;
}

export interface GroupContext {
  /** the home folder */
  home?: string;
  /** the folders Keeper reads (Settings → Folders), for projects outside the home folder */
  roots?: string[];
}

/** Folders whose sub-folders are projects ("~/Developer/keeper"). Compared without case. */
const CONTAINERS = new Set(['documents', 'desktop', 'developer', 'projects', 'project', 'code', 'src', 'source', 'dev', 'repos', 'repositories', 'git', 'github', 'gitlab', 'workspace', 'workspaces', 'work', 'sites', 'clients', 'dropbox', 'onedrive', 'google drive', 'icloud drive']);
/** Folders a code repository has near its root: the folder above the first one is the project. */
const MARKERS = new Set(['src', 'lib', 'app', 'apps', 'packages', 'test', 'tests', '__tests__', 'spec', 'docs', 'public', 'assets', 'scripts', 'components', 'cmd', 'internal', 'pkg', 'include', 'build', 'dist', 'node_modules', '.git', '.github', '.vscode']);
/** Folders that are one group however deep their files are. */
const WHOLE = new Set(['downloads']);

const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const split = (p: string) => p.split(/[\\/]/);
const lower = (s: string) => s.toLowerCase();

function within(p: string, dir: string): boolean {
  if (!dir) return false;
  const d = dir.replace(/[\\/]+$/, '');
  return p === d || p.startsWith(d + '/') || p.startsWith(d + '\\');
}

/** The project or folder a file belongs to. */
export function projectOf(path: string, ctx: GroupContext = {}): { dir: string; name: string; kind: GroupKind } {
  const sep = sepOf(path);
  const parts = split(path);
  const join = (n: number) => parts.slice(0, n).join(sep) || sep;
  // Where the person's own folders start: the home folder, else the deepest library folder holding it.
  const base = ctx.home && within(path, ctx.home) ? ctx.home : (ctx.roots ?? []).filter((r) => within(path, r)).sort((a, b) => b.length - a.length)[0];
  const start = base ? split(base.replace(/[\\/]+$/, '')).length : 0;
  const dirEnd = parts.length - 1; // the file's own name is not a folder

  // Downloads (and the like) are one group, whatever is inside.
  if (base && start < dirEnd && WHOLE.has(lower(parts[start]))) return { dir: join(start + 1), name: parts[start], kind: 'downloads' };

  // A repository: the folder just above its first src, packages, docs… (below the base).
  for (let i = Math.max(start + 1, 2); i < dirEnd; i++) {
    if (MARKERS.has(lower(parts[i])) && !CONTAINERS.has(lower(parts[i - 1]))) return { dir: join(i), name: parts[i - 1], kind: 'project' };
  }

  // A library folder outside the home folder (/mnt/data/projects): its first level is the project.
  const outside = !!base && base !== ctx.home;
  if (outside && start < dirEnd) return { dir: join(start + 1), name: parts[start], kind: 'project' };

  // A folder people keep projects in (~/Documents, ~/Developer, ~/Documents/Projects…): its child is the project.
  let i = start;
  while (base && i < dirEnd && CONTAINERS.has(lower(parts[i]))) i++;
  if (i > start) {
    if (i < dirEnd) return { dir: join(i + 1), name: parts[i], kind: 'project' };
    // Right inside the container ("~/Documents/Budget.xlsx").
    return { dir: join(i), name: parts[i - 1], kind: 'folder' };
  }

  // Anywhere else: the folder it is in.
  const dir = parentOf(path);
  return { dir, name: split(dir).filter(Boolean).pop() ?? dir, kind: 'folder' };
}

export interface GroupOptions {
  /** at most this many groups (the leftovers come after them) */
  maxGroups?: number;
  /** at most this many files in each */
  perGroup?: number;
}

/**
 * Recent files (newest first) under their projects, newest group first. A group
 * needs two files or more; single files from elsewhere are gathered at the end
 * as "Other recent files". `flat` when there is no clear grouping (fewer than
 * two such groups): show the newest files as one plain list instead.
 */
export function groupRecent<T extends { path: string; mtime: number }>(files: T[], ctx: GroupContext = {}, o: GroupOptions = {}): { groups: RecentGroup<T>[]; flat: boolean } {
  const maxGroups = o.maxGroups ?? 4;
  const per = o.perGroup ?? 4;
  const by = new Map<string, RecentGroup<T>>();
  for (const f of [...files].sort((a, b) => b.mtime - a.mtime)) {
    const p = projectOf(f.path, ctx);
    const g = by.get(p.dir);
    if (g) g.items.push(f);
    else by.set(p.dir, { ...p, items: [f], latest: f.mtime });
  }
  const all = [...by.values()].sort((a, b) => b.latest - a.latest);
  const real = all.filter((g) => g.items.length >= 2);
  if (real.length < 2) return { groups: [{ dir: '', name: 'Recent', kind: 'other', items: [...files].sort((a, b) => b.mtime - a.mtime).slice(0, per * 2), latest: Math.max(0, ...files.map((f) => f.mtime)) }], flat: true };
  const shown = real.slice(0, maxGroups);
  const rest = all.filter((g) => !shown.includes(g)).flatMap((g) => g.items).sort((a, b) => b.mtime - a.mtime);
  const groups = shown.map((g) => ({ ...g, items: g.items.slice(0, per) }));
  if (rest.length) groups.push({ dir: '', name: 'Other recent files', kind: 'other', items: rest.slice(0, per), latest: rest[0].mtime });
  return { groups, flat: false };
}
