// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Is someone speaking? An energy detector that learns the room's noise, for
// hands-free dictation (start on speech, stop after a pause) and for cutting a
// meeting into pieces at pauses. Pure.

export const FRAME = 480; // 30 ms at 16 kHz

export function rms(a: Float32Array, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** 0..1 for a meter. */
export const meter = (r: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(r, 1e-6)) + 60) / 50));

export interface VadEvent { type: 'speech' | 'silence'; at: number }

export class Vad {
  private floor = 0.002;
  private speaking = false;
  private loudFrames = 0;
  private quietFrames = 0;
  private t = 0;
  private carry = new Float32Array(0);
  /** seconds of quiet that count as the end of speech */
  constructor(public silenceSec = 1, private sampleRate = 16000) {}

  get isSpeaking() { return this.speaking; }

  /** Feeds sound; returns the changes (with times in seconds from the first sample). */
  push(samples: Float32Array): VadEvent[] {
    const out: VadEvent[] = [];
    const buf = new Float32Array(this.carry.length + samples.length);
    buf.set(this.carry);
    buf.set(samples, this.carry.length);
    let i = 0;
    for (; i + FRAME <= buf.length; i += FRAME) {
      const e = rms(buf, i, i + FRAME);
      const loud = e > Math.max(0.006, this.floor * 3.2);
      // the noise floor follows quiet frames quickly and loud ones very slowly
      this.floor = loud ? this.floor * 0.999 + e * 0.001 : this.floor * 0.95 + e * 0.05;
      this.t += FRAME / this.sampleRate;
      if (loud) { this.loudFrames++; this.quietFrames = 0; } else { this.quietFrames++; this.loudFrames = 0; }
      if (!this.speaking && this.loudFrames >= 4) { this.speaking = true; out.push({ type: 'speech', at: this.t - (4 * FRAME) / this.sampleRate }); }
      if (this.speaking && this.quietFrames * FRAME >= this.silenceSec * this.sampleRate) { this.speaking = false; out.push({ type: 'silence', at: this.t - this.silenceSec }); }
    }
    this.carry = buf.slice(i);
    return out;
  }
}

/**
 * Where to cut a long recording: pieces of speech separated by pauses, each
 * no longer than `maxSec` (cut at the quietest moment when it runs on).
 */
export function speechPieces(a: Float32Array, o: { sampleRate?: number; minPause?: number; maxSec?: number; minSec?: number } = {}): { start: number; end: number }[] {
  const sr = o.sampleRate ?? 16000;
  const n = Math.floor(a.length / FRAME);
  if (!n) return [];
  const energy = new Float32Array(n);
  for (let f = 0; f < n; f++) energy[f] = rms(a, f * FRAME, (f + 1) * FRAME);
  const sorted = Array.from(energy).sort((x, y) => x - y);
  const floor = sorted[Math.floor(n * 0.15)] ?? 0;
  const thr = Math.max(0.006, Math.min(floor * 3, (sorted[n - 1] ?? 0) * 0.25));
  const pauseFrames = Math.round(((o.minPause ?? 0.5) * sr) / FRAME);
  const maxFrames = Math.round(((o.maxSec ?? 25) * sr) / FRAME);
  const out: { start: number; end: number }[] = [];
  let start = -1;
  let quiet = 0;
  const sec = (f: number) => (f * FRAME) / sr;
  for (let f = 0; f < n; f++) {
    const loud = energy[f] > thr;
    if (start < 0) { if (loud) { start = f; quiet = 0; } continue; }
    quiet = loud ? 0 : quiet + 1;
    if (quiet >= pauseFrames) { out.push({ start: sec(start), end: sec(f - quiet + 1) }); start = -1; continue; }
    if (f - start >= maxFrames) {
      // too long: cut at the quietest frame of the last third
      let cut = f;
      for (let g = f - Math.floor(maxFrames / 3); g < f; g++) if (energy[g] < energy[cut]) cut = g;
      out.push({ start: sec(start), end: sec(cut) });
      start = cut;
    }
  }
  if (start >= 0) out.push({ start: sec(start), end: sec(n) });
  return out.filter((p) => p.end - p.start >= (o.minSec ?? 0.3));
}
