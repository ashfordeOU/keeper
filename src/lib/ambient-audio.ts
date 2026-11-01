// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Ambient sounds made on the spot with Web Audio: no recordings, no network.
// Each sound is noise shaped by filters, slow oscillators (so it never loops
// audibly) and a few short pre-made loops of drops, crackles, clinks or chirps
// built from a seeded random generator. Levels follow core/scenes/ambient.ts.

import { gainFor, sleepFade, SOUND_IDS, type SoundId, type SoundMix } from '../../core/scenes/ambient';

// ---------------------------------------------------------------- sample makers (pure, tested)

export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function whiteNoise(n: number, rand: () => number): Float32Array {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * 0.5;
  return d;
}

/** Pink noise (Paul Kellet's economy filter). */
export function pinkNoise(n: number, rand: () => number): Float32Array {
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099;
    b1 = 0.963 * b1 + w * 0.2965;
    b2 = 0.57 * b2 + w * 1.0526;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  return d;
}

/** Brown (red) noise: integrated white noise, leaking back towards zero. */
export function brownNoise(n: number, rand: () => number): Float32Array {
  const d = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return d;
}

/** Short decaying events (drops, crackles, clinks, chirps) scattered over a loop. */
export function events(n: number, rate: number, perSecond: number, rand: () => number, kind: 'drop' | 'crackle' | 'clink' | 'chirp'): Float32Array {
  const d = new Float32Array(n);
  const count = Math.round((n / rate) * perSecond);
  for (let e = 0; e < count; e++) {
    const start = Math.floor(rand() * n);
    const amp = 0.15 + rand() * 0.35;
    if (kind === 'chirp') {
      // A cricket: a few quick 4–5 kHz pulses.
      const f = 4200 + rand() * 600;
      for (let p = 0; p < 3; p++) {
        const s0 = start + Math.floor(p * rate * 0.045);
        const len = Math.floor(rate * 0.03);
        for (let i = 0; i < len && s0 + i < n; i++) d[s0 + i] += Math.sin((2 * Math.PI * f * i) / rate) * amp * 0.5 * Math.sin((Math.PI * i) / len);
      }
      continue;
    }
    const len = Math.floor(rate * (kind === 'clink' ? 0.25 : kind === 'drop' ? 0.03 : 0.012));
    const f = kind === 'clink' ? 2400 + rand() * 2200 : kind === 'drop' ? 900 + rand() * 1600 : 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.exp((-6 * i) / len);
      const v = f ? Math.sin((2 * Math.PI * f * i) / rate) : rand() * 2 - 1;
      d[start + i] += v * env * amp;
    }
  }
  return d;
}

// ---------------------------------------------------------------- the engine

type Voice = { out: GainNode; stop(): void };

function buffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

function loop(ctx: BaseAudioContext, b: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.loop = true;
  s.playbackRate.value = rate;
  return s;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** A slow oscillator that moves a parameter by ±depth around where it is. */
function lfo(ctx: BaseAudioContext, target: AudioParam, hz: number, depth: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  return o;
}

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<SoundId, Voice>();
  private bufs = new Map<string, AudioBuffer>();
  private sleepTimer: ReturnType<typeof setInterval> | undefined;
  private state = { mix: {} as SoundMix, master: 0.5, playing: false, fadeSec: 3, sleepAt: null as number | null };

  private noise(kind: 'white' | 'pink' | 'brown' | 'drops' | 'crackle' | 'clinks' | 'chirps'): AudioBuffer {
    const ctx = this.ctx!;
    let b = this.bufs.get(kind);
    if (b) return b;
    const r = ctx.sampleRate;
    // Different, prime-ish lengths so layered loops never line up.
    const n = (sec: number) => Math.floor(r * sec);
    const data = kind === 'white' ? whiteNoise(n(4.1), seeded(11))
      : kind === 'pink' ? pinkNoise(n(5.3), seeded(23))
      : kind === 'brown' ? brownNoise(n(6.7), seeded(37))
      : kind === 'drops' ? events(n(7.3), r, 26, seeded(41), 'drop')
      : kind === 'crackle' ? events(n(9.1), r, 9, seeded(53), 'crackle')
      : kind === 'clinks' ? events(n(11.3), r, 0.35, seeded(67), 'clink')
      : events(n(6.1), r, 1.6, seeded(71), 'chirp');
    b = buffer(ctx, data);
    this.bufs.set(kind, b);
    return b;
  }

  private build(id: SoundId): Voice {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master!);
    const started: AudioScheduledSourceNode[] = [];
    const go = <T extends AudioScheduledSourceNode>(n: T) => { started.push(n); n.start(); return n; };
    const src = (k: Parameters<AmbientEngine['noise']>[0], rate = 1) => go(loop(ctx, this.noise(k), rate));
    switch (id) {
      case 'white': src('white').connect(out); break;
      case 'pink': src('pink').connect(out); break;
      case 'brown': src('brown').connect(out); break;
      case 'rain': {
        const hiss = filter(ctx, 'highpass', 450);
        const soft = filter(ctx, 'lowpass', 7000);
        src('pink').connect(hiss).connect(soft).connect(out);
        const drops = ctx.createGain();
        drops.gain.value = 0.6;
        src('drops').connect(filter(ctx, 'bandpass', 2500, 0.6)).connect(drops).connect(out);
        go(lfo(ctx, soft.frequency, 0.07, 1500));
        break;
      }
      case 'cafe': {
        // Murmur: brown noise through three speech-band filters that wander.
        for (const [f, hz] of [[350, 0.21], [700, 0.17], [1300, 0.13]] as const) {
          const bp = filter(ctx, 'bandpass', f, 2.5);
          const g = ctx.createGain();
          g.gain.value = 0.9;
          src('brown', 1 + f / 9000).connect(bp).connect(g).connect(out);
          go(lfo(ctx, bp.frequency, hz, f * 0.35));
          go(lfo(ctx, g.gain, hz * 2.3, 0.4));
        }
        const clinks = ctx.createGain();
        clinks.gain.value = 0.35;
        src('clinks').connect(clinks).connect(out);
        break;
      }
      case 'waves': {
        const lp = filter(ctx, 'lowpass', 900);
        const swell = ctx.createGain();
        swell.gain.value = 0.55;
        src('brown').connect(lp).connect(swell).connect(out);
        const foam = filter(ctx, 'highpass', 1500);
        const foamG = ctx.createGain();
        foamG.gain.value = 0.15;
        src('pink').connect(foam).connect(foamG).connect(out);
        go(lfo(ctx, swell.gain, 0.085, 0.45));
        go(lfo(ctx, lp.frequency, 0.085, 600));
        go(lfo(ctx, foamG.gain, 0.085, 0.14));
        break;
      }
      case 'stream': {
        const bp = filter(ctx, 'bandpass', 1800, 0.8);
        src('white').connect(bp).connect(out);
        go(lfo(ctx, bp.frequency, 3.1, 400));
        go(lfo(ctx, bp.Q, 0.4, 0.3));
        const low = ctx.createGain();
        low.gain.value = 0.4;
        src('pink').connect(filter(ctx, 'lowpass', 600)).connect(low).connect(out);
        break;
      }
      case 'wind': {
        const bp = filter(ctx, 'bandpass', 500, 1.2);
        const g = ctx.createGain();
        g.gain.value = 0.6;
        src('pink').connect(bp).connect(g).connect(out);
        go(lfo(ctx, bp.frequency, 0.05, 320));
        go(lfo(ctx, g.gain, 0.11, 0.4));
        break;
      }
      case 'fire': {
        src('brown').connect(filter(ctx, 'lowpass', 380)).connect(out);
        const crack = ctx.createGain();
        crack.gain.value = 0.7;
        src('crackle').connect(filter(ctx, 'highpass', 1200)).connect(crack).connect(out);
        break;
      }
      case 'night': {
        const air = ctx.createGain();
        air.gain.value = 0.25;
        src('pink').connect(filter(ctx, 'lowpass', 500)).connect(air).connect(out);
        const ch = ctx.createGain();
        ch.gain.value = 0.5;
        src('chirps').connect(ch).connect(out);
        src('chirps', 1.07).connect(ch);
        break;
      }
    }
    return { out, stop: () => { for (const n of started) { try { n.stop(); } catch { /* already stopped */ } } out.disconnect(); } };
  }

  /** Applies a new mix; levels glide over `fadeSec` (cross-fades between vibes). */
  set(next: { mix: SoundMix; master: number; playing: boolean; fadeSec: number; sleepAt: number | null }) {
    this.state = { ...next };
    const want = next.playing && SOUND_IDS.some((id) => (next.mix[id] ?? 0) > 0) && next.master > 0;
    if (!want && !this.ctx) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume().catch(() => undefined);
    const t = this.ctx.currentTime;
    const fade = Math.max(0.05, next.fadeSec);
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setValueAtTime(this.master!.gain.value, t);
    this.master!.gain.linearRampToValueAtTime(want ? sleepFade(next.sleepAt) : 0, t + fade);
    for (const id of SOUND_IDS) {
      const level = want ? gainFor(next.mix[id] ?? 0, 1) : 0;
      let v = this.voices.get(id);
      if (level > 0 && !v) { v = this.build(id); this.voices.set(id, v); }
      if (!v) continue;
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(v.out.gain.value, t);
      v.out.gain.linearRampToValueAtTime(level * gainFor(1, next.master), t + fade);
    }
    // Sounds turned down to nothing stop after the fade, and with nothing left the context closes.
    setTimeout(() => this.prune(), fade * 1000 + 200);
    clearInterval(this.sleepTimer);
    if (want && next.sleepAt) this.sleepTimer = setInterval(() => this.followSleep(), 5000);
  }

  private followSleep() {
    if (!this.ctx || !this.master || !this.state.sleepAt) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(sleepFade(this.state.sleepAt), t, 1.5);
  }

  private prune() {
    const s = this.state;
    const want = s.playing && s.master > 0;
    for (const [id, v] of this.voices) {
      if (want && (s.mix[id] ?? 0) > 0) continue;
      v.stop();
      this.voices.delete(id);
    }
    if (!this.voices.size && this.ctx) {
      clearInterval(this.sleepTimer);
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.master = null;
      this.bufs.clear();
    }
  }

  /** Sounds playing right now (for the panel's meters and tests). */
  active(): SoundId[] {
    return [...this.voices.keys()];
  }

  dispose() {
    clearInterval(this.sleepTimer);
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
