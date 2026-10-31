// SPDX-License-Identifier: AGPL-3.0-or-later
// Meaning vectors for passages, kept as 8-bit numbers (a quarter of the memory
// of 32-bit floats, with almost no loss for ranking) and searched by brute
// force, which stays fast for hundreds of thousands of passages.

export interface VectorHit {
  key: number;
  score: number;
}

/** Scales a unit vector into -127..127 and remembers the scale. */
export function quantize(v: Float32Array | number[]): { q: Int8Array; scale: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max / 127 || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale);
  return { q, scale };
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}

export class VectorStore {
  private data: Int8Array;
  private scales: Float32Array;
  private keys: Int32Array;
  private rows = 0;
  private rowOf = new Map<number, number>();
  private free: number[] = [];

  constructor(public readonly dims: number, capacity = 1024) {
    this.data = new Int8Array(dims * capacity);
    this.scales = new Float32Array(capacity);
    this.keys = new Int32Array(capacity).fill(-1);
  }

  get size(): number {
    return this.rowOf.size;
  }

  has(key: number): boolean {
    return this.rowOf.has(key);
  }

  private grow() {
    const cap = this.scales.length * 2;
    const d = new Int8Array(this.dims * cap); d.set(this.data); this.data = d;
    const s = new Float32Array(cap); s.set(this.scales); this.scales = s;
    const k = new Int32Array(cap).fill(-1); k.set(this.keys); this.keys = k;
  }

  /** Stores the (unit-length) vector for a key, replacing any earlier one. */
  set(key: number, v: Float32Array | number[]): void {
    if (v.length !== this.dims) throw new Error(`Expected ${this.dims} numbers, got ${v.length}`);
    let row = this.rowOf.get(key);
    if (row === undefined) {
      row = this.free.pop();
      if (row === undefined) {
        if (this.rows >= this.scales.length) this.grow();
        row = this.rows++;
      }
      this.rowOf.set(key, row);
    }
    const { q, scale } = quantize(v);
    this.data.set(q, row * this.dims);
    this.scales[row] = scale;
    this.keys[row] = key;
  }

  /** The stored vector for a key (unit length, rebuilt from 8 bits), or undefined. */
  get(key: number): Float32Array | undefined {
    const row = this.rowOf.get(key);
    if (row === undefined) return undefined;
    const out = new Float32Array(this.dims);
    const off = row * this.dims;
    for (let i = 0; i < this.dims; i++) out[i] = this.data[off + i] * this.scales[row];
    return out;
  }

  delete(key: number): void {
    const row = this.rowOf.get(key);
    if (row === undefined) return;
    this.rowOf.delete(key);
    this.keys[row] = -1;
    this.free.push(row);
  }

  /** The `k` stored vectors closest to `query` (unit length), best first. */
  search(query: Float32Array, k = 100, accept?: (key: number) => boolean): VectorHit[] {
    const dims = this.dims;
    const data = this.data;
    // Keep a small sorted top list instead of sorting every row.
    const topKeys: number[] = [];
    const topScores: number[] = [];
    let floor = -Infinity;
    for (let r = 0; r < this.rows; r++) {
      const key = this.keys[r];
      if (key < 0) continue;
      const off = r * dims;
      let dot = 0;
      let i = 0;
      for (; i + 3 < dims; i += 4) dot += query[i] * data[off + i] + query[i + 1] * data[off + i + 1] + query[i + 2] * data[off + i + 2] + query[i + 3] * data[off + i + 3];
      for (; i < dims; i++) dot += query[i] * data[off + i];
      const s = dot * this.scales[r];
      if (topScores.length >= k && s <= floor) continue;
      if (accept && !accept(key)) continue;
      let at = topScores.length;
      while (at > 0 && topScores[at - 1] < s) at--;
      topScores.splice(at, 0, s);
      topKeys.splice(at, 0, key);
      if (topScores.length > k) { topScores.pop(); topKeys.pop(); }
      floor = topScores.length >= k ? topScores[topScores.length - 1] : -Infinity;
    }
    return topKeys.map((key, i) => ({ key, score: topScores[i] }));
  }

  /** A compact binary form: header, keys, scales, then the 8-bit rows. */
  toBuffer(): Buffer {
    const live = [...this.rowOf.entries()];
    const head = Buffer.alloc(12);
    head.write('KVEC', 0, 'ascii');
    head.writeUInt32LE(this.dims, 4);
    head.writeUInt32LE(live.length, 8);
    const keys = Buffer.alloc(live.length * 4);
    const scales = Buffer.alloc(live.length * 4);
    const rows = Buffer.alloc(live.length * this.dims);
    live.forEach(([key, row], i) => {
      keys.writeInt32LE(key, i * 4);
      scales.writeFloatLE(this.scales[row], i * 4);
      rows.set(this.data.subarray(row * this.dims, (row + 1) * this.dims), i * this.dims);
    });
    return Buffer.concat([head, keys, scales, rows]);
  }

  static fromBuffer(b: Buffer): VectorStore {
    if (b.toString('ascii', 0, 4) !== 'KVEC') throw new Error('Not a vector file');
    const dims = b.readUInt32LE(4);
    const n = b.readUInt32LE(8);
    const v = new VectorStore(dims, Math.max(1024, n));
    let off = 12;
    for (let i = 0; i < n; i++) {
      const key = b.readInt32LE(off + i * 4);
      v.keys[i] = key;
      v.rowOf.set(key, i);
      v.scales[i] = b.readFloatLE(off + n * 4 + i * 4);
    }
    off += n * 8;
    v.data.set(new Int8Array(b.buffer, b.byteOffset + off, n * dims));
    v.rows = n;
    return v;
  }
}
