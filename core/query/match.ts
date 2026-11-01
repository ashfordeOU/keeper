// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs a parsed Query against indexed files and ranks the results.

import type { FileEntry, Query, SearchHit } from '../types';

/** Lower-case and strip accents, so "résumé" matches "resume". */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Splits "Tax_Return-2025 final.pdf" into words: tax, return, 2025, final, pdf. */
export function words(s: string): string[] {
  return fold(s.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Levenshtein distance capped at `max` (returns max + 1 when larger). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const IPHONE_NAME = /^(img|imgp|img_e)[_-]?\d{3,}/i;
const ANDROID_NAME = /^(pxl|vid|img)[_-]\d{8}[_-]\d{6}|^(signal|whatsapp image|whatsapp video)/i;

export function cameraMatches(f: FileEntry, camera: string): boolean {
  const cam = fold(f.meta?.camera ?? '');
  switch (camera) {
    case 'iphone':
      return /iphone|ipad/.test(cam) || (!cam && IPHONE_NAME.test(f.name) && /^(heic|heif|jpg|jpeg|png|mov|mp4)$/.test(f.ext));
    case 'android':
      return /pixel|samsung|sm-|galaxy|oneplus|xiaomi|redmi|huawei|motorola|android/.test(cam) || (!cam && ANDROID_NAME.test(f.name));
    case 'phone':
      return cameraMatches(f, 'iphone') || cameraMatches(f, 'android');
    case 'gopro':
      return /gopro|hero/.test(cam) || /^(gopr|gx|gh)\d{4,}/i.test(f.name);
    case 'drone':
      return /dji|fc\d{4}|mavic|phantom/.test(cam) || /^dji_\d+/i.test(f.name);
    case 'camera':
      return !!cam && !/iphone|ipad|pixel|samsung|android/.test(cam);
    default:
      return cam.includes(camera);
  }
}

function inLocation(f: FileEntry, loc: string, sep: string): boolean {
  const l = fold(loc);
  if (l === 'home' || f.root.toLowerCase() === l) return true;
  // Any folder on the way to the file, compared without allocating a split list.
  return prep(f).folder.includes(`${sep}${l}${sep}`);
}

export interface MatchOptions {
  now?: number;
  /** paths that are part of a duplicate group, for "duplicates" searches */
  duplicatePaths?: Set<string>;
  sep?: string;
}

function dateOf(f: FileEntry, field: 'modified' | 'created' | 'opened'): number {
  if (field === 'created') return f.btime || f.mtime;
  if (field === 'opened') return f.atime || 0;
  return f.mtime;
}

/** Does every filter pass? Free words are scored separately. */
export function passesFilters(f: FileEntry, q: Query, opts: MatchOptions = {}): boolean {
  const sep = opts.sep ?? (f.path.includes('\\') ? '\\' : '/');
  if (q.screenshot && !f.screenshot) return false;
  const kindOk = q.kinds.length === 0 || q.kinds.includes(f.kind);
  const extOk = q.exts.length === 0 || q.exts.includes(f.ext);
  // "pdfs and images": a kind or an extension may match; with only one of them set, it must.
  if (q.kinds.length && q.exts.length) {
    if (!kindOk && !extOk) return false;
  } else if (!kindOk || !extOk) return false;
  if (q.date) {
    const t = dateOf(f, q.date.field);
    if (!t) return false;
    if (q.date.from !== undefined && t < q.date.from) return false;
    if (q.date.to !== undefined && t >= q.date.to) return false;
  }
  if (q.size) {
    if (q.size.max === 1) {
      if (f.size !== 0) return false;
    } else {
      if (q.size.min !== undefined && f.size < q.size.min) return false;
      if (q.size.max !== undefined && f.size >= q.size.max) return false;
    }
  }
  if (q.sources.length) {
    if (!f.source) return false;
    const ok = q.sources.some((s) => f.source!.id === s || (s.startsWith('web:') && f.source!.host.endsWith(s.slice(4))));
    if (!ok) return false;
  }
  if (q.cameras.length && !q.cameras.some((c) => cameraMatches(f, c))) return false;
  if (q.locations.length && !q.locations.some((l) => inLocation(f, l, sep))) return false;
  if (q.tags.length) {
    const tags = (f.tags ?? []).map(fold);
    if (!q.tags.every((t) => tags.includes(fold(t)))) return false;
  }
  if (q.duplicatesOnly && !opts.duplicatePaths?.has(f.path)) return false;
  if (q.exclude.length) {
    const hay = fold(`${f.name} ${(f.tags ?? []).join(' ')} ${f.text ?? ''}`);
    if (q.exclude.some((x) => hay.includes(fold(x)))) return false;
  }
  return true;
}

/** Folded forms of a file's searchable fields, computed once and reused until the file changes. */
interface Prep {
  mtime: number;
  textLen: number;
  tags: string[] | undefined;
  sourceId: string | undefined;
  path: string;
  name: string;
  base: string;
  nameWords: string[];
  nameSquashed: string;
  tagText: string;
  text: string;
  textSquashed: string;
  folder: string;
  source: string;
  /** everything above joined, for a single quick "is the word anywhere?" test */
  all: string;
  allSquashed: string;
}

const prepCache = new WeakMap<FileEntry, Prep>();
const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '');

function prep(f: FileEntry): Prep {
  const hit = prepCache.get(f);
  // Cheap checks: the entry is replaced or these fields change when the file does.
  if (hit && hit.mtime === f.mtime && hit.textLen === (f.text?.length ?? 0) && hit.tags === f.tags && hit.sourceId === f.source?.id && hit.path === f.path) return hit;
  const name = fold(f.name);
  const tags = (f.tags ?? []).map(fold).join(' ');
  const text = f.text ? fold(f.text) : '';
  const folder = fold(f.path.slice(0, f.path.length - f.name.length));
  const source = f.source ? fold(`${f.source.name} ${f.source.host}`) : '';
  const nameSquashed = squash(name);
  const textSquashed = squash(text);
  const p: Prep = {
    mtime: f.mtime, textLen: f.text?.length ?? 0, tags: f.tags, sourceId: f.source?.id, path: f.path, name, base: name.replace(/\.[^.]+$/, ''), nameWords: words(f.name), nameSquashed, tagText: tags, text, textSquashed, folder, source,
    all: `${name}\n${tags}\n${text}\n${source}\n${folder}`,
    allSquashed: `${nameSquashed}\n${textSquashed}`,
  };
  prepCache.set(f, p);
  return p;
}

/**
 * Scores the free words. Each word must appear somewhere (name, tags, folder,
 * download source or text inside). With `fuzzy`, one-letter typos are forgiven
 * in words of five letters or more. Returns -1 when a word is missing.
 */
export interface CompiledTerm {
  t: string;
  ts: string;
}

/** Folds the search words once per search instead of once per file. */
export function compileTerms(q: Query): CompiledTerm[] {
  return [...q.phrases, ...q.terms].map((raw) => {
    const t = fold(raw);
    return { t, ts: t.length >= 3 ? squash(t) : '' };
  });
}

const nearDefault = (w: string, t: string) => Math.abs(w.length - t.length) <= 1 && editDistance(w, t, 1) <= 1;

export function scoreTerms(f: FileEntry, q: Query, fuzzy: boolean | ((word: string, term: string) => boolean) = true, compiled?: CompiledTerm[]): { score: number; snippet?: string } {
  const near = typeof fuzzy === 'function' ? fuzzy : nearDefault;
  const all = compiled ?? compileTerms(q);
  if (all.length === 0) return { score: 1 };
  const p = prep(f);
  let score = 0;
  let snippetAt = -1;
  let snippetTerm = '';
  for (const { t, ts } of all) {
    // Quick rejection: most files do not contain the word at all.
    if (!p.all.includes(t) && !(ts && p.allSquashed.includes(ts))) {
      if (fuzzy && t.length >= 5 && !t.includes(' ') && p.nameWords.some((w) => near(w, t))) {
        score += 3;
        continue;
      }
      return { score: -1 };
    }
    if (p.name === t || p.base === t) score += 12;
    else if (p.nameWords.includes(t)) score += 8;
    else if (p.name.includes(t)) score += 6;
    else if (p.tagText.includes(t)) score += 5;
    else if (p.text.includes(t)) {
      score += 3;
      if (snippetAt < 0) {
        snippetAt = p.text.indexOf(t);
        snippetTerm = t;
      }
    } else if (ts && p.nameSquashed.includes(ts)) score += 5;
    else if (ts && p.textSquashed.includes(ts)) {
      score += 2.5;
      if (snippetAt < 0) {
        // Point the excerpt at the first letters of the word in the original text.
        const at = p.text.indexOf(t.slice(0, 2));
        if (at >= 0) {
          snippetAt = at;
          snippetTerm = t;
        }
      }
    } else if (p.source.includes(t)) score += 2;
    else if (p.folder.includes(t)) score += 1.5;
    else return { score: -1 };
  }
  let snippet: string | undefined;
  if (snippetAt >= 0 && f.text) {
    const start = Math.max(0, snippetAt - 40);
    const end = Math.min(f.text.length, snippetAt + snippetTerm.length + 60);
    snippet = (start > 0 ? '…' : '') + f.text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < f.text.length ? '…' : '');
  }
  return { score, snippet };
}

export function search(files: Iterable<FileEntry>, q: Query, opts: MatchOptions = {}): SearchHit[] {
  const now = opts.now ?? Date.now();
  const hits: SearchHit[] = [];
  const candidates: FileEntry[] = [];
  const hasTerms = q.terms.length + q.phrases.length > 0;
  const compiled = compileTerms(q);
  const add = (f: FileEntry, score: number, snippet?: string) => {
    // Slight boost for recent files, so ties favour what the user touched lately.
    const ageDays = Math.max(0, (now - f.mtime) / 86_400_000);
    hits.push({ file: f, score: score + 1 / (1 + ageDays / 30), snippet });
  };
  // Exact words first: fast, and what people mean almost every time.
  for (const f of files) {
    if (!passesFilters(f, q, opts)) continue;
    if (hasTerms) candidates.push(f);
    const { score, snippet } = scoreTerms(f, q, false, compiled);
    if (score >= 0) add(f, score, snippet);
  }
  // Only when that finds next to nothing, forgive one-letter typos.
  if (hasTerms && hits.length < 5 && [...q.terms, ...q.phrases].some((t) => t.length >= 5)) {
    const seen = new Set(hits.map((h) => h.file));
    // The same words repeat across thousands of names: compare each one once.
    const memo = new Map<string, Map<string, boolean>>();
    const near = (w: string, t: string) => {
      let m = memo.get(t);
      if (!m) memo.set(t, (m = new Map()));
      let v = m.get(w);
      if (v === undefined) m.set(w, (v = nearDefault(w, t)));
      return v;
    };
    for (const f of candidates) {
      if (seen.has(f)) continue;
      const { score, snippet } = scoreTerms(f, q, near, compiled);
      if (score >= 0) add(f, score, snippet);
    }
  }
  const sort = q.sort ?? (q.terms.length || q.phrases.length ? { key: 'relevance', desc: true } : { key: 'date', desc: true });
  const dir = sort.desc ? -1 : 1;
  hits.sort((a, b) => {
    switch (sort.key) {
      case 'size': return dir * (a.file.size - b.file.size);
      case 'date': return dir * (a.file.mtime - b.file.mtime);
      case 'name': return dir * a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'kind': return dir * a.file.kind.localeCompare(b.file.kind) || a.file.name.localeCompare(b.file.name);
      default: return b.score - a.score || b.file.mtime - a.file.mtime;
    }
  });
  return q.limit ? hits.slice(0, q.limit) : hits;
}
