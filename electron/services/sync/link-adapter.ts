// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sync over Keeper Link: each sync channel is one Link stream (end-to-end
// encrypted, on whatever path Link chose), carrying length-prefixed messages.
// Only devices whose Link permissions include "sync" can open one.

import type { PeerChannel, PeerInfo, PeerTransport } from '../../../core/sync/ports';

/** The parts of a Link stream sync uses. */
interface LinkStream {
  meta: Record<string, unknown>;
  write(data: Uint8Array): Promise<void>;
  end(trailer?: unknown): void;
  reset(reason?: string): void;
  start(): void;
  ondata?: (chunk: Uint8Array) => void | Promise<void>;
  onend?: (trailer: unknown) => void;
  onreset?: (reason: string) => void;
}

/** The parts of Keeper Link's node sync uses. */
export interface LinkLike {
  readonly id: string;
  state(): { devices: { id: string; name: string; online: boolean; via?: string; permissions?: Record<string, boolean | undefined> }[] };
  connect(device: string): Promise<{ open(meta: Record<string, unknown>): LinkStream }>;
  registerStream(kind: string, perm: 'sync', fn: (st: LinkStream, device: string) => void): void;
}

/** Turns a byte stream into a message channel (4-byte length before each message). */
function channelOver(st: LinkStream): PeerChannel {
  const frames = new Set<(f: Uint8Array) => void>();
  const closes = new Set<() => void>();
  let closed = false;
  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  // Writes go out in order even though write() is asynchronous.
  let chain: Promise<void> = Promise.resolve();
  const shut = () => {
    if (closed) return;
    closed = true;
    for (const f of closes) f();
  };
  st.ondata = (chunk) => {
    buf = buf.length ? Buffer.concat([buf, Buffer.from(chunk)]) : Buffer.from(chunk);
    while (buf.length >= 4) {
      const n = buf.readUInt32BE(0);
      if (buf.length < 4 + n) break;
      const msg = buf.subarray(4, 4 + n);
      buf = buf.subarray(4 + n);
      for (const f of frames) f(msg);
    }
  };
  st.onend = () => shut();
  st.onreset = () => shut();
  st.start();
  return {
    send(frame) {
      if (closed) throw new Error('channel closed');
      const head = Buffer.alloc(4);
      head.writeUInt32BE(frame.length, 0);
      const msg = Buffer.concat([head, Buffer.from(frame)]);
      chain = chain.then(() => st.write(msg)).catch(() => shut());
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
      if (closed) return;
      void chain.then(() => st.end());
      shut();
    },
  };
}

export function linkTransport(link: LinkLike, onChanged?: (fn: () => void) => () => void): PeerTransport {
  const handlers = new Map<string, (peer: string, ch: PeerChannel) => void>();
  link.registerStream('sync', 'sync', (st, device) => {
    const h = handlers.get(String(st.meta.purpose ?? ''));
    if (!h) return st.reset('unknown purpose');
    h(device, channelOver(st));
  });
  return {
    selfId: link.id,
    listPeers(): PeerInfo[] {
      return link.state().devices.map((d) => ({ id: d.id, name: d.name, online: d.online && d.permissions?.sync !== false, via: d.via }));
    },
    async open(peerId, purpose) {
      const mux = await link.connect(peerId);
      return channelOver(mux.open({ k: 'sync', purpose }));
    },
    onIncoming(purpose, fn) {
      handlers.set(purpose, fn);
      return () => void handlers.delete(purpose);
    },
    // Link has no "devices changed" event: a light look every few seconds notices devices coming online.
    onPeersChanged: onChanged ?? ((fn) => {
      let last = '';
      const h = setInterval(() => {
        const now = link.state().devices.filter((d) => d.online).map((d) => d.id).sort().join();
        if (now !== last) {
          last = now;
          fn();
        }
      }, 5000);
      h.unref?.();
      return () => clearInterval(h);
    }),
  };
}
