// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reads a Markdown note the way vault tools do: properties (frontmatter),
// [[wikilinks]] and ![[embeds]] with #heading, #^block and |alias, Markdown
// links, #nested/tags, headings, ^block-ids, tasks, footnotes and callouts.
// Code blocks, inline code and math are skipped so links inside them do not count.

import { parseYaml, stringifyYaml, type YamlValue } from './yaml';

export interface NoteLink {
  /** the link target as written, without #subpath or |alias */
  target: string;
  /** "#Heading" or "#^block" part, without the leading # */
  subpath?: string;
  alias?: string;
  embed: boolean;
  kind: 'wiki' | 'markdown';
  /** where the whole link sits in the text */
  from: number;
  to: number;
  line: number;
  /** written in frontmatter (a property value) */
  inProps?: boolean;
}

export interface Heading { level: number; text: string; line: number; from: number }
export interface Block { id: string; line: number; from: number }
export interface Task { line: number; text: string; status: string; done: boolean }
export interface TagUse { tag: string; line: number; from: number }
export interface Callout { type: string; title: string; line: number; fold?: '+' | '-' }

export interface ParsedNote {
  props: Record<string, YamlValue>;
  /** offset where the body starts (after the frontmatter) */
  bodyStart: number;
  /** the frontmatter could not be read; kept as written */
  propsError?: string;
  links: NoteLink[];
  headings: Heading[];
  blocks: Block[];
  tags: TagUse[];
  tasks: Task[];
  footnotes: { id: string; line: number }[];
  callouts: Callout[];
  aliases: string[];
  words: number;
  chars: number;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/;

export function splitFrontmatter(text: string): { yaml: string | null; body: string; bodyStart: number } {
  if (!text.startsWith('---')) return { yaml: null, body: text, bodyStart: 0 };
  const empty = /^---\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text);
  if (empty) return { yaml: '', body: text.slice(empty[0].length), bodyStart: empty[0].length };
  const m = FM.exec(text);
  if (!m) return { yaml: null, body: text, bodyStart: 0 };
  return { yaml: m[1], body: text.slice(m[0].length), bodyStart: m[0].length };
}

export function readProps(text: string): { props: Record<string, YamlValue>; error?: string } {
  const { yaml } = splitFrontmatter(text);
  if (yaml == null || yaml.trim() === '') return { props: {} };
  try {
    const v = parseYaml(yaml);
    if (v && typeof v === 'object' && !Array.isArray(v)) return { props: v };
    return { props: {}, error: 'Properties are not a list of names and values' };
  } catch (e) {
    return { props: {}, error: (e as Error).message };
  }
}

/** Replaces the properties block (adding or removing it as needed) and keeps the body as written. */
export function writeProps(text: string, props: Record<string, YamlValue>): string {
  const { body, yaml } = splitFrontmatter(text);
  const rest = yaml == null ? text : body;
  if (Object.keys(props).length === 0) return rest;
  return `---\n${stringifyYaml(props)}---\n${rest}`;
}

/** Ranges of the text that are code or math, where links and tags do not count. */
export function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) out.push([m.index, m.index + m[0].length]);
  const inFence = (i: number) => out.some(([a, b]) => i >= a && i < b);
  const extra: [number, number][] = [];
  const math = /\$\$[\s\S]*?\$\$/g;
  while ((m = math.exec(text))) if (!inFence(m.index)) extra.push([m.index, m.index + m[0].length]);
  const inline = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)|`[^`\n]`/g;
  while ((m = inline.exec(text))) if (!inFence(m.index)) extra.push([m.index, m.index + m[0].length]);
  const imath = /\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)/g;
  while ((m = imath.exec(text))) if (!inFence(m.index) && text[m.index - 1] !== '\\') extra.push([m.index, m.index + m[0].length]);
  const comment = /%%[\s\S]*?%%/g;
  while ((m = comment.exec(text))) if (!inFence(m.index)) extra.push([m.index, m.index + m[0].length]);
  return [...out, ...extra].sort((a, b) => a[0] - b[0]);
}

function inRanges(r: [number, number][], i: number): boolean {
  for (const [a, b] of r) {
    if (i < a) return false;
    if (i < b) return true;
  }
  return false;
}

function lineStarts(text: string): number[] {
  const s = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) s.push(i + 1);
  return s;
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** "Note#Heading|Alias" → parts. Escaped pipes (\|) inside tables count as the pipe. */
export function splitLinkInner(inner: string): { target: string; subpath?: string; alias?: string } {
  const bar = inner.search(/\\?\|/);
  let main = inner, alias: string | undefined;
  if (bar >= 0) {
    alias = inner.slice(bar + (inner[bar] === '\\' ? 2 : 1));
    main = inner.slice(0, bar);
  }
  const hash = main.indexOf('#');
  const target = (hash >= 0 ? main.slice(0, hash) : main).trim();
  const subpath = hash >= 0 ? main.slice(hash + 1).trim() : undefined;
  return { target, subpath: subpath || undefined, alias };
}

function decodeUrl(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Lowercase tag without # (tags match regardless of case). */
export const normTag = (t: string) => t.replace(/^#/, '').toLowerCase();

function listOf(v: YamlValue | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => (x == null ? [] : typeof x === 'object' ? [] : [String(x)]));
  if (typeof v === 'object') return [];
  return String(v).split(/[,\s]+/).filter(Boolean);
}

export function parseNote(text: string): ParsedNote {
  const { yaml, bodyStart } = splitFrontmatter(text);
  const { props, error } = readProps(text);
  const starts = lineStarts(text);
  const code = codeRanges(text);
  const links: NoteLink[] = [];
  const headings: Heading[] = [];
  const blocks: Block[] = [];
  const tags: TagUse[] = [];
  const tasks: Task[] = [];
  const footnotes: { id: string; line: number }[] = [];
  const callouts: Callout[] = [];
  const body = text.slice(bodyStart);
  const skip = (i: number) => i < bodyStart || inRanges(code, i);

  let m: RegExpExecArray | null;
  const wiki = /(!?)\[\[([^\]\n]+?)\]\]/g;
  while ((m = wiki.exec(text))) {
    if (skip(m.index)) continue;
    const p = splitLinkInner(m[2]);
    links.push({ ...p, embed: m[1] === '!', kind: 'wiki', from: m.index, to: m.index + m[0].length, line: lineAt(starts, m.index) });
  }
  const md = /(!?)\[((?:[^\]\n\\]|\\.)*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  while ((m = md.exec(text))) {
    if (skip(m.index)) continue;
    let href = m[3];
    if (href.startsWith('<')) href = href.slice(1, -1);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const hash = href.indexOf('#');
    const target = decodeUrl(hash >= 0 ? href.slice(0, hash) : href);
    const subpath = hash >= 0 ? decodeUrl(href.slice(hash + 1)) : undefined;
    if (!target && !subpath) continue;
    links.push({ target, subpath: subpath || undefined, alias: m[2] || undefined, embed: m[1] === '!', kind: 'markdown', from: m.index, to: m.index + m[0].length, line: lineAt(starts, m.index) });
  }
  // Links written as property values ("related: '[[Other note]]'").
  if (yaml) {
    const pw = /\[\[([^\]\n]+?)\]\]/g;
    while ((m = pw.exec(yaml))) {
      const at = text.indexOf('\n', 0) + 1 + m.index;
      links.push({ ...splitLinkInner(m[1]), embed: false, kind: 'wiki', from: at, to: at + m[0].length, line: lineAt(starts, at), inProps: true });
    }
  }
  links.sort((a, b) => a.from - b.from);

  const heading = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/gm;
  while ((m = heading.exec(text))) {
    if (skip(m.index)) continue;
    headings.push({ level: m[1].length, text: m[2].trim(), line: lineAt(starts, m.index), from: m.index });
  }
  // Setext headings (underlined with === or ---).
  const setext = /^([^\n#>\-*+|].*)\n(=+|-+)[ \t]*$/gm;
  while ((m = setext.exec(body))) {
    const at = bodyStart + m.index;
    if (skip(at) || /^\s*$/.test(m[1]) || /^\s*([-*+]|\d+[.)])\s/.test(m[1])) continue;
    headings.push({ level: m[2][0] === '=' ? 1 : 2, text: m[1].trim(), line: lineAt(starts, at), from: at });
  }
  headings.sort((a, b) => a.from - b.from);

  const block = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/gm;
  while ((m = block.exec(text))) {
    const at = m.index + m[0].indexOf('^');
    if (skip(at)) continue;
    blocks.push({ id: m[1], line: lineAt(starts, at), from: at });
  }

  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    const at = m.index + m[1].length;
    if (skip(at)) continue;
    const ls = starts[lineAt(starts, at)];
    // "# Heading" is a heading, not a tag; so is the start of a heading line.
    if (/^#{1,6}$/.test(text.slice(ls, at + 1).trim()) && text[at + 1] === ' ') continue;
    // inside a [[link]] or a URL
    const before = text.slice(ls, at);
    if (/\[\[[^\]]*$/.test(before) || /\]\([^)]*$/.test(before) || /\S+:\/\/\S*$/.test(before)) continue;
    tags.push({ tag: m[2], line: lineAt(starts, at), from: at });
  }
  for (const t of [...listOf(props.tags), ...listOf(props.tag)]) tags.push({ tag: t.replace(/^#/, ''), line: -1, from: -1 });

  const task = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[(.)\][ \t]+(.*)$/gm;
  while ((m = task.exec(text))) {
    if (skip(m.index)) continue;
    tasks.push({ line: lineAt(starts, m.index), text: m[2], status: m[1], done: m[1] !== ' ' });
  }
  const fn = /^\[\^([^\]\s]+)\]:/gm;
  while ((m = fn.exec(text))) if (!skip(m.index)) footnotes.push({ id: m[1], line: lineAt(starts, m.index) });
  const co = /^>[ \t]*\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/gm;
  while ((m = co.exec(text))) {
    if (skip(m.index)) continue;
    callouts.push({ type: m[1].toLowerCase(), title: m[3].trim(), line: lineAt(starts, m.index), ...(m[2] ? { fold: m[2] as '+' | '-' } : {}) });
  }

  const plain = stripForCount(body, code.map(([a, b]) => [a - bodyStart, b - bodyStart] as [number, number]));
  return {
    props, bodyStart, ...(error ? { propsError: error } : {}),
    links, headings, blocks, tags, tasks, footnotes, callouts,
    aliases: [...listOf(props.aliases), ...listOf(props.alias)].filter((a) => typeof a === 'string'),
    words: countWords(plain), chars: plain.replace(/\s/g, '').length,
  };
}

function stripForCount(body: string, code: [number, number][]): string {
  let out = '', at = 0;
  for (const [a, b] of code) {
    if (a < at) continue;
    out += body.slice(at, Math.max(at, a));
    at = Math.max(at, b);
  }
  out += body.slice(at);
  return out
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+(\[.\][ \t]+)?/gm, '')
    .replace(/[*_~=`]+/g, '');
}

/** Words as the status bar counts them: runs of letters/numbers; each CJK character counts as one. */
export function countWords(s: string): number {
  const cjk = s.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0;
  const rest = s.replace(/[぀-ヿ㐀-䶿一-鿿가-힯]/g, ' ');
  const words = rest.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return words + cjk;
}

/** Text of the section under a heading (to the next heading of the same or higher level). */
export function sectionText(text: string, heading: string): string | null {
  const p = parseNote(text);
  const want = slugHeading(heading);
  const hs = p.headings;
  const i = hs.findIndex((h) => slugHeading(h.text) === want);
  if (i < 0) return null;
  const end = hs.slice(i + 1).find((h) => h.level <= hs[i].level);
  return text.slice(hs[i].from, end ? end.from : text.length).replace(/\s+$/, '');
}

/** The paragraph or list item carrying ^id (without the marker). */
export function blockText(text: string, id: string): string | null {
  const lines = text.split('\n');
  const re = new RegExp(`(?:^|\\s)\\^${id.replace(/[-]/g, '\\-')}\\s*$`);
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return null;
  // A marker on a line of its own belongs to the paragraph above it.
  if (lines[i].trim() === `^${id}`) {
    let s = i - 1;
    while (s > 0 && lines[s - 1].trim() !== '') s--;
    return lines.slice(s, i).join('\n');
  }
  const isItem = /^\s*([-*+]|\d+[.)])\s/.test(lines[i]);
  let s = i;
  if (!isItem) while (s > 0 && lines[s - 1].trim() !== '' && !/^\s*#/.test(lines[s - 1])) s--;
  return lines.slice(s, i + 1).join('\n').replace(re, '');
}

/** Headings compare ignoring case, extra spaces and the characters links cannot carry. */
export function slugHeading(h: string): string {
  return h.replace(/[#|^:%[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** All tags, expanded to parents: "a/b/c" counts for "a", "a/b" and "a/b/c". */
export function expandTag(tag: string): string[] {
  const parts = normTag(tag).split('/').filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
