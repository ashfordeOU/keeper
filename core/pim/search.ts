// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail search with filters: from:, to:, subject:, has:attachment, is:unread
// (read, flagged), in: (inbox, sent, archive, a folder, important, updates,
// promos), label:, account:, before: and after: (2026-03-01, or 7d / 2w / 3m
// / 1y ago), newer_than: and older_than:, quoted phrases and -word to leave
// out. Parsed once; matched against cached messages here and turned into an
// IMAP SEARCH for the servers. Pure.

import { smartTab } from './smart';
import type { Address, MessageSummary } from './types';

export interface MailQuery {
  words: string[];
  not: string[];
  from: string[];
  to: string[];
  subject: string[];
  labels: string[];
  in?: string;
  account?: string;
  unread?: boolean;
  flagged?: boolean;
  attachment?: boolean;
  after?: number;
  before?: number;
  /** what was typed */
  raw: string;
}

const lc = (s?: string) => (s ?? '').toLowerCase();
const DAY = 86_400_000;

/** "2026-03-01", "2026/3/1", "7d", "2w", "3m", "1y" → a time (relative ones count back from now). */
export function parseWhen(v: string, now: number): number | undefined {
  const rel = v.match(/^(\d+)([dwmy])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    const u = rel[2].toLowerCase();
    if (u === 'd') d.setDate(d.getDate() - n);
    else if (u === 'w') d.setDate(d.getDate() - 7 * n);
    else if (u === 'm') d.setMonth(d.getMonth() - n);
    else d.setFullYear(d.getFullYear() - n);
    return d.getTime();
  }
  const abs = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (abs) return new Date(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3])).getTime();
  if (/^today$/i.test(v)) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (/^yesterday$/i.test(v)) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() - DAY; }
  return undefined;
}

export function parseMailQuery(q: string, now = Date.now()): MailQuery {
  const out: MailQuery = { words: [], not: [], from: [], to: [], subject: [], labels: [], raw: q };
  const terms = q.match(/-?[\w]+:"[^"]*"|-?[\w]+:\S+|-?"[^"]+"|\S+/g) ?? [];
  for (const t0 of terms) {
    const neg = t0.startsWith('-') && t0.length > 1;
    const t = neg ? t0.slice(1) : t0;
    const m = t.match(/^(\w+):(.*)$/);
    const v = m ? m[2].replace(/^"|"$/g, '') : '';
    const k = m ? m[1].toLowerCase() : '';
    if (m && v) {
      if (k === 'from') { out.from.push(lc(v)); continue; }
      if (k === 'to' || k === 'cc') { out.to.push(lc(v)); continue; }
      if (k === 'subject') { out.subject.push(lc(v)); continue; }
      if (k === 'label' || k === 'tag') { out.labels.push(lc(v)); continue; }
      if (k === 'in') { out.in = lc(v); continue; }
      if (k === 'account') { out.account = lc(v); continue; }
      if (k === 'is') {
        const x = lc(v);
        if (x === 'unread') out.unread = !neg;
        else if (x === 'read') out.unread = neg;
        else if (x === 'flagged' || x === 'starred') out.flagged = !neg;
        continue;
      }
      if (k === 'has' && /^attach/i.test(v)) { out.attachment = !neg; continue; }
      if (k === 'before' || k === 'older_than' || k === 'older') { const w = parseWhen(v, now); if (w !== undefined) { out.before = w; continue; } }
      if (k === 'after' || k === 'newer_than' || k === 'newer' || k === 'since') { const w = parseWhen(v, now); if (w !== undefined) { out.after = w; continue; } }
    }
    const word = lc(t.replace(/^"|"$/g, ''));
    if (!word) continue;
    (neg ? out.not : out.words).push(word);
  }
  return out;
}

/** Does the query use anything but plain words? */
export const hasFilters = (q: MailQuery) => !!(q.from.length || q.to.length || q.subject.length || q.labels.length || q.in || q.account || q.unread !== undefined || q.flagged !== undefined || q.attachment !== undefined || q.after || q.before || q.not.length);

const addr = (a?: Address) => (a ? lc(`${a.name ?? ''} ${a.address}`) : '');

function folderMatches(m: MessageSummary, where: string, special?: string): boolean {
  if (where === 'important' || where === 'updates' || where === 'promos') return smartTab(m) === where;
  if (where === 'other') return smartTab(m) !== 'important';
  if (special && special === where) return true;
  if (where === 'inbox') return m.folder.toUpperCase() === 'INBOX';
  if (where === 'anywhere' || where === 'all') return true;
  return lc(m.folder).includes(where);
}

export function matchMailQuery(m: MessageSummary & { text?: string }, q: MailQuery, o: { special?: string; accountLabel?: string } = {}): boolean {
  if (q.unread !== undefined && q.unread === m.seen) return false;
  if (q.flagged !== undefined && q.flagged !== m.flagged) return false;
  if (q.attachment !== undefined && q.attachment !== m.hasAttachments) return false;
  if (q.after !== undefined && m.date < q.after) return false;
  if (q.before !== undefined && m.date >= q.before) return false;
  if (q.from.some((f) => !addr(m.from).includes(f))) return false;
  if (q.to.some((f) => ![...m.to, ...m.cc].some((a) => addr(a).includes(f)))) return false;
  if (q.subject.some((s) => !lc(m.subject).includes(s))) return false;
  if (q.labels.some((l) => !(m.labels ?? []).some((x) => lc(x).includes(l)))) return false;
  if (q.in && !folderMatches(m, q.in, o.special)) return false;
  if (q.account && !(lc(m.account) === q.account || lc(o.accountLabel).includes(q.account))) return false;
  const hay = [m.subject, addr(m.from), ...m.to.map(addr), m.snippet, m.text ?? '', ...(m.labels ?? [])].join(' ').toLowerCase();
  if (q.not.some((w) => hay.includes(w))) return false;
  return q.words.every((w) => hay.includes(w));
}

/** Local results first, then the server's, each message once, newest first within each part. */
export function orderResults(local: MessageSummary[], server: MessageSummary[]): MessageSummary[] {
  const seen = new Set<string>();
  const key = (m: MessageSummary) => m.messageId ?? m.id;
  const a = [...local].sort((x, y) => y.date - x.date).filter((m) => (seen.has(key(m)) ? false : (seen.add(key(m)), true)));
  const b = [...server].sort((x, y) => y.date - x.date).filter((m) => (seen.has(key(m)) ? false : (seen.add(key(m)), true)));
  return [...a, ...b];
}

/** The same query as an IMAP SEARCH (imapflow's form); words go to the server's text search. */
export function imapCriteria(q: MailQuery): Record<string, unknown> | null {
  const c: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  for (const f of q.from) and.push({ from: f });
  for (const t of q.to) and.push({ or: [{ to: t }, { cc: t }] });
  for (const s of q.subject) and.push({ subject: s });
  for (const w of q.words) and.push({ or: [{ subject: w }, { from: w }, { body: w }] });
  for (const w of q.not) and.push({ not: { text: w } });
  if (q.unread === true) c.seen = false;
  if (q.unread === false) c.seen = true;
  if (q.flagged !== undefined) c.flagged = q.flagged;
  if (q.after) c.since = new Date(q.after);
  if (q.before) c.before = new Date(q.before);
  if (!and.length && !Object.keys(c).length) return null;
  // imapflow ANDs the keys of one object and has no AND of its own: criteria whose key is already
  // taken (several words, each an OR) are added as NOT (OR (NOT a) (NOT b) …), which is a AND b.
  const out: Record<string, unknown> = { ...c };
  const rest: Record<string, unknown>[] = [];
  for (const x of and) {
    const k = Object.keys(x)[0];
    if (k !== 'not' && !(k in out)) Object.assign(out, x);
    else rest.push(x);
  }
  if (rest.length === 1) out.not = { not: rest[0] };
  else if (rest.length > 1) out.not = { or: rest.map((x) => ({ not: x })) };
  return out;
}

/** Words for a text search on servers that only take plain words. */
export const plainWords = (q: MailQuery) => q.words.join(' ');

/** Short chips for what the filters do (shown under the search box). */
export function describeQuery(q: MailQuery): string[] {
  const d = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return [
    ...q.from.map((x) => `From ${x}`), ...q.to.map((x) => `To ${x}`), ...q.subject.map((x) => `Subject has “${x}”`), ...q.labels.map((x) => `Label ${x}`),
    ...(q.in ? [`In ${q.in}`] : []), ...(q.account ? [`Account ${q.account}`] : []),
    ...(q.unread === true ? ['Unread'] : q.unread === false ? ['Read'] : []), ...(q.flagged ? ['Flagged'] : []),
    ...(q.attachment ? ['Has attachments'] : q.attachment === false ? ['No attachments'] : []),
    ...(q.after ? [`After ${d(q.after)}`] : []), ...(q.before ? [`Before ${d(q.before)}`] : []), ...q.not.map((x) => `Without “${x}”`),
  ];
}
