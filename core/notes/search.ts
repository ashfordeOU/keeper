// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Vault search with the operators people already type: words (all must
// match), "exact phrases", OR, -negation, (groups), /regex/, file:, path:,
// content:, tag:, line:( ), block:( ), section:( ), task:, task-todo:,
// task-done:, match-case:, ignore-case:, and [property] / [property:value].

import { sectionText, slugHeading, expandTag, normTag } from './parse';
import { baseOf, isNote, type IndexedNote, type VaultFile } from './vault';
import type { YamlValue } from './yaml';

export type Query =
  | { t: 'and'; items: Query[] }
  | { t: 'or'; items: Query[] }
  | { t: 'not'; item: Query }
  | { t: 'term'; op: string; value: string; regex?: boolean; exact?: boolean; sub?: Query; prop?: string };

const OPS = ['file', 'path', 'content', 'tag', 'line', 'block', 'section', 'task', 'task-todo', 'task-done', 'match-case', 'ignore-case'];

function tokenize(q: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push(c); i++; continue; }
    let j = i, depth = 0;
    let quote: string | null = null;
    while (j < q.length) {
      const d = q[j];
      if (quote) {
        if (d === '\\' && quote === '/') { j += 2; continue; }
        if (d === quote) quote = null;
        j++;
        continue;
      }
      if (d === '"') { quote = '"'; j++; continue; }
      if (d === '/' && (j === i || q[j - 1] === ':' || (j === i + 1 && q[i] === '-'))) { quote = '/'; j++; continue; }
      if (d === '[') depth++;
      if (d === ']') depth--;
      if (d === '(') {
        // op:( … ) keeps its group in one token
        if (/^-?[\w-]+:$/.test(q.slice(i, j))) {
          let k = j, dd = 0;
          for (; k < q.length; k++) {
            if (q[k] === '(') dd++;
            else if (q[k] === ')' && --dd === 0) break;
          }
          j = k + 1;
          continue;
        }
        if (depth === 0) break;
      }
      if (d === ')' && depth === 0) break;
      if (/\s/.test(d) && depth === 0) break;
      j++;
    }
    out.push(q.slice(i, j));
    i = j;
  }
  return out;
}

function unq(s: string): { value: string; exact: boolean; regex: boolean } {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return { value: s.slice(1, -1), exact: true, regex: false };
  if (s.length >= 2 && s.startsWith('/') && s.endsWith('/')) return { value: s.slice(1, -1), exact: false, regex: true };
  return { value: s, exact: false, regex: false };
}

export function parseQuery(q: string): Query {
  const toks = tokenize(q);
  let i = 0;
  function orExpr(): Query {
    const items = [andExpr()];
    while (toks[i] === 'OR') { i++; items.push(andExpr()); }
    return items.length === 1 ? items[0] : { t: 'or', items };
  }
  function andExpr(): Query {
    const items: Query[] = [];
    while (i < toks.length && toks[i] !== ')' && toks[i] !== 'OR') items.push(unary());
    return items.length === 1 ? items[0] : { t: 'and', items };
  }
  function unary(): Query {
    const tok = toks[i++];
    if (tok === '(') { const e = orExpr(); if (toks[i] === ')') i++; return e; }
    if (tok === '-' && toks[i] === '(') { i++; const e = orExpr(); if (toks[i] === ')') i++; return { t: 'not', item: e }; }
    if (tok.startsWith('-') && tok.length > 1) return { t: 'not', item: term(tok.slice(1)) };
    return term(tok);
  }
  function term(tok: string): Query {
    const prop = /^\[([^\]:]+)(?::(.*))?\]$/.exec(tok);
    if (prop) {
      const v = prop[2] != null ? unq(prop[2].trim()) : { value: '', exact: false, regex: false };
      return { t: 'term', op: 'prop', prop: prop[1].trim(), ...v };
    }
    const m = /^([\w-]+):(.*)$/s.exec(tok);
    if (m && OPS.includes(m[1].toLowerCase())) {
      const op = m[1].toLowerCase();
      let rest = m[2];
      if (rest.startsWith('(') && rest.endsWith(')')) {
        rest = rest.slice(1, -1);
        if (['line', 'block', 'section', 'task', 'task-todo', 'task-done', 'file', 'path', 'content'].includes(op)) return { t: 'term', op, value: rest, sub: parseQuery(rest) };
      }
      return { t: 'term', op, ...unq(rest) };
    }
    return { t: 'term', op: 'word', ...unq(tok) };
  }
  if (!toks.length) return { t: 'and', items: [] };
  return orExpr();
}

export interface SearchHit {
  path: string;
  /** matched lines with where the match is */
  matches: { line: number; text: string; from: number; to: number }[];
  score: number;
}

interface Ctx { caseSensitive: boolean }

function finder(value: string, regex: boolean, ctx: Ctx): (s: string) => RegExpExecArray | null {
  let re: RegExp;
  try {
    re = regex ? new RegExp(value, ctx.caseSensitive ? 'g' : 'gi') : new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ctx.caseSensitive ? 'g' : 'gi');
  } catch {
    re = /(?!)/g;
  }
  return (s: string) => { re.lastIndex = 0; return re.exec(s); };
}

/** Does `text` (a line, block, section or whole note) match the query on its own? */
function matchText(q: Query, text: string, ctx: Ctx): boolean {
  switch (q.t) {
    case 'and': return q.items.every((x) => matchText(x, text, ctx));
    case 'or': return q.items.some((x) => matchText(x, text, ctx));
    case 'not': return !matchText(q.item, text, ctx);
    default:
      if (q.sub) return matchText(q.sub, text, ctx);
      return !!finder(q.value, !!q.regex, ctx)(text);
  }
}

function propValues(v: YamlValue | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(propValues);
  if (typeof v === 'object') return Object.values(v).flatMap(propValues);
  return [String(v)];
}

function blocksOf(text: string): string[] {
  return text.split(/\n\s*\n/);
}

function sectionsOf(text: string): string[] {
  const out: string[] = [];
  const re = /^#{1,6}\s/gm;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); last = m.index; }
  out.push(text.slice(last));
  return out;
}

function evalNote(q: Query, f: VaultFile, n: IndexedNote | undefined, ctx: Ctx, marks: { from: number; to: number }[]): boolean {
  const text = n?.text ?? '';
  const mark = (from: number, to: number) => marks.push({ from, to });
  switch (q.t) {
    case 'and': return q.items.every((x) => evalNote(x, f, n, ctx, marks));
    case 'or': {
      let any = false;
      for (const x of q.items) if (evalNote(x, f, n, ctx, marks)) any = true;
      return any;
    }
    case 'not': return !evalNote(q.item, f, n, ctx, []);
  }
  const find = finder(q.value, !!q.regex, ctx);
  const inText = (from = 0) => {
    const re = q.regex ? new RegExp(q.value, ctx.caseSensitive ? 'g' : 'gi') : new RegExp(q.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ctx.caseSensitive ? 'g' : 'gi');
    let ok = false, m: RegExpExecArray | null;
    re.lastIndex = from;
    while ((m = re.exec(text)) && m[0] !== '') { ok = true; mark(m.index, m.index + m[0].length); if (marks.length > 400) break; }
    return ok;
  };
  const name = baseOf(f.path);
  switch (q.op) {
    case 'word':
      if (!q.value) return true;
      return inText() || !!find(isNote(f.path) ? name.slice(0, -3) : name);
    case 'content': return q.sub ? !!n && matchText(q.sub, text, ctx) : inText();
    case 'file': return q.sub ? matchText(q.sub, name, ctx) : !!find(name);
    case 'path': return q.sub ? matchText(q.sub, f.path, ctx) : !!find(f.path);
    case 'tag': {
      if (!n) return false;
      const want = normTag(q.value);
      return n.note.tags.some((t) => expandTag(t.tag).includes(want));
    }
    case 'line': return !!n && text.split('\n').some((l) => matchText(q.sub ?? q, l, ctx));
    case 'block': return !!n && blocksOf(text).some((b) => matchText(q.sub ?? q, b, ctx));
    case 'section': return !!n && sectionsOf(text).some((s) => matchText(q.sub ?? q, s, ctx));
    case 'task': case 'task-todo': case 'task-done': {
      if (!n) return false;
      const tasks = n.note.tasks.filter((t) => q.op === 'task' || (q.op === 'task-done') === t.done);
      return tasks.some((t) => (q.sub ? matchText(q.sub, t.text, ctx) : q.value === '' || !!find(t.text)));
    }
    case 'match-case': return evalNote({ ...q, op: 'word' }, f, n, { caseSensitive: true }, marks);
    case 'ignore-case': return evalNote({ ...q, op: 'word' }, f, n, { caseSensitive: false }, marks);
    case 'prop': {
      if (!n) return false;
      const key = Object.keys(n.note.props).find((k) => k.toLowerCase() === q.prop!.toLowerCase());
      if (key == null) return false;
      if (!q.value) return true;
      const vals = propValues(n.note.props[key]);
      if (q.value === 'null') return vals.length === 0;
      return vals.some((v) => (q.exact ? (ctx.caseSensitive ? v === q.value : v.toLowerCase() === q.value.toLowerCase()) : !!find(v)));
    }
  }
  return false;
}

/** Searches every file (notes by content, others by name and path). */
export function searchVault(files: VaultFile[], note: (p: string) => IndexedNote | undefined, query: string, opts: { limit?: number; caseSensitive?: boolean } = {}): SearchHit[] {
  const q = parseQuery(query);
  if (q.t === 'and' && q.items.length === 0) return [];
  const ctx = { caseSensitive: !!opts.caseSensitive };
  const hits: SearchHit[] = [];
  for (const f of files) {
    const n = note(f.path);
    const marks: { from: number; to: number }[] = [];
    if (!evalNote(q, f, n, ctx, marks)) continue;
    const text = n?.text ?? '';
    const seen = new Set<number>();
    const matches: SearchHit['matches'] = [];
    for (const m of marks.sort((a, b) => a.from - b.from)) {
      const ls = text.lastIndexOf('\n', m.from - 1) + 1;
      if (seen.has(ls)) continue;
      seen.add(ls);
      const le = text.indexOf('\n', m.from);
      matches.push({ line: text.slice(0, ls).split('\n').length - 1, text: text.slice(ls, le < 0 ? undefined : le), from: m.from - ls, to: m.to - ls });
      if (matches.length >= 20) break;
    }
    const title = baseOf(f.path).toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter((w) => w && !w.includes(':'));
    const score = marks.length + words.filter((w) => title.includes(w)).length * 20 + (isNote(f.path) ? 1 : 0);
    hits.push({ path: f.path, matches, score });
    if (opts.limit && hits.length >= opts.limit * 4) break;
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

/** For the AI: the notes that best answer a question by shared words (a small BM25). */
export function rankNotes(notes: IndexedNote[], question: string, limit = 6): { path: string; score: number; excerpt: string }[] {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((t) => !STOP.has(t));
  if (!terms.length) return [];
  const N = notes.length || 1;
  const df = new Map<string, number>();
  const lower = notes.map((n) => `${baseOf(n.path)}\n${n.text}`.toLowerCase());
  for (const t of terms) df.set(t, lower.filter((l) => l.includes(t)).length);
  const avg = lower.reduce((s, l) => s + l.length, 0) / N || 1;
  const scored = notes.map((n, i) => {
    let s = 0;
    for (const t of terms) {
      const tf = lower[i].split(t).length - 1;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (lower[i].length / avg))));
      if (baseOf(n.path).toLowerCase().includes(t)) s += 2;
    }
    return { n, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
  return scored.map(({ n, s }) => {
    const l = n.text.toLowerCase();
    const at = Math.max(0, Math.min(...terms.map((t) => { const i = l.indexOf(t); return i < 0 ? Infinity : i; })) - 200);
    return { path: n.path, score: s, excerpt: n.text.slice(Number.isFinite(at) ? at : 0, (Number.isFinite(at) ? at : 0) + 1500) };
  });
}

const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'does', 'did', 'with', 'that', 'this', 'from', 'have', 'has', 'about', 'into', 'your', 'you', 'can', 'not', 'but', 'all', 'any', 'notes', 'note', 'vault', 'my']);

export { sectionText, slugHeading };
