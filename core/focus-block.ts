// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Blocking distractions: lists of sites and apps that are blocked during a
// Focus session, on a schedule, or for a while by hand. Pure logic: which
// block is on now, when that changes, which site or app it covers, and the
// short passes ("let me in for 5 minutes") a person can take when the block
// is not strict. electron/services/focus-block.ts applies it through the
// firewall's DNS filter, the browser extension and the app in front.

export interface BlockList {
  id: string;
  name: string;
  /** domains; each also covers its subdomains (example.com blocks news.example.com) */
  sites: string[];
  /** app names, macOS bundle ids, Windows program names or Linux window classes */
  apps: string[];
}

export interface BlockSchedule {
  id: string;
  listId: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** minutes after midnight; an end before the start runs past midnight */
  start: number;
  end: number;
  on: boolean;
}

export interface BlockPass {
  /** a site (domain) or an app name */
  target: string;
  until: number;
}

export interface FocusBlockData {
  lists: BlockList[];
  schedules: BlockSchedule[];
  /** the list a Focus session blocks (none: Focus sessions block nothing) */
  focusList: string | null;
  /** blocking started by hand */
  manual?: { listId: string; until: number; strict: boolean };
  passes: BlockPass[];
  /** a schedule's block the person ended early (not strict): it stays off until this time */
  skipUntil?: number;
  /** the running Focus session's block was ended early (not strict); cleared when the session ends */
  skipFocus?: boolean;
  /** a log of blocked moments, for "blocked 12 times today" */
  blockedToday?: { day: string; count: number };
}

export interface FocusBlockOptions {
  /** block the Focus list while a Focus session runs */
  withFocus: boolean;
  /** no passes and no early stop while a block runs */
  strict: boolean;
  /** how long "let me in" lasts */
  passMinutes: number;
  /** how long to wait before a pass can be taken */
  waitSeconds: number;
  /** close a blocked app when it comes to the front (instead of only showing the block) */
  closeApps: boolean;
}

export const defaultFocusBlockOptions = (): FocusBlockOptions => ({ withFocus: true, strict: false, passMinutes: 5, waitSeconds: 10, closeApps: false });

export function normalizeFocusBlockOptions(o: Partial<FocusBlockOptions> | undefined): FocusBlockOptions {
  const d = defaultFocusBlockOptions();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  return {
    withFocus: v.withFocus !== false,
    strict: v.strict === true,
    passMinutes: clamp(Math.round(Number(v.passMinutes) || d.passMinutes), 1, 30),
    waitSeconds: clamp(Math.round(Number(v.waitSeconds) || 0), 0, 120),
    closeApps: v.closeApps === true,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Starter lists people can use as they are or change (names are Keeper's own). */
export const STARTER_LISTS: BlockList[] = [
  { id: 'social', name: 'Social', sites: ['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'reddit.com', 'threads.net', 'bsky.app', 'linkedin.com', 'pinterest.com', 'snapchat.com'], apps: [] },
  { id: 'news', name: 'News', sites: ['news.google.com', 'cnn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'news.ycombinator.com', 'foxnews.com', 'washingtonpost.com'], apps: [] },
  { id: 'video', name: 'Video and games', sites: ['youtube.com', 'twitch.tv', 'netflix.com', 'primevideo.com', 'disneyplus.com', 'store.steampowered.com'], apps: ['Steam', 'Discord'] },
];

export const emptyFocusBlockData = (): FocusBlockData => ({ lists: STARTER_LISTS.map((l) => ({ ...l, sites: [...l.sites], apps: [...l.apps] })), schedules: [], focusList: 'social', passes: [] });

/** A domain from what a person typed: an address, "www.site.com", "*.site.com" or "site.com/page". Undefined when it is not one. */
export function normalizeSite(input: string): string | undefined {
  let s = input.trim().toLowerCase();
  if (!s) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { s = new URL(s).hostname; } catch { return undefined; }
  }
  s = s.replace(/^\*\./, '').replace(/[/?#:].*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || s.split('.').some((p) => !p || p.startsWith('-') || p.endsWith('-'))) return undefined;
  return s;
}

/** The listed site that covers this host (itself or a parent domain), if any. */
export function siteFor(host: string, sites: string[]): string | undefined {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return sites.find((s) => h === s || h.endsWith(`.${s}`));
}

/** Does this app (in front) match an entry of the list? Names compare whole, ids and paths by their last part. */
export function appFor(front: { app: string; appId?: string }, apps: string[]): string | undefined {
  const name = front.app.trim().toLowerCase().replace(/\.(exe|app)$/, '');
  const id = (front.appId ?? '').toLowerCase();
  const idBase = id.split(/[\\/]/).pop()?.replace(/\.(exe|app)$/, '') ?? '';
  return apps.find((a) => {
    const x = a.trim().toLowerCase().replace(/\.(exe|app)$/, '');
    if (!x) return false;
    return x === name || x === id || x === idBase || (x.includes('.') && id === x);
  });
}

/** Is a schedule on at this moment (local time)? */
export function scheduleOn(s: BlockSchedule, now: number): boolean {
  if (!s.on || !s.days.length || s.start === s.end) return false;
  const d = new Date(now);
  const min = d.getHours() * 60 + d.getMinutes();
  if (s.start < s.end) return s.days.includes(d.getDay()) && min >= s.start && min < s.end;
  // Past midnight: the evening part belongs to its day, the morning part to the day before.
  if (min >= s.start) return s.days.includes(d.getDay());
  if (min < s.end) return s.days.includes((d.getDay() + 6) % 7);
  return false;
}

/** When the schedule's current stretch ends (it is on now). */
export function scheduleEnd(s: BlockSchedule, now: number): number {
  const d = new Date(now);
  const min = d.getHours() * 60 + d.getMinutes();
  const end = new Date(now);
  end.setHours(Math.floor(s.end / 60), s.end % 60, 0, 0);
  if (s.start > s.end && min >= s.start) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export type BlockReason = { kind: 'focus' | 'schedule' | 'manual'; label: string; until?: number };

export interface ActiveBlock {
  on: boolean;
  sites: string[];
  apps: string[];
  reasons: BlockReason[];
  /** when the last reason ends (undefined while a Focus stopwatch or a schedule without end runs) */
  until?: number;
  strict: boolean;
  /** the lists in use, by name */
  lists: string[];
}

export interface BlockContext {
  now: number;
  /** a Focus session is running (not a break) */
  focusOn: boolean;
  /** when it ends (0 for a stopwatch) */
  focusEndsAt?: number;
}

/** What is blocked right now, and why. */
export function activeBlock(data: FocusBlockData, opts: FocusBlockOptions, ctx: BlockContext): ActiveBlock {
  const byId = new Map(data.lists.map((l) => [l.id, l]));
  const used: BlockList[] = [];
  const reasons: BlockReason[] = [];
  let manualStrict = false;
  if (opts.withFocus && ctx.focusOn && !data.skipFocus && data.focusList && byId.has(data.focusList)) {
    used.push(byId.get(data.focusList)!);
    reasons.push({ kind: 'focus', label: 'Focus session', until: ctx.focusEndsAt || undefined });
  }
  if (data.manual && data.manual.until > ctx.now && byId.has(data.manual.listId)) {
    used.push(byId.get(data.manual.listId)!);
    reasons.push({ kind: 'manual', label: 'Started by you', until: data.manual.until });
    manualStrict = data.manual.strict;
  }
  if (!(data.skipUntil && data.skipUntil > ctx.now)) {
    for (const s of data.schedules) {
      if (!scheduleOn(s, ctx.now) || !byId.has(s.listId)) continue;
      used.push(byId.get(s.listId)!);
      reasons.push({ kind: 'schedule', label: `Schedule: ${byId.get(s.listId)!.name}`, until: scheduleEnd(s, ctx.now) });
    }
  }
  const uniq = [...new Set(used)];
  const sites = [...new Set(uniq.flatMap((l) => l.sites))].sort();
  const apps = [...new Set(uniq.flatMap((l) => l.apps))].sort((a, b) => a.localeCompare(b));
  const on = reasons.length > 0 && (sites.length > 0 || apps.length > 0);
  const ends = reasons.map((r) => r.until);
  const until = on && ends.every((u) => u !== undefined) ? Math.max(...(ends as number[])) : undefined;
  return { on, sites: on ? sites : [], apps: on ? apps : [], reasons: on ? reasons : [], until, strict: on && (opts.strict || manualStrict), lists: on ? uniq.map((l) => l.name) : [] };
}

/** Passes still running. */
export function livePasses(data: FocusBlockData, now: number): BlockPass[] {
  return data.passes.filter((p) => p.until > now);
}

/** The block as it applies now: sites and apps with a running pass are let through. */
export function withPasses(b: ActiveBlock, passes: BlockPass[], now: number): ActiveBlock {
  const open = new Set(passes.filter((p) => p.until > now).map((p) => p.target.toLowerCase()));
  if (!open.size) return b;
  return { ...b, sites: b.sites.filter((s) => !open.has(s)), apps: b.apps.filter((a) => !open.has(a.toLowerCase())) };
}

/** Grants a short pass, or says why not. */
export function takePass(data: FocusBlockData, block: ActiveBlock, opts: FocusBlockOptions, target: string, now: number): { data: FocusBlockData; until: number } | { error: string } {
  if (!block.on) return { error: 'Nothing is blocked right now.' };
  if (block.strict) return { error: block.until ? `Strict mode is on: this stays blocked until ${clock(block.until)}.` : 'Strict mode is on: this stays blocked until the block ends.' };
  const t = target.trim().toLowerCase();
  const site = siteFor(t, block.sites);
  const app = block.apps.find((a) => a.toLowerCase() === t);
  const key = site ?? app?.toLowerCase();
  if (!key) return { error: 'That is not blocked.' };
  const until = now + opts.passMinutes * 60_000;
  return { data: { ...data, passes: [...livePasses(data, now).filter((p) => p.target !== key), { target: key, until }] }, until };
}

/** The next moment the answer of activeBlock or the passes can change (a schedule edge, a pass or a manual block ending). */
export function nextChange(data: FocusBlockData, ctx: BlockContext): number | undefined {
  const times: number[] = [];
  for (const p of data.passes) if (p.until > ctx.now) times.push(p.until);
  if (data.manual && data.manual.until > ctx.now) times.push(data.manual.until);
  if (data.skipUntil && data.skipUntil > ctx.now) times.push(data.skipUntil);
  if (ctx.focusOn && ctx.focusEndsAt && ctx.focusEndsAt > ctx.now) times.push(ctx.focusEndsAt);
  if (data.schedules.some((s) => s.on)) {
    // The next whole minute that is a schedule's start or end.
    const d = new Date(ctx.now);
    d.setSeconds(0, 0);
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      d.setMinutes(d.getMinutes() + 1);
      const min = d.getHours() * 60 + d.getMinutes();
      if (data.schedules.some((s) => s.on && (s.start === min || s.end === min))) { times.push(d.getTime()); break; }
    }
  }
  return times.length ? Math.min(...times) : undefined;
}

/** Ends a block early (not strict): the manual block stops, and a schedule's block is skipped until it would have ended. */
export function stopEarly(data: FocusBlockData, block: ActiveBlock, now: number): { data: FocusBlockData } | { error: string } {
  if (!block.on) return { data };
  if (block.strict) return { error: block.until ? `Strict mode is on: the block ends at ${clock(block.until)}.` : 'Strict mode is on: the block ends with the session.' };
  const sched = block.reasons.filter((r) => r.kind === 'schedule').map((r) => r.until ?? now);
  return { data: { ...data, manual: undefined, passes: [], skipUntil: sched.length ? Math.max(...sched) : data.skipUntil, skipFocus: block.reasons.some((r) => r.kind === 'focus') || data.skipFocus } };
}

/** "11:30" in the computer's own way of writing times. */
export function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Blocked until 11:30 · Focus session" for the block page and the Island. */
export function blockLine(b: ActiveBlock): string {
  if (!b.on) return 'Nothing is blocked';
  const why = b.reasons.map((r) => r.label).join(' · ');
  return b.until ? `Blocked until ${clock(b.until)} · ${why}` : `Blocked · ${why}`;
}

/** "HH:MM" → minutes after midnight, or undefined. */
export function parseClock(s: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

export const minutesText = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Cleans data read from disk or sent by the window: bad entries are dropped, not kept half-valid. */
export function cleanFocusBlockData(raw: unknown): FocusBlockData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<FocusBlockData>;
  const lists = (Array.isArray(o.lists) ? o.lists : []).filter((l): l is BlockList => !!l && typeof l.id === 'string' && typeof l.name === 'string').map((l) => ({
    id: l.id.slice(0, 64),
    name: l.name.slice(0, 80) || 'Untitled',
    sites: [...new Set((Array.isArray(l.sites) ? l.sites : []).map((s) => normalizeSite(String(s))).filter((s): s is string => !!s))].slice(0, 500),
    apps: [...new Set((Array.isArray(l.apps) ? l.apps : []).map((a) => String(a).trim().slice(0, 200)).filter(Boolean))].slice(0, 200),
  }));
  const ids = new Set(lists.map((l) => l.id));
  const schedules = (Array.isArray(o.schedules) ? o.schedules : []).filter((s): s is BlockSchedule => !!s && typeof s.id === 'string' && ids.has(s.listId)).map((s) => ({
    id: s.id.slice(0, 64), listId: s.listId,
    days: [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    start: clamp(Math.round(Number(s.start) || 0), 0, 1439), end: clamp(Math.round(Number(s.end) || 0), 0, 1439), on: s.on !== false,
  }));
  const manual = o.manual && ids.has(o.manual.listId) && Number.isFinite(o.manual.until) ? { listId: o.manual.listId, until: Number(o.manual.until), strict: o.manual.strict === true } : undefined;
  const passes = (Array.isArray(o.passes) ? o.passes : []).filter((p) => p && typeof p.target === 'string' && Number.isFinite(p.until)).map((p) => ({ target: p.target.toLowerCase(), until: Number(p.until) }));
  return {
    lists, schedules,
    focusList: typeof o.focusList === 'string' && ids.has(o.focusList) ? o.focusList : null,
    manual, passes,
    skipUntil: Number.isFinite(o.skipUntil) ? Number(o.skipUntil) : undefined,
    skipFocus: o.skipFocus === true || undefined,
    blockedToday: o.blockedToday && typeof o.blockedToday.day === 'string' ? { day: o.blockedToday.day, count: Number(o.blockedToday.count) || 0 } : undefined,
  };
}

/** Counts one blocked moment (a page or an app stopped) for today's line. */
export function countBlocked(data: FocusBlockData, now: number): FocusBlockData {
  const day = new Date(now).toDateString();
  const n = data.blockedToday?.day === day ? data.blockedToday.count + 1 : 1;
  return { ...data, blockedToday: { day, count: n } };
}

export function blockedTodayCount(data: FocusBlockData, now: number): number {
  return data.blockedToday?.day === new Date(now).toDateString() ? data.blockedToday.count : 0;
}

/** What the browser extension is sent: the sites to send to its block page, and what that page says. */
export interface BrowserFocusBlock {
  sites: string[];
  until?: number;
  strict: boolean;
  waitSeconds: number;
  passMinutes: number;
  why: string;
}

export function browserBlock(b: ActiveBlock, opts: FocusBlockOptions): BrowserFocusBlock {
  return { sites: b.on ? b.sites.slice(0, 1000) : [], until: b.until, strict: b.strict, waitSeconds: opts.waitSeconds, passMinutes: opts.passMinutes, why: b.reasons.map((r) => r.label).join(' · ') };
}
