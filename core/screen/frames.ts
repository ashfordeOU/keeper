// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The fallback picture path: still JPEG frames inside the encrypted Link
// channel (or the phone's companion channel), used when a direct WebRTC
// connection cannot be made (strict firewalls, relay or tunnel only) and for
// phone browsers on plain-http pages.
//
//   frame = [u32 header length][header JSON][JPEG bytes]
//   header = { seq, w, h, at, display }
//
// Flow control is by acknowledgement: the host keeps at most `window` frames
// unacknowledged, so a slow link gets fewer, fresher frames instead of a backlog.

export interface FrameHeader {
  seq: number;
  w: number;
  h: number;
  /** capture time, ms since epoch on the host */
  at: number;
  display?: string;
}

export function encodeFrame(h: FrameHeader, jpeg: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(h));
  const out = new Uint8Array(4 + head.length + jpeg.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(jpeg, 4 + head.length);
  return out;
}

export function decodeFrame(b: Uint8Array): { header: FrameHeader; jpeg: Uint8Array } | null {
  if (b.length < 4) return null;
  const n = new DataView(b.buffer, b.byteOffset, b.length).getUint32(0);
  if (n > 4096 || 4 + n > b.length) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n))) as FrameHeader;
    if (!Number.isInteger(header.seq) || !(header.w > 0) || !(header.h > 0)) return null;
    const jpeg = b.subarray(4 + n);
    // JPEG files start FF D8.
    if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
    return { header, jpeg };
  } catch {
    return null;
  }
}

/** Splits a byte stream back into length-prefixed messages ([u32 length][message]). */
export class Deframer {
  private buf = new Uint8Array(0);
  constructor(private onMessage: (m: Uint8Array) => void, private max = 16 * 1024 * 1024) {}
  push(chunk: Uint8Array) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    let off = 0;
    while (b.length - off >= 4) {
      const n = new DataView(b.buffer, b.byteOffset + off, 4).getUint32(0);
      if (n > this.max) throw new Error('Frame too large');
      if (b.length - off - 4 < n) break;
      this.onMessage(b.slice(off + 4, off + 4 + n));
      off += 4 + n;
    }
    this.buf = b.slice(off);
  }
}

export function lengthPrefixed(m: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + m.length);
  new DataView(out.buffer).setUint32(0, m.length);
  out.set(m, 4);
  return out;
}

/** At most `window` frames in flight; `send` is allowed when there is room and enough time has passed. */
export class FrameGate {
  private inflight = new Map<number, number>();
  private last = 0;
  seq = 0;
  /** smoothed time from send to acknowledgement, ms */
  rtt = 0;

  constructor(public window = 2, public minGapMs = 66) {}

  ready(now: number): boolean {
    // Frames not acknowledged in 3 s are given up on, so one lost ack never stalls the picture.
    for (const [s, t] of this.inflight) if (now - t > 3000) this.inflight.delete(s);
    return this.inflight.size < this.window && now - this.last >= this.minGapMs;
  }

  sent(now: number): number {
    const s = ++this.seq;
    this.inflight.set(s, now);
    this.last = now;
    return s;
  }

  ack(seq: number, now: number) {
    const t = this.inflight.get(seq);
    if (t === undefined) return;
    this.inflight.delete(seq);
    // Older frames still out are overtaken: the viewer only shows the newest.
    for (const s of [...this.inflight.keys()]) if (s < seq) this.inflight.delete(s);
    const r = now - t;
    this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
  }
}
