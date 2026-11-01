// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Import-only sources: Google Keep (Takeout), Samsung Notes (exported files)
// and Notesnook (exports and unencrypted backups). Nothing is ever written to
// these apps; the interface says so.

import { htmlToMarkdown, parseHtml, textContent, type HNode } from '../markdown';
import { firstLineTitle } from './io';
import { folderNoteFromFile } from './folder';
import type { Attachment, RemoteNote } from '../types';

// ---------------------------------------------------------------- Google Keep

export interface KeepJson {
  title?: string;
  textContent?: string;
  textContentHtml?: string;
  listContent?: { text: string; isChecked: boolean }[];
  labels?: { name: string }[];
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  color?: string;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
  attachments?: { filePath: string; mimetype: string }[];
  annotations?: { url?: string; title?: string }[];
}

/** One Takeout Keep note (the .json file next to its .html). */
export function fromKeepJson(fileName: string, j: KeepJson, files?: (name: string) => Uint8Array | undefined): RemoteNote {
  let body = j.textContent ?? '';
  if (j.listContent?.length) body = j.listContent.map((i) => `- [${i.isChecked ? 'x' : ' '}] ${i.text}`).join('\n') + (body ? `\n\n${body}` : '');
  for (const a of j.annotations ?? []) if (a.url) body += `\n\n[${a.title || a.url}](${a.url})`;
  const attachments: Attachment[] = [];
  for (const a of j.attachments ?? []) {
    const data = files?.(a.filePath);
    if (data) { attachments.push({ name: a.filePath, mime: a.mimetype, data, sourceRef: a.filePath }); body += `\n\n![${a.filePath}](attachment:${a.filePath})`; }
  }
  const created = j.createdTimestampUsec ? Math.round(j.createdTimestampUsec / 1000) : undefined;
  const modified = j.userEditedTimestampUsec ? Math.round(j.userEditedTimestampUsec / 1000) : created;
  const t = j.title?.trim() ? { title: j.title.trim(), body } : firstLineTitle(body);
  return {
    sourceId: fileName.replace(/\.json$/i, ''),
    title: t.title || 'Untitled', body: t.body.replace(/^\n+/, ''),
    tags: (j.labels ?? []).map((l) => l.name),
    created, modified, version: String(j.userEditedTimestampUsec ?? ''),
    folder: j.isArchived ? 'Archive' : undefined,
    trashed: !!j.isTrashed,
    attachments: attachments.length ? attachments : undefined,
  };
}

const findClass = (n: HNode, cls: string): HNode | undefined => {
  if ((n.attrs.class ?? '').split(/\s+/).includes(cls)) return n;
  for (const c of n.children) { const f = findClass(c, cls); if (f) return f; }
  return undefined;
};

/** The .html file of a Takeout Keep note, for exports without .json files. */
export function fromKeepHtml(fileName: string, html: string): RemoteNote {
  const tree = parseHtml(html);
  const title = findClass(tree, 'title');
  const content = findClass(tree, 'content');
  const labels: string[] = [];
  const walk = (n: HNode) => { if ((n.attrs.class ?? '').includes('label-name')) labels.push(textContent(n).trim()); n.children.forEach(walk); };
  walk(tree);
  const body = content ? htmlToMarkdown(content.children.map(serialize).join('')) : htmlToMarkdown(html);
  const t = title ? { title: textContent(title).trim(), body } : firstLineTitle(body);
  return { sourceId: fileName.replace(/\.html?$/i, ''), title: t.title || 'Untitled', body: t.body, tags: labels };
}

function serialize(n: HNode): string {
  if (n.name === '#text') return (n.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
  return `<${n.name}${attrs}>${n.children.map(serialize).join('')}</${n.name}>`;
}

/** A whole Takeout Keep folder: the .json files, or the .html ones when there are no .json. */
export function fromKeepTakeout(files: { name: string; text: string }[], binary?: (name: string) => Uint8Array | undefined): RemoteNote[] {
  const json = files.filter((f) => /\.json$/i.test(f.name));
  if (json.length) {
    const out: RemoteNote[] = [];
    for (const f of json) {
      try {
        const j = JSON.parse(f.text) as KeepJson;
        if (typeof j !== 'object' || (!('textContent' in j) && !('listContent' in j) && !('title' in j))) continue;
        out.push(fromKeepJson(f.name, j, binary));
      } catch { /* not a note */ }
    }
    return out;
  }
  return files.filter((f) => /\.html?$/i.test(f.name) && !/index\.html$/i.test(f.name)).map((f) => fromKeepHtml(f.name, f.text));
}

// ---------------------------------------------------------------- Samsung Notes

/** Notes exported from Samsung Notes as .txt, .html or .md (title from the file name). */
export function fromSamsungFile(rel: string, text: string, mtime: number): RemoteNote | null {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const title = name.replace(/\.(txt|html?|md)$/i, '').replace(/_\d{6,}$/, '');
  if (/\.html?$/i.test(name)) {
    const md = htmlToMarkdown(text);
    return { sourceId: rel, title, body: md, tags: [], modified: mtime, version: String(Math.round(mtime)) };
  }
  if (/\.(txt|md)$/i.test(name)) return { ...folderNoteFromFile(rel, text, mtime, text.length), title, folder: undefined };
  return null;
}

// ---------------------------------------------------------------- Notesnook

interface NnItem { id: string; type: string; title?: string; contentId?: string; data?: string; dateCreated?: number; dateEdited?: number; dateModified?: number; tags?: string[]; deleted?: boolean; locked?: boolean; noteId?: string; itemId?: string; fromId?: string; fromType?: string; toId?: string; toType?: string; notebooks?: unknown }

/** An unencrypted Notesnook backup (.nnbackup / JSON). */
export function fromNotesnookBackup(text: string): { notes: RemoteNote[]; encrypted: boolean } {
  let j: Record<string, unknown>;
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error('This is not a Notesnook backup file.'); }
  if (j.encrypted === true || (typeof j.data === 'object' && j.data && 'cipher' in (j.data as object))) return { notes: [], encrypted: true };
  let raw: unknown = j.data ?? j;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new Error('This Notesnook backup is compressed or encrypted; export as Markdown instead.'); } }
  const items: NnItem[] = Array.isArray(raw) ? (raw as NnItem[]) : Object.values(raw as Record<string, NnItem>).filter((v) => v && typeof v === 'object');
  const content = new Map<string, NnItem>();
  const tagNames = new Map<string, string>();
  const relTags = new Map<string, string[]>();
  for (const it of items) {
    if (it.type === 'tiptap' || it.type === 'content') content.set(it.id, it);
    if (it.type === 'tag') tagNames.set(it.id, it.title ?? '');
  }
  for (const it of items) {
    if (it.type === 'relation' && it.fromType === 'tag' && it.toType === 'note' && it.fromId && it.toId) relTags.set(it.toId, [...(relTags.get(it.toId) ?? []), tagNames.get(it.fromId) ?? '']);
  }
  const notes: RemoteNote[] = [];
  for (const it of items) {
    if (it.type !== 'note') continue;
    const c = it.contentId ? content.get(it.contentId) : [...content.values()].find((x) => x.noteId === it.id);
    const locked = !!it.locked || (c && typeof c.data !== 'string');
    notes.push({
      sourceId: it.id, title: it.title || 'Untitled',
      body: locked || !c ? '' : htmlToMarkdown(String(c.data ?? '')),
      tags: [...(it.tags ?? []), ...(relTags.get(it.id) ?? [])].filter(Boolean),
      created: it.dateCreated, modified: it.dateEdited ?? it.dateModified, version: String(it.dateEdited ?? it.dateModified ?? ''),
      locked: locked || undefined, trashed: !!it.deleted,
    });
  }
  return { notes, encrypted: false };
}

/** A note from a Notesnook Markdown or HTML export file. */
export function fromNotesnookFile(rel: string, text: string, mtime: number): RemoteNote | null {
  if (/\.md$/i.test(rel)) {
    const n = folderNoteFromFile(rel, text, mtime, text.length);
    const p = n.props ?? {};
    const title = typeof p.title === 'string' ? p.title : n.title;
    const created = typeof p.created_at === 'string' ? Date.parse(p.created_at) : undefined;
    const modified = typeof p.updated_at === 'string' ? Date.parse(p.updated_at) : n.modified;
    const { title: _a, created_at: _b, updated_at: _c, ...rest } = p;
    void _a; void _b; void _c;
    return { ...n, title, created, modified, props: Object.keys(rest).length ? rest : undefined };
  }
  if (/\.html?$/i.test(rel)) {
    const tree = parseHtml(text);
    const t = /<title>([^<]*)<\/title>/i.exec(text)?.[1];
    const name = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.html?$/i, '');
    void tree;
    return { sourceId: rel, title: t?.trim() || name, body: htmlToMarkdown(text), tags: [], modified: mtime, version: String(Math.round(mtime)) };
  }
  if (/\.txt$/i.test(rel)) return folderNoteFromFile(rel, text, mtime, text.length);
  return null;
}
