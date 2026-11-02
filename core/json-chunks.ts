// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing a large JSON file without building it in memory first. The library
// index and the brain grow with the library: turning one of them into a single
// object copy plus one JSON string took several times its own size on the
// JavaScript heap (and fails outright past V8's longest string), which in the
// main process is a fatal out-of-memory. Here the JSON is produced piece by
// piece into ~1 MB buffers (outside the JavaScript heap), synchronously so the
// file is one consistent picture, and written afterwards.

import { closeSync, fsyncSync, mkdirSync, openSync, promises as fsp, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

const CHUNK = 1 << 20;

export class JsonChunks {
  readonly parts: Buffer[] = [];
  private pending: string[] = [];
  private size = 0;
  /** total bytes so far */
  bytes = 0;

  /** Raw JSON text, already valid where it is put. */
  raw(s: string): this {
    this.pending.push(s);
    this.size += s.length;
    if (this.size >= CHUNK) this.flush();
    return this;
  }

  /** A string, number, boolean, null or any small value, encoded as JSON.stringify would. */
  value(v: unknown): this {
    return this.raw(v === undefined ? 'null' : JSON.stringify(v));
  }

  /** A number as JSON.stringify writes it (NaN and Infinity become null). */
  num(n: number | undefined): this {
    return this.raw(typeof n === 'number' && Number.isFinite(n) ? String(n) : 'null');
  }

  /** An array of numbers, without making its whole text at once. */
  nums(a: ArrayLike<number | undefined>): this {
    this.raw('[');
    let line = '';
    for (let i = 0; i < a.length; i++) {
      const n = a[i];
      line += (i ? ',' : '') + (typeof n === 'number' && Number.isFinite(n) ? String(n) : 'null');
      if (line.length > 65_536) {
        this.raw(line);
        line = '';
      }
    }
    return this.raw(line + ']');
  }

  private flush() {
    if (!this.pending.length) return;
    const b = Buffer.from(this.pending.join(''), 'utf8');
    this.parts.push(b);
    this.bytes += b.length;
    this.pending = [];
    this.size = 0;
  }

  /** The finished buffers. */
  done(): Buffer[] {
    this.flush();
    return this.parts;
  }

  /** Everything as one string (tests and small files). */
  text(): string {
    return Buffer.concat(this.done()).toString('utf8');
  }
}

/** Writes the buffers to `file` through a temporary file, so a crash never leaves half a file. */
export async function writeChunksAtomic(file: string, parts: Buffer[], tmp = `${file}.tmp`): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const fh = await fsp.open(tmp, 'w');
  try {
    for (const b of parts) await fh.write(b, 0, b.length);
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

/** The same, at once (for quitting). */
export function writeChunksAtomicSync(file: string, parts: Buffer[], tmp = `${file}.tmp`, sync = false): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(tmp, 'w');
  try {
    for (const b of parts) {
      let off = 0;
      while (off < b.length) off += writeSync(fd, b, off, b.length - off);
    }
    if (sync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/**
 * A copy of a string that does not keep a larger one alive. `big.slice(0, n)`
 * in V8 is a view that holds all of `big`: 20,000 characters kept from a
 * 1 MB file kept the whole megabyte for as long as the slice lived.
 */
export function ownString(s: string): string {
  return s.length < 13 ? s : (JSON.parse(JSON.stringify(s)) as string);
}
