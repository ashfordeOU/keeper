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
  /** what the text named: a date (or a repeat that sets one) and a time of day */
  found?: { date: boolean; time: boolean };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Whole day names or their short forms only ("month" or "monster" is not Monday).
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?';
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

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseQuickAdd(input: string, now = Date.now(), opts: { location?: boolean } = {}): QuickEvent | null {
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
  // a day and month without a year: one already gone this year means next year
  let yearless = false;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = s.match(re);
    if (m && fn(m) !== false) s = s.replace(m[0], ' ');
  };

  take(/\bremind me (\d+)\s*(min|minutes|m|hours?|h)\s*before\b/i, (m) => { alarm = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1); });
  // Repeats.
  take(/\bevery\s+weekday\b/i, () => { rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; });
  take(/\bevery\s+day\b|\bdaily\b/i, () => { rrule = 'FREQ=DAILY'; });
  // "every 2 weeks", "every 3 days"
  take(/\bevery\s+(\d{1,2})\s+(day|week|month|year)s?\b/i, (m) => {
    const n = Number(m[1]);
    if (n < 1) return false;
    rrule = `FREQ=${({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' } as Record<string, string>)[m[2].toLowerCase()]}${n > 1 ? `;INTERVAL=${n}` : ''}`;
  });
  // "every Mon and Thu", "every Monday, Wednesday & Friday"
  take(new RegExp(`\\bevery\\s+(${DAY_RE}(?:\\s*(?:,|and|&)\\s*${DAY_RE})+)\\b`, 'i'), (m) => {
    const days = [...new Set(m[1].split(/\s*(?:,|and|&)\s*/i).map(dayIndex).filter((d) => d >= 0))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (days.length < 2) return false;
    rrule = `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`;
    // Starts on the first of those days from today.
    const t = new Date(today);
    t.setDate(t.getDate() + Math.min(...days.map((d) => (d - t.getDay() + 7) % 7)));
    date = t;
  });
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
    yearless = !m[3];
  });
  take(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (m) => {
    if (date) return false;
    date = new Date(m[3] ? Number(m[3]) : today.getFullYear(), monthIndex(m[1]), Number(m[2]));
    yearless = !m[3];
  });
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { date = new Date(+m[1], +m[2] - 1, +m[3]); });
  // "12/20" (month first, unless the first number cannot be a month) and "20.12." (day first).
  const year = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : undefined);
  take(/(?:^|\s)(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s|$)/i, (m) => {
    if (date) return false;
    let mo = Number(m[1]);
    let d = Number(m[2]);
    if (mo > 12) [mo, d] = [d, mo];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    date = new Date(year(m[3]) ?? today.getFullYear(), mo - 1, d);
    yearless = !m[3];
  });
  take(/(?:^|\s)(?:on\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?(?=\s|$)/i, (m) => {
    if (date) return false;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    date = new Date(year(m[3]) ?? today.getFullYear(), mo - 1, d);
    yearless = !m[3];
  });
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
  if (opts.location !== false) take(/\s(?:@|at)\s+([^@]+?)\s*$/i, (m) => { location = m[1].trim(); });
  const found = { date: date !== null, time: time !== null };

  const title = s.replace(/\s+/g, ' ').replace(/\b(on|at|from)\s*$/i, '').trim() || 'New event';
  const d0: Date = date ?? new Date(today);
  if (yearless && !rrule && d0.getTime() < today.getTime() - 7 * 86_400_000) {
    d0.setFullYear(d0.getFullYear() + 1);
    (endDate as Date | null)?.setFullYear((endDate as unknown as Date).getFullYear() + 1);
  }
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
    return { title, start, end: end.getTime(), allDay: true, rrule, location, alarm, found };
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
  return { title, start: start.getTime(), end, allDay: false, rrule, location, alarm, found };
}

export interface QuickTask {
  title: string;
  /** 1 low (!), 2 medium (!!), 3 high (!!!) */
  priority?: 1 | 2 | 3;
  /** "#home" */
  project?: string;
  /** "~low" or "low energy"; "~high" or "deep work" */
  energy?: 'low' | 'high';
  rrule?: string;
  /** the day (yyyy-mm-dd) when the text named one */
  plannedFor?: string;
  /** a due time when the text named a time of day */
  due?: number;
}

const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * A task in plain words: "Pay rent !!! #home every month",
 * "call Ana tomorrow 3pm !", "water plants every Mon and Thu", "#work
 * review the deck friday". English only; runs on the computer.
 */
export function parseTask(input: string, now = Date.now()): QuickTask | null {
  let s = ` ${input.trim()} `;
  if (!s.trim()) return null;
  let priority: QuickTask['priority'];
  let project: string | undefined;
  // "!", "!!" and "!!!" on their own (a "!" at the end of a word stays part of it).
  s = s.replace(/\s(!{1,3})(?=\s)/g, (_m, b: string) => {
    priority = Math.max(priority ?? 0, b.length) as QuickTask['priority'];
    return ' ';
  });
  s = s.replace(/\s#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)(?=\s)/gu, (_m, name: string) => {
    project ??= name;
    return ' ';
  });
  // Energy: "~low" / "~high", or the plain words "low energy" / "high energy" / "deep work".
  let energy: QuickTask['energy'];
  s = s.replace(/\s(?:~(low|high)|(low|high) energy|(deep work))(?=\s)/gi, (_m, a?: string, b?: string, deep?: string) => {
    energy ??= deep ? 'high' : ((a ?? b)!.toLowerCase() as 'low' | 'high');
    return ' ';
  });
  const q = parseQuickAdd(s, now, { location: false });
  const out: QuickTask = { title: s.replace(/\s+/g, ' ').trim() || input.trim() };
  if (q && (q.found?.date || q.found?.time || q.rrule)) {
    out.title = q.title === 'New event' ? out.title : q.title;
    out.plannedFor = ymd(q.start);
    if (q.found?.time) out.due = q.start;
    if (q.rrule) out.rrule = q.rrule;
  }
  if (priority) out.priority = priority;
  if (project) out.project = project;
  if (energy) out.energy = energy;
  return out;
}
