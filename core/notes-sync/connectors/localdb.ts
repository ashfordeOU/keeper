// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes apps that keep a SQLite database on this computer.
//
// Bear (Mac): its database is read, never written; changes go in through
// Bear's own bear:// links, so Bear stays in charge of its data.
// Sticky Notes (Windows): plum.sqlite is read; writing is off by default and
// only allowed while Sticky Notes is closed.

import { randomUUID } from 'node:crypto';
import { inlineTags } from './io';
import type { RemoteNote } from '../types';

// ---------------------------------------------------------------- Bear

export const BEAR_DB_REL = 'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite';
export const BEAR_SQL = 'SELECT * FROM ZSFNOTE';

const CORE_DATA_EPOCH = 978307200;
export const coreDataTime = (s: unknown) => (typeof s === 'number' ? Math.round((s + CORE_DATA_EPOCH) * 1000) : undefined);

export function fromBearRows(rows: Record<string, unknown>[]): RemoteNote[] {
  const out: RemoteNote[] = [];
  for (const r of rows) {
    if (r.ZPERMANENTLYDELETED === 1) continue;
    const id = String(r.ZUNIQUEIDENTIFIER ?? '');
    if (!id) continue;
    const title = String(r.ZTITLE ?? '') || 'Untitled';
    const modified = coreDataTime(r.ZMODIFICATIONDATE);
    if (r.ZENCRYPTED === 1 || r.ZLOCKED === 1) { out.push({ sourceId: id, title, body: '', tags: [], locked: true, modified, version: String(r.ZMODIFICATIONDATE ?? '') }); continue; }
    let text = String(r.ZTEXT ?? '').replace(/\r\n?/g, '\n');
    const first = text.split('\n')[0];
    if (first.replace(/^#+\s*/, '').trim() === title.trim()) text = text.slice(first.length).replace(/^\n+/, '');
    out.push({
      sourceId: id, title, body: text, tags: inlineTags(text),
      created: coreDataTime(r.ZCREATIONDATE), modified, version: String(r.ZMODIFICATIONDATE ?? ''),
      trashed: r.ZTRASHED === 1, folder: r.ZARCHIVED === 1 ? 'Archive' : undefined,
    });
  }
  return out;
}

const q = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export function bearCreateUrl(n: Pick<RemoteNote, 'title' | 'body' | 'tags'>): string {
  return `bear://x-callback-url/create?${q({ title: n.title, text: n.body, tags: n.tags.join(','), open_note: 'no', show_window: 'no' })}`;
}

export function bearUpdateUrl(n: Pick<RemoteNote, 'sourceId' | 'title' | 'body'>): string {
  return `bear://x-callback-url/add-text?${q({ id: n.sourceId, mode: 'replace_all', text: `# ${n.title}\n${n.body}`, open_note: 'no', show_window: 'no' })}`;
}

export function bearTrashUrl(id: string): string {
  return `bear://x-callback-url/trash?${q({ id, show_window: 'no' })}`;
}

// ---------------------------------------------------------------- Sticky Notes

export const STICKY_DB_REL = 'Packages/Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe/LocalState/plum.sqlite';
export const STICKY_SQL = 'SELECT Id, Text, CreatedAt, UpdatedAt, DeletedAt, IsOpen FROM Note';
export const STICKY_PROCESS = 'Microsoft.Notes.exe';

/** .NET ticks (100 ns since year 1) ↔ milliseconds since 1970. */
export const ticksToMs = (t: unknown) => (typeof t === 'number' || typeof t === 'bigint' ? Math.round(Number(t) / 10_000 - 62_135_596_800_000) : undefined);
export const msToTicks = (ms: number) => Math.round((ms + 62_135_596_800_000) * 10_000);

/** Sticky Notes stores each paragraph as "\id=<guid> text". */
export function stickyPlain(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^\\id=[0-9a-f-]+ ?/i, '')).join('\n');
}

export function stickyText(title: string, body: string): string {
  const lines = [title, ...(body ? body.split('\n') : [])];
  return lines.map((l) => `\\id=${randomUUID()} ${l}`).join('\n');
}

export function fromStickyRows(rows: Record<string, unknown>[]): RemoteNote[] {
  const out: RemoteNote[] = [];
  for (const r of rows) {
    if (r.DeletedAt !== null && r.DeletedAt !== undefined && r.DeletedAt !== 0) continue;
    const plain = stickyPlain(String(r.Text ?? '')).replace(/^\s+/, '');
    const nl = plain.indexOf('\n');
    const title = (nl < 0 ? plain : plain.slice(0, nl)).trim().slice(0, 120) || 'Sticky note';
    out.push({ sourceId: String(r.Id), title, body: nl < 0 ? '' : plain.slice(nl + 1), tags: [], created: ticksToMs(r.CreatedAt), modified: ticksToMs(r.UpdatedAt), version: String(r.UpdatedAt ?? '') });
  }
  return out;
}

export function stickyUpdate(n: Pick<RemoteNote, 'sourceId' | 'title' | 'body'>, now = Date.now()): { sql: string; params: (string | number)[] } {
  return { sql: 'UPDATE Note SET Text = ?, UpdatedAt = ? WHERE Id = ?', params: [stickyText(n.title, n.body), msToTicks(now), n.sourceId] };
}

export function stickyInsert(n: Pick<RemoteNote, 'title' | 'body'>, now = Date.now()): { id: string; sql: string; params: (string | number)[] } {
  const id = randomUUID();
  return { id, sql: 'INSERT INTO Note (Text, Id, CreatedAt, UpdatedAt, IsOpen, Theme, Type) VALUES (?, ?, ?, ?, 0, \'Yellow\', 0)', params: [stickyText(n.title, n.body), id, msToTicks(now), msToTicks(now)] };
}
