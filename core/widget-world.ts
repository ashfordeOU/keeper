// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The world clock widget's reasoning: each city's working hours laid over the
// viewer's own day (24 hour cells, in quarter hours so half- and
// quarter-hour zones such as Asia/Kolkata and Asia/Kathmandu come out right,
// and clock changes are taken from the zone rules at each instant), the hours
// when everyone is working, and turning "Tokyo" or "Europe/Paris" into a zone.
// Pure: no window, no clock of its own.

/** Working hours in the city's own time, minutes after midnight (end may be before start: a night shift). */
export interface WorkHours { start: number; end: number }

export const DEFAULT_WORK: WorkHours = { start: 9 * 60, end: 18 * 60 };

const HOUR = 3_600_000;
const QUARTER = 15 * 60_000;

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string): Intl.DateTimeFormat {
  let f = fmts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone });
    fmts.set(zone, f);
  }
  return f;
}

/** Is this a time zone the computer knows? */
export function validZone(zone: string): boolean {
  if (!zone || typeof zone !== 'string') return false;
  try {
    fmt(zone);
    return true;
  } catch {
    return false;
  }
}

/** Minutes after midnight in a zone at an instant (0–1439). */
export function minutesIn(zone: string, t: number): number {
  const parts = fmt(zone).formatToParts(t);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Inside working hours at a minute of the city's day. Equal start and end means none. */
export function isWorking(min: number, w: WorkHours): boolean {
  if (w.start === w.end) return false;
  return w.start < w.end ? min >= w.start && min < w.end : min >= w.start || min < w.end;
}

/** Clean working hours read from settings (whole quarter hours, inside the day). */
export function cleanWork(w: Partial<WorkHours> | undefined): WorkHours {
  const q = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1440, Math.max(0, Math.round(v / 15) * 15)) : d);
  return { start: q(w?.start, DEFAULT_WORK.start) % 1440, end: q(w?.end, DEFAULT_WORK.end) % 1440 };
}

/** The viewer's local midnight on the day of `t`. */
export function viewerDayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The viewer's day as 24 hour cells from `from` (the viewer's midnight); each
 * cell is a 4-bit mask of the quarter hours the city spends working (bit 0 =
 * the first quarter). On a day the viewer's clocks change the cells still
 * follow real hours, so the last one belongs to the next day or one is skipped.
 */
export function workCells(zone: string, work: WorkHours, from: number, hours = 24): number[] {
  const out: number[] = [];
  for (let h = 0; h < hours; h++) {
    let mask = 0;
    for (let q = 0; q < 4; q++) {
      // The middle of each quarter: robust against a zone whose offset is not a whole quarter.
      const t = from + h * HOUR + q * QUARTER + QUARTER / 2;
      if (isWorking(minutesIn(zone, t), work)) mask |= 1 << q;
    }
    out.push(mask);
  }
  return out;
}

/** Quarters set in a cell (0–4). */
export const quarters = (mask: number) => ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1));

/** The quarter hours when everyone is working. No cities: nothing overlaps. */
export function overlapCells(rows: number[][]): number[] {
  if (!rows.length) return Array.from({ length: 24 }, () => 0);
  return rows[0].map((_, i) => rows.reduce((m, r) => m & (r[i] ?? 0), 0b1111));
}

/** Runs of shared time as [start, end) instants, and the total in minutes. */
export function overlapRanges(cells: number[], from: number): { ranges: [number, number][]; minutes: number } {
  const ranges: [number, number][] = [];
  let minutes = 0;
  let open: number | null = null;
  cells.forEach((mask, h) => {
    for (let q = 0; q < 4; q++) {
      const t = from + h * HOUR + q * QUARTER;
      if (mask & (1 << q)) {
        minutes += 15;
        if (open === null) open = t;
      } else if (open !== null) {
        ranges.push([open, t]);
        open = null;
      }
    }
  });
  if (open !== null) ranges.push([open, from + cells.length * HOUR]);
  return { ranges, minutes };
}

/** Where an instant falls across the cells (0–1), clamped. */
export function dayFraction(t: number, from: number, hours = 24): number {
  return Math.min(1, Math.max(0, (t - from) / (hours * HOUR)));
}

/** The city's hour (0–23) at the start of each cell, for labels. */
export function cellHours(zone: string, from: number, hours = 24): number[] {
  return Array.from({ length: hours }, (_, h) => Math.floor(minutesIn(zone, from + h * HOUR) / 60));
}

/** "+5:30" — the zone's offset from the viewer's clock at an instant, or "" when the same. */
export function offsetFromViewer(zone: string, t: number): string {
  const here = new Date(t);
  const viewerMin = here.getHours() * 60 + here.getMinutes();
  let d = minutesIn(zone, t) - viewerMin;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  if (!d) return '';
  const a = Math.abs(d);
  return `${d > 0 ? '+' : '−'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

// ---------------------------------------------------------------- "Tokyo", "Europe/Paris"

/** Cities people type that are not a zone's own name (and zones whose names changed). */
const CITY_ZONES: Record<string, string> = {
  'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', seattle: 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', portland: 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles',
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York', washington: 'America/New_York', 'washington dc': 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York', philadelphia: 'America/New_York', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  austin: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', 'salt lake city': 'America/Denver', calgary: 'America/Edmonton',
  'rio de janeiro': 'America/Sao_Paulo', rio: 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo', 'são paulo': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  'mexico city': 'America/Mexico_City', 'cdmx': 'America/Mexico_City', hawaii: 'Pacific/Honolulu',
  'tel aviv': 'Asia/Jerusalem', munich: 'Europe/Berlin', frankfurt: 'Europe/Berlin', hamburg: 'Europe/Berlin', cologne: 'Europe/Berlin', barcelona: 'Europe/Madrid', milan: 'Europe/Rome', geneva: 'Europe/Zurich',
  edinburgh: 'Europe/London', manchester: 'Europe/London', kiev: 'Europe/Kyiv', kyiv: 'Europe/Kyiv', 'st petersburg': 'Europe/Moscow', 'saint petersburg': 'Europe/Moscow', porto: 'Europe/Lisbon',
  'abu dhabi': 'Asia/Dubai', doha: 'Asia/Qatar', mumbai: 'Asia/Kolkata', bombay: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', pune: 'Asia/Kolkata', calcutta: 'Asia/Kolkata', kolkata: 'Asia/Kolkata', india: 'Asia/Kolkata', kathmandu: 'Asia/Kathmandu', katmandu: 'Asia/Kathmandu',
  beijing: 'Asia/Shanghai', shenzhen: 'Asia/Shanghai', guangzhou: 'Asia/Shanghai', 'ho chi minh city': 'Asia/Ho_Chi_Minh', 'ho chi minh': 'Asia/Ho_Chi_Minh', saigon: 'Asia/Ho_Chi_Minh', hanoi: 'Asia/Bangkok',
  osaka: 'Asia/Tokyo', kyoto: 'Asia/Tokyo', 'hong kong': 'Asia/Hong_Kong', canberra: 'Australia/Sydney', 'gold coast': 'Australia/Brisbane', wellington: 'Pacific/Auckland',
  'cape town': 'Africa/Johannesburg', utc: 'UTC', gmt: 'UTC',
};

const SHORT: Record<string, string> = { sf: 'San Francisco', la: 'Los Angeles', nyc: 'New York', cdmx: 'Mexico City', utc: 'UTC', gmt: 'UTC', rio: 'Rio de Janeiro' };

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\s]+/g, ' ');

function knownZones(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try {
    return sv ? sv('timeZone') : [];
  } catch {
    return [];
  }
}

/** A readable name for a zone: "Europe/Paris" → "Paris", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneLabel(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** Turns what was typed into a place: a zone ("Europe/Paris", any case), or a city ("Tokyo", "Mumbai"). */
export function resolvePlace(input: string): { label: string; zone: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  // A zone typed as such.
  if (raw.includes('/') || /^utc$/i.test(raw)) {
    const exact = knownZones().find((z) => z.toLowerCase() === raw.toLowerCase().replace(/ /g, '_')) ?? raw.replace(/ /g, '_');
    if (validZone(exact)) return { label: zoneLabel(exact), zone: exact };
  }
  const n = norm(raw);
  const pretty = raw.replace(/\s+/g, ' ').replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase());
  if (CITY_ZONES[n] && validZone(CITY_ZONES[n])) return { label: SHORT[n] ?? pretty, zone: CITY_ZONES[n] };
  // A zone's own city name: "tokyo" → Asia/Tokyo, "buenos aires" → America/Argentina/Buenos_Aires.
  const hit = knownZones().find((z) => norm(zoneLabel(z)) === n);
  if (hit) return { label: zoneLabel(hit), zone: hit };
  return null;
}
