// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Requests and answers over a device channel. Each frame is a small JSON header
// followed by optional bytes (a piece of a file).

import type { PeerChannel } from './ports';

interface Header {
  id: number;
  t: 'req' | 'res' | 'err';
  m?: string;
  p?: unknown;
  r?: unknown;
  e?: string;
}

export type RpcHandler = (method: string, params: unknown, body: Buffer) => Promise<{ result?: unknown; body?: Buffer } | undefined>;

export function encodeFrame(h: Header, body?: Uint8Array): Uint8Array {
  const json = Buffer.from(JSON.stringify(h));
  const out = Buffer.alloc(4 + json.length + (body?.length ?? 0));
  out.writeUInt32BE(json.length, 0);
  json.copy(out, 4);
  if (body) out.set(body, 4 + json.length);
  return out;
}

export function decodeFrame(f: Uint8Array): { h: Header; body: Buffer } {
  const b = Buffer.from(f.buffer, f.byteOffset, f.byteLength);
  const n = b.readUInt32BE(0);
  return { h: JSON.parse(b.subarray(4, 4 + n).toString('utf8')) as Header, body: b.subarray(4 + n) };
}

export class Rpc {
  private next = 1;
  private pending = new Map<number, { resolve: (v: { result: unknown; body: Buffer }) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  closed = false;
  constructor(private ch: PeerChannel, private handler?: RpcHandler, private timeoutMs = 120_000) {
    ch.onFrame((f) => void this.onFrame(f));
    ch.onClose(() => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('The other device went away'));
      }
      this.pending.clear();
    });
  }

  call(method: string, params?: unknown): Promise<{ result: unknown; body: Buffer }> {
    if (this.closed) return Promise.reject(new Error('The other device went away'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`No answer to ${method}`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ch.send(encodeFrame({ id, t: 'req', m: method, p: params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close() {
    this.ch.close();
  }

  private async onFrame(f: Uint8Array) {
    let msg: { h: Header; body: Buffer };
    try {
      msg = decodeFrame(f);
    } catch {
      return;
    }
    const { h, body } = msg;
    if (h.t === 'req') {
      try {
        const r = (await this.handler?.(h.m ?? '', h.p, body)) ?? { result: null };
        if (!this.closed) this.ch.send(encodeFrame({ id: h.id, t: 'res', r: r.result ?? null }, r.body));
      } catch (e) {
        if (!this.closed) this.ch.send(encodeFrame({ id: h.id, t: 'err', e: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    const p = this.pending.get(h.id);
    if (!p) return;
    this.pending.delete(h.id);
    clearTimeout(p.timer);
    if (h.t === 'err') p.reject(new Error(h.e ?? 'error'));
    else p.resolve({ result: h.r, body });
  }
}
