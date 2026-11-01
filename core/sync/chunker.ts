// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Content-defined chunking: cut points depend on the bytes themselves, so
// inserting a byte early in a file moves only the chunks around it, and the
// rest of the file is recognised as already there (by sync and by backups).
// The method follows FastCDC (gear hash, normalised chunk sizes).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface ChunkParams {
  min: number;
  avg: number;
  max: number;
}

/** For sync: smaller pieces, so small edits move little. */
export const SYNC_CHUNKS: ChunkParams = { min: 16 << 10, avg: 64 << 10, max: 256 << 10 };
/** For backups: bigger pieces, fewer objects to keep track of. */
export const BACKUP_CHUNKS: ChunkParams = { min: 256 << 10, avg: 1 << 20, max: 4 << 20 };

// A fixed table of 256 pseudo-random 32-bit values (deterministic, so every device cuts the same way).
const GEAR = (() => {
  const t = new Uint32Array(256);
  let s = 0x9e3779b9;
  for (let i = 0; i < 256; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    t[i] = (z ^ (z >>> 14)) >>> 0;
  }
  return t;
})();

function masks(avg: number): [number, number] {
  const bits = Math.round(Math.log2(avg));
  // Harder to cut before the average size, easier after it: sizes cluster near the average.
  const mk = (n: number) => (n >= 32 ? 0xffffffff : ((1 << n) - 1) << (32 - n)) >>> 0;
  return [mk(bits + 2), mk(Math.max(1, bits - 2))];
}

/** Where to cut `buf` (from `start`), or buf.length when no cut is found before the end of what is there. */
export function findCut(buf: Uint8Array, start: number, p: ChunkParams, eof: boolean): number {
  const len = buf.length - start;
  if (len <= p.min) return eof ? buf.length : -1;
  const [maskS, maskL] = masks(p.avg);
  const end = Math.min(len, p.max);
  const normal = Math.min(end, p.avg);
  let fp = 0;
  let i = p.min;
  for (; i < normal; i++) {
    fp = ((fp << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((fp & maskS) === 0) return start + i + 1;
  }
  for (; i < end; i++) {
    fp = ((fp << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((fp & maskL) === 0) return start + i + 1;
  }
  if (end === p.max) return start + end;
  return eof ? buf.length : -1;
}

export interface Chunk {
  /** hex SHA-256 of the chunk */
  hash: string;
  offset: number;
  size: number;
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Chunks of a buffer held in memory. */
export function chunkBuffer(buf: Uint8Array, p: ChunkParams = SYNC_CHUNKS): Chunk[] {
  const out: Chunk[] = [];
  let at = 0;
  while (at < buf.length) {
    const cut = findCut(buf, at, p, true);
    out.push({ hash: sha256(buf.subarray(at, cut)), offset: at, size: cut - at });
    at = cut;
  }
  return out;
}

/**
 * Chunks of a file, read as a stream so files of any size use little memory.
 * `onChunk` gets each piece's bytes (backups store them); the file's own hash comes back too.
 */
export async function chunkFile(
  file: string,
  p: ChunkParams = SYNC_CHUNKS,
  onChunk?: (c: Chunk, data: Buffer) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<{ chunks: Chunk[]; hash: string; size: number }> {
  const whole = createHash('sha256');
  const chunks: Chunk[] = [];
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let offset = 0;
  const emit = async (data: Buffer) => {
    const c = { hash: sha256(data), offset, size: data.length };
    chunks.push(c);
    offset += data.length;
    if (onChunk) await onChunk(c, data);
  };
  const stream = createReadStream(file, { highWaterMark: Math.max(1 << 20, p.max) });
  for await (const part of stream as AsyncIterable<Buffer>) {
    if (signal?.aborted) {
      stream.destroy();
      throw new Error('cancelled');
    }
    whole.update(part);
    pending = pending.length ? Buffer.concat([pending, part]) : part;
    let at = 0;
    for (;;) {
      const cut = findCut(pending, at, p, false);
      if (cut < 0) break;
      await emit(pending.subarray(at, cut));
      at = cut;
    }
    pending = pending.subarray(at);
  }
  if (pending.length) {
    let at = 0;
    while (at < pending.length) {
      const cut = findCut(pending, at, p, true);
      await emit(pending.subarray(at, cut));
      at = cut;
    }
  }
  return { chunks, hash: whole.digest('hex'), size: offset };
}
