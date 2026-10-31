// SPDX-License-Identifier: AGPL-3.0-or-later
// A small WebSocket server (RFC 6455) for Keeper's link endpoint and relay,
// with no dependencies, and a client built on the platform's own WebSocket.
// Both are exposed as a Wire. Binary messages only; text is accepted for the
// relay's small control messages. Node only.

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { CarrierKind, Wire } from './channel';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_MESSAGE = 16 * 1024 * 1024;

export interface WsServerConn extends Wire {
  /** text messages (control) */
  ontext?: (s: string) => void;
  sendText(s: string): void;
  readonly closed: boolean;
}

/** Completes the upgrade of an HTTP request into a WebSocket. Returns null when it is not one. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, kind: CarrierKind, where?: string): WsServerConn | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return wrapSocket(socket, head, kind, where);
}

function wrapSocket(socket: Duplex, head: Buffer, kind: CarrierKind, where?: string): WsServerConn {
  let buf: Buffer = head.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragOp = 0;
  let closed = false;
  const conn: WsServerConn = {
    kind,
    where,
    get closed() {
      return closed;
    },
    send(data) {
      if (!closed) socket.write(frame(2, Buffer.from(data.buffer, data.byteOffset, data.byteLength)));
    },
    sendText(s) {
      if (!closed) socket.write(frame(1, Buffer.from(s)));
    },
    close(reason) {
      if (closed) return;
      const r = Buffer.from(String(reason ?? '').slice(0, 120));
      socket.write(frame(8, Buffer.concat([Buffer.from([0x03, 0xe8]), r])));
      finish(reason);
      socket.end();
    },
  };
  const finish = (reason?: string) => {
    if (closed) return;
    closed = true;
    conn.onclose?.(reason);
  };
  const parse = () => {
    for (;;) {
      if (buf.length < 2) return;
      const fin = !!(buf[0] & 0x80);
      const op = buf[0] & 0x0f;
      const masked = !!(buf[1] & 0x80);
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return conn.close('too large');
        len = Number(big);
        off = 10;
      }
      if (len > MAX_MESSAGE) return conn.close('too large');
      const mlen = masked ? 4 : 0;
      if (buf.length < off + mlen + len) return;
      let payload = buf.subarray(off + mlen, off + mlen + len);
      if (masked) {
        const m = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
      }
      buf = buf.subarray(off + mlen + len);
      if (op === 8) {
        if (!closed) socket.write(frame(8, Buffer.alloc(0)));
        finish(payload.length > 2 ? payload.subarray(2).toString() : undefined);
        socket.end();
        return;
      }
      if (op === 9) {
        socket.write(frame(10, payload));
        continue;
      }
      if (op === 10) continue;
      if (op === 0) fragments.push(payload);
      else {
        fragOp = op;
        fragments = [payload];
      }
      if (fragments.reduce((n, f) => n + f.length, 0) > MAX_MESSAGE) return conn.close('too large');
      if (!fin) continue;
      const msg = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
      fragments = [];
      if (fragOp === 1) conn.ontext?.(msg.toString('utf8'));
      else conn.onmessage?.(new Uint8Array(msg));
    }
  };
  socket.on('data', (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    parse();
  });
  socket.on('close', () => finish('closed'));
  socket.on('error', () => finish('error'));
  if (buf.length) queueMicrotask(parse);
  return conn;
}

function frame(op: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}

// ---------------------------------------------------------------- client

export interface WsClientWire extends Wire {
  ontext?: (s: string) => void;
  sendText(s: string): void;
}

/** Opens a WebSocket and resolves once it is connected. */
export function connectWs(url: string, kind: CarrierKind, timeoutMs = 8000, where?: string): Promise<WsClientWire> {
  const WS = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) return Promise.reject(new Error('WebSocket is not available here'));
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WS(url);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    let open = false;
    const t = setTimeout(() => {
      if (!open) {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error('No answer'));
      }
    }, timeoutMs);
    const wire: WsClientWire = {
      kind,
      where: where ?? new URL(url).host,
      send: (d) => ws.readyState === 1 && ws.send(d),
      sendText: (s) => ws.readyState === 1 && ws.send(s),
      close: (r) => {
        try { ws.close(1000, String(r ?? '').slice(0, 120)); } catch { /* ignore */ }
      },
    };
    ws.onopen = () => {
      open = true;
      clearTimeout(t);
      resolve(wire);
    };
    ws.onerror = () => {
      if (!open) {
        clearTimeout(t);
        reject(new Error('Could not connect'));
      }
    };
    ws.onclose = (e) => {
      if (!open) {
        clearTimeout(t);
        reject(new Error(e.reason || 'Could not connect'));
        return;
      }
      wire.onclose?.(e.reason || 'closed');
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') wire.ontext?.(e.data);
      else wire.onmessage?.(new Uint8Array(e.data as ArrayBuffer));
    };
  });
}
