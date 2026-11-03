// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Automatic time tracking: which app, window and site were in front, and for
// how long, kept only on this computer. Pure logic: turning front-window
// changes into spans, leaving out what the person excluded, projects from
// rules, a day's timeline and totals, a week, and CSV. The recorder is
// electron/services/time-track.ts.

export interface TimeSpan {
  /** epoch ms */
  start: number;
  end: number;
  app: string;
  /** window title (only when titles are kept) */
  title?: string;
  /** the site of the browser tab in front (with Keeper's extension) */
  site?: string;
}

export interface TimeRule {
  id: string;
  project: string;
  /** what the rule looks at */
  field: 'app' | 'title' | 'site' | 'any';
  /** matched without regard to case; a site also matches its subdomains */
  contains: string;
}

export interface TimeTrackOptions {
  /** keep window titles (document names); off keeps only app and site */
  titles: boolean;
  /** keep the site of the browser tab in front */
  sites: boolean;
  /** nobody at the computer for this long ends the span */
  idleMinutes: number;
  /** older days are deleted */
  keepDays: number;
  /** apps and sites never recorded */
  exclude: string[];
}

export const defaultTimeTrackOptions = (): TimeTrackOptions => ({ titles: true, sites: true, idleMinutes: 5, keepDays: 90, exclude: ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access'] });

export function normalizeTimeTrackOptions(o: Partial<TimeTrackOptions> | undefined): TimeTrackOptions {
  const d = defaultTimeTrackOptions();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  return {
    titles: v.titles !== false,
    sites: v.sites !== false,
    idleMinutes: Math.min(60, Math.max(1, Math.round(Number(v.idleMinutes) || d.idleMinutes))),
    keepDays: Math.min(3650, Math.max(1, Math.round(Number(v.keepDays) || d.keepDays))),
    exclude: (Array.isArray(v.exclude) ? v.exclude : d.exclude).map((x) => String(x).trim()).filter(Boolean).slice(0, 200),
  };
}

/** What is in front at one moment (from the front-window helper and the browser extension). */
export interface FrontSample {
  app: string;
  title?: string;
  site?: string;
}

/** Is this sample excluded (by app name or site, without regard to case)? */
export function excluded(s: FrontSample, exclude: string[]): boolean {
  const app = s.app.toLowerCase();
  const site = s.site?.toLowerCase();
  return exclude.some((x) => {
    const e = x.toLowerCase();
    return e === app || (!!site && (site === e || site.endsWith(`.${e}`)));
  });
}

/** What is kept of a sample, by the options. Undefined when nothing is kept (excluded or nothing in front). */
export function keepOf(s: FrontSample | undefined, o: TimeTrackOptions): FrontSample | undefined {
  if (!s || !s.app.trim()) return undefined;
  if (excluded(s, o.exclude)) return undefined;
  return { app: s.app.trim().slice(0, 120), title: o.titles && s.title ? s.title.trim().slice(0, 300) || undefined : undefined, site: o.sites && s.site ? s.site.toLowerCase().slice(0, 253) : undefined };
}

const same = (a: FrontSample, b: TimeSpan) => a.app === b.app && (a.title ?? '') === (b.title ?? '') && (a.site ?? '') === (b.site ?? '');

/**
 * The recorder's step: the span in progress and the spans closed. A new sample
 * closes the open span (if different); `undefined` (away, locked, paused,
 * excluded) closes it too. Spans shorter than `minMs` are dropped.
 */
export function step(open: TimeSpan | undefined, sample: FrontSample | undefined, now: number, minMs = 2000): { open?: TimeSpan; closed?: TimeSpan } {
  if (open && sample && same(sample, open)) return { open: { ...open, end: now } };
  const closed = open && now - open.start >= minMs ? { ...open, end: Math.max(open.end, now) } : undefined;
  return { open: sample ? { start: now, end: now, ...sample } : undefined, closed };
}

/** The local day a moment belongs to, as "YYYY-MM-DD". */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A span over midnight becomes one piece per day. */
export function splitByDay(s: TimeSpan): TimeSpan[] {
  const out: TimeSpan[] = [];
  let start = s.start;
  for (;;) {
    const midnight = new Date(start);
    midnight.setHours(24, 0, 0, 0);
    if (midnight.getTime() >= s.end) break;
    out.push({ ...s, start, end: midnight.getTime() });
    start = midnight.getTime();
  }
  out.push({ ...s, start, end: s.end });
  return out.filter((x) => x.end > x.start);
}

/** The project a span belongs to: the first rule that matches, else none. */
export function projectFor(s: TimeSpan, rules: TimeRule[]): string | undefined {
  for (const r of rules) {
    const c = r.contains.trim().toLowerCase();
    if (!c) continue;
    const app = s.app.toLowerCase();
    const title = (s.title ?? '').toLowerCase();
    const site = (s.site ?? '').toLowerCase();
    const siteHit = !!site && (site === c || site.endsWith(`.${c}`) || site.includes(c));
    const hit = r.field === 'app' ? app.includes(c) : r.field === 'title' ? title.includes(c) : r.field === 'site' ? siteHit : app.includes(c) || title.includes(c) || siteHit;
    if (hit) return r.project;
  }
  return undefined;
}

export interface Total { key: string; ms: number }

const add = (m: Map<string, number>, k: string, ms: number) => m.set(k, (m.get(k) ?? 0) + ms);
const sorted = (m: Map<string, number>): Total[] => [...m].map(([key, ms]) => ({ key, ms })).sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));

export interface DaySummary {
  day: string;
  total: number;
  apps: Total[];
  projects: Total[];
  sites: Total[];
  titles: Total[];
  /** neighbouring spans of the same app joined (gaps under two minutes), for drawing */
  blocks: { start: number; end: number; app: string; project?: string }[];
  first?: number;
  last?: number;
}

export const NO_PROJECT = 'No project';

export function summarizeDay(spans: TimeSpan[], rules: TimeRule[], day: string): DaySummary {
  const apps = new Map<string, number>();
  const projects = new Map<string, number>();
  const sites = new Map<string, number>();
  const titles = new Map<string, number>();
  const blocks: DaySummary['blocks'] = [];
  let total = 0;
  const list = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  for (const s of list) {
    const ms = s.end - s.start;
    total += ms;
    add(apps, s.app, ms);
    const p = projectFor(s, rules);
    add(projects, p ?? NO_PROJECT, ms);
    if (s.site) add(sites, s.site, ms);
    if (s.title) add(titles, `${s.app} — ${s.title}`, ms);
    const last = blocks[blocks.length - 1];
    if (last && last.app === s.app && last.project === p && s.start - last.end < 120_000) last.end = Math.max(last.end, s.end);
    else blocks.push({ start: s.start, end: s.end, app: s.app, project: p });
  }
  return { day, total, apps: sorted(apps), projects: sorted(projects), sites: sorted(sites), titles: sorted(titles).slice(0, 50), blocks, first: list[0]?.start, last: list.at(-1)?.end };
}

/** Seven days from Monday (or the given first day), each with totals per project. */
export function summarizeWeek(days: { day: string; spans: TimeSpan[] }[], rules: TimeRule[]): { days: { day: string; total: number; projects: Total[] }[]; projects: Total[]; total: number } {
  const all = new Map<string, number>();
  let total = 0;
  const out = days.map(({ day, spans }) => {
    const s = summarizeDay(spans, rules, day);
    for (const p of s.projects) add(all, p.key, p.ms);
    total += s.total;
    return { day, total: s.total, projects: s.projects };
  });
  return { days: out, projects: sorted(all), total };
}

/** The Monday of the week a day is in. */
export function weekOf(t: number): number {
  const d = new Date(dayStart(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** "2 h 05 min", "12 min", "under a minute". */
export function duration(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Every span as a row: Date, Start, End, Minutes, App, Title, Site, Project. */
export function toCsv(spans: TimeSpan[], rules: TimeRule[]): string {
  const rows = [['Date', 'Start', 'End', 'Minutes', 'App', 'Title', 'Site', 'Project']];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    rows.push([dayKey(s.start), hhmm(s.start), hhmm(s.end), String(Math.round(((s.end - s.start) / 60_000) * 10) / 10), s.app, s.title ?? '', s.site ?? '', projectFor(s, rules) ?? '']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Cleans stored rules. */
export function cleanRules(raw: unknown): TimeRule[] {
  return (Array.isArray(raw) ? raw : []).filter((r): r is TimeRule => !!r && typeof r.project === 'string' && typeof r.contains === 'string')
    .map((r) => ({ id: String(r.id || Math.random().toString(36).slice(2, 10)).slice(0, 64), project: r.project.trim().slice(0, 80), field: (['app', 'title', 'site', 'any'] as const).includes(r.field) ? r.field : 'any', contains: r.contains.trim().slice(0, 200) }))
    .filter((r) => r.project && r.contains);
}

/** Cleans stored spans (bad ones dropped). */
export function cleanSpans(raw: unknown): TimeSpan[] {
  return (Array.isArray(raw) ? raw : []).filter((s): s is TimeSpan => !!s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start && typeof s.app === 'string')
    .map((s) => ({ start: s.start, end: s.end, app: s.app, ...(typeof s.title === 'string' && s.title ? { title: s.title } : {}), ...(typeof s.site === 'string' && s.site ? { site: s.site } : {}) }));
}

/** The host of a page address, without "www.". */
export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
}

const BROWSER_NAMES = /^(google chrome.*|chrome|chromium.*|firefox.*|mozilla firefox|safari|msedge|microsoft edge.*|brave.*|opera.*|vivaldi.*|arc|orion|navigator|librewolf|zen.*)$/i;

/** Is this app a web browser (so the extension's page in front belongs to it)? */
export function isBrowser(app: string): boolean {
  return BROWSER_NAMES.test(app.trim().replace(/\.exe$/i, ''));
}
