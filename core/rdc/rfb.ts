// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A compact VNC (RFB 3.3 / 3.7 / 3.8) client: the handshake, sign-in (none,
// VNC password, Apple's own sign-in (type 30) when given a user name, VeNCrypt
// with TLS when the transport can start it), and the picture in Raw, CopyRect,
// RRE, Hextile, ZRLE and Tight (JPEG rectangles are passed on as JPEG for the
// window to decode), with the pointer shape, desktop resizes and the clipboard. It only turns bytes into events and
// events into bytes: the caller owns the connection (a TCP socket in the main
// process) and the inflater ZRLE needs, so this file runs anywhere and is
// tested against recorded bytes and a tiny server.
//
// Pixels are asked for as 32-bit little-endian with red in the lowest byte,
// so every decoded rectangle is ready to draw as RGBA.

import type { ArdChallenge } from './ard';
import { vncResponse } from './des';

export const ENC = {
  raw: 0, copyRect: 1, rre: 2, hextile: 5, tight: 7, zrle: 16,
  cursor: -239, desktopSize: -223, lastRect: -224, extendedDesktopSize: -308,
  /** Tight's JPEG quality 0–9 (-32…-23) and zlib level 0–9 (-256…-247) */
  jpegQuality6: -26, compressLevel2: -254,
} as const;

/** Lossless pictures first (ZRLE); Tight for servers without it. */
export const DEFAULT_ENCODINGS = [ENC.zrle, ENC.tight, ENC.hextile, ENC.rre, ENC.copyRect, ENC.raw, ENC.cursor, ENC.desktopSize, ENC.extendedDesktopSize, ENC.lastRect, ENC.compressLevel2];
/** For slow links: Tight first, with JPEG for photo-like areas. */
export const FAST_ENCODINGS = [ENC.tight, ENC.zrle, ENC.hextile, ENC.rre, ENC.copyRect, ENC.raw, ENC.cursor, ENC.desktopSize, ENC.extendedDesktopSize, ENC.lastRect, ENC.jpegQuality6, ENC.compressLevel2];

export type FrameOp =
  | { t: 'img'; x: number; y: number; w: number; h: number; data: Uint8Array }
  | { t: 'copy'; sx: number; sy: number; x: number; y: number; w: number; h: number }
  | { t: 'fill'; x: number; y: number; w: number; h: number; rgba: [number, number, number] }
  /** a JPEG picture (Tight): the window decodes it with its own image decoder */
  | { t: 'jpeg'; x: number; y: number; w: number; h: number; data: Uint8Array };

export type RfbEvent =
  | { t: 'security'; type: number; name: string }
  | { t: 'init'; width: number; height: number; name: string }
  | { t: 'update'; ops: FrameOp[] }
  | { t: 'resize'; width: number; height: number }
  | { t: 'cursor'; hotX: number; hotY: number; w: number; h: number; rgba: Uint8Array }
  | { t: 'clipboard'; text: string }
  | { t: 'bell' }
  | { t: 'error'; message: string }
  | { t: 'closed' };

export interface RfbOptions {
  password?: string;
  username?: string;
  shared?: boolean;
  encodings?: number[];
  /** the transport can wrap itself in TLS (VeNCrypt); resolves when the TLS layer is up */
  startTls?: () => Promise<void>;
  /** a persistent zlib stream for ZRLE (one per connection) */
  inflate?: (data: Uint8Array) => Promise<Uint8Array>;
  /** Tight's four zlib streams (reset: start that stream afresh first) */
  tightInflate?: (stream: number, data: Uint8Array, reset: boolean) => Promise<Uint8Array>;
  /** Apple's sign-in (type 30): the answer to the server's key exchange (core/rdc/ard.ts) */
  ard?: (c: ArdChallenge, user: string, password: string) => Uint8Array;
}

const SEC_NAMES: Record<number, string> = { 1: 'None', 2: 'VNC password', 19: 'VeNCrypt', 30: 'Apple Remote Desktop', 16: 'Tight' };

class Closed extends Error {}

/** Reads exact byte counts from a stream of chunks. */
class ByteQueue {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private waiting: { n: number; resolve: (b: Uint8Array) => void; reject: (e: Error) => void } | null = null;
  private ended: Error | null = null;

  push(b: Uint8Array) {
    if (!b.length) return;
    this.chunks.push(b);
    this.size += b.length;
    this.wake();
  }

  end(e: Error = new Closed('The connection closed')) {
    this.ended = e;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.reject(e);
    }
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - off);
      out.set(c.subarray(0, k), off);
      off += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.size -= n;
    return out;
  }

  private wake() {
    if (this.waiting && this.size >= this.waiting.n) {
      const w = this.waiting;
      this.waiting = null;
      w.resolve(this.take(w.n));
    }
  }

  read(n: number): Promise<Uint8Array> {
    if (n === 0) return Promise.resolve(new Uint8Array(0));
    if (this.size >= n) return Promise.resolve(this.take(n));
    if (this.ended) return Promise.reject(this.ended);
    return new Promise((resolve, reject) => {
      this.waiting = { n, resolve, reject };
    });
  }

  /** whatever arrived but was not read yet (handed over when TLS starts) */
  drain(): Uint8Array {
    return this.take(this.size);
  }
}

const u16 = (b: Uint8Array, o = 0) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o = 0) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const s32 = (b: Uint8Array, o = 0) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

function be(...parts: [number, 1 | 2 | 4][]): Uint8Array {
  const len = parts.reduce((s, [, n]) => s + n, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const [v, n] of parts) {
    for (let i = n - 1; i >= 0; i--) out[o + (n - 1 - i)] = (v >>> (i * 8)) & 0xff;
    o += n;
  }
  return out;
}

const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
const toLatin1 = (s: string) => Uint8Array.from([...s].map((ch) => { const c = ch.codePointAt(0)!; return c < 256 ? c : 63; }));

/** A pixel format: 32 bits, depth 24, little-endian, true colour, R at bit 0, G at 8, B at 16. */
export const PIXEL_FORMAT = new Uint8Array([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0]);

export class RfbClient {
  width = 0;
  height = 0;
  name = '';
  version = '';
  private q = new ByteQueue();
  private closed = false;

  constructor(
    private send: (data: Uint8Array) => void,
    private emit: (e: RfbEvent) => void,
    private opts: RfbOptions = {},
  ) {}

  /** bytes from the server */
  feed(b: Uint8Array) {
    this.q.push(b);
  }

  /** the connection ended */
  end(reason?: string) {
    this.q.end(reason ? new Error(reason) : new Closed('The connection closed'));
  }

  /** bytes received but not read yet (for a transport that is switching to TLS) */
  takeBuffered(): Uint8Array {
    return this.q.drain();
  }

  /** Runs the whole conversation; resolves when the connection ends. */
  async run(): Promise<void> {
    try {
      await this.handshake();
      for (;;) await this.message();
    } catch (e) {
      if (this.closed) return;
      this.closed = true;
      if (e instanceof Closed) this.emit({ t: 'closed' });
      else this.emit({ t: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---------------------------------------------------------------- handshake

  private async reason(): Promise<string> {
    const len = u32(await this.q.read(4));
    return new TextDecoder().decode(await this.q.read(Math.min(len, 1 << 16)));
  }

  private async handshake() {
    const v = latin1(await this.q.read(12));
    const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(v);
    if (!m) throw new Error('This is not a VNC server');
    const major = Number(m[1]);
    const minor = Number(m[2]);
    // 3.3, 3.7 and 3.8; Apple's 3.889 speaks 3.8; anything newer is answered as 3.8.
    const ours = major > 3 || minor >= 8 ? 8 : minor >= 7 ? 7 : 3;
    this.version = `3.${ours}`;
    this.send(toLatin1(`RFB 003.00${ours}\n`));

    let type: number;
    if (ours === 3) {
      type = u32(await this.q.read(4));
      if (type === 0) throw new Error(await this.reason());
    } else {
      const n = (await this.q.read(1))[0];
      if (n === 0) throw new Error(await this.reason());
      const types = [...(await this.q.read(n))];
      type = this.chooseSecurity(types);
      this.send(Uint8Array.of(type));
    }
    this.emit({ t: 'security', type, name: SEC_NAMES[type] ?? `type ${type}` });
    await this.authenticate(type, ours);
    this.send(Uint8Array.of(this.opts.shared === false ? 0 : 1));

    const init = await this.q.read(24);
    this.width = u16(init, 0);
    this.height = u16(init, 2);
    const nameLen = u32(init, 20);
    this.name = new TextDecoder().decode(await this.q.read(Math.min(nameLen, 1 << 16)));
    // Ask for RGBA-ready pixels and the encodings we decode.
    this.send(concat(Uint8Array.of(0, 0, 0, 0), PIXEL_FORMAT));
    const encs = this.opts.encodings ?? DEFAULT_ENCODINGS;
    this.send(concat(be([2, 1], [0, 1], [encs.length, 2]), ...encs.map((e) => be([e >>> 0, 4]))));
    this.emit({ t: 'init', width: this.width, height: this.height, name: this.name });
    this.requestUpdate(false);
  }

  private chooseSecurity(types: number[]): number {
    // No password needed is simplest; then VeNCrypt (TLS) when the transport can do it; Apple's
    // sign-in when a user name is set (it carries the Mac account's name and password); then the VNC password.
    const ard = this.opts.ard ? (this.opts.username ? [30] : []) : [];
    const pref = this.opts.startTls ? [19, 1, ...ard, 2] : [1, ...ard, 2];
    for (const p of pref) if (types.includes(p)) return p;
    if (this.opts.ard && types.includes(30)) throw new Error('This Mac asks for an account name and password: add the user name to the connection, then connect again.');
    const names = types.map((t) => SEC_NAMES[t] ?? `type ${t}`).join(', ');
    throw new Error(`This server only offers sign-in methods Keeper cannot use here (${names}). Open it in an outside viewer instead.`);
  }

  private async securityResult(ours: number) {
    const r = u32(await this.q.read(4));
    if (r === 0) return;
    const msg = ours >= 8 ? await this.reason().catch(() => '') : '';
    throw new Error(msg ? `Sign-in refused: ${msg}` : 'Sign-in refused: wrong password?');
  }

  private async authenticate(type: number, ours: number) {
    if (type === 1) {
      if (ours >= 8) await this.securityResult(ours);
      return;
    }
    if (type === 2) {
      const challenge = await this.q.read(16);
      if (this.opts.password === undefined) throw new Error('PASSWORD_NEEDED');
      this.send(vncResponse(this.opts.password, challenge));
      await this.securityResult(ours);
      return;
    }
    if (type === 19) return this.vencrypt(ours);
    if (type === 30) {
      const head = await this.q.read(4);
      const len = u16(head, 2);
      if (!len || len > 1024) throw new Error('The Mac sent an unusable key exchange');
      const rest = await this.q.read(len * 2);
      if (this.opts.password === undefined) throw new Error('PASSWORD_NEEDED');
      this.send(this.opts.ard!({ generator: u16(head, 0), prime: rest.subarray(0, len), serverKey: rest.subarray(len) }, this.opts.username ?? '', this.opts.password));
      await this.securityResult(ours);
      return;
    }
    throw new Error(`Sign-in method ${type} is not supported`);
  }

  /** VeNCrypt: agree on version 0.2, pick a TLS subtype, start TLS, then sign in inside it. */
  private async vencrypt(ours: number) {
    const ver = await this.q.read(2);
    if (ver[0] !== 0 || ver[1] < 2) throw new Error('This server’s VeNCrypt is too old');
    this.send(Uint8Array.of(0, 2));
    if ((await this.q.read(1))[0] !== 0) throw new Error('The server refused VeNCrypt 0.2');
    const n = (await this.q.read(1))[0];
    const subs: number[] = [];
    const raw = await this.q.read(n * 4);
    for (let i = 0; i < n; i++) subs.push(u32(raw, i * 4));
    // X509 (checked certificates) first, then TLS; with a password VNC or Plain inside, else none.
    const pref = [261, 262, 260, 258, 259, 257];
    const sub = pref.find((p) => subs.includes(p));
    if (!sub) throw new Error('No VeNCrypt option Keeper can use (it needs TLS)');
    this.send(be([sub, 4]));
    if ((await this.q.read(1))[0] !== 1) throw new Error('The server refused the TLS option');
    await this.opts.startTls!();
    const inner = sub === 258 || sub === 261 ? 2 : sub === 259 || sub === 262 ? 256 : 1;
    if (inner === 2) {
      const challenge = await this.q.read(16);
      if (this.opts.password === undefined) throw new Error('PASSWORD_NEEDED');
      this.send(vncResponse(this.opts.password, challenge));
    } else if (inner === 256) {
      if (this.opts.password === undefined) throw new Error('PASSWORD_NEEDED');
      const u = new TextEncoder().encode(this.opts.username ?? '');
      const p = new TextEncoder().encode(this.opts.password);
      this.send(concat(be([u.length, 4], [p.length, 4]), u, p));
    }
    await this.securityResult(ours);
  }

  // ---------------------------------------------------------------- messages from the server

  private async message() {
    const type = (await this.q.read(1))[0];
    if (type === 0) return this.framebufferUpdate();
    if (type === 1) {
      const h = await this.q.read(5);
      await this.q.read(u16(h, 3) * 6);
      return;
    }
    if (type === 2) return this.emit({ t: 'bell' });
    if (type === 3) {
      const h = await this.q.read(7);
      const len = s32(h, 3);
      if (len < 0) {
        await this.q.read(-len); // extended clipboard (not asked for): skip
        return;
      }
      const text = latin1(await this.q.read(Math.min(len, 16 << 20)));
      this.emit({ t: 'clipboard', text: text.replace(/\r\n/g, '\n') });
      return;
    }
    throw new Error(`Unexpected message from the server (${type})`);
  }

  private async pixels(n: number): Promise<Uint8Array> {
    const d = await this.q.read(n * 4);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    return d;
  }

  private async framebufferUpdate() {
    const h = await this.q.read(3);
    const count = u16(h, 1);
    const ops: FrameOp[] = [];
    for (let i = 0; i < count; i++) {
      const r = await this.q.read(12);
      const x = u16(r, 0), y = u16(r, 2), w = u16(r, 4), hh = u16(r, 6);
      const enc = s32(r, 8);
      if (enc === ENC.lastRect) break;
      if (enc === ENC.raw) ops.push({ t: 'img', x, y, w, h: hh, data: await this.pixels(w * hh) });
      else if (enc === ENC.copyRect) {
        const s = await this.q.read(4);
        ops.push({ t: 'copy', sx: u16(s, 0), sy: u16(s, 2), x, y, w, h: hh });
      } else if (enc === ENC.rre) ops.push({ t: 'img', x, y, w, h: hh, data: await this.rre(w, hh) });
      else if (enc === ENC.hextile) ops.push({ t: 'img', x, y, w, h: hh, data: await this.hextile(w, hh) });
      else if (enc === ENC.zrle) ops.push({ t: 'img', x, y, w, h: hh, data: await this.zrle(w, hh) });
      else if (enc === ENC.tight) ops.push(await this.tight(x, y, w, hh));
      else if (enc === ENC.cursor) {
        const px = await this.pixels(w * hh);
        const mask = await this.q.read(((w + 7) >> 3) * hh);
        const stride = (w + 7) >> 3;
        for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < w; xx++) {
          const on = (mask[yy * stride + (xx >> 3)] >> (7 - (xx & 7))) & 1;
          px[(yy * w + xx) * 4 + 3] = on ? 255 : 0;
        }
        this.emit({ t: 'cursor', hotX: x, hotY: y, w, h: hh, rgba: px });
      } else if (enc === ENC.desktopSize) {
        this.resize(w, hh);
      } else if (enc === ENC.extendedDesktopSize) {
        const n = (await this.q.read(4))[0];
        await this.q.read(n * 16);
        // y says whether the change succeeded when it answers our own request; x is the reason.
        if (!(x === 1 && y !== 0)) this.resize(w, hh);
      } else throw new Error(`The server sent a picture format Keeper did not ask for (${enc})`);
    }
    this.emit({ t: 'update', ops });
  }

  private resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.emit({ t: 'resize', width: w, height: h });
  }

  private async rre(w: number, h: number): Promise<Uint8Array> {
    const head = await this.q.read(8);
    const n = u32(head, 0);
    const out = new Uint8Array(w * h * 4);
    fillRect(out, w, 0, 0, w, h, head[4], head[5], head[6]);
    for (let i = 0; i < n; i++) {
      const s = await this.q.read(12);
      fillRect(out, w, u16(s, 4), u16(s, 6), u16(s, 8), u16(s, 10), s[0], s[1], s[2]);
    }
    return out;
  }

  private async hextile(w: number, h: number): Promise<Uint8Array> {
    const out = new Uint8Array(w * h * 4);
    let bg: [number, number, number] = [0, 0, 0];
    let fg: [number, number, number] = [255, 255, 255];
    for (let ty = 0; ty < h; ty += 16) {
      for (let tx = 0; tx < w; tx += 16) {
        const tw = Math.min(16, w - tx);
        const th = Math.min(16, h - ty);
        const sub = (await this.q.read(1))[0];
        if (sub & 1) {
          const px = await this.pixels(tw * th);
          for (let yy = 0; yy < th; yy++) out.set(px.subarray(yy * tw * 4, (yy + 1) * tw * 4), ((ty + yy) * w + tx) * 4);
          continue;
        }
        if (sub & 2) { const p = await this.q.read(4); bg = [p[0], p[1], p[2]]; }
        if (sub & 4) { const p = await this.q.read(4); fg = [p[0], p[1], p[2]]; }
        fillRect(out, w, tx, ty, tw, th, ...bg);
        if (sub & 8) {
          const n = (await this.q.read(1))[0];
          const coloured = !!(sub & 16);
          const data = await this.q.read(n * (coloured ? 6 : 2));
          let o = 0;
          for (let i = 0; i < n; i++) {
            let c = fg;
            if (coloured) { c = [data[o], data[o + 1], data[o + 2]]; o += 4; }
            const xy = data[o++];
            const wh = data[o++];
            fillRect(out, w, tx + (xy >> 4), ty + (xy & 15), (wh >> 4) + 1, (wh & 15) + 1, ...c);
          }
        }
      }
    }
    return out;
  }

  private async zrle(w: number, h: number): Promise<Uint8Array> {
    const len = u32(await this.q.read(4));
    const packed = await this.q.read(len);
    if (!this.opts.inflate) throw new Error('ZRLE needs an inflater');
    return decodeZrle(await this.opts.inflate(packed), w, h);
  }

  /** Tight's compact length: 1–3 bytes, 7 bits each, low bits first. */
  private async compactLength(): Promise<number> {
    let b = (await this.q.read(1))[0];
    let len = b & 0x7f;
    if (b & 0x80) {
      b = (await this.q.read(1))[0];
      len |= (b & 0x7f) << 7;
      if (b & 0x80) len |= (await this.q.read(1))[0] << 14;
    }
    return len;
  }

  private tightResets = 0;

  /** Tight: fill, JPEG, or "basic" (copy, palette or gradient filter, zlib unless tiny). */
  private async tight(x: number, y: number, w: number, h: number): Promise<FrameOp> {
    const ctl = (await this.q.read(1))[0];
    this.tightResets |= ctl & 0x0f;
    const kind = ctl >> 4;
    if (kind === 8) {
      const p = await this.q.read(3);
      return { t: 'fill', x, y, w, h, rgba: [p[0], p[1], p[2]] };
    }
    if (kind === 9) return { t: 'jpeg', x, y, w, h, data: await this.q.read(await this.compactLength()) };
    if (kind > 9) throw new Error(`Unknown Tight rectangle (${kind})`);
    const stream = kind & 3;
    const filter = kind & 4 ? (await this.q.read(1))[0] : TIGHT_COPY;
    let palette: Uint8Array | undefined;
    if (filter === TIGHT_PALETTE) {
      const n = (await this.q.read(1))[0] + 1;
      palette = await this.q.read(n * 3);
    } else if (filter !== TIGHT_COPY && filter !== TIGHT_GRADIENT) throw new Error(`Unknown Tight filter (${filter})`);
    const size = tightDataSize(w, h, palette);
    let data: Uint8Array;
    if (size < 12) data = await this.q.read(size);
    else {
      const packed = await this.q.read(await this.compactLength());
      if (!this.opts.tightInflate) throw new Error('Tight needs an inflater');
      const reset = !!(this.tightResets & (1 << stream));
      this.tightResets &= ~(1 << stream);
      data = await this.opts.tightInflate(stream, packed, reset);
    }
    return { t: 'img', x, y, w, h, data: decodeTightBasic(data, w, h, filter, palette) };
  }

  // ---------------------------------------------------------------- messages to the server

  requestUpdate(incremental = true, x = 0, y = 0, w = this.width, h = this.height) {
    if (!w || !h) return;
    this.send(be([3, 1], [incremental ? 1 : 0, 1], [x, 2], [y, 2], [w, 2], [h, 2]));
  }

  key(keysym: number, down: boolean) {
    this.send(be([4, 1], [down ? 1 : 0, 1], [0, 2], [keysym >>> 0, 4]));
  }

  pointer(x: number, y: number, buttons: number) {
    const cx = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    this.send(be([5, 1], [buttons & 0xff, 1], [cx, 2], [cy, 2]));
  }

  clipboard(text: string) {
    const b = toLatin1(text.replace(/\r?\n/g, '\n'));
    this.send(concat(be([6, 1], [0, 1], [0, 2], [b.length, 4]), b));
  }
}

function fillRect(out: Uint8Array, stride: number, x: number, y: number, w: number, h: number, r: number, g: number, b: number) {
  for (let yy = y; yy < y + h; yy++) {
    let o = (yy * stride + x) * 4;
    for (let xx = 0; xx < w; xx++, o += 4) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

export const TIGHT_COPY = 0;
export const TIGHT_PALETTE = 1;
export const TIGHT_GRADIENT = 2;

/** How many bytes a basic Tight rectangle's pixels take before compression. */
export function tightDataSize(w: number, h: number, palette?: Uint8Array): number {
  if (!palette) return w * h * 3;
  return palette.length / 3 <= 2 ? ((w + 7) >> 3) * h : w * h;
}

/** Tight's basic pixels (3 bytes each for this pixel format) to RGBA, undoing the palette or gradient filter. */
export function decodeTightBasic(d: Uint8Array, w: number, h: number, filter: number, palette?: Uint8Array): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  if (d.length < tightDataSize(w, h, filter === TIGHT_PALETTE ? palette : undefined)) throw new Error('Tight data ended early');
  if (filter === TIGHT_PALETTE && palette) {
    const n = palette.length / 3;
    const stride = (w + 7) >> 3;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = n <= 2 ? (d[yy * stride + (xx >> 3)] >> (7 - (xx & 7))) & 1 : d[yy * w + xx];
        const o = (yy * w + xx) * 4;
        const p = Math.min(idx, n - 1) * 3;
        out[o] = palette[p]; out[o + 1] = palette[p + 1]; out[o + 2] = palette[p + 2]; out[o + 3] = 255;
      }
    }
    return out;
  }
  if (filter === TIGHT_GRADIENT) {
    // each component is predicted from left + above − above-left (clamped), and the data is the difference
    const prev = new Uint8Array(w * 3);
    const row = new Uint8Array(w * 3);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        for (let c = 0; c < 3; c++) {
          const left = xx ? row[(xx - 1) * 3 + c] : 0;
          const up = prev[xx * 3 + c];
          const upLeft = xx ? prev[(xx - 1) * 3 + c] : 0;
          const pred = Math.max(0, Math.min(255, left + up - upLeft));
          row[xx * 3 + c] = (pred + d[(yy * w + xx) * 3 + c]) & 255;
        }
        const o = (yy * w + xx) * 4;
        out[o] = row[xx * 3]; out[o + 1] = row[xx * 3 + 1]; out[o + 2] = row[xx * 3 + 2]; out[o + 3] = 255;
      }
      prev.set(row);
    }
    return out;
  }
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    out[o] = d[i * 3]; out[o + 1] = d[i * 3 + 1]; out[o + 2] = d[i * 3 + 2]; out[o + 3] = 255;
  }
  return out;
}

/** ZRLE: 64×64 tiles of 3-byte pixels, raw, solid, packed palette, RLE or palette RLE. */
export function decodeZrle(d: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let o = 0;
  const need = (n: number) => { if (o + n > d.length) throw new Error('ZRLE data ended early'); };
  const cpixel = (): [number, number, number] => { need(3); const p: [number, number, number] = [d[o], d[o + 1], d[o + 2]]; o += 3; return p; };
  const runLength = () => {
    let len = 1;
    for (;;) {
      need(1);
      const b = d[o++];
      len += b;
      if (b !== 255) return len;
    }
  };
  const put = (i: number, tx: number, ty: number, tw: number, c: [number, number, number]) => {
    const p = ((ty + Math.floor(i / tw)) * w + tx + (i % tw)) * 4;
    out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
  };
  for (let ty = 0; ty < h; ty += 64) {
    for (let tx = 0; tx < w; tx += 64) {
      const tw = Math.min(64, w - tx);
      const th = Math.min(64, h - ty);
      need(1);
      const sub = d[o++];
      const n = tw * th;
      if (sub === 0) {
        for (let i = 0; i < n; i++) put(i, tx, ty, tw, cpixel());
      } else if (sub === 1) {
        const c = cpixel();
        fillRect(out, w, tx, ty, tw, th, ...c);
      } else if (sub >= 2 && sub <= 16) {
        const pal = Array.from({ length: sub }, cpixel);
        const bits = sub === 2 ? 1 : sub <= 4 ? 2 : 4;
        const rowBytes = Math.ceil((tw * bits) / 8);
        need(rowBytes * th);
        for (let yy = 0; yy < th; yy++) {
          for (let xx = 0; xx < tw; xx++) {
            const bit = xx * bits;
            const byte = d[o + yy * rowBytes + (bit >> 3)];
            const idx = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
            put(yy * tw + xx, tx, ty, tw, pal[idx] ?? [0, 0, 0]);
          }
        }
        o += rowBytes * th;
      } else if (sub === 128) {
        let i = 0;
        while (i < n) {
          const c = cpixel();
          const len = runLength();
          for (let k = 0; k < len && i < n; k++) put(i++, tx, ty, tw, c);
        }
      } else if (sub >= 130) {
        const pal = Array.from({ length: sub - 128 }, cpixel);
        let i = 0;
        while (i < n) {
          need(1);
          const b = d[o++];
          const len = b & 128 ? runLength() : 1;
          const c = pal[b & 127] ?? [0, 0, 0];
          for (let k = 0; k < len && i < n; k++) put(i++, tx, ty, tw, c);
        }
      } else throw new Error(`Unknown ZRLE tile type ${sub}`);
    }
  }
  return out;
}
