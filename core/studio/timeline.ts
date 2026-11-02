// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The kept parts of a recording (clips), how the finished video's time maps to
// the recording's, and the edits: split, cut, trim, speed up, and finding the
// idle and silent stretches worth cutting or speeding through.

import { newId, type Clip, type EventLog } from './types';

/** Length of the finished video (ms). */
export function outputDuration(clips: Clip[]): number {
  return clips.reduce((n, c) => n + (c.end - c.start) / c.speed, 0);
}

/** Where a moment of the recording lands in the finished video, or null if it was cut. */
export function srcToOut(clips: Clip[], t: number): number | null {
  let out = 0;
  for (const c of clips) {
    if (t >= c.start && t <= c.end) return out + (t - c.start) / c.speed;
    out += (c.end - c.start) / c.speed;
  }
  return null;
}

/** The recording's moment shown at a time of the finished video (clamped to its ends). */
export function outToSrc(clips: Clip[], o: number): number {
  if (!clips.length) return 0;
  let out = 0;
  for (const c of clips) {
    const len = (c.end - c.start) / c.speed;
    if (o <= out + len) return c.start + Math.max(0, o - out) * c.speed;
    out += len;
  }
  return clips[clips.length - 1].end;
}

/** The clip at a time of the finished video. */
export function clipAtOut(clips: Clip[], o: number): { clip: Clip; index: number; outStart: number } | null {
  let out = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = (clips[i].end - clips[i].start) / clips[i].speed;
    if (o < out + len || i === clips.length - 1) return { clip: clips[i], index: i, outStart: out };
    out += len;
  }
  return null;
}

/** The nearest kept moment at or after `t` (for playback that runs into a cut). */
export function nextKept(clips: Clip[], t: number): number | null {
  for (const c of clips) {
    if (t < c.start) return c.start;
    if (t <= c.end) return t;
  }
  return null;
}

const MIN = 40;

/** Splits the clip under a recording time in two. */
export function split(clips: Clip[], t: number): Clip[] {
  return clips.flatMap((c) => (t - c.start > MIN && c.end - t > MIN ? [{ ...c, end: t }, { ...c, id: newId('c'), start: t }] : [c]));
}

/** Cuts a stretch of the recording out. */
export function cut(clips: Clip[], a: number, b: number): Clip[] {
  if (b < a) [a, b] = [b, a];
  const out: Clip[] = [];
  for (const c of clips) {
    if (b <= c.start || a >= c.end) { out.push(c); continue; }
    if (a - c.start > MIN) out.push({ ...c, end: a });
    if (c.end - b > MIN) out.push({ ...c, id: a - c.start > MIN ? newId('c') : c.id, start: b });
  }
  return out;
}

/** Keeps only [a, b] of the recording. */
export function trim(clips: Clip[], a: number, b: number): Clip[] {
  return clips.map((c) => ({ ...c, start: Math.max(c.start, a), end: Math.min(c.end, b) })).filter((c) => c.end - c.start > MIN);
}

/** Plays a stretch of the recording at another speed (splitting clips at its edges). */
export function setSpeed(clips: Clip[], a: number, b: number, speed: number): Clip[] {
  if (b < a) [a, b] = [b, a];
  return split(split(clips, a), b).map((c) => (c.start >= a - 1 && c.end <= b + 1 ? { ...c, speed } : c));
}

/** Puts a cut stretch back: the gap between two clips is filled again. */
export function restoreGap(clips: Clip[], afterIndex: number): Clip[] {
  const a = clips[afterIndex], b = clips[afterIndex + 1];
  if (!a || !b) return clips;
  if (a.speed === b.speed) return [...clips.slice(0, afterIndex), { ...a, end: b.end }, ...clips.slice(afterIndex + 2)];
  return [...clips.slice(0, afterIndex), a, { id: newId('c'), start: a.end, end: b.start, speed: 1 }, ...clips.slice(afterIndex + 1)];
}

/** Joins neighbours that touch and play at the same speed. */
export function mergeTouching(clips: Clip[]): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const p = out[out.length - 1];
    if (p && Math.abs(p.end - c.start) < 1 && p.speed === c.speed) out[out.length - 1] = { ...p, end: c.end };
    else out.push(c);
  }
  return out;
}

export interface Range { start: number; end: number }

/**
 * Stretches where nothing happens: no clicks, keys or scrolling and the
 * pointer (nearly) still, longer than `minMs`. A margin stays at each end
 * so what comes before and after is not clipped.
 */
export function idleRanges(ev: EventLog, duration: number, o: { minMs?: number; margin?: number; still?: number } = {}): Range[] {
  const minMs = o.minMs ?? 3000, margin = o.margin ?? 500, still = o.still ?? 6;
  const busy: number[] = [...ev.clicks.map((c) => c.t), ...ev.keys.map((k) => k.t), ...ev.scrolls.map((s) => s.t)];
  const m = ev.moves;
  for (let i = 3; i < m.length; i += 3) if (Math.hypot(m[i + 1] - m[i - 2], m[i + 2] - m[i - 1]) > still) busy.push(m[i]);
  busy.sort((a, b) => a - b);
  const out: Range[] = [];
  let last = 0;
  for (const t of [...busy, duration]) {
    if (t - last >= minMs) {
      const s = last === 0 ? 0 : last + margin, e = t === duration ? duration : t - margin;
      if (e - s >= minMs - 2 * margin && e > s) out.push({ start: s, end: e });
    }
    last = Math.max(last, t);
  }
  return out;
}

/**
 * Quiet stretches from a loudness envelope (one value per `stepMs`, 0–1 RMS).
 * Anything below `floor` for longer than `minMs` counts as silence.
 */
export function silentRanges(levels: ArrayLike<number>, stepMs: number, o: { floor?: number; minMs?: number; margin?: number } = {}): Range[] {
  const floor = o.floor ?? 0.015, minMs = o.minMs ?? 1500, margin = o.margin ?? 250;
  const out: Range[] = [];
  let from = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] < floor;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      const s = from * stepMs, e = i * stepMs;
      if (e - s >= minMs) out.push({ start: from === 0 ? 0 : s + margin, end: i === levels.length ? e : e - margin });
      from = -1;
    }
  }
  return out;
}

/** Stretches that are in both lists (idle and silent). */
export function intersect(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return out.sort((p, q) => p.start - q.start);
}

/** Applies the automatic clean-up: each stretch is cut, or sped through. */
export function applyRanges(clips: Clip[], ranges: Range[], how: 'cut' | 'speed', speed = 6, minMs = 800): Clip[] {
  let out = clips;
  for (const r of ranges) {
    if (r.end - r.start < minMs) continue;
    out = how === 'cut' ? cut(out, r.start, r.end) : setSpeed(out, r.start, r.end, speed);
  }
  return out;
}
