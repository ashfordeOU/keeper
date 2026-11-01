// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The parts of file conversion that need no Electron: bitrate maths, page
// ranges, output naming, file encryption, checksums, splitting and joining,
// and reading the text of PDFs. Shared by the app, the CLI and the tests.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { HashAlgo, VideoPreset } from './convert-types';

// ---------------------------------------------------------------- video maths

/**
 * Video bitrate (kbit/s) that makes a file of `targetBytes` for a clip of
 * `durationSec`, after leaving room for audio and ~3% container overhead.
 */
export function videoBitrate(targetBytes: number, durationSec: number, audioKbps = 128): number {
  if (!(durationSec > 0)) throw new Error('The video length is unknown');
  const totalKbps = (targetBytes * 8) / 1000 / durationSec;
  return Math.max(50, Math.floor(totalKbps * 0.97 - audioKbps));
}

/** Smaller targets get less audio, so the picture keeps most of the budget. */
export function audioBitrateFor(targetBytes: number, durationSec: number): number {
  const totalKbps = (targetBytes * 8) / 1000 / Math.max(1, durationSec);
  if (totalKbps < 400) return 48;
  if (totalKbps < 1000) return 96;
  return 128;
}

export const PRESETS: Record<VideoPreset, { label: string; targetMb?: number; height?: number }> = {
  email: { label: 'E-mail (25 MB)', targetMb: 25 },
  discord: { label: 'Chat, small (10 MB)', targetMb: 10 },
  whatsapp: { label: 'Messaging (16 MB)', targetMb: 16 },
  '720p': { label: 'HD 720p', height: 720 },
  '1080p': { label: 'Full HD 1080p', height: 1080 },
};

/** "Duration: 00:01:02.50" -> 62.5 */
export function parseDuration(stderr: string): number | undefined {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : undefined;
}

/** Progress from an ffmpeg line: "time=00:00:01.23" or "out_time_us=1230000". */
export function parseFfmpegTime(line: string): number | undefined {
  const us = line.match(/out_time_(?:us|ms)=(\d+)/);
  if (us) return +us[1] / 1e6;
  const m = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : undefined;
}

/** atempo only accepts 0.5–2, so bigger changes are chained: 4x -> atempo=2,atempo=2 */
export function atempoChain(factor: number): string {
  const parts: number[] = [];
  let f = factor;
  while (f > 2) {
    parts.push(2);
    f /= 2;
  }
  while (f < 0.5) {
    parts.push(0.5);
    f /= 0.5;
  }
  parts.push(Math.round(f * 1000) / 1000);
  return parts.map((p) => `atempo=${p}`).join(',');
}

/** "01:23.5", "83.5", "1:02:03" -> seconds */
export function parseTime(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) throw new Error(`“${text}” is not a time`);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// ---------------------------------------------------------------- page ranges

/**
 * Page list from text, 1-based for people, 0-based in the result:
 * "1-3, 5, 8-" · "last" · "odd" · "even" · "2-last". Duplicates are kept in
 * order (useful for reordering), out-of-range pages are an error.
 */
export function parsePageRanges(spec: string, pageCount: number): number[] {
  const out: number[] = [];
  const s = spec.trim().toLowerCase();
  if (!s || s === 'all') return Array.from({ length: pageCount }, (_, i) => i);
  if (s === 'odd') return Array.from({ length: pageCount }, (_, i) => i).filter((i) => i % 2 === 0);
  if (s === 'even') return Array.from({ length: pageCount }, (_, i) => i).filter((i) => i % 2 === 1);
  const num = (v: string) => {
    if (v === 'last' || v === 'end') return pageCount;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`“${v}” is not a page number`);
    if (n > pageCount) throw new Error(`Page ${n} does not exist; the PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}`);
    return n;
  };
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^([a-z0-9]+)?-([a-z0-9]+)?$/);
    if (m) {
      const a = m[1] ? num(m[1]) : 1;
      const b = m[2] ? num(m[2]) : pageCount;
      if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
      else for (let i = a; i >= b; i--) out.push(i - 1);
    } else {
      out.push(num(part) - 1);
    }
  }
  return out;
}

/** Split ranges into groups: "1-3, 4-6" -> [[0,1,2],[3,4,5]]; empty -> one group per page. */
export function parseSplitGroups(spec: string | undefined, pageCount: number): number[][] {
  if (!spec?.trim()) return Array.from({ length: pageCount }, (_, i) => [i]);
  return spec.split(/[,;]+/).map((p) => p.trim()).filter(Boolean).map((p) => parsePageRanges(p, pageCount));
}

// ---------------------------------------------------------------- output naming

export function stemOf(p: string): string {
  const base = path.basename(p);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The folder results go to: "<name> (Keeper)" next to the first input, unless the user chose one. */
export function outputFolder(inputs: string[], override?: string): string {
  if (override) return override;
  const first = inputs[0];
  const name = inputs.length === 1 ? stemOf(first) : `${stemOf(first)} and ${inputs.length - 1} more`;
  return path.join(path.dirname(first), `${name} (Keeper)`);
}

/** A file name in `dir` that does not exist yet: "photo.jpg", "photo 2.jpg", … */
export function freeName(dir: string, stem: string, ext: string, exists: (p: string) => boolean = existsSync): string {
  const e = ext ? `.${ext.replace(/^\./, '')}` : '';
  let p = path.join(dir, `${stem}${e}`);
  for (let i = 2; exists(p); i++) p = path.join(dir, `${stem} ${i}${e}`);
  return p;
}

// ---------------------------------------------------------------- checksums

export async function checksum(file: string, algo: HashAlgo = 'sha256'): Promise<string> {
  const h = createHash(algo);
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/** Compares a checksum someone pasted (any case, spaces, "sha256:" prefix) to a computed one. */
export function sameChecksum(expected: string, actual: string): boolean {
  const clean = (s: string) => s.trim().toLowerCase().replace(/^(sha\d+|md5)[:=]\s*/, '').replace(/\s+/g, '');
  return clean(expected) === clean(actual);
}

/** Guesses the algorithm from the length of a pasted checksum. */
export function algoForLength(hex: string): HashAlgo | undefined {
  const n = hex.trim().replace(/^(sha\d+|md5)[:=]\s*/i, '').length;
  return n === 32 ? 'md5' : n === 40 ? 'sha1' : n === 64 ? 'sha256' : n === 128 ? 'sha512' : undefined;
}

// ---------------------------------------------------------------- file encryption

// Format: "KEEPENC1" | salt(16) | iv(12) | ciphertext | GCM tag(16)
// The key comes from the password with scrypt (N=2^15, r=8, p=1).
const MAGIC = Buffer.from('KEEPENC1');
const HEADER = MAGIC.length + 16 + 12;
export const ENC_EXT = 'keeper-enc';

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFC'), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function encryptFile(input: string, output: string, password: string): Promise<void> {
  if (!password) throw new Error('Choose a password');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(output, { flags: 'wx' });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(input), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function isEncryptedFile(file: string): Promise<boolean> {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(MAGIC.length);
    await fh.read(buf, 0, buf.length, 0);
    return buf.equals(MAGIC);
  } finally {
    await fh.close();
  }
}

export async function decryptFile(input: string, output: string, password: string): Promise<void> {
  const { size } = await fsp.stat(input);
  if (size < HEADER + 16) throw new Error('This is not a file locked by Keeper');
  const fh = await fsp.open(input, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(16);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, 16, size - 16);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not a file locked by Keeper');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16, HEADER);
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const tmp = `${output}.partial`;
  try {
    await pipeline(createReadStream(input, { start: HEADER, end: size - 17 }), decipher, createWriteStream(tmp, { flags: 'wx' }));
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    if (/auth|unable to authenticate/i.test(String((e as Error).message))) throw new Error('Wrong password, or the file was changed');
    throw e;
  }
  await fsp.rename(tmp, output);
}

// ---------------------------------------------------------------- split & join

/** Cuts a file into parts "name.ext.001", "name.ext.002", … of at most `partBytes`. */
export async function splitFile(input: string, outDir: string, partBytes: number): Promise<string[]> {
  if (partBytes < 1024) throw new Error('Parts must be at least 1 KB');
  const { size } = await fsp.stat(input);
  const count = Math.max(1, Math.ceil(size / partBytes));
  const width = Math.max(3, String(count).length);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = path.join(outDir, `${path.basename(input)}.${String(i + 1).padStart(width, '0')}`);
    await pipeline(createReadStream(input, { start: i * partBytes, end: Math.min(size, (i + 1) * partBytes) - 1 }), createWriteStream(p, { flags: 'wx' }));
    parts.push(p);
  }
  return parts;
}

/** Finds every part of a split file from any one of them, in order. */
export async function findParts(anyPart: string): Promise<{ parts: string[]; original: string }> {
  const m = path.basename(anyPart).match(/^(.*)\.(\d{3,})$/);
  if (!m) throw new Error('Choose a part ending in .001, .002 …');
  const dir = path.dirname(anyPart);
  const names = (await fsp.readdir(dir)).filter((n) => n.startsWith(m[1] + '.') && /^\d{3,}$/.test(n.slice(m[1].length + 1)));
  names.sort((a, b) => Number(a.slice(m[1].length + 1)) - Number(b.slice(m[1].length + 1)));
  const nums = names.map((n) => Number(n.slice(m[1].length + 1)));
  for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) throw new Error(`Part ${String(i + 1).padStart(3, '0')} is missing`);
  return { parts: names.map((n) => path.join(dir, n)), original: m[1] };
}

export async function joinParts(parts: string[], output: string): Promise<void> {
  const out = createWriteStream(output, { flags: 'wx' });
  for (const p of parts) await pipeline(createReadStream(p), out, { end: false });
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
}

// ---------------------------------------------------------------- PDF text

// A real dynamic import, so bundlers do not turn it into require() of an ES module.
const importModule = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

type PdfJs = {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean; verbosity?: number; password?: string }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }>; destroy(): Promise<void> }>;
  };
};

let pdfjs: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  // Some runners (test sandboxes) have no native dynamic import; fall back to the bundler's own.
  pdfjs ??= (importModule('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJs>).catch(() => import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>);
  return pdfjs;
}

/** Text of a PDF (up to `maxChars`) and its page count. Scanned PDFs return little or no text. */
export async function extractPdfText(file: string, maxChars = 20_000, maxPages = 60): Promise<{ text: string; pages: number }> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await fsp.readFile(file));
  const doc = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    let text = '';
    for (let i = 1; i <= Math.min(doc.numPages, maxPages) && text.length < maxChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const it of content.items) text += (it.str ?? '') + (it.hasEOL ? '\n' : ' ');
      text += '\n';
    }
    return { text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars), pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
