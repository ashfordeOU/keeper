// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Folder boxes: a desktop widget that shows a folder's files as icons, sorted
// and filtered, rolled up to its title when you want the desktop back, and
// "Tidy my desktop into boxes", which moves loose desktop files into one folder
// per kind (Pictures, Documents…) with a box for each, as one step in History.
// Pure logic: which files a box shows and in what order, the tidy plan, and
// the Automation that keeps sending new files of a kind into a box.

import { extOf, kindOf } from './classify';
import type { FileKind, Rule } from './types';

export type BoxSort = 'name' | 'kind' | 'date' | 'size';

/** The kinds people sort desktops by; each is one box when the desktop is tidied. */
export type BoxGroup = 'pictures' | 'documents' | 'videos' | 'music' | 'archives' | 'installers' | 'apps' | 'code' | 'other';

export const BOX_GROUPS: { id: BoxGroup; name: string; kinds: FileKind[]; icon: string }[] = [
  { id: 'pictures', name: 'Pictures', kinds: ['image'], icon: 'image' },
  { id: 'documents', name: 'Documents', kinds: ['document'], icon: 'document' },
  { id: 'videos', name: 'Videos', kinds: ['video'], icon: 'video' },
  { id: 'music', name: 'Music', kinds: ['audio'], icon: 'audio' },
  { id: 'archives', name: 'Archives', kinds: ['archive'], icon: 'archive' },
  { id: 'installers', name: 'Installers', kinds: ['installer'], icon: 'installer' },
  { id: 'apps', name: 'Apps and links', kinds: ['app'], icon: 'app' },
  { id: 'code', name: 'Code', kinds: ['code'], icon: 'code' },
  { id: 'other', name: 'Other', kinds: ['other'], icon: 'other' },
];

/** Links people keep on a desktop to start things: they belong with the apps. */
const LINK_EXTS = new Set(['url', 'webloc', 'desktop', 'lnk', 'website', 'inetloc']);

export function groupOf(name: string, isDirectory = false): BoxGroup {
  if (!isDirectory && LINK_EXTS.has(extOf(name))) return 'apps';
  const k = kindOf(name, isDirectory);
  return BOX_GROUPS.find((g) => g.kinds.includes(k))?.id ?? 'other';
}

export interface BoxEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface BoxItem extends BoxEntry {
  group: BoxGroup;
  kind: FileKind | 'folder';
}

export interface BoxOptions {
  sort?: BoxSort;
  /** only this kind ('all' or empty: everything) */
  show?: BoxGroup | 'all';
  /** hidden files ("." names, desktop.ini, .DS_Store) are always left out */
  limit?: number;
}

const HIDDEN = /^(\.|~\$)|^(desktop\.ini|thumbs\.db|icon\r?)$/i;

/** What a box shows: folders first, then files in the chosen order. */
export function boxItems(entries: BoxEntry[], o: BoxOptions = {}): BoxItem[] {
  const sort = o.sort ?? 'name';
  const items = entries
    .filter((e) => !HIDDEN.test(e.name))
    .map((e): BoxItem => ({ ...e, group: e.isDir && extOf(e.name) !== 'app' ? 'other' : groupOf(e.name, e.isDir), kind: e.isDir && extOf(e.name) !== 'app' ? 'folder' : kindOf(e.name, e.isDir) }))
    .filter((e) => !o.show || o.show === 'all' || (e.kind !== 'folder' && e.group === o.show));
  const byName = (a: BoxItem, b: BoxItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const order = BOX_GROUPS.map((g) => g.id);
  const cmp: Record<BoxSort, (a: BoxItem, b: BoxItem) => number> = {
    name: byName,
    kind: (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || byName(a, b),
    date: (a, b) => b.mtime - a.mtime || byName(a, b),
    size: (a, b) => b.size - a.size || byName(a, b),
  };
  items.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || cmp[sort](a, b));
  return items.slice(0, o.limit ?? 400);
}

/** The box's title: its own name, or the folder's. */
export function boxTitle(folder: string | undefined, title?: string): string {
  if (title?.trim()) return title.trim();
  if (!folder) return 'Folder box';
  return baseName(folder) || folder;
}

/** The last part of a path (Windows or POSIX), without node:path so the widget can use it too. */
export function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** A long name shortened in the middle, so the start and the type stay readable. */
export function shortName(name: string, max = 22): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const keep = Math.max(4, max - ext.length - 1);
  return `${name.slice(0, keep).trimEnd()}…${ext}`;
}

/** A rolled-up box is only its title bar; this tall. */
export const ROLLED_HEIGHT = 44;

// ---------------------------------------------------------------- tidy my desktop into boxes

export interface TidyMove { from: string; to: string; group: BoxGroup }

export interface TidyPlan {
  moves: TidyMove[];
  /** one box per group with files: its folder, and whether Keeper makes it */
  boxes: { group: BoxGroup; name: string; folder: string; count: number; create: boolean }[];
  /** left where they are: folders, hidden files and links Keeper does not move */
  kept: number;
}

/**
 * Loose files on the desktop into one folder per kind, inside the desktop
 * (Desktop/Pictures, Desktop/Documents…), reusing a folder of that name when
 * there is one. Folders stay where they are; a name already in the target
 * folder gets " 2" added, never replaced.
 */
export function planTidy(desktop: string, entries: BoxEntry[], exists: (p: string) => boolean, sep = desktop.includes('\\') && !desktop.includes('/') ? '\\' : '/'): TidyPlan {
  const join = (...p: string[]) => p.join(sep);
  const names = new Set(entries.filter((e) => e.isDir).map((e) => e.name.toLowerCase()));
  const moves: TidyMove[] = [];
  const taken = new Set<string>();
  let kept = 0;
  const counts = new Map<BoxGroup, number>();
  for (const e of entries) {
    if (e.isDir || HIDDEN.test(e.name)) { kept++; continue; }
    const group = groupOf(e.name);
    const box = BOX_GROUPS.find((g) => g.id === group)!;
    const folder = join(desktop, box.name);
    let to = join(folder, e.name);
    if (exists(to) || taken.has(to.toLowerCase())) {
      const ext = e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.')) : '';
      const base = ext ? e.name.slice(0, -ext.length) : e.name;
      for (let i = 2; i < 10_000; i++) {
        to = join(folder, `${base} ${i}${ext}`);
        if (!exists(to) && !taken.has(to.toLowerCase())) break;
      }
    }
    taken.add(to.toLowerCase());
    moves.push({ from: e.path, to, group });
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const boxes = BOX_GROUPS.filter((g) => counts.has(g.id)).map((g) => ({ group: g.id, name: g.name, folder: join(desktop, g.name), count: counts.get(g.id)!, create: !names.has(g.name.toLowerCase()) }));
  return { moves, boxes, kept };
}

/** Where tidied boxes go on the screen: a row from the top left of the usable area, wrapping. */
export function boxPositions(count: number, area: { x: number; y: number; width: number; height: number }, size = { width: 300, height: 240 }, gap = 16): { x: number; y: number }[] {
  const perRow = Math.max(1, Math.floor((area.width - gap) / (size.width + gap)));
  return Array.from({ length: count }, (_, i) => ({ x: area.x + gap + (i % perRow) * (size.width + gap), y: area.y + gap + Math.floor(i / perRow) * (size.height + gap) }));
}

// ---------------------------------------------------------------- sort rules (Automations)

/** An Automation that moves new files of a kind from the desktop into a box's folder. */
export function boxRule(group: BoxGroup, folder: string, desktop: string, now = Date.now()): Rule {
  const g = BOX_GROUPS.find((x) => x.id === group)!;
  return {
    id: `box-${group}-${now.toString(36)}`,
    name: `${g.name} on the desktop go to the “${boxTitle(folder)}” box`,
    enabled: true,
    conditions: group === 'apps' ? [{ type: 'ext', exts: [...LINK_EXTS, 'app'] }] : [{ type: 'kind', kinds: g.kinds }],
    action: { type: 'move', to: folder },
    scope: [desktop],
  };
}

/** The box's rule, if one already sends files into its folder. */
export function ruleForBox(rules: Rule[], folder: string): Rule | undefined {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  return rules.find((r) => r.action.type === 'move' && norm(r.action.to) === norm(folder));
}
