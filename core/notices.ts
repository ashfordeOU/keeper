// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One notification center: every notice Keeper's parts give (a site that went
// down, new mail, a Fix-it item, an update) is listed in one place, grouped by
// part, and delivered the way the person chose for that part: Now, Batched (a
// few times a day, as one calm summary) or Silent (listed only). Quiet hours
// and Keeper's focus timer hold notices back; urgent ones (alarms, a scam
// warning) always come through. Pure: electron/services/notices.ts keeps the
// list and the one timer, which runs only while something is held.

export type Delivery = 'now' | 'batched' | 'silent';
export type BatchTimes = 'thrice' | 'hourly';

export interface NoticePart {
  id: string;
  label: string;
  /** the part in core/features.ts it belongs to (hidden in Settings while that part is off) */
  feature?: string;
  /** how it is delivered until the person chooses */
  delivery: Delivery;
}

/** Every part that gives notices, in the order the center lists them. */
export const NOTICE_PARTS: NoticePart[] = [
  { id: 'mail', label: 'Mail', feature: 'mail', delivery: 'now' },
  { id: 'calendar', label: 'Calendar and reminders', feature: 'calendars', delivery: 'now' },
  { id: 'monitors', label: 'Sites and servers', feature: 'monitors', delivery: 'now' },
  { id: 'network', label: 'Network & firewall', feature: 'firewall', delivery: 'now' },
  { id: 'privacy', label: 'Privacy & Security', feature: 'protection', delivery: 'batched' },
  { id: 'fixit', label: 'Fix-it List', feature: 'guide', delivery: 'batched' },
  { id: 'health', label: 'Health', feature: 'health', delivery: 'batched' },
  { id: 'aiusage', label: 'AI usage', feature: 'usageTracker', delivery: 'batched' },
  { id: 'reader', label: 'Reader', feature: 'reader', delivery: 'batched' },
  { id: 'updates', label: 'Keeper updates', feature: 'updates', delivery: 'batched' },
  { id: 'keeper', label: 'Keeper itself', delivery: 'batched' },
];

export const DELIVERY_CHOICES: { value: Delivery; label: string; line: string }[] = [
  { value: 'now', label: 'Now', line: 'Shown as it happens.' },
  { value: 'batched', label: 'Batched', line: 'Gathered into one summary a few times a day.' },
  { value: 'silent', label: 'Silent', line: 'Only listed here.' },
];

export const BATCH_CHOICES: { value: BatchTimes; label: string }[] = [
  { value: 'thrice', label: 'At 9, 13 and 17' },
  { value: 'hourly', label: 'Every hour' },
];

/** The hours a three-times-a-day batch goes out. */
export const BATCH_HOURS = [9, 13, 17];

export interface NoticeSettings {
  /** part id → how it is delivered; parts not listed use their default */
  delivery: Record<string, Delivery>;
  batch: BatchTimes;
  quiet: { on: boolean; from: string; to: string };
  /** hold notices while Keeper's focus timer runs */
  followFocus: boolean;
  /** hold notices while the system's own Do Not Disturb is on, where Keeper can read it */
  followSystem: boolean;
}

export const defaultNoticeSettings = (): NoticeSettings => ({
  delivery: {},
  batch: 'thrice',
  quiet: { on: false, from: '22:00', to: '08:00' },
  followFocus: true,
  followSystem: true,
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeNoticeSettings(v: unknown): NoticeSettings {
  const d = defaultNoticeSettings();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<NoticeSettings>;
  const delivery: Record<string, Delivery> = {};
  if (r.delivery && typeof r.delivery === 'object') {
    for (const [k, x] of Object.entries(r.delivery)) if (NOTICE_PARTS.some((p) => p.id === k) && (x === 'now' || x === 'batched' || x === 'silent')) delivery[k] = x;
  }
  const q = (r.quiet ?? {}) as Partial<NoticeSettings['quiet']>;
  return {
    delivery,
    batch: r.batch === 'hourly' ? 'hourly' : 'thrice',
    quiet: { on: q.on === true, from: HHMM.test(q.from ?? '') ? q.from! : d.quiet.from, to: HHMM.test(q.to ?? '') ? q.to! : d.quiet.to },
    followFocus: r.followFocus !== false,
    followSystem: r.followSystem !== false,
  };
}

export const partOf = (id: string): NoticePart => NOTICE_PARTS.find((p) => p.id === id) ?? NOTICE_PARTS[NOTICE_PARTS.length - 1];

export function deliveryOf(part: string, s: NoticeSettings): Delivery {
  return s.delivery[part] ?? partOf(part).delivery;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Inside quiet hours? "22:00 to 08:00" goes past midnight. */
export function inQuietHours(now: Date, q: NoticeSettings['quiet']): boolean {
  if (!q.on) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const a = minutes(q.from);
  const b = minutes(q.to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** When quiet hours end, from inside them. */
export function quietEnds(now: Date, q: NoticeSettings['quiet']): number {
  const end = new Date(now);
  end.setHours(Number(q.to.slice(0, 2)), Number(q.to.slice(3, 5)), 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export interface DeliveryContext {
  now: Date;
  /** Keeper's focus timer is running */
  focus?: boolean;
  /** the system's Do Not Disturb is on (where readable) */
  systemQuiet?: boolean;
  /** "Snooze all" until then */
  snoozedUntil?: number;
}

/** Why nothing is shown just now, or null when notices may be shown. */
export function holdReason(s: NoticeSettings, c: DeliveryContext): 'snoozed' | 'quiet' | 'focus' | 'system' | null {
  if (c.snoozedUntil && c.snoozedUntil > c.now.getTime()) return 'snoozed';
  if (inQuietHours(c.now, s.quiet)) return 'quiet';
  if (s.followFocus && c.focus) return 'focus';
  if (s.followSystem && c.systemQuiet) return 'system';
  return null;
}

/**
 * What happens to a new notice: shown now, held for the next batch, or only
 * listed. Urgent ones (an alarm, a scam warning) are always shown.
 */
export function decide(n: { part: string; urgent?: boolean }, s: NoticeSettings, c: DeliveryContext): 'show' | 'hold' | 'list' {
  if (n.urgent) return 'show';
  const d = deliveryOf(n.part, s);
  if (d === 'silent') return 'list';
  if (d === 'batched' || holdReason(s, c)) return 'hold';
  return 'show';
}

/** The next time a batch goes out (the top of the next hour, or the next of 9, 13 and 17). */
export function nextBatchAt(now: Date, s: Pick<NoticeSettings, 'batch'>): number {
  const t = new Date(now);
  t.setSeconds(0, 0);
  if (s.batch === 'hourly') {
    t.setMinutes(0);
    t.setHours(t.getHours() + 1);
    return t.getTime();
  }
  for (const h of BATCH_HOURS) {
    const at = new Date(now);
    at.setHours(h, 0, 0, 0);
    if (at.getTime() > now.getTime()) return at.getTime();
  }
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  at.setHours(BATCH_HOURS[0], 0, 0, 0);
  return at.getTime();
}

/**
 * When held notices may go out: the next batch time for batched parts, or
 * as soon as the hold ends for parts set to Now. Quiet hours and Snooze all
 * push it to when they end; focus ends on its own (checked again in a minute).
 */
export function releaseAt(held: { part: string }[], s: NoticeSettings, c: DeliveryContext): number {
  const now = c.now.getTime();
  const anyNow = held.some((h) => deliveryOf(h.part, s) === 'now');
  let at = anyNow ? now : nextBatchAt(c.now, s);
  const reason = holdReason(s, { ...c, now: new Date(at) });
  if (reason === 'snoozed') at = Math.max(at, c.snoozedUntil!);
  if (reason === 'quiet' || (reason === null && inQuietHours(new Date(at), s.quiet))) at = Math.max(at, quietEnds(new Date(at), s.quiet));
  if (reason === 'focus' || reason === 'system') at = Math.max(at, now + 60_000);
  return Math.max(at, now);
}

// ---------------------------------------------------------------- the list

export interface Notice {
  id: string;
  part: string;
  title: string;
  detail?: string;
  at: number;
  /** a Keeper page to open */
  route?: { name: string; arg?: string };
  urgent?: boolean;
  /** dismissed ("done") */
  done?: boolean;
  /** waiting for the next batch */
  held?: boolean;
  /** the same notice again: how many times */
  count?: number;
}

/** At most this many notices are kept. */
export const KEEP = 200;
/** The same notice again within this time is counted, not listed twice. */
export const SAME_WITHIN = 10 * 60_000;

/** Adds a notice, newest first; the same part and title again soon after is counted on the open one. */
export function addNotice(list: Notice[], n: Notice): Notice[] {
  const i = list.findIndex((x) => !x.done && x.part === n.part && x.title === n.title && n.at - x.at < SAME_WITHIN);
  if (i >= 0) {
    const prev = list[i];
    const merged: Notice = { ...prev, detail: n.detail ?? prev.detail, at: n.at, count: (prev.count ?? 1) + 1, held: prev.held && n.held };
    return [merged, ...list.slice(0, i), ...list.slice(i + 1)].slice(0, KEEP);
  }
  return [n, ...list].slice(0, KEEP);
}

export const openNotices = (list: Notice[]) => list.filter((n) => !n.done);

export function markDone(list: Notice[], id: string): Notice[] {
  return list.map((n) => (n.id === id ? { ...n, done: true, held: false } : n));
}

export function markAllDone(list: Notice[]): Notice[] {
  return list.map((n) => (n.done ? n : { ...n, done: true, held: false }));
}

/** Open notices grouped by part, in the center's order, newest first in each. */
export function groupByPart(list: Notice[]): { part: NoticePart; items: Notice[] }[] {
  const open = openNotices(list);
  return NOTICE_PARTS.map((part) => ({ part, items: open.filter((n) => partOf(n.part).id === part.id).sort((a, b) => b.at - a.at) })).filter((g) => g.items.length);
}

/** One calm summary for a batch: "3 notices · 2 from Mail, 1 from Sites and servers". */
export function batchSummary(held: Notice[]): { title: string; detail: string } {
  if (held.length === 1) return { title: held[0].title, detail: held[0].detail ?? partOf(held[0].part).label };
  const counts = new Map<string, number>();
  for (const n of held) counts.set(partOf(n.part).label, (counts.get(partOf(n.part).label) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([label, k]) => `${k} from ${label}`);
  return { title: `${held.length} notices`, detail: parts.slice(0, 3).join(', ') + (parts.length > 3 ? ' and more' : '') };
}

/** The line under the center's title: "Quiet until 08:00", "Held while you focus", "Snoozed until 14:30". */
export function holdLine(reason: ReturnType<typeof holdReason>, s: NoticeSettings, c: DeliveryContext, clock: (t: number) => string): string | null {
  if (reason === 'snoozed') return `Snoozed until ${clock(c.snoozedUntil!)}`;
  if (reason === 'quiet') return `Quiet until ${clock(quietEnds(c.now, s.quiet))}`;
  if (reason === 'focus') return 'Held while you focus';
  if (reason === 'system') return 'Held while Do Not Disturb is on';
  return null;
}
