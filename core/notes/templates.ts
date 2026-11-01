// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dates in the format tokens vault settings use (YYYY-MM-DD, gggg-[W]ww, …),
// templates with {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, and the
// daily, weekly and monthly note names built from them.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Locale week (weeks start on Sunday, week 1 holds 1 January), as the default locale counts. */
function localeWeek(d: Date): { week: number; year: number } {
  const start = (y: number) => { const j = new Date(y, 0, 1); return new Date(y, 0, 1 - j.getDay()); };
  let y = d.getFullYear();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (day >= start(y + 1)) y++;
  const week = Math.floor((day.getTime() - start(y).getTime()) / (7 * 86_400_000) + 0.01) + 1;
  return { week, year: y };
}

/** ISO 8601 week: Monday first, week 1 holds the first Thursday. */
export function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return { week, year: y };
}

const TOKENS = /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|Mo|M|DDDD|DDD|Do|DD|D|dddd|ddd|dd|d|E|e|GGGG|gggg|WW|Wo|W|ww|wo|w|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|A|a|X|x|ZZ|Z/g;

/** Formats a date with the usual tokens; text in [brackets] is kept as is. */
export function formatDate(d: Date, fmt: string): string {
  return fmt.replace(TOKENS, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit;
    const doy = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1;
    switch (tok) {
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return pad(d.getFullYear() % 100);
      case 'Q': return String(Math.floor(d.getMonth() / 3) + 1);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'Mo': return ordinal(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DDDD': return pad(doy, 3);
      case 'DDD': return String(doy);
      case 'Do': return ordinal(d.getDate());
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'dd': return DAYS[d.getDay()].slice(0, 2);
      case 'd': return String(d.getDay());
      case 'e': return String(d.getDay());
      case 'E': return String(d.getDay() || 7);
      case 'GGGG': return String(isoWeek(d).year);
      case 'gggg': return String(localeWeek(d).year);
      case 'WW': return pad(isoWeek(d).week);
      case 'Wo': return ordinal(isoWeek(d).week);
      case 'W': return String(isoWeek(d).week);
      case 'ww': return pad(localeWeek(d).week);
      case 'wo': return ordinal(localeWeek(d).week);
      case 'w': return String(localeWeek(d).week);
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'hh': return pad(d.getHours() % 12 || 12);
      case 'h': return String(d.getHours() % 12 || 12);
      case 'kk': return pad(d.getHours() || 24);
      case 'k': return String(d.getHours() || 24);
      case 'mm': return pad(d.getMinutes());
      case 'm': return String(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 's': return String(d.getSeconds());
      case 'SSS': return pad(d.getMilliseconds(), 3);
      case 'A': return d.getHours() < 12 ? 'AM' : 'PM';
      case 'a': return d.getHours() < 12 ? 'am' : 'pm';
      case 'X': return String(Math.floor(d.getTime() / 1000));
      case 'x': return String(d.getTime());
      case 'Z': case 'ZZ': {
        const o = -d.getTimezoneOffset();
        const s = `${o >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(o) / 60))}${tok === 'Z' ? ':' : ''}${pad(Math.abs(o) % 60)}`;
        return s;
      }
    }
    return tok;
  });
}

/** Reads a date written in a format (for "is this file a daily note?"). Null when it does not fit. */
export function parseDate(s: string, fmt: string): Date | null {
  const parts: string[] = [];
  const re = fmt.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\\?\[([^\]]*)\\?\]|YYYY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|gggg|GGGG|ww|WW|w|W|HH|mm|ss|Q/g, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    parts.push(tok);
    if (tok === 'MMMM') return `(${MONTHS.join('|')})`;
    if (tok === 'MMM') return `(${MONTHS.map((m) => m.slice(0, 3)).join('|')})`;
    if (tok === 'dddd') return `(${DAYS.join('|')})`;
    if (tok === 'ddd') return `(${DAYS.map((m) => m.slice(0, 3)).join('|')})`;
    if (tok === 'Do') return '(\\d{1,2})(?:st|nd|rd|th)';
    if (tok.length === 4) return '(\\d{4})';
    return '(\\d{1,2})';
  });
  const m = new RegExp(`^${re}$`, 'i').exec(s);
  if (!m) return null;
  let y = 1970, mo = 0, d = 1, h = 0, mi = 0, se = 0, week = 0, iso = false, q = 0;
  parts.forEach((p, i) => {
    const v = m[i + 1];
    const n = Number(v);
    switch (p) {
      case 'YYYY': case 'gggg': case 'GGGG': y = n; if (p === 'GGGG') iso = true; break;
      case 'MMMM': mo = MONTHS.findIndex((x) => x.toLowerCase() === v.toLowerCase()); break;
      case 'MMM': mo = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === v.toLowerCase()); break;
      case 'MM': case 'M': mo = n - 1; break;
      case 'DD': case 'D': case 'Do': d = n; break;
      case 'ww': case 'w': week = n; break;
      case 'WW': case 'W': week = n; iso = true; break;
      case 'HH': h = n; break;
      case 'mm': mi = n; break;
      case 'ss': se = n; break;
      case 'Q': q = n; break;
    }
  });
  if (q) mo = (q - 1) * 3;
  if (week) {
    if (iso) {
      const jan4 = new Date(y, 0, 4);
      const mon = new Date(y, 0, 4 - ((jan4.getDay() || 7) - 1));
      return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + (week - 1) * 7);
    }
    const j = new Date(y, 0, 1);
    return new Date(y, 0, 1 - j.getDay() + (week - 1) * 7);
  }
  const out = new Date(y, mo, d, h, mi, se);
  return out.getMonth() === mo ? out : null;
}

export interface TemplateContext {
  title: string;
  now?: Date;
  /** the date a periodic note is for ({{date}} in a daily note is that day) */
  date?: Date;
  dateFormat?: string;
  timeFormat?: string;
  /** more {{name}} values */
  vars?: Record<string, string>;
}

/**
 * Fills a template: {{title}}, {{date}}, {{time}}, {{date:FORMAT}},
 * {{time:FORMAT}}, and in periodic notes {{yesterday}}, {{tomorrow}} and
 * {{date+1d:FORMAT}} style offsets. Unknown names are left as written.
 */
export function fillTemplate(tpl: string, ctx: TemplateContext): string {
  const now = ctx.now ?? new Date();
  const day = ctx.date ?? now;
  const df = ctx.dateFormat || 'YYYY-MM-DD';
  const tf = ctx.timeFormat || 'HH:mm';
  return tpl.replace(/\{\{\s*([\w-]+)\s*([+-]\s*\d+\s*[dwmy])?\s*(?::\s*([^}]*?))?\s*\}\}/g, (all, name: string, offset: string | undefined, fmt: string | undefined) => {
    const key = name.toLowerCase();
    const shift = (d: Date) => {
      if (!offset) return d;
      const o = /([+-])\s*(\d+)\s*([dwmy])/.exec(offset)!;
      const n = Number(o[2]) * (o[1] === '-' ? -1 : 1);
      const r = new Date(d);
      if (o[3] === 'd') r.setDate(r.getDate() + n);
      if (o[3] === 'w') r.setDate(r.getDate() + 7 * n);
      if (o[3] === 'm') r.setMonth(r.getMonth() + n);
      if (o[3] === 'y') r.setFullYear(r.getFullYear() + n);
      return r;
    };
    if (key === 'title') return ctx.title;
    if (key === 'date') return formatDate(shift(day), fmt?.trim() || df);
    if (key === 'time') return formatDate(shift(now), fmt?.trim() || tf);
    if (key === 'yesterday') { const d = new Date(day); d.setDate(d.getDate() - 1); return formatDate(d, fmt?.trim() || df); }
    if (key === 'tomorrow') { const d = new Date(day); d.setDate(d.getDate() + 1); return formatDate(d, fmt?.trim() || df); }
    if (ctx.vars && name in ctx.vars) return ctx.vars[name];
    return all;
  });
}

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodicConfig {
  enabled?: boolean;
  folder?: string;
  format?: string;
  template?: string;
}

export const DEFAULT_FORMATS: Record<Period, string> = {
  day: 'YYYY-MM-DD',
  week: 'gggg-[W]ww',
  month: 'YYYY-MM',
  quarter: 'YYYY-[Q]Q',
  year: 'YYYY',
};

/** The first day of the period that holds `d`. */
export function periodStart(d: Date, p: Period): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === 'week') x.setDate(x.getDate() - x.getDay());
  if (p === 'month') x.setDate(1);
  if (p === 'quarter') { x.setMonth(Math.floor(x.getMonth() / 3) * 3); x.setDate(1); }
  if (p === 'year') { x.setMonth(0); x.setDate(1); }
  return x;
}

export function shiftPeriod(d: Date, p: Period, n: number): Date {
  const x = new Date(d);
  if (p === 'day') x.setDate(x.getDate() + n);
  if (p === 'week') x.setDate(x.getDate() + 7 * n);
  if (p === 'month') x.setMonth(x.getMonth() + n);
  if (p === 'quarter') x.setMonth(x.getMonth() + 3 * n);
  if (p === 'year') x.setFullYear(x.getFullYear() + n);
  return x;
}

/** Where the note for a period lives: "Daily/2026-10-31.md". The format may hold folders ("YYYY/MM/DD"). */
export function periodicPath(d: Date, p: Period, cfg: PeriodicConfig): string {
  const name = formatDate(periodStart(d, p), cfg.format || DEFAULT_FORMATS[p]);
  const folder = (cfg.folder ?? '').replace(/^\/+|\/+$/g, '');
  return `${folder ? `${folder}/` : ''}${name}.md`;
}

/** The template path as settings write it ("Templates/Daily" → "Templates/Daily.md"). */
export function templatePath(t: string | undefined): string | null {
  if (!t) return null;
  const p = t.replace(/^\/+/, '');
  return /\.md$/i.test(p) ? p : `${p}.md`;
}

/** If a note path is a periodic note for that config, the date it is for. */
export function periodicDateOf(path: string, p: Period, cfg: PeriodicConfig): Date | null {
  const folder = (cfg.folder ?? '').replace(/^\/+|\/+$/g, '');
  if (folder && !path.startsWith(`${folder}/`)) return null;
  const rest = (folder ? path.slice(folder.length + 1) : path).replace(/\.md$/i, '');
  return parseDate(rest, cfg.format || DEFAULT_FORMATS[p]);
}
