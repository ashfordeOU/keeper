// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Translating whole documents while keeping their shape: only the words are
// sent to the translator, in numbered pieces, and put back exactly where they
// came from. Markdown keeps its marks and code, HTML its tags, Word files
// their paragraphs and styles, subtitles their timings.

import { parseSubtitles, buildSubtitles } from './ai-actions';

export type DocKind = 'txt' | 'md' | 'html' | 'docx' | 'srt' | 'vtt';

export function docKind(file: string): DocKind | null {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'txt' || ext === 'text') return 'txt';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';
  if (ext === 'docx') return 'docx';
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  return null;
}

// ---------------------------------------------------------------- the request

const NL = ' ¶ ';

/** Groups pieces into requests of at most ~`max` characters (and 80 pieces). */
export function batches(texts: string[], max = 6000): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let size = 0;
  texts.forEach((t, i) => {
    if (cur.length && (size + t.length > max || cur.length >= 80)) { out.push(cur); cur = []; size = 0; }
    cur.push(i);
    size += t.length;
  });
  if (cur.length) out.push(cur);
  return out;
}

export function piecesPrompt(language: string, pieces: string[], kind: DocKind): { system: string; prompt: string } {
  const keep = kind === 'md' ? ' Keep Markdown marks (**, _, `code`, [text](link)), URLs and code exactly as they are.' : kind === 'html' ? ' Keep any HTML entities as they are.' : '';
  return {
    system: `Translate text pieces into ${language}. You get numbered pieces "N: text". Reply with exactly the same numbers, one per line, as "N: translation". "¶" marks a line break: keep it. Keep names, numbers and placeholders unchanged.${keep} No other text.`,
    prompt: pieces.map((p, i) => `${i + 1}: ${p.replace(/\r?\n/g, NL)}`).join('\n'),
  };
}

/** Puts translated pieces back in order; a missing piece stays as it was. */
export function readPieces(pieces: string[], reply: string): string[] {
  const map = new Map<number, string>();
  for (const line of reply.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*[:.)]\s?(.*)$/);
    if (m) map.set(Number(m[1]), m[2].replace(/\s*¶\s*/g, '\n'));
  }
  return pieces.map((p, i) => {
    const t = map.get(i + 1);
    return t && t.trim() ? keepEdges(p, t.trim()) : p;
  });
}

/** Keeps the leading and trailing spaces of the original piece around its translation. */
function keepEdges(orig: string, t: string): string {
  const lead = orig.match(/^\s*/)?.[0] ?? '';
  const trail = orig.match(/\s*$/)?.[0] ?? '';
  return lead + t + trail;
}

// ---------------------------------------------------------------- pulling the words out and putting them back

export interface Pieces { pieces: string[]; rebuild: (translated: string[]) => string }

const hasWords = (s: string) => /\p{L}/u.test(s);

/** Plain text: each paragraph is a piece; blank lines stay. */
export function textPieces(src: string): Pieces {
  const parts = src.split(/(\n\s*\n)/);
  const idx: number[] = [];
  const pieces: string[] = [];
  parts.forEach((p, i) => { if (i % 2 === 0 && hasWords(p)) { idx.push(i); pieces.push(p); } });
  return { pieces, rebuild: (t) => { const out = parts.slice(); idx.forEach((k, j) => (out[k] = t[j])); return out.join(''); } };
}

/**
 * Markdown, line by line: code blocks, front matter and HTML comments are
 * left alone; list, quote, heading and table marks stay; the words after them
 * are translated.
 */
export function markdownPieces(src: string): Pieces {
  const lines = src.split('\n');
  const slots: { line: number; prefix: string; suffix: string; cells?: string[] }[] = [];
  const pieces: string[] = [];
  let fence: string | null = null;
  let front = lines[0]?.trim() === '---';
  lines.forEach((line, i) => {
    const t = line.trim();
    if (front) { if (i > 0 && t === '---') front = false; return; }
    const f = t.match(/^(```|~~~)/);
    if (f) { fence = fence === f[1] ? null : fence ?? f[1]; return; }
    if (fence || !hasWords(line) || /^ {4}|\t/.test(line) || /^<!--/.test(t) || /^\[[^\]]+\]:\s/.test(t)) return;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
      const cells = line.split('|');
      const at: number[] = [];
      cells.forEach((c, k) => { if (k > 0 && k < cells.length - 1 && hasWords(c)) { at.push(k); pieces.push(c.trim()); } });
      slots.push({ line: i, prefix: '', suffix: '', cells: at.map(String) });
      return;
    }
    const m = line.match(/^(\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*)(.*?)(\s*)$/);
    const prefix = m?.[1] ?? '';
    slots.push({ line: i, prefix, suffix: m?.[3] ?? '' });
    pieces.push(m?.[2] ?? line);
  });
  return {
    pieces,
    rebuild: (t) => {
      const out = lines.slice();
      let j = 0;
      for (const s of slots) {
        if (s.cells) {
          const cells = out[s.line].split('|');
          for (const k of s.cells) cells[Number(k)] = ` ${t[j++]} `;
          out[s.line] = cells.join('|');
        } else out[s.line] = s.prefix + t[j++] + s.suffix;
      }
      return out.join('\n');
    },
  };
}

/** HTML: the text between tags (not inside script, style, code or pre); tags and attributes stay. */
export function htmlPieces(src: string): Pieces {
  const parts = src.split(/(<[^>]*>)/);
  const idx: number[] = [];
  const pieces: string[] = [];
  let skip = 0;
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      const m = p.match(/^<\s*(\/)?\s*(script|style|code|pre|textarea)\b/i);
      if (m) skip = Math.max(0, skip + (m[1] ? -1 : 1));
      return;
    }
    if (!skip && hasWords(p)) { idx.push(i); pieces.push(p); }
  });
  return { pieces, rebuild: (t) => { const out = parts.slice(); idx.forEach((k, j) => (out[k] = t[j].replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;')))); return out.join(''); } };
}

const xmlUnescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A Word document's body (word/document.xml): each paragraph is one piece.
 * The translation goes into the paragraph's first text run (keeping its
 * style); later runs of that paragraph are emptied. Paragraph styles,
 * tables, pictures and everything else stay as they were.
 */
export function docxXmlPieces(xml: string): Pieces {
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)];
  const pieces: string[] = [];
  const used: { start: number; end: number; body: string }[] = [];
  for (const m of paras) {
    const body = m[0];
    const texts = [...body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => xmlUnescape(x[1]));
    const joined = texts.join('');
    if (!hasWords(joined)) continue;
    pieces.push(joined);
    used.push({ start: m.index!, end: m.index! + body.length, body });
  }
  return {
    pieces,
    rebuild: (t) => {
      let out = '';
      let at = 0;
      used.forEach((u, j) => {
        let first = true;
        const body = u.body.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
          if (first) { first = false; return `<w:t xml:space="preserve">${xmlEscape(t[j])}</w:t>`; }
          return '<w:t xml:space="preserve"></w:t>';
        });
        out += xml.slice(at, u.start) + body;
        at = u.end;
      });
      return out + xml.slice(at);
    },
  };
}

/** Subtitles: each cue's text is a piece; numbers and timings stay exactly. */
export function subtitlePieces(src: string, vtt: boolean): Pieces {
  const { header, cues } = parseSubtitles(src);
  return { pieces: cues.map((c) => c.text.replace(/\s+$/, '')), rebuild: (t) => buildSubtitles(header, cues.map((c, i) => ({ ...c, text: t[i].replace(/\s+$/, '') })), vtt) };
}

/** A file name for the translated copy: "Report.de.docx". */
export function translatedName(file: string, language: string): string {
  const code = language.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'translated';
  const m = file.match(/^(.*?)(\.[^./\\]+)?$/)!;
  return `${m[1]}.${code}${m[2] ?? ''}`;
}
