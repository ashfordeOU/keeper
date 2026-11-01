// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Tidy this folder": sort the loose files of one folder into sub-folders by
// kind, by month or by extension. Folders that are already there stay put.

import { KIND_LABEL, extOf, kindOf } from './classify';

export type TidyMode = 'kind' | 'month' | 'ext';

export interface TidyItem {
  path: string;
  name: string;
  isDir: boolean;
  mtime: number;
}

export interface TidyMove {
  from: string;
  /** destination folder (inside the tidied folder) */
  dir: string;
  /** the sub-folder name, for grouping in the preview */
  group: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function tidyGroup(item: TidyItem, mode: TidyMode): string {
  if (mode === 'month') {
    const d = new Date(item.mtime);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
  }
  if (mode === 'ext') return (extOf(item.name) || 'no extension').toUpperCase();
  const k = kindOf(item.name);
  return k === 'other' ? 'Other' : KIND_LABEL[k];
}

/** Plans the moves. Hidden files and anything that is already a folder are left alone. */
export function planTidy(dir: string, items: TidyItem[], mode: TidyMode, sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'): TidyMove[] {
  const moves: TidyMove[] = [];
  for (const it of items) {
    if (it.isDir || it.name.startsWith('.') || /^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(it.name)) continue;
    const group = tidyGroup(it, mode);
    // Never move a file into a folder of its own name, or a group name that is a file here.
    if (it.name.toLowerCase() === group.toLowerCase()) continue;
    moves.push({ from: it.path, dir: dir.replace(/[\\/]+$/, '') + sep + group, group });
  }
  return moves;
}

export function summarizeTidy(moves: TidyMove[]): { group: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of moves) m.set(x.group, (m.get(x.group) ?? 0) + 1);
  return [...m].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}
