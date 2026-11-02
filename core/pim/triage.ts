// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sorting and follow-up for mail, with no network: Important vs Other (security
// alerts always Important), sent mail still waiting for an answer, newsletters
// you never open, snooze and send-later times, the undo-send window, and the
// small helpers the AI features use (picking mail for a question, splitting
// suggested replies).

import { makeReply, threadMessages, type Draft } from './mail';
import type { Address, MessageSummary, Thread } from './types';

const DAY = 86_400_000;
const lc = (s?: string) => (s ?? '').toLowerCase();

// ---------------------------------------------------------------- security alerts and sign-in codes

const SECURITY = [
  /\b(sign|log)[- ]?(in|on)\b.{0,40}\b(attempt|alert|activity|detected|unusual|suspicious|new|blocked|from a new|code|link|request)\b/i,
  /\b(new|unusual|suspicious|unrecognized|unrecognised)\b.{0,20}\b(sign[- ]?in|log[- ]?in|login|device|location|activity)\b/i,
  /\b(verification|security|confirmation|one[- ]time|login|sign[- ]?in|authentication|access|2fa|mfa|otp)\s+(code|pin|passcode|link)\b/i,
  /\b(your|the)\s+code\s+(is|:)/i,
  /\bpassword\b.{0,20}\b(reset|changed|change|recovery|expired|expires)\b/i,
  /\breset (your|the) password\b/i,
  /\bsecurity (alert|notice|warning|notification|check)\b/i,
  /\b(two|2)[- ](step|factor)\b/i,
  /\b(verify|confirm) (your|this) (email|identity|account|sign[- ]?in|device|login)\b/i,
  /\bmagic (sign[- ]?in )?link\b/i,
  /\bpasskey\b/i,
  // A few other languages.
  /\b(sicherheitswarnung|bestätigungscode|anmeldecode|code de (vérification|sécurité|connexion)|código de (verificación|seguridad|acceso)|codice di (verifica|sicurezza)|verificatiecode|beveiligingscode)\b/i,
];

/** Security mail: sign-in alerts, codes, password resets. Always Important, never shown to agents. */
export function isSecurityAlert(m: Pick<MessageSummary, 'subject' | 'snippet'> & { text?: string }): boolean {
  const hay = `${m.subject}\n${m.snippet}\n${(m.text ?? '').slice(0, 1500)}`;
  return SECURITY.some((r) => r.test(hay));
}

/** A one-time code in the text: 4–8 digits (or 6–8 letters and digits) near a word about codes. */
export function hasSignInCode(text: string): boolean {
  const t = text.slice(0, 4000);
  if (!/\b(code|otp|passcode|pin|verification|verify|sign[- ]?in|log[- ]?in|2fa|token|código|codice|bestätigung)\b/i.test(t)) return false;
  return /(?<![\w./-])(\d{3}[ -]?\d{3}|\d{4,8}|(?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})(?![\w/-])/.test(t);
}

/** Blanks code-like tokens that sit next to the word "code" (for text shown outside Keeper). */
export function redactCodes(text: string): string {
  return text
    .replace(/((?:code|otp|passcode|pin|token)\b[^\n\d]{0,24})(\d[\d -]{2,10}\d|[A-Z0-9]{6,8})/gi, (_m, pre: string) => `${pre}[code hidden]`)
    .replace(/(\b\d{3}[ -]?\d{3}\b)(?=[^\n]{0,30}\b(?:is your|code)\b)/gi, '[code hidden]');
}

// ---------------------------------------------------------------- Important and Other

/** Local parts of addresses that are machines, not people. */
const AUTOMATED = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|noreply|mailer[-_.]?daemon|postmaster|bounce[s]?|news(letter)?s?|marketing|promo(tions)?|offers?|deals|digest|updates?|notifications?|notify|alerts?|info|hello|hi|team|support|billing|invoice[s]?|receipts?|orders?|shipping|account[s]?|mailer|campaign[s]?|email|e-?mail|members?|community|events?|reply|automated|system|admin|feedback|survey[s]?)([-_.+].*)?$/i;

export function isAutomatedSender(a?: Address): boolean {
  if (!a?.address) return true;
  const [local, domain = ''] = lc(a.address).split('@');
  if (AUTOMATED.test(local)) return true;
  // Bulk senders often use a mail subdomain of their own.
  return /^(e|em|email|mail|mailer|news|newsletter|marketing|info|bounce|mg|sg|send|click|mailing)\d*\./.test(domain);
}

export interface TriageContext {
  /** your own addresses (lower case) */
  me: Set<string>;
  /** people you have written to or keep as contacts (lower case) */
  correspondents: Set<string>;
  /** Message-IDs of mail you sent: a reply to one of them is Important */
  sentIds: Set<string>;
  /** senders you moved to Important / Other by hand (lower case) */
  important?: Set<string>;
  other?: Set<string>;
}

export type Category = 'important' | 'other';

export interface Triage {
  category: Category;
  security: boolean;
  /** why, in a few words (shown as a tooltip) */
  why: string;
}

/**
 * Important or Other, for an inbox message. People you know and replies to
 * your mail are Important; newsletters, receipts and other machine-sent mail
 * are Other. Security alerts are always Important.
 */
export function classify(m: MessageSummary, ctx: TriageContext): Triage {
  const sender = lc(m.from?.address);
  if (isSecurityAlert(m)) return { category: 'important', security: true, why: 'Security alert' };
  if (ctx.other?.has(sender)) return { category: 'other', security: false, why: 'You chose Other for this sender' };
  if (ctx.important?.has(sender)) return { category: 'important', security: false, why: 'You chose Important for this sender' };
  if (m.flagged) return { category: 'important', security: false, why: 'Flagged' };
  if (ctx.me.has(sender)) return { category: 'important', security: false, why: 'From you' };
  const refs = [...(m.references ?? []), ...(m.inReplyTo ? [m.inReplyTo] : [])];
  if (refs.some((r) => ctx.sentIds.has(r))) return { category: 'important', security: false, why: 'A reply to your mail' };
  if (m.bulk || m.unsub) return { category: 'other', security: false, why: 'Mailing list or newsletter' };
  if (ctx.correspondents.has(sender)) return { category: 'important', security: false, why: 'Someone you write to' };
  if (isAutomatedSender(m.from)) return { category: 'other', security: false, why: 'Sent automatically' };
  const direct = m.to.some((a) => ctx.me.has(lc(a.address)));
  return direct ? { category: 'important', security: false, why: 'Written to you' } : { category: 'other', security: false, why: 'Not addressed to you' };
}

/** Builds the context from what Keeper already has: sent mail, contacts and recent recipients. */
export function triageContext(o: { me: string[]; sent: MessageSummary[]; contacts?: string[]; recent?: string[]; important?: string[]; other?: string[] }): TriageContext {
  const me = new Set(o.me.map(lc));
  const correspondents = new Set<string>([...(o.contacts ?? []), ...(o.recent ?? [])].map(lc));
  const sentIds = new Set<string>();
  for (const m of o.sent) {
    if (m.messageId) sentIds.add(m.messageId);
    for (const a of [...m.to, ...m.cc]) if (!me.has(lc(a.address))) correspondents.add(lc(a.address));
  }
  return { me, correspondents, sentIds, important: new Set((o.important ?? []).map(lc)), other: new Set((o.other ?? []).map(lc)) };
}

// ---------------------------------------------------------------- waiting for a reply

export interface Waiting {
  /** your message that has no answer yet */
  message: MessageSummary;
  thread: Thread;
  /** whole days since you sent it */
  days: number;
  /** who has not answered */
  to: Address[];
}

/**
 * Sent mail with no answer: conversations whose newest message is yours,
 * written to someone (not to a machine), between minDays and maxDays old.
 * `messages` is every cached message you want considered (inboxes and Sent of
 * every account); copies of the same message are counted once.
 */
export function waitingForReply(messages: MessageSummary[], me: string[], now: number, o: { minDays?: number; maxDays?: number; dismissed?: string[] } = {}): Waiting[] {
  const mine = new Set(me.map(lc));
  const dismissed = new Set(o.dismissed ?? []);
  const minAge = (o.minDays ?? 0) * DAY;
  const maxAge = (o.maxDays ?? 30) * DAY;
  // The same message can sit in Sent and in All Mail, or in two accounts.
  const seen = new Set<string>();
  const unique = messages.filter((m) => {
    const k = m.messageId ? `mid:${m.messageId}` : `id:${m.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out: Waiting[] = [];
  for (const t of threadMessages(unique)) {
    const last = t.messages[t.messages.length - 1];
    if (!last.from || !mine.has(lc(last.from.address))) continue;
    if (last.messageId && dismissed.has(last.messageId)) continue;
    if (dismissed.has(last.id)) continue;
    const age = now - last.date;
    if (age < minAge || age > maxAge) continue;
    const to = [...last.to, ...last.cc].filter((a) => !mine.has(lc(a.address)) && !isAutomatedSender(a));
    if (!to.length) continue;
    out.push({ message: last, thread: t, days: Math.floor(age / DAY), to });
  }
  return out.sort((a, b) => b.message.date - a.message.date);
}

/** A ready follow-up to your own unanswered message: to the same people, in the same conversation. */
export function followUpDraft(m: MessageSummary & { text?: string }, me: string[]): Draft {
  const d = makeReply({ original: m, me, mode: 'replyAll' });
  const first = d.to[0]?.name?.split(/\s+/)[0];
  d.body = `${first ? `Hi ${first},` : 'Hi,'}\n\nJust following up on my message below. Any news on this?\n\nThanks!`;
  return d;
}

// ---------------------------------------------------------------- subscriptions

export interface Subscription {
  /** the list's id, or the sender's address */
  key: string;
  name: string;
  address: string;
  count: number;
  /** how many were opened (read) */
  opened: number;
  last: number;
  /** the newest message's unsubscribe link, when it has one */
  unsub?: MessageSummary['unsub'];
  /** the newest message (unsubscribe works from it) */
  latest: string;
  ids: string[];
  /** received several and opened none */
  neverOpened: boolean;
}

/**
 * Newsletters and other mail you are subscribed to, by list or sender, with
 * how many arrived and how many you opened. Ones you never open come first.
 */
export function subscriptions(messages: MessageSummary[], me: string[] = []): Subscription[] {
  const mine = new Set(me.map(lc));
  const groups = new Map<string, MessageSummary[]>();
  // A message in the inbox and in All Mail is one message.
  const seen = new Set<string>();
  for (const m of messages) {
    if (!m.from || mine.has(lc(m.from.address))) continue;
    const k = m.messageId ? `mid:${m.messageId}` : `id:${m.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!(m.unsub || m.bulk || m.listId)) continue;
    // Sign-in alerts and codes are not something to unsubscribe from.
    if (m.security || isSecurityAlert(m)) continue;
    const key = m.listId ? `list:${lc(m.listId)}` : lc(m.from.address);
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out: Subscription[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => b.date - a.date);
    const newest = list[0];
    const opened = list.filter((m) => m.seen).length;
    out.push({
      key, name: newest.from?.name || newest.from!.address, address: newest.from!.address, count: list.length, opened, last: newest.date,
      unsub: list.find((m) => m.unsub)?.unsub, latest: (list.find((m) => m.unsub) ?? newest).id, ids: list.map((m) => m.id),
      neverOpened: opened === 0 && list.length >= 2,
    });
  }
  return out.sort((a, b) => Number(b.neverOpened) - Number(a.neverOpened) || a.opened / a.count - b.opened / b.count || b.count - a.count);
}

// ---------------------------------------------------------------- snooze, send later and undo send

export interface When {
  label: string;
  at: number;
}

const at = (base: Date, addDays: number, h: number, m = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Choices for "Snooze until": later today, this evening, tomorrow, the weekend, next week. */
export function snoozeChoices(now: number): When[] {
  const d = new Date(now);
  const out: When[] = [];
  const later = now + 3 * 3_600_000;
  if (new Date(later).getDate() === d.getDate()) out.push({ label: `Later today (${time(later)})`, at: later });
  const evening = at(d, 0, 19);
  if (evening - now > 3_600_000) out.push({ label: 'This evening', at: evening });
  out.push({ label: 'Tomorrow morning', at: at(d, 1, 8) });
  const dow = d.getDay();
  if (dow >= 1 && dow <= 4) out.push({ label: 'This weekend', at: at(d, 6 - dow, 9) });
  out.push({ label: 'Next week', at: at(d, ((8 - dow) % 7) || 7, 8) });
  return out;
}

/** Choices for "Send later". */
export function sendLaterChoices(now: number): When[] {
  const d = new Date(now);
  const out: When[] = [];
  const morning = at(d, 0, 8);
  if (morning - now > 30 * 60_000) out.push({ label: 'This morning (8:00)', at: morning });
  out.push({ label: 'Tomorrow morning (8:00)', at: at(d, 1, 8) }, { label: 'Tomorrow afternoon (13:00)', at: at(d, 1, 13) });
  out.push({ label: 'Monday morning (8:00)', at: at(d, ((8 - d.getDay()) % 7) || 7, 8) });
  return out;
}

/** The soonest time a snoozed message comes back, if any. */
export function nextSnoozeWake(snoozes: { until: number }[], now: number): number | undefined {
  let next: number | undefined;
  for (const s of snoozes) if (s.until > now && (next === undefined || s.until < next)) next = s.until;
  return next;
}

/** Snoozes whose time has come, and the ones still waiting. */
export function dueSnoozes<T extends { until: number }>(snoozes: T[], now: number): { due: T[]; waiting: T[] } {
  return { due: snoozes.filter((s) => s.until <= now), waiting: snoozes.filter((s) => s.until > now) };
}

/** Hidden while snoozed; once back it sorts as if it arrived when it came back. */
export function isSnoozed(m: MessageSummary, now: number): boolean {
  return !!m.snoozedUntil && m.snoozedUntil > now;
}

export const sortTime = (m: MessageSummary, now: number) => Math.max(m.date, m.returnedAt ?? 0, m.snoozedUntil && m.snoozedUntil <= now ? m.snoozedUntil : 0);

// ---------------------------------------------------------------- working offline

/** Errors that mean the server could not be reached (the change waits and is tried again). */
export function isOfflineError(e: unknown): boolean {
  const s = e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e);
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EAI_AGAIN|EPIPE|socket hang up|Connection not available|connection (closed|timed out)|getaddrinfo|network/i.test(s);
}

export interface Queued {
  sendAt: number;
  /** when Send was pressed */
  queuedAt?: number;
  /** a time chosen with Send later */
  scheduled?: boolean;
  error?: string;
}

/**
 * Where a message in the outbox is: in its undo window (seconds left), waiting
 * for a chosen time, due to go now, or failed.
 */
export function outboxPhase(q: Queued, now: number): { phase: 'undo' | 'scheduled' | 'due' | 'failed'; left: number } {
  if (q.error) return { phase: 'failed', left: 0 };
  const left = q.sendAt - now;
  if (left <= 0) return { phase: 'due', left: 0 };
  return { phase: q.scheduled ? 'scheduled' : 'undo', left };
}

/** May this message still be taken back? Only before it is sent. */
export const canUndo = (q: Queued, now: number) => !q.error && q.sendAt > now;

// ---------------------------------------------------------------- search and AI helpers

const STOP = new Set('a an and are as at be by did do does for from had has have how i in is it me my of on or our so than that the their them there this to was we were what when where which who why will with you your about any can could should would did last latest'.split(' '));

/** The words of a question worth looking for. */
export function keywords(q: string): string[] {
  return [...new Set(lc(q).match(/[\p{L}\p{N}][\p{L}\p{N}'@.-]{1,}/gu) ?? [])].filter((w) => !STOP.has(w) && w.length > 1);
}

/** The cached messages that best fit a question (for "Ask your mail"), newest first among equals. */
export function pickForQuestion(q: string, messages: MessageSummary[], limit = 12, now = Date.now()): MessageSummary[] {
  const words = keywords(q);
  if (!words.length) return [...messages].sort((a, b) => b.date - a.date).slice(0, limit);
  const scored = messages.map((m) => {
    const subj = lc(m.subject);
    const from = lc(`${m.from?.name ?? ''} ${m.from?.address ?? ''}`);
    const snip = lc(m.snippet);
    let s = 0;
    for (const w of words) s += (subj.includes(w) ? 3 : 0) + (from.includes(w) ? 2 : 0) + (snip.includes(w) ? 1 : 0);
    // Newer mail wins a tie.
    return { m, s: s ? s + Math.max(0, 1 - (now - m.date) / (365 * DAY)) : 0 };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m);
}

/** Local results first, then the server's, each message once. */
export function mergeResults(local: MessageSummary[], server: MessageSummary[]): MessageSummary[] {
  const seen = new Set(local.map((m) => m.messageId ?? m.id));
  return [...local, ...server.filter((m) => {
    const k = m.messageId ?? m.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })];
}

/** Splits an AI answer with several suggested replies (separated by "===" lines or numbered) into the replies. */
export function splitSuggestions(text: string, max = 3): string[] {
  const t = text.replace(/\r/g, '').trim();
  let parts = t.split(/\n\s*={3,}\s*\n/);
  if (parts.length < 2) parts = t.split(/\n(?=\s*(?:option\s*)?[1-9][.):]\s)/i);
  return parts
    .map((p) => p.replace(/^\s*(?:option\s*)?[1-9][.):]\s*/i, '').replace(/^\s*(?:reply|option)\s*[1-9]?\s*[:.-]\s*\n?/i, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Lines of your own sent mail, for drafting replies that sound like you. */
export function voiceSamples(sent: MessageSummary[], me: string[], limit = 5): string[] {
  const mine = new Set(me.map(lc));
  return sent
    .filter((m) => m.from && mine.has(lc(m.from.address)) && m.snippet.length > 30)
    .sort((a, b) => b.date - a.date)
    .slice(0, limit)
    .map((m) => m.snippet);
}
