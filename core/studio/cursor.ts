// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pointer Studio draws: its recorded path made smooth with a critically
// damped spring (no overshoot), led slightly so it does not trail behind what
// it points at, pinned to the spot of each click, faded out while it rests,
// with a ripple on each click. Everything is worked out once, on a fixed step,
// so the preview and every export draw exactly the same pointer.

import type { CursorStyle, EventLog } from './types';

/** Samples per second of the worked-out tracks. */
export const TRACK_HZ = 120;
const DT = 1000 / TRACK_HZ;

export interface Track {
  /** x, y per step */
  xy: Float32Array;
  /** speed in pixels per second per step */
  speed: Float32Array;
  steps: number;
}

/** Linear interpolation of the raw samples at time t (held before the first and after the last). */
export function rawAt(moves: number[], t: number, hint = { i: 0 }): [number, number] {
  const n = moves.length / 3;
  if (!n) return [NaN, NaN];
  if (t <= moves[0]) return [moves[1], moves[2]];
  if (t >= moves[(n - 1) * 3]) return [moves[(n - 1) * 3 + 1], moves[(n - 1) * 3 + 2]];
  let i = Math.min(Math.max(0, hint.i), n - 2);
  if (moves[i * 3] > t) i = 0;
  while (i < n - 2 && moves[(i + 1) * 3] <= t) i++;
  hint.i = i;
  const t0 = moves[i * 3], t1 = moves[(i + 1) * 3];
  const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [moves[i * 3 + 1] + (moves[(i + 1) * 3 + 1] - moves[i * 3 + 1]) * k, moves[i * 3 + 2] + (moves[(i + 1) * 3 + 2] - moves[i * 3 + 2]) * k];
}

/** Spring stiffness (rad/s) for a smoothing amount 0–1. */
export const omegaFor = (smoothing: number) => 40 - 32 * Math.min(1, Math.max(0, smoothing));

/**
 * Steps a critically damped spring toward a target. Exact for a target that
 * holds still over the step, so it is stable at any step size.
 */
export function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const d = x - target;
  const e = Math.exp(-omega * dt);
  const c = v + omega * d;
  return [target + (d + c * dt) * e, (v - omega * c * dt) * e];
}

/** The smoothed pointer path over the whole recording. */
export function smoothPath(ev: EventLog, duration: number, smoothing: number): Track {
  const steps = Math.max(1, Math.ceil(duration / DT) + 1);
  const xy = new Float32Array(steps * 2);
  const speed = new Float32Array(steps);
  if (!ev.moves.length) { xy.fill(NaN); return { xy, speed, steps }; }
  const omega = omegaFor(smoothing);
  // A critically damped spring trails its target by about 2/ω; lead the target by that much.
  const lead = smoothing > 0 ? 2000 / omega : 0;
  const hint = { i: 0 }, hint2 = { i: 0 };
  let [x, y] = rawAt(ev.moves, 0, hint);
  let vx = 0, vy = 0;
  const clicks = ev.clicks;
  let ci = 0;
  for (let s = 0; s < steps; s++) {
    const t = s * DT;
    const [tx, ty] = rawAt(ev.moves, t + lead, hint);
    if (smoothing > 0) {
      // sub-steps keep it accurate on fast moves
      for (let k = 0; k < 4; k++) {
        [x, vx] = springStep(x, vx, tx, omega, DT / 4000);
        [y, vy] = springStep(y, vy, ty, omega, DT / 4000);
      }
    } else { x = tx; y = ty; }
    // Pinned to the exact spot around each click: blend in over 60 ms either side.
    while (ci < clicks.length && clicks[ci].t < t - 120) ci++;
    let px = x, py = y;
    for (let j = ci; j < clicks.length && clicks[j].t <= t + 120; j++) {
      const w = Math.max(0, 1 - Math.max(0, Math.abs(clicks[j].t - t) - 60) / 60);
      if (w > 0) { const [rx, ry] = rawAt(ev.moves, t, hint2); px += (rx - px) * w; py += (ry - py) * w; }
    }
    xy[s * 2] = px; xy[s * 2 + 1] = py;
    if (s > 0) speed[s] = Math.hypot(px - xy[s * 2 - 2], py - xy[s * 2 - 1]) * TRACK_HZ;
  }
  return { xy, speed, steps };
}

/** A track's value at time t (linear between steps). */
export function trackAt(tr: Track, t: number): { x: number; y: number; speed: number } {
  const f = Math.min(tr.steps - 1, Math.max(0, t / DT));
  const i = Math.floor(f), j = Math.min(tr.steps - 1, i + 1), k = f - i;
  return {
    x: tr.xy[i * 2] + (tr.xy[j * 2] - tr.xy[i * 2]) * k,
    y: tr.xy[i * 2 + 1] + (tr.xy[j * 2 + 1] - tr.xy[i * 2 + 1]) * k,
    speed: tr.speed[i] + (tr.speed[j] - tr.speed[i]) * k,
  };
}

/** Times the pointer last moved, for hiding it while it rests: sorted move times where it really moved. */
export function movementTimes(ev: EventLog, still = 2): number[] {
  const m = ev.moves, out: number[] = [];
  for (let i = 3; i < m.length; i += 3) if (Math.hypot(m[i + 1] - m[i - 2], m[i + 2] - m[i - 1]) > still) out.push(m[i]);
  for (const c of ev.clicks) out.push(c.t);
  return out.sort((a, b) => a - b);
}

function lastAtOrBefore(sorted: number[], t: number): number {
  let lo = 0, hi = sorted.length - 1, ans = -Infinity;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= t) { ans = sorted[mid]; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

function firstAfter(sorted: number[], t: number): number {
  let lo = 0, hi = sorted.length - 1, ans = Infinity;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid] > t) { ans = sorted[mid]; hi = mid - 1; } else lo = mid + 1; }
  return ans;
}

/** 0–1: how visible the pointer is (fades out after resting `idleMs`, back in just before it moves). */
export function cursorOpacity(moved: number[], t: number, style: Pick<CursorStyle, 'hideIdle' | 'idleMs'>): number {
  if (!style.hideIdle || !moved.length) return 1;
  const last = lastAtOrBefore(moved, t);
  const next = firstAfter(moved, t);
  const out = last === -Infinity ? 0 : Math.min(1, Math.max(0, 1 - (t - last - style.idleMs) / 300));
  const back = next === Infinity ? 0 : Math.min(1, Math.max(0, 1 - (next - t) / 150));
  // still at the very start: shown until the first idle period ends
  const start = last === -Infinity && t < style.idleMs ? 1 : 0;
  return Math.max(out, back, start);
}

export interface Ripple { x: number; y: number; /** 0–1 through the ripple */ k: number; right: boolean }

export const RIPPLE_MS = 450;

/** Click ripples showing at time t. */
export function ripplesAt(ev: EventLog, t: number): Ripple[] {
  const out: Ripple[] = [];
  for (const c of ev.clicks) {
    if (c.t > t) break;
    if (t - c.t < RIPPLE_MS) out.push({ x: c.x, y: c.y, k: (t - c.t) / RIPPLE_MS, right: !!c.right });
  }
  return out;
}

/** The pointer shrinks a little as a click lands, then springs back. */
export function clickPress(ev: EventLog, t: number): number {
  let p = 0;
  for (const c of ev.clicks) {
    const d = t - c.t;
    if (d < -80) break;
    if (d >= -80 && d < 200) p = Math.max(p, d < 0 ? 1 + d / 80 : 1 - d / 200);
  }
  return 1 - 0.18 * p;
}
