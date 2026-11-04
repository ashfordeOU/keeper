// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cues: a note, checklist, link or file tied to an app, a website, a page,
// a window title (a project) or a file, and/or to a time. A cue comes back
// when you return to where it belongs, or when it is due. Pure: the main
// process feeds it what is in front and the clock; the window draws it.

import { parseQuickAdd } from '../pim/quickadd';
import { cleanLink } from '../textools';

export type CueType = 'note' | 'checklist' | 'link' | 'file';
export type AnchorKind = 'app' | 'site' | 'page' | 'title' | 'file';

export interface CueAnchor {
  kind: AnchorKind;
  /** app: its name or id (bundle id, .exe, WM_CLASS); site: a domain; page: a URL; title: words in the window title; file: a path */
  value: string;
  /** what the person sees ("Figma", "github.com") */
  label?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** left out of this run (reusable checklists) */
  skipped?: boolean;
}

export type CueRepeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export interface Cue {
  id: string;
  type: CueType;
  title: string;
  /** Markdown */
  body: string;
  items?: ChecklistItem[];
  /** the link of a link cue (or the page it was captured from) */
  url?: string;
  /** files of a file cue */
  files?: string[];
  anchors: CueAnchor[];
  /** epoch ms when it is due */
  due?: number;
  repeat?: CueRepeat;
  /** hidden until then */
  snoozedUntil?: number;
  /** "next time": wait until its place is left and visited again */
  snoozeNextVisit?: boolean;
  /** show every visit, or only the first time after it was made or snoozed */
  show: 'every' | 'once';
  done: boolean;
  doneAt?: number;
  createdAt: number;
  updatedAt: number;
  /** last time it popped up (for a calm cool-down) */
  shownAt?: number;
  /** the due time it last rang for (a due cue rings once per due time) */
  rangFor?: number;
  /** the reusable checklist it was started from */
  templateId?: string;
  tags?: string[];
  pinned?: boolean;
  /** in Recently Deleted since then (kept 30 days) */
  deletedAt?: number;
}

export interface CueTemplate {
  id: string;
  name: string;
  items: string[];
  anchors?: CueAnchor[];
  createdAt: number;
  usedAt?: number;
}

/** Ready-made checklists to start from (the gallery under Checklists); each is added as the person's own, to change freely. */
export const STARTER_CHECKLISTS: { name: string; line: string; items: string[] }[] = [
  { name: 'Before a video call', line: 'Sound, light and a tidy screen', items: ['Close apps you will not need', 'Turn on Do Not Disturb', 'Check the microphone and camera', 'Open the notes or slides', 'Glass of water nearby'] },
  { name: 'Weekly review', line: 'A calm end to the week', items: ['Empty the Inbox', 'Look at next week’s calendar', 'Pick three things for Monday', 'Tidy the Desktop and Downloads', 'Note one thing that went well'] },
  { name: 'Before a release', line: 'Ship without surprises', items: ['Tests pass', 'Changelog written', 'Version number raised', 'Backup taken', 'Tell the team'] },
  { name: 'Leaving for the day', line: 'Close the day cleanly', items: ['Write down where you stopped', 'Save and close open work', 'Plan tomorrow’s first task', 'Lock the screen'] },
  { name: 'Packing for a trip', line: 'Nothing left behind', items: ['Passport or ID', 'Chargers and adapters', 'Tickets and bookings', 'Medicines', 'Keys'] },
  { name: 'Before presenting', line: 'A clean screen and a clear head', items: ['Tidy the screen with Stage', 'Hide private tabs', 'Plug in the charger', 'Silence the phone', 'Open the first slide'] },
];

/** The starters not yet added (by name), so the gallery shrinks as they are used. */
export function startersToOffer(templates: Pick<CueTemplate, 'name'>[]): typeof STARTER_CHECKLISTS {
  const have = new Set(templates.map((t) => t.name.trim().toLowerCase()));
  return STARTER_CHECKLISTS.filter((s) => !have.has(s.name.toLowerCase()));
}

/** What is in front right now. */
export interface FrontContext {
  app?: string;
  /** bundle id, exe path or WM_CLASS, when known */
  appId?: string;
  title?: string;
  url?: string;
  /** a document path, when the app tells */
  file?: string;
}

export type CueStatus = 'waiting' | 'later' | 'overdue' | 'done' | 'deleted';

const DAY = 86_400_000;
export const DELETED_KEEP_MS = 30 * DAY;

export function newId(now = Date.now()): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------- places

/** A page's address without its fragment, tracking parameters or trailing slash, for comparing. */
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(cleanLink(input.trim()));
  } catch {
    return input.trim();
  }
  u.hash = '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '';
  const q = [...u.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${path}${q ? `?${q}` : ''}`;
}

/** The site of a URL ("docs.github.com" stays as it is; "www." is dropped). */
export function siteOf(input: string): string {
  try {
    return new URL(input.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  }
}

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/\.(app|exe)$/i, '').trim();

/** Does this anchor match what is in front? */
export function anchorMatches(a: CueAnchor, ctx: FrontContext): boolean {
  const v = a.value.trim();
  if (!v) return false;
  switch (a.kind) {
    case 'app': {
      const want = norm(v);
      const names = [norm(ctx.app), norm(ctx.appId), norm(ctx.appId?.split(/[\\/]/).pop())].filter(Boolean);
      return names.some((n) => n === want || n.endsWith(`.${want}`) || (want.length >= 3 && (n.startsWith(want) || n.split(/[^a-z0-9]+/).includes(want))));
    }
    case 'site': {
      if (!ctx.url) return false;
      const host = siteOf(ctx.url);
      const want = siteOf(v.includes('://') ? v : `https://${v}`);
      return host === want || host.endsWith(`.${want}`);
    }
    case 'page':
      return !!ctx.url && normalizeUrl(ctx.url) === normalizeUrl(v);
    case 'title': {
      if (!ctx.title) return false;
      // "/regex/" for people who want it; otherwise every word must be in the title.
      const re = v.match(/^\/(.+)\/([i]*)$/);
      if (re) {
        try {
          return new RegExp(re[1], re[2] || 'i').test(ctx.title);
        } catch {
          return false;
        }
      }
      const t = ctx.title.toLowerCase();
      return v.toLowerCase().split(/\s+/).every((w) => t.includes(w));
    }
    case 'file': {
      const base = v.split(/[\\/]/).pop()!.toLowerCase();
      if (ctx.file && ctx.file.toLowerCase() === v.toLowerCase()) return true;
      return !!base && !!ctx.title && ctx.title.toLowerCase().includes(base);
    }
  }
}

/** A short key for "the place" (so leaving and coming back can be told apart from staying). */
export function placeKey(ctx: FrontContext): string {
  return [norm(ctx.appId || ctx.app), ctx.url ? normalizeUrl(ctx.url) : '', (ctx.title ?? '').slice(0, 120)].join('|');
}

/** Words for an anchor ("in Figma", "on github.com"). */
export function describeAnchor(a: CueAnchor): string {
  const l = a.label || a.value;
  switch (a.kind) {
    case 'app': return `in ${l}`;
    case 'site': return `on ${l}`;
    case 'page': return `on this page: ${a.label || siteOf(a.value) + (safePath(a.value) || '')}`;
    case 'title': return `when the window says “${l}”`;
    case 'file': return `with ${a.label || a.value.split(/[\\/]/).pop()}`;
  }
}

function safePath(u: string): string {
  try {
    const p = new URL(u).pathname;
    return p === '/' ? '' : p.length > 30 ? p.slice(0, 29) + '…' : p;
  } catch {
    return '';
  }
}

/** Anchors offered for one-click "attach to what is in front". */
export function anchorsFor(ctx: FrontContext): CueAnchor[] {
  const out: CueAnchor[] = [];
  if (ctx.url && /^https?:/i.test(ctx.url)) {
    out.push({ kind: 'page', value: normalizeUrl(ctx.url), label: ctx.title?.slice(0, 80) || undefined });
    out.push({ kind: 'site', value: siteOf(ctx.url), label: siteOf(ctx.url) });
  }
  if (ctx.app) out.push({ kind: 'app', value: ctx.appId || ctx.app, label: ctx.app });
  const project = projectOf(ctx);
  if (project) out.push({ kind: 'title', value: project, label: project });
  if (ctx.file) out.push({ kind: 'file', value: ctx.file });
  return out;
}

/**
 * Project awareness: the project part of a window title, from the patterns
 * editors and design tools use ("file.ts — myproject — Editor", "Project – Design").
 */
export function projectOf(ctx: FrontContext): string | undefined {
  const t = ctx.title?.trim();
  if (!t) return undefined;
  const parts = t.split(/\s+[—–-]\s+|\s+\|\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const app = norm(ctx.app);
  const rest = parts.filter((p) => norm(p) !== app && !/^(untitled|new tab|home)$/i.test(p));
  if (!rest.length) return undefined;
  // "file — project — app": the middle part; "project — app": the first; editors show "● file" for unsaved.
  const pick = rest.length >= 2 && /\.[a-z0-9]{1,6}$/i.test(rest[0].replace(/^●\s*/, '')) ? rest[1] : rest[0];
  return pick.replace(/^●\s*/, '').slice(0, 60);
}

// ---------------------------------------------------------------- status and timing

export function statusOf(c: Cue, now = Date.now()): CueStatus {
  if (c.deletedAt) return 'deleted';
  if (c.done) return 'done';
  if (c.snoozedUntil && c.snoozedUntil > now) return 'later';
  if (c.due !== undefined) return c.due <= now ? 'overdue' : 'later';
  return 'waiting';
}

/** Cues that should pop up for what is in front, best first. */
export function cuesFor(cues: Cue[], ctx: FrontContext, now = Date.now(), cooldownMs = 10 * 60_000): Cue[] {
  return cues
    .filter((c) => !c.deletedAt && !c.done && c.anchors.length)
    .filter((c) => !(c.snoozedUntil && c.snoozedUntil > now) && !c.snoozeNextVisit)
    .filter((c) => !(c.show === 'once' && c.shownAt && c.shownAt >= c.updatedAt))
    .filter((c) => !c.shownAt || now - c.shownAt >= cooldownMs)
    .filter((c) => c.anchors.some((a) => anchorMatches(a, ctx)))
    .sort((a, b) => specificity(b, ctx) - specificity(a, ctx) || Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
}

/** A page cue is more specific than a site cue, which beats a title, which beats an app cue. */
function specificity(c: Cue, ctx: FrontContext): number {
  const rank: Record<AnchorKind, number> = { page: 5, file: 4, title: 3, site: 2, app: 1 };
  return Math.max(0, ...c.anchors.filter((a) => anchorMatches(a, ctx)).map((a) => rank[a.kind]));
}

/** Leaving a place clears "next visit" snoozes that belonged to it. */
export function leftPlace(cues: Cue[], left: FrontContext): Cue[] {
  return cues.map((c) => (c.snoozeNextVisit && c.anchors.some((a) => anchorMatches(a, left)) ? { ...c, snoozeNextVisit: false } : c));
}

/** Timed cues whose time has come and that have not rung for it yet. */
export function dueNow(cues: Cue[], now = Date.now()): Cue[] {
  return cues.filter((c) => !c.deletedAt && !c.done && c.due !== undefined && c.due <= now && c.rangFor !== c.due && !(c.snoozedUntil && c.snoozedUntil > now));
}

/** The soonest moment something timed needs a look (for one timer instead of polling). */
export function nextWake(cues: Cue[], now = Date.now()): number | undefined {
  let best: number | undefined;
  for (const c of cues) {
    if (c.deletedAt || c.done) continue;
    for (const t of [c.due !== undefined && c.rangFor !== c.due ? c.due : undefined, c.snoozedUntil]) {
      if (t !== undefined && t > now && (best === undefined || t < best)) best = t;
    }
  }
  return best;
}

export type SnoozeChoice = '10m' | '1h' | '3h' | 'tonight' | 'tomorrow' | 'nextweek' | 'nextvisit';

export function snoozeUntil(choice: SnoozeChoice, now = Date.now()): number | undefined {
  const d = new Date(now);
  switch (choice) {
    case '10m': return now + 10 * 60_000;
    case '1h': return now + 3_600_000;
    case '3h': return now + 3 * 3_600_000;
    case 'tonight': d.setHours(19, 0, 0, 0); return d.getTime() > now ? d.getTime() : now + 3 * 3_600_000;
    case 'tomorrow': d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime();
    case 'nextweek': d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.getTime();
    case 'nextvisit': return undefined;
  }
}

export function snooze(c: Cue, choice: SnoozeChoice | number, now = Date.now()): Cue {
  if (choice === 'nextvisit') return { ...c, snoozeNextVisit: true, snoozedUntil: undefined, updatedAt: now };
  const until = typeof choice === 'number' ? choice : snoozeUntil(choice, now)!;
  // A timed cue moves its time; an anchored one is quiet until then.
  return c.due !== undefined && c.due <= now ? { ...c, due: until, rangFor: undefined, snoozedUntil: undefined, updatedAt: now } : { ...c, snoozedUntil: until, updatedAt: now };
}

export function nextOccurrence(due: number, repeat: CueRepeat, now = Date.now()): number {
  const d = new Date(due);
  const step = () => {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
  };
  step();
  for (let i = 0; i < 1000 && d.getTime() <= now; i++) step();
  return d.getTime();
}

/** Done: a repeating cue comes back at its next time with its checklist unticked. */
export function complete(c: Cue, now = Date.now()): Cue {
  if (c.repeat) {
    const base = c.due ?? now;
    return { ...c, due: nextOccurrence(base, c.repeat, now), rangFor: undefined, snoozedUntil: undefined, items: c.items?.map((i) => ({ ...i, done: false, skipped: false })), updatedAt: now, doneAt: now };
  }
  return { ...c, done: true, doneAt: now, updatedAt: now };
}

export function reopen(c: Cue, now = Date.now()): Cue {
  return { ...c, done: false, doneAt: undefined, updatedAt: now };
}

export function toggleItem(c: Cue, itemId: string, now = Date.now()): Cue {
  const items = (c.items ?? []).map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
  return { ...c, items, updatedAt: now };
}

export function skipItem(c: Cue, itemId: string, now = Date.now()): Cue {
  return { ...c, items: (c.items ?? []).map((i) => (i.id === itemId ? { ...i, skipped: !i.skipped } : i)), updatedAt: now };
}

/** Every step that is not skipped is ticked. */
export function checklistDone(c: Cue): boolean {
  const live = (c.items ?? []).filter((i) => !i.skipped);
  return live.length > 0 && live.every((i) => i.done);
}

export function progressOf(c: Cue): { done: number; total: number } {
  const live = (c.items ?? []).filter((i) => !i.skipped);
  return { done: live.filter((i) => i.done).length, total: live.length };
}

// ---------------------------------------------------------------- writing one

export interface CueDraft {
  title: string;
  body: string;
  type: CueType;
  items?: string[];
  url?: string;
  due?: number;
  repeat?: CueRepeat;
  anchors: CueAnchor[];
}

const RRULE_TO_REPEAT: [RegExp, CueRepeat][] = [
  [/BYDAY=MO,TU,WE,TH,FR/, 'weekdays'], [/FREQ=DAILY/, 'daily'], [/FREQ=WEEKLY/, 'weekly'], [/FREQ=MONTHLY/, 'monthly'], [/FREQ=YEARLY/, 'yearly'],
];

/**
 * What the person typed into a composer, read like the reminder quick-add:
 * "Send the invoice tomorrow 9am", "stand-up notes every weekday 9:15",
 * "@figma check the comments", "on github.com review PRs". Lines starting
 * with "- " or "[ ]" become checklist steps; a lone URL makes a link cue.
 */
export function parseCueInput(text: string, now = Date.now()): CueDraft {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const stepRe = /^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\[[ xX]?\]\s*|\d+[.)]\s+)(.+)$/;
  const steps = lines.map((l) => l.match(stepRe)?.[1]?.trim()).filter((s): s is string => !!s);
  const rest = lines.filter((l) => !stepRe.test(l));
  let head = (rest.find((l) => l.trim()) ?? '').trim();
  const bodyLines = rest.slice(rest.findIndex((l) => l.trim()) + 1);
  const anchors: CueAnchor[] = [];
  // @name → an app; @domain.tld → a site; "on domain.tld" → a site.
  head = head.replace(/(^|\s)@([\w.-]+)/g, (_m, sp: string, v: string) => {
    anchors.push(/\.[a-z]{2,}$/i.test(v) ? { kind: 'site', value: v.toLowerCase(), label: v.toLowerCase() } : { kind: 'app', value: v, label: v });
    return sp;
  });
  head = head.replace(/(^|\s)on\s+((?:[a-z0-9-]+\.)+[a-z]{2,})(?=\s|$)/i, (_m, sp: string, v: string) => {
    anchors.push({ kind: 'site', value: v.toLowerCase(), label: v.toLowerCase() });
    return sp;
  });
  let url: string | undefined;
  const urlM = head.match(/https?:\/\/\S+/);
  if (urlM) {
    url = cleanLink(urlM[0]);
    head = head.replace(urlM[0], ' ');
  }
  let due: number | undefined;
  let repeat: CueRepeat | undefined;
  let title = head.replace(/\s+/g, ' ').trim();
  if (title) {
    const q = parseQuickAdd(title, now);
    // Only when the words really held a time (the quick-add leaves the title alone otherwise).
    if (q && q.title.replace(/\s+/g, ' ').trim().toLowerCase() !== title.toLowerCase()) {
      title = q.title === 'New event' ? '' : q.title;
      due = q.allDay ? new Date(q.start).setHours(9, 0, 0, 0) : q.start;
      if (q.rrule) repeat = RRULE_TO_REPEAT.find(([re]) => re.test(q.rrule!))?.[1];
      if (repeat && due < now) due = nextOccurrence(due, repeat, now);
    }
  }
  title = title.replace(/^(remind me to|remind me|reminder:?)\s+/i, '').replace(/\s+(in|on|at)$/i, '').trim();
  const type: CueType = steps.length ? 'checklist' : url && !title ? 'link' : url ? 'link' : 'note';
  if (!title) title = url ? siteOf(url) : steps[0] ?? 'Cue';
  return { title: title.slice(0, 200), body: bodyLines.join('\n').trim(), type, items: steps.length ? steps : undefined, url, due, repeat, anchors };
}

export function cueFromDraft(d: CueDraft, now = Date.now(), extra: Partial<Cue> = {}): Cue {
  return {
    id: newId(now), type: d.type, title: d.title, body: d.body, url: d.url, due: d.due, repeat: d.repeat,
    items: d.items?.map((t, i) => ({ id: `i${i}${Math.random().toString(36).slice(2, 5)}`, text: t, done: false })),
    anchors: dedupeAnchors(d.anchors), show: 'every', done: false, createdAt: now, updatedAt: now, ...extra,
  };
}

export function dedupeAnchors(list: CueAnchor[]): CueAnchor[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = `${a.kind}:${a.value.toLowerCase()}`;
    return a.value.trim() && !seen.has(k) && (seen.add(k), true);
  });
}

// ---------------------------------------------------------------- reusable checklists

export function templateFromCue(c: Cue, name = c.title, now = Date.now()): CueTemplate {
  return { id: newId(now), name, items: (c.items ?? []).map((i) => i.text), anchors: c.anchors.length ? c.anchors : undefined, createdAt: now };
}

/** A fresh run of a reusable checklist; `skip` leaves steps out of this run. */
export function startRun(t: CueTemplate, now = Date.now(), opts: { skip?: number[]; anchors?: CueAnchor[]; due?: number } = {}): Cue {
  return {
    id: newId(now), type: 'checklist', title: t.name, body: '', templateId: t.id,
    items: t.items.map((text, i) => ({ id: `i${i}${Math.random().toString(36).slice(2, 5)}`, text, done: false, skipped: opts.skip?.includes(i) || undefined })),
    anchors: opts.anchors ?? t.anchors ?? [], due: opts.due, show: 'every', done: false, createdAt: now, updatedAt: now,
  };
}

// ---------------------------------------------------------------- housekeeping

export function softDelete(c: Cue, now = Date.now()): Cue {
  return { ...c, deletedAt: now, updatedAt: now };
}

export function restore(c: Cue, now = Date.now()): Cue {
  return { ...c, deletedAt: undefined, updatedAt: now };
}

/** Cues in Recently Deleted for longer than 30 days go for good. */
export function purgeOld(cues: Cue[], now = Date.now()): { keep: Cue[]; gone: Cue[] } {
  const keep: Cue[] = [];
  const gone: Cue[] = [];
  for (const c of cues) (c.deletedAt && now - c.deletedAt > DELETED_KEEP_MS ? gone : keep).push(c);
  return { keep, gone };
}

/** The capture hint: after time on a page, offer once to leave a cue there. */
export function shouldHint(o: { dwellMs: number; minDwellMs: number; lastHintAt?: number; minGapMs: number; hasCue: boolean; url?: string; now?: number }): boolean {
  if (!o.url || !/^https?:/i.test(o.url) || o.hasCue) return false;
  if (o.dwellMs < o.minDwellMs) return false;
  const now = o.now ?? Date.now();
  return !o.lastHintAt || now - o.lastHintAt >= o.minGapMs;
}
