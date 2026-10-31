// SPDX-License-Identifier: AGPL-3.0-or-later
// Splits the text of a file into passages of about 800 characters, so search
// and AI can point at the part of a long file that matters. Prose is cut at
// headings, paragraphs and sentences; source code at top-level declarations.
// Passages overlap a little so a sentence cut in two is still found.

import { fold } from '../query/match';

export interface Chunk {
  /** character offsets into the text the chunk came from */
  start: number;
  end: number;
  /** the nearest heading above the passage, for context */
  heading?: string;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
  code?: boolean;
}

const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'lua', 'r', 'dart', 'sql', 'vue', 'svelte', 'ex', 'exs', 'clj', 'hs', 'ml', 'pl', 'm', 'mm', 'zig', 'nim', 'jl']);

export function isCode(ext: string): boolean {
  return CODE_EXT.has(ext.toLowerCase());
}

const HEADING = /^(?:#{1,6}\s+.+|[A-Z0-9][A-Z0-9 ,.'&/-]{2,60}:?|\d+(?:\.\d+)*\.?\s+[A-Z].{0,70})$/;
// Lines in code that start something new at the top level.
const DECL = /^(?:export\s|public\s|private\s|protected\s|internal\s|static\s|async\s|func\s|fn\s|pub\s|def\s|class\s|function\s|interface\s|type\s|struct\s|enum\s|impl\s|trait\s|module\s|package\s|const\s|let\s|var\s|@\w|#\[|\w[\w<>,\s*&]*\s+\w+\s*\([^;]*$)/;

interface Block {
  start: number;
  end: number;
  heading?: string;
  /** a heading or declaration starts here: a good place to begin a new passage */
  boundary: boolean;
}

/** Paragraph-sized blocks (prose) or declaration-sized blocks (code), with offsets. */
function blocks(text: string, code: boolean): Block[] {
  const out: Block[] = [];
  let heading: string | undefined;
  let start = -1;
  let boundary = false;
  let pos = 0;
  const flush = (end: number) => {
    if (start >= 0 && text.slice(start, end).trim()) out.push({ start, end, heading, boundary });
    start = -1;
    boundary = false;
  };
  for (const line of text.split('\n')) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd + 1;
    const t = line.trim();
    if (!t) {
      // Blank lines end prose paragraphs; in code they only hint.
      if (!code) flush(lineStart);
      continue;
    }
    const startsNew = code ? DECL.test(line) && !/^\s/.test(line) : HEADING.test(t) && t.length < 80;
    if (startsNew) {
      flush(lineStart);
      if (!code) heading = t.replace(/^#+\s*/, '').replace(/:$/, '');
      boundary = true;
    }
    if (start < 0) start = lineStart;
  }
  flush(text.length);
  return out;
}

/** Where to cut a long block: after a sentence, else after a space, else anywhere. */
function cutPoint(text: string, from: number, max: number): number {
  const end = Math.min(text.length, from + max);
  if (end === text.length) return end;
  const piece = text.slice(from, end);
  const minKeep = Math.floor(max * 0.5);
  const sentence = Math.max(piece.lastIndexOf('. '), piece.lastIndexOf('! '), piece.lastIndexOf('? '), piece.lastIndexOf('。'), piece.lastIndexOf('\n'));
  if (sentence >= minKeep) return from + sentence + 1;
  const space = piece.lastIndexOf(' ');
  if (space >= minKeep) return from + space + 1;
  return end;
}

/** Start of the overlap: a word boundary about `overlap` characters before `end`. */
function overlapStart(text: string, start: number, end: number, overlap: number): number {
  if (overlap <= 0 || end - start <= overlap * 2) return end;
  const at = end - overlap;
  const sp = text.indexOf(' ', at);
  return sp > 0 && sp < end ? sp + 1 : at;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 800;
  const overlap = opts.overlap ?? 120;
  const code = !!opts.code;
  const max = code ? Math.round(size * 1.5) : size;
  const out: Chunk[] = [];
  if (!text.trim()) return out;
  let cur: Chunk | null = null;
  const push = (c: Chunk) => {
    if (text.slice(c.start, c.end).trim()) out.push(c);
  };
  for (const b of blocks(text, code)) {
    // A block that fits joins the current passage, unless a new section starts.
    if (cur && b.end - cur.start <= max && !(b.boundary && cur.end - cur.start > size * 0.4)) {
      cur.end = b.end;
      continue;
    }
    if (cur) push(cur);
    cur = null;
    if (b.end - b.start <= max) {
      cur = { start: b.start, end: b.end, heading: b.heading };
      continue;
    }
    // Too long on its own: cut it, overlapping each cut.
    let s = b.start;
    while (s < b.end) {
      const e = Math.min(b.end, cutPoint(text, s, max));
      const piece = { start: s, end: e, heading: b.heading };
      if (e >= b.end) { cur = piece; break; }
      push(piece);
      const next = overlapStart(text, s, e, overlap);
      s = next > s ? next : e;
    }
  }
  if (cur) push(cur);
  return out;
}

// ---------------------------------------------------------------- words for the word index

const STOP = new Set('a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your'.split(' '));
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;

/** A light stemmer: plurals and the commonest endings, so "invoices" finds "invoice". */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

/**
 * The searchable words of a text: folded (no accents, lower case), split on
 * anything that is not a letter or digit, camelCase and snake_case taken apart,
 * and Chinese/Japanese/Korean runs as overlapping pairs of characters.
 */
export function terms(text: string, keepStop = false): string[] {
  const out: string[] = [];
  const raw = fold(text.replace(/([a-z])([A-Z])/g, '$1 $2')).split(/[^\p{L}\p{N}]+/u);
  for (const w of raw) {
    if (!w) continue;
    if (CJK.test(w)) {
      const chars = [...w];
      if (chars.length === 1) out.push(w);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      continue;
    }
    if (w.length > 40) continue;
    if (!keepStop && STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}
