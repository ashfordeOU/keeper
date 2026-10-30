// SPDX-License-Identifier: AGPL-3.0-or-later
// Finds exact duplicates (same bytes), look-alike photos (bursts, edits,
// resized copies) and the same photo saved in two formats (HEIC + JPEG,
// RAW + JPEG), then suggests which copy to keep.

import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import type { DuplicateGroup, FileEntry } from './types';

const PARTIAL = 64 * 1024;

export interface HashOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, current?: string) => void;
  /** reuse hashes from an earlier run when size and mtime are unchanged */
  cache?: Map<string, { size: number; mtime: number; sha256: string }>;
  minSize?: number;
}

/** First and last 64 KB: cheap, and different files almost always differ here. */
export async function partialHash(path: string, size: number): Promise<string> {
  const fh = await fsp.open(path, 'r');
  try {
    const h = createHash('sha256');
    const len = Math.min(PARTIAL, size);
    const head = Buffer.alloc(len);
    await fh.read(head, 0, len, 0);
    h.update(head);
    if (size > PARTIAL * 2) {
      const tail = Buffer.alloc(PARTIAL);
      await fh.read(tail, 0, PARTIAL, size - PARTIAL);
      h.update(tail);
    }
    return h.digest('hex');
  } finally {
    await fh.close();
  }
}

export function fullHash(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path, { highWaterMark: 1024 * 1024, signal });
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function bucket<T>(items: T[], key: (t: T) => string | number | undefined): Map<string | number, T[]> {
  const m = new Map<string | number, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  for (const [k, v] of m) if (v.length < 2) m.delete(k);
  return m;
}

/**
 * Exact duplicates: group by size, then by a partial hash, then by the full
 * SHA-256. Files that only exist in the cloud are skipped so nothing downloads.
 */
export async function findExactDuplicates(files: FileEntry[], opts: HashOptions = {}): Promise<DuplicateGroup[]> {
  const minSize = opts.minSize ?? 1;
  const candidates = files.filter((f) => f.size >= minSize && !f.cloudOnly && f.kind !== 'app');
  const bySize = bucket(candidates, (f) => f.size);
  const total = [...bySize.values()].reduce((n, l) => n + l.length, 0);
  let done = 0;
  const groups: DuplicateGroup[] = [];

  for (const list of bySize.values()) {
    if (opts.signal?.aborted) break;
    // Hard links and the same file reached twice are not duplicates.
    const unique = dedupePaths(list);
    if (unique.length < 2) {
      done += list.length;
      continue;
    }
    const partials = new Map<FileEntry, string>();
    for (const f of unique) {
      opts.onProgress?.(++done, total, f.path);
      try {
        partials.set(f, unique.length === 2 && f.size <= PARTIAL * 2 ? 'small' : await partialHash(f.path, f.size));
      } catch {
        /* unreadable: skip */
      }
    }
    for (const sameStart of bucket([...partials.keys()], (f) => partials.get(f)).values()) {
      const full = new Map<FileEntry, string>();
      for (const f of sameStart) {
        if (opts.signal?.aborted) break;
        const cached = opts.cache?.get(f.path);
        if (cached && cached.size === f.size && cached.mtime === f.mtime) {
          full.set(f, cached.sha256);
          continue;
        }
        try {
          const sha = await fullHash(f.path, opts.signal);
          full.set(f, sha);
          opts.cache?.set(f.path, { size: f.size, mtime: f.mtime, sha256: sha });
        } catch {
          /* unreadable or aborted */
        }
      }
      for (const [sha, same] of bucket([...full.keys()], (f) => full.get(f))) {
        const keep = pickKeeper(same, 'exact');
        groups.push({
          id: `exact:${String(sha).slice(0, 16)}`,
          kind: 'exact',
          files: same,
          keep: keep.file.path,
          reason: keep.reason,
          reclaimable: same[0].size * (same.length - 1),
        });
      }
    }
  }
  return groups.sort((a, b) => b.reclaimable - a.reclaimable);
}

function dedupePaths(list: FileEntry[]): FileEntry[] {
  const seen = new Set<string>();
  return list.filter((f) => {
    const k = f.path.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- look-alikes

/**
 * Difference hash of a 9x8 grayscale image (row-major, 72 bytes). Each bit says
 * whether a pixel is brighter than its right neighbour; resizes, re-encodes and
 * small edits keep most bits, so near-identical photos land a few bits apart.
 * Returned as 16 hex characters.
 */
export function dHash(gray9x8: Uint8Array | number[]): string {
  if (gray9x8.length !== 72) throw new Error('dHash needs 9x8 = 72 grayscale pixels');
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | v;
      else lo = (lo << 1) | v;
      bit++;
    }
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/** Converts RGBA (or BGRA) pixels of any size to the 9x8 grayscale grid dHash needs. */
export function toGray9x8(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels = 4): Uint8Array {
  const out = new Uint8Array(72);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      // Box-average the source area that maps onto this cell.
      const x0 = Math.floor((x * width) / 9);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / 9));
      const y0 = Math.floor((y * height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / 8));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * channels;
          // Luma; channel order (RGB vs BGR) barely matters for a brightness gradient.
          sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          n++;
        }
      }
      out[y * 9 + x] = n ? Math.round(sum / n) : 0;
    }
  }
  return out;
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hamming(a: string, b: string): number {
  return popcount32((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) + popcount32((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0);
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

/**
 * Groups photos whose dHash differs by at most `threshold` bits (out of 64).
 * 0-4 = the same picture re-saved or resized; 5-10 = bursts and light edits.
 * Photos already in an exact-duplicate group are left out.
 */
export function findSimilarImages(images: FileEntry[], hashes: Map<string, string>, threshold = 6, exclude = new Set<string>()): DuplicateGroup[] {
  const items = images.filter((f) => hashes.has(f.path) && !exclude.has(f.path));
  const hi = items.map((f) => parseInt(hashes.get(f.path)!.slice(0, 8), 16) >>> 0);
  const lo = items.map((f) => parseInt(hashes.get(f.path)!.slice(8), 16) >>> 0);
  const uf = new UnionFind(items.length);
  // Flat images (solid colour, blank pages) all hash to ~0 and would chain together.
  const flat = items.map((_, i) => popcount32(hi[i]) + popcount32(lo[i]) <= 2);
  for (let i = 0; i < items.length; i++) {
    if (flat[i]) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (flat[j]) continue;
      const d = popcount32((hi[i] ^ hi[j]) >>> 0) + popcount32((lo[i] ^ lo[j]) >>> 0);
      if (d <= threshold) uf.union(i, j);
    }
  }
  const byRoot = new Map<number, FileEntry[]>();
  items.forEach((f, i) => {
    const r = uf.find(i);
    const list = byRoot.get(r);
    if (list) list.push(f);
    else byRoot.set(r, [f]);
  });
  const groups: DuplicateGroup[] = [];
  for (const files of byRoot.values()) {
    if (files.length < 2) continue;
    const keep = pickKeeper(files, 'similar');
    groups.push({
      id: `similar:${hashes.get(files[0].path)}`,
      kind: 'similar',
      files,
      keep: keep.file.path,
      reason: keep.reason,
      reclaimable: files.reduce((n, f) => n + f.size, 0) - keep.file.size,
    });
  }
  return groups.sort((a, b) => b.reclaimable - a.reclaimable);
}

const PAIR_ORIGINALS = new Set(['heic', 'heif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf']);
const PAIR_COPIES = new Set(['jpg', 'jpeg', 'png']);

/** "IMG_1234.HEIC" next to "IMG_1234.JPG": the same shot in two formats. */
export function findFormatPairs(files: FileEntry[], exclude = new Set<string>()): DuplicateGroup[] {
  const stem = (f: FileEntry) => {
    const dir = f.path.slice(0, f.path.length - f.name.length);
    return (dir + f.name.slice(0, f.name.length - f.ext.length - 1)).toLowerCase();
  };
  const groups: DuplicateGroup[] = [];
  const byStem = bucket(
    files.filter((f) => f.kind === 'image' && !exclude.has(f.path) && (PAIR_ORIGINALS.has(f.ext) || PAIR_COPIES.has(f.ext))),
    stem,
  );
  for (const [key, list] of byStem) {
    const originals = list.filter((f) => PAIR_ORIGINALS.has(f.ext));
    const copies = list.filter((f) => PAIR_COPIES.has(f.ext));
    if (!originals.length || !copies.length) continue;
    const keep = originals.sort((a, b) => b.size - a.size)[0];
    const all = [keep, ...copies];
    groups.push({
      id: `pair:${key}`,
      kind: 'pair',
      files: all,
      keep: keep.path,
      reason: `Keeps the original ${keep.ext.toUpperCase()}; the ${copies.map((c) => c.ext.toUpperCase()).join('/')} is a converted copy`,
      reclaimable: copies.reduce((n, f) => n + f.size, 0),
    });
  }
  return groups.sort((a, b) => b.reclaimable - a.reclaimable);
}

// ---------------------------------------------------------------- which copy to keep

const COPY_NAME = /(\s\(\d+\)|\s-\s?copy(\s\d+)?|\scopy(\s\d+)?|_copy|-\d)(?=\.[^.]+$|$)/i;
const SCRATCH_DIR = /[\\/](downloads|temp|tmp|cache|caches|trash|\.trash)[\\/]/i;
const EDITED = /(-edited|_edited|\(edited\)|-export|_export)/i;

/**
 * Picks the copy most likely to be "the real one":
 *   exact    an un-numbered name, outside Downloads/temp, the oldest (the original)
 *   similar  the biggest picture (most detail), preferring an edited version
 */
export function pickKeeper(files: FileEntry[], kind: 'exact' | 'similar'): { file: FileEntry; reason: string } {
  const scored = files.map((f) => {
    let s = 0;
    const reasons: string[] = [];
    if (!COPY_NAME.test(f.name)) s += 4;
    if (!SCRATCH_DIR.test(f.path)) s += 3;
    if (kind === 'similar') {
      const px = (f.meta?.width ?? 0) * (f.meta?.height ?? 0);
      s += px ? Math.log2(px) / 4 : Math.log2(f.size + 1) / 8;
      if (EDITED.test(f.name)) s += 1;
    }
    return { f, s, reasons };
  });
  scored.sort((a, b) => b.s - a.s || (a.f.btime || a.f.mtime) - (b.f.btime || b.f.mtime) || a.f.path.length - b.f.path.length);
  const best = scored[0].f;
  const why: string[] = [];
  if (kind === 'exact') {
    if (!COPY_NAME.test(best.name) && files.some((f) => COPY_NAME.test(f.name))) why.push('it has the original name');
    if (!SCRATCH_DIR.test(best.path) && files.some((f) => SCRATCH_DIR.test(f.path))) why.push('it is not in Downloads or a temp folder');
    if (why.length === 0) why.push('it is the oldest copy');
  } else {
    why.push(best.meta?.width ? 'it has the most pixels' : 'it is the largest file, so likely the best quality');
  }
  return { file: best, reason: `Keeping this one because ${why.join(' and ')}` };
}

/** Everything a group would send to the Trash. */
export function extrasOf(group: DuplicateGroup): FileEntry[] {
  return group.files.filter((f) => f.path !== group.keep);
}
