// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Joplin: two-way through its Data API (the Web Clipper service on
// localhost:41184 with a token), and reading its sync folder or a JEX export
// (one .md "item" per note, notebook, tag and attachment, each ending in
// "key: value" lines).

import { randomBytes } from 'node:crypto';
import { ConnectorError, expectOk, type ConnectorIO, type FetchFn } from './io';
import type { RemoteNote } from '../types';

export const JOPLIN_DEFAULT_URL = 'http://127.0.0.1:41184';

export const JOPLIN_TYPE = { note: 1, folder: 2, resource: 4, tag: 5, noteTag: 6 } as const;

export interface JoplinItem {
  type: number;
  title: string;
  body: string;
  props: Record<string, string>;
}

const unescape = (v: string) => v.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

/** Reads one item file from a Joplin sync target or JEX. */
export function parseJoplinItem(text: string): JoplinItem {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const props: Record<string, string> = {};
  let i = lines.length - 1;
  for (; i >= 0; i--) {
    const l = lines[i];
    if (l === '') break;
    const m = /^([a-z_]+):\s?(.*)$/.exec(l);
    if (!m) break;
    props[m[1]] = unescape(m[2]);
  }
  const head = lines.slice(0, Math.max(0, i));
  const type = Number(props.type_) || 0;
  // Items with a title: the first line is the title, then a blank line, then the body.
  let title = '';
  let body = '';
  if (type === JOPLIN_TYPE.note || type === JOPLIN_TYPE.folder || type === JOPLIN_TYPE.tag || type === JOPLIN_TYPE.resource) {
    title = head[0] ?? '';
    body = head.slice(2).join('\n');
  }
  return { type, title, body, props };
}

const PROP_ORDER = ['id', 'parent_id', 'created_time', 'updated_time', 'is_conflict', 'latitude', 'longitude', 'altitude', 'author', 'source_url', 'is_todo', 'todo_due', 'todo_completed', 'source', 'source_application', 'application_data', 'order', 'user_created_time', 'user_updated_time', 'encryption_cipher_text', 'encryption_applied', 'markup_language', 'is_shared', 'share_id', 'conflict_original_id', 'master_key_id', 'note_id', 'tag_id', 'mime', 'filename', 'file_extension', 'size', 'icon', 'deleted_time'];

export function serializeJoplinItem(it: JoplinItem): string {
  const keys = [...PROP_ORDER.filter((k) => k in it.props), ...Object.keys(it.props).filter((k) => !PROP_ORDER.includes(k) && k !== 'type_')];
  const meta = keys.map((k) => `${k}: ${escape(it.props[k] ?? '')}`).concat(`type_: ${it.type}`).join('\n');
  if (it.type === JOPLIN_TYPE.noteTag) return meta;
  if (it.type === JOPLIN_TYPE.note) return `${it.title}\n\n${it.body}\n\n${meta}`;
  return `${it.title}\n\n${meta}`;
}

export const joplinId = () => randomBytes(16).toString('hex');
const isoOf = (t?: number) => new Date(t ?? Date.now()).toISOString();
const timeOf = (v?: string | number) => (v === undefined || v === '' ? undefined : typeof v === 'number' ? v : Date.parse(v) || Number(v) || undefined);

function folderPaths(folders: { id: string; parent_id?: string; title: string }[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, string>();
  const pathOf = (id: string, depth = 0): string => {
    if (out.has(id)) return out.get(id)!;
    const f = byId.get(id);
    if (!f || depth > 30) return '';
    const parent = f.parent_id ? pathOf(f.parent_id, depth + 1) : '';
    const p = parent ? `${parent}/${f.title}` : f.title;
    out.set(id, p);
    return p;
  };
  for (const f of folders) pathOf(f.id);
  return out;
}

/** Notes from a set of item files (sync folder or JEX). Encrypted items are counted, not read. */
export function notesFromItems(texts: string[]): { notes: RemoteNote[]; encrypted: number; resources: Map<string, { name: string; mime?: string; ext?: string }> } {
  const items = texts.map(parseJoplinItem);
  const folders = items.filter((i) => i.type === JOPLIN_TYPE.folder).map((i) => ({ id: i.props.id, parent_id: i.props.parent_id, title: i.title }));
  const paths = folderPaths(folders);
  const tags = new Map(items.filter((i) => i.type === JOPLIN_TYPE.tag).map((i) => [i.props.id, i.title]));
  const noteTags = new Map<string, string[]>();
  for (const i of items.filter((x) => x.type === JOPLIN_TYPE.noteTag)) {
    const t = tags.get(i.props.tag_id);
    if (!t) continue;
    noteTags.set(i.props.note_id, [...(noteTags.get(i.props.note_id) ?? []), t]);
  }
  const resources = new Map(items.filter((i) => i.type === JOPLIN_TYPE.resource).map((i) => [i.props.id, { name: i.props.filename || i.title || i.props.id, mime: i.props.mime, ext: i.props.file_extension }]));
  let encrypted = 0;
  const notes: RemoteNote[] = [];
  for (const i of items) {
    if (i.type !== JOPLIN_TYPE.note) continue;
    if (i.props.encryption_applied === '1') { encrypted++; notes.push({ sourceId: i.props.id, title: 'Encrypted note', body: '', tags: [], locked: true }); continue; }
    notes.push({
      sourceId: i.props.id,
      title: i.title,
      body: i.body,
      tags: noteTags.get(i.props.id) ?? [],
      created: timeOf(i.props.user_created_time || i.props.created_time),
      modified: timeOf(i.props.user_updated_time || i.props.updated_time),
      folder: paths.get(i.props.parent_id) || undefined,
      version: i.props.updated_time,
      trashed: !!i.props.deleted_time && i.props.deleted_time !== '0',
    });
  }
  return { notes, encrypted, resources };
}

/** Item files for a JEX export: one notebook ("Keeper export" or each folder), the notes and their tags. */
export function jexItems(notes: { title: string; body: string; tags: string[]; created: number; modified: number; folder?: string }[], rootName = 'Keeper export'): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const folderIds = new Map<string, string>();
  const folderFor = (p: string): string => {
    const key = p || rootName;
    const have = folderIds.get(key);
    if (have) return have;
    const parts = key.split('/');
    const parent = parts.length > 1 ? folderFor(parts.slice(0, -1).join('/')) : '';
    const id = joplinId();
    folderIds.set(key, id);
    const now = isoOf();
    out.push({ name: `${id}.md`, text: serializeJoplinItem({ type: JOPLIN_TYPE.folder, title: parts[parts.length - 1], body: '', props: { id, parent_id: parent, created_time: now, updated_time: now, user_created_time: now, user_updated_time: now, encryption_applied: '0' } }) });
    return id;
  };
  const tagIds = new Map<string, string>();
  for (const n of notes) {
    const parent = folderFor(n.folder ?? '');
    const id = joplinId();
    out.push({ name: `${id}.md`, text: serializeJoplinItem({ type: JOPLIN_TYPE.note, title: n.title, body: n.body, props: { id, parent_id: parent, created_time: isoOf(n.created), updated_time: isoOf(n.modified), user_created_time: isoOf(n.created), user_updated_time: isoOf(n.modified), is_conflict: '0', is_todo: '0', encryption_applied: '0', markup_language: '1' } }) });
    for (const t of n.tags) {
      let tid = tagIds.get(t);
      if (!tid) {
        tid = joplinId();
        tagIds.set(t, tid);
        const now = isoOf();
        out.push({ name: `${tid}.md`, text: serializeJoplinItem({ type: JOPLIN_TYPE.tag, title: t, body: '', props: { id: tid, created_time: now, updated_time: now, encryption_applied: '0' } }) });
      }
      const nt = joplinId();
      const now = isoOf();
      out.push({ name: `${nt}.md`, text: serializeJoplinItem({ type: JOPLIN_TYPE.noteTag, title: '', body: '', props: { id: nt, note_id: id, tag_id: tid, created_time: now, updated_time: now, encryption_applied: '0' } }) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the Data API

interface ApiPage<T> { items: T[]; has_more: boolean }
interface ApiNote { id: string; parent_id: string; title: string; body: string; created_time: number; updated_time: number; user_created_time?: number; user_updated_time?: number; is_conflict?: number; encryption_applied?: number; deleted_time?: number }

export class JoplinApi implements ConnectorIO {
  constructor(private base: string, private token: string, private fetch: FetchFn) {
    this.base = (base || JOPLIN_DEFAULT_URL).replace(/\/+$/, '');
  }

  private url(p: string, q: Record<string, string | number> = {}) {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])), token: this.token });
    return `${this.base}${p}?${qs}`;
  }

  private async all<T>(p: string, fields: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page < 1000; page++) {
      const r = await expectOk(await this.fetch(this.url(p, { fields, page, limit: 100 })).catch(() => { throw new ConnectorError('unreachable', 'Joplin is not answering. Is it running with the Web Clipper service on?'); }), 'Joplin');
      const j = (await r.json()) as ApiPage<T>;
      out.push(...(j.items ?? []));
      if (!j.has_more) break;
    }
    return out;
  }

  async test(): Promise<string> {
    const r = await this.fetch(`${this.base}/ping`).catch(() => null);
    if (!r?.ok || !/JoplinClipperServer/.test(await r.text())) throw new ConnectorError('unreachable', 'Joplin is not answering. Open Joplin and turn on the Web Clipper service.');
    const notes = await this.all<{ id: string }>('/notes', 'id');
    return `Connected: ${notes.length} note${notes.length === 1 ? '' : 's'}`;
  }

  async list() {
    const folders = await this.all<{ id: string; parent_id: string; title: string }>('/folders', 'id,parent_id,title');
    const paths = folderPaths(folders);
    const notes = await this.all<ApiNote>('/notes', 'id,parent_id,title,body,created_time,updated_time,user_created_time,user_updated_time,is_conflict,encryption_applied');
    const tags = await this.all<{ id: string; title: string }>('/tags', 'id,title');
    const byNote = new Map<string, string[]>();
    for (const t of tags) {
      for (const n of await this.all<{ id: string }>(`/tags/${t.id}/notes`, 'id')) byNote.set(n.id, [...(byNote.get(n.id) ?? []), t.title]);
    }
    this.tagIds = new Map(tags.map((t) => [t.title.toLowerCase(), t.id]));
    this.noteTags = byNote;
    return {
      complete: true,
      notes: notes.filter((n) => !n.is_conflict).map((n): RemoteNote => (n.encryption_applied
        ? { sourceId: n.id, title: n.title || 'Encrypted note', body: '', tags: [], locked: true }
        : { sourceId: n.id, title: n.title, body: n.body, tags: byNote.get(n.id) ?? [], created: n.user_created_time ?? n.created_time, modified: n.user_updated_time ?? n.updated_time, folder: paths.get(n.parent_id) || undefined, version: String(n.updated_time) })),
    };
  }

  private tagIds = new Map<string, string>();
  private noteTags = new Map<string, string[]>();

  private async send(method: string, p: string, body?: unknown) {
    const r = await expectOk(await this.fetch(this.url(p), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), 'Joplin');
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  private async setTags(noteId: string, tags: string[]) {
    const have = new Set((this.noteTags.get(noteId) ?? []).map((t) => t.toLowerCase()));
    const want = new Set(tags.map((t) => t.toLowerCase()));
    for (const t of tags) {
      if (have.has(t.toLowerCase())) continue;
      let id = this.tagIds.get(t.toLowerCase());
      if (!id) { id = ((await this.send('POST', '/tags', { title: t })) as { id: string }).id; this.tagIds.set(t.toLowerCase(), id); }
      await this.send('POST', `/tags/${id}/notes`, { id: noteId });
    }
    for (const t of have) if (!want.has(t)) { const id = this.tagIds.get(t); if (id) await this.send('DELETE', `/tags/${id}/notes/${noteId}`); }
    this.noteTags.set(noteId, tags);
  }

  async create(n: RemoteNote) {
    const r = (await this.send('POST', '/notes', { title: n.title, body: n.body })) as ApiNote;
    if (n.tags.length) await this.setTags(r.id, n.tags);
    return { sourceId: r.id, version: r.updated_time ? String(r.updated_time) : undefined };
  }

  async update(n: RemoteNote) {
    const r = (await this.send('PUT', `/notes/${n.sourceId}`, { title: n.title, body: n.body })) as ApiNote | null;
    await this.setTags(n.sourceId, n.tags);
    return { version: r?.updated_time ? String(r.updated_time) : undefined };
  }

  async remove(id: string) {
    await this.send('DELETE', `/notes/${id}`);
  }
}
