// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The local channel between Keeper's processes: a Unix socket (a named pipe on
// Windows) that only this person can open, plus a token that changes every time
// Keeper starts and is kept in a file only this person can read. Messages are
// length-prefixed and v8-serialized (core/suite.ts).

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { frame, splitFrames, type PartRole, type SuiteMessage } from '../../core/suite';

/** Where the channel's files live: <userData>/suite (only this person can read it). */
export function suiteDir(userData: string) {
  return path.join(userData, 'suite');
}

/** A socket path short enough for Unix (about 100 bytes), or a pipe name on Windows. */
export function socketPath(userData: string, name: string, platform = process.platform): string {
  const key = crypto.createHash('sha256').update(userData).digest('hex').slice(0, 12);
  if (platform === 'win32') return `\\\\.\\pipe\\keeper-${key}-${name}`;
  const inDir = path.join(suiteDir(userData), `${name}.sock`);
  return inDir.length < 100 ? inDir : path.join(os.tmpdir(), `keeper-${key}-${name}.sock`);
}

/** What a part needs to reach the app: written by the app when it listens. */
export interface CoreInfo { pid: number; socket: string; token: string; version: string }

export const coreInfoFile = (userData: string) => path.join(suiteDir(userData), 'core.json');

export function readCoreInfo(userData: string): CoreInfo | null {
  try {
    const r = JSON.parse(fs.readFileSync(coreInfoFile(userData), 'utf8')) as CoreInfo;
    return r && typeof r.socket === 'string' && typeof r.token === 'string' ? r : null;
  } catch {
    return null;
  }
}

export function writeCoreInfo(userData: string, info: CoreInfo) {
  const dir = suiteDir(userData);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* not ours to change */ }
  const tmp = `${coreInfoFile(userData)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  fs.renameSync(tmp, coreInfoFile(userData));
}

export function clearCoreInfo(userData: string) {
  try {
    const r = readCoreInfo(userData);
    if (r?.pid === process.pid) fs.rmSync(coreInfoFile(userData), { force: true });
  } catch { /* gone */ }
}

const encode = (m: SuiteMessage) => frame(v8.serialize(m));

/** One connection: framed messages in and out. */
export class Peer {
  private buf: Uint8Array = new Uint8Array(0);
  private onMsg: (m: SuiteMessage) => void = () => undefined;
  private closed = false;
  readonly closedP: Promise<void>;
  private resolveClosed!: () => void;

  constructor(readonly sock: net.Socket) {
    this.closedP = new Promise((r) => (this.resolveClosed = r));
    sock.on('data', (d: Buffer) => this.data(d));
    sock.on('close', () => this.close());
    sock.on('error', () => this.close());
  }

  onMessage(fn: (m: SuiteMessage) => void) {
    this.onMsg = fn;
  }

  private data(d: Buffer) {
    const joined = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let parts: ReturnType<typeof splitFrames>;
    try {
      parts = splitFrames(joined);
    } catch {
      this.close();
      return;
    }
    this.buf = parts.rest.length ? Buffer.from(parts.rest) : new Uint8Array(0);
    for (const f of parts.frames) {
      let m: SuiteMessage;
      try {
        m = v8.deserialize(f) as SuiteMessage;
      } catch {
        this.close();
        return;
      }
      try { this.onMsg(m); } catch (e) { console.error('[suite] message handler failed', e); }
    }
  }

  send(m: SuiteMessage): boolean {
    if (this.closed) return false;
    let bytes: Uint8Array;
    try {
      bytes = encode(m);
    } catch (e) {
      // Something that cannot cross between processes (a function, a window): the call fails, not the channel.
      if (m.t === 'result' && m.ok) return this.send({ t: 'result', id: m.id, ok: false, error: `the answer could not be sent between Keeper's processes: ${(e as Error).message}` });
      console.error('[suite] could not send', m.t, (e as Error).message);
      return false;
    }
    return this.sock.write(bytes);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.sock.destroy();
    this.resolveClosed();
  }

  get isClosed() {
    return this.closed;
  }
}

/** Listens on `socket` (removing a stale socket file left by a crash first). */
export function listen(socket: string, onPeer: (p: Peer) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
      try { fs.unlinkSync(socket); } catch { /* none left over */ }
    }
    const server = net.createServer((s) => onPeer(new Peer(s)));
    server.once('error', reject);
    server.listen(socket, () => {
      server.off('error', reject);
      server.on('error', (e) => console.error('[suite] channel', e.message));
      if (process.platform !== 'win32') try { fs.chmodSync(socket, 0o600); } catch { /* best effort */ }
      resolve(server);
    });
  });
}

export function connect(socket: string, timeoutMs = 3000): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    const t = setTimeout(() => { s.destroy(); reject(new Error('timed out')); }, timeoutMs);
    s.once('connect', () => { clearTimeout(t); resolve(new Peer(s)); });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * One copy of each part: whoever listens on the part's own socket holds the lock.
 * A socket file nobody answers on is left over from a crash, and is taken over.
 */
export async function takeRoleLock(userData: string, role: PartRole): Promise<net.Server | null> {
  const sock = socketPath(userData, `part-${role}`);
  try {
    const server = await new Promise<net.Server>((resolve, reject) => {
      const s = net.createServer((c) => c.end());
      s.once('error', reject);
      if (process.platform !== 'win32') fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
      s.listen(sock, () => resolve(s));
    });
    return server;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') return null;
  }
  if (await roleRunning(userData, role)) return null;
  // Left over from a crash: nobody answers.
  if (process.platform !== 'win32') try { fs.unlinkSync(sock); } catch { /* raced */ }
  return new Promise((resolve) => {
    const s = net.createServer((c) => c.end());
    s.once('error', () => resolve(null));
    s.listen(sock, () => resolve(s));
  });
}

/** Is a copy of this part running (it answers on its own socket)? */
export function roleRunning(userData: string, role: PartRole): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socketPath(userData, `part-${role}`));
    const t = setTimeout(() => { c.destroy(); resolve(false); }, 1500);
    c.once('connect', () => { clearTimeout(t); c.destroy(); resolve(true); });
    c.once('error', () => { clearTimeout(t); resolve(false); });
  });
}

export const newToken = () => crypto.randomBytes(32).toString('hex');
