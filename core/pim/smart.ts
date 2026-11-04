// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The inbox's smart tabs and mailboxes, with no network: Important (people,
// replies to you, security mail) and Other split into Updates (receipts,
// notifications, accounts) and Promos (marketing and newsletters); "To Reply"
// (mail from people still waiting for your answer); "Remind me if no reply";
// muted conversations and blocked senders; the sign-in code or magic link in
// a message; how a sender is drawn (contact photo, a brand's mark, initials);
// and whether a message is designed mail that keeps its light page in dark mode.

import { threadMessages } from './mail';
import { isAutomatedSender } from './triage';
import type { Address, MessageSummary } from './types';

const DAY = 86_400_000;
const lc = (s?: string) => (s ?? '').toLowerCase();

// ---------------------------------------------------------------- smart tabs

/** Important stays as it was; Other is split in two. */
export type SmartTab = 'important' | 'updates' | 'promos';
export type InboxTab = 'all' | SmartTab;

const PROMO_WORDS = /\b(sale|% off|\d+% |discount|deal[s]?|offer[s]?|coupon|promo(tion)?|save (up to|\d)|free shipping|limited time|last chance|black friday|cyber monday|new arrivals|shop now|exclusive|newsletter|digest|weekly|webinar|don'?t miss|members? only|flash|clearance|bestsellers?|recommended for you|picks for you)\b/i;
const UPDATE_WORDS = /\b(receipt|invoice|order|shipped|shipping|delivery|delivered|tracking|statement|payment|paid|refund|booking|reservation|confirmation|confirmed|itinerary|ticket|subscription (renew|confirm)|renewal|bill|account|notification|alert|reminder|update[sd]?|activity|report|security|verify|pull request|commented|mentioned|assigned|build (failed|passed)|appointment|password)\b/i;
const PROMO_SENDER = /^(news(letter)?s?|marketing|promo(tions)?|offers?|deals|digest|hello|hi|team|community|events?|campaign[s]?|shop|store|sales)([-_.+].*)?$/i;

/** Which of Updates and Promos an "Other" message belongs in. */
export function otherKind(m: Pick<MessageSummary, 'subject' | 'snippet' | 'from' | 'bulk' | 'unsub' | 'listId'>): 'updates' | 'promos' {
  const local = lc(m.from?.address).split('@')[0];
  const text = `${m.subject}\n${m.snippet}`;
  const promoish = PROMO_WORDS.test(text);
  const updatish = UPDATE_WORDS.test(text);
  if (updatish && !promoish) return 'updates';
  if (promoish) return 'promos';
  // A newsletter with an unsubscribe link and a marketing-looking sender.
  if ((m.unsub || m.bulk) && PROMO_SENDER.test(local)) return 'promos';
  if (m.unsub && !m.listId) return 'promos';
  return 'updates';
}

/** The tab a classified message is listed under. */
export function smartTab(m: Pick<MessageSummary, 'category' | 'security' | 'subject' | 'snippet' | 'from' | 'bulk' | 'unsub' | 'listId'>): SmartTab {
  if (m.security || m.category !== 'other') return 'important';
  return otherKind(m);
}

/** Unread counts per tab (messages already classified). */
export function tabCounts(list: MessageSummary[]): Record<InboxTab, number> {
  const out: Record<InboxTab, number> = { all: 0, important: 0, updates: 0, promos: 0 };
  for (const m of list) {
    if (m.seen) continue;
    out.all++;
    out[smartTab(m)]++;
  }
  return out;
}

export function inTab(m: MessageSummary, tab: InboxTab | 'other' | undefined): boolean {
  if (!tab || tab === 'all') return true;
  if (tab === 'other') return smartTab(m) !== 'important';
  return smartTab(m) === tab;
}

// ---------------------------------------------------------------- To Reply

/**
 * Mail from people still waiting for your answer: in an inbox, written to you
 * directly by a person (not a list or a machine), not answered, and the last
 * word in its conversation is theirs. Newest first, at most `maxDays` old.
 */
export function toReply(messages: MessageSummary[], me: string[], now: number, o: { maxDays?: number; dismissed?: string[]; sent?: MessageSummary[] } = {}): MessageSummary[] {
  const mine = new Set(me.map(lc));
  const dismissed = new Set(o.dismissed ?? []);
  const maxAge = (o.maxDays ?? 14) * DAY;
  const pool = [...messages, ...(o.sent ?? [])];
  const seen = new Set<string>();
  const unique = pool.filter((m) => { const k = m.messageId ? `mid:${m.messageId}` : `id:${m.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const out: MessageSummary[] = [];
  for (const t of threadMessages(unique)) {
    const last = t.messages[t.messages.length - 1];
    if (!last.from || mine.has(lc(last.from.address))) continue;
    if (last.folder.toUpperCase() !== 'INBOX') continue;
    if (last.answered || last.security || last.bulk || last.unsub || last.listId) continue;
    if (isAutomatedSender(last.from)) continue;
    if (!last.to.some((a) => mine.has(lc(a.address)))) continue;
    if (dismissed.has(last.messageId ?? last.id) || dismissed.has(last.id)) continue;
    if (now - last.date > maxAge) continue;
    out.push(last);
  }
  return out.sort((a, b) => b.date - a.date);
}

// ---------------------------------------------------------------- remind me if no reply

export interface NoReplyReminder {
  /** the sent message's Message-ID */
  messageId: string;
  /** its id in Keeper's list, when known (to open it) */
  id?: string;
  account: string;
  subject: string;
  to: Address[];
  sentAt: number;
  /** when to remind */
  at: number;
}

export function remindChoices(now: number): { label: string; at: number }[] {
  const at = (days: number) => { const d = new Date(now + days * DAY); d.setHours(9, 0, 0, 0); return d.getTime(); };
  return [{ label: 'In 1 day', at: at(1) }, { label: 'In 3 days', at: at(3) }, { label: 'In a week', at: at(7) }];
}

/** Did anyone but you write in the conversation of this sent message after it went? */
export function gotReply(r: Pick<NoReplyReminder, 'messageId' | 'sentAt'>, messages: MessageSummary[], me: string[]): boolean {
  const mine = new Set(me.map(lc));
  return messages.some((m) => !!m.from && !mine.has(lc(m.from.address)) && m.date >= r.sentAt - 60_000
    && (m.inReplyTo === r.messageId || (m.references ?? []).includes(r.messageId)));
}

/** Reminders that are due (no answer came), answered (drop them) and still waiting. */
export function sortReminders(list: NoReplyReminder[], messages: MessageSummary[], me: string[], now: number): { due: NoReplyReminder[]; answered: NoReplyReminder[]; waiting: NoReplyReminder[] } {
  const out = { due: [] as NoReplyReminder[], answered: [] as NoReplyReminder[], waiting: [] as NoReplyReminder[] };
  for (const r of list) {
    if (gotReply(r, messages, me)) out.answered.push(r);
    else if (r.at <= now) out.due.push(r);
    else out.waiting.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- mute and block

/** The ids that name a conversation: its root and every message it refers to. */
export function conversationKeys(m: Pick<MessageSummary, 'messageId' | 'inReplyTo' | 'references'>): string[] {
  return [...(m.references ?? []), ...(m.inReplyTo ? [m.inReplyTo] : []), ...(m.messageId ? [m.messageId] : [])];
}

/** A message belongs to a muted conversation when it refers to (or is) a muted message. */
export function isMuted(m: Pick<MessageSummary, 'messageId' | 'inReplyTo' | 'references'>, muted: Iterable<string>): boolean {
  const set = muted instanceof Set ? muted as Set<string> : new Set(muted);
  if (!set.size) return false;
  return conversationKeys(m).some((k) => set.has(k));
}

/** Blocked by address ("x@y.org") or by a whole domain ("@y.org" or "y.org"). */
export function isBlocked(from: Address | undefined, blocked: string[]): boolean {
  if (!from?.address || !blocked.length) return false;
  const a = lc(from.address);
  const domain = a.split('@')[1] ?? '';
  return blocked.some((b) => {
    const x = lc(b).trim();
    if (!x) return false;
    if (x.includes('@') && !x.startsWith('@')) return x === a;
    const d = x.replace(/^@/, '');
    return domain === d || domain.endsWith(`.${d}`);
  });
}

// ---------------------------------------------------------------- sign-in codes and links

/** The one-time code in a sign-in mail, when there is exactly one obvious one. */
export function extractCode(text: string): string | undefined {
  const t = text.slice(0, 6000);
  if (!/\b(code|otp|passcode|pin|verification|verify|sign[- ]?in|log[- ]?in|2fa|token|one[- ]time|código|codice|bestätigung|vérification)\b/i.test(t)) return undefined;
  // Near the word "code" first.
  const near = t.match(/(?:code|otp|passcode|pin|token)\b[^\n\d]{0,40}?(\d{3}[ -]?\d{3}|\d{4,8}|(?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w/-])/i)
    ?? t.match(/(?<![\w./:-])(\d{3}[ -]?\d{3}|\d{6}|\d{4}|\d{8})(?![\w/:-])\s*(?:is your|is the|est votre|ist ihr)/i)
    ?? t.match(/(?:^|\n)\s*(\d{6}|\d{3}[ -]\d{3}|\d{4}|\d{8})\s*(?:\n|$)/);
  if (!near) return undefined;
  const code = near[1].replace(/[ -]/g, '');
  // Years and times are not codes.
  if (/^(19|20)\d\d$/.test(code)) return undefined;
  return code;
}

/** A "magic" sign-in link (one click signs you in), when the mail is about signing in. */
export function extractSignInLink(text: string, html?: string): string | undefined {
  const hay = `${text}\n${html ?? ''}`;
  if (!/\b(sign[- ]?in|log[- ]?in|magic link|verify (your )?(email|sign)|confirm (your )?(email|sign[- ]?in)|one[- ]click)\b/i.test(hay)) return undefined;
  const links: { href: string; text: string }[] = [];
  if (html) for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) links.push({ href: m[1].replace(/&amp;/g, '&'), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  for (const m of text.matchAll(/https:\/\/[^\s<>"')\]]+/g)) links.push({ href: m[0], text: '' });
  const good = links.filter((l) => /^https:\/\//i.test(l.href) && !/unsubscribe|privacy|terms|help|support|preferences|facebook|twitter|instagram|linkedin/i.test(l.href));
  const scored = good.map((l) => ({ l, s: (/(sign|log)[- ]?in|magic|verify|confirm|auth|login|token|session/i.test(l.text) ? 3 : 0) + (/(sign|log)[-_]?in|magic|verify|confirm|auth|login|token|callback|session/i.test(l.href) ? 2 : 0) }));
  const best = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  return best?.l.href;
}

// ---------------------------------------------------------------- how a sender is drawn

/** Well-known senders drawn with their colour and initial (kept on this computer: nothing is fetched). */
export const BRANDS: Record<string, { name: string; color: string }> = {
  'google.com': { name: 'Google', color: '#4285f4' }, 'accounts.google.com': { name: 'Google', color: '#4285f4' }, 'youtube.com': { name: 'YouTube', color: '#ff0000' },
  'apple.com': { name: 'Apple', color: '#555555' }, 'icloud.com': { name: 'iCloud', color: '#3693f3' }, 'microsoft.com': { name: 'Microsoft', color: '#00a4ef' },
  'github.com': { name: 'GitHub', color: '#24292f' }, 'gitlab.com': { name: 'GitLab', color: '#fc6d26' }, 'amazon.com': { name: 'Amazon', color: '#ff9900' },
  'paypal.com': { name: 'PayPal', color: '#003087' }, 'stripe.com': { name: 'Stripe', color: '#635bff' }, 'slack.com': { name: 'Slack', color: '#4a154b' },
  'dropbox.com': { name: 'Dropbox', color: '#0061ff' }, 'linkedin.com': { name: 'LinkedIn', color: '#0a66c2' }, 'facebook.com': { name: 'Facebook', color: '#1877f2' },
  'facebookmail.com': { name: 'Facebook', color: '#1877f2' }, 'instagram.com': { name: 'Instagram', color: '#e1306c' }, 'x.com': { name: 'X', color: '#111111' },
  'twitter.com': { name: 'X', color: '#111111' }, 'netflix.com': { name: 'Netflix', color: '#e50914' }, 'spotify.com': { name: 'Spotify', color: '#1db954' },
  'airbnb.com': { name: 'Airbnb', color: '#ff5a5f' }, 'uber.com': { name: 'Uber', color: '#000000' }, 'notion.so': { name: 'Notion', color: '#191919' },
  'figma.com': { name: 'Figma', color: '#a259ff' }, 'zoom.us': { name: 'Zoom', color: '#2d8cff' }, 'atlassian.com': { name: 'Atlassian', color: '#0052cc' },
  'adobe.com': { name: 'Adobe', color: '#fa0f00' }, 'ebay.com': { name: 'eBay', color: '#e53238' }, 'booking.com': { name: 'Booking.com', color: '#003580' },
  'yahoo.com': { name: 'Yahoo', color: '#6001d2' }, 'outlook.com': { name: 'Outlook', color: '#0078d4' }, 'fastmail.com': { name: 'Fastmail', color: '#0067b9' },
  'proton.me': { name: 'Proton', color: '#6d4aff' }, 'zoho.com': { name: 'Zoho', color: '#e42527' }, 'aol.com': { name: 'AOL', color: '#3399ff' },
};

/** The brand behind an address (its domain or a parent domain), if Keeper knows it. */
export function brandOf(address?: string): { name: string; color: string; domain: string } | undefined {
  let d = lc(address).split('@')[1];
  while (d && d.includes('.')) {
    const b = BRANDS[d];
    if (b) return { ...b, domain: d };
    d = d.slice(d.indexOf('.') + 1);
  }
  return undefined;
}

/** One or two letters for a sender: "Ana Lopez" → "AL", "news@shop.example" → "N". */
export function initials(a?: Address): string {
  const name = (a?.name ?? '').replace(/["'()[\]]/g, '').trim();
  if (name && !name.includes('@')) {
    const parts = name.split(/\s+/).filter((p) => /\p{L}|\p{N}/u.test(p[0] ?? ''));
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0]) return parts[0].slice(0, 1).toUpperCase();
  }
  return (a?.address ?? '?').slice(0, 1).toUpperCase();
}

/** A steady colour from an address. */
export function hueOf(address?: string): number {
  return [...(address ?? '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
}

export type SenderLook = { kind: 'photo'; src: string } | { kind: 'brand'; letter: string; color: string; name: string } | { kind: 'initials'; letter: string; hue: number };

/** Contact photo first, then a known brand, then initials. Nothing is fetched. */
export function senderLook(a: Address | undefined, photos: Record<string, string>): SenderLook {
  const addr = lc(a?.address);
  const photo = photos[addr];
  if (photo && /^data:image\//.test(photo)) return { kind: 'photo', src: photo };
  const b = brandOf(addr);
  if (b) return { kind: 'brand', letter: b.name.slice(0, 1), color: b.color, name: b.name };
  return { kind: 'initials', letter: initials(a), hue: hueOf(addr) };
}

// ---------------------------------------------------------------- dark mode

/**
 * Designed mail (newsletters, receipts with their own colours and layout)
 * keeps its light page; simple mail follows the dark theme.
 */
export function isDesignedMail(html: string): boolean {
  const h = html.slice(0, 200_000);
  const colours = (h.match(/\b(bgcolor\s*=|background(-color)?\s*:\s*(?!transparent|inherit|none|#fff\b|#ffffff\b|white\b))/gi) ?? []).length;
  const tables = (h.match(/<table\b/gi) ?? []).length;
  const images = (h.match(/<img\b/gi) ?? []).length;
  return colours >= 2 || tables >= 3 || (tables >= 1 && images >= 2);
}

// ---------------------------------------------------------------- accounts

/** ⌘1…⌘9: each account in order; ⌘0 is every inbox together. */
export function accountForDigit<T extends { id: string }>(digit: number, accounts: T[]): T | 'all' | undefined {
  if (digit === 0) return 'all';
  return digit >= 1 && digit <= 9 ? accounts[digit - 1] : undefined;
}

// ---------------------------------------------------------------- Dock badge and the notch

export type BadgeMode = 'all' | 'important' | 'off';

/** The number on the Dock (or taskbar) icon: unread inbox mail, only Important, or nothing. */
export function badgeCount(inbox: Pick<MessageSummary, 'seen' | 'category' | 'security' | 'snoozedUntil'>[], mode: BadgeMode, now = Date.now()): number {
  if (mode === 'off') return 0;
  return inbox.filter((m) => !m.seen && !(m.snoozedUntil && m.snoozedUntil > now) && (mode === 'all' || m.security || m.category !== 'other')).length;
}

/**
 * May new mail drop down from the notch: the account is not turned off for
 * it, and when the person listed senders, the sender is one of them (an
 * address, "@domain" or a domain). Security mail with a code always may.
 */
export function notchAllows(m: Pick<MessageSummary, 'account' | 'from' | 'security'>, o: { accountOff?: boolean; senders?: string[] }): boolean {
  if (o.accountOff) return false;
  const list = (o.senders ?? []).map((s) => s.trim()).filter(Boolean);
  if (!list.length || m.security) return true;
  return isBlocked(m.from, list);
}

/** Per-account unread inbox counts (for the account switcher and the Accounts widget). */
export function unreadByAccount(inbox: Pick<MessageSummary, 'account' | 'seen'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of inbox) if (!m.seen) out[m.account] = (out[m.account] ?? 0) + 1;
  return out;
}

/**
 * Unread inbox mail per account: the server's own number for the whole inbox
 * when it is larger than what the list kept here holds (a big inbox keeps only
 * its newest messages on this computer).
 */
export function mergeUnread(listed: Record<string, number>, folders: { account: string; special?: string; unread: number }[]): Record<string, number> {
  const out = { ...listed };
  for (const f of folders) if (f.special === 'inbox' && f.unread > (out[f.account] ?? 0)) out[f.account] = f.unread;
  return out;
}

// ---------------------------------------------------------------- reading

export const TEXT_SIZES = [12, 13, 14, 15, 16, 18, 20, 22];

/** ⌘+ / ⌘− one step through the text sizes. */
export function nextTextSize(current: number, dir: 1 | -1): number {
  const i = TEXT_SIZES.findIndex((s) => s >= current);
  const at = i < 0 ? TEXT_SIZES.length - 1 : i;
  return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, at + dir))];
}

/** One conversation as chat bubbles: each message's new text (quotes and signatures left out), mine on the right. */
export function bubbleText(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const kept: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^On .{5,160} wrote:\s*$/.test(l.trim())) break;
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(l.trim())) break;
    if (/^(From|De|Von): .+/.test(l.trim()) && kept.length && /^_{5,}|^-{5,}/.test(kept[kept.length - 1].trim())) { kept.pop(); break; }
    if (/^--\s*$/.test(l)) break;
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
