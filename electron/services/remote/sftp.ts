// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SFTP: files on Linux machines, Macs with Remote Login, NAS boxes and home
// servers, over SSH. Signs in with a password, a key file or the SSH agent.
// A server's key is remembered the first time and checked every time after.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
// The SSH library loads the first time an SFTP server is opened.
import type { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import type { Connection, Quota, RemoteEntry, RemoteFs } from '../../../core/remote/types';
import { joinRemote, normalizeRemote, onServer } from '../../../core/remote/paths';

export interface HostKeys {
  get(host: string): string | undefined;
  set(host: string, fingerprint: string): void;
}

export class HostKeyChanged extends Error {
  constructor(host: string) {
    super(`The server ${host} is not the one Keeper connected to before (its key changed). If you replaced or reinstalled it, remove the connection and add it again.`);
  }
}

export interface SftpAuth {
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
}

export class SftpFs implements RemoteFs {
  private client!: Client;
  private sftp!: SFTPWrapper;

  private constructor(private conn: Connection) {}

  static async open(conn: Connection, auth: SftpAuth, keys: HostKeys, timeoutMs = 15_000): Promise<SftpFs> {
    const fs = new SftpFs(conn);
    fs.client = new (await import('ssh2')).Client();
    const host = conn.host ?? '';
    const where = `${host}:${conn.port ?? 22}`;
    let changed = false;
    const cfg: ConnectConfig = {
      host,
      port: conn.port ?? 22,
      username: conn.user,
      readyTimeout: timeoutMs,
      keepaliveInterval: 20_000,
      hostVerifier: (key: Buffer) => {
        const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        const known = keys.get(where);
        if (!known) {
          keys.set(where, fp);
          return true;
        }
        if (known === fp) return true;
        changed = true;
        return false;
      },
    };
    if (auth.privateKey) {
      cfg.privateKey = auth.privateKey;
      if (auth.passphrase) cfg.passphrase = auth.passphrase;
    }
    if (auth.password) {
      cfg.password = auth.password;
      // Servers that ask through keyboard-interactive get the same password.
      cfg.tryKeyboard = true;
    }
    if (!auth.password && !auth.privateKey) cfg.agent = process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK;
    await new Promise<void>((resolve, reject) => {
      fs.client
        .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => auth.password ?? '')))
        .once('ready', () => resolve())
        .once('error', (e) => reject(changed ? new HostKeyChanged(where) : e))
        .connect(cfg);
    });
    fs.sftp = await new Promise<SFTPWrapper>((resolve, reject) => fs.client.sftp((e, s) => (e ? reject(e) : resolve(s))));
    return fs;
  }

  private at(p: string): string {
    return onServer(this.conn.root, p);
  }

  list(dir: string): Promise<RemoteEntry[]> {
    const d = normalizeRemote(dir);
    return new Promise((resolve, reject) =>
      this.sftp.readdir(this.at(d), (e, list) => {
        if (e) return reject(e);
        resolve(list.filter((x) => x.filename !== '.' && x.filename !== '..').map((x) => ({
          name: x.filename,
          path: joinRemote(d, x.filename),
          isDir: x.attrs.isDirectory(),
          size: x.attrs.isDirectory() ? 0 : x.attrs.size,
          mtime: x.attrs.mtime * 1000,
        })));
      }));
  }

  stat(p: string): Promise<RemoteEntry | null> {
    const n = normalizeRemote(p);
    return new Promise((resolve) =>
      this.sftp.stat(this.at(n), (e, a) => resolve(e ? null : { name: n.split('/').pop() ?? '', path: n, isDir: a.isDirectory(), size: a.isDirectory() ? 0 : a.size, mtime: a.mtime * 1000 })));
  }

  async read(p: string, opts: { start?: number; end?: number } = {}): Promise<NodeJS.ReadableStream> {
    // ssh2's `end` is inclusive.
    const s = this.sftp.createReadStream(this.at(p), { start: opts.start ?? 0, end: opts.end !== undefined ? opts.end - 1 : undefined });
    // The reader handles errors; this only stops a late one (the connection closing while the file handle closes) from going unheard.
    s.on('error', () => undefined);
    return s;
  }

  write(p: string, data: NodeJS.ReadableStream): Promise<void> {
    return new Promise((resolve, reject) => {
      const out = this.sftp.createWriteStream(this.at(p));
      out.on('close', () => resolve());
      out.on('error', reject);
      data.on('error', reject);
      data.pipe(out);
    });
  }

  mkdir(p: string): Promise<void> {
    return new Promise((resolve, reject) => this.sftp.mkdir(this.at(p), (e) => (e ? reject(e) : resolve())));
  }

  rename(from: string, to: string): Promise<void> {
    return new Promise((resolve, reject) => this.sftp.rename(this.at(from), this.at(to), (e) => (e ? reject(e) : resolve())));
  }

  async remove(p: string, isDir: boolean): Promise<void> {
    if (!isDir) {
      await new Promise<void>((resolve, reject) => this.sftp.unlink(this.at(p), (e) => (e ? reject(e) : resolve())));
      return;
    }
    // SFTP has no trash and no recursive delete: empty the folder first.
    for (const e of await this.list(p)) await this.remove(e.path, e.isDir);
    await new Promise<void>((resolve, reject) => this.sftp.rmdir(this.at(p), (e) => (e ? reject(e) : resolve())));
  }

  quota(): Promise<Quota | undefined> {
    // statvfs@openssh.com, when the server supports it.
    const ext = (this.sftp as unknown as { ext_openssh_statvfs?: (p: string, cb: (e: Error | undefined, s: { bsize: number; frsize: number; blocks: number; bavail: number }) => void) => void }).ext_openssh_statvfs;
    if (!ext) return Promise.resolve(undefined);
    return new Promise((resolve) => ext.call(this.sftp, this.at('/'), (e, s) => {
      if (e || !s) return resolve(undefined);
      const unit = s.frsize || s.bsize;
      resolve({ total: s.blocks * unit, free: s.bavail * unit, used: (s.blocks - s.bavail) * unit });
    }));
  }

  async close(): Promise<void> {
    // Let pending replies (closing file handles) arrive before the connection goes.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 500);
      this.sftp?.once('close', () => { clearTimeout(t); resolve(); });
      try {
        this.sftp?.end();
      } catch {
        resolve();
      }
    });
    this.client.end();
  }
}

export async function readKey(file: string): Promise<Buffer> {
  return fsp.readFile(file);
}
