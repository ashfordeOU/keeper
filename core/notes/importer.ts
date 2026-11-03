// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Bringing notes from other apps into a vault. Each reader turns what an app
// exports (a set of files: a folder, a .zip, a .jex, one .enex…) into notes;
// the planner turns notes into vault files: Markdown with properties on top,
// pictures and files stored next to them, links between the imported notes
// rewritten as [[links]]. Pure: the main process reads and writes the disk.

import { parseEnex, ATTACHMENT_REF } from '../notes-sync/connectors/evernote';
import { fromKeepTakeout, fromNotesnookBackup, fromNotesnookFile } from '../notes-sync/connectors/imports';
import { firstLineTitle, inlineTags } from '../notes-sync/connectors/io';
import { notesFromItems } from '../notes-sync/connectors/joplin';
import { parseSnBackup } from '../notes-sync/connectors/standardnotes';
import { htmlToMarkdown } from '../notes-sync/markdown';
import { safeName } from '../notes-sync/hub';
import type { Attachment, RemoteNote } from '../notes-sync/types';
import { splitFrontmatter } from './parse';
import { parseYaml, stringifyYaml, type YamlValue } from './yaml';
import type { ImportSourceId } from './import-sources';

/** One file of an export: its path inside the export ("/"-separated) and bytes. */
export interface SourceFile { rel: string; data: Uint8Array; mtime?: number }

/** What a reader found. */
export interface ImportBundle {
  notes: RemoteNote[];
  /** files copied as they are (a Markdown vault keeps its own layout) */
  raw?: { rel: string; data: Uint8Array; note?: boolean; mtime?: number }[];
  skipped?: { title: string; why: string }[];
}

export interface PlannedFile { path: string; data: Uint8Array; note: boolean; mtime?: number }

export interface ImportPlan {
  files: PlannedFile[];
  notes: number;
  attachments: number;
  skipped: { title: string; why: string }[];
}

const dec = new TextDecoder();
const enc = new TextEncoder();
const text = (f: SourceFile) => dec.decode(f.data).replace(/^﻿/, '');
const base = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const extOf = (rel: string) => (/\.([^./]+)$/.exec(rel)?.[1] ?? '').toLowerCase();
const hidden = (rel: string) => rel.split('/').some((p) => p.startsWith('.') || p === '__MACOSX');
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };

/** Joins a relative link onto the folder of the file it is written in ("a/b" + "../c.png" → "a/c.png"). */
export function joinRel(dir: string, href: string): string {
  const out = dir ? dir.split('/') : [];
  for (const p of href.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

const decodeHref = (h: string) => { try { return decodeURIComponent(h); } catch { return h; } };

/** The relative links (pictures and files) a Markdown body points at, with the exact text written. */
function localRefs(body: string): string[] {
  const out = new Set<string>();
  const re = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1]) && !m[1].startsWith('#')) out.add(m[1]);
  return [...out];
}

/** Gives a note the files its relative links point at (from the export's own files). */
function attachLocal(n: RemoteNote, noteRel: string, files: Map<string, SourceFile>): RemoteNote {
  const atts: Attachment[] = [...(n.attachments ?? [])];
  for (const href of localRefs(n.body)) {
    const f = files.get(joinRel(dirOf(noteRel), decodeHref(href))) ?? files.get(joinRel(dirOf(noteRel), href));
    if (!f || atts.some((a) => a.sourceRef === href)) continue;
    atts.push({ name: base(f.rel), mime: MIME[extOf(f.rel)], data: f.data, sourceRef: href });
  }
  return atts.length ? { ...n, attachments: atts } : n;
}

// ---------------------------------------------------------------- readers

/** A Markdown folder or vault: copied exactly as it is (notes, pictures, sub-folders). */
export function readMarkdownFolder(files: SourceFile[]): ImportBundle {
  const raw = files.filter((f) => !hidden(f.rel)).map((f) => ({ rel: f.rel, data: f.data, mtime: f.mtime, note: /\.(md|markdown)$/i.test(f.rel) }));
  return { notes: [], raw: raw.map((r) => (r.note || !/\.txt$/i.test(r.rel) ? r : { ...r, rel: r.rel.replace(/\.txt$/i, '.md'), note: true })) };
}

/** Notes saved as files (Markdown, text or HTML) with their pictures: Apple Notes and Samsung Notes exports. */
export function readNoteFiles(files: SourceFile[]): ImportBundle {
  const all = new Map(files.map((f) => [f.rel, f]));
  const notes: RemoteNote[] = [];
  for (const f of files) {
    if (hidden(f.rel)) continue;
    const ext = extOf(f.rel);
    const title = base(f.rel).replace(/\.[^.]+$/, '').replace(/_\d{6,}$/, '');
    const folder = dirOf(f.rel) || undefined;
    let n: RemoteNote | null = null;
    if (ext === 'md' || ext === 'markdown') {
      const { yaml, body } = splitFrontmatter(text(f));
      let props: Record<string, unknown> | undefined;
      if (yaml) { try { const v = parseYaml(yaml); if (v && typeof v === 'object' && !Array.isArray(v)) props = v as Record<string, unknown>; } catch { /* keep as text */ } }
      const tags = Array.isArray(props?.tags) ? (props!.tags as unknown[]).map(String) : [];
      if (props) delete props.tags;
      n = { sourceId: f.rel, title, body: (props ? body : text(f)).trim(), tags, modified: f.mtime, folder, props: props && Object.keys(props).length ? props : undefined };
    } else if (ext === 'txt') {
      n = { sourceId: f.rel, title, body: text(f).replace(/\r\n?/g, '\n').trim(), tags: [], modified: f.mtime, folder };
    } else if (ext === 'html' || ext === 'htm') {
      const html = text(f);
      const t = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      let body = htmlToMarkdown(html.replace(/<head[\s\S]*?<\/head>/i, ''));
      const h1 = /^# (.+)\n*/.exec(body);
      const name = t || h1?.[1] || title;
      if (h1 && h1[1].trim() === name) body = body.slice(h1[0].length);
      n = { sourceId: f.rel, title: name, body, tags: [], modified: f.mtime, folder };
    }
    if (n) notes.push(attachLocal(n, f.rel, all));
  }
  return { notes };
}

/** Evernote: one or more .enex files (the file name is the notebook). */
export function readEnexFiles(files: SourceFile[]): ImportBundle {
  const notes: RemoteNote[] = [];
  for (const f of files.filter((x) => /\.enex$/i.test(x.rel))) notes.push(...parseEnex(text(f), base(f.rel).replace(/\.enex$/i, '')));
  if (!notes.length && !files.some((x) => /\.enex$/i.test(x.rel))) throw new Error('No .enex files there. Export a notebook from Evernote first.');
  return { notes };
}

/** Joplin: a .jex (its tar entries) or a sync folder: item files plus resources. */
export function readJoplin(files: SourceFile[]): ImportBundle {
  const items = files.filter((f) => /(^|\/)[0-9a-f]{32}\.md$/.test(f.rel));
  if (!items.length) throw new Error('No Joplin notes there. Export as JEX from Joplin first.');
  const { notes, resources } = notesFromItems(items.map(text));
  const data = new Map<string, Uint8Array>();
  for (const f of files) {
    const m = /(?:^|\/)(?:resources|\.resource)\/([0-9a-f]{32})(?:\.[^/]*)?$/.exec(f.rel);
    if (m) data.set(m[1], f.data);
  }
  const skipped: { title: string; why: string }[] = [];
  const out = notes.map((n) => {
    const atts: Attachment[] = [];
    for (const m of n.body.matchAll(/\(:\/([0-9a-f]{32})\)/g)) {
      const r = resources.get(m[1]);
      if (!r || atts.some((a) => a.sourceRef === m[1])) continue;
      const bytes = data.get(m[1]);
      if (!bytes) { skipped.push({ title: `${n.title}: ${r.name}`, why: 'The attachment was not in the export' }); continue; }
      const name = /\.[^.]+$/.test(r.name) ? r.name : `${r.name}.${r.ext || 'bin'}`;
      atts.push({ name, mime: r.mime, data: bytes, sourceRef: m[1] });
    }
    return atts.length ? { ...n, attachments: atts } : n;
  });
  return { notes: out, skipped };
}

/** A Standard Notes backup (decrypted; or encrypted, with the key made from the password). */
export function readStandardNotes(files: SourceFile[], masterKey?: string): ImportBundle & { needsPassword?: boolean } {
  const f = files.find((x) => /\.(txt|json)$/i.test(x.rel)) ?? files[0];
  if (!f) throw new Error('Choose the backup file.');
  const r = parseSnBackup(text(f), masterKey);
  if (r.needsPassword) return { notes: [], needsPassword: true };
  if (r.encrypted && !r.notes.length && r.skipped) throw new Error('That password does not open this backup.');
  return { notes: r.notes };
}

/** Notesnook: Markdown or HTML exports (with their pictures) or an unencrypted backup. */
export function readNotesnook(files: SourceFile[]): ImportBundle {
  const all = new Map(files.map((f) => [f.rel, f]));
  const notes: RemoteNote[] = [];
  for (const f of files) {
    if (hidden(f.rel)) continue;
    if (/\.(json|nnbackup)$/i.test(f.rel)) {
      const r = fromNotesnookBackup(text(f));
      if (r.encrypted) throw new Error('This Notesnook backup is encrypted. Make an unencrypted backup, or export as Markdown.');
      notes.push(...r.notes);
      continue;
    }
    const n = fromNotesnookFile(f.rel, text(f), f.mtime ?? 0);
    if (n && /\.(md|html?|txt)$/i.test(f.rel)) notes.push(attachLocal({ ...n, folder: dirOf(f.rel) || undefined }, f.rel, all));
  }
  return { notes };
}

/** Google Keep from Takeout: the .json notes with their pictures (or the .html ones). */
export function readKeep(files: SourceFile[]): ImportBundle {
  const bin = new Map(files.map((f) => [base(f.rel), f.data]));
  const notes = fromKeepTakeout(files.filter((f) => /\.(json|html?)$/i.test(f.rel)).map((f) => ({ name: base(f.rel), text: text(f) })), (n) => bin.get(base(n)));
  if (!notes.length) throw new Error('No Keep notes there. Choose the Keep folder from Takeout.');
  return { notes };
}

interface SimplenoteExport { activeNotes?: SimpleNote[]; trashedNotes?: SimpleNote[] }
interface SimpleNote { id: string; content: string; creationDate?: string; lastModified?: string; tags?: string[]; markdown?: boolean; pinned?: boolean }

/** Simplenote's export: notes.json (activeNotes, trashedNotes), or its folder of .txt notes. */
export function readSimplenote(files: SourceFile[]): ImportBundle {
  const json = files.find((f) => /(^|\/)notes\.json$/i.test(f.rel)) ?? files.find((f) => /\.json$/i.test(f.rel));
  if (json) {
    let j: SimplenoteExport;
    try { j = JSON.parse(text(json)) as SimplenoteExport; } catch { throw new Error('This is not a Simplenote export.'); }
    if (!Array.isArray(j.activeNotes)) throw new Error('This is not a Simplenote export.');
    const map = (s: SimpleNote, trashed: boolean): RemoteNote => {
      const { title, body } = firstLineTitle(s.content ?? '');
      const created = s.creationDate ? Date.parse(s.creationDate) : undefined;
      const modified = s.lastModified ? Date.parse(s.lastModified) : created;
      return { sourceId: s.id, title, body, tags: s.tags ?? [], created, modified, trashed, props: s.pinned ? { pinned: true } : undefined };
    };
    return { notes: [...j.activeNotes.map((s) => map(s, false)), ...(j.trashedNotes ?? []).map((s) => map(s, true))] };
  }
  const txt = files.filter((f) => /\.txt$/i.test(f.rel) && !hidden(f.rel));
  if (!txt.length) throw new Error('No Simplenote notes there. Choose the export .zip or notes.json.');
  return { notes: txt.map((f) => { const { title, body } = firstLineTitle(text(f)); return { sourceId: f.rel, title, body, tags: [], modified: f.mtime }; }) };
}

/** Bear tags written in the text: #tag, #nested/tag and #tag with spaces#. */
export function bearTags(body: string): string[] {
  const out = new Set<string>();
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const m of noCode.matchAll(/(^|\s)#([^\s#][^#\n]*?[^\s#])#(?=\s|$)/gm)) out.add(m[2].trim());
  for (const t of inlineTags(noCode.replace(/(^|\s)#([^\s#][^#\n]*?[^\s#])#(?=\s|$)/gm, '$1'))) out.add(t);
  return [...out];
}

/** Bear's export: Markdown files, or TextBundles (a folder with text.md and assets/). */
export function readBear(files: SourceFile[]): ImportBundle {
  const all = new Map(files.map((f) => [f.rel, f]));
  const notes: RemoteNote[] = [];
  for (const f of files) {
    if (hidden(f.rel)) continue;
    const bundle = /^(.*?)([^/]+)\.textbundle\/text\.(md|markdown|txt)$/i.exec(f.rel);
    if (!bundle && (!/\.(md|markdown)$/i.test(f.rel) || /\.textbundle\//i.test(f.rel))) continue;
    const raw = text(f).replace(/\r\n?/g, '\n');
    const first = /^# (.+)\n*/.exec(raw);
    const title = first?.[1].trim() || (bundle ? bundle[2] : base(f.rel).replace(/\.[^.]+$/, ''));
    const body = first ? raw.slice(first[0].length) : raw;
    // Bear's own syntax for highlights is ::text::; Markdown vaults write ==text==.
    const md = body.replace(/::([^:\n]+)::/g, '==$1==');
    const n: RemoteNote = { sourceId: f.rel, title, body: md.trim(), tags: bearTags(md), modified: f.mtime, folder: bundle ? (bundle[1].replace(/\/$/, '') || undefined) : dirOf(f.rel) || undefined };
    notes.push(attachLocal(n, f.rel, all));
  }
  if (!notes.length) throw new Error('No Bear notes there. Export as Markdown or TextBundle.');
  return { notes };
}

/** Picks the reader for an app's files. */
export function readImport(source: ImportSourceId, files: SourceFile[], opts: { masterKey?: string } = {}): ImportBundle & { needsPassword?: boolean } {
  switch (source) {
    case 'markdown': return readMarkdownFolder(files);
    case 'applenotes-export': case 'samsung': return readNoteFiles(files);
    case 'evernote': return readEnexFiles(files);
    case 'joplin-jex': return readJoplin(files);
    case 'standardnotes': return readStandardNotes(files, opts.masterKey);
    case 'notesnook': return readNotesnook(files);
    case 'keep': return readKeep(files);
    case 'simplenote': return readSimplenote(files);
    case 'bear': return readBear(files);
    default: throw new Error('This app is read directly, not from files.');
  }
}

// ---------------------------------------------------------------- the plan

const iso = (t?: number) => (t && Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined);
const tagName = (t: string) => t.trim().replace(/^#/, '').replace(/\s+/g, '-').replace(/[,#]/g, '');
const EMBED = /^(png|jpe?g|gif|webp|bmp|svg|avif|heic|pdf|mp3|m4a|wav|ogg|webm|mp4|mov)$/i;

/** Notion's page ids appear with and without dashes, at the end of their links. */
const idKey = (s: string) => s.replace(/-/g, '').toLowerCase();

/**
 * Notes → vault files under `folder`. `taken` says which vault paths exist
 * already, so nothing is ever overwritten. Locked and trashed notes are
 * skipped and listed with the reason.
 */
export function planImport(bundle: ImportBundle, opts: { folder: string; app: string; taken?: (path: string) => boolean }): ImportPlan {
  const root = opts.folder.replace(/^\/+|\/+$/g, '');
  const used = new Set<string>();
  const usedLower = new Set<string>();
  const free = (want: string): string => {
    let p = want;
    const dot = want.lastIndexOf('.');
    const stem = dot > want.lastIndexOf('/') ? want.slice(0, dot) : want;
    const ext = dot > want.lastIndexOf('/') ? want.slice(dot) : '';
    for (let i = 2; usedLower.has(p.toLowerCase()) || opts.taken?.(p); i++) p = `${stem} ${i}${ext}`;
    used.add(p);
    usedLower.add(p.toLowerCase());
    return p;
  };
  const under = (rel: string) => (root ? `${root}/${rel}` : rel);
  const files: PlannedFile[] = [];
  const skipped = [...(bundle.skipped ?? [])];

  for (const r of bundle.raw ?? []) {
    const p = free(under(r.rel));
    files.push({ path: p, data: r.data, note: !!r.note, mtime: r.mtime });
  }

  // First pass: where each note goes, so links between them can be rewritten.
  const keep = bundle.notes.filter((n) => {
    if (n.locked) { skipped.push({ title: n.title, why: 'Locked in the app, so its text cannot be read' }); return false; }
    if (n.trashed) { skipped.push({ title: n.title, why: 'In the app’s trash' }); return false; }
    return true;
  });
  const pathOf = new Map<RemoteNote, string>();
  for (const n of keep) {
    const dir = (n.folder ?? '').split('/').map((p) => safeName(p, 60)).filter((p) => p && p !== 'Untitled').join('/');
    pathOf.set(n, free(under(`${dir ? `${dir}/` : ''}${safeName(n.title)}.md`)));
  }
  const bySource = new Map<string, RemoteNote>();
  const byTitle = new Map<string, RemoteNote>();
  for (const n of keep) {
    bySource.set(n.sourceId, n);
    bySource.set(idKey(n.sourceId), n);
    if (!byTitle.has(n.title.toLowerCase())) byTitle.set(n.title.toLowerCase(), n);
  }
  // Names that occur once can be linked by name alone; others need their folder.
  const nameCount = new Map<string, number>();
  for (const p of pathOf.values()) { const b = base(p).toLowerCase(); nameCount.set(b, (nameCount.get(b) ?? 0) + 1); }
  const linkName = (n: RemoteNote) => { const p = pathOf.get(n)!; return (nameCount.get(base(p).toLowerCase())! > 1 ? p : base(p)).replace(/\.md$/, ''); };

  // Attachments go in one folder; the same bytes are stored once.
  const attDir = under('attachments');
  const stored = new Map<string, string>();
  let attachments = 0;
  const storeAtt = (a: Attachment): string | null => {
    if (!a.data) return null;
    const key = `${a.data.length}:${hashBytes(a.data)}`;
    const have = stored.get(key);
    if (have) return have;
    const dot = a.name.lastIndexOf('.');
    const nm = dot > 0 ? `${safeName(a.name.slice(0, dot), 80)}${a.name.slice(dot).replace(/[^\w.]/g, '')}` : safeName(a.name, 80);
    const p = free(`${attDir}/${nm}`);
    files.push({ path: p, data: a.data, note: false });
    stored.set(key, p);
    attachments++;
    return p;
  };

  for (const n of keep) {
    let body = n.body.replace(/\r\n?/g, '\n');
    const atts = n.attachments ?? [];
    const mentioned = new Set<Attachment>();
    const attFor = (ref: string): string | null | undefined => {
      const r = ref.startsWith(ATTACHMENT_REF) ? ref.slice(ATTACHMENT_REF.length) : ref.startsWith(':/') ? ref.slice(2) : ref;
      const a = atts.find((x) => x.sourceRef === r || x.sourceRef === ref || x.name === r || x.sourceRef === decodeHref(ref));
      if (!a) return undefined;
      mentioned.add(a);
      const p = storeAtt(a);
      if (!p) skipped.push({ title: `${n.title}: ${a.name}`, why: 'The attachment had no data in the export' });
      return p;
    };
    const noteFor = (href: string): RemoteNote | undefined => {
      if (href.startsWith(':/')) return bySource.get(href.slice(2));
      const notion = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i.exec(href);
      if (notion && /notion\.(so|site)|^notion:/i.test(href)) return bySource.get(idKey(notion[1]));
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && /\.(md|markdown|txt|html?)$/i.test(decodeHref(href))) {
        const t = base(decodeHref(href)).replace(/\.[^.]+$/, '').toLowerCase();
        return byTitle.get(t);
      }
      return undefined;
    };
    // ![alt](ref) and [text](ref): attachments become embeds or links, notes become [[links]].
    body = body.replace(/(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (all, bang: string, label: string, href: string) => {
      const a = attFor(href);
      if (a) return `${bang || EMBED.test(extOf(a)) ? '!' : ''}[[${base(a)}]]`;
      if (a === null) return all;
      const target = noteFor(href);
      if (target) {
        const name = linkName(target);
        const shown = label.replace(/\\([*_`\\])/g, '$1').trim();
        return shown && shown !== name && shown !== target.title ? `[[${name}|${shown}]]` : `[[${name}]]`;
      }
      // Evernote's own note links carry no id we can read: a link whose text is an imported note's title links to it.
      if (/^evernote:/i.test(href)) { const t = byTitle.get(label.trim().toLowerCase()); if (t) return `[[${linkName(t)}]]`; }
      return all;
    });
    // Attachments the body never mentioned are still kept, listed at the end.
    const unmentioned = atts.filter((a) => a.data && !mentioned.has(a));
    if (unmentioned.length) body += `\n\n${unmentioned.map((a) => storeAtt(a)).filter(Boolean).map((p) => `${EMBED.test(extOf(p!)) ? '!' : ''}[[${base(p!)}]]`).join('\n')}`;

    const props: Record<string, YamlValue> = {};
    const file = pathOf.get(n)!;
    if (safeName(n.title) !== n.title) props.aliases = [n.title];
    const tags = [...new Set(n.tags.map(tagName).filter(Boolean))];
    if (tags.length) props.tags = tags;
    const c = iso(n.created); const m = iso(n.modified);
    if (c) props.created = c;
    if (m) props.modified = m;
    props.source = opts.app;
    for (const [k, v] of Object.entries(n.props ?? {})) if (!(k in props) && v !== undefined) props[k] = v as YamlValue;
    const fm = `---\n${stringifyYaml(props)}---\n`;
    files.push({ path: file, data: enc.encode(`${fm}${body.replace(/^\n+/, '').replace(/\s+$/, '')}\n`), note: true, mtime: n.modified });
  }

  const notes = files.filter((f) => f.note).length;
  return { files, notes, attachments: attachments + files.filter((f) => !f.note && !f.path.startsWith(`${attDir}/`)).length, skipped };
}

/** A short, fast fingerprint of bytes (to store the same picture once). */
function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 16777619); h2 = Math.imul(h2 + b[i], 2654435761); }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

/** The folder name a new import goes in: "From Evernote", then "From Evernote 2"… */
export function importFolderName(app: string, taken: (folder: string) => boolean): string {
  const want = `From ${safeName(app, 60)}`;
  let p = want;
  for (let i = 2; taken(p); i++) p = `${want} ${i}`;
  return p;
}
