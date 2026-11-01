// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Live readings, only while someone looks: a monitor page, the pop-over or
// the menu-bar readings. Each looker asks for an interval; the fastest wins.
// With no lookers there is no timer at all. Readings go through the
// governor, so they slow down while the person is away and stop while the
// screen is locked.

import type { LiveReading, TrayMetric } from '../../core/monitor-tray';
import { pushRing } from '../../core/monitor-tray';
import { poll } from './governor';
import { LiveSampler } from './monitor-probe';
import { readBattery } from './system';

interface Watcher { everyMs: number; metrics?: TrayMetric[] }

const watchers = new Map<string, Watcher>();
const listeners = new Set<(r: LiveReading) => void>();
const sampler = new LiveSampler();
let recent: LiveReading[] = [];
let stopPoll: (() => void) | null = null;

function fastest(): number {
  let ms = Infinity;
  for (const w of watchers.values()) ms = Math.min(ms, w.everyMs);
  return Number.isFinite(ms) ? ms : 60_000;
}

function wanted(): Set<TrayMetric> {
  const s = new Set<TrayMetric>();
  for (const w of watchers.values()) for (const m of w.metrics ?? []) s.add(m);
  return s;
}

async function tick() {
  const want = wanted();
  const r = await sampler.read({
    gpu: want.has('gpu'), temp: want.has('temp'), power: want.has('power'),
    battery: want.has('battery') || want.has('power') ? () => readBattery() : undefined,
  });
  recent = pushRing(recent, r, 120);
  for (const l of listeners) {
    try {
      l(r);
    } catch {
      /* a listener failing does not stop readings */
    }
  }
}

function reschedule() {
  if (!watchers.size) {
    stopPoll?.();
    stopPoll = null;
    // Nobody looks: forget the readings too.
    recent = [];
    return;
  }
  // The rule is read on every round, so a faster looker takes effect at the next reading.
  if (!stopPoll) stopPoll = poll('monitor-live', () => ({ baseMs: fastest(), pauseWhenLocked: true, idleFactor: 3, maxMs: 30_000 }), tick, { feature: 'health' });
}

/** Starts (or changes) live readings for one looker. */
export function watchLive(id: string, everyMs: number, metrics?: TrayMetric[]) {
  watchers.set(id, { everyMs: Math.max(1000, everyMs), metrics });
  reschedule();
}

export function unwatchLive(id: string) {
  if (!watchers.delete(id)) return;
  reschedule();
}

export function onLive(fn: (r: LiveReading) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function liveState(): { latest?: LiveReading; recent: LiveReading[] } {
  return { latest: recent[recent.length - 1], recent: recent.slice(-60) };
}

export function liveWatchers(): string[] {
  return [...watchers.keys()];
}
