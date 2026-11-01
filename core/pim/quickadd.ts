// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "lunch with Ana Friday 1pm", "dentist tomorrow 15:30 for 45 min",
// "standup every weekday 9:15", "trip 12–15 March", "call mum in 2 hours at
// home" → a new event. English only; runs on the computer, nothing is sent.

export interface QuickEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  rrule?: string;
  location?: string;
  /** minutes before, when the text asked ("remind me 10 min before") */
  alarm?: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*';
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const TIME_RE = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';

function dayIndex(s: string): number {
  return DAYS.indexOf(s.slice(0, 3).toLowerCase());
}

function monthIndex(s: string): number {
  return MONTHS.indexOf(s.slice(0, 3).toLowerCase());
}

function toHours(h: string, m?: string, ap?: string): { h: number; m: number } | null {
  let hh = Number(h);
  const mm = Number(m ?? 0);
  if (hh > 23 || mm > 59) return null;
  const p = ap?.replace(/\./g, '').toLowerCase();
  if (p === 'pm' && hh < 12) hh += 12;
  if (p === 'am' && hh === 12) hh = 0;
  return { h: hh, m: mm };
}

export function parseQuickAdd(input: string, now = Date.now()): QuickEvent | null {
  let s = ` ${input.trim()} `;
  if (!s.trim()) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let date: Date | null = null;
  let endDate: Date | null = null;
  let time: { h: number; m: number } | null = null;
  let endTime: { h: number; m: number } | null = null;
  let durationMin: number | null = null;
  let rrule: string | undefined;
  let location: string | undefined;
  let alarm: number | undefined;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = s.match(re);
    if (m && fn(m) !== false) s = s.replace(m[0], ' ');
  };

  take(/\bremind me (\d+)\s*(min|minutes|m|hours?|h)\s*before\b/i, (m) => { alarm = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1); });
  // Repeats.
  take(/\bevery\s+weekday\b/i, () => { rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; });
  take(/\bevery\s+day\b|\bdaily\b/i, () => { rrule = 'FREQ=DAILY'; });
  take(new RegExp(`\\bevery\\s+(other\\s+)?${DAY_RE}\\b`, 'i'), (m) => {
    const d = dayIndex(m[2]);
    rrule = `FREQ=WEEKLY;${m[1] ? 'INTERVAL=2;' : ''}BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]}`;
    const t = new Date(today);
    t.setDate(t.getDate() + ((d - t.getDay() + 7) % 7));
    date = t;
  });
  take(/\bevery\s+week\b|\bweekly\b/i, () => { rrule = 'FREQ=WEEKLY'; });
  take(/\bevery\s+month\b|\bmonthly\b/i, () => { rrule = 'FREQ=MONTHLY'; });
  take(/\bevery\s+year\b|\byearly\b|\bannually\b/i, () => { rrule = 'FREQ=YEARLY'; });

  // Durations: "for 2 hours", "for 45 min", "in 2 hours" (start relative to now).
  take(/\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i, (m) => { durationMin = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1); });
  take(/\bin\s+(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|weeks?)\b/i, (m) => {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (/^d/.test(unit) || /^w/.test(unit)) {
      const t = new Date(today);
      t.setDate(t.getDate() + n * (/^w/.test(unit) ? 7 : 1));
      date = t;
    } else {
      const t = new Date(now + n * (/^h/.test(unit) ? 3_600_000 : 60_000));
      date = new Date(t);
      date.setHours(0, 0, 0, 0);
      time = { h: t.getHours(), m: t.getMinutes() };
    }
  });

  // Date ranges: "12-15 March", "March 12-15".
  take(new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|to|until)\\s*(\\d{1,2})\\s+${MONTH_RE}\\b`, 'i'), (m) => {
    const mo = monthIndex(m[3]);
    date = new Date(today.getFullYear(), mo, Number(m[1]));
    endDate = new Date(today.getFullYear(), mo, Number(m[2]));
  });
  take(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})\\s*(?:-|–|to|until)\\s*(\\d{1,2})\\b`, 'i'), (m) => {
    const mo = monthIndex(m[1]);
    date = new Date(today.getFullYear(), mo, Number(m[2]));
    endDate = new Date(today.getFullYear(), mo, Number(m[3]));
  });
  // Single dates.
  take(/\btoday\b|\btonight\b/i, (m) => { date = new Date(today); if (/tonight/i.test(m[0]) && !time) time = { h: 19, m: 0 }; });
  take(/\btomorrow\b/i, () => { date = new Date(today); date.setDate(date.getDate() + 1); });
  take(new RegExp(`\\b(next\\s+|this\\s+|on\\s+)?${DAY_RE}\\b`, 'i'), (m) => {
    if (date) return false;
    const d = dayIndex(m[2]);
    const t = new Date(today);
    let add = (d - t.getDay() + 7) % 7;
    // "Friday" on a Friday is today; "next Friday" on a Friday is a week away.
    if (add === 0 && /next/i.test(m[1] ?? '')) add = 7;
    t.setDate(t.getDate() + add);
    date = t;
  });
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, 'i'), (m) => {
    if (date) return false;
    date = new Date(m[3] ? Number(m[3]) : today.getFullYear(), monthIndex(m[2]), Number(m[1]));
  });
  take(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (m) => {
    if (date) return false;
    date = new Date(m[3] ? Number(m[3]) : today.getFullYear(), monthIndex(m[1]), Number(m[2]));
  });
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { date = new Date(+m[1], +m[2] - 1, +m[3]); });
  // Times: "10-11am", "1pm", "15:30", "at 9", "noon".
  take(/\bnoon\b|\bmidday\b/i, () => { time = { h: 12, m: 0 }; });
  take(/\bmidnight\b/i, () => { time = { h: 0, m: 0 }; });
  take(new RegExp(`\\b${TIME_RE}\\s*(?:-|–|to|until)\\s*${TIME_RE}`, 'i'), (m) => {
    if (!m[3] && !m[6] && !m[2] && !m[5]) return false;
    const ap = m[6] ?? m[3];
    const a = toHours(m[1], m[2], m[3] ?? (Number(m[1]) <= Number(m[4]) ? ap : undefined));
    const b = toHours(m[4], m[5], m[6] ?? m[3]);
    if (!a || !b) return false;
    time = a;
    endTime = b;
  });
  take(new RegExp(`\\b(?:at\\s+)?${TIME_RE}(?=\\s|$)`, 'i'), (m) => {
    if (time) return false;
    if (!m[3] && !m[2] && !/\bat\s/i.test(m[0])) return false;
    let t = toHours(m[1], m[2], m[3]);
    if (!t) return false;
    // "at 3" means the afternoon; "at 9" the morning.
    if (!m[3] && t.h >= 1 && t.h <= 6) t = { h: t.h + 12, m: t.m };
    time = t;
  });
  // Location: "at the office", "@ Café Sol" (after times are taken).
  take(/\s(?:@|at)\s+([^@]+?)\s*$/i, (m) => { location = m[1].trim(); });

  const title = s.replace(/\s+/g, ' ').replace(/\b(on|at|from)\s*$/i, '').trim() || 'New event';
  const d0: Date = date ?? new Date(today);
  if (!date && time) {
    // A time that already passed today means tomorrow.
    const t = new Date(d0);
    t.setHours((time as { h: number; m: number }).h, (time as { h: number; m: number }).m);
    if (t.getTime() < now - 60_000 && !rrule) d0.setDate(d0.getDate() + 1);
  }
  if (!time) {
    const start = d0.getTime();
    const end = new Date(endDate ?? d0);
    end.setDate(end.getDate() + 1);
    return { title, start, end: end.getTime(), allDay: true, rrule, location, alarm };
  }
  const tm = time as { h: number; m: number };
  const start = new Date(d0);
  start.setHours(tm.h, tm.m, 0, 0);
  let end: number;
  if (endTime) {
    const e = new Date(start);
    e.setHours((endTime as { h: number; m: number }).h, (endTime as { h: number; m: number }).m, 0, 0);
    if (e <= start) e.setDate(e.getDate() + 1);
    end = e.getTime();
  } else end = start.getTime() + (durationMin ?? 60) * 60_000;
  return { title, start: start.getTime(), end, allDay: false, rrule, location, alarm };
}
