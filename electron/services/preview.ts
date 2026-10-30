// SPDX-License-Identifier: AGPL-3.0-or-later
// The main-process side of previews: serves files to the viewer with seeking,
// works out what a file is, reads its details, lists archives, and converts
// what Chromium cannot show (HEIC, RAW, PSD, exotic video and audio) into
// something it can — all on this computer, into a private temp folder.

import { app, nativeImage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { findZipDirectory, parseTar, parseZipDirectory, type ArchiveEntry } from '../../core/archive';
import { extOf, kindOf } from '../../core/classify';
import { readExifDetails } from '../../core/exifDetails';
import { readId3, readMp4Tags } from '../../core/id3';
import { decodeText, detectMagic } from '../../core/magic';
import { PLAYABLE_AUDIO, PLAYABLE_VIDEO, previewKindOf } from '../../core/previewKind';
import type { DisplayImage, PreviewInfo } from '../../core/previewTypes';
import { jpegSize, largestIcnsPng, largestJpeg } from '../../core/raw';
import { isInside } from '../../core/safety';
import { settings } from '../store';

// ---------------------------------------------------------------- access

/** Files the user asked to preview, plus the indexed folders and our temp folder, may be served. */
const granted = new Set<string>();
let tempDir: string | null = null;

export function previewTemp(): string {
  if (!tempDir) {
    tempDir = path.join(os.tmpdir(), `keeper-preview-${process.pid}`);
  }
  return tempDir;
}

export async function cleanupTemp() {
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}

export function grant(p: string) {
  granted.add(path.resolve(p));
}

function allowed(p: string): boolean {
  const r = path.resolve(p);
  if (granted.has(r)) return true;
  if (isInside(r, previewTemp())) return true;
  // Files inside a folder the user previewed (a folder mosaic, a sidecar subtitle).
  for (const g of granted) if (isInside(r, g) && r.split(path.sep).length - g.split(path.sep).length <= 1) return true;
  return settings().folders.some((f) => isInside(r, f));
}

export function fileUrl(p: string): string {
  return 'keeper-file://' + p.split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join('');
}

function pathFromUrl(url: string): string {
  const raw = url.slice('keeper-file://'.length).replace(/[?#].*$/, '');
  return decodeURIComponent(raw);
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  pdf: 'application/pdf', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', vtt: 'text/vtt', json: 'application/json', wasm: 'application/wasm',
};

/**
 * The keeper-file:// handler. Supports HTTP ranges so videos can seek, and
 * refuses anything outside the allowed places.
 */
export async function serveFile(req: Request): Promise<Response> {
  const p = pathFromUrl(req.url);
  if (!allowed(p)) return new Response('Not allowed', { status: 403 });
  let st;
  try {
    st = await fsp.stat(p);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!st.isFile()) return new Response('Not a file', { status: 400 });
  const type = MIME[extOf(path.basename(p))] ?? 'application/octet-stream';
  // SVG is served as a plain image: scripts inside never run in an <img>, and the CSP below blocks them elsewhere.
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'content-security-policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:",
    'x-content-type-options': 'nosniff',
    // Lets the viewer read pixels (colour picker, histogram); only Keeper's own windows can reach this scheme.
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  };
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range && st.size > 0) {
    let start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10);
    let end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end) return new Response('Bad range', { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
    headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
    headers['content-length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers['content-length'] = String(st.size);
  return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { status: 200, headers });
}

// ---------------------------------------------------------------- reading

async function readHead(p: string, len: number, from = 0): Promise<Uint8Array> {
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, from);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally {
    await fh.close();
  }
}

const dataUrl = (mime: string, data: Uint8Array) => `data:${mime};base64,${Buffer.from(data).toString('base64')}`;

function run(file: string, args: string[], timeout = 30_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' }));
  });
}

export function ffmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (!p) return null;
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    return existsSync(unpacked) ? unpacked : existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- info

export async function info(p: string): Promise<PreviewInfo> {
  grant(p);
  const st = await fsp.stat(p);
  const name = path.basename(p);
  const isDir = st.isDirectory();
  const ext = extOf(name);
  const head = isDir ? new Uint8Array() : await readHead(p, 4096);
  const magic = isDir ? undefined : detectMagic(head);
  const kind = previewKindOf(name, ext, isDir, magic);
  const base: PreviewInfo = {
    path: p, name, ext, size: st.size, mtime: st.mtimeMs, btime: st.birthtimeMs || st.mtimeMs, isDir, kind,
    format: magic?.label ?? (isDir ? 'Folder' : ext ? `${ext.toUpperCase()} file` : 'File'), mime: magic?.mime ?? MIME[ext] ?? 'application/octet-stream',
    url: fileUrl(p),
  };
  if (kind === 'video') base.playable = PLAYABLE_VIDEO.has(ext);
  if (kind === 'audio') base.playable = PLAYABLE_AUDIO.has(ext);
  try {
    if (['image', 'raw', 'heic', 'tiff'].includes(kind) && !['png', 'gif', 'bmp', 'ico'].includes(ext)) {
      base.exif = readExifDetails(await readHead(p, 1024 * 1024));
    }
    if (kind === 'audio' || (kind === 'video' && ext === 'm4v')) {
      const startBytes = await readHead(p, 4 * 1024 * 1024);
      let tags = readId3(startBytes) ?? readMp4Tags(startBytes);
      if (!tags && st.size > startBytes.length && (ext === 'm4a' || ext === 'mp4' || ext === 'm4b')) {
        // The "moov" box is often at the end of the file.
        const whole = st.size < 64 * 1024 * 1024 ? new Uint8Array(await fsp.readFile(p)) : undefined;
        if (whole) tags = readMp4Tags(whole);
      }
      if (tags) base.audio = { ...tags, cover: tags.cover ? dataUrl(tags.cover.mime, tags.cover.data) : undefined };
    }
    if (kind === 'app') base.app = await appInfo(p, ext, isDir);
    if (kind === 'folder') base.folder = await folderInfo(p);
  } catch {
    /* details are a bonus */
  }
  return base;
}

async function appInfo(p: string, ext: string, isDir: boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (isDir && ext === 'app') {
    const plist = path.join(p, 'Contents', 'Info.plist');
    const r = process.platform === 'darwin' ? await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]) : { ok: false, stdout: '' };
    if (r.ok) {
      const d = JSON.parse(r.stdout) as Record<string, unknown>;
      const pick: [string, string][] = [['CFBundleDisplayName', 'Name'], ['CFBundleName', 'Name'], ['CFBundleShortVersionString', 'Version'], ['CFBundleVersion', 'Build'], ['CFBundleIdentifier', 'Identifier'], ['LSMinimumSystemVersion', 'Needs macOS'], ['NSHumanReadableCopyright', 'Copyright'], ['LSApplicationCategoryType', 'Category']];
      for (const [k, label] of pick) if (typeof d[k] === 'string' && !out[label]) out[label] = (d[k] as string).replace(/^public\.app-category\./, '');
    } else {
      const text = await fsp.readFile(plist, 'utf8').catch(() => '');
      const get = (k: string) => text.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`))?.[1];
      if (get('CFBundleShortVersionString')) out.Version = get('CFBundleShortVersionString')!;
      if (get('CFBundleIdentifier')) out.Identifier = get('CFBundleIdentifier')!;
    }
  } else if ((ext === 'exe' || ext === 'msi' || ext === 'dll') && process.platform === 'win32') {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${p.replace(/'/g, "''")}').VersionInfo | Select-Object ProductName,FileDescription,ProductVersion,CompanyName,LegalCopyright | ConvertTo-Json -Compress`]);
    try {
      const d = JSON.parse(r.stdout) as Record<string, string | null>;
      const labels: Record<string, string> = { ProductName: 'Name', FileDescription: 'Description', ProductVersion: 'Version', CompanyName: 'Publisher', LegalCopyright: 'Copyright' };
      for (const [k, v] of Object.entries(d)) if (v) out[labels[k] ?? k] = v;
    } catch {
      /* not a Windows program with version info */
    }
  } else if (ext === 'deb') {
    const r = await run('dpkg-deb', ['-f', p]);
    if (r.ok) for (const line of r.stdout.split('\n')) {
      const m = line.match(/^(Package|Version|Architecture|Maintainer|Installed-Size|Section|Description|Homepage|Depends):\s*(.*)$/);
      if (m) out[m[1] === 'Installed-Size' ? 'Installed size' : m[1]] = m[1] === 'Installed-Size' ? `${Math.round(+m[2] / 1024)} MB` : m[2];
    }
  } else if (ext === 'rpm') {
    const r = await run('rpm', ['-qip', p]);
    if (r.ok) for (const line of r.stdout.split('\n')) {
      const m = line.match(/^(Name|Version|Release|Architecture|Summary|URL|License)\s*:\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  const magic = isDir ? undefined : detectMagic(await readHead(p, 4096));
  if (magic) out.Format = magic.label;
  return out;
}

async function folderInfo(p: string): Promise<PreviewInfo['folder']> {
  const LIMIT = 5000;
  let files = 0;
  let folders = 0;
  let size = 0;
  let truncated = false;
  const kinds: Record<string, number> = {};
  const images: string[] = [];
  const queue = [p];
  let seen = 0;
  while (queue.length) {
    const dir = queue.shift()!;
    let list;
    try {
      list = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of list) {
      if (++seen > LIMIT) {
        truncated = true;
        queue.length = 0;
        break;
      }
      if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        folders++;
        if (dir === p || queue.length < 200) queue.push(full);
        continue;
      }
      files++;
      const k = kindOf(d.name);
      kinds[k] = (kinds[k] ?? 0) + 1;
      try {
        size += (await fsp.stat(full)).size;
      } catch {
        /* vanished */
      }
      if (k === 'image' && images.length < 9 && /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(d.name)) {
        images.push(full);
        grant(full);
      }
    }
  }
  return { files, folders, size, kinds, images, truncated };
}

// ---------------------------------------------------------------- text & bytes

export async function text(p: string, maxBytes = 2 * 1024 * 1024): Promise<{ text: string; encoding: string; truncated: boolean; size: number }> {
  grant(p);
  const st = await fsp.stat(p);
  const b = await readHead(p, Math.min(st.size, maxBytes));
  const { text: t, encoding } = decodeText(b);
  return { text: t, encoding, truncated: st.size > maxBytes, size: st.size };
}

export async function bytes(p: string, offset = 0, len = 65536): Promise<string> {
  grant(p);
  return Buffer.from(await readHead(p, Math.min(len, 16 * 1024 * 1024), offset)).toString('base64');
}

// ---------------------------------------------------------------- archives

interface ZipEntryRef extends ArchiveEntry {
  offset?: number;
}

async function zipEntries(p: string): Promise<ZipEntryRef[]> {
  const st = await fsp.stat(p);
  const tailLen = Math.min(st.size, 128 * 1024);
  const tail = await readHead(p, tailLen, st.size - tailLen);
  const dir = findZipDirectory(tail, st.size);
  if (!dir) throw new Error('This file does not look like a valid ZIP archive');
  const cd = await readHead(p, Math.min(dir.size, 64 * 1024 * 1024), dir.offset);
  const entries = parseZipDirectory(cd);
  // Local header offsets for extraction.
  let q = 0;
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  for (const e of entries as ZipEntryRef[]) {
    e.offset = dv.getUint32(q + 42, true);
    q += 46 + dv.getUint16(q + 28, true) + dv.getUint16(q + 30, true) + dv.getUint16(q + 32, true);
  }
  return entries;
}

async function tarBytes(p: string): Promise<Uint8Array | null> {
  const st = await fsp.stat(p);
  if (st.size > 400 * 1024 * 1024) return null;
  const raw = new Uint8Array(await fsp.readFile(p));
  const m = detectMagic(raw.subarray(0, 600));
  if (m?.id === 'gzip') {
    try {
      return new Uint8Array(gunzipSync(raw, { maxOutputLength: 2 * 1024 * 1024 * 1024 }));
    } catch {
      return null;
    }
  }
  return m?.id === 'tar' ? raw : null;
}

/** Lists an archive; falls back to the system's tar (libarchive reads 7z, rar, iso, cab…) and 7-Zip. */
export async function archive(p: string): Promise<{ entries: ArchiveEntry[]; note?: string }> {
  grant(p);
  const name = path.basename(p).toLowerCase();
  const ext = extOf(name);
  const head = await readHead(p, 600);
  const m = detectMagic(head);
  if (m?.id === 'zip') return { entries: await zipEntries(p) };
  if (m?.id === 'gzip' || m?.id === 'tar') {
    const t = await tarBytes(p);
    if (t) {
      const entries = parseTar(t);
      if (entries.length) return { entries };
      // A single gzipped file, not a tar.
      return { entries: [{ name: path.basename(p).replace(/\.gz$/i, ''), size: t.length, dir: false }], note: 'A single compressed file' };
    }
  }
  for (const [bin, args] of [['tar', ['-tvf', p]], ['bsdtar', ['-tvf', p]], ['7z', ['l', '-slt', p]], ['7zz', ['l', '-slt', p]], ['unrar', ['vt', p]]] as const) {
    const r = await run(bin, [...args], 60_000);
    if (!r.ok || !r.stdout.trim()) continue;
    if (bin.startsWith('7z')) return { entries: parse7z(r.stdout) };
    if (bin === 'unrar') return { entries: parseUnrar(r.stdout) };
    const entries = parseTarVerbose(r.stdout);
    if (entries.length) return { entries };
  }
  return { entries: [], note: `Keeper cannot look inside .${ext || 'this'} archives on this computer. Installing 7-Zip adds support.` };
}

function parseTarVerbose(out: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const line of out.split(/\r?\n/)) {
    // drwxr-xr-x  0 user group      0 Oct 30 12:00 folder/
    const m = line.match(/^([d\-lrwxsStT]{10})\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+|\d{4}-\d{2}-\d{2}\s+[\d:]+)\s+(.+)$/) ?? line.match(/^([d\-lrwxsStT]{10})\s+\S+\/\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+[\d:]+)\s+(.+)$/);
    if (m) entries.push({ name: m[4], size: +m[2], dir: m[1][0] === 'd', mtime: Date.parse(m[3]) || undefined });
  }
  return entries;
}

function parse7z(out: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const get = (k: string) => block.match(new RegExp(`^${k} = (.*)$`, 'm'))?.[1];
    const name = get('Path');
    if (!name || get('Type')) continue;
    entries.push({ name, size: +(get('Size') ?? 0), packed: +(get('Packed Size') ?? 0) || undefined, dir: (get('Attributes') ?? '').includes('D') || get('Folder') === '+', mtime: Date.parse(get('Modified') ?? '') || undefined });
  }
  return entries;
}

function parseUnrar(out: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of out.split(/\r?\n\s*\r?\n/)) {
    const name = block.match(/Name: (.*)/)?.[1];
    if (!name) continue;
    entries.push({ name, size: +(block.match(/Size: (\d+)/)?.[1] ?? 0), packed: +(block.match(/Packed size: (\d+)/)?.[1] ?? 0) || undefined, dir: /Type: Directory/.test(block) });
  }
  return entries;
}

/** Reads one entry of a ZIP-based file into memory (documents, e-books, app bundles). */
export async function zipEntry(p: string, pick: (name: string, all: string[]) => boolean, maxBytes = 32 * 1024 * 1024): Promise<{ name: string; data: Buffer } | null> {
  let entries: ZipEntryRef[];
  try {
    entries = await zipEntries(p);
  } catch {
    return null;
  }
  const names = entries.map((e) => e.name);
  const e = entries.find((x) => !x.dir && pick(x.name, names));
  if (!e || e.offset === undefined || e.size > maxBytes) return null;
  const local = await readHead(p, 30, e.offset);
  const dv = new DataView(local.buffer, local.byteOffset, 30);
  if (dv.getUint16(6, true) & 1) return null;
  const method = dv.getUint16(8, true);
  const start = e.offset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  const packed = Buffer.from(await readHead(p, e.packed ?? e.size, start));
  const data = method === 0 ? packed : method === 8 ? inflateRawSync(packed) : null;
  return data ? { name: e.name, data } : null;
}

/** Unpacks one entry into the preview temp folder and returns its path. */
export async function extract(p: string, entryName: string): Promise<string> {
  grant(p);
  const safeName = entryName.replace(/\\/g, '/').split('/').filter((s) => s && s !== '..' && s !== '.').join('/');
  if (!safeName) throw new Error('Bad entry name');
  const dir = path.join(previewTemp(), 'extract', createHash('sha1').update(p).digest('hex').slice(0, 12));
  const out = path.join(dir, ...safeName.split('/'));
  if (!isInside(out, dir)) throw new Error('Bad entry name');
  if (existsSync(out)) return out;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const m = detectMagic(await readHead(p, 600));
  if (m?.id === 'zip') {
    const e = (await zipEntries(p)).find((x) => x.name === entryName);
    if (!e || e.offset === undefined) throw new Error('Not found in the archive');
    if (e.size > 2 * 1024 * 1024 * 1024) throw new Error('Too large to preview');
    const local = await readHead(p, 30, e.offset);
    const dv = new DataView(local.buffer, local.byteOffset, 30);
    const flags = dv.getUint16(6, true);
    if (flags & 1) throw new Error('This file is password protected');
    const method = dv.getUint16(8, true);
    const start = e.offset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    const packed = await readHead(p, e.packed ?? e.size, start);
    const data = method === 0 ? packed : method === 8 ? inflateRawSync(packed) : null;
    if (!data) throw new Error('This compression method is not supported for preview');
    await fsp.writeFile(out, data);
    return out;
  }
  if (m?.id === 'gzip' || m?.id === 'tar') {
    const t = await tarBytes(p);
    if (t) {
      let q = 0;
      let longName: string | undefined;
      while (q + 512 <= t.length) {
        const header = t.subarray(q, q + 512);
        if (header.every((x) => x === 0)) break;
        const size = parseInt(new TextDecoder().decode(header.subarray(124, 135)).trim() || '0', 8) || 0;
        const type = String.fromCharCode(header[156] || 48);
        const nm = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
        const prefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0.*$/s, '');
        const body = q + 512;
        if (type === 'L') longName = new TextDecoder().decode(t.subarray(body, body + size)).replace(/\0.*$/s, '');
        else {
          const full = longName ?? (prefix ? `${prefix}/${nm}` : nm);
          longName = undefined;
          if (full === entryName && type !== '5') {
            await fsp.writeFile(out, t.subarray(body, body + size));
            return out;
          }
        }
        q = body + Math.ceil(size / 512) * 512;
      }
      if (!detectMagic(t.subarray(0, 600)) || parseTar(t).length === 0) {
        await fsp.writeFile(out, t);
        return out;
      }
    }
  }
  for (const [bin, args] of [['tar', ['-xf', p, '-C', dir, entryName]], ['7z', ['x', '-y', `-o${dir}`, p, entryName]], ['7zz', ['x', '-y', `-o${dir}`, p, entryName]], ['unrar', ['x', '-y', p, entryName, dir + path.sep]]] as const) {
    const r = await run(bin, [...args], 120_000);
    if (r.ok && existsSync(out)) return out;
  }
  throw new Error('Keeper could not open this file inside the archive');
}

// ---------------------------------------------------------------- media conversion

const jobs = new Map<string, Promise<string>>();

async function cacheName(p: string, suffix: string): Promise<string> {
  const st = await fsp.stat(p);
  const key = createHash('sha1').update(`${p}|${st.mtimeMs}|${st.size}|${suffix}`).digest('hex').slice(0, 16);
  await fsp.mkdir(path.join(previewTemp(), 'media'), { recursive: true });
  return path.join(previewTemp(), 'media', `${key}.${suffix}`);
}

/**
 * Converts video or audio Chromium cannot play (AVI, WMV, FLV, MPEG-2, HEVC on
 * some systems, WMA, AIFF, APE…) into WebM/Opus for the viewer. The first ten
 * minutes are enough for a preview.
 */
export async function transcode(p: string, audioOnly = false): Promise<string> {
  grant(p);
  const out = await cacheName(p, audioOnly ? 'ogg' : 'webm');
  if (existsSync(out)) return out;
  const running = jobs.get(out);
  if (running) return running;
  const ff = ffmpegPath();
  if (!ff) throw new Error('Video conversion is not available on this computer');
  const args = audioOnly
    ? ['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-t', '600', '-vn', '-c:a', 'libopus', '-b:a', '128k', out]
    : ['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-t', '600', '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-c:a', 'libvorbis', '-b:a', '128k', out];
  const job = new Promise<string>((resolve, reject) => {
    const child = spawn(ff, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 && existsSync(out) ? resolve(out) : reject(new Error(err.split('\n').filter(Boolean).pop() || 'Could not convert this file'))));
  }).finally(() => jobs.delete(out));
  jobs.set(out, job);
  return job;
}

/** A still frame from a video, for thumbnails and the scrub strip. */
export async function videoFrame(p: string, at: number | 'auto' = 'auto', width = 480): Promise<string | null> {
  const ff = ffmpegPath();
  if (!ff) return null;
  const out = await cacheName(p, `f${at}-${width}.jpg`);
  if (existsSync(out)) return out;
  const seek = at === 'auto' ? await autoSeek(ff, p) : at;
  const r = await new Promise<boolean>((resolve) => {
    execFile(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seek), '-i', p, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out], { timeout: 30_000, windowsHide: true }, (e) => resolve(!e));
  });
  return r && existsSync(out) ? out : null;
}

async function autoSeek(ff: string, p: string): Promise<number> {
  // ffmpeg prints the duration on stderr; 10% in avoids black opening frames.
  const r = await new Promise<string>((resolve) => execFile(ff, ['-hide_banner', '-i', p], { timeout: 10_000, windowsHide: true }, (_e, _o, stderr) => resolve(stderr ?? '')));
  const m = r.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dur = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  return dur ? Math.min(dur * 0.1, 30) : 1;
}

/** Frames spread across a video for the scrubbing strip. */
export async function filmstrip(p: string, count = 10): Promise<string[]> {
  grant(p);
  const ff = ffmpegPath();
  if (!ff) return [];
  const r = await new Promise<string>((resolve) => execFile(ff, ['-hide_banner', '-i', p], { timeout: 10_000, windowsHide: true }, (_e, _o, stderr) => resolve(stderr ?? '')));
  const m = r.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dur = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  if (!dur) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = await videoFrame(p, Math.round(((i + 0.5) * dur * 100) / count) / 100, 200);
    if (f) out.push(fileUrl(f));
  }
  return out;
}

// ---------------------------------------------------------------- images Chromium cannot show

let heifModule: { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } } | null = null;
interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: unknown) => void): void;
}

async function decodeHeif(b: Uint8Array): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    heifModule ??= require('libheif-js/wasm-bundle');
    const images = new heifModule!.HeifDecoder().decode(b);
    const img = images[0];
    if (!img) return null;
    const width = img.get_width();
    const height = img.get_height();
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    await new Promise<void>((resolve, reject) => img.display(target, (d) => (d ? resolve() : reject(new Error('decode failed')))));
    return target;
  } catch {
    return null;
  }
}

async function sharpOf() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

/**
 * Turns HEIC, RAW, PSD, JPEG XL, TGA, EXR, DDS, ICNS and friends into a JPEG
 * or PNG in the temp folder. Tries the fastest faithful route first.
 */
export async function displayImage(p: string, maxSide = 4096): Promise<DisplayImage | null> {
  grant(p);
  const ext = extOf(path.basename(p));
  const out = await cacheName(p, `d${maxSide}.jpg`);
  const outPng = out.replace(/\.jpg$/, '.png');
  for (const f of [out, outPng]) if (existsSync(f)) return { path: f, url: fileUrl(f), via: 'cache' };
  const sharp = await sharpOf();
  const st = await fsp.stat(p);
  const finish = async (src: Buffer | { raw: Uint8ClampedArray | Uint8Array; width: number; height: number; channels: 3 | 4 }, via: string, alpha = false) => {
    if (!sharp) {
      const img = Buffer.isBuffer(src) ? nativeImage.createFromBuffer(src) : null;
      if (!img || img.isEmpty()) return null;
      await fsp.writeFile(outPng, img.toPNG());
      return { path: outPng, url: fileUrl(outPng), via };
    }
    let s = Buffer.isBuffer(src) ? sharp(src, { failOn: 'none' }) : sharp(Buffer.from(src.raw.buffer, src.raw.byteOffset, src.raw.byteLength), { raw: { width: src.width, height: src.height, channels: src.channels } });
    s = s.rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    const target = alpha ? outPng : out;
    const meta = await (alpha ? s.png() : s.jpeg({ quality: 88 })).toFile(target);
    return { path: target, url: fileUrl(target), width: meta.width, height: meta.height, via };
  };

  if (ext === 'icns') {
    const png = largestIcnsPng(new Uint8Array(await fsp.readFile(p)));
    if (png) return finish(Buffer.from(png), 'icns', true);
  }

  if (['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'mos', 'iiq', 'rwl', 'raw'].includes(ext)) {
    if (st.size < 300 * 1024 * 1024) {
      const b = new Uint8Array(await fsp.readFile(p));
      const jpeg = largestJpeg(b);
      if (jpeg && (jpegSize(jpeg)?.width ?? 0) >= 160) {
        // Embedded previews carry no orientation; apply the RAW file's own.
        const orientation = readExifDetails(b.subarray(0, 1024 * 1024))?.orientation;
        if (sharp) {
          let s = sharp(Buffer.from(jpeg), { failOn: 'none' });
          const rot: Record<number, number> = { 3: 180, 6: 90, 8: 270 };
          if (orientation && rot[orientation]) s = s.rotate(rot[orientation]);
          const meta = await s.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(out);
          return { path: out, url: fileUrl(out), width: meta.width, height: meta.height, via: 'embedded preview' };
        }
        await fsp.writeFile(out, jpeg);
        return { path: out, url: fileUrl(out), via: 'embedded preview' };
      }
    }
  }

  if (ext === 'psd' || ext === 'psb') {
    try {
      const { readPsd } = await import('ag-psd');
      const psd = readPsd(await fsp.readFile(p), { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
      const id = psd.imageData;
      if (id) return await finish({ raw: id.data as Uint8ClampedArray, width: id.width, height: id.height, channels: 4 }, 'composite', true);
    } catch {
      /* fall through to the OS */
    }
  }

  // sharp: TIFF, SVG, AVIF, WebP, GIF, and HEIF when the build includes it.
  if (sharp && !['heic', 'heif', 'hif'].includes(ext)) {
    try {
      return await finish(await fsp.readFile(p), 'sharp', ['png', 'svg', 'tif', 'tiff', 'webp', 'gif'].includes(ext));
    } catch {
      /* try the next decoder */
    }
  }

  if (['heic', 'heif', 'hif', 'avif'].includes(ext) || detectMagic(await readHead(p, 64))?.id === 'heic') {
    if (process.platform === 'darwin') {
      const r = await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', String(maxSide), p, '--out', out], 60_000);
      if (r.ok && existsSync(out)) return { path: out, url: fileUrl(out), via: 'system' };
    }
    if (st.size < 200 * 1024 * 1024) {
      const decoded = await decodeHeif(new Uint8Array(await fsp.readFile(p)));
      if (decoded) return finish({ raw: decoded.data, width: decoded.width, height: decoded.height, channels: 4 }, 'built-in HEIC decoder');
    }
  }

  // The OS thumbnailer (Quick Look / Windows shell) knows many formats.
  if (process.platform !== 'linux') {
    try {
      const img = await nativeImage.createThumbnailFromPath(p, { width: maxSide, height: maxSide });
      if (!img.isEmpty()) return finish(img.toPNG(), 'system', true);
    } catch {
      /* not supported */
    }
  }

  // ffmpeg decodes TGA, EXR, DDS, JPEG 2000, PCX, QOI, HDR…
  const ff = ffmpegPath();
  if (ff) {
    const ok = await new Promise<boolean>((resolve) => execFile(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-frames:v', '1', '-vf', `scale='min(${maxSide},iw)':-2`, outPng], { timeout: 60_000, windowsHide: true }, (e) => resolve(!e)));
    if (ok && existsSync(outPng)) return { path: outPng, url: fileUrl(outPng), via: 'ffmpeg' };
  }
  return null;
}

export function initPreview() {
  app.on('will-quit', () => void cleanupTemp());
}
