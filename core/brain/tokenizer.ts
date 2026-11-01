// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A Unigram (SentencePiece-style) tokenizer, enough to feed the multilingual
// sentence-embedding model Keeper uses for "search by meaning". It reads the
// model's own tokenizer.json, so the ids match what the model was trained on.

export interface UnigramSpec {
  /** [piece, score] pairs; the index is the token id */
  vocab: [string, number][];
  unkId: number;
  bosId: number;
  eosId: number;
  padId: number;
}

export class UnigramTokenizer {
  private pieces = new Map<string, number>();
  private scores: Float64Array;
  private maxLen = 1;
  private unkScore: number;

  constructor(private spec: UnigramSpec) {
    this.scores = new Float64Array(spec.vocab.length);
    let min = 0;
    spec.vocab.forEach(([p, s], i) => {
      if (i === spec.unkId || i === spec.bosId || i === spec.eosId || i === spec.padId) return;
      this.pieces.set(p, i);
      this.scores[i] = s;
      if (s < min) min = s;
      const n = [...p].length;
      if (n > this.maxLen) this.maxLen = n;
    });
    this.unkScore = min - 10;
  }

  /** Builds a tokenizer from the text of a Hugging Face tokenizer.json (Unigram model). */
  static fromJson(json: string | { model: { type: string; vocab: [string, number][]; unk_id?: number } }): UnigramTokenizer {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.model?.type !== 'Unigram') throw new Error('Not a Unigram tokenizer');
    const vocab = d.model.vocab as [string, number][];
    const id = (t: string, dflt: number) => {
      const i = vocab.findIndex(([p]) => p === t);
      return i >= 0 ? i : dflt;
    };
    return new UnigramTokenizer({ vocab, unkId: d.model.unk_id ?? id('<unk>', 3), bosId: id('<s>', 0), eosId: id('</s>', 2), padId: id('<pad>', 1) });
  }

  get bos() { return this.spec.bosId; }
  get eos() { return this.spec.eosId; }
  get pad() { return this.spec.padId; }

  /** Normalisation close to the model's own (NFKC, whitespace collapsed, ▁ for spaces). */
  normalize(text: string): string {
    const t = text
      .normalize('NFKC')
      // control characters go; every kind of space becomes a plain one
      .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F​‌‍﻿]/g, '')
      .replace(/\s+/gu, ' ')
      // like the model's own normaliser: leading space goes, one trailing space stays
      .replace(/^ /, '');
    return t ? '▁' + t.replace(/ /g, '▁') : '';
  }

  /** Splits text into token ids (without the start and end markers). */
  encodeRaw(text: string): number[] {
    const out: number[] = [];
    // Each ▁-led word is tokenized on its own: the best split never crosses a space
    // in practice, and short pieces keep the lattice small.
    const norm = this.normalize(text);
    if (!norm) return out;
    for (const word of norm.split(/(?=▁)/u)) this.viterbi([...word], out);
    return out;
  }

  /** Ids for the model: <s> … </s>, cut to `max` tokens in total. */
  encode(text: string, max = 512): number[] {
    const ids = this.encodeRaw(text).slice(0, max - 2);
    return [this.bos, ...ids, this.eos];
  }

  private viterbi(chars: string[], out: number[]) {
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const tok = new Int32Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let s = '';
      let any = false;
      for (let j = i; j < Math.min(n, i + this.maxLen); j++) {
        s += chars[j];
        const id = this.pieces.get(s);
        if (id === undefined) continue;
        if (j === i) any = true;
        const sc = best[i] + this.scores[id];
        if (sc > best[j + 1]) { best[j + 1] = sc; from[j + 1] = i; tok[j + 1] = id; }
      }
      // A character no piece covers becomes <unk>.
      if (!any) {
        const sc = best[i] + this.unkScore;
        if (sc > best[i + 1]) { best[i + 1] = sc; from[i + 1] = i; tok[i + 1] = this.spec.unkId; }
      }
    }
    const ids: number[] = [];
    for (let k = n; k > 0; k = from[k]) ids.push(tok[k]);
    ids.reverse();
    // Neighbouring unknown characters merge into one <unk>.
    for (const id of ids) if (!(id === this.spec.unkId && out[out.length - 1] === this.spec.unkId)) out.push(id);
  }
}
