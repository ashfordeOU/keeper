// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The hub copy Keeper owns: one Markdown file per note with YAML properties
// saying where else the note lives and what it looked like at the last sync.
// Attachments are stored once, named by the hash of their bytes.
//
//   ---
//   keeper-id: k-3f9a…
//   title: Shopping
//   tags: [home]
//   created: 2026-10-01T09:00:00.000Z
//   modified: 2026-10-30T18:12:00.000Z
//   source: joplin
//   source-id: 9b1c…
//   sources:
//     - connector: joplin-1
//       app: joplin
//       id: 9b1c…
//       version: "1730311920000"
//       hash: 5d41…
//       synced: 2026-10-30T18:15:00.000Z
//   ---
//   Milk, eggs…

import { createHash, randomBytes } from 'node:crypto';
import { splitFrontmatter } from '../notes/parse';
import { parseYaml, stringifyYaml, type YamlValue } from '../notes/yaml';
import type { ConnectorKind, HubNote, SourceLink } from './types';

/** Folder inside the hub for Keeper's own bookkeeping (bases, trash, snapshots, history). */
export const STATE_DIR = '.keeper-notes';
/** Attachments, stored once by hash. */
export const ATTACH_DIR = 'attachments';

const RESERVED = new Set(['keeper-id', 'title', 'tags', 'created', 'modified', 'source', 'source-id', 'sources', 'locked', 'attachments']);

export const norm = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The note's text as one document: the title on the first line, then the body. Merged as a whole. */
export function docOf(title: string, body: string): string {
  return `${title.replace(/\n/g, ' ').trim()}\n${norm(body)}`;
}

export function splitDoc(doc: string): { title: string; body: string } {
  const i = doc.indexOf('\n');
  return i < 0 ? { title: doc.trim(), body: '' } : { title: doc.slice(0, i).trim(), body: doc.slice(i + 1) };
}

/** Hash of a note's text, the sync base key. */
export function textHash(title: string, body: string): string {
  return sha256Hex(docOf(title, body)).slice(0, 32);
}

export function tagsHash(tags: string[]): string {
  return sha256Hex(normTags(tags).join('\n')).slice(0, 16);
}

export function normTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function newKeeperId(): string {
  return 'k-' + randomBytes(9).toString('hex');
}

const iso = (t: number) => new Date(Number.isFinite(t) ? t : 0).toISOString();
const time = (v: unknown, d: number) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : d; }
  return d;
};
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

/** Writes a hub note as Markdown with properties. */
export function serializeHubNote(n: HubNote): string {
  const props: Record<string, YamlValue> = { 'keeper-id': n.keeperId, title: n.title };
  if (n.tags.length) props.tags = normTags(n.tags);
  props.created = iso(n.created);
  props.modified = iso(n.modified);
  if (n.sources[0]) {
    props.source = n.sources[0].app;
    props['source-id'] = n.sources[0].id;
  }
  if (n.sources.length) {
    props.sources = n.sources.map((s) => {
      const o: Record<string, YamlValue> = { connector: s.connector, app: s.app, id: s.id };
      if (s.folder) o.folder = s.folder;
      if (s.version !== undefined) o.version = String(s.version);
      if (s.hash) o.hash = s.hash;
      if (s.tagsHash) o['tags-hash'] = s.tagsHash;
      if (s.synced) o.synced = iso(s.synced);
      return o;
    });
  }
  if (n.locked) props.locked = true;
  if (n.attachments?.length) props.attachments = n.attachments.map((a) => ({ name: a.name, hash: a.hash, ...(a.mime ? { mime: a.mime } : {}) }));
  for (const [k, v] of Object.entries(n.extra ?? {})) if (!RESERVED.has(k)) props[k] = v as YamlValue;
  const body = norm(n.body);
  return `---\n${stringifyYaml(props)}---\n${body}${body ? '\n' : ''}`;
}

/** Reads a hub file. A Markdown file without a keeper-id (written by hand) gets one. */
export function parseHubNote(text: string, rel: string, fallbackTime = Date.now()): HubNote {
  const { yaml, body } = splitFrontmatter(text.replace(/^﻿/, ''));
  let props: Record<string, unknown> = {};
  if (yaml) {
    try {
      const v = parseYaml(yaml);
      if (v && typeof v === 'object' && !Array.isArray(v)) props = v as Record<string, unknown>;
    } catch { /* keep the file as plain text */ }
  }
  const base = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.(md|markdown|txt)$/i, '');
  const sources: SourceLink[] = Array.isArray(props.sources)
    ? (props.sources as Record<string, unknown>[]).filter((s) => s && typeof s === 'object' && s.connector && s.id).map((s) => ({
      connector: String(s.connector),
      app: String(s.app ?? 'folder') as ConnectorKind,
      id: String(s.id),
      folder: str(s.folder),
      version: str(s.version),
      hash: str(s.hash),
      tagsHash: str(s['tags-hash']),
      synced: s.synced ? time(s.synced, 0) : undefined,
    }))
    : [];
  const tags = Array.isArray(props.tags) ? props.tags.map(String) : typeof props.tags === 'string' ? props.tags.split(/[,\s]+/) : [];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!RESERVED.has(k)) extra[k] = v;
  return {
    keeperId: typeof props['keeper-id'] === 'string' && props['keeper-id'] ? props['keeper-id'] : '',
    title: typeof props.title === 'string' && props.title ? props.title : base,
    body: norm(body.replace(/^\n/, '')),
    tags: normTags(tags),
    created: time(props.created, fallbackTime),
    modified: time(props.modified, fallbackTime),
    sources,
    locked: props.locked === true ? true : undefined,
    attachments: Array.isArray(props.attachments)
      ? (props.attachments as Record<string, unknown>[]).filter((a) => a && a.hash).map((a) => ({ name: String(a.name ?? a.hash), hash: String(a.hash), mime: str(a.mime) }))
      : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
    rel,
  };
}

/** A safe file name for a note title. */
export function safeName(title: string, max = 90): string {
  const s = title.replace(/[\u0000-\u001f\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, max).trim();
  return s || 'Untitled';
}

/** Where a note from an app is mirrored inside the hub: "<App>/<folder>/<title>.md". */
export function hubPathFor(appFolder: string, folder: string | undefined, title: string): string {
  const parts = (folder ?? '').split('/').map((p) => safeName(p, 60)).filter((p) => p && p !== 'Untitled');
  return [appFolder, ...parts, `${safeName(title)}.md`].join('/');
}

/** Picks a free name: "Shopping.md", "Shopping 2.md"… */
export function freeHubPath(want: string, taken: (rel: string) => boolean): string {
  if (!taken(want)) return want;
  const stem = want.replace(/\.md$/, '');
  for (let i = 2; i < 10_000; i++) if (!taken(`${stem} ${i}.md`)) return `${stem} ${i}.md`;
  return `${stem} ${Date.now()}.md`;
}

/** Content-addressed attachment path: attachments/ab/abcdef….png */
export function attachmentPath(hash: string, name: string): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  return `${ATTACH_DIR}/${hash.slice(0, 2)}/${hash}${ext ? '.' + ext : ''}`;
}

/** What a locked note looks like in the hub: never its text. */
export function lockedStub(appName: string): string {
  return `This note is locked in ${appName}. Keeper does not copy locked notes; open it in ${appName} to read it.`;
}
