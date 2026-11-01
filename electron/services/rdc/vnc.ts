// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A VNC session shown in a Keeper tab. The TCP connection lives here in the
// main process; decoded pictures go to the tab that shows it, one update at a
// time: the next update is asked for only after the tab has drawn the last one,
// so a hidden tab (or a slow one) costs nothing and nothing piles up.

import net from 'node:net';
import tls from 'node:tls';
import type { WebContents } from 'electron';
import { createInflater } from '../../../core/rdc/inflate';
import { comboEvents, COMBOS } from '../../../core/rdc/keysym';
import { RfbClient, type RfbEvent } from '../../../core/rdc/rfb';
import type { VncInput } from '../../../core/rdc/api';

export interface VncOpen {
  host: string;
  port: number;
  password?: string;
  username?: string;
  shared?: boolean;
  viewOnly?: boolean;
  onState(state: 'connected' | 'closed' | 'error', info?: { width?: number; height?: number; desktop?: string; error?: string; security?: string }): void;
}

export class VncSession {
  private sock: net.Socket | tls.TLSSocket | null = null;
  private client: RfbClient | null = null;
  private inflater = createInflater();
  private viewer: WebContents | null = null;
  private seq = 0;
  private cursor: Extract<RfbEvent, { t: 'cursor' }> | null = null;
  viewOnly: boolean;
  width = 0;
  height = 0;
  desktop = '';
  security = '';
  private ended = false;

  constructor(public sid: string, private o: VncOpen) {
    this.viewOnly = !!o.viewOnly;
  }

  /** Connects and signs in; resolves once the picture size is known. */
  start(timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (e?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (e) reject(e);
        else resolve();
      };
      const timer = setTimeout(() => { settle(new Error('The VNC server did not answer')); this.close(); }, timeoutMs);
      const sock = net.connect({ host: this.o.host, port: this.o.port });
      sock.setNoDelay(true);
      this.sock = sock;
      const write = (d: Uint8Array) => { if (this.sock && !this.sock.destroyed) this.sock.write(d); };
      const onData = (d: Buffer) => this.client?.feed(new Uint8Array(d.buffer, d.byteOffset, d.length));
      this.client = new RfbClient(write, (e) => this.event(e, settle), {
        password: this.o.password,
        username: this.o.username,
        shared: this.o.shared,
        inflate: this.inflater.inflate,
        startTls: () => new Promise<void>((res, rej) => {
          sock.off('data', onData);
          const t = tls.connect({ socket: sock, rejectUnauthorized: false, servername: net.isIP(this.o.host) ? undefined : this.o.host }, () => res());
          t.once('error', rej);
          t.on('data', onData);
          this.sock = t;
          this.security = 'TLS';
        }),
      });
      sock.on('data', onData);
      sock.once('error', (e) => { this.client?.end(e.message.includes('ECONNREFUSED') ? 'Nothing answers on that port' : e.message); settle(new Error(e.message.includes('ECONNREFUSED') ? `Nothing answers at ${this.o.host}:${this.o.port}` : e.message)); });
      sock.once('close', () => this.client?.end());
      void this.client.run().then(() => this.finish());
    });
  }

  private event(e: RfbEvent, settle: (e?: Error) => void) {
    switch (e.t) {
      case 'security':
        this.security = this.security ? `${this.security}, ${e.name}` : e.name;
        break;
      case 'init':
        this.width = e.width;
        this.height = e.height;
        this.desktop = e.name;
        this.o.onState('connected', { width: e.width, height: e.height, desktop: e.name, security: this.security });
        settle();
        break;
      case 'update':
        if (this.viewer && !this.viewer.isDestroyed()) {
          this.seq++;
          this.viewer.send('event:rdc-frame', { sid: this.sid, seq: this.seq, ops: e.ops });
          // The next update is asked for when the tab says it drew this one (vncAck).
        }
        break;
      case 'resize':
        this.width = e.width;
        this.height = e.height;
        this.send('rdc-vnc', { t: 'resize', width: e.width, height: e.height });
        break;
      case 'cursor':
        this.cursor = e;
        this.send('rdc-vnc', e);
        break;
      case 'clipboard':
        this.send('rdc-vnc', { t: 'clipboard', text: e.text });
        break;
      case 'bell':
        this.send('rdc-vnc', { t: 'bell' });
        break;
      case 'error':
        settle(new Error(e.message));
        this.finish(e.message);
        break;
      case 'closed':
        settle(new Error('The VNC server closed the connection'));
        this.finish();
        break;
    }
  }

  private send(channel: string, payload: unknown) {
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.send(`event:${channel}`, this.sid, payload);
  }

  /** A tab starts showing this session: it gets the whole picture again. */
  attach(wc: WebContents) {
    this.viewer = wc;
    wc.once('destroyed', () => { if (this.viewer === wc) this.viewer = null; });
    if (this.cursor) setTimeout(() => this.send('rdc-vnc', this.cursor), 0);
    this.client?.requestUpdate(false);
  }

  detach(wc?: WebContents) {
    if (!wc || this.viewer === wc) this.viewer = null;
  }

  ack(seq: number) {
    if (seq !== this.seq || !this.viewer) return;
    this.client?.requestUpdate(true);
  }

  input(events: VncInput[]) {
    if (this.viewOnly || !this.client) return;
    for (const e of events) {
      if (e.t === 'key' && typeof e.keysym === 'number' && e.keysym > 0) this.client.key(e.keysym, !!e.down);
      else if (e.t === 'pointer' && typeof e.x === 'number' && typeof e.y === 'number') this.client.pointer(e.x, e.y, e.buttons ?? 0);
    }
  }

  keys(combo: string) {
    const c = COMBOS[combo];
    if (!c || this.viewOnly || !this.client) return;
    for (const k of comboEvents(c.keys)) this.client.key(k.keysym, k.down);
  }

  clipboard(text: string) {
    if (!this.viewOnly) this.client?.clipboard(text);
  }

  private finish(error?: string) {
    if (this.ended) return;
    this.ended = true;
    this.send('rdc-vnc', { t: 'closed', error });
    this.o.onState(error ? 'error' : 'closed', { error });
    this.close();
  }

  close() {
    this.sock?.destroy();
    this.sock = null;
    this.inflater.close();
    if (!this.ended) {
      this.ended = true;
      this.send('rdc-vnc', { t: 'closed' });
      this.o.onState('closed');
    }
  }
}
