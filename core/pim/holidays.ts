// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Public holidays worked out on this computer (no download), and a birthdays
// calendar made from your contacts. Only nationwide holidays are listed;
// regional ones (a German state's, a US state's) are not.

import type { CalEvent, Contact } from './types';

type Rule =
  | { m: number; d: number }
  /** days after Easter Sunday (negative before) */
  | { easter: number }
  /** the nth weekday (0 = Sunday) of a month; n = -1 is the last */
  | { m: number; wd: number; n: number }
  /** the weekday on or after a day of the month (Midsummer, Victoria Day) */
  | { m: number; wd: number; onOrAfter: number }
  | { fn: (y: number) => Date | undefined };

interface Holiday {
  name: string;
  rule: Rule;
  /** a weekend holiday also gives a weekday off */
  observe?: 'us' | 'next';
  /** first year it is kept */
  since?: number;
}

/** Easter Sunday (Gregorian), the anonymous algorithm. */
export function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

function nthWeekday(y: number, m: number, wd: number, n: number): Date {
  if (n > 0) {
    const d = new Date(y, m - 1, 1);
    d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7);
    return d;
  }
  const d = new Date(y, m, 0);
  d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7));
  return d;
}

function dateOf(rule: Rule, y: number): Date | undefined {
  if ('fn' in rule) return rule.fn(y);
  if ('easter' in rule) { const e = easter(y); e.setDate(e.getDate() + rule.easter); return e; }
  if ('onOrAfter' in rule) { const d = new Date(y, rule.m - 1, rule.onOrAfter); d.setDate(d.getDate() + ((rule.wd - d.getDay() + 7) % 7)); return d; }
  if ('wd' in rule) return nthWeekday(y, rule.m, rule.wd, rule.n);
  return new Date(y, rule.m - 1, rule.d);
}

const NEW_YEAR: Holiday = { name: 'New Year’s Day', rule: { m: 1, d: 1 } };
const GOOD_FRIDAY: Holiday = { name: 'Good Friday', rule: { easter: -2 } };
const EASTER: Holiday = { name: 'Easter Sunday', rule: { easter: 0 } };
const EASTER_MONDAY: Holiday = { name: 'Easter Monday', rule: { easter: 1 } };
const ASCENSION: Holiday = { name: 'Ascension Day', rule: { easter: 39 } };
const WHIT_SUNDAY: Holiday = { name: 'Whit Sunday', rule: { easter: 49 } };
const WHIT_MONDAY: Holiday = { name: 'Whit Monday', rule: { easter: 50 } };
const CORPUS_CHRISTI: Holiday = { name: 'Corpus Christi', rule: { easter: 60 } };
const LABOUR_DAY: Holiday = { name: 'Labour Day', rule: { m: 5, d: 1 } };
const EPIPHANY: Holiday = { name: 'Epiphany', rule: { m: 1, d: 6 } };
const ASSUMPTION: Holiday = { name: 'Assumption Day', rule: { m: 8, d: 15 } };
const ALL_SAINTS: Holiday = { name: 'All Saints’ Day', rule: { m: 11, d: 1 } };
const IMMACULATE: Holiday = { name: 'Immaculate Conception', rule: { m: 12, d: 8 } };
const CHRISTMAS_EVE: Holiday = { name: 'Christmas Eve', rule: { m: 12, d: 24 } };
const CHRISTMAS: Holiday = { name: 'Christmas Day', rule: { m: 12, d: 25 } };
const BOXING: Holiday = { name: 'Boxing Day', rule: { m: 12, d: 26 } };
const ST_STEPHEN: Holiday = { name: 'St Stephen’s Day', rule: { m: 12, d: 26 } };

export const HOLIDAY_COUNTRIES: Record<string, { name: string; days: Holiday[] }> = {
  US: { name: 'United States', days: [
    { ...NEW_YEAR, observe: 'us' }, { name: 'Martin Luther King Jr. Day', rule: { m: 1, wd: 1, n: 3 } }, { name: 'Presidents’ Day', rule: { m: 2, wd: 1, n: 3 } },
    { name: 'Memorial Day', rule: { m: 5, wd: 1, n: -1 } }, { name: 'Juneteenth', rule: { m: 6, d: 19 }, observe: 'us', since: 2021 }, { name: 'Independence Day', rule: { m: 7, d: 4 }, observe: 'us' },
    { name: 'Labor Day', rule: { m: 9, wd: 1, n: 1 } }, { name: 'Columbus Day', rule: { m: 10, wd: 1, n: 2 } }, { name: 'Veterans Day', rule: { m: 11, d: 11 }, observe: 'us' },
    { name: 'Thanksgiving Day', rule: { m: 11, wd: 4, n: 4 } }, { ...CHRISTMAS, observe: 'us' },
  ] },
  GB: { name: 'United Kingdom', days: [
    { ...NEW_YEAR, observe: 'next' }, GOOD_FRIDAY, EASTER_MONDAY, { name: 'Early May bank holiday', rule: { m: 5, wd: 1, n: 1 } },
    { name: 'Spring bank holiday', rule: { m: 5, wd: 1, n: -1 } }, { name: 'Summer bank holiday', rule: { m: 8, wd: 1, n: -1 } }, { ...CHRISTMAS, observe: 'next' }, { ...BOXING, observe: 'next' },
  ] },
  IE: { name: 'Ireland', days: [
    { ...NEW_YEAR, observe: 'next' },
    // The first Monday in February, or 1 February when that is a Friday.
    { name: 'St Brigid’s Day', since: 2023, rule: { fn: (y) => (new Date(y, 1, 1).getDay() === 5 ? new Date(y, 1, 1) : nthWeekday(y, 2, 1, 1)) } },
    { name: 'St Patrick’s Day', rule: { m: 3, d: 17 }, observe: 'next' }, EASTER_MONDAY, { name: 'May bank holiday', rule: { m: 5, wd: 1, n: 1 } },
    { name: 'June bank holiday', rule: { m: 6, wd: 1, n: 1 } }, { name: 'August bank holiday', rule: { m: 8, wd: 1, n: 1 } }, { name: 'October bank holiday', rule: { m: 10, wd: 1, n: -1 } },
    { ...CHRISTMAS, observe: 'next' }, { ...ST_STEPHEN, observe: 'next' },
  ] },
  CA: { name: 'Canada', days: [
    { ...NEW_YEAR, observe: 'next' }, GOOD_FRIDAY, { name: 'Victoria Day', rule: { fn: (y) => { const d = new Date(y, 4, 24); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; } } },
    { name: 'Canada Day', rule: { m: 7, d: 1 }, observe: 'next' }, { name: 'Labour Day', rule: { m: 9, wd: 1, n: 1 } }, { name: 'Thanksgiving', rule: { m: 10, wd: 1, n: 2 } },
    { name: 'Remembrance Day', rule: { m: 11, d: 11 } }, { ...CHRISTMAS, observe: 'next' }, { ...BOXING, observe: 'next' },
  ] },
  AU: { name: 'Australia', days: [
    { ...NEW_YEAR, observe: 'next' }, { name: 'Australia Day', rule: { m: 1, d: 26 }, observe: 'next' }, GOOD_FRIDAY, EASTER_MONDAY, { name: 'Anzac Day', rule: { m: 4, d: 25 } },
    { name: 'King’s Birthday', rule: { m: 6, wd: 1, n: 2 } }, { ...CHRISTMAS, observe: 'next' }, { ...BOXING, observe: 'next' },
  ] },
  NZ: { name: 'New Zealand', days: [
    { ...NEW_YEAR, observe: 'next' }, { name: 'Day after New Year’s Day', rule: { m: 1, d: 2 }, observe: 'next' }, { name: 'Waitangi Day', rule: { m: 2, d: 6 }, observe: 'next' }, GOOD_FRIDAY, EASTER_MONDAY,
    { name: 'Anzac Day', rule: { m: 4, d: 25 }, observe: 'next' }, { name: 'King’s Birthday', rule: { m: 6, wd: 1, n: 1 } }, { name: 'Labour Day', rule: { m: 10, wd: 1, n: 4 } },
    { ...CHRISTMAS, observe: 'next' }, { ...BOXING, observe: 'next' },
  ] },
  DE: { name: 'Germany', days: [
    NEW_YEAR, GOOD_FRIDAY, EASTER_MONDAY, LABOUR_DAY, ASCENSION, WHIT_MONDAY, { name: 'Day of German Unity', rule: { m: 10, d: 3 } },
    { name: 'Christmas Day', rule: { m: 12, d: 25 } }, { name: 'Second Day of Christmas', rule: { m: 12, d: 26 } },
  ] },
  AT: { name: 'Austria', days: [
    NEW_YEAR, EPIPHANY, EASTER_MONDAY, LABOUR_DAY, ASCENSION, WHIT_MONDAY, CORPUS_CHRISTI, ASSUMPTION, { name: 'National Day', rule: { m: 10, d: 26 } }, ALL_SAINTS, IMMACULATE, CHRISTMAS, ST_STEPHEN,
  ] },
  CH: { name: 'Switzerland', days: [NEW_YEAR, GOOD_FRIDAY, EASTER_MONDAY, ASCENSION, WHIT_MONDAY, { name: 'Swiss National Day', rule: { m: 8, d: 1 } }, CHRISTMAS, ST_STEPHEN] },
  FR: { name: 'France', days: [
    NEW_YEAR, EASTER_MONDAY, LABOUR_DAY, { name: 'Victory in Europe Day', rule: { m: 5, d: 8 } }, ASCENSION, WHIT_MONDAY, { name: 'Bastille Day', rule: { m: 7, d: 14 } },
    ASSUMPTION, ALL_SAINTS, { name: 'Armistice Day', rule: { m: 11, d: 11 } }, CHRISTMAS,
  ] },
  ES: { name: 'Spain', days: [
    NEW_YEAR, EPIPHANY, GOOD_FRIDAY, LABOUR_DAY, ASSUMPTION, { name: 'National Day of Spain', rule: { m: 10, d: 12 } }, ALL_SAINTS, { name: 'Constitution Day', rule: { m: 12, d: 6 } }, IMMACULATE, CHRISTMAS,
  ] },
  IT: { name: 'Italy', days: [
    NEW_YEAR, EPIPHANY, EASTER, EASTER_MONDAY, { name: 'Liberation Day', rule: { m: 4, d: 25 } }, LABOUR_DAY, { name: 'Republic Day', rule: { m: 6, d: 2 } }, ASSUMPTION, ALL_SAINTS, IMMACULATE, CHRISTMAS, ST_STEPHEN,
  ] },
  NL: { name: 'Netherlands', days: [
    NEW_YEAR, EASTER, EASTER_MONDAY, { name: 'King’s Day', rule: { fn: (y) => (new Date(y, 3, 27).getDay() === 0 ? new Date(y, 3, 26) : new Date(y, 3, 27)) } },
    { name: 'Liberation Day', rule: { m: 5, d: 5 } }, ASCENSION, WHIT_SUNDAY, WHIT_MONDAY, CHRISTMAS, { name: 'Second Day of Christmas', rule: { m: 12, d: 26 } },
  ] },
  BE: { name: 'Belgium', days: [NEW_YEAR, EASTER_MONDAY, LABOUR_DAY, ASCENSION, WHIT_MONDAY, { name: 'Belgian National Day', rule: { m: 7, d: 21 } }, ASSUMPTION, ALL_SAINTS, { name: 'Armistice Day', rule: { m: 11, d: 11 } }, CHRISTMAS] },
  SE: { name: 'Sweden', days: [
    NEW_YEAR, EPIPHANY, GOOD_FRIDAY, EASTER, EASTER_MONDAY, LABOUR_DAY, ASCENSION, { name: 'National Day of Sweden', rule: { m: 6, d: 6 } },
    { name: 'Midsummer Eve', rule: { m: 6, wd: 5, onOrAfter: 19 } }, { name: 'Midsummer Day', rule: { m: 6, wd: 6, onOrAfter: 20 } },
    { name: 'All Saints’ Day', rule: { fn: (y) => { const d = new Date(y, 9, 31); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return d; } } },
    CHRISTMAS_EVE, CHRISTMAS, BOXING, { name: 'New Year’s Eve', rule: { m: 12, d: 31 } },
  ] },
  EE: { name: 'Estonia', days: [
    NEW_YEAR, { name: 'Independence Day', rule: { m: 2, d: 24 } }, GOOD_FRIDAY, EASTER, { name: 'Spring Day', rule: { m: 5, d: 1 } }, WHIT_SUNDAY,
    { name: 'Victory Day', rule: { m: 6, d: 23 } }, { name: 'Midsummer Day', rule: { m: 6, d: 24 } }, { name: 'Day of Restoration of Independence', rule: { m: 8, d: 20 } },
    CHRISTMAS_EVE, CHRISTMAS, BOXING,
  ] },
  PL: { name: 'Poland', days: [
    NEW_YEAR, EPIPHANY, EASTER, EASTER_MONDAY, LABOUR_DAY, { name: 'Constitution Day', rule: { m: 5, d: 3 } }, WHIT_SUNDAY, CORPUS_CHRISTI, ASSUMPTION, ALL_SAINTS,
    { name: 'Independence Day', rule: { m: 11, d: 11 } }, { ...CHRISTMAS_EVE, since: 2025 }, CHRISTMAS, { name: 'Second Day of Christmas', rule: { m: 12, d: 26 } },
  ] },
  IN: { name: 'India', days: [{ name: 'Republic Day', rule: { m: 1, d: 26 } }, { name: 'Independence Day', rule: { m: 8, d: 15 } }, { name: 'Gandhi Jayanti', rule: { m: 10, d: 2 } }] },
};

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** One year's holidays for a country, with "(observed)" days where a weekend one gives a weekday off. */
export function holidaysIn(country: string, y: number): { name: string; date: Date }[] {
  const c = HOLIDAY_COUNTRIES[country.toUpperCase()];
  if (!c) return [];
  const out: { name: string; date: Date }[] = [];
  const taken = new Set<string>();
  for (const h of c.days) {
    if (h.since && y < h.since) continue;
    const d = dateOf(h.rule, y);
    if (!d) continue;
    out.push({ name: h.name, date: d });
    taken.add(key(d));
  }
  // Observed days: in date order, so Christmas and Boxing Day on a weekend move to Monday and Tuesday.
  for (const h of [...c.days].filter((x) => x.observe).sort((a, b) => (dateOf(a.rule, y)?.getTime() ?? 0) - (dateOf(b.rule, y)?.getTime() ?? 0))) {
    if (h.since && y < h.since) continue;
    const d = dateOf(h.rule, y);
    if (!d || (d.getDay() !== 0 && d.getDay() !== 6)) continue;
    const o = new Date(d);
    if (h.observe === 'us') o.setDate(o.getDate() + (d.getDay() === 6 ? -1 : 1));
    else do o.setDate(o.getDate() + 1); while (o.getDay() === 0 || o.getDay() === 6 || taken.has(key(o)));
    taken.add(key(o));
    out.push({ name: `${h.name} (observed)`, date: o });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export const holidayCalendarId = (country: string) => `holidays:${country.toUpperCase()}`;
export const BIRTHDAYS_CALENDAR = 'birthdays:contacts';

/** Holidays between two times as all-day events of a calendar. */
export function holidayEvents(country: string, from: number, to: number, calendar = holidayCalendarId(country)): CalEvent[] {
  const out: CalEvent[] = [];
  for (let y = new Date(from).getFullYear(); y <= new Date(to).getFullYear(); y++) {
    for (const h of holidaysIn(country, y)) {
      const start = h.date.getTime();
      const end = new Date(h.date);
      end.setDate(end.getDate() + 1);
      if (end.getTime() <= from || start >= to) continue;
      const uid = `${country.toUpperCase()}-${y}-${h.date.getMonth() + 1}-${h.date.getDate()}-${h.name.replace(/\W+/g, '').toLowerCase()}`;
      out.push({ id: `${calendar}:${uid}`, calendar, uid, title: h.name, start, end: end.getTime(), allDay: true, status: 'confirmed' });
    }
  }
  return out;
}

/** "1990-04-12", "19900412", "--04-12", "--0412" → month and day (and year when known). */
export function parseBirthday(v: string): { y?: number; m: number; d: number } | undefined {
  const s = v.trim().replace(/T.*$/, '');
  const m = s.match(/^(?:(\d{4})-?|--)(\d{2})-?(\d{2})$/);
  if (!m) return undefined;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return { y: m[1] ? Number(m[1]) : undefined, m: mo, d };
}

/** A yearly all-day event for each contact with a birthday (29 February falls on the 28th in other years). */
export function birthdayEvents(contacts: Pick<Contact, 'id' | 'name' | 'birthday'>[], calendar = BIRTHDAYS_CALENDAR): CalEvent[] {
  const out: CalEvent[] = [];
  for (const c of contacts) {
    const b = c.birthday ? parseBirthday(c.birthday) : undefined;
    if (!b || !c.name) continue;
    // Starts in a leap year so 29 February exists; the rule picks the month's last day otherwise.
    const y0 = b.y ?? 2000;
    const leap = b.m === 2 && b.d === 29;
    const s = new Date(leap ? (y0 % 4 === 0 ? y0 : 2000) : y0, b.m - 1, b.d);
    const start = s.getTime();
    const end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1).getTime();
    const uid = `birthday-${c.id}`;
    out.push({
      id: `${calendar}:${uid}`, calendar, uid, title: `${c.name}’s birthday`, start, end, allDay: true,
      rrule: leap ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'FREQ=YEARLY', status: 'confirmed',
    });
  }
  return out;
}
