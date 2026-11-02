// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The word index: classic BM25 ranking over passages. Documents are numbered;
// removing one only marks it, and the postings are compacted once a good share
// of them are gone, so keeping the index up to date stays cheap.
//
// The postings are most of the brain's memory (tens of millions for a big
// library), so each is one number in one array per word: the passage number
// times 256 plus how often the word occurs there (counted up to 255; BM25 has
// long stopped rising by then). Arrays grown by adding passages keep up to half
// again as much room as they use; trim() and compacting give it back.

import type { JsonChunks } from '../json-chunks';

export interface Bm25Hit {
  doc: number;
  score: number;
}

/** doc * TF_SPAN + tf, one per passage the word is in */
type Posting = number[];
const TF_SPAN = 256;
const TF_MAX = TF_SPAN - 1;
const docOf = (x: number) => Math.floor(x / TF_SPAN);
const tfOf = (x: number) => x % TF_SPAN;

export interface Bm25Data {
  v: 1;
  lens: number[];
  boosts: number[];
  dead: number[];
  /** term -> [docs delta-encoded..., tfs...] */
  terms: Record<string, number[]>;
}

export class Bm25 {
  private postings = new Map<string, Posting>();
  private lens: number[] = [];
  private boosts: number[] = [];
  private dead = new Set<number>();
  private totalLen = 0;
  private live = 0;
  private free: number[] = [];
  /** words whose lists grew since the last trim(), and how many postings were added */
  private grown = new Set<string>();
  private added = 0;
  private total = 0;

  constructor(private k1 = 1.2, private b = 0.75) {}

  get size(): number {
    return this.live;
  }

  /** Adds a passage and returns its number. `boost` weighs it up (names count more than body text). */
  add(words: string[], boost = 1): number {
    const doc = this.free.pop() ?? this.lens.length;
    this.lens[doc] = words.length;
    this.boosts[doc] = boost;
    this.dead.delete(doc);
    this.totalLen += words.length;
    this.live++;
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const [w, n] of tf) {
      const p = this.postings.get(w);
      const x = doc * TF_SPAN + Math.min(n, TF_MAX);
      if (p) {
        p.push(x);
        this.grown.add(w);
      } else this.postings.set(w, [x]);
      this.added++;
      this.total++;
    }
    return doc;
  }

  remove(doc: number): void {
    if (doc >= this.lens.length || this.dead.has(doc)) return;
    this.dead.add(doc);
    this.totalLen -= this.lens[doc];
    this.live--;
    if (this.dead.size > 1000 && this.dead.size > this.live * 0.3) this.compact();
  }

  /** Drops removed passages from the postings, and frees their numbers for reuse. */
  compact(): void {
    if (!this.dead.size) return;
    for (const [w, p] of this.postings) {
      let n = 0;
      for (let i = 0; i < p.length; i++) if (!this.dead.has(docOf(p[i]))) p[n++] = p[i];
      this.total -= p.length - n;
      // An exact-size copy, one list at a time: shortening an array keeps its old room.
      if (!n) this.postings.delete(w);
      else if (n < p.length) this.postings.set(w, p.slice(0, n));
    }
    for (const d of this.dead) { this.lens[d] = 0; this.free.push(d); }
    this.dead.clear();
  }

  /**
   * Gives back the spare room in lists that grew, once additions since the last
   * trim come to a quarter of all postings (so the copying stays a small share of
   * the work of adding), or always with `force`.
   */
  trim(force = false): void {
    if (!force && this.added < this.total / 4) return;
    this.added = 0;
    for (const w of this.grown) {
      const p = this.postings.get(w);
      if (p) this.postings.set(w, p.slice());
    }
    this.grown.clear();
  }

  /**
   * Best passages for the words. `accept` can rule passages out (filters) before
   * they take a place in the top `k`.
   */
  search(words: string[], k = 100, accept?: (doc: number) => boolean): Bm25Hit[] {
    if (!this.live || !words.length) return [];
    const avg = this.totalLen / this.live || 1;
    const scores = new Map<number, number>();
    const uniq = [...new Set(words)];
    for (const w of uniq) {
      const p = this.postings.get(w);
      if (!p) continue;
      let df = p.length;
      if (this.dead.size) df = p.reduce((n, x) => n + (this.dead.has(docOf(x)) ? 0 : 1), 0);
      if (!df) continue;
      const idf = Math.log(1 + (this.live - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.length; i++) {
        const d = docOf(p[i]);
        if (this.dead.has(d)) continue;
        const tf = tfOf(p[i]);
        const s = idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * this.lens[d]) / avg)));
        scores.set(d, (scores.get(d) ?? 0) + s);
      }
    }
    const hits: Bm25Hit[] = [];
    for (const [doc, s] of scores) {
      if (accept && !accept(doc)) continue;
      hits.push({ doc, score: s * (this.boosts[doc] ?? 1) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** The posting list in passage order (reused passage numbers can leave it out of order). */
  private static ordered(p: Posting): Posting {
    for (let i = 1; i < p.length; i++) if (p[i] < p[i - 1]) return p.slice().sort((a, b) => a - b);
    return p;
  }

  toJSON(): Bm25Data {
    this.compact();
    const terms: Record<string, number[]> = {};
    for (const [w, p] of this.postings) {
      const o = Bm25.ordered(p);
      const out: number[] = [];
      let prev = 0;
      for (const x of o) { const d = docOf(x); out.push(d - prev); prev = d; }
      for (const x of o) out.push(tfOf(x));
      terms[w] = out;
    }
    return { v: 1, lens: this.lens, boosts: this.boosts, dead: [...this.free], terms };
  }

  /** The same JSON as toJSON(), written piece by piece (no copy of the postings on the heap). */
  writeJSON(out: JsonChunks): void {
    this.compact();
    out.raw('{"v":1,"lens":').nums(this.lens).raw(',"boosts":').nums(this.boosts).raw(',"dead":').nums(this.free).raw(',"terms":{');
    let first = true;
    for (const [w, p] of this.postings) {
      const o = Bm25.ordered(p);
      let line = `${first ? '' : ','}${JSON.stringify(w)}:[`;
      let prev = 0;
      for (let k = 0; k < o.length; k++) {
        const d = docOf(o[k]);
        line += `${k ? ',' : ''}${d - prev}`;
        prev = d;
      }
      for (let k = 0; k < o.length; k++) line += `,${tfOf(o[k])}`;
      out.raw(line + ']');
      first = false;
    }
    out.raw('}}');
  }

  static fromJSON(d: Bm25Data): Bm25 {
    const x = new Bm25();
    x.lens = d.lens;
    x.boosts = d.boosts;
    x.free = [...d.dead];
    const freeSet = new Set(d.dead);
    for (let i = 0; i < x.lens.length; i++) if (!freeSet.has(i)) { x.live++; x.totalLen += x.lens[i]; }
    for (const [w, arr] of Object.entries(d.terms)) {
      const n = arr.length / 2;
      const p: Posting = [];
      let prev = 0;
      for (let i = 0; i < n; i++) { prev += arr[i]; p.push(prev * TF_SPAN + Math.min(arr[n + i], TF_MAX)); }
      x.postings.set(w, p);
      x.total += n;
    }
    return x;
  }
}
