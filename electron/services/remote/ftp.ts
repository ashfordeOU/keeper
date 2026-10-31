// SPDX-License-Identifier: AGPL-3.0-or-later
// FTP and FTPS (explicit TLS). One control connection does one thing at a
// time, so requests wait their turn; a dropped connection is opened again.

import { Client, type FileInfo } from 'basic-ftp';
import { PassThrough, Readable } from 'node:stream';
import type { Connection, RemoteEntry, RemoteFs } from '../../../core/remote/types';
import { joinRemote, normalizeRemote, onServer } from '../../../core/remote/paths';

export class FtpFs implements RemoteFs {
  private client: Client | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private conn: Connection, private password: string | undefined, private timeoutMs = 20_000) {}

  static async open(conn: Connection, password?: string): Promise<FtpFs> {
    const fs = new FtpFs(conn, password);
    await fs.run(async () => undefined);
    return fs;
  }

  private async ready(): Promise<Client> {
    if (this.client && !this.client.closed) return this.client;
    const c = new Client(this.timeoutMs);
    try {
      await c.access({
      host: this.conn.host,
      port: this.conn.port ?? 21,
      user: this.conn.user || 'anonymous',
      password: this.password ?? (this.conn.user ? '' : 'guest'),
      secure: !!this.conn.secure,
      secureOptions: this.conn.insecure ? { rejectUnauthorized: false } : undefined,
      });
    } catch (e) {
      // A refused sign-in leaves the control connection open; close it.
      c.close();
      throw e;
    }
    this.client = c;
    return c;
  }

  /** Runs one request after the ones before it, reconnecting once if the server dropped the connection. */
  private run<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      try {
        return await fn(await this.ready());
      } catch (e) {
        if (this.client?.closed) {
          this.client = null;
          return fn(await this.ready());
        }
        throw e;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private at(p: string): string {
    return onServer(this.conn.root, p);
  }

  private entry(dir: string, f: FileInfo): RemoteEntry {
    return { name: f.name, path: joinRemote(dir, f.name), isDir: f.isDirectory, size: f.isDirectory ? 0 : f.size, mtime: f.modifiedAt?.getTime() ?? listDate(f.rawModifiedAt) };
  }

  list(dir: string): Promise<RemoteEntry[]> {
    const d = normalizeRemote(dir);
    return this.run(async (c) => (await c.list(this.at(d))).filter((f) => f.name !== '.' && f.name !== '..').map((f) => this.entry(d, f)));
  }

  async stat(p: string): Promise<RemoteEntry | null> {
    const n = normalizeRemote(p);
    if (n === '/') return { name: '', path: '/', isDir: true, size: 0, mtime: 0 };
    const parent = n.slice(0, n.lastIndexOf('/')) || '/';
    try {
      return (await this.list(parent)).find((e) => e.path === n) ?? null;
    } catch {
      return null;
    }
  }

  read(p: string, opts: { start?: number } = {}): Promise<NodeJS.ReadableStream> {
    const out = new PassThrough();
    // The download holds the connection until it ends; later requests wait.
    void this.run((c) => c.downloadTo(out, this.at(p), opts.start ?? 0)).catch((e) => out.destroy(e));
    return Promise.resolve(out);
  }

  async write(p: string, data: NodeJS.ReadableStream): Promise<void> {
    await this.run((c) => c.uploadFrom(Readable.from(data as AsyncIterable<Buffer>), this.at(p)));
  }

  async mkdir(p: string): Promise<void> {
    await this.run(async (c) => {
      await c.send(`MKD ${this.at(p)}`);
    });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.run((c) => c.rename(this.at(from), this.at(to)));
  }

  async remove(p: string, isDir: boolean): Promise<void> {
    await this.run(async (c) => {
      if (isDir) await c.removeDir(this.at(p));
      else await c.remove(this.at(p));
    });
  }

  async close(): Promise<void> {
    this.client?.close();
    this.client = null;
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Dates from Unix-style FTP listings: "Oct 31 01:23" (within the last half
 * year, so the year is implied) or "Oct 31  2024"; Windows servers send
 * "10-31-26  01:23AM". Local time, as the server shows it.
 */
export function listDate(raw: string | undefined, now = Date.now()): number {
  if (!raw) return 0;
  const s = raw.trim();
  let m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon < 0) return 0;
    const year = new Date(now).getFullYear();
    let t = new Date(year, mon, +m[2], +m[3], +m[4]).getTime();
    // A date in the future means last year.
    if (t > now + 86_400_000) t = new Date(year - 1, mon, +m[2], +m[3], +m[4]).getTime();
    return t;
  }
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    return mon < 0 ? 0 : new Date(+m[3], mon, +m[2]).getTime();
  }
  m = s.match(/^(\d{2})-(\d{2})-(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let h = +m[4] % 12;
    if (m[6]?.toUpperCase() === 'PM') h += 12;
    else if (!m[6]) h = +m[4];
    return new Date(y, +m[1] - 1, +m[2], h, +m[5]).getTime();
  }
  return 0;
}
