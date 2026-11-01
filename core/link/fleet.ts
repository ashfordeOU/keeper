// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Your own devices as a small fleet: groups, tags, notes, a search box,
// online/last seen, saved commands. Pure.

import { sha256, toB64u, utf8 } from './jscrypto';

export interface SavedCommand {
  id: string;
  name: string;
  command: string;
}

export interface DeviceMeta {
  tags: string[];
  group?: string;
  notes?: string;
  commands: SavedCommand[];
}

export const EMPTY_META: DeviceMeta = { tags: [], commands: [] };

export function normalizeTags(tags: unknown): string[] {
  const arr = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  const out: string[] = [];
  for (const t of arr) {
    const s = String(t).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]/g, '').slice(0, 32);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 20);
}

export function cleanMeta(m: Partial<DeviceMeta> | undefined): DeviceMeta {
  return {
    tags: normalizeTags(m?.tags),
    group: m?.group?.trim().slice(0, 60) || undefined,
    notes: m?.notes?.slice(0, 10_000) || undefined,
    commands: (m?.commands ?? []).filter((c) => c && c.command?.trim()).slice(0, 50).map((c) => ({ id: c.id || Math.random().toString(36).slice(2, 10), name: (c.name || c.command).trim().slice(0, 80), command: c.command.trim().slice(0, 4000) })),
  };
}

export interface FleetRow {
  id: string;
  name: string;
  os: string;
  online: boolean;
  lastSeen?: number;
  meta?: DeviceMeta;
}

/**
 * Search: words match name, system, group, tags and notes; `tag:x`,
 * `group:x`, `online` and `offline` narrow it down.
 */
export function searchDevices<T extends FleetRow>(rows: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = `${r.name} ${osWord(r.os)} ${r.meta?.group ?? ''} ${(r.meta?.tags ?? []).join(' ')} ${r.meta?.notes ?? ''}`.toLowerCase();
    return words.every((w) => {
      if (w === 'online') return r.online;
      if (w === 'offline') return !r.online;
      if (w.startsWith('tag:')) return (r.meta?.tags ?? []).includes(w.slice(4));
      if (w.startsWith('group:')) return (r.meta?.group ?? '').toLowerCase() === w.slice(6);
      return hay.includes(w);
    });
  });
}

const osWord = (os: string) => ({ darwin: 'mac macos', win32: 'windows', linux: 'linux' } as Record<string, string>)[os] ?? os;

/** Groups in name order, devices without one last. */
export function groupDevices<T extends FleetRow>(rows: T[]): { group: string; devices: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const g = r.meta?.group ?? '';
    map.set(g, [...(map.get(g) ?? []), r]);
  }
  return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map(([group, devices]) => ({ group, devices }));
}

export function lastSeenLabel(now: number, online: boolean, lastSeen?: number): string {
  if (online) return 'Online';
  if (!lastSeen) return 'Not seen yet';
  const s = Math.max(0, Math.round((now - lastSeen) / 1000));
  if (s < 90) return 'Seen just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Seen ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `Seen ${h} h ago`;
  return `Seen ${Math.round(h / 24)} days ago`;
}

/** What the host remembers about a command it has shown its owner once. */
export function commandHash(command: string): string {
  return toB64u(sha256(utf8(command.trim()))).slice(0, 22);
}
