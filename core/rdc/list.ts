// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The saved-connections list: search, folders, tags, favourites and order.
// Shared by the page, the demo and the keeper command.

import { PROTOCOLS, type Connection } from './types';

export interface ListFilter {
  q?: string;
  folder?: string;
  tag?: string;
  favourites?: boolean;
  protocol?: string;
}

/** Words match the name, host, user, folder, tags, notes or protocol, in any order. */
export function filterConnections(list: Connection[], f: ListFilter): Connection[] {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((c) => {
    if (f.favourites && !c.favourite) return false;
    if (f.folder !== undefined && (c.folder ?? '') !== f.folder && !(c.folder ?? '').startsWith(`${f.folder}/`)) return false;
    if (f.tag && !c.tags?.includes(f.tag)) return false;
    if (f.protocol && c.protocol !== f.protocol) return false;
    if (!words.length) return true;
    const hay = [c.name, c.host, c.user, c.folder, ...(c.tags ?? []), c.notes, c.protocol, PROTOCOLS.find((p) => p.id === c.protocol)?.label].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Favourites first, then by folder and name. */
export function sortConnections(list: Connection[]): Connection[] {
  return list.slice().sort((a, b) => Number(!!b.favourite) - Number(!!a.favourite) || (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function foldersOf(list: Connection[]): string[] {
  const out = new Set<string>();
  for (const c of list) {
    if (!c.folder) continue;
    const parts = c.folder.split('/');
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function tagsOf(list: Connection[]): string[] {
  return [...new Set(list.flatMap((c) => c.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

/** A connection by id, exact name, or the start of a name (for `keeper rdc connect <name>`). */
export function findConnection(list: Connection[], key: string): Connection | undefined {
  const k = key.trim().toLowerCase();
  return list.find((c) => c.id === key) ?? list.find((c) => c.name.toLowerCase() === k) ?? list.filter((c) => c.name.toLowerCase().startsWith(k)).sort((a, b) => a.name.length - b.name.length)[0];
}

export const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b'];
