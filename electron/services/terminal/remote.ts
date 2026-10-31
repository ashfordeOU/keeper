// SPDX-License-Identifier: AGPL-3.0-or-later
// The file panel beside a terminal: browse, download, upload, rename and delete
// on an SSH host (SFTP) or an FTP/FTPS server. SSH uses the running agent or
// the key from ~/.ssh/config; passwords come from the system keychain only.

import { createWriteStream, existsSync, promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveHost } from '../../../core/terminal/sshconfig';
import type { RemoteEntry, SshHost } from '../../../core/terminal/types';

export interface RemoteTarget {
  /** 'sftp' | 'ftp' | 'ftps' */
  protocol: 'sftp' | 'ftp' | 'ftps';
  /** an SSH alias, user@host:port or host */
  target: string;
  password?: string;
  /** skip certificate checks for FTPS on a home server with a self-made certificate */
  insecure?: boolean;
}

interface Conn {
  kind: 'sftp' | 'ftp';
  list(dir: string): Promise<RemoteEntry[]>;
  download(remote: string, local: string): Promise<void>;
  upload(local: string, remote: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  remove(p: string, isDir: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  home(): Promise<string>;
  close(): void;
}

const conns = new Map<string, { conn: Conn; used: number }>();
let reaper: NodeJS.Timeout | undefined;

const keyOf = (t: RemoteTarget) => `${t.protocol}://${t.target}`;

/** Connections close after five quiet minutes. */
function startReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [k, c] of conns) if (now - c.used > 5 * 60_000) {
      c.conn.close();
      conns.delete(k);
    }
    if (!conns.size) {
      clearInterval(reaper);
      reaper = undefined;
    }
  }, 60_000);
  reaper.unref();
}

async function sftpConnect(t: RemoteTarget, known: SshHost[]): Promise<Conn> {
  const { Client } = await import('ssh2');
  const r = resolveHost(t.target, known);
  const client = new Client();
  const keyFiles = [r.identityFile, ...['id_ed25519', 'id_ecdsa', 'id_rsa'].map((k) => path.join(os.homedir(), '.ssh', k))].filter((f): f is string => !!f && existsSync(f));
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', reject);
    client.connect({
      host: r.host,
      port: r.port,
      username: r.user ?? os.userInfo().username,
      agent: process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK,
      privateKey: !t.password && keyFiles[0] ? readFileSync(keyFiles[0]) : undefined,
      password: t.password,
      readyTimeout: 15_000,
      tryKeyboard: !!t.password,
    });
    client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => t.password ?? '')));
  });
  const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => client.sftp((e, s) => (e ? reject(e) : resolve(s))));
  const p = <T>(fn: (cb: (e: Error | null | undefined, v?: T) => void) => void) => new Promise<T>((res, rej) => fn((e, v) => (e ? rej(e) : res(v as T))));
  return {
    kind: 'sftp',
    async list(dir) {
      const items = await p<import('ssh2').FileEntryWithStats[]>((cb) => sftp.readdir(dir, cb));
      return items.map((i) => ({
        name: i.filename,
        path: path.posix.join(dir, i.filename),
        isDir: (i.attrs.mode & 0o170000) === 0o040000,
        link: (i.attrs.mode & 0o170000) === 0o120000,
        size: i.attrs.size,
        mtime: i.attrs.mtime * 1000,
      }));
    },
    download: (remote, local) => p((cb) => sftp.fastGet(remote, local, (e) => cb(e))),
    upload: (local, remote) => p((cb) => sftp.fastPut(local, remote, (e) => cb(e))),
    mkdir: (dir) => p((cb) => sftp.mkdir(dir, (e) => cb(e))),
    remove: (f, isDir) => p((cb) => (isDir ? sftp.rmdir(f, (e) => cb(e)) : sftp.unlink(f, (e) => cb(e)))),
    rename: (a, b) => p((cb) => sftp.rename(a, b, (e) => cb(e))),
    home: () => p<string>((cb) => sftp.realpath('.', cb)),
    close: () => client.end(),
  };
}

async function ftpConnect(t: RemoteTarget): Promise<Conn> {
  const { Client } = await import('basic-ftp');
  const c = new Client(20_000);
  const r = resolveHost(t.target, []);
  await c.access({
    host: r.host,
    port: r.port === 22 ? 21 : r.port,
    user: r.user ?? 'anonymous',
    password: t.password ?? (r.user ? '' : 'anonymous@'),
    secure: t.protocol === 'ftps',
    secureOptions: t.insecure ? { rejectUnauthorized: false } : undefined,
  });
  // FTP connections do one thing at a time; requests queue behind each other.
  let queue: Promise<unknown> = Promise.resolve();
  const one = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    kind: 'ftp',
    list: (dir) => one(async () => (await c.list(dir)).map((i) => ({ name: i.name, path: path.posix.join(dir, i.name), isDir: i.isDirectory, link: i.isSymbolicLink, size: i.size, mtime: i.modifiedAt?.getTime() ?? 0 }))),
    download: (remote, local) => one(async () => void (await c.downloadTo(createWriteStream(local), remote))),
    upload: (local, remote) => one(async () => void (await c.uploadFrom(local, remote))),
    mkdir: (dir) => one(async () => {
      const here = await c.pwd();
      await c.ensureDir(dir);
      await c.cd(here);
    }),
    remove: (f, isDir) => one(() => (isDir ? c.removeDir(f) : c.remove(f).then(() => undefined))),
    rename: (a, b) => one(() => c.rename(a, b).then(() => undefined)),
    home: () => one(() => c.pwd()),
    close: () => c.close(),
  };
}

async function conn(t: RemoteTarget, known: SshHost[]): Promise<Conn> {
  const k = keyOf(t);
  const hit = conns.get(k);
  if (hit) {
    hit.used = Date.now();
    return hit.conn;
  }
  const c = t.protocol === 'sftp' ? await sftpConnect(t, known) : await ftpConnect(t);
  conns.set(k, { conn: c, used: Date.now() });
  startReaper();
  return c;
}

export const remote = {
  async list(t: RemoteTarget, known: SshHost[], dir?: string): Promise<{ dir: string; entries: RemoteEntry[] }> {
    const c = await conn(t, known);
    const d = dir || (await c.home());
    const entries = (await c.list(d)).filter((e) => e.name !== '.' && e.name !== '..').sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return { dir: d, entries };
  },
  async download(t: RemoteTarget, known: SshHost[], files: string[], toDir: string): Promise<string[]> {
    const c = await conn(t, known);
    const out: string[] = [];
    for (const f of files) {
      let dest = path.join(toDir, path.posix.basename(f));
      for (let i = 2; existsSync(dest); i++) dest = path.join(toDir, `${path.parse(path.posix.basename(f)).name} ${i}${path.extname(f)}`);
      await c.download(f, dest);
      out.push(dest);
    }
    return out;
  },
  async upload(t: RemoteTarget, known: SshHost[], files: string[], toDir: string): Promise<number> {
    const c = await conn(t, known);
    let n = 0;
    for (const f of files) {
      if ((await fsp.stat(f)).isDirectory()) continue;
      await c.upload(f, path.posix.join(toDir, path.basename(f)));
      n++;
    }
    return n;
  },
  async mkdir(t: RemoteTarget, known: SshHost[], dir: string) {
    await (await conn(t, known)).mkdir(dir);
  },
  async remove(t: RemoteTarget, known: SshHost[], p: string, isDir: boolean) {
    await (await conn(t, known)).remove(p, isDir);
  },
  async rename(t: RemoteTarget, known: SshHost[], from: string, to: string) {
    await (await conn(t, known)).rename(from, to);
  },
  disconnect(t: RemoteTarget) {
    conns.get(keyOf(t))?.conn.close();
    conns.delete(keyOf(t));
  },
  closeAll() {
    for (const c of conns.values()) c.conn.close();
    conns.clear();
  },
};
