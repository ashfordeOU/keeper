// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When a scheduled request runs next, from plain words or a cron line:
//   "every day at 8:30", "every weekday at 9", "every monday 10:00",
//   "every 2 hours", "every morning", "in 20 minutes", "tomorrow at 9",
//   "at 18:00", "on 2026-12-24 at 10", "0 9 * * 1-5"

export interface Schedule {
  /** minutes past midnight, for the kinds that run at a time of day */
  at?: number;
  /** 0 = Sunday … 6 = Saturday */
  days?: number[];
  everyMinutes?: number;
  /** one moment */
  once?: number;
  cron?: CronSpec;
  /** a short description in plain words */
  label: string;
}

interface CronSpec { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PARTS: Record<string, number> = { morning: 8 * 60, noon: 12 * 60, midday: 12 * 60, afternoon: 15 * 60, evening: 18 * 60, night: 21 * 60, midnight: 0 };

function parseTime(s: string): number | undefined {
  const m = s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}

function field(s: string, lo: number, hi: number): Set<number> {
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const [range, stepS] = part.split('/');
    const step = Number(stepS ?? 1);
    let [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number);
    if (b === undefined) b = stepS ? hi : a;
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(step > 0) || a < lo || b > hi) throw new Error(`“${s}” is not a valid cron field`);
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 7 ? 0 : v);
  }
  return out;
}

export function parseSchedule(text: string, now = Date.now()): Schedule {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^[\d*,/-]+( [\d*,/-]+){4}$/.test(t)) {
    const [mi, h, dom, mon, dow] = t.split(' ');
    return { cron: { min: field(mi, 0, 59), hour: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 7), domStar: dom === '*', dowStar: dow === '*' }, label: `cron ${t}` };
  }
  let m = t.match(/^in (\d+) ?(minute|min|hour|hr|day)s?$/);
  if (m) {
    const n = Number(m[1]) * (m[2].startsWith('h') ? 60 : m[2] === 'day' ? 1440 : 1);
    return { once: now + n * 60_000, label: `in ${m[1]} ${m[2]}${Number(m[1]) === 1 ? '' : 's'}` };
  }
  m = t.match(/^every (\d+)? ?(minute|min|hour|hr)s?$/);
  if (m) {
    const n = Math.max(m[2].startsWith('h') ? 1 : 5, Number(m[1] ?? 1)) * (m[2].startsWith('h') ? 60 : 1);
    return { everyMinutes: n, label: `every ${n >= 60 ? `${n / 60} hour${n === 60 ? '' : 's'}` : `${n} minutes`}` };
  }
  const time = (s: string) => PARTS[(s.match(/morning|noon|midday|afternoon|evening|night|midnight/) ?? [''])[0]] ?? parseTime(s.replace(/^.*\bat\b/, '')) ;
  m = t.match(/^(tomorrow|today)(?: at)? ?(.*)$/);
  if (m) {
    const at = time(m[2]) ?? 9 * 60;
    const d = new Date(now);
    if (m[1] === 'tomorrow') d.setDate(d.getDate() + 1);
    d.setHours(Math.floor(at / 60), at % 60, 0, 0);
    return { once: d.getTime(), label: `${m[1]} at ${fmt(at)}` };
  }
  m = t.match(/^on (\d{4}-\d{2}-\d{2})(?: at)? ?(.*)$/);
  if (m) {
    const at = time(m[2]) ?? 9 * 60;
    const [y, mo, da] = m[1].split('-').map(Number);
    return { once: new Date(y, mo - 1, da, Math.floor(at / 60), at % 60).getTime(), label: `on ${m[1]} at ${fmt(at)}` };
  }
  m = t.match(/^at (.+)$/);
  if (m && time(m[1]) !== undefined) {
    const at = time(m[1])!;
    const d = new Date(now);
    d.setHours(Math.floor(at / 60), at % 60, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return { once: d.getTime(), label: `at ${fmt(at)}` };
  }
  m = t.match(/^every ?(day|weekday|weekend|morning|evening|night|afternoon|(?:(?:sun|mon|tues|tue|wednes|wed|thurs|thu|fri|satur|sat)(?:day)?s?(?:,? (?:and )?)?)+)(?: at)? ?(.*)$/);
  if (m) {
    const what = m[1];
    let days: number[] | undefined;
    if (what === 'weekday') days = [1, 2, 3, 4, 5];
    else if (what === 'weekend') days = [0, 6];
    else if (!['day', 'morning', 'evening', 'night', 'afternoon'].includes(what)) {
      days = DAYS.map((d, i) => (new RegExp(`\\b${d.slice(0, 3)}`).test(what) ? i : -1)).filter((i) => i >= 0);
    }
    const at = (PARTS[what] ?? time(m[2])) ?? 9 * 60;
    const label = `every ${days ? (what === 'weekday' || what === 'weekend' ? what : days.map((d) => DAYS[d][0].toUpperCase() + DAYS[d].slice(1, 3)).join(', ')) : 'day'} at ${fmt(at)}`;
    return { at, days, label };
  }
  throw new Error(`Keeper does not understand “${text}”. Try “every weekday at 8:30”, “every monday 10:00”, “in 2 hours”, “tomorrow at 9” or a cron line like “0 9 * * 1-5”.`);
}

function fmt(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** The next moment after `after` this schedule runs, or undefined when it never runs again. */
export function nextRun(s: Schedule, after: number, lastRun?: number): number | undefined {
  if (s.once !== undefined) return lastRun ? undefined : s.once > after ? s.once : after;
  if (s.everyMinutes) return Math.max(after, (lastRun ?? after - s.everyMinutes * 60_000) + s.everyMinutes * 60_000);
  if (s.cron) {
    const d = new Date(after);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const c = s.cron;
      const domOk = c.dom.has(d.getDate());
      const dowOk = c.dow.has(d.getDay());
      const dayOk = c.domStar || c.dowStar ? domOk && dowOk : domOk || dowOk;
      if (c.min.has(d.getMinutes()) && c.hour.has(d.getHours()) && c.mon.has(d.getMonth() + 1) && dayOk) return d.getTime();
      d.setMinutes(d.getMinutes() + 1);
    }
    return undefined;
  }
  const at = s.at ?? 9 * 60;
  const d = new Date(after);
  for (let i = 0; i < 8; i++) {
    const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, Math.floor(at / 60), at % 60, 0, 0);
    if (cand.getTime() <= after) continue;
    if (s.days && !s.days.includes(cand.getDay())) continue;
    return cand.getTime();
  }
  return undefined;
}

/** Tasks due now: their next run (after the last one) has come. */
export function dueTasks<T extends { id: string; when: string; enabled: boolean; lastRun?: number; createdAt?: number }>(tasks: T[], now: number): T[] {
  return tasks.filter((t) => {
    if (!t.enabled) return false;
    try {
      const s = parseSchedule(t.when, t.createdAt ?? t.lastRun ?? now - 60_000);
      const from = t.lastRun ?? t.createdAt ?? now - 60_000;
      const next = nextRun(s, from, t.lastRun);
      return next !== undefined && next <= now;
    } catch {
      return false;
    }
  });
}
