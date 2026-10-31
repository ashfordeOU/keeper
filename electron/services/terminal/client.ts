// SPDX-License-Identifier: AGPL-3.0-or-later
// Talks to the terminal session host over its local socket. No Electron imports,
// so tests can run it against a host in the same process.

import { promises as fsp } from 'node:fs';
import net from 'node:net';
import { encode, LineDecoder, type ClientMsg, type HostMsg } from '../../../core/terminal/protocol';
import type { SessionInfo } from '../../../core/terminal/types';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class HostClient {
  private sock?: net.Socket;
  private rid = 0;
  private pending = new Map<number, Pending>();
  onMessage: (m: HostMsg) => void = () => undefined;
  onClose: () => void = () => undefined;
  hostPid?: number;
  sessions: SessionInfo[] = [];

  constructor(private socketPath: string, private tokenFile: string, private name = 'app') {}

  get connected() {
    return !!this.sock && !this.sock.destroyed;
  }

  /** Connects and says hello; rejects when nothing is listening or the token is refused. */
  async connect(timeoutMs = 3000): Promise<void> {
    const token = (await fsp.readFile(this.tokenFile, 'utf8')).trim();
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect(this.socketPath);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error('The terminal host did not answer'));
      }, timeoutMs);
      sock.setEncoding('utf8');
      const dec = new LineDecoder<HostMsg>((m) => {
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.hostPid = m.pid;
          this.sessions = m.sessions;
          resolve();
        }
        this.dispatch(m);
      });
      sock.on('data', (d) => dec.push(d));
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on('close', () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('The terminal host went away'));
        }
        this.pending.clear();
        if (this.sock === sock) this.sock = undefined;
        this.onClose();
      });
      sock.once('connect', () => sock.write(encode({ t: 'hello', token, client: this.name })));
      this.sock = sock;
    });
  }

  private dispatch(m: HostMsg) {
    if (m.t === 'reply') {
      const p = this.pending.get(m.rid);
      if (!p) return;
      this.pending.delete(m.rid);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data);
      else p.reject(new Error(m.error ?? 'The terminal host refused'));
      return;
    }
    if (m.t === 'sessions') this.sessions = m.sessions;
    this.onMessage(m);
  }

  /** Sends a message that expects a reply. */
  request<T>(m: Record<string, unknown> & { t: string }, timeoutMs = 10_000): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('Not connected to the terminal host'));
    const rid = ++this.rid;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('The terminal host took too long'));
      }, timeoutMs);
      this.pending.set(rid, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.sock!.write(encode({ ...m, rid } as unknown as ClientMsg));
    });
  }

  /** Sends a message with no reply (typing, resizing). */
  post(m: ClientMsg) {
    if (this.connected) this.sock!.write(encode(m));
  }

  close() {
    this.sock?.end();
    this.sock = undefined;
  }
}
