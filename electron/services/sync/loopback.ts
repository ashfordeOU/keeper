// SPDX-License-Identifier: AGPL-3.0-or-later
// A plain TCP connection between Keeper instances on one computer, for tests
// and development only (no encryption, no pairing). It is used only when
// KEEPER_SYNC_LOOPBACK is set, e.g. "self=A@47001;peer=B@47002".

import net from 'node:net';
import type { PeerChannel, PeerInfo, PeerTransport } from '../../../core/sync/ports';

export function loopbackFromEnv(env = process.env): PeerTransport | null {
  const spec = env.KEEPER_SYNC_LOOPBACK;
  if (!spec) return null;
  const parts = Object.fromEntries(spec.split(';').map((p) => p.split('=') as [string, string]));
  const [selfId, selfPort] = (parts.self ?? '').split('@');
  const peers = (parts.peer ?? '').split(',').filter(Boolean).map((p) => {
    const [id, port] = p.split('@');
    return { id, port: Number(port) };
  });
  if (!selfId || !selfPort) return null;
  return new LoopbackTransport(selfId, Number(selfPort), peers);
}

function channelOver(sock: net.Socket): PeerChannel {
  const frames = new Set<(f: Uint8Array) => void>();
  const closes = new Set<() => void>();
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let closed = false;
  sock.on('data', (c: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, c]) : c;
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (buf.length < 4 + n) break;
      const msg = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      for (const f of frames) f(msg);
    }
  });
  const shut = () => {
    if (closed) return;
    closed = true;
    for (const f of closes) f();
  };
  sock.on('close', shut);
  sock.on('error', shut);
  return {
    send(frame) {
      if (closed) throw new Error('channel closed');
      const head = Buffer.alloc(4);
      head.writeUInt32BE(frame.length, 0);
      sock.write(Buffer.concat([head, Buffer.from(frame)]));
    },
    onFrame(fn) {
      frames.add(fn);
      return () => void frames.delete(fn);
    },
    onClose(fn) {
      closes.add(fn);
      return () => void closes.delete(fn);
    },
    close() {
      sock.end();
      shut();
    },
  };
}

class LoopbackTransport implements PeerTransport {
  private handlers = new Map<string, (peer: string, ch: PeerChannel) => void>();
  private up = new Map<string, boolean>();
  private server: net.Server;
  constructor(readonly selfId: string, port: number, private peers: { id: string; port: number }[]) {
    this.server = net.createServer((sock) => {
      // The first message says who is calling and why.
      sock.once('data', (first: Buffer) => {
        const n = first.readUInt32BE(0);
        const hello = JSON.parse(first.subarray(4, 4 + n).toString()) as { from: string; purpose: string };
        const rest = first.subarray(4 + n);
        const ch = channelOver(sock);
        const h = this.handlers.get(hello.purpose);
        if (!h) return sock.destroy();
        h(hello.from, ch);
        if (rest.length) sock.emit('data', rest);
      });
    });
    this.server.listen(port, '127.0.0.1');
    const check = () => {
      for (const p of this.peers) {
        const s = net.connect(p.port, '127.0.0.1');
        s.on('connect', () => { this.up.set(p.id, true); s.destroy(); });
        s.on('error', () => this.up.set(p.id, false));
      }
    };
    check();
    setInterval(check, 2000).unref();
  }
  listPeers(): PeerInfo[] {
    return this.peers.map((p) => ({ id: p.id, name: `Test device ${p.id}`, online: !!this.up.get(p.id), via: 'loopback' }));
  }
  open(peerId: string, purpose: string): Promise<PeerChannel> {
    const p = this.peers.find((x) => x.id === peerId);
    if (!p) return Promise.reject(new Error('unknown device'));
    return new Promise((resolve, reject) => {
      const sock = net.connect(p.port, '127.0.0.1', () => {
        const hello = Buffer.from(JSON.stringify({ from: this.selfId, purpose }));
        const head = Buffer.alloc(4);
        head.writeUInt32BE(hello.length, 0);
        sock.write(Buffer.concat([head, hello]));
        resolve(channelOver(sock));
      });
      sock.once('error', reject);
    });
  }
  onIncoming(purpose: string, fn: (peer: string, ch: PeerChannel) => void) {
    this.handlers.set(purpose, fn);
    return () => void this.handlers.delete(purpose);
  }
}
