// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes: any folder of Markdown files is a vault. Files stay plain files in
// that folder (so other notes apps keep working on the same vault); Keeper's
// own state (the vault list, recovery snapshots, workspaces, plugins) lives
// in its data folder. A vault is read once when opened, then followed file
// by file while the Notes page is open; nothing runs while it is closed.

import { app, BrowserWindow, dialog, shell } from 'electron';
import { createHash, randomBytes } from 'crypto';
import { existsSync, watch, type FSWatcher } from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import type { NoteSnapshot, NotesAnswer, NotesSettings, OpenVault, VaultInfo } from '../../core/api-notes';
import { display, parseBase, runBase } from '../../core/notes/bases';
import { canvasFiles, parseCanvas, renameInCanvas, serializeCanvas } from '../../core/notes/canvas';
import { attachmentFolder, CONFIG_DIR, DEFAULT_CONFIG, freeName, isHidden, newNoteFolder, readBookmarks, readConfig, writeBookmarks, type Bookmark, type VaultConfig } from '../../core/notes/config';
import { normTag } from '../../core/notes/parse';
import { isForeignPlugin, validateManifest, type PluginManifest, type PluginPermission } from '../../core/notes/plugins';
import { buildSite, extractSelection, mergeNotes } from '../../core/notes/publish';
import { renderNote } from '../../core/notes/render';
import { blockText, sectionText, splitLinkInner } from '../../core/notes/parse';
import { rankNotes, searchVault } from '../../core/notes/search';
import { fillTemplate, periodicPath, shiftPeriod, templatePath, type Period } from '../../core/notes/templates';
import { applyEdits, baseOf, dirOf, extOf, isNote, normPath, titleOf, VaultIndex, type VaultFile } from '../../core/notes/vault';

const dataDir = () => path.join(app.getPath('userData'), 'notes');
const vaultsFile = () => path.join(dataDir(), 'vaults.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');

const DEFAULT_SETTINGS: NotesSettings = { ai: false, agentsCanEdit: false, snapshotMinutes: 5, snapshotDays: 7 };

interface Open {
  info: VaultInfo;
  index: VaultIndex;
  config: VaultConfig;
  folders: Set<string>;
  watcher?: FSWatcher;
  closeTimer?: NodeJS.Timeout;
  /** paths Keeper itself just wrote (their change events are expected) */
  ours: Map<string, number>;
  lastSnap: Map<string, number>;
  /** many files are being written at once (an import): changes are announced once at the end */
  quiet?: boolean;
}

const open = new Map<string, Open>();
let broadcast: (channel: string, ...args: unknown[]) => void = () => undefined;
let allowRoot: (dir: string) => void = () => undefined;

export function initNotes(d: { broadcast: typeof broadcast; allowRoot?: (dir: string) => void }) {
  broadcast = d.broadcast;
  if (d.allowRoot) allowRoot = d.allowRoot;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, v: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // A name of its own per write: two writes at once never rename each other's file.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2));
  await fsp.rename(tmp, file);
}

// ---------------------------------------------------------------- settings and vault list

export async function getSettings(): Promise<NotesSettings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<NotesSettings>>(settingsFile(), {})) };
}

export async function setSettings(patch: Partial<NotesSettings>): Promise<NotesSettings> {
  const next = { ...(await getSettings()), ...patch };
  await writeJson(settingsFile(), next);
  return next;
}

async function loadVaults(): Promise<VaultInfo[]> {
  const list = await readJson<VaultInfo[]>(vaultsFile(), []);
  return list.map((v) => ({ ...v, shared: existsSync(path.join(v.path, CONFIG_DIR)), missing: !existsSync(v.path) }));
}

export async function vaults(): Promise<VaultInfo[]> {
  return (await loadVaults()).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
}

export async function addVault(dir?: string): Promise<VaultInfo | null> {
  if (!dir) {
    const win = BrowserWindow.getFocusedWindow();
    const r = win ? await dialog.showOpenDialog(win, { title: 'Open folder as vault', properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    dir = r.filePaths[0];
  }
  const abs = path.resolve(dir);
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`${abs} is not a folder`);
  const list = await loadVaults();
  const have = list.find((v) => path.resolve(v.path) === abs);
  if (have) return have;
  const info: VaultInfo = { id: createHash('sha1').update(abs).digest('hex').slice(0, 16), name: path.basename(abs), path: abs, shared: existsSync(path.join(abs, CONFIG_DIR)) };
  await writeJson(vaultsFile(), [...list, info]);
  return info;
}

export async function createVault(name: string, parent?: string): Promise<VaultInfo | null> {
  if (!parent) {
    const r = await dialog.showOpenDialog({ title: 'Where should the new vault go?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    parent = r.filePaths[0];
  }
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Notes';
  const dir = path.join(parent, safe);
  await fsp.mkdir(dir, { recursive: true });
  return addVault(dir);
}

export async function removeVault(id: string): Promise<VaultInfo[]> {
  await close(id, true);
  const list = (await loadVaults()).filter((v) => v.id !== id);
  await writeJson(vaultsFile(), list);
  return list;
}

export async function vaultPath(id: string): Promise<string | null> {
  return (await loadVaults()).find((v) => v.id === id)?.path ?? null;
}

// ---------------------------------------------------------------- opening and indexing

async function readConfigFiles(root: string): Promise<VaultConfig> {
  const dir = path.join(root, CONFIG_DIR);
  if (!existsSync(dir)) return { ...DEFAULT_CONFIG };
  const j = (n: string) => readJson<Record<string, unknown> | undefined>(path.join(dir, n), undefined);
  const [appJ, daily, templates, types, periodicPlugin] = await Promise.all([j('app.json'), j('daily-notes.json'), j('templates.json'), j('types.json'), j('plugins/periodic-notes/data.json')]);
  return readConfig({ app: appJ, dailyNotes: daily, templates, types, periodicPlugin });
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');

function safeAbs(o: Open, rel: string): string {
  const clean = normPath(rel);
  const abs = path.resolve(o.info.path, clean);
  if (abs !== o.info.path && !abs.startsWith(o.info.path + path.sep)) throw new Error('That path is outside the vault');
  return abs;
}

async function scan(root: string, cfg: VaultConfig): Promise<{ files: VaultFile[]; folders: string[] }> {
  const files: VaultFile[] = [];
  const folders: string[] = [];
  const walk = async (dir: string) => {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    await Promise.all(ents.map(async (e) => {
      const abs = path.join(dir, e.name);
      const rel = toRel(root, abs);
      if (isHidden(rel, cfg)) return;
      if (e.isDirectory()) { folders.push(rel); await walk(abs); return; }
      if (!e.isFile()) return;
      const st = await fsp.stat(abs).catch(() => null);
      if (st) files.push({ path: rel, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size });
    }));
  };
  await walk(root);
  return { files, folders };
}

async function getOpen(id: string): Promise<Open> {
  const have = open.get(id);
  if (have) return have;
  await openVault(id);
  return open.get(id)!;
}

export async function openVault(id: string): Promise<OpenVault> {
  const t0 = Date.now();
  const list = await loadVaults();
  const info = list.find((v) => v.id === id);
  if (!info) throw new Error('Unknown vault');
  if (info.missing) throw new Error(`The folder ${info.path} is not there (a disk not connected, or a locked folder?)`);
  let o = open.get(id);
  const config = await readConfigFiles(info.path);
  if (!o) {
    o = { info, index: new VaultIndex(), config, folders: new Set(), ours: new Map(), lastSnap: new Map() };
    open.set(id, o);
  }
  o.config = config;
  const { files, folders } = await scan(info.path, config);
  o.folders = new Set(folders);
  const seen = new Set<string>();
  // Only files that changed since the last look are read again (the index stays while Keeper runs).
  const queue = files.filter((f) => {
    seen.add(f.path);
    const old = o!.index.get(f.path);
    return !old || old.mtime !== f.mtime || old.size !== f.size;
  });
  for (const f of o.index.allFiles()) if (!seen.has(f.path)) o.index.remove(f.path);
  for (let i = 0; i < queue.length; i += 64) {
    await Promise.all(queue.slice(i, i + 64).map(async (f) => {
      const text = isNote(f.path) ? await fsp.readFile(path.join(info.path, f.path), 'utf8').catch(() => '') : undefined;
      o!.index.set(f, text);
    }));
  }
  watchVault(o);
  allowRoot(info.path);
  info.openedAt = Date.now();
  await writeJson(vaultsFile(), list.map((v) => (v.id === id ? { ...v, openedAt: info.openedAt } : v)).map(({ missing: _m, ...v }) => v));
  return { ...info, config, files: o.index.allFiles(), folders: [...o.folders].sort(), took: Date.now() - t0 };
}

function watchVault(o: Open) {
  if (o.closeTimer) { clearTimeout(o.closeTimer); o.closeTimer = undefined; }
  if (o.watcher) return;
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const flush = async () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    const changed: string[] = [];
    for (const rel of paths) {
      if (isHidden(rel, o.config)) {
        if (rel.startsWith(`${CONFIG_DIR}/`)) o.config = await readConfigFiles(o.info.path);
        continue;
      }
      const abs = path.join(o.info.path, rel);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) {
        if (o.index.has(rel)) { o.index.remove(rel); changed.push(rel); }
        // A folder went away: everything under it too.
        for (const f of o.index.allFiles()) if (f.path.startsWith(`${rel}/`)) { o.index.remove(f.path); changed.push(f.path); }
        o.folders.delete(rel);
        continue;
      }
      if (st.isDirectory()) { o.folders.add(rel); changed.push(rel); continue; }
      const old = o.index.get(rel);
      if (old && old.mtime === st.mtimeMs && old.size === st.size) continue;
      const text = isNote(rel) ? await fsp.readFile(abs, 'utf8').catch(() => '') : undefined;
      o.index.set({ path: rel, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size }, text);
      const ours = o.ours.get(rel);
      if (!ours || Date.now() - ours > 3000) changed.push(rel);
    }
    if (changed.length && !o.quiet) broadcast('notes-changed', { vault: o.info.id, paths: changed });
  };
  try {
    o.watcher = watch(o.info.path, { recursive: true }, (_ev, name) => {
      if (!name) return;
      pending.add(String(name).split(path.sep).join('/'));
      if (!timer) timer = setTimeout(() => void flush(), 250);
    });
    o.watcher.on('error', () => { o.watcher?.close(); o.watcher = undefined; });
  } catch {
    /* no recursive watching here: changes made outside Keeper show after reopening */
  }
}

/** Stops following a vault a minute after the Notes page closed (the index is kept). */
export async function close(id: string, now = false) {
  const o = open.get(id);
  if (!o) return;
  if (o.closeTimer) clearTimeout(o.closeTimer);
  const stop = () => { o.watcher?.close(); o.watcher = undefined; o.closeTimer = undefined; };
  if (now) { stop(); open.delete(id); return; }
  o.closeTimer = setTimeout(stop, 60_000);
}

// ---------------------------------------------------------------- files

async function writeRaw(o: Open, rel: string, text: string, by?: string): Promise<VaultFile> {
  const abs = safeAbs(o, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const prev = o.index.note(rel)?.text;
  if (prev != null && prev !== text) await maybeSnapshot(o, rel, prev, by);
  o.ours.set(rel, Date.now());
  await fsp.writeFile(abs, text, 'utf8');
  const st = await fsp.stat(abs);
  const f: VaultFile = { path: rel, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size };
  o.index.set(f, isNote(rel) ? text : undefined);
  return f;
}

export async function read(id: string, rel: string): Promise<string> {
  const o = await getOpen(id);
  const n = o.index.note(rel);
  if (n) return n.text;
  return fsp.readFile(safeAbs(o, rel), 'utf8');
}

export async function write(id: string, rel: string, text: string, by?: string): Promise<VaultFile> {
  const o = await getOpen(id);
  return writeRaw(o, normPath(rel), text, by);
}

export async function create(id: string, rel: string, text = ''): Promise<VaultFile> {
  const o = await getOpen(id);
  const p = normPath(rel);
  if (existsSync(safeAbs(o, p))) throw new Error(`${p} already exists`);
  return writeRaw(o, p, text);
}

export async function createFolder(id: string, rel: string) {
  const o = await getOpen(id);
  await fsp.mkdir(safeAbs(o, rel), { recursive: true });
  o.folders.add(normPath(rel));
}

export async function newNote(id: string, opts: { folder?: string; title?: string; activePath?: string; text?: string } = {}): Promise<string> {
  const o = await getOpen(id);
  const folder = opts.folder ?? newNoteFolder(o.config, opts.activePath);
  const base = (opts.title ?? 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim() || 'Untitled';
  const p = freeName((x) => o.index.has(x) || existsSync(safeAbs(o, x)), folder, base, 'md');
  await writeRaw(o, p, opts.text ?? '');
  return p;
}

export async function remove(id: string, rel: string) {
  const o = await getOpen(id);
  const abs = safeAbs(o, rel);
  const isDir = (await fsp.stat(abs)).isDirectory();
  const opt = o.config.trashOption;
  if (opt === 'local') {
    const dest = path.join(o.info.path, '.trash', path.basename(abs));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let d = dest;
    for (let i = 1; existsSync(d); i++) d = dest.replace(/(\.[^./]+)?$/, ` ${i}$1`);
    await fsp.rename(abs, d);
  } else if (opt === 'none') await fsp.rm(abs, { recursive: true, force: true });
  else await shell.trashItem(abs).catch(() => fsp.rm(abs, { recursive: true, force: true }));
  const p = normPath(rel);
  for (const f of o.index.allFiles()) if (f.path === p || f.path.startsWith(`${p}/`)) o.index.remove(f.path);
  if (isDir) for (const f of [...o.folders]) if (f === p || f.startsWith(`${p}/`)) o.folders.delete(f);
}

// ---------------------------------------------------------------- many files at once (imports)

/** Is this vault path taken (by a file or a folder)? */
export async function taken(id: string): Promise<(rel: string) => boolean> {
  const o = await getOpen(id);
  // Case never decides: "Plan.md" and "plan.md" are the same file on most Macs and PCs.
  const lower = new Set([...o.index.allFiles().map((f) => f.path.toLowerCase()), ...[...o.folders].map((f) => f.toLowerCase())]);
  return (rel: string) => lower.has(rel.toLowerCase()) || existsSync(safeAbs(o, rel));
}

/**
 * Writes many new files (never over an existing one), in small batches so the
 * app keeps responding; tells `progress` how far it got and stops when
 * `cancelled` says so. The vault is announced as changed once, at the end.
 */
export async function writeMany(id: string, files: { path: string; data: Uint8Array; note: boolean; mtime?: number }[], progress: (done: number) => void, cancelled: () => boolean): Promise<{ path: string; size: number; mtime: number }[]> {
  const o = await getOpen(id);
  o.quiet = true;
  // Following thousands of new files one event at a time is slow (on Linux each new folder is
  // walked again): stop following while writing, and look at the whole vault once afterwards.
  const following = !!o.watcher;
  o.watcher?.close();
  o.watcher = undefined;
  const written: { path: string; size: number; mtime: number }[] = [];
  try {
    for (let i = 0; i < files.length; i += 32) {
      if (cancelled()) break;
      await Promise.all(files.slice(i, i + 32).map(async (f) => {
        const rel = normPath(f.path);
        const abs = safeAbs(o, rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        o.ours.set(rel, Date.now());
        await fsp.writeFile(abs, f.data, { flag: 'wx' });
        if (f.mtime && Number.isFinite(f.mtime)) { const t = new Date(f.mtime); await fsp.utimes(abs, t, t).catch(() => undefined); }
        const st = await fsp.stat(abs);
        o.index.set({ path: rel, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size }, f.note ? Buffer.from(f.data).toString('utf8') : undefined);
        for (let d = path.posix.dirname(rel); d && d !== '.'; d = path.posix.dirname(d)) o.folders.add(d);
        written.push({ path: rel, size: st.size, mtime: st.mtimeMs });
      }));
      progress(written.length);
      // Let other work (the window's requests) in between batches.
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    o.quiet = false;
    if (following) watchVault(o);
    broadcast('notes-changed', { vault: o.info.id, paths: written.map((w) => w.path).slice(0, 200) });
  }
  return written;
}

/**
 * Takes back files an import wrote: each one only if it is unchanged since
 * (same size and time), then the folders it leaves empty. Changed files stay.
 */
export async function removeMany(id: string, files: { path: string; size: number; mtime: number }[], folder?: string): Promise<{ removed: number; kept: string[] }> {
  const o = await getOpen(id);
  o.quiet = true;
  const following = !!o.watcher;
  o.watcher?.close();
  o.watcher = undefined;
  let removed = 0;
  const kept: string[] = [];
  try {
    for (const f of files) {
      const abs = safeAbs(o, f.path);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      if (st.size !== f.size || Math.abs(st.mtimeMs - f.mtime) > 2) { kept.push(f.path); continue; }
      await fsp.rm(abs, { force: true });
      o.index.remove(f.path);
      removed++;
    }
    // Folders left empty, deepest first.
    const dirs = new Set<string>();
    for (const f of files) for (let d = path.posix.dirname(f.path); d && d !== '.'; d = path.posix.dirname(d)) if (!folder || d === folder || d.startsWith(`${folder}/`)) dirs.add(d);
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      const abs = safeAbs(o, d);
      if ((await fsp.readdir(abs).catch(() => ['x'])).length === 0) { await fsp.rmdir(abs).catch(() => undefined); o.folders.delete(d); }
    }
  } finally {
    o.quiet = false;
    if (following) watchVault(o);
    broadcast('notes-changed', { vault: o.info.id, paths: [] });
  }
  return { removed, kept };
}

/** The vault's index and folder, for exports. */
export async function vaultFor(id: string) {
  const o = await getOpen(id);
  return { index: o.index, root: o.info.path, name: o.info.name, abs: (rel: string) => safeAbs(o, rel), math: await mathFn() };
}

/** Renames a file or folder, and (when the vault says so, the default) updates every link to it. */
export async function rename(id: string, fromRel: string, toRel0: string): Promise<{ changed: string[]; to: string }> {
  const o = await getOpen(id);
  const from = normPath(fromRel);
  let to = normPath(toRel0);
  const fromAbs = safeAbs(o, from);
  const st = await fsp.stat(fromAbs);
  // A note renamed without its extension keeps it.
  if (st.isFile() && extOf(from) && !extOf(to)) to = `${to}.${extOf(from)}`;
  const toAbs = safeAbs(o, to);
  if (from === to) return { changed: [], to };
  if (existsSync(toAbs) && from.toLowerCase() !== to.toLowerCase()) throw new Error(`${to} already exists`);
  const moves = st.isDirectory()
    ? o.index.allFiles().filter((f) => f.path.startsWith(`${from}/`)).map((f) => ({ from: f.path, to: `${to}${f.path.slice(from.length)}` }))
    : [{ from, to }];
  const edits = o.config.alwaysUpdateLinks ? o.index.renameEdits(moves, o.config.newLinkFormat) : [];
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  for (const m of moves) o.ours.set(m.to, Date.now());
  await fsp.rename(fromAbs, toAbs);
  // Texts after the move: notes that linked to the moved files get their links rewritten.
  const moveMap = new Map(moves.map((m) => [m.from, m.to]));
  const texts = new Map<string, string>();
  for (const e of edits) {
    const oldPath = [...moveMap].find(([, t]) => t === e.path)?.[0] ?? e.path;
    const before = o.index.note(oldPath)?.text ?? '';
    texts.set(e.path, applyEdits(before, e.edits));
  }
  o.index.applyRename(moves, new Map());
  for (const [p, t] of texts) await writeRaw(o, p, t);
  // Canvases showing a moved file.
  for (const f of o.index.allFiles()) {
    if (extOf(f.path) !== 'canvas') continue;
    try {
      let c = parseCanvas(await fsp.readFile(path.join(o.info.path, f.path), 'utf8'));
      let changed = false;
      for (const m of moves) {
        if (!canvasFiles(c).includes(m.from)) continue;
        c = renameInCanvas(c, m.from, m.to) ?? c;
        changed = true;
      }
      if (changed) { await writeRaw(o, f.path, serializeCanvas(c)); texts.set(f.path, ''); }
    } catch { /* not a canvas we can read */ }
  }
  if (st.isDirectory()) {
    for (const f of [...o.folders]) if (f === from || f.startsWith(`${from}/`)) { o.folders.delete(f); o.folders.add(`${to}${f.slice(from.length)}`); }
  }
  return { changed: [...texts.keys()], to };
}

export async function saveAttachment(id: string, notePath: string, name: string, data: Uint8Array): Promise<string> {
  const o = await getOpen(id);
  const folder = attachmentFolder(o.config, notePath);
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim() || 'Pasted';
  const ext = dot > 0 ? name.slice(dot + 1) : 'bin';
  const p = freeName((x) => o.index.has(x) || existsSync(safeAbs(o, x)), folder, base, ext);
  const abs = safeAbs(o, p);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, data);
  const st = await fsp.stat(abs);
  o.index.set({ path: p, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, size: st.size });
  return p;
}

export async function fileUrlFor(id: string, rel: string): Promise<string> {
  const o = await getOpen(id);
  const abs = safeAbs(o, rel);
  return 'keeper-file://' + abs.split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join('');
}

export async function reveal(id: string, rel: string) {
  const o = await getOpen(id);
  shell.showItemInFolder(safeAbs(o, rel));
}

// ---------------------------------------------------------------- links, search, graph

export async function backlinks(id: string, rel: string) {
  const o = await getOpen(id);
  return o.index.backlinks(rel).map((b) => {
    const text = o.index.note(b.source)?.text ?? '';
    return { source: b.source, links: b.links.map((l) => ({ ...l, context: lineAround(text, l.from) })) };
  });
}

function lineAround(text: string, at: number): string {
  const s = text.lastIndexOf('\n', at - 1) + 1;
  const e = text.indexOf('\n', at);
  return text.slice(s, e < 0 ? undefined : e).slice(0, 300);
}

export async function outgoing(id: string, rel: string) { return (await getOpen(id)).index.outgoing(rel); }
export async function unlinked(id: string, rel: string) { return (await getOpen(id)).index.unlinkedMentions(rel); }

export async function linkMention(id: string, source: string, from: number, to: number, target: string) {
  const o = await getOpen(id);
  const text = o.index.note(source)?.text;
  if (text == null) return;
  const said = text.slice(from, to);
  const name = o.index.linkText(target, source, o.config.newLinkFormat, 'wiki');
  const link = said === titleOf(target) ? `[[${name}]]` : `[[${name}|${said}]]`;
  await writeRaw(o, source, applyEdits(text, [{ from, to, insert: link }]));
}

export async function tags(id: string) { return (await getOpen(id)).index.tags(); }

export async function search(id: string, query: string, opts: { limit?: number; caseSensitive?: boolean } = {}) {
  const o = await getOpen(id);
  return searchVault(o.index.allFiles(), (p) => o.index.note(p), query, { limit: opts.limit ?? 200, caseSensitive: opts.caseSensitive });
}

export async function suggest(id: string, query: string) {
  const o = await getOpen(id);
  const fmt = o.config.newLinkFormat === 'absolute' ? 'absolute' : 'shortest';
  return o.index.suggest(query, 40).map(({ path: p, display: d, alias }) => ({ path: p, display: d, link: o.index.linkText(p, '', fmt, 'wiki'), ...(alias ? { alias } : {}) }));
}

export async function resolve(id: string, target: string, from: string) { return (await getOpen(id)).index.resolve(target, from); }

export async function unresolvedLinks(id: string) {
  const o = await getOpen(id);
  return [...o.index.unresolved()].map(([target, list]) => ({ target, sources: [...new Set(list.map((x) => x.source))] }));
}

export async function graph(id: string, opts: { center?: string; depth?: number; attachments?: boolean; unresolved?: boolean; folder?: string } = {}) {
  const o = await getOpen(id);
  return opts.center ? o.index.localGraph(opts.center, opts.depth ?? 1, opts) : o.index.graph(opts);
}

export async function random(id: string) {
  const notes = (await getOpen(id)).index.allNotes();
  return notes.length ? notes[Math.floor(Math.random() * notes.length)].path : null;
}

// ---------------------------------------------------------------- periodic notes and templates

async function templateText(o: Open, t: string | undefined): Promise<string | null> {
  const p = templatePath(t);
  if (!p) return null;
  const r = o.index.resolve(p.replace(/\.md$/, ''), '') ?? (o.index.has(p) ? p : null);
  if (!r) return null;
  return o.index.note(r)?.text ?? null;
}

export async function periodic(id: string, period: Period, date?: number, offset = 0): Promise<{ path: string; created: boolean }> {
  const o = await getOpen(id);
  const cfg = o.config.periodic[period];
  const d = shiftPeriod(date ? new Date(date) : new Date(), period, offset);
  const p = periodicPath(d, period, cfg);
  if (o.index.has(p) || existsSync(safeAbs(o, p))) return { path: p, created: false };
  const tpl = await templateText(o, cfg.template);
  const text = tpl == null ? '' : fillTemplate(tpl, { title: titleOf(p), date: d, dateFormat: cfg.format || undefined, timeFormat: o.config.templates.timeFormat });
  await writeRaw(o, p, text);
  return { path: p, created: true };
}

export async function templates(id: string): Promise<string[]> {
  const o = await getOpen(id);
  const folder = normPath(o.config.templates.folder);
  if (!folder) return [];
  return o.index.allNotes().filter((n) => n.path.startsWith(`${folder}/`)).map((n) => n.path).sort();
}

export async function fillTemplateFor(id: string, tpl: string, notePath: string): Promise<string> {
  const o = await getOpen(id);
  const text = o.index.note(tpl)?.text ?? '';
  return fillTemplate(text, { title: titleOf(notePath), dateFormat: o.config.templates.dateFormat, timeFormat: o.config.templates.timeFormat });
}

// ---------------------------------------------------------------- bases, composer, publishing

export async function base(id: string, opts: { path?: string; text?: string; view?: number; thisFile?: string }) {
  const o = await getOpen(id);
  const text = opts.text ?? (opts.path ? await read(id, opts.path) : '');
  const def = parseBase(text);
  const r = runBase(def, o.index, opts.view ?? 0, { thisFile: opts.thisFile });
  return {
    ...r,
    // Values are sent as text: dates, links and lists do not cross to the window as objects.
    rows: r.rows.map((x) => ({ path: x.path, cells: Object.fromEntries(Object.entries(x.cells).map(([k, v]) => [k, display(v)])) })),
    views: def.views.map((v) => ({ name: v.name, type: v.type })),
    display: r.rows.map((x) => Object.fromEntries(Object.entries(x.cells).map(([k, v]) => [k, display(v)]))),
  };
}

export async function merge(id: string, from: string, into: string) {
  const o = await getOpen(id);
  const m = mergeNotes(o.index, from, into, o.config.newLinkFormat);
  await writeRaw(o, into, m.text);
  for (const e of m.edits) {
    const t = o.index.note(e.path)?.text;
    if (t != null) await writeRaw(o, e.path, applyEdits(t, e.edits));
  }
  await remove(id, from);
}

export async function extract(id: string, rel: string, from: number, to: number, title: string, mode: 'link' | 'embed' | 'none' = 'link'): Promise<string> {
  const o = await getOpen(id);
  const text = o.index.note(rel)?.text ?? '';
  const target = freeName((x) => o.index.has(x), dirOf(rel), title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim() || 'Extracted', 'md');
  const r = extractSelection(text, from, to, titleOf(target), mode);
  await writeRaw(o, target, r.extracted);
  await writeRaw(o, rel, r.source);
  return target;
}

export async function publish(id: string, paths: string[], opts: { out?: string; title?: string } = {}) {
  const o = await getOpen(id);
  let out = opts.out;
  if (!out) {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder for the website', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    out = r.filePaths[0];
  }
  const site = buildSite(o.index, paths, { title: opts.title ?? o.info.name, math: await mathFn() });
  for (const f of site) {
    const dest = path.join(out, ...f.path.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (typeof f.content === 'string') await fsp.writeFile(dest, f.content);
    else await fsp.copyFile(safeAbs(o, f.content.copyFrom), dest);
  }
  return { out, files: site.length };
}

// ---------------------------------------------------------------- rendering

let katexMod: typeof import('katex') | null | undefined;
async function mathFn(): Promise<((tex: string, display: boolean) => string) | undefined> {
  if (katexMod === undefined) {
    try { katexMod = (await import('katex')).default as unknown as typeof import('katex'); } catch { katexMod = null; }
  }
  const k = katexMod;
  return k ? (tex, d) => k.renderToString(tex, { displayMode: d, throwOnError: false, output: 'htmlAndMathml' }) : undefined;
}

const urlOf = (o: Open, rel: string) => 'keeper-file://' + path.join(o.info.path, rel).split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join('');

/** A note as HTML for the reading view (links, embeds, math done; diagrams and code colours are added by the window). */
export async function render(id: string, rel: string, opts: { text?: string } = {}): Promise<string> {
  const o = await getOpen(id);
  const text = opts.text ?? o.index.note(rel)?.text ?? '';
  return renderNote(text, {
    resolve: (t) => o.index.resolve(t, rel),
    href: (p) => `#${encodeURI(p)}`,
    src: (p) => urlOf(o, p),
    read: (p) => o.index.note(p)?.text ?? null,
    math: await mathFn(),
  });
}

/** The note (or heading, or block) a link points at, as HTML, for hover previews. */
export async function preview(id: string, target: string, from: string): Promise<{ path: string; html: string } | null> {
  const o = await getOpen(id);
  const p = splitLinkInner(target);
  const r = p.target ? o.index.resolve(p.target, from) : from;
  if (!r) return null;
  if (!isNote(r)) return { path: r, html: await render(id, from, { text: `![[${r}]]` }) };
  let text = o.index.note(r)?.text ?? '';
  if (p.subpath?.startsWith('^')) text = blockText(text, p.subpath.slice(1)) ?? text;
  else if (p.subpath) text = sectionText(text, p.subpath) ?? text;
  return { path: r, html: await render(id, r, { text: text.slice(0, 20000) }) };
}

// ---------------------------------------------------------------- file recovery

const snapDir = (o: Open, rel: string) => path.join(dataDir(), 'recovery', o.info.id, createHash('sha1').update(rel).digest('hex'));

async function maybeSnapshot(o: Open, rel: string, prev: string, by?: string) {
  if (!isNote(rel)) return;
  const s = await getSettings();
  const last = o.lastSnap.get(rel) ?? 0;
  // Agents' edits always keep the version before them.
  if (!by && Date.now() - last < s.snapshotMinutes * 60_000) return;
  o.lastSnap.set(rel, Date.now());
  const dir = snapDir(o, rel);
  await fsp.mkdir(dir, { recursive: true });
  const at = Date.now();
  await fsp.writeFile(path.join(dir, `${at}${by ? `-${by.replace(/[^\w-]/g, '')}` : ''}.md`), prev);
  await fsp.writeFile(path.join(dir, 'path.txt'), rel);
  const cutoff = at - s.snapshotDays * 86_400_000;
  for (const f of await fsp.readdir(dir)) {
    const t = Number(f.split(/[-.]/)[0]);
    if (t && t < cutoff) await fsp.rm(path.join(dir, f), { force: true });
  }
}

export async function snapshots(id: string, rel: string): Promise<NoteSnapshot[]> {
  const o = await getOpen(id);
  const dir = snapDir(o, rel);
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const out: NoteSnapshot[] = [];
  for (const n of names) {
    const m = /^(\d+)(?:-([\w-]+))?\.md$/.exec(n);
    if (!m) continue;
    const st = await fsp.stat(path.join(dir, n));
    out.push({ id: n, at: Number(m[1]), size: st.size, ...(m[2] ? { by: m[2] } : {}) });
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function snapshot(id: string, rel: string, snap: string): Promise<string> {
  const o = await getOpen(id);
  if (!/^[\w-]+\.md$/.test(snap)) throw new Error('Bad snapshot');
  return fsp.readFile(path.join(snapDir(o, rel), snap), 'utf8');
}

// ---------------------------------------------------------------- bookmarks and capture

export async function bookmarks(id: string): Promise<Bookmark[]> {
  const o = await getOpen(id);
  return readBookmarks(await readJson(path.join(o.info.path, CONFIG_DIR, 'bookmarks.json'), {}));
}

export async function setBookmarks(id: string, items: Bookmark[]) {
  const o = await getOpen(id);
  const file = path.join(o.info.path, CONFIG_DIR, 'bookmarks.json');
  const prev = await readJson(file, {});
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, writeBookmarks(items, prev));
}

/** Adds a time-stamped line to today's daily note of the most recently used vault. */
export async function capture(text: string, vaultId?: string): Promise<{ path: string } | null> {
  const id = vaultId ?? (await vaults())[0]?.id;
  if (!id || !text.trim()) return null;
  const o = await getOpen(id);
  const { path: p } = await periodic(id, 'day');
  const cur = o.index.note(p)?.text ?? '';
  const t = new Date();
  const line = `- ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} ${text.trim()}`;
  await writeRaw(o, p, `${cur.replace(/\s*$/, '')}${cur.trim() ? '\n' : ''}${line}\n`);
  return { path: p };
}

// ---------------------------------------------------------------- AI (opt-in)

type Brain = typeof import('./brain');
let brainMod: Brain | null = null;
async function brain(): Promise<Brain> {
  brainMod ??= await import('./brain');
  return brainMod;
}

async function chat(system: string, user: string): Promise<{ text: string; provider: string }> {
  const b = await brain();
  const s = b.brainSettings();
  if (!s.active) throw new Error('Choose an AI in Settings → AI & Brain first.');
  const p = await b.providerForConnection(s.active);
  const r = await p.chat([{ role: 'system', content: system }, { role: 'user', content: user }], []);
  return { text: r.text, provider: p.label };
}

async function aiAllowed(): Promise<string | null> {
  return (await getSettings()).ai ? null : 'AI for notes is off. Turn it on in Notes → Settings.';
}

/** Answers from the vault's notes and cites them as [[links]]. */
export async function ask(id: string, question: string, opts: { path?: string } = {}): Promise<NotesAnswer> {
  const off = await aiAllowed();
  if (off) return { text: '', cites: [], error: off };
  const o = await getOpen(id);
  const ranked = rankNotes(o.index.allNotes(), question, 6);
  // Meaning search from the brain, when the vault is one of the folders it reads.
  try {
    const hits = await (await brain()).search(question, { limit: 6, mode: 'meaning' });
    for (const h of hits) {
      if (!h.path.startsWith(o.info.path + path.sep)) continue;
      const rel = toRel(o.info.path, h.path);
      if (o.index.note(rel) && !ranked.some((r) => r.path === rel)) ranked.push({ path: rel, score: 0, excerpt: o.index.note(rel)!.text.slice(0, 1500) });
    }
  } catch { /* words only */ }
  if (opts.path && o.index.note(opts.path) && !ranked.some((r) => r.path === opts.path)) ranked.unshift({ path: opts.path, score: 0, excerpt: o.index.note(opts.path)!.text.slice(0, 3000) });
  const context = ranked.map((r) => `### [[${titleOf(r.path)}]] (${r.path})\n${r.excerpt}`).join('\n\n');
  try {
    const { text, provider } = await chat(
      'You answer questions using only the notes given. Cite every note you use as [[Note name]] exactly as its heading shows. If the notes do not hold the answer, say so.',
      `Notes:\n\n${context || '(no matching notes)'}\n\nQuestion: ${question}`,
    );
    const cites = [...new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => o.index.resolve(m[1].trim(), '') ?? '').filter(Boolean))];
    return { text, cites, provider };
  } catch (e) {
    return { text: '', cites: [], error: (e as Error).message };
  }
}

export async function assist(id: string, rel: string, task: 'summarize' | 'continue' | 'links' | 'tags', extra?: string): Promise<NotesAnswer> {
  const off = await aiAllowed();
  if (off) return { text: '', cites: [], error: off };
  const o = await getOpen(id);
  const text = o.index.note(rel)?.text ?? '';
  try {
    if (task === 'links') {
      const titles = o.index.allNotes().filter((n) => n.path !== rel).map((n) => titleOf(n.path)).slice(0, 400);
      const r = await chat('Suggest which existing notes this note should link to. Reply with one [[Note name]] per line, only names from the list, at most 8.', `Existing notes:\n${titles.join('\n')}\n\nThis note (${titleOf(rel)}):\n${text.slice(0, 6000)}`);
      const cites = [...r.text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => o.index.resolve(m[1].trim(), rel)).filter((x): x is string => !!x && x !== rel);
      return { text: r.text, cites: [...new Set(cites)], provider: r.provider };
    }
    if (task === 'tags') {
      const known = o.index.tags().slice(0, 300).map((t) => `#${t.tag}`).join(' ');
      const r = await chat('Suggest up to 5 tags for this note. Prefer tags the vault already uses. Reply with tags only, like #topic/sub, separated by spaces.', `Tags in use: ${known}\n\nNote:\n${text.slice(0, 6000)}`);
      const tagsOut = [...new Set((r.text.match(/#[\p{L}\p{N}_/-]+/gu) ?? []).map((t) => normTag(t)))];
      return { text: tagsOut.map((t) => `#${t}`).join(' '), cites: [], provider: r.provider };
    }
    const r = task === 'summarize'
      ? await chat('Summarize the note in a few short bullet points, in the note\'s language.', text.slice(0, 12000))
      : await chat('Continue writing the note in the same voice and Markdown style. Write only the new text.', `${extra ? `Instruction: ${extra}\n\n` : ''}${text.slice(-8000)}`);
    return { text: r.text, cites: [], provider: r.provider };
  } catch (e) {
    return { text: '', cites: [], error: (e as Error).message };
  }
}

/** For agents (MCP): change a note only when the person allowed it; the version before is kept. */
export async function agentWrite(vaultId: string, rel: string, text: string, agent: string) {
  if (!(await getSettings()).agentsCanEdit) throw new Error('Agents may not change notes (Notes → Settings → Let AI agents edit notes).');
  return write(vaultId, rel, text, `agent-${agent}`);
}

// ---------------------------------------------------------------- plugins

const pluginsDir = () => path.join(dataDir(), 'plugins');

export async function plugins(id: string) {
  const o = await getOpen(id);
  const s = await getSettings();
  const keeper: (PluginManifest & { enabled: boolean; granted: PluginPermission[] })[] = [];
  for (const d of await fsp.readdir(pluginsDir()).catch(() => [] as string[])) {
    const m = validateManifest(await readJson(path.join(pluginsDir(), d, 'manifest.json'), null));
    if (!m.ok) continue;
    const st = s.plugins?.[m.manifest.id];
    keeper.push({ ...m.manifest, enabled: !!st?.enabled, granted: st?.granted ?? [] });
  }
  const foreign: { id: string; name: string }[] = [];
  const fdir = path.join(o.info.path, CONFIG_DIR, 'plugins');
  for (const d of await fsp.readdir(fdir).catch(() => [] as string[])) {
    const m = await readJson<Record<string, unknown> | null>(path.join(fdir, d, 'manifest.json'), null);
    if (m && isForeignPlugin(m)) foreign.push({ id: String(m.id ?? d), name: String(m.name ?? d) });
  }
  return { keeper, foreign };
}

export async function pluginCode(pluginId: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(pluginId)) throw new Error('Bad plugin id');
  return fsp.readFile(path.join(pluginsDir(), pluginId, 'main.js'), 'utf8');
}

export async function setPlugin(pluginId: string, enabled: boolean, granted: PluginPermission[]) {
  const s = await getSettings();
  await setSettings({ plugins: { ...(s.plugins ?? {}), [pluginId]: { enabled, granted } } });
}

/** A random id (for tests and new vault names). */
export const rid = () => randomBytes(6).toString('hex');
export { baseOf };
