// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reads files out of a ZIP archive (an Outlook for Mac .olm export, a
// Todoist backup) without loading the whole archive: the directory at the end
// is read first, then each file when it is asked for. ZIP64 (archives over
// 4 GB) is understood. Only "stored" and "deflate" files, which is what these
// exports use.

import { promises as fsp } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  method: number;
  offset: number;
}

export class ZipReader {
  private constructor(private fh: fsp.FileHandle, public entries: ZipEntry[]) {}

  static async open(file: string): Promise<ZipReader> {
    const fh = await fsp.open(file, 'r');
    try {
      const { size } = await fh.stat();
      const tailLen = Math.min(size, 66_000 + 22);
      const tail = Buffer.alloc(tailLen);
      await fh.read(tail, 0, tailLen, size - tailLen);
      const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) throw new Error('This file is not an archive Keeper can read');
      let count = tail.readUInt16LE(eocd + 10);
      let dirSize = tail.readUInt32LE(eocd + 12);
      let dirOffset = tail.readUInt32LE(eocd + 16);
      // ZIP64: the real numbers are in the ZIP64 end record, found through its locator.
      const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
      if (loc >= 0 && (dirOffset === 0xffffffff || count === 0xffff)) {
        const recOff = Number(tail.readBigUInt64LE(loc + 8));
        const rec = Buffer.alloc(56);
        await fh.read(rec, 0, 56, recOff);
        count = Number(rec.readBigUInt64LE(32));
        dirSize = Number(rec.readBigUInt64LE(40));
        dirOffset = Number(rec.readBigUInt64LE(48));
      }
      const dir = Buffer.alloc(dirSize);
      await fh.read(dir, 0, dirSize, dirOffset);
      const entries: ZipEntry[] = [];
      let p = 0;
      for (let i = 0; i < count && p + 46 <= dir.length; i++) {
        if (dir.readUInt32LE(p) !== 0x02014b50) break;
        const method = dir.readUInt16LE(p + 10);
        let compressed = dir.readUInt32LE(p + 20);
        let sz = dir.readUInt32LE(p + 24);
        const nameLen = dir.readUInt16LE(p + 28);
        const extraLen = dir.readUInt16LE(p + 30);
        const commentLen = dir.readUInt16LE(p + 32);
        let offset = dir.readUInt32LE(p + 42);
        const name = dir.subarray(p + 46, p + 46 + nameLen).toString('utf8');
        // ZIP64 extra field: sizes and offset that did not fit.
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = dir.readUInt16LE(e);
          const len = dir.readUInt16LE(e + 2);
          if (id === 1) {
            let q = e + 4;
            if (sz === 0xffffffff) { sz = Number(dir.readBigUInt64LE(q)); q += 8; }
            if (compressed === 0xffffffff) { compressed = Number(dir.readBigUInt64LE(q)); q += 8; }
            if (offset === 0xffffffff) offset = Number(dir.readBigUInt64LE(q));
          }
          e += 4 + len;
        }
        entries.push({ name, size: sz, compressed, method, offset });
        p = end + commentLen;
      }
      return new ZipReader(fh, entries);
    } catch (e) {
      await fh.close();
      throw e;
    }
  }

  async read(entry: ZipEntry): Promise<Buffer> {
    if (entry.size > 512 * 1024 * 1024) throw new Error(`${entry.name} is too large to read`);
    const head = Buffer.alloc(30);
    await this.fh.read(head, 0, 30, entry.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('The archive is damaged');
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = Buffer.alloc(entry.compressed);
    await this.fh.read(data, 0, entry.compressed, start);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`${entry.name} is packed in a way Keeper can’t read`);
  }

  find(name: string): ZipEntry | undefined {
    return this.entries.find((e) => e.name === name) ?? this.entries.find((e) => e.name.endsWith(`/${name}`) || e.name === name.replace(/^\//, ''));
  }

  async close() {
    await this.fh.close();
  }
}
