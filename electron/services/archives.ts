// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Archives: look inside zip, 7z, rar, tar (.gz, .xz, .zst, .bz2), ISO and CAB
// files without unpacking them, take out what you choose, and make ZIP (with
// an AES-256 password) or 7z archives. ZIP and TAR are read by Keeper itself;
// the rest by the system's tar (libarchive: built into macOS and Windows 10+)
// or 7-Zip when it is installed. Everything happens on this computer.

import { execFile } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ArchiveEntry } from '../../core/archive';
import type { ExtractResult, OpenedArchive } from '../../core/archives';
import { createEngine, engineFor, expandSelection, extractFolderName, formatOf, newArchiveName, sevenZipArgs, sevenZipHint, supportRows, tarArgs, unsafeEntry, type ArchiveTools, type CreateFormat, type SupportRow } from '../../core/archives';
import { uniqueName } from '../../core/rules';
import { collectFiles, untar, unzip, writeEntries, zip } from '../../core/zipwrite';
import { grant, parse7z, parseTarVerbose, parseUnrar, previewTemp, extract as previewExtract, zipEntries } from './preview';
import { settings } from '../store';

/** What Keeper reads in memory itself; bigger archives go to the outside tools. */
const OWN_LIMIT = 1024 ** 3;

function run(file: string, args: string[], o: { timeout?: number; cwd?: string } = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: o.timeout ?? 120_000, cwd: o.cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' }));
  });
}

let toolsCache: { at: number; tools: ArchiveTools } | undefined;

/** The archive programs on this computer (looked for again after a minute, so a fresh 7-Zip install is noticed). */
export async function tools(): Promise<ArchiveTools> {
  if (toolsCache && Date.now() - toolsCache.at < 60_000) return toolsCache.tools;
  const t: ArchiveTools = {};
  const version = async (bin: string, args = ['--version']) => { const r = await run(bin, args, { timeout: 8000 }); return r.ok || r.stdout || r.stderr ? `${r.stdout}\n${r.stderr}` : ''; };
  const tarBin = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const tv = await version(tarBin);
  if (/bsdtar|libarchive/i.test(tv)) t.bsdtar = tarBin;
  else if (/GNU tar/i.test(tv)) t.gnutar = tarBin;
  if (!t.bsdtar && /bsdtar|libarchive/i.test(await version('bsdtar'))) t.bsdtar = 'bsdtar';
  const sevens = ['7zz', '7z', '7za', ...(process.platform === 'win32' ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe'), path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', '7-Zip', '7z.exe')] : []), ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/7zz', '/usr/local/bin/7zz', '/opt/homebrew/bin/7z', '/usr/local/bin/7z'] : [])];
  for (const s of sevens) {
    if (path.isAbsolute(s) && !existsSync(s)) continue;
    if (/7-Zip/i.test(await version(s, ['i']))) { t.sevenZip = s; t.sevenZipLite = /(^|[\\/])7za(\.exe)?$/i.test(s); break; }
  }
  if (/UNRAR/i.test(await version('unrar', []))) t.unrar = 'unrar';
  toolsCache = { at: Date.now(), tools: t };
  return t;
}

async function head(p: string, n = 600): Promise<Uint8Array> {
  const fh = await fsp.open(p, 'r');
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Looks inside an archive without unpacking it. */
export async function open(p: string, password?: string): Promise<OpenedArchive> {
  const st = await fsp.stat(p);
  const name = path.basename(p);
  const format = formatOf(name, await head(p));
  const base = { path: p, name, size: st.size, entries: [] as ArchiveEntry[], encrypted: false };
  if (!format) return { ...base, format: 'zip', note: 'This file is not an archive Keeper knows.' };
  const t = await tools();
  const big = st.size > OWN_LIMIT;
  if (format === 'zip' && !big) {
    try {
      const entries = await zipEntries(p);
      return { ...base, format, entries: entries.map(({ name: n, size, packed, mtime, dir, encrypted }) => ({ name: n, size, packed, mtime, dir, encrypted })), encrypted: entries.some((e) => e.encrypted), engine: 'keeper' };
    } catch { /* a damaged or unusual zip: let the outside tools try */ }
  }
  if ((format === 'tar' || format === 'tar.gz') && !big) {
    try {
      const entries = untar(await fsp.readFile(p), OWN_LIMIT).map((e) => ({ name: e.name, size: e.data?.length ?? 0, dir: e.dir, mtime: e.mtime?.getTime() }));
      if (entries.length) return { ...base, format, entries, engine: 'keeper' };
    } catch { /* fall through */ }
  }
  if (format === 'gz' && !big) return { ...base, format, entries: [{ name: name.replace(/\.gz$/i, ''), size: st.size, dir: false }], engine: 'keeper', note: 'A single compressed file' };
  // 7-Zip first when a password was given (libarchive cannot decrypt 7z or RAR).
  const e = engineFor(format, t, { encrypted: !!password, big });
  if (!e.engine) return { ...base, format, note: `${e.missing}. ${sevenZipHint(process.platform)}` };
  const listed = await listWith(e.engine, e.bin!, p, password);
  if (listed.entries) return { ...base, format, entries: listed.entries, encrypted: !!listed.encrypted || !!password, engine: e.engine };
  if (listed.needsPassword) {
    if (password) throw new Error('Wrong password');
    const seven = engineFor(format, t, { encrypted: true });
    return { ...base, format, encrypted: true, needsPassword: true, note: seven.engine ? undefined : `${seven.missing}. ${sevenZipHint(process.platform)}` };
  }
  // the first engine could not read it: try 7-Zip
  if (e.engine !== '7zip' && t.sevenZip) {
    const r = await listWith('7zip', t.sevenZip, p, password);
    if (r.entries) return { ...base, format, entries: r.entries, encrypted: !!r.encrypted, engine: '7zip' };
    if (r.needsPassword) return { ...base, format, encrypted: true, needsPassword: true };
  }
  return { ...base, format, note: `Keeper could not read this archive on this computer. It may be damaged${t.sevenZip ? '' : `, or need 7-Zip. ${sevenZipHint(process.platform)}`}` };
}

async function listWith(engine: string, bin: string, p: string, password?: string): Promise<{ entries?: ArchiveEntry[]; encrypted?: boolean; needsPassword?: boolean }> {
  if (engine === '7zip') {
    const r = await run(bin, sevenZipArgs('list', p, { password }));
    if (/wrong password|can not open encrypted|enter password|encrypted archive/i.test(r.stderr + r.stdout) && !r.ok) return { needsPassword: true };
    if (!r.ok && !r.stdout.includes('Path = ')) return {};
    // -ba lists entries without the archive's own block
    const entries = parse7z(r.stdout.startsWith('Path = ') ? `\n\n${r.stdout}` : r.stdout);
    return { entries, encrypted: /^Encrypted = \+/m.test(r.stdout) };
  }
  if (engine === 'unrar') {
    const r = await run(bin, ['vt', password ? `-p${password}` : '-p-', '--', p]);
    if (!r.ok) return /password/i.test(r.stdout + r.stderr) ? { needsPassword: true } : {};
    return { entries: parseUnrar(r.stdout), encrypted: !!password };
  }
  const r = await run(bin, tarArgs('list', p));
  if (!r.ok && /passphrase|encrypt/i.test(r.stderr)) return { needsPassword: true };
  const entries = parseTarVerbose(r.stdout);
  return entries.length || r.ok ? { entries } : {};
}

/** Where taken-out files go: a new folder beside the archive (or in Downloads when that folder can't be written). */
async function destinationFor(p: string, dest?: string): Promise<string> {
  if (dest) return dest;
  const folder = extractFolderName(path.basename(p));
  let parent = path.dirname(p);
  try { await fsp.access(parent, (await import('node:fs')).constants.W_OK); } catch { parent = path.join(os.homedir(), 'Downloads'); }
  return uniqueName(path.join(parent, folder), existsSync);
}

/** Takes chosen entries (files, or whole folders) out of an archive; all of it when none are chosen. */
export async function extract(p: string, picked: string[] | null, o: { dest?: string; password?: string } = {}): Promise<ExtractResult> {
  const a = await open(p, o.password).catch((e) => { throw e; });
  if (a.needsPassword && !o.password) throw new Error('This archive is protected with a password');
  if (a.note && !a.entries.length) throw new Error(a.note);
  const names = picked?.length ? expandSelection(a.entries, picked) : a.entries.map((e) => e.name);
  const skipped = names.filter(unsafeEntry);
  const safe = names.filter((n) => !unsafeEntry(n));
  if (!safe.length) throw new Error('Nothing to take out');
  const dest = await destinationFor(p, o.dest);
  await fsp.mkdir(dest, { recursive: true });
  const want = new Set(safe);
  const chosenAll = !picked?.length;
  const t = await tools();
  if (a.engine === 'keeper') {
    const buf = await fsp.readFile(p);
    const entries = a.format === 'zip' ? unzip(buf, o.password, undefined, (n) => chosenAll || want.has(n)) : a.format === 'gz' ? [{ name: a.entries[0].name, dir: false, data: (await import('node:zlib')).gunzipSync(buf) }] : untar(buf, undefined, (n) => chosenAll || want.has(n) || want.has(n.replace(/\/$/, '')));
    const r = await writeEntries(entries, dest);
    return { dest, files: r.files, skipped: [...skipped, ...r.skipped] };
  }
  const e = engineFor(a.format, t, { encrypted: a.encrypted || !!o.password, big: a.size > OWN_LIMIT });
  if (!e.engine) throw new Error(`${e.missing}. ${sevenZipHint(process.platform)}`);
  const list = chosenAll ? [] : safe;
  let r: { ok: boolean; stdout: string; stderr: string };
  if (e.engine === '7zip') r = await run(e.bin!, sevenZipArgs('extract', p, { names: list, dest, password: o.password }), { timeout: 3600_000 });
  else if (e.engine === 'unrar') r = await run(e.bin!, ['x', '-y', o.password ? `-p${o.password}` : '-p-', '--', p, ...list, dest + path.sep], { timeout: 3600_000 });
  else r = await run(e.bin!, tarArgs('extract', p, { names: list, dest, password: o.password, gnu: e.engine === 'gnutar' }), { timeout: 3600_000 });
  if (!r.ok) {
    if (/password|passphrase|encrypt/i.test(r.stderr + r.stdout)) throw new Error(o.password ? 'Wrong password' : 'This archive is protected with a password');
    throw new Error(`Could not take the files out: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? 'unknown problem'}`);
  }
  return { dest, files: safe.filter((n) => !n.endsWith('/')).length, skipped };
}

/** One entry into Keeper's preview folder, for Quick Look (nothing is put next to the archive). */
export async function peek(p: string, entry: string, password?: string): Promise<string> {
  grant(p);
  const a = await open(p, password);
  if (a.engine === 'keeper' && a.format === 'zip' && a.entries.find((e) => e.name === entry)?.encrypted) {
    const dir = path.join(previewTemp(), 'archive-peek', String(Date.now()));
    const r = await extract(p, [entry], { dest: dir, password });
    return path.join(r.dest, ...entry.split('/'));
  }
  if (a.engine === 'keeper' || !password) return previewExtract(p, entry);
  const dir = path.join(previewTemp(), 'archive-peek', String(Date.now()));
  const r = await extract(p, [entry], { dest: dir, password });
  return path.join(r.dest, ...entry.split('/'));
}

/** Packs files and folders into a new ZIP (AES-256 with a password) or 7z archive next to the first one. */
export async function create(paths: string[], o: { format: CreateFormat; password?: string; name?: string; dest?: string }): Promise<string> {
  if (!paths.length) throw new Error('Choose files or folders to pack');
  const password = o.password?.length ? o.password : undefined;
  const dir = o.dest ?? path.dirname(paths[0]);
  const fileName = (o.name?.trim() || newArchiveName(paths, o.format)).replace(/[\\/:*?"<>|]+/g, ' ');
  const out = uniqueName(path.join(dir, fileName.toLowerCase().endsWith(`.${o.format}`) ? fileName : `${fileName}.${o.format}`), existsSync);
  const t = await tools();
  const e = createEngine(o.format, t, password);
  if (!e.engine) throw new Error(`${e.missing}. ${sevenZipHint(process.platform)}`);
  if (e.engine === 'keeper') {
    const files = await collectFiles(paths);
    let total = 0;
    for (const f of files) if (!f.name.endsWith('/')) total += (await fsp.stat(f.abs)).size;
    if (total > OWN_LIMIT) {
      if (!t.sevenZip) throw new Error('These files are over 1 GB; Keeper makes ZIPs up to 1 GB itself. Install the free 7-Zip program for bigger ones');
      const r = await run(t.sevenZip, sevenZipArgs('create', out, { format: 'zip', password, names: paths }), { timeout: 3600_000 });
      if (!r.ok) throw new Error('Could not make the archive');
      return out;
    }
    const entries = [];
    for (const f of files) {
      const st = await fsp.stat(f.abs);
      entries.push(f.name.endsWith('/') ? { name: f.name, mtime: st.mtime } : { name: f.name, data: await fsp.readFile(f.abs), mtime: st.mtime });
    }
    await fsp.writeFile(out, zip(entries, { password, aes: !!password }));
    return out;
  }
  const parent = path.dirname(paths[0]);
  const names = paths.map((p) => path.relative(parent, p) || path.basename(p));
  const r = e.engine === '7zip'
    ? await run(e.bin!, sevenZipArgs('create', out, { format: '7z', password, names }), { cwd: parent, timeout: 3600_000 })
    : await run(e.bin!, tarArgs('create7z', out, { cwd: parent, names }), { timeout: 3600_000 });
  if (!r.ok) {
    await fsp.rm(out, { force: true });
    throw new Error(`Could not make the archive: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
  }
  return out;
}

/** What works on this computer, per kind, in plain words. */
export async function support(): Promise<{ rows: SupportRow[]; sevenZip: boolean; hint: string; platform: string }> {
  const t = await tools();
  return { rows: supportRows(t), sevenZip: !!t.sevenZip, hint: sevenZipHint(process.platform), platform: process.platform };
}

export const archivesApi = {
  open: (p: string, password?: string) => { grant(p); return open(p, password); },
  extract: async (p: string, picked: string[] | null, o: { dest?: string; password?: string; ask?: boolean } = {}) => {
    let dest = o.dest;
    if (!dest && (o.ask || settings().archives?.extractTo === 'ask')) {
      const { dialog, BrowserWindow } = await import('electron');
      const win = BrowserWindow.getFocusedWindow();
      const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Take the files out to', defaultPath: path.dirname(p) }) : { canceled: true, filePaths: [] };
      if (r.canceled || !r.filePaths[0]) return null;
      dest = r.filePaths[0];
    }
    const res = await extract(p, picked, { ...o, dest });
    if (settings().archives?.openAfter !== false && !process.env.KEEPER_ARCHIVES_TEST) {
      const { shell } = await import('electron');
      void shell.openPath(res.dest);
    }
    return res;
  },
  peek,
  create,
  support,
  pick: async (): Promise<string | null> => {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow();
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Open an archive', filters: [{ name: 'Archives', extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'xz', 'txz', 'zst', 'bz2', 'iso', 'cab', 'jar'] }, { name: 'All files', extensions: ['*'] }] }) : { canceled: true, filePaths: [] };
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  pickItems: async (): Promise<string[]> => {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow();
    // macOS lets one window choose files and folders together; elsewhere it is files (folders come by dragging them in or from Files).
    const props: ('openFile' | 'openDirectory' | 'multiSelections')[] = process.platform === 'darwin' ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'];
    const r = win ? await dialog.showOpenDialog(win, { properties: props, title: 'Choose what to pack' }) : { canceled: true, filePaths: [] };
    return r.canceled ? [] : r.filePaths;
  },
};
