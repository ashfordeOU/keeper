// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The text the brain reads from a file. Plain text, Markdown, code, HTML,
// e-mails, subtitles and office documents (Word, PowerPoint, Excel,
// OpenDocument, EPUB) are read here, whole; PDFs and images use the text the
// library already read (PDF text and on-device OCR). Nothing is written.

import { promises as fsp } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { parseMail, parseSubtitles, rtfToText } from '../docparse';
import type { FileEntry } from '../types';
import { isCode } from './chunk';

const PLAIN = new Set(['txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'log', 'xml', 'svg', 'ipynb']);
const HTML = new Set(['html', 'htm', 'xhtml']);
const OFFICE = new Set(['docx', 'docm', 'dotx', 'pptx', 'pptm', 'xlsx', 'xlsm', 'odt', 'ods', 'odp', 'epub', 'pages', 'key', 'numbers']);
const SUBS = new Set(['srt', 'vtt', 'ass', 'ssa']);

/** Most text kept per file: enough for long documents, bounded for memory. */
export const MAX_TEXT = 1_000_000;
const MAX_READ = 4 * 1024 * 1024;
const MAX_OFFICE = 60 * 1024 * 1024;

export function canExtract(f: FileEntry): boolean {
  return PLAIN.has(f.ext) || HTML.has(f.ext) || OFFICE.has(f.ext) || SUBS.has(f.ext) || isCode(f.ext) || f.ext === 'eml' || f.ext === 'rtf' || !!f.text;
}

/** Turns HTML or XML markup into readable text with paragraph breaks. */
export function markupToText(s: string): string {
  return s
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|a:p|w:p|text:p|text:h)>|<br\s*\/?>|<(w:br|w:tab|text:line-break)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ZipItem {
  name: string;
  method: number;
  packed: number;
  offset: number;
}

/** The entries of a ZIP file held in memory (enough for office documents). */
export function zipEntries(b: Buffer): ZipItem[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: ZipItem[] = [];
  for (let n = 0; n < count && p + 46 <= b.length && b.readUInt32LE(p) === 0x02014b50; n++) {
    const method = b.readUInt16LE(p + 10);
    const packed = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    out.push({ name: b.toString('utf8', p + 46, p + 46 + nameLen), method, packed, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function zipRead(b: Buffer, e: ZipItem): Buffer | undefined {
  if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== 0x04034b50) return undefined;
  const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
  const data = b.subarray(start, start + e.packed);
  try {
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
  } catch {
    /* damaged entry */
  }
  return undefined;
}

const byNumber = (re: RegExp) => (a: ZipItem, b: ZipItem) => Number(a.name.match(re)?.[1] ?? 0) - Number(b.name.match(re)?.[1] ?? 0);

/** Text of Word, PowerPoint, Excel, OpenDocument and EPUB files. */
export function officeText(b: Buffer, ext: string): string {
  const entries = zipEntries(b);
  const read = (e: ZipItem) => zipRead(b, e)?.toString('utf8') ?? '';
  const parts: string[] = [];
  if (ext.startsWith('doc') || ext === 'dotx') {
    for (const e of entries.filter((x) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(x.name))) parts.push(markupToText(read(e)));
  } else if (ext.startsWith('ppt')) {
    const re = /^ppt\/slides\/slide(\d+)\.xml$/;
    for (const e of entries.filter((x) => re.test(x.name)).sort(byNumber(re))) parts.push(markupToText(read(e)));
    for (const e of entries.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x.name))) parts.push(markupToText(read(e)));
  } else if (ext.startsWith('xls')) {
    const shared = entries.find((x) => x.name === 'xl/sharedStrings.xml');
    if (shared) parts.push([...read(shared).matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]).join('\n'));
    // Numbers and inline strings live in the sheets themselves.
    for (const e of entries.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x.name)).slice(0, 20)) {
      const xml = read(e);
      parts.push([...xml.matchAll(/<is><t[^>]*>([^<]*)<\/t><\/is>|<c[^>]*t="n"[^>]*><v>([^<]*)<\/v>/g)].map((m) => m[1] ?? m[2]).join(' '));
    }
  } else if (ext === 'epub') {
    const re = /\.(x?html?)$/i;
    for (const e of entries.filter((x) => re.test(x.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) parts.push(markupToText(read(e)));
  } else {
    // OpenDocument (and the text-bearing parts of iWork exports).
    const c = entries.find((x) => x.name === 'content.xml') ?? entries.find((x) => x.name === 'index.xml');
    if (c) parts.push(markupToText(read(c)));
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Jupyter notebooks: the cells' text, not the JSON around it. */
function notebookText(raw: string): string {
  try {
    const nb = JSON.parse(raw) as { cells?: { cell_type?: string; source?: string | string[] }[] };
    return (nb.cells ?? []).map((c) => (Array.isArray(c.source) ? c.source.join('') : c.source ?? '')).join('\n\n');
  } catch {
    return raw;
  }
}

/** Reads the text of one file for the brain; undefined when it has none. */
export async function extractText(f: FileEntry): Promise<string | undefined> {
  const cut = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
  try {
    if (OFFICE.has(f.ext)) {
      if (f.size > MAX_OFFICE) return f.text || undefined;
      const t = officeText(await fsp.readFile(f.path), f.ext);
      return cut(t) || f.text || undefined;
    }
    const textual = PLAIN.has(f.ext) || HTML.has(f.ext) || SUBS.has(f.ext) || isCode(f.ext) || f.ext === 'eml' || f.ext === 'rtf';
    if (textual && f.size <= MAX_READ) {
      const raw = await fsp.readFile(f.path, 'utf8');
      // Binary data with a text-like name: skip it.
      if (raw.slice(0, 4000).includes('\u0000')) return f.text || undefined;
      if (HTML.has(f.ext)) return cut(markupToText(raw));
      if (f.ext === 'svg' || f.ext === 'xml') return cut(markupToText(raw));
      if (f.ext === 'rtf') return cut(rtfToText(raw));
      if (f.ext === 'ipynb') return cut(notebookText(raw));
      if (f.ext === 'eml') {
        const m = parseMail(raw);
        return cut([`From: ${m.from}`, `To: ${m.to}`, `Subject: ${m.subject}`, m.date ? `Date: ${m.date}` : '', '', m.text || markupToText(m.html ?? '')].filter((x) => x !== undefined).join('\n'));
      }
      if (SUBS.has(f.ext)) return cut(parseSubtitles(raw).map((c) => c.text).join('\n'));
      return cut(raw);
    }
  } catch {
    /* unreadable: fall back to what the library has */
  }
  return f.text || undefined;
}
