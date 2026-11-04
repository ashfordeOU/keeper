// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Search by meaning over more than files: mail (subject and text), calendar
// events, tasks, contacts and notes kept outside the library. Each item is one
// short document with a word index (BM25) and, when meaning search is on, one
// meaning vector built in the same background batches as the files'. Results
// are ranked together with the file results (reciprocal-rank fusion), so one
// search box finds every kind, and each hit carries what is needed to cite it.

import type { BrainHit } from '../brain-contract';
import { Bm25 } from './bm25';
import { terms } from './chunk';
import { makeSnippet } from './engine';
import { normalize, VectorStore } from './vectors';

export type ItemDocKind = 'mail' | 'event' | 'task' | 'contact' | 'note' | 'meeting' | 'bookmark';

export interface ItemDoc {
  /** stable id: mail:<message id>, event:<id>, task:<id>, contact:<id>, note:<path>… */
  id: string;
  kind: ItemDocKind;
  title: string;
  text: string;
  /** when it happened or changed */
  time?: number;
  /** a second line: the sender, the place, the project */
  sub?: string;
  /** how to cite and open it: keeper://mail/<id>, keeper://event/<id>, a path… */
  cite: string;
}

export interface ItemHit {
  id: string;
  kind: ItemDocKind;
  title: string;
  sub?: string;
  time?: number;
  cite: string;
  score: number;
  snippet?: string;
  highlights?: [number, number][];
  why: ('words' | 'meaning')[];
}

/** Text the model reads for one item: the title, then the start of the text. */
export const embedText = (d: Pick<ItemDoc, 'title' | 'text' | 'sub'>) => `${d.title}${d.sub ? `\n${d.sub}` : ''}\n${d.text}`.slice(0, 1500);

/** A short fingerprint of an item's words, so unchanged items keep their vector. */
export function sigOf(d: Pick<ItemDoc, 'title' | 'text' | 'sub'>): string {
  const s = embedText(d);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

interface Entry { num: number; doc: ItemDoc; sig: string; bm: number }

export class ItemIndex {
  private entries = new Map<string, Entry>();
  private byNum = new Map<number, string>();
  private bm = new Bm25();
  private pending = new Set<number>();
  /** vectors kept from last time: id → [number, signature] */
  private saved = new Map<string, [number, string]>();
  private next = 0;
  vectors: VectorStore | null = null;

  get size() { return this.entries.size; }
  get pendingCount() { return this.vectors ? this.pending.size : 0; }
  get embedded() { return this.vectors?.size ?? 0; }

  /** Meaning vectors on (a store, possibly loaded from disk with `restore`) or off. */
  useVectors(store: VectorStore | null) {
    this.vectors = store;
    this.pending.clear();
    if (store) for (const e of this.entries.values()) if (!store.has(e.num)) this.pending.add(e.num);
  }

  /** The numbers and signatures saved with a vector file, so unchanged items are not embedded again. */
  restore(keys: Record<string, [number, string]>) {
    this.saved = new Map(Object.entries(keys).filter(([, v]) => Array.isArray(v) && Number.isInteger(v[0]) && typeof v[1] === 'string'));
    for (const [n] of this.saved.values()) this.next = Math.max(this.next, n + 1);
  }

  keys(): Record<string, [number, string]> {
    const out: Record<string, [number, string]> = {};
    for (const [id, e] of this.entries) out[id] = [e.num, e.sig];
    return out;
  }

  /** Makes the index hold exactly these items; only new or changed ones are indexed (and embedded) again. */
  setAll(docs: ItemDoc[]): { added: number; changed: number; removed: number } {
    const seen = new Set<string>();
    let added = 0, changed = 0, removed = 0;
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const sig = sigOf(d);
      const cur = this.entries.get(d.id);
      if (cur && cur.sig === sig) { cur.doc = d; continue; }
      if (cur) { this.drop(d.id); changed++; } else added++;
      let num: number;
      const kept = this.saved.get(d.id);
      if (kept && kept[1] === sig && !this.byNum.has(kept[0])) num = kept[0];
      else {
        if (kept) this.vectors?.delete(kept[0]);
        num = this.next++;
      }
      this.saved.delete(d.id);
      const bm = this.bm.add([...terms(d.title), ...terms(d.title), ...terms(d.sub ?? ''), ...terms(d.text.slice(0, 20_000))]);
      this.entries.set(d.id, { num, doc: d, sig, bm });
      this.byNum.set(num, d.id);
      if (this.vectors && !this.vectors.has(num)) this.pending.add(num);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) { this.drop(id); removed++; }
    // Vectors of items that are gone (left out, deleted) go too.
    for (const [, [n]] of this.saved) this.vectors?.delete(n);
    this.saved.clear();
    return { added, changed, removed };
  }

  private drop(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.bm.remove(e.bm);
    this.vectors?.delete(e.num);
    this.pending.delete(e.num);
    this.byNum.delete(e.num);
    this.entries.delete(id);
  }

  /** The next items to embed, newest first. */
  nextToEmbed(n: number): { num: number; text: string }[] {
    if (!this.vectors || !this.pending.size) return [];
    const list = [...this.pending].map((num) => this.entries.get(this.byNum.get(num) ?? '')).filter((e): e is Entry => !!e);
    list.sort((a, b) => (b.doc.time ?? 0) - (a.doc.time ?? 0));
    return list.slice(0, n).map((e) => ({ num: e.num, text: embedText(e.doc) }));
  }

  setVector(num: number, v: Float32Array) {
    if (!this.vectors || !this.byNum.has(num)) return;
    this.vectors.set(num, normalize(v));
    this.pending.delete(num);
  }

  /** Items closest in meaning to one item, for the graph's "similar meaning" links. */
  similar(id: string, k = 5): { id: string; score: number }[] {
    const e = this.entries.get(id);
    const v = e && this.vectors?.get(e.num);
    if (!v) return [];
    return this.vectors!.search(v, k + 1, (key) => key !== e!.num).map((h) => ({ id: this.byNum.get(h.key)!, score: h.score })).filter((x) => x.id);
  }

  /** The vector of an item, to compare with files. */
  vectorOf(id: string): Float32Array | undefined {
    const e = this.entries.get(id);
    return e ? this.vectors?.get(e.num) : undefined;
  }

  get(id: string): ItemDoc | undefined {
    return this.entries.get(id)?.doc;
  }

  /** Words and (with a query vector) meaning, fused. */
  search(query: string, o: { qvec?: Float32Array; kinds?: ItemDocKind[]; limit?: number } = {}): ItemHit[] {
    const limit = o.limit ?? 20;
    const words = terms(query);
    const ok = (id: string | undefined) => !!id && (!o.kinds?.length || o.kinds.includes(this.entries.get(id)!.doc.kind));
    const bmToId = new Map<number, string>();
    for (const [id, e] of this.entries) bmToId.set(e.bm, id);
    const byWords = this.bm.search(words, limit * 3, (d) => ok(bmToId.get(d))).map((h) => bmToId.get(h.doc)!);
    const byMeaning = o.qvec && this.vectors?.size ? this.vectors.search(normalize(o.qvec), limit * 3, (k) => ok(this.byNum.get(k))).filter((h) => h.score >= 0.78).map((h) => this.byNum.get(h.key)!) : [];
    const fused = fuse([byWords, byMeaning]);
    const folded = words.map((w) => w.toLowerCase());
    return fused.slice(0, limit).map(({ key, score }) => {
      const d = this.entries.get(key)!.doc;
      const sn = d.text ? makeSnippet(`${d.text}`, folded) : undefined;
      return { id: d.id, kind: d.kind, title: d.title, sub: d.sub, time: d.time, cite: d.cite, score, snippet: sn?.snippet, highlights: sn?.highlights, why: [...(byWords.includes(key) ? ['words' as const] : []), ...(byMeaning.includes(key) ? ['meaning' as const] : [])] };
    });
  }
}

/** Reciprocal-rank fusion of ranked lists of keys; scores 0–1. */
export function fuse(lists: string[][], k = 60): { key: string; score: number }[] {
  const s = new Map<string, number>();
  for (const l of lists) l.forEach((key, i) => s.set(key, (s.get(key) ?? 0) + 1 / (k + i + 1)));
  const best = lists.filter((l) => l.length).length / (k + 1) || 1;
  return [...s.entries()].map(([key, v]) => ({ key, score: Math.min(1, v / best) })).sort((a, b) => b.score - a.score);
}

/** One result of the search over everything. */
export interface EverythingHit {
  kind: ItemDocKind | 'file';
  title: string;
  sub?: string;
  time?: number;
  /** what to cite in an answer: a file's path, or a keeper:// link */
  cite: string;
  snippet?: string;
  highlights?: [number, number][];
  score: number;
  why: ('words' | 'meaning' | 'name')[];
}

/** Files and every other kind, ranked together: each list keeps its own order and they are interleaved by rank. */
export function rankTogether(files: BrainHit[], items: ItemHit[], limit = 20): EverythingHit[] {
  const key = (h: { cite: string }) => h.cite;
  const fh: EverythingHit[] = files.map((h) => ({ kind: 'file', title: h.name, sub: h.heading, time: h.mtime, cite: h.path, snippet: h.snippet, highlights: h.highlights, score: h.score, why: h.why ?? ['words'] }));
  const ih: EverythingHit[] = items.map((h) => ({ kind: h.kind, title: h.title, sub: h.sub, time: h.time, cite: h.cite, snippet: h.snippet, highlights: h.highlights, score: h.score, why: h.why }));
  // A note can come from both lists (a note in the library): keep it once.
  const all = new Map<string, EverythingHit>();
  for (const h of [...fh, ...ih]) if (!all.has(key(h))) all.set(key(h), h);
  return fuse([fh.map(key), ih.map(key)]).slice(0, limit).map((x) => ({ ...all.get(x.key)!, score: x.score }));
}

/** A hit as the Assistant cites it (sources shown under the answer). */
export function asSource(h: EverythingHit): BrainHit {
  return { path: h.cite, name: h.title, kind: h.kind === 'file' ? 'document' : 'other', ...(h.kind === 'file' ? {} : { item: h.kind }), size: 0, mtime: h.time ?? 0, score: h.score, snippet: h.snippet, highlights: h.highlights, heading: h.sub, why: h.why };
}
