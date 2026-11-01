// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's brain: every indexed file split into passages, with a word index
// (BM25) and, when turned on, meaning vectors from a model on this computer.
// Search mixes three signals — words inside the file, meaning, and the name
// and details Keeper already knows — with reciprocal-rank fusion, and applies
// the same filters as the search bar ("pdfs from gmail last month").
//
// Pure: the caller passes a way to read a file's text and (optionally) an
// embedder, so the same engine runs in the app, the CLI and the tests.

import path from 'node:path';
import type { BrainHit, BrainSearchOptions, BrainStatus } from '../brain-contract';
import { fold, passesFilters, search as metaSearch } from '../query/match';
import { parseQuery } from '../query/parse';
import type { FileEntry, Query } from '../types';
import { Bm25, type Bm25Data } from './bm25';
import { chunkText, isCode, terms, type Chunk } from './chunk';
import { normalize, VectorStore } from './vectors';

export interface Embedder {
  readonly id: string;
  readonly dims: number;
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>;
}

export interface BrainFile {
  path: string;
  mtime: number;
  size: number;
  /** name, tags and source as they were indexed, to notice renames and new tags */
  sig: string;
  /** doc numbers: [meta, ...one per chunk] */
  docs: number[];
  chunks: Chunk[];
}

interface Persisted {
  v: 1;
  model?: string;
  files: [path: string, mtime: number, size: number, sig: string, docs: number[], chunks: number[], headings: string[]][];
  bm25: Bm25Data;
}

export interface EngineOptions {
  /** the text of a file (indexed OCR/PDF text, or read from disk); undefined when there is none */
  getText: (f: FileEntry) => Promise<string | undefined>;
  /** never index or return anything under these */
  isExcluded?: (p: string) => boolean;
}

const RRF_K = 60;
const NAME_BOOST = 1.6;

function sigOf(f: FileEntry): string {
  return `${f.name}|${(f.tags ?? []).join(',')}|${f.source?.id ?? ''}|${f.text?.length ?? 0}`;
}

/** Words that describe a file without opening it: name, folders, tags, source, kind. */
function metaWords(f: FileEntry): string[] {
  const folders = path.dirname(f.path).split(/[\\/]/).slice(-3).join(' ');
  return terms(`${f.name.replace(/\.[^.]+$/, '')} ${f.ext} ${folders} ${(f.tags ?? []).join(' ')} ${f.source ? `${f.source.name} ${f.source.host}` : ''} ${f.kind}${f.screenshot ? ' screenshot' : ''}`);
}

/** At most about 8 MB of recently read text (two bytes a character at worst). */
const TEXT_CACHE_CHARS = 4_000_000;

export class BrainEngine {
  files = new Map<string, BrainFile>();
  /** doc number -> [path, chunk index (-1 = name and details)] */
  private docs: ([string, number] | undefined)[] = [];
  bm25 = new Bm25();
  vectors: VectorStore | null = null;
  embedder: Embedder | null = null;
  private pending: number[] = [];
  private pendingSet = new Set<number>();
  private textCache = new Map<string, { mtime: number; text: string }>();
  updatedAt = 0;

  constructor(private opts: EngineOptions) {}

  // ------------------------------------------------------------ keeping up to date

  needsUpdate(f: FileEntry): boolean {
    const b = this.files.get(f.path);
    return !b || b.mtime !== f.mtime || b.size !== f.size || b.sig !== sigOf(f);
  }

  remove(p: string): void {
    const b = this.files.get(p);
    if (!b) return;
    for (const d of b.docs) {
      this.bm25.remove(d);
      this.vectors?.delete(d);
      this.docs[d] = undefined;
      this.pendingSet.delete(d);
    }
    this.files.delete(p);
    const cached = this.textCache.get(p);
    if (cached) { this.textCacheChars -= cached.text.length; this.textCache.delete(p); }
  }

  /** (Re)reads one file into the brain. */
  async update(f: FileEntry): Promise<void> {
    this.remove(f.path);
    if (this.opts.isExcluded?.(f.path)) return;
    const text = f.cloudOnly ? undefined : await this.opts.getText(f).catch(() => undefined);
    const chunks = text ? chunkText(text, { code: isCode(f.ext) }) : [];
    const b: BrainFile = { path: f.path, mtime: f.mtime, size: f.size, sig: sigOf(f), docs: [], chunks };
    const meta = this.bm25.add(metaWords(f), NAME_BOOST);
    b.docs.push(meta);
    this.docs[meta] = [f.path, -1];
    chunks.forEach((c, i) => {
      const words = terms(`${c.heading ?? ''} ${text!.slice(c.start, c.end)}`);
      const d = this.bm25.add(words);
      b.docs.push(d);
      this.docs[d] = [f.path, i];
      this.queue(d);
    });
    if (text) this.remember(f.path, f.mtime, text);
    this.files.set(f.path, b);
    this.updatedAt = Date.now();
  }

  /**
   * Brings the brain in line with the library: new and changed files are read,
   * removed ones dropped. Newest files first, so recent work is searchable soonest.
   */
  async sync(all: Iterable<FileEntry>, o: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; pause?: () => Promise<void> } = {}): Promise<number> {
    const seen = new Set<string>();
    const todo: FileEntry[] = [];
    for (const f of all) {
      if (this.opts.isExcluded?.(f.path)) continue;
      seen.add(f.path);
      if (this.needsUpdate(f)) todo.push(f);
    }
    for (const p of [...this.files.keys()]) if (!seen.has(p)) this.remove(p);
    todo.sort((a, b) => b.mtime - a.mtime);
    let done = 0;
    for (const f of todo) {
      if (o.signal?.aborted) break;
      await this.update(f);
      if (++done % 50 === 0) {
        o.onProgress?.(done, todo.length);
        await (o.pause?.() ?? new Promise((r) => setImmediate(r)));
      }
    }
    o.onProgress?.(done, todo.length);
    this.textCache.clear();
    this.textCacheChars = 0;
    return done;
  }

  // ------------------------------------------------------------ meaning vectors

  private queue(d: number) {
    if (this.vectors?.has(d) || this.pendingSet.has(d)) return;
    this.pendingSet.add(d);
    this.pending.push(d);
  }

  /** Switches meaning search on with this model; vectors from another model are dropped. */
  useEmbedder(e: Embedder | null, keep?: VectorStore | null): void {
    this.embedder = e;
    if (!e) return;
    this.vectors = keep && keep.dims === e.dims ? keep : new VectorStore(e.dims);
    this.pending = [];
    this.pendingSet.clear();
    // Newest files first.
    const order = [...this.files.values()].sort((a, b) => b.mtime - a.mtime);
    for (const b of order) for (const d of b.docs.slice(1)) this.queue(d);
  }

  get pendingCount(): number {
    return this.pendingSet.size;
  }

  /** The next passages waiting for a vector, with the text to embed. */
  async nextToEmbed(n: number, lookup: (p: string) => FileEntry | undefined): Promise<{ doc: number; text: string }[]> {
    const out: { doc: number; text: string }[] = [];
    while (out.length < n && this.pending.length) {
      const d = this.pending.shift()!;
      if (!this.pendingSet.has(d)) continue;
      const ref = this.docs[d];
      const f = ref && lookup(ref[0]);
      const b = ref && this.files.get(ref[0]);
      if (!ref || !f || !b) { this.pendingSet.delete(d); continue; }
      const text = await this.textOf(f);
      const c = b.chunks[ref[1]];
      if (!text || !c) { this.pendingSet.delete(d); continue; }
      out.push({ doc: d, text: `${c.heading ? c.heading + '\n' : ''}${text.slice(c.start, c.end)}` });
    }
    return out;
  }

  /** Files closest in meaning to one file (by its first passages), for the knowledge graph. */
  similarFiles(p: string, k = 5): { path: string; score: number }[] {
    const b = this.files.get(p);
    if (!this.vectors || !b) return [];
    const mine = new Set(b.docs);
    const v = b.docs.slice(1, 3).map((d) => this.vectors!.get(d)).find(Boolean) ?? this.vectors.get(b.docs[0]);
    if (!v) return [];
    const best = new Map<string, number>();
    for (const h of this.vectors.search(v, k * 6, (key) => !mine.has(key))) {
      const fp = this.docs[h.key]?.[0];
      if (fp && fp !== p && (best.get(fp) ?? -1) < h.score) best.set(fp, h.score);
    }
    return [...best.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, k).map(([path, score]) => ({ path, score }));
  }

  setVector(doc: number, v: Float32Array): void {
    if (!this.vectors || !this.docs[doc]) return;
    this.vectors.set(doc, normalize(v));
    this.pendingSet.delete(doc);
  }

  /** Embeds a batch of waiting passages; returns how many were done. */
  async embedSome(n: number, lookup: (p: string) => FileEntry | undefined): Promise<number> {
    if (!this.embedder) return 0;
    const batch = await this.nextToEmbed(n, lookup);
    if (!batch.length) return 0;
    const vecs = await this.embedder.embed(batch.map((b) => b.text), 'passage');
    batch.forEach((b, i) => this.setVector(b.doc, vecs[i]));
    return batch.length;
  }

  // ------------------------------------------------------------ text

  // Recently read texts, so answering a question does not read the same files twice.
  // Bounded by count and by size: a few long documents must not stay in memory.
  private textCacheChars = 0;
  private remember(p: string, mtime: number, text: string) {
    if (text.length > TEXT_CACHE_CHARS / 4) return;
    const old = this.textCache.get(p);
    if (old) { this.textCacheChars -= old.text.length; this.textCache.delete(p); }
    this.textCache.set(p, { mtime, text });
    this.textCacheChars += text.length;
    while (this.textCache.size > 64 || this.textCacheChars > TEXT_CACHE_CHARS) {
      const [k, v] = this.textCache.entries().next().value!;
      this.textCache.delete(k);
      this.textCacheChars -= v.text.length;
    }
  }

  async textOf(f: FileEntry): Promise<string | undefined> {
    const c = this.textCache.get(f.path);
    if (c && c.mtime === f.mtime) return c.text;
    const t = await this.opts.getText(f).catch(() => undefined);
    if (t) this.remember(f.path, f.mtime, t);
    return t;
  }

  // ------------------------------------------------------------ search

  status(lib: Map<string, FileEntry>, semantic: BrainStatus['semantic'], model?: string): BrainStatus {
    let withText = 0;
    let passages = 0;
    for (const b of this.files.values()) if (b.chunks.length) { withText++; passages += b.chunks.length; }
    return {
      files: lib.size,
      withText,
      embedded: this.vectors?.size ?? 0,
      pending: this.embedder ? this.pendingCount : 0,
      semantic,
      semanticModel: model,
      updatedAt: this.updatedAt || undefined,
      passages,
      indexed: this.files.size,
    };
  }

  async search(o: BrainSearchOptions, lib: Map<string, FileEntry>, now = Date.now()): Promise<BrainHit[]> {
    const limit = Math.max(1, Math.min(o.limit ?? 20, 200));
    const parsed = parseQuery(o.query, now).query;
    const q: Query = { ...parsed, kinds: o.kinds?.length ? (o.kinds as Query['kinds']) : parsed.kinds };
    const filters: Query = { ...q, terms: [], phrases: [] };
    const within = (o.within ?? []).map((w) => path.resolve(w));
    const accept = (f: FileEntry | undefined): f is FileEntry => {
      if (!f) return false;
      if (this.opts.isExcluded?.(f.path)) return false;
      if (o.modifiedAfter !== undefined && f.mtime < o.modifiedAfter) return false;
      if (o.modifiedBefore !== undefined && f.mtime >= o.modifiedBefore) return false;
      if (within.length && !within.some((w) => f.path === w || f.path.startsWith(w + path.sep) || f.path.startsWith(w + '/'))) return false;
      return passesFilters(f, filters, { now });
    };
    const words = terms([...q.terms, ...q.phrases].join(' '));
    const mode = o.mode ?? 'hybrid';
    const fileOf = (d: number) => this.docs[d]?.[0];
    const acceptDoc = (d: number) => accept(lib.get(fileOf(d) ?? ''));

    // Each list: files in rank order, with the passage that put them there.
    type Ranked = Map<string, { rank: number; chunk: number }>;
    const lists: { name: 'words' | 'meaning' | 'name'; weight: number; items: Ranked }[] = [];
    const toRanked = (hits: { doc: number }[]): Ranked => {
      const m: Ranked = new Map();
      for (const h of hits) {
        const ref = this.docs[h.doc];
        if (!ref || m.has(ref[0])) continue;
        m.set(ref[0], { rank: m.size, chunk: ref[1] });
      }
      return m;
    };

    if (words.length && mode !== 'meaning') lists.push({ name: 'words', weight: 1, items: toRanked(this.bm25.search(words, 400, acceptDoc)) });
    const semanticReady = !!(this.embedder && this.vectors?.size);
    if (words.length && semanticReady && mode !== 'words') {
      const [qv] = await this.embedder!.embed([o.query], 'query');
      const hits = this.vectors!.search(normalize(qv), 400, acceptDoc);
      // This model's scores sit in a narrow band (unrelated text still scores about 0.75):
      // keep only the clear leaders, close to the best match.
      const top = hits[0]?.score ?? 0;
      lists.push({ name: 'meaning', weight: 1, items: toRanked(hits.filter((h) => h.score >= Math.max(0.8, top - 0.04)).map((h) => ({ doc: h.key }))) });
    } else if (mode === 'meaning' && words.length) {
      lists.push({ name: 'words', weight: 1, items: toRanked(this.bm25.search(words, 400, acceptDoc)) });
    }
    if (mode !== 'meaning' || !words.length) {
      // The search bar's own ranking: every word must match the name, tags, folder or text.
      const meta = metaSearch([...lib.values()].filter((f) => !this.opts.isExcluded?.(f.path) && (!within.length || accept(f))), q, { now }).slice(0, 400);
      const m: Ranked = new Map();
      for (const h of meta) if (accept(h.file) && !m.has(h.file.path)) m.set(h.file.path, { rank: m.size, chunk: -1 });
      lists.push({ name: 'name', weight: words.length ? 1.2 : 1, items: m });
    }

    const fused = new Map<string, { score: number; chunk: number; why: ('words' | 'meaning' | 'name')[] }>();
    for (const l of lists) {
      for (const [p, it] of l.items) {
        const cur = fused.get(p) ?? { score: 0, chunk: -1, why: [] };
        cur.score += l.weight / (RRF_K + it.rank + 1);
        if (cur.chunk < 0 && it.chunk >= 0) cur.chunk = it.chunk;
        cur.why.push(l.name);
        fused.set(p, cur);
      }
    }
    const best = lists.reduce((n, l) => n + l.weight / (RRF_K + 1), 0) || 1;
    const ranked = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
    const hits: BrainHit[] = [];
    for (const [p, r] of ranked) {
      const f = lib.get(p)!;
      const hit: BrainHit = {
        path: f.path, name: f.name, kind: f.kind, size: f.size, mtime: f.mtime,
        score: Math.round((r.score / best) * 1000) / 1000,
        source: f.source?.name, tags: f.tags?.length ? f.tags : undefined, why: r.why,
      };
      const b = this.files.get(p);
      const c = r.chunk >= 0 ? b?.chunks[r.chunk] : undefined;
      if (c) {
        const text = await this.textOf(f);
        if (text) Object.assign(hit, makeSnippet(text.slice(c.start, c.end), words), c.heading ? { heading: c.heading } : {});
      } else if (f.text && words.length) {
        Object.assign(hit, makeSnippet(f.text, words));
      }
      hits.push(hit);
    }
    return hits;
  }

  // ------------------------------------------------------------ saving

  toJSON(): Persisted {
    return {
      v: 1,
      model: this.embedder?.id,
      files: [...this.files.values()].map((b) => [b.path, b.mtime, b.size, b.sig, b.docs, b.chunks.flatMap((c) => [c.start, c.end]), b.chunks.map((c) => c.heading ?? '')]),
      bm25: this.bm25.toJSON(),
    };
  }

  load(data: Persisted): void {
    if (data.v !== 1) return;
    this.bm25 = Bm25.fromJSON(data.bm25);
    this.files.clear();
    this.docs = [];
    for (const [p, mtime, size, sig, docs, flat, headings] of data.files) {
      const chunks: Chunk[] = [];
      for (let i = 0; i < flat.length; i += 2) chunks.push({ start: flat[i], end: flat[i + 1], heading: headings[i / 2] || undefined });
      this.files.set(p, { path: p, mtime, size, sig, docs, chunks });
      docs.forEach((d, i) => (this.docs[d] = [p, i - 1]));
    }
    this.updatedAt = Date.now();
  }
}

/** About 280 characters around the first query word, with where each word is. */
export function makeSnippet(text: string, words: string[]): { snippet: string; highlights: [number, number][] } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const folded = fold(clean);
  // fold() keeps length for nearly all text; when it does not, highlight nothing rather than the wrong letters.
  const sameLength = folded.length === clean.length;
  const roots = [...new Set(words.filter((w) => w.length >= 2))];
  let first = -1;
  for (const w of roots) {
    const i = folded.indexOf(w);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = first > 100 ? clean.lastIndexOf(' ', first - 80) + 1 : 0;
  const end = Math.min(clean.length, start + 280);
  const prefix = start > 0 ? '…' : '';
  const snippet = prefix + clean.slice(start, end) + (end < clean.length ? '…' : '');
  const highlights: [number, number][] = [];
  if (sameLength) {
    const win = folded.slice(start, end);
    for (const w of roots) {
      let i = win.indexOf(w);
      while (i >= 0) {
        // Extend to the end of the word, so "invoice" lights up "invoices".
        let e = i + w.length;
        while (e < win.length && /[\p{L}\p{N}]/u.test(win[e])) e++;
        highlights.push([i + prefix.length, e + prefix.length]);
        i = win.indexOf(w, e);
      }
    }
    highlights.sort((a, b) => a[0] - b[0]);
  }
  return { snippet, highlights: mergeRanges(highlights) };
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}
