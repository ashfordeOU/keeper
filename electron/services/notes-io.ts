// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes in and out of a vault. Import: read what another app exported (or
// the app itself), show what will come in, write it into a folder of the
// vault with progress and Cancel, keep a list of what was written so Undo
// can take it back. Export: a Markdown folder, the whole vault as a .zip, an
// Evernote .enex, or one note as a web page or PDF. Tokens typed for an
// import are used once and never stored.

import { app, dialog } from 'electron';
import { randomBytes } from 'node:crypto';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { readTar, readZip, writeZip } from '../../core/notes-sync/archive';
import { snRootKey } from '../../core/notes-sync/connectors/standardnotes';
import { parseSnBackup } from '../../core/notes-sync/connectors/standardnotes';
import type { ConnectorKind, RemoteNote } from '../../core/notes-sync/types';
import { importFolderName, planImport, readImport, type ImportBundle, type ImportPlan, type SourceFile } from '../../core/notes/importer';
import { importSource, type ExportFormat, type ImportProgress, type ImportSourceId, type ImportSummary } from '../../core/notes/import-sources';
import { dataUri, enexExport, enexNote, htmlPage, markdownExport } from '../../core/notes/exporter';
import { renderNote } from '../../core/notes/render';
import { isNote } from '../../core/notes/vault';
import { argon2, connectorIO } from './notes-sync/connectors';
import * as notes from './notes';

let broadcast: (channel: string, ...args: unknown[]) => void = () => undefined;
let printPdf: ((html: string) => Promise<Buffer>) | null = null;

export function initNotesIo(d: { broadcast: typeof broadcast; printPdf?: (html: string) => Promise<Buffer> }) {
  broadcast = d.broadcast;
  if (d.printPdf) printPdf = d.printPdf;
}

const importsDir = (vault: string) => path.join(app.getPath('userData'), 'notes', 'imports', vault);

// ---------------------------------------------------------------- reading an export

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.keeper-notes', '__MACOSX']);

/** Every file of an export: a folder (walked), a .zip, a .jex/.tar, or one file. */
export async function gatherFiles(p: string, max = 200_000): Promise<SourceFile[]> {
  const st = await fsp.stat(p).catch(() => null);
  if (!st) throw new Error('That file or folder is not there.');
  if (st.isDirectory()) {
    const out: SourceFile[] = [];
    const walk = async (dir: string, rel: string) => {
      const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        if (out.length >= max) return;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), r); continue; }
        if (!e.isFile()) continue;
        const abs = path.join(dir, e.name);
        const [data, s] = await Promise.all([fsp.readFile(abs), fsp.stat(abs)]);
        // A .zip or .jex inside the chosen folder is opened too (a Takeout or Simplenote folder).
        if (/\.(zip|jex)$/i.test(e.name)) { for (const f of unpack(e.name, data, s.mtimeMs)) out.push({ ...f, rel: rel ? `${rel}/${f.rel}` : f.rel }); continue; }
        out.push({ rel: r, data: new Uint8Array(data), mtime: s.mtimeMs });
      }
    };
    await walk(p, '');
    return out;
  }
  return unpack(path.basename(p), await fsp.readFile(p), st.mtimeMs);
}

function unpack(name: string, data: Buffer, mtime: number): SourceFile[] {
  if (/\.zip$/i.test(name) || (data[0] === 0x50 && data[1] === 0x4b && data[2] === 3)) return readZip(new Uint8Array(data)).map((e) => ({ rel: e.name.replace(/^\/+/, ''), data: e.data, mtime }));
  if (/\.(jex|tar)$/i.test(name)) return readTar(new Uint8Array(data)).map((e) => ({ rel: e.name.replace(/^\.\//, ''), data: e.data, mtime }));
  return [{ rel: name, data: new Uint8Array(data), mtime }];
}

const DIRECT: Partial<Record<ImportSourceId, ConnectorKind>> = { applenotes: 'applenotes', 'bear-mac': 'bear', joplin: 'joplin', notion: 'notion', onenote: 'onenote' };

/** What an app has, as notes: from its export files, or straight from the app or its service. */
export async function readSource(source: ImportSourceId, input: { path?: string; fields?: Record<string, string> }): Promise<ImportBundle & { needsPassword?: boolean }> {
  const kind = DIRECT[source];
  if (kind) {
    const fields = input.fields ?? {};
    const io = await connectorIO({ id: 'import', kind, label: source, enabled: true, writeBack: false, pushNew: false, fields: { url: fields.url ?? '', account: fields.account ?? '' }, everyMin: 0, reviewed: true }, {
      secret: async (name) => fields[name.slice(name.lastIndexOf('.') + 1)] || undefined,
      openUrl: async () => undefined, trashFile: async () => undefined,
      island: { get: async () => [], save: async () => undefined }, ctx: {},
    });
    const r = await io.list();
    return { notes: r.notes };
  }
  if (!input.path) throw new Error('Choose what to import first.');
  const files = await gatherFiles(input.path);
  if (source === 'standardnotes') {
    const pw = input.fields?.password;
    const f = files.find((x) => /\.(txt|json)$/i.test(x.rel)) ?? files[0];
    const first = parseSnBackup(new TextDecoder().decode(f?.data ?? new Uint8Array()));
    if (first.needsPassword) {
      if (!pw || !first.keyParams) return { notes: [], needsPassword: true };
      const { masterKey } = await snRootKey(pw, first.keyParams, argon2);
      return readImport(source, files, { masterKey });
    }
  }
  return readImport(source, files);
}

// ---------------------------------------------------------------- jobs

interface Job { id: string; vault: string; source: ImportSourceId; app: string; folder: string; bundle: ImportBundle; plan: ImportPlan; cancelled: boolean; running: boolean }
const jobs = new Map<string, Job>();

const send = (p: ImportProgress) => broadcast('notes-import', p);

/** Reads the source and works out what would come in (nothing is written yet). */
export async function importPreview(vault: string, source: ImportSourceId, input: { path?: string; fields?: Record<string, string>; folder?: string }): Promise<{ job: string; folder: string; notes: number; attachments: number; skipped: ImportSummary['skipped']; needsPassword?: boolean; sample: string[] }> {
  const src = importSource(source);
  if (!src) throw new Error('Unknown app');
  const id = randomBytes(6).toString('hex');
  send({ job: id, phase: 'reading', done: 0, total: 0 });
  const bundle = await readSource(source, input);
  if (bundle.needsPassword) return { job: id, folder: '', notes: 0, attachments: 0, skipped: [], needsPassword: true, sample: [] };
  const isTaken = await notes.taken(vault);
  const folder = input.folder?.trim() || importFolderName(src.name.replace(/ (export|backup|folder or vault|\(running\))$/i, ''), isTaken);
  const plan = planImport(bundle, { folder, app: src.name, taken: isTaken });
  for (const j of jobs.values()) if (!j.running && j.vault === vault) jobs.delete(j.id);
  jobs.set(id, { id, vault, source, app: src.name, folder, bundle, plan, cancelled: false, running: false });
  const sample = plan.files.filter((f) => f.note).slice(0, 5).map((f) => f.path.slice(folder.length + 1).replace(/\.md$/, ''));
  return { job: id, folder, notes: plan.notes, attachments: plan.attachments, skipped: plan.skipped, sample };
}

/** Writes the previewed notes, with progress; Cancel stops between batches (what was written stays, and Undo takes it back). */
export async function importRun(id: string, opts: { folder?: string } = {}): Promise<ImportSummary> {
  const job = jobs.get(id);
  if (!job) throw new Error('This import has expired. Start again.');
  if (job.running) throw new Error('This import is already running.');
  if (opts.folder && opts.folder.trim() && opts.folder.trim() !== job.folder) {
    job.folder = opts.folder.trim();
    job.plan = planImport(job.bundle, { folder: job.folder, app: job.app, taken: await notes.taken(job.vault) });
  }
  job.running = true;
  const total = job.plan.files.length;
  let last = 0;
  send({ job: id, phase: 'writing', done: 0, total });
  let written: Awaited<ReturnType<typeof notes.writeMany>> = [];
  try {
    written = await notes.writeMany(job.vault, job.plan.files, (done) => {
      if (Date.now() - last > 80 || done === total) { last = Date.now(); send({ job: id, phase: 'writing', done, total }); }
    }, () => job.cancelled);
  } catch (e) {
    send({ job: id, phase: 'error', done: 0, total, message: (e as Error).message });
    job.running = false;
    throw e;
  }
  const summary: ImportSummary = {
    job: id, source: job.source, folder: job.folder,
    notes: written.filter((w) => isNote(w.path)).length,
    attachments: written.filter((w) => !isNote(w.path)).length,
    skipped: job.plan.skipped, cancelled: job.cancelled || undefined, at: Date.now(),
  };
  await fsp.mkdir(importsDir(job.vault), { recursive: true });
  await fsp.writeFile(path.join(importsDir(job.vault), `${id}.json`), JSON.stringify({ summary, files: written }));
  send({ job: id, phase: 'done', done: written.length, total });
  jobs.delete(id);
  return summary;
}

export function importCancel(id: string) {
  const j = jobs.get(id);
  if (j) j.cancelled = true;
}

/** Earlier imports into this vault (newest first), for Undo. */
export async function importsList(vault: string): Promise<ImportSummary[]> {
  const dir = importsDir(vault);
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json'));
  const out: ImportSummary[] = [];
  for (const n of names) {
    try { out.push((JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8')) as { summary: ImportSummary }).summary); } catch { /* skip */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Takes an import back: removes the files it wrote that nobody changed since. */
export async function importUndo(vault: string, id: string): Promise<{ removed: number; kept: string[] }> {
  const file = path.join(importsDir(vault), `${id.replace(/[^0-9a-f]/g, '')}.json`);
  const rec = JSON.parse(await fsp.readFile(file, 'utf8')) as { summary: ImportSummary; files: { path: string; size: number; mtime: number }[] };
  const r = await notes.removeMany(vault, rec.files, rec.summary.folder);
  await fsp.rm(file, { force: true });
  return r;
}

// ---------------------------------------------------------------- export

const safeFile = (s: string) => s.replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ').trim() || 'Notes';

async function chooseOut(kind: 'folder' | 'file', name: string, ext?: string): Promise<string | null> {
  if (kind === 'folder') {
    const r = await dialog.showOpenDialog({ title: 'Choose where to export', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  }
  const r = await dialog.showSaveDialog({ title: 'Export', defaultPath: path.join(app.getPath('documents'), `${name}.${ext}`), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

/**
 * Exports notes. `paths` limits it to some notes (all when empty). `out` is a
 * folder for Markdown, a file otherwise; asked for when not given.
 */
export async function exportNotes(vault: string, format: ExportFormat, opts: { paths?: string[]; out?: string; plain?: boolean } = {}): Promise<{ out: string; files: number } | null> {
  const v = await notes.vaultFor(vault);
  const paths = opts.paths?.length ? opts.paths : null;
  const one = paths?.length === 1 ? paths[0] : null;
  const title = one ? path.posix.basename(one).replace(/\.md$/, '') : v.name;

  if (format === 'markdown') {
    const parent = opts.out ?? (await chooseOut('folder', v.name));
    if (!parent) return null;
    const dest = opts.out && !paths ? parent : path.join(parent, safeFile(paths ? `${title} (notes)` : v.name));
    const files = markdownExport(v.index, paths, { plain: opts.plain });
    for (const f of files) {
      const to = path.join(dest, ...f.path.split('/'));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      if (f.text !== undefined) await fsp.writeFile(to, f.text);
      else if (f.copyFrom) await fsp.copyFile(v.abs(f.copyFrom), to);
    }
    return { out: dest, files: files.length };
  }

  if (format === 'zip') {
    const out = opts.out ?? (await chooseOut('file', v.name, 'zip'));
    if (!out) return null;
    const entries: { name: string; data: Uint8Array }[] = [];
    const list = paths ? markdownExport(v.index, paths).map((f) => f.path) : v.index.allFiles().map((f) => f.path);
    for (const p of list) entries.push({ name: `${safeFile(v.name)}/${p}`, data: new Uint8Array(await fsp.readFile(v.abs(p))) });
    // Settings shared with other notes apps travel with the vault.
    if (!paths) {
      const cfg = path.join(v.root, '.obsidian');
      for (const n of await fsp.readdir(cfg).catch(() => [] as string[])) {
        const st = await fsp.stat(path.join(cfg, n)).catch(() => null);
        if (st?.isFile()) entries.push({ name: `${safeFile(v.name)}/.obsidian/${n}`, data: new Uint8Array(await fsp.readFile(path.join(cfg, n))) });
      }
    }
    await fsp.writeFile(out, writeZip(entries));
    return { out, files: entries.length };
  }

  if (format === 'enex') {
    const out = opts.out ?? (await chooseOut('file', title, 'enex'));
    if (!out) return null;
    const list = (paths ?? v.index.allFiles().map((f) => f.path)).filter((p) => isNote(p) && v.index.get(p));
    const readBytes = (p: string) => { try { return new Uint8Array(readFileSync(v.abs(p))); } catch { return null; } };
    const input = list.map((p) => {
      const f = v.index.get(p)!;
      return enexNote(p, v.index.note(p)?.text ?? '', { mtime: f.mtime, ctime: f.ctime ?? f.mtime, resolve: (t) => v.index.resolve(t, p), read: readBytes });
    });
    await fsp.writeFile(out, enexExport(input));
    return { out, files: input.length };
  }

  // One note as a web page (pictures inside), or as a PDF made from that page.
  if (!one || !isNote(one)) throw new Error('Choose one note to save as a web page or PDF.');
  const out = opts.out ?? (await chooseOut('file', title, format));
  if (!out) return null;
  const html = await noteHtml(v, one);
  if (format === 'html') await fsp.writeFile(out, html);
  else {
    if (!printPdf) throw new Error('PDF is not available here.');
    await fsp.writeFile(out, await printPdf(html));
  }
  return { out, files: 1 };
}

/** Saves a picture made in the window (a mind map as PNG or SVG) where the person chooses. */
export async function saveImage(name: string, data: Buffer, out?: string): Promise<string | null> {
  const ext = (/\.([a-z]+)$/i.exec(name)?.[1] ?? 'png').toLowerCase();
  const to = out ?? (await chooseOut('file', name.replace(/\.[a-z]+$/i, ''), ext));
  if (!to) return null;
  await fsp.writeFile(to, data);
  return to;
}

/** One note as a page that needs nothing else: links to other notes become plain text, pictures are inside. */
export async function noteHtml(v: Awaited<ReturnType<typeof notes.vaultFor>>, p: string): Promise<string> {
  const text = v.index.note(p)?.text ?? '';
  const body = renderNote(text, {
    resolve: (t) => v.index.resolve(t, p),
    href: () => '#',
    src: (q) => { try { return dataUri(q, new Uint8Array(readFileSync(v.abs(q)))); } catch { return ''; } },
    read: (q) => v.index.note(q)?.text ?? null,
    math: v.math,
  });
  return htmlPage(path.posix.basename(p).replace(/\.md$/, ''), body.replace(/<a [^>]*href="#"[^>]*>([\s\S]*?)<\/a>/g, '$1'));
}

export type { RemoteNote };
