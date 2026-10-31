// SPDX-License-Identifier: AGPL-3.0-or-later
// WebDAV: Nextcloud, ownCloud, home servers, NAS boxes and any server that
// speaks it. Plain HTTP(S) requests; self-signed certificates only when the
// person allowed them for this connection.

import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import { normalizeRemote, onServer } from '../../../core/remote/paths';
import type { Connection, Quota, RemoteEntry, RemoteFs } from '../../../core/remote/types';
import { parseMultistatus, parseQuota, PROPFIND_BODY, QUOTA_BODY } from '../../../core/remote/webdav-xml';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class WebDavFs implements RemoteFs {
  private agent: http.Agent;
  private auth?: string;

  constructor(private conn: Connection, password?: string) {
    this.agent = conn.secure ? new https.Agent({ keepAlive: true, rejectUnauthorized: !conn.insecure }) : new http.Agent({ keepAlive: true });
    if (conn.user) this.auth = 'Basic ' + Buffer.from(`${conn.user}:${password ?? ''}`).toString('base64');
  }

  static async open(conn: Connection, password?: string): Promise<WebDavFs> {
    const fs = new WebDavFs(conn, password);
    await fs.list('/');
    return fs;
  }

  /** Path on the server, each part URL-encoded. */
  private serverPath(p: string): string {
    return onServer(this.conn.root, p).split('/').map((s) => encodeURIComponent(s)).join('/') || '/';
  }

  private request(method: string, p: string, opts: { headers?: Record<string, string>; body?: string | Readable; dir?: boolean } = {}): Promise<http.IncomingMessage> {
    const lib = this.conn.secure ? https : http;
    let path = this.serverPath(p);
    if (opts.dir && !path.endsWith('/')) path += '/';
    return new Promise((resolve, reject) => {
      const req = lib.request({
        host: this.conn.host,
        port: this.conn.port ?? (this.conn.secure ? 443 : 80),
        method,
        path,
        agent: this.agent,
        timeout: 30_000,
        headers: { ...(this.auth ? { authorization: this.auth } : {}), ...opts.headers },
      }, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 400) {
          res.resume();
          const msg = code === 401 ? 'The server did not accept the user name or password' : code === 404 ? 'Not found on the server' : code === 507 ? 'The server is out of space' : `The server answered ${code}`;
          reject(new HttpError(code, msg));
          return;
        }
        resolve(res);
      });
      req.on('timeout', () => req.destroy(new Error('The server did not answer in time')));
      req.on('error', reject);
      if (typeof opts.body === 'string') req.end(opts.body);
      else if (opts.body) opts.body.pipe(req);
      else req.end();
    });
  }

  private async text(res: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  async list(dir: string): Promise<RemoteEntry[]> {
    const d = normalizeRemote(dir);
    const res = await this.request('PROPFIND', d, { dir: true, headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body: PROPFIND_BODY });
    return parseMultistatus(await this.text(res), onServer(this.conn.root, '/'), d);
  }

  async stat(p: string): Promise<RemoteEntry | null> {
    const n = normalizeRemote(p);
    try {
      const res = await this.request('PROPFIND', n, { headers: { depth: '0', 'content-type': 'application/xml; charset=utf-8' }, body: PROPFIND_BODY });
      const xml = await this.text(res);
      // Depth 0 returns the item itself: parse it as a listing of its parent and pick it.
      const parent = n.slice(0, n.lastIndexOf('/')) || '/';
      return parseMultistatus(xml, onServer(this.conn.root, '/'), parent === n ? '/__none__' : parent).find((e) => e.path === n) ?? (n === '/' ? { name: '', path: '/', isDir: true, size: 0, mtime: 0 } : null);
    } catch {
      return null;
    }
  }

  async read(p: string, opts: { start?: number; end?: number } = {}): Promise<NodeJS.ReadableStream> {
    const headers: Record<string, string> = {};
    if (opts.start !== undefined || opts.end !== undefined) headers.range = `bytes=${opts.start ?? 0}-${opts.end !== undefined ? opts.end - 1 : ''}`;
    return this.request('GET', p, { headers });
  }

  async write(p: string, data: NodeJS.ReadableStream, size?: number): Promise<void> {
    const res = await this.request('PUT', p, { body: data as Readable, headers: size !== undefined ? { 'content-length': String(size) } : { 'transfer-encoding': 'chunked' } });
    res.resume();
  }

  async mkdir(p: string): Promise<void> {
    (await this.request('MKCOL', p, { dir: true })).resume();
  }

  async rename(from: string, to: string): Promise<void> {
    const proto = this.conn.secure ? 'https' : 'http';
    const dest = `${proto}://${this.conn.host}${this.conn.port ? `:${this.conn.port}` : ''}${this.serverPath(to)}`;
    (await this.request('MOVE', from, { headers: { destination: dest, overwrite: 'F' } })).resume();
  }

  async remove(p: string, isDir: boolean): Promise<void> {
    // Nextcloud and ownCloud move deleted items to their own trash.
    (await this.request('DELETE', p, { dir: isDir })).resume();
  }

  async quota(): Promise<Quota | undefined> {
    try {
      const res = await this.request('PROPFIND', '/', { dir: true, headers: { depth: '0', 'content-type': 'application/xml; charset=utf-8' }, body: QUOTA_BODY });
      return parseQuota(await this.text(res));
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    this.agent.destroy();
  }
}
