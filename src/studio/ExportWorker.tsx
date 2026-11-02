// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The hidden export page: draws every frame of the finished video with the
// same code as the editor's preview, encodes it with the page's video encoder
// and streams it to the main process, which adds the sound and writes the file.

import { useEffect } from 'react';
import type { ExportWork } from '../../core/studio/api';
import { drawBackground, drawFrame } from '../../core/studio/draw';
import { frameTime } from '../../core/studio/export';
import { derive, frameAt } from '../../core/studio/frame';
import { ivfFrameHeader, ivfHeader } from '../../core/studio/packets';
import { api } from '../api';
import { FrameSource } from './decode';

/** Collects encoded bytes and sends them in pieces of about a megabyte, in order. */
class Sender {
  private parts: Uint8Array[] = [];
  private size = 0;
  private chain = Promise.resolve();
  constructor(private id: string) {}
  push(b: Uint8Array) {
    this.parts.push(b);
    this.size += b.length;
    if (this.size > 1 << 20) this.flush();
  }
  flush() {
    if (!this.size) return this.chain;
    const all = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) { all.set(p, o); o += p.length; }
    this.parts = [];
    this.size = 0;
    this.chain = this.chain.then(() => api.studio.workChunk(this.id, all.buffer));
    return this.chain;
  }
}

export async function renderExport(w: ExportWork, onProgress: (done: number) => Promise<boolean>): Promise<void> {
  const { plan, project: p, events } = w;
  const { width, height } = plan.out;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const bg = new OffscreenCanvas(width, height);
  drawBackground(bg.getContext('2d')!, p.style.frame.background, width, height);
  const d = derive(p, events, plan.out, w.mac);
  const screen = new FrameSource(w.screen.index, w.screen.url);
  const cam = w.webcam ? new FrameSource(w.webcam.index, w.webcam.url) : null;
  const send = new Sender(w.id);
  let failed: Error | null = null;
  let frameNo = 0;
  const ivf = plan.intermediate !== 'h264';
  if (ivf) send.push(ivfHeader(plan.intermediate === 'vp9' ? 'VP90' : 'VP80', width, height, plan.fps, plan.frames));
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (ivf) send.push(ivfFrameHeader(data.length, Math.round((chunk.timestamp * plan.fps) / 1e6)));
      send.push(data);
    },
    error: (e) => { failed = new Error(`The video encoder stopped: ${e.message}`); },
  });
  encoder.configure({
    codec: plan.codec, width, height, bitrate: plan.bitrate, framerate: plan.fps, latencyMode: 'quality', bitrateMode: 'variable',
    ...(plan.intermediate === 'h264' ? { avc: { format: 'annexb' as const } } : {}),
  });
  const keyEvery = plan.fps * 2;
  try {
    for (frameNo = 0; frameNo < plan.frames; frameNo++) {
      if (failed) throw failed;
      const st = frameAt(p, events, d, frameTime(frameNo, plan.fps), plan.fps, !!cam);
      const sf = await screen.frameAt(st.src);
      const cf = cam && st.bubble ? await cam.frameAt(st.src - (w.webcam?.offset ?? 0)) : null;
      drawFrame(ctx, st, p.style, { screen: sf, webcam: cf, background: bg });
      const vf = new VideoFrame(canvas, { timestamp: Math.round((frameNo * 1e6) / plan.fps), duration: Math.round(1e6 / plan.fps) });
      encoder.encode(vf, { keyFrame: frameNo % keyEvery === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 3) await new Promise<void>((r) => { encoder.addEventListener('dequeue', () => r(), { once: true }); setTimeout(r, 30); });
      if (frameNo % 6 === 0 && !(await onProgress(frameNo))) throw new Error('cancelled');
    }
    await encoder.flush();
    if (failed) throw failed;
    await send.flush();
    await onProgress(plan.frames);
  } finally {
    try { encoder.close(); } catch { /* closed */ }
    screen.close();
    cam?.close();
  }
}

export function ExportWorker({ id }: { id: string }) {
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const w = await api.studio.work(id);
        await renderExport(w, async (done) => alive && !(await api.studio.workProgress(id, done)).cancelled);
        await api.studio.workDone(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'cancelled') await api.studio.workDone(id, msg).catch(() => undefined);
      }
    })();
    return () => { alive = false; };
  }, [id]);
  return <div role="status" aria-live="polite">Exporting…</div>;
}
