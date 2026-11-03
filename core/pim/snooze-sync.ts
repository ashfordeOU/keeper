// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Snooze across the person's computers: each snoozed message carries an IMAP
// keyword with the time it comes back ("$KSnooze-<minutes in base 36>"), so
// another Keeper reading the same mailbox hides it too and brings it back at
// the same time. Servers that do not keep keywords get a small JSON note in a
// hidden folder instead. Pure: no network.

export const SNOOZE_PREFIX = '$KSnooze-';
/** the hidden folder for servers without keywords */
export const SNOOZE_FOLDER = 'Keeper Snoozes';
export const NOTE_SUBJECT = 'Keeper snoozes (kept by Keeper, leave as is)';

export function snoozeKeyword(until: number): string {
  return SNOOZE_PREFIX + Math.round(until / 60_000).toString(36);
}

/** The time in a snooze keyword, or undefined. */
export function snoozeFromKeyword(k: string): number | undefined {
  if (!k.startsWith(SNOOZE_PREFIX)) return undefined;
  const v = parseInt(k.slice(SNOOZE_PREFIX.length), 36);
  return Number.isFinite(v) && v > 0 ? v * 60_000 : undefined;
}

/** The latest snooze time among a message's keywords. */
export function snoozeOfFlags(flags: Iterable<string>): number | undefined {
  let best: number | undefined;
  for (const f of flags) {
    const t = snoozeFromKeyword(f);
    if (t !== undefined && (best === undefined || t > best)) best = t;
  }
  return best;
}

/** Does the server keep any keyword (PERMANENTFLAGS has \*)? */
export function keepsKeywords(permanentFlags: Iterable<string> | undefined): boolean {
  if (!permanentFlags) return false;
  for (const f of permanentFlags) if (f === '\\*') return true;
  return false;
}

export interface SnoozeEntry {
  /** the message's Message-ID (the same on every computer; uids are per folder) */
  messageId: string;
  until: number;
  /** when it was set or cleared here (the newest change wins) */
  at: number;
  /** cleared (unsnoozed or back) */
  done?: boolean;
}

/** The note kept in the hidden folder. */
export function noteBody(entries: SnoozeEntry[], now: number): string {
  // Old finished entries are dropped after a week.
  const keep = entries.filter((e) => !e.done || now - e.at < 7 * 86_400_000);
  return JSON.stringify({ v: 1, entries: keep });
}

export function readNote(text: string): SnoozeEntry[] {
  try {
    const j = JSON.parse(text.trim()) as { v?: number; entries?: SnoozeEntry[] };
    return Array.isArray(j.entries) ? j.entries.filter((e) => typeof e.messageId === 'string' && typeof e.until === 'number' && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

/** Two computers' lists together: per message, the newer change wins. */
export function mergeEntries(a: SnoozeEntry[], b: SnoozeEntry[]): SnoozeEntry[] {
  const m = new Map<string, SnoozeEntry>();
  for (const e of [...a, ...b]) {
    const o = m.get(e.messageId);
    if (!o || e.at > o.at) m.set(e.messageId, e);
  }
  return [...m.values()];
}

/**
 * What changes here after reading the server: messages snoozed elsewhere
 * (to hide until their time) and ones woken or unsnoozed elsewhere.
 */
export function adoptRemote(local: { messageId?: string; until?: number }[], remote: SnoozeEntry[], now: number): { snooze: { messageId: string; until: number }[]; wake: string[] } {
  const here = new Map(local.filter((l) => l.messageId).map((l) => [l.messageId!, l.until]));
  const snooze: { messageId: string; until: number }[] = [];
  const wake: string[] = [];
  for (const r of remote) {
    const mine = here.get(r.messageId);
    if (r.done) { if (mine !== undefined) wake.push(r.messageId); continue; }
    if (r.until <= now) continue;
    if (mine !== r.until) snooze.push({ messageId: r.messageId, until: r.until });
  }
  return { snooze, wake };
}
