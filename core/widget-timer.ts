// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Timer widget's state. A running timer is one of Keeper's own countdown
// timers (so it rings in the Island even when the widget is closed); this
// reads it for the ring and the digits, and works out Start, Pause, Reset and
// "+1 min". Pure.

/** A countdown timer as the calendar service keeps it (CountdownTimer). */
export interface TimerLike { durationMs: number; endsAt?: number; leftMs?: number }

export const TIMER_PRESETS = [5, 10, 15, 25];
export const MAX_TIMER_MIN = 24 * 60;

export interface TimerView {
  state: 'idle' | 'running' | 'paused';
  leftMs: number;
  totalMs: number;
  /** how much is left, 1 → 0, for the ring */
  fraction: number;
}

/** Clean minutes from settings: whole minutes from 1 to a day. */
export function cleanMinutes(v: unknown, d = 25): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_TIMER_MIN, Math.max(1, Math.round(v))) : d;
}

/** What to show: the running or paused timer, else the chosen minutes, full. */
export function timerView(t: TimerLike | undefined, minutes: number, now = Date.now()): TimerView {
  const preset = cleanMinutes(minutes) * 60_000;
  if (!t) return { state: 'idle', leftMs: preset, totalMs: preset, fraction: 1 };
  const total = Math.max(1, t.durationMs);
  const running = t.endsAt !== undefined;
  const left = Math.max(0, running ? t.endsAt! - now : t.leftMs ?? total);
  return { state: running ? 'running' : 'paused', leftMs: left, totalMs: total, fraction: Math.min(1, left / total) };
}

/** One more minute: a running timer ends a minute later; a paused one has a minute more left; both count it in the total. */
export function extendTimer<T extends TimerLike>(t: T, ms = 60_000, now = Date.now()): T {
  if (t.endsAt !== undefined) return { ...t, durationMs: t.durationMs + ms, endsAt: Math.max(t.endsAt, now) + ms };
  return { ...t, durationMs: t.durationMs + ms, leftMs: (t.leftMs ?? t.durationMs) + ms };
}

/** "+1 min" with no timer going: the chosen minutes, one more. */
export const plusMinute = (minutes: number) => cleanMinutes(cleanMinutes(minutes) + 1);

/** "25:00", "4:05", "1:02:03": rounded up so a timer never shows 0:00 while it still runs. */
export function timerText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
