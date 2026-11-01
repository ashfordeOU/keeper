// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Adaptive quality for a shared screen. Once a second the host feeds in what
// WebRTC (or the frame stream) reports; the controller answers with a bitrate,
// a frame rate and a scale. It backs off fast when the network struggles and
// climbs back slowly, so a busy Wi-Fi makes the picture softer, not frozen.

import { QUALITY, type Quality, type QualityPreset } from './types';

export interface NetSample {
  /** round-trip time, ms */
  rtt?: number;
  /** share of packets lost since the last sample, 0..1 */
  loss?: number;
  /** what the browser thinks the path can carry, bits/s */
  available?: number;
  /** the encoder says it is short of CPU */
  cpuLimited?: boolean;
}

export const LIMITS = { minBitrate: 250_000, maxBitrate: 16_000_000, minScale: 0.35, minFps: 8 };

export class QualityController {
  private target: QualityPreset;
  private calm = 0;

  constructor(private mode: Quality = 'auto') {
    this.target = { ...(mode === 'auto' ? QUALITY.balanced : QUALITY[mode]) };
  }

  setMode(mode: Quality) {
    this.mode = mode;
    this.target = { ...(mode === 'auto' ? QUALITY.balanced : QUALITY[mode]) };
    this.calm = 0;
  }

  get current(): QualityPreset {
    return { ...this.target };
  }

  /** One step; returns the new target (the same object shape every time). */
  update(s: NetSample): QualityPreset {
    if (this.mode !== 'auto') return this.current;
    const t = this.target;
    const congested = (s.loss ?? 0) > 0.05 || (s.rtt ?? 0) > 400 || (s.available !== undefined && s.available < t.bitrate * 0.8);
    if (congested) {
      this.calm = 0;
      // Multiplicative decrease, never below what the path says it can carry.
      t.bitrate = Math.max(LIMITS.minBitrate, Math.round(Math.min(t.bitrate * 0.7, s.available ? s.available * 0.9 : Infinity)));
      if (t.bitrate < 1_000_000) t.scale = Math.max(LIMITS.minScale, round2(t.scale * 0.85));
      if (t.bitrate < 600_000) t.fps = Math.max(LIMITS.minFps, Math.round(t.fps * 0.8));
    } else if (++this.calm >= 3) {
      // Additive increase after three calm seconds.
      const cap = s.available ? Math.min(LIMITS.maxBitrate, s.available * 0.95) : LIMITS.maxBitrate;
      t.bitrate = Math.min(cap, t.bitrate + 400_000);
      if (t.bitrate >= 1_000_000) t.scale = Math.min(1, round2(t.scale + 0.1));
      if (t.bitrate >= 600_000) t.fps = Math.min(30, t.fps + 4);
    }
    if (s.cpuLimited) t.fps = Math.max(LIMITS.minFps, Math.min(t.fps, 20));
    return this.current;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** For the frame stream (no WebRTC): JPEG quality and size from the same target. */
export function frameSettings(p: QualityPreset): { quality: number; scale: number; fps: number } {
  const q = p.bitrate >= 6_000_000 ? 0.85 : p.bitrate >= 2_500_000 ? 0.72 : p.bitrate >= 1_000_000 ? 0.6 : 0.45;
  return { quality: q, scale: p.scale, fps: Math.min(p.fps, 15) };
}
