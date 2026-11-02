// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing the event log while recording: pointer samples, clicks, keys,
// scrolling and the app in front, each stamped with the time since the
// picture's first frame and turned into the picture's own pixels. Pauses
// become cuts in the timeline (the parts are kept out of the video).

import type { Mod } from '../stage/overlay';
import { emptyEvents, type EventLog } from './types';

export interface Region {
  /** the recorded part of the screen, in screen points (the coordinates the pointer is read in) */
  x: number; y: number; w: number; h: number;
  /** pixels per point in the picture */
  scale: number;
}

export class EventRecorder {
  private log: EventLog = emptyEvents();
  private t0 = NaN;
  private pausedAt: number | null = null;
  private lastMove = { x: NaN, y: NaN, t: -1 };
  private wallPauses: { start: number; end: number }[] = [];

  constructor(private region: Region, private now: () => number = () => Date.now()) {}

  /** The picture's first frame was taken at this wall-clock time; times in the finished log count from it. */
  setStart(wall: number) { this.t0 = wall; }

  /** Times are kept as wall-clock times until the end, so the first frame's time can arrive late. */
  private time(wall = this.now()): number { return wall; }

  /** Paused stretches in the picture's time (ms). */
  get pauses(): { start: number; end: number }[] {
    const t0 = Number.isFinite(this.t0) ? this.t0 : 0;
    return this.wallPauses.map((p) => ({ start: Math.max(0, p.start - t0), end: Math.max(0, p.end - t0) }));
  }

  get paused() { return this.pausedAt !== null; }

  pause() { if (this.pausedAt === null) this.pausedAt = this.time(); }

  resume() {
    if (this.pausedAt === null) return;
    const end = this.time();
    if (end - this.pausedAt > 50) this.wallPauses.push({ start: this.pausedAt, end });
    this.pausedAt = null;
  }

  /** Screen point → picture pixel. */
  map(p: { x: number; y: number }): { x: number; y: number } {
    return { x: Math.round((p.x - this.region.x) * this.region.scale * 10) / 10, y: Math.round((p.y - this.region.y) * this.region.scale * 10) / 10 };
  }

  move(p: { x: number; y: number }, wall = this.now()) {
    if (this.paused) return;
    const t = this.time(wall);
    const q = this.map(p);
    if (q.x === this.lastMove.x && q.y === this.lastMove.y && t - this.lastMove.t < 1000) return;
    // keep times increasing
    if (t <= this.lastMove.t) return;
    this.log.moves.push(Math.round(t), q.x, q.y);
    this.lastMove = { x: q.x, y: q.y, t };
  }

  click(p: { x: number; y: number }, right = false, wall = this.now()) {
    if (this.paused) return;
    const q = this.map(p);
    this.log.clicks.push({ t: Math.round(this.time(wall)), x: q.x, y: q.y, right: right || undefined });
  }

  key(key: string, mods: Mod[], wall = this.now()) {
    if (this.paused) return;
    this.log.keys.push({ t: Math.round(this.time(wall)), key, mods });
  }

  scroll(p: { x: number; y: number }, dy: number, wall = this.now()) {
    if (this.paused) return;
    const q = this.map(p);
    this.log.scrolls.push({ t: Math.round(this.time(wall)), x: q.x, y: q.y, dy });
  }

  focus(app: string, title?: string, wall = this.now()) {
    const last = this.log.focus[this.log.focus.length - 1];
    if (last && last.app === app && last.title === title) return;
    this.log.focus.push({ t: Math.round(this.time(wall)), app, title });
  }

  /** The finished log: events before the first frame and after `duration` dropped, everything sorted. */
  finish(duration: number): EventLog {
    if (this.pausedAt !== null) this.resume();
    const t0 = Number.isFinite(this.t0) ? this.t0 : (this.log.moves[0] ?? 0);
    const keep = <T extends { t: number }>(a: T[]) => a.map((e) => ({ ...e, t: e.t - t0 })).filter((e) => e.t >= 0 && e.t <= duration).sort((x, y) => x.t - y.t);
    // the app in front at the start counts from 0
    const focus = this.log.focus.map((e) => ({ ...e, t: Math.max(0, e.t - t0) })).filter((e) => e.t <= duration);
    const lastBefore = focus.reduce((n, e, i) => (e.t === 0 ? i : n), -1);
    const m = this.log.moves;
    const moves: number[] = [];
    // the pointer's place at the first frame: the last sample before it
    let before = -1;
    for (let i = 0; i < m.length; i += 3) if (m[i] - t0 < 0) before = i;
    if (before >= 0) moves.push(0, m[before + 1], m[before + 2]);
    for (let i = 0; i < m.length; i += 3) { const t = m[i] - t0; if (t >= 0 && t <= duration && !(t === 0 && moves.length)) moves.push(t, m[i + 1], m[i + 2]); }
    return { moves, clicks: keep(this.log.clicks), keys: keep(this.log.keys), scrolls: keep(this.log.scrolls), focus: focus.slice(Math.max(0, lastBefore)) };
  }
}

/** The clips that leave the paused stretches out. */
export function clipsWithoutPauses(duration: number, pauses: { start: number; end: number }[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (const p of [...pauses].sort((a, b) => a.start - b.start)) {
    if (p.start > from) out.push({ start: from, end: Math.min(duration, p.start) });
    from = Math.max(from, p.end);
  }
  if (from < duration) out.push({ start: from, end: duration });
  return out.filter((c) => c.end - c.start > 40);
}
