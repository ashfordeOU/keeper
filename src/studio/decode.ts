// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Exact frames of a recording for the export: coded frames (copied out by
// ffmpeg, see core/studio/packets) go through the page's own video decoder in
// order, and frameAt(t) hands back the frame on screen at time t. Time only
// moves forward during an export; a long jump (a cut) restarts from the key
// frame before it instead of decoding everything in between.

import { seekIndex, type PacketIndex } from '../../core/studio/packets';

const BLOCK = 8 * 1024 * 1024;

export class FrameSource {
  private decoder: VideoDecoder | null = null;
  private ready: VideoFrame[] = [];
  private waiters: (() => void)[] = [];
  private cur: VideoFrame | null = null;
  private next = 0;
  private flushed = false;
  private failed: Error | null = null;
  private buf: { start: number; bytes: Uint8Array } = { start: 0, bytes: new Uint8Array(0) };

  constructor(private index: PacketIndex, private url: string) {}

  private makeDecoder() {
    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: (f) => { this.ready.push(f); this.wake(); },
      error: (e) => { this.failed = new Error(`The recording could not be decoded: ${e.message}`); this.wake(); },
    });
    this.decoder.configure({ codec: this.index.webcodec, codedWidth: this.index.width, codedHeight: this.index.height, optimizeForLatency: false });
    this.flushed = false;
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  private async bytes(offset: number, size: number): Promise<Uint8Array> {
    const b = this.buf;
    if (offset >= b.start && offset + size <= b.start + b.bytes.length) return b.bytes.subarray(offset - b.start, offset - b.start + size);
    const len = Math.max(size, BLOCK);
    const res = await fetch(this.url, { headers: { range: `bytes=${offset}-${offset + len - 1}` } });
    if (!res.ok) throw new Error(`The recording’s frames could not be read (${res.status})`);
    this.buf = { start: offset, bytes: new Uint8Array(await res.arrayBuffer()) };
    return this.buf.bytes.subarray(0, size);
  }

  /** Feeds the next coded frame; false at the end. */
  private async feed(): Promise<boolean> {
    if (this.next >= this.index.packets.length) {
      if (!this.flushed && this.decoder) { this.flushed = true; await this.decoder.flush(); }
      return false;
    }
    const p = this.index.packets[this.next++];
    const data = await this.bytes(p.offset, p.size);
    this.decoder!.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: Math.round(p.pts * 1000), duration: Math.round(p.dur * 1000), data }));
    return true;
  }

  /** The frame on screen at `ms` (the latest one that started at or before it). Do not close it: it is reused until the next call moves on. */
  async frameAt(ms: number): Promise<VideoFrame | null> {
    if (this.failed) throw this.failed;
    const t = ms * 1000 + 500;
    // a jump far ahead: start again from the key frame before it
    const k = seekIndex(this.index.packets, ms);
    if (!this.decoder || (k > this.next && this.index.packets[k].pts - (this.cur ? this.cur.timestamp / 1000 : 0) > 1500)) {
      this.makeDecoder();
      this.ready.forEach((f) => f.close());
      this.ready = [];
      this.next = k;
    }
    for (;;) {
      if (this.failed) throw this.failed;
      while (this.ready.length && this.ready[0].timestamp <= t) {
        this.cur?.close();
        this.cur = this.ready.shift()!;
      }
      if (this.ready.length) return this.cur ?? this.ready[0];
      // keep a few frames in flight so the decoder stays busy
      if (this.decoder!.decodeQueueSize < 6) {
        const more = await this.feed();
        if (!more) {
          // everything is decoded: wait for the last frames to come out, then hold the last one
          await new Promise((r) => setTimeout(r, 0));
          if (!this.ready.length) return this.cur;
          continue;
        }
        if (this.ready.length || this.decoder!.decodeQueueSize < 3) continue;
      }
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 50); });
    }
  }

  close() {
    this.cur?.close();
    this.ready.forEach((f) => f.close());
    this.ready = [];
    this.cur = null;
    try { this.decoder?.close(); } catch { /* already closed */ }
    this.decoder = null;
  }
}
