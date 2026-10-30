// SPDX-License-Identifier: AGPL-3.0-or-later
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
  if (fold(f.root) === l) return true;
  if (l === 'home') return true;
  const parts = fold(f.path).split(sep);
  return parts.slice(0, -1).includes(l);
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

/**
 * Scores the free words. Each word must appear somewhere (name, tags, folder,
 * download source or text inside); typos of one letter are forgiven in words of
 * five letters or more. Returns -1 when a word is missing.
 */
export function scoreTerms(f: FileEntry, q: Query): { score: number; snippet?: string } {
  const all = [...q.phrases, ...q.terms];
  if (all.length === 0) return { score: 1 };
  const name = fold(f.name);
  const nameWords = words(f.name);
  const tags = (f.tags ?? []).map(fold).join(' ');
  const text = f.text ? fold(f.text) : '';
  const folder = fold(f.path.slice(0, f.path.length - f.name.length));
  const source = f.source ? fold(`${f.source.name} ${f.source.host}`) : '';
  // "wifi" should find "Wi-Fi" and "e mail" should find "e-mail": also compare without punctuation.
  const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '');
  const nameSquashed = squash(name);
  const textSquashed = squash(text);
  let score = 0;
  let snippetAt = -1;
  let snippetTerm = '';
  for (const raw of all) {
    const t = fold(raw);
    if (name === t || name.replace(/\.[^.]+$/, '') === t) score += 12;
    else if (nameWords.includes(t)) score += 8;
    else if (name.includes(t)) score += 6;
    else if (tags.includes(t)) score += 5;
    else if (text.includes(t)) {
      score += 3;
      if (snippetAt < 0) {
        snippetAt = text.indexOf(t);
        snippetTerm = t;
      }
    } else if (t.length >= 3 && nameSquashed.includes(squash(t))) score += 5;
    else if (t.length >= 3 && textSquashed.includes(squash(t))) {
      score += 2.5;
      if (snippetAt < 0) {
        // Point the excerpt at the first letters of the word in the original text.
        const at = text.indexOf(t.slice(0, 2));
        if (at >= 0) {
          snippetAt = at;
          snippetTerm = t;
        }
      }
    } else if (source.includes(t)) score += 2;
    else if (folder.includes(t)) score += 1.5;
    else if (t.length >= 5 && !t.includes(' ') && nameWords.some((w) => editDistance(w, t, 1) <= 1)) score += 3;
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
  for (const f of files) {
    if (!passesFilters(f, q, opts)) continue;
    const { score, snippet } = scoreTerms(f, q);
    if (score < 0) continue;
    // Slight boost for recent files, so ties favour what the user touched lately.
    const ageDays = Math.max(0, (now - f.mtime) / 86_400_000);
    hits.push({ file: f, score: score + 1 / (1 + ageDays / 30), snippet });
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
