// SPDX-License-Identifier: AGPL-3.0-or-later
// The word index: classic BM25 ranking over passages. Documents are numbered;
// removing one only marks it, and the postings are compacted once a good share
// of them are gone, so keeping the index up to date stays cheap.

export interface Bm25Hit {
  doc: number;
  score: number;
}

interface Posting {
  docs: number[];
  tfs: number[];
}

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
      let p = this.postings.get(w);
      if (!p) this.postings.set(w, (p = { docs: [], tfs: [] }));
      p.docs.push(doc);
      p.tfs.push(n);
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
      const docs: number[] = [];
      const tfs: number[] = [];
      for (let i = 0; i < p.docs.length; i++) if (!this.dead.has(p.docs[i])) { docs.push(p.docs[i]); tfs.push(p.tfs[i]); }
      if (docs.length) this.postings.set(w, { docs, tfs });
      else this.postings.delete(w);
    }
    for (const d of this.dead) { this.lens[d] = 0; this.free.push(d); }
    this.dead.clear();
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
      let df = p.docs.length;
      if (this.dead.size) df = p.docs.reduce((n, d) => n + (this.dead.has(d) ? 0 : 1), 0);
      if (!df) continue;
      const idf = Math.log(1 + (this.live - df + 0.5) / (df + 0.5));
      for (let i = 0; i < p.docs.length; i++) {
        const d = p.docs[i];
        if (this.dead.has(d)) continue;
        const tf = p.tfs[i];
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

  toJSON(): Bm25Data {
    this.compact();
    const terms: Record<string, number[]> = {};
    for (const [w, p] of this.postings) {
      const order = p.docs.map((_d, i) => i).sort((a, b) => p.docs[a] - p.docs[b]);
      const out: number[] = [];
      let prev = 0;
      for (const i of order) { out.push(p.docs[i] - prev); prev = p.docs[i]; }
      for (const i of order) out.push(p.tfs[i]);
      terms[w] = out;
    }
    return { v: 1, lens: this.lens, boosts: this.boosts, dead: [...this.free], terms };
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
      const docs: number[] = [];
      let prev = 0;
      for (let i = 0; i < n; i++) { prev += arr[i]; docs.push(prev); }
      x.postings.set(w, { docs, tfs: arr.slice(n) });
    }
    return x;
  }
}
