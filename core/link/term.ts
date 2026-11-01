// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A terminal on another device, over a Link stream ('term'). Needs the
// "Terminal on this device" permission there. Frames are length-prefixed:
//   [0][bytes]    terminal output (host → viewer) or typing (viewer → host)
//   [1][JSON]     control: {t:'open', cols, rows} {t:'resize', cols, rows} {t:'exit', code}

export const TERM_DATA = 0;
export const TERM_CTL = 1;

export type TermControl = { t: 'open'; cols: number; rows: number; cwd?: string } | { t: 'resize'; cols: number; rows: number } | { t: 'exit'; code: number | null; reason?: string };

export function termFrame(kind: 0 | 1, body: Uint8Array | string): Uint8Array {
  const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const out = new Uint8Array(5 + b.length);
  new DataView(out.buffer).setUint32(0, b.length + 1);
  out[4] = kind;
  out.set(b, 5);
  return out;
}

export const termControl = (c: TermControl) => termFrame(TERM_CTL, JSON.stringify(c));

/** Splits a byte stream back into frames, whatever the chunk boundaries. */
export class TermReader {
  private buf = new Uint8Array(0);
  constructor(private on: (kind: number, body: Uint8Array) => void, private max = 4 * 1024 * 1024) {}

  push(chunk: Uint8Array) {
    const n = new Uint8Array(this.buf.length + chunk.length);
    n.set(this.buf);
    n.set(chunk, this.buf.length);
    this.buf = n;
    for (;;) {
      if (this.buf.length < 4) return;
      const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0);
      if (len < 1 || len > this.max) throw new Error('bad terminal frame');
      if (this.buf.length < 4 + len) return;
      const kind = this.buf[4];
      const body = this.buf.slice(5, 4 + len);
      this.buf = this.buf.slice(4 + len);
      this.on(kind, body);
    }
  }
}

export function parseControl(b: Uint8Array): TermControl | null {
  try {
    const o = JSON.parse(new TextDecoder().decode(b));
    if (o?.t === 'open' || o?.t === 'resize') return { ...o, cols: clampDim(o.cols, 80), rows: clampDim(o.rows, 24) };
    if (o?.t === 'exit') return { t: 'exit', code: typeof o.code === 'number' ? o.code : null, reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : undefined };
    return null;
  } catch {
    return null;
  }
}

const clampDim = (v: unknown, d: number) => Math.max(10, Math.min(500, Math.round(Number(v) || d)));
