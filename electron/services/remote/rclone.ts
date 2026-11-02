// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cloud storage through rclone (MIT licence, bundled with Keeper): Google
// Drive, OneDrive, Dropbox, Box, pCloud, MEGA, S3 and compatible stores and
// about seventy more. rclone runs only while it is needed, answers only on
// 127.0.0.1 with a password made fresh each time, and keeps its settings
// (sign-in tokens included) in an encrypted file.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { normalizeRemote, onServer } from '../../../core/remote/paths';
import type { Connection, Quota, RemoteEntry, RemoteFs } from '../../../core/remote/types';
import { rcloneBinary } from '../../../core/component-paths';

export interface RcloneEnv {
  /** the rclone program */
  binary: string;
  /** the settings file */
  config: string;
  /** rclone's own cache (thumbnails of listings, chunked uploads) */
  cacheDir: string;
  /** the password that encrypts the settings file */
  configPass?: string;
  /** started with lower priority, and told when rclone starts or stops */
  onSpawn?: (child: ChildProcess) => void;
}

/** Where the rclone program is: bundled with Keeper, a development copy, or one installed on the system. */
export function findRclone(opts: { resourcesPath?: string; appPath?: string; env?: NodeJS.ProcessEnv } = {}): string | null {
  const exe = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
  const env = opts.env ?? process.env;
  const candidates = [
    env.KEEPER_RCLONE,
    // Inside the app (offline installer) or downloaded as a component (core/component-paths.ts).
    rcloneBinary(),
    opts.resourcesPath && path.join(opts.resourcesPath, 'rclone', exe),
    opts.appPath && path.join(opts.appPath, 'vendor', 'rclone', 'current', exe),
  ].filter((p): p is string => !!p);
  for (const c of candidates) if (existsSync(c)) return c;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    const p = dir && path.join(dir, exe);
    if (p && existsSync(p)) return p;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export class RcError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Talks to a running `rclone rcd`. */
export class RcClient {
  constructor(public readonly base: string, private user: string, private pass: string) {}

  get authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64');
  }

  call<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    const body = JSON.stringify(params);
    const u = new URL(`${this.base}/${method}`);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: timeoutMs, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: this.authHeader } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            /* not JSON */
          }
          if ((res.statusCode ?? 500) >= 400) reject(new RcError(res.statusCode ?? 500, String(json.error ?? text ?? `rclone answered ${res.statusCode}`)));
          else resolve(json as T);
        });
      });
      req.on('timeout', () => req.destroy(new Error('rclone did not answer in time')));
      req.on('error', reject);
      req.end(body);
    });
  }

  /** A file's bytes, served by rclone itself ([name:]/path), with an optional byte range. */
  get(fs: string, remote: string, range?: { start?: number; end?: number }): Promise<http.IncomingMessage> {
    const u = new URL(this.base);
    const p = `/[${fs}]/` + remote.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { authorization: this.authHeader };
      if (range) headers.range = `bytes=${range.start ?? 0}-${range.end !== undefined ? range.end - 1 : ''}`;
      const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET', headers }, (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          res.resume();
          reject(new RcError(res.statusCode ?? 500, `rclone answered ${res.statusCode}`));
        } else resolve(res);
      });
      req.on('error', reject);
      req.end();
    });
  }
}

/** Starts rclone when asked and stops it after a while without use. */
export class RcloneDaemon {
  private child: ChildProcess | null = null;
  private client: RcClient | null = null;
  private starting: Promise<RcClient> | null = null;
  private lastUse = 0;
  private busy = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private env: RcloneEnv, private idleMs = 10 * 60_000) {}

  get running(): boolean {
    return !!this.child;
  }

  /** The rc client, starting rclone first when it is not running. */
  async rc(): Promise<RcClient> {
    this.lastUse = Date.now();
    if (this.client && this.child) return this.client;
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  /** Marks long work (a transfer) so rclone is not stopped in the middle of it. */
  hold(): () => void {
    this.busy++;
    return () => {
      this.busy = Math.max(0, this.busy - 1);
      this.lastUse = Date.now();
    };
  }

  private baseEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...(this.env.configPass ? { RCLONE_CONFIG_PASS: this.env.configPass } : {}), RCLONE_ASK_PASSWORD: 'false' };
  }

  private async start(): Promise<RcClient> {
    await fsp.mkdir(path.dirname(this.env.config), { recursive: true });
    await fsp.mkdir(this.env.cacheDir, { recursive: true });
    await this.ensureEncrypted();
    const port = await freePort();
    const user = 'keeper';
    const pass = randomBytes(18).toString('base64url');
    const child = spawn(this.env.binary, [
      'rcd', `--rc-addr=127.0.0.1:${port}`, `--rc-user=${user}`, `--rc-pass=${pass}`, '--rc-serve',
      `--config=${this.env.config}`, `--cache-dir=${this.env.cacheDir}`, '--log-level=ERROR', '--use-mmap',
    ], { env: this.baseEnv(), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    this.env.onSpawn?.(child);
    child.once('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.client = null;
      }
    });
    const client = new RcClient(`http://127.0.0.1:${port}`, user, pass);
    // Wait until it answers.
    const until = Date.now() + 15_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`rclone stopped: ${stderr.trim().split('\n').pop() ?? 'unknown error'}`);
      try {
        await client.call('rc/noop', {}, 2000);
        break;
      } catch {
        if (Date.now() > until) {
          child.kill();
          throw new Error('rclone did not start');
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    this.child = child;
    this.client = client;
    this.timer ??= setInterval(() => this.maybeStop(), 60_000);
    this.timer.unref?.();
    return client;
  }

  /**
   * The first time, the settings file is created encrypted, so sign-in tokens
   * are never written in plain text. rclone asks a "password command" for the
   * new password; Keeper's own runtime prints it from the environment.
   */
  private async ensureEncrypted(): Promise<void> {
    if (!this.env.configPass) return;
    try {
      const head = await fsp.readFile(this.env.config, 'utf8');
      if (head.startsWith('# Encrypted rclone configuration')) return;
      if (head.trim()) return; // an existing plain file stays readable; it is encrypted on the next "encryption set"
    } catch {
      /* no file yet */
    }
    await fsp.writeFile(this.env.config, '', { mode: 0o600 });
    const cmd = `"${process.execPath}" -e "process.stdout.write(process.env.KEEPER_RCLONE_PASS||'')"`;
    await new Promise<void>((resolve) => {
      const c = spawn(this.env.binary, ['config', 'encryption', 'set', `--config=${this.env.config}`, `--password-command=${cmd}`], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KEEPER_RCLONE_PASS: this.env.configPass, RCLONE_PASSWORD_CHANGE: '1' },
        stdio: 'ignore',
        windowsHide: true,
      });
      c.once('exit', () => resolve());
      c.once('error', () => resolve());
    });
  }

  private maybeStop() {
    if (!this.child || this.busy > 0) return;
    if (Date.now() - this.lastUse < this.idleMs) return;
    void this.stop();
  }

  async stop(): Promise<void> {
    const c = this.client;
    const child = this.child;
    this.client = null;
    this.child = null;
    if (!child) return;
    try {
      await c?.call('core/quit', {}, 2000);
    } catch {
      /* already gone */
    }
    setTimeout(() => child.exitCode === null && child.kill(), 2000).unref?.();
  }

  /**
   * Signs in to a provider in the browser (rclone opens it) and returns the
   * token rclone prints, to be stored with the connection.
   */
  authorize(provider: string, clientId?: string, clientSecret?: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['authorize', provider, ...(clientId ? [clientId, clientSecret ?? ''] : []), `--config=${this.env.config}`];
      const c = spawn(this.env.binary, args, { env: this.baseEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      c.stdout?.on('data', (d) => (out += d));
      c.stderr?.on('data', (d) => (out += d));
      signal?.addEventListener('abort', () => c.kill());
      c.once('error', reject);
      c.once('exit', (code) => {
        const token = parseAuthorizeOutput(out);
        if (token) resolve(token);
        else reject(new Error(signal?.aborted ? 'Sign-in cancelled' : `Sign-in did not finish${code ? ` (${out.trim().split('\n').pop()})` : ''}`));
      });
    });
  }
}

/** rclone authorize prints the token between "--->" and "<---End paste". */
export function parseAuthorizeOutput(out: string): string | null {
  const m = out.match(/--->\s*([\s\S]*?)\s*<---End paste/);
  const token = m?.[1]?.trim();
  if (!token) return null;
  try {
    JSON.parse(token);
    return token;
  } catch {
    // Newer versions may print a base64 config blob instead of JSON; pass it through.
    return /^[A-Za-z0-9+/=_-]{20,}$/.test(token) ? token : null;
  }
}

interface RcItem {
  Path: string;
  Name: string;
  Size: number;
  MimeType?: string;
  ModTime?: string;
  IsDir: boolean;
}

/** One rclone remote ("gdrive:") as a Keeper file system. */
export class RcloneFs implements RemoteFs {
  constructor(private daemon: RcloneDaemon, private conn: Connection, private remoteName: string) {}

  private get fsName(): string {
    return `${this.remoteName}:`;
  }

  /** rclone wants paths without the leading slash. */
  private at(p: string): string {
    return onServer(this.conn.root, p).replace(/^\/+/, '');
  }

  private entry(dir: string, i: RcItem): RemoteEntry {
    const p = normalizeRemote(`${dir}/${i.Name}`);
    return { name: i.Name, path: p, isDir: i.IsDir, size: i.IsDir ? 0 : Math.max(0, i.Size), mtime: i.ModTime ? Date.parse(i.ModTime) || 0 : 0, mime: i.MimeType };
  }

  async list(dir: string): Promise<RemoteEntry[]> {
    const d = normalizeRemote(dir);
    const r = await (await this.daemon.rc()).call<{ list: RcItem[] }>('operations/list', { fs: this.fsName, remote: this.at(d), opt: { noModTime: false } });
    return (r.list ?? []).map((i) => this.entry(d, i));
  }

  async stat(p: string): Promise<RemoteEntry | null> {
    const n = normalizeRemote(p);
    if (n === '/') return { name: '', path: '/', isDir: true, size: 0, mtime: 0 };
    try {
      const r = await (await this.daemon.rc()).call<{ item: RcItem | null }>('operations/stat', { fs: this.fsName, remote: this.at(n) });
      return r.item ? this.entry(n.slice(0, n.lastIndexOf('/')) || '/', r.item) : null;
    } catch {
      return null;
    }
  }

  async read(p: string, opts: { start?: number; end?: number } = {}): Promise<NodeJS.ReadableStream> {
    const range = opts.start !== undefined || opts.end !== undefined ? { start: opts.start, end: opts.end } : undefined;
    return (await this.daemon.rc()).get(this.fsName, this.at(p), range);
  }

  async write(p: string, data: NodeJS.ReadableStream): Promise<void> {
    // rclone copies from a local file best (it resumes and chunks large uploads itself).
    const tmp = path.join(os.tmpdir(), `keeper-up-${randomBytes(6).toString('hex')}`);
    const { createWriteStream } = await import('node:fs');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp);
      out.on('close', () => resolve());
      out.on('error', reject);
      data.on('error', reject);
      data.pipe(out);
    });
    try {
      await this.copyFromLocal(tmp, p);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  }

  /** Uploads a local file; progress comes from rclone's transfer statistics. */
  async copyFromLocal(local: string, p: string, onProgress?: (bytes: number, total: number) => void): Promise<void> {
    await this.job('operations/copyfile', { srcFs: path.dirname(local), srcRemote: path.basename(local), dstFs: this.fsName, dstRemote: this.at(p) }, onProgress);
  }

  /** Downloads to a local file. */
  async copyToLocal(p: string, local: string, onProgress?: (bytes: number, total: number) => void): Promise<void> {
    await this.job('operations/copyfile', { srcFs: this.fsName, srcRemote: this.at(p), dstFs: path.dirname(local), dstRemote: path.basename(local) }, onProgress);
  }

  /** A folder kept on this computer: copies what is new or changed, never deletes local files. */
  async copyFolderToLocal(p: string, local: string, onProgress?: (bytes: number, total: number) => void): Promise<void> {
    await this.job('sync/copy', { srcFs: `${this.fsName}${this.at(p)}`, dstFs: local, createEmptySrcDirs: true }, onProgress);
  }

  private async job(method: string, params: Record<string, unknown>, onProgress?: (bytes: number, total: number) => void): Promise<void> {
    const release = this.daemon.hold();
    try {
      const rc = await this.daemon.rc();
      const { jobid } = await rc.call<{ jobid: number }>(method, { ...params, _async: true });
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await rc.call<{ finished: boolean; success: boolean; error?: string }>('job/status', { jobid });
        if (onProgress) {
          const s = await rc.call<{ bytes?: number; totalBytes?: number }>('core/stats', { group: `job/${jobid}` }).catch(() => ({}) as { bytes?: number; totalBytes?: number });
          onProgress(s.bytes ?? 0, s.totalBytes ?? 0);
        }
        if (st.finished) {
          if (!st.success) throw new Error(st.error || 'The transfer failed');
          return;
        }
      }
    } finally {
      release();
    }
  }

  async mkdir(p: string): Promise<void> {
    await (await this.daemon.rc()).call('operations/mkdir', { fs: this.fsName, remote: this.at(p) });
  }

  async rename(from: string, to: string): Promise<void> {
    const rc = await this.daemon.rc();
    const it = await this.stat(from);
    if (it?.isDir) await this.job('sync/move', { srcFs: `${this.fsName}${this.at(from)}`, dstFs: `${this.fsName}${this.at(to)}`, deleteEmptySrcDirs: true });
    else await rc.call('operations/movefile', { srcFs: this.fsName, srcRemote: this.at(from), dstFs: this.fsName, dstRemote: this.at(to) });
  }

  async remove(p: string, isDir: boolean): Promise<void> {
    // Providers with a trash (Google Drive, OneDrive, Dropbox…) keep it there by rclone's defaults.
    await (await this.daemon.rc()).call(isDir ? 'operations/purge' : 'operations/deletefile', { fs: this.fsName, remote: this.at(p) }, 10 * 60_000);
  }

  async quota(): Promise<Quota | undefined> {
    try {
      const r = await (await this.daemon.rc()).call<Quota>('operations/about', { fs: this.fsName }, 20_000);
      return { total: r.total, used: r.used, free: r.free, trashed: r.trashed };
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    /* the daemon is shared */
  }
}

/** rclone remote names allow letters, digits, _ - . and space; Keeper uses its connection id. */
export function remoteNameFor(id: string): string {
  return `keeper-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
}
