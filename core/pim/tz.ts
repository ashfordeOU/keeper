// SPDX-License-Identifier: AGPL-3.0-or-later
// Wall-clock time in a named time zone, with the system's own zone data
// (Intl), so daylight-saving changes come out right without a bundled database.

export interface Wall {
  y: number;
  /** 1–12 */
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time in `tz` at instant `t` (local zone when tz is undefined). */
export function toWall(t: number, tz?: string): Wall {
  if (!tz) {
    const d = new Date(t);
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  }
  const parts: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(t))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second };
}

/**
 * The instant at which `tz` shows wall time `w` (local zone when tz is undefined).
 * Times skipped by a spring-forward change move forward by the gap; times that
 * happen twice at fall-back take the first one, as calendars do.
 */
export function fromWall(w: Wall, tz?: string): number {
  if (!tz) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  // offset = wall-as-UTC minus instant; two rounds settle across a change.
  let t = guess - offsetAt(guess, tz);
  const t2 = guess - offsetAt(t, tz);
  if (t2 !== t) {
    // Ambiguous or skipped: prefer the earlier instant that still shows the asked wall time.
    const a = Math.min(t, t2);
    const b = Math.max(t, t2);
    t = sameWall(toWall(a, tz), w) ? a : sameWall(toWall(b, tz), w) ? b : Math.max(t, t2);
  }
  return t;
}

function sameWall(a: Wall, b: Wall) {
  return a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

/** Milliseconds `tz` is ahead of UTC at instant t. */
export function offsetAt(t: number, tz: string): number {
  const w = toWall(t, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Days in a month (mo 1–12). */
export function daysIn(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** 0 = Sunday, for a calendar date. */
export function weekday(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Adds days to a calendar date, staying on the calendar (no zone involved). */
export function addDays(w: Wall, n: number): Wall {
  const d = new Date(Date.UTC(w.y, w.mo - 1, w.d + n));
  return { ...w, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** ISO 8601 week number. */
export function isoWeek(t: number): number {
  const d = new Date(t);
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
}
