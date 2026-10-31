// SPDX-License-Identifier: AGPL-3.0-or-later
// A cloud or server connection (Google Drive, OneDrive, Dropbox, Nextcloud,
// SFTP, … through Keeper's connections) as a place to keep backups and mirrors.

import { createReadStream, createWriteStream, promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { RemoteStore, StoreEntry } from '../../../core/sync/ports';

/** The parts of a connection's file access backups use (paths start with "/"). */
export interface RemoteFsLike {
  list(dir: string): Promise<{ path: string; isDir: boolean; size: number; mtime: number }[]>;
  stat(p: string): Promise<{ path: string; isDir: boolean; size: number; mtime: number } | null>;
  read(p: string, opts?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream>;
  write(p: string, data: NodeJS.ReadableStream, size?: number): Promise<void>;
  mkdir(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(p: string, isDir: boolean): Promise<void>;
  quota?(): Promise<{ used?: number; total?: number } | undefined>;
}

const abs = (p: string) => '/' + p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const rel = (p: string) => p.replace(/^\/+/, '');

async function collect(s: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s as AsyncIterable<Buffer | string>) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(parts);
}

export function storeFromRemoteFs(fs: RemoteFsLike, label: string): RemoteStore {
  const made = new Set<string>();
  const ensureDir = async (p: string) => {
    const parts = rel(p).split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const d = '/' + parts.slice(0, i).join('/');
      if (made.has(d)) continue;
      if (!(await fs.stat(d).catch(() => null))) await fs.mkdir(d).catch(() => undefined);
      made.add(d);
    }
  };
  const entry = (e: { path: string; isDir: boolean; size: number; mtime: number }): StoreEntry => ({ path: rel(e.path), isDir: e.isDir, size: e.size, mtime: e.mtime });
  return {
    label,
    list: async (dir) => (await fs.list(abs(dir)).catch(() => [])).map(entry),
    stat: async (p) => {
      const e = await fs.stat(abs(p)).catch(() => null);
      return e ? entry(e) : null;
    },
    get: async (p, range) => collect(await fs.read(abs(p), range ? { start: range.start, end: range.end } : undefined)),
    put: async (p, data) => {
      await ensureDir(abs(p));
      const { Readable } = await import('node:stream');
      await fs.write(abs(p), Readable.from([data]), data.length);
    },
    delete: async (p) => {
      const e = await fs.stat(abs(p)).catch(() => null);
      if (e) await fs.remove(abs(p), e.isDir);
    },
    rename: async (a, b) => {
      await ensureDir(abs(b));
      await fs.rename(abs(a), abs(b));
    },
    mkdir: async (p) => {
      await ensureDir(abs(p) + '/x');
    },
    quota: fs.quota ? () => fs.quota!() : undefined,
    putFile: async (p, file) => {
      await ensureDir(abs(p));
      const st = await fsp.stat(file);
      await fs.write(abs(p), createReadStream(file), st.size);
    },
    getFile: async (p, file) => {
      await pipeline(await fs.read(abs(p)), createWriteStream(file));
    },
  };
}
