// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail logic that needs no network: conversations, replies and forwards,
// unsubscribe links, local filters and snippets.

import type { Address, MessageSummary, Thread } from './types';

/** "Re: Fwd: AW: Hello" → "hello", for grouping a conversation. */
export function baseSubject(s: string): string {
  let t = (s || '').trim();
  for (;;) {
    const next = t.replace(/^\s*((re|fw|fwd|aw|wg|sv|vs|ref|tr|rv|antw|odp|vl)(\[\d+\])?\s*:|\[[^\]]{1,40}\])\s*/i, '');
    if (next === t) break;
    t = next;
  }
  return t.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Groups messages into conversations: by Message-ID / In-Reply-To / References
 * first, then by subject for messages that lost their headers (within 30 days).
 */
export function threadMessages(msgs: MessageSummary[]): Thread[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    // Path compression keeps long chains cheap.
    let c = x;
    while (parent.has(c) && parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const keyOf = (m: MessageSummary) => (m.messageId ? `mid:${m.messageId}` : `id:${m.id}`);
  for (const m of msgs) {
    const k = keyOf(m);
    if (!parent.has(k)) parent.set(k, k);
    for (const r of [...(m.references ?? []), ...(m.inReplyTo ? [m.inReplyTo] : [])]) {
      const rk = `mid:${r}`;
      if (!parent.has(rk)) parent.set(rk, rk);
      union(rk, k);
    }
  }
  // Subject fallback: a message with no links joins an earlier one with the same subject.
  const bySubject = new Map<string, MessageSummary>();
  for (const m of [...msgs].sort((a, b) => a.date - b.date)) {
    const s = baseSubject(m.subject);
    if (!s) continue;
    const prev = bySubject.get(s);
    const linked = !!(m.inReplyTo || m.references?.length);
    if (prev && !linked && /^\s*(re|fw|fwd|aw)\s*:/i.test(m.subject) && m.date - prev.date < 30 * 86_400_000) union(keyOf(prev), keyOf(m));
    bySubject.set(s, m);
  }
  const groups = new Map<string, MessageSummary[]>();
  for (const m of msgs) {
    const r = find(keyOf(m));
    const g = groups.get(r);
    if (g) g.push(m);
    else groups.set(r, [m]);
  }
  const out: Thread[] = [];
  for (const [id, list] of groups) {
    list.sort((a, b) => a.date - b.date);
    const seen = new Set<string>();
    const participants: Address[] = [];
    for (const m of list) for (const a of [m.from, ...m.to].filter(Boolean) as Address[]) {
      const k = a.address.toLowerCase();
      if (!seen.has(k)) { seen.add(k); participants.push(a); }
    }
    out.push({ id, subject: list[0].subject, messages: list, last: list[list.length - 1].date, unread: list.filter((m) => !m.seen).length, participants });
  }
  return out.sort((a, b) => b.last - a.last);
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.address;
  const name = /[",<>@()]/.test(a.name) ? `"${a.name.replace(/"/g, '\\"')}"` : a.name;
  return `${name} <${a.address}>`;
}

/** "Ana <ana@x.org>, bob@y.org" → addresses (commas inside quotes kept). */
export function parseAddressList(s: string): Address[] {
  const out: Address[] = [];
  for (const part of s.match(/(?:[^,"]|"[^"]*")+/g) ?? []) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(.*)<([^>]+)>$/);
    if (m) {
      const name = m[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
      out.push({ name: name || undefined, address: m[2].trim() });
    } else if (/@/.test(p)) out.push({ address: p });
  }
  return out;
}

export interface ReplyInput {
  original: MessageSummary & { text?: string; html?: string };
  me: string[];
  mode: 'reply' | 'replyAll' | 'forward';
  replyTo?: Address[];
}

export interface Draft {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** Markdown or plain text the person writes */
  body: string;
  /** quoted original, kept apart so the editor can collapse it */
  quoted?: string;
  inReplyTo?: string;
  references?: string[];
  from?: string;
  attachments?: { path: string; name?: string }[];
  forwardOf?: string;
}

/** Recipients, subject, threading headers and the quoted original for a reply or forward. */
export function makeReply(r: ReplyInput): Draft {
  const o = r.original;
  const mine = new Set(r.me.map((x) => x.toLowerCase()));
  const notMe = (a: Address) => !mine.has(a.address.toLowerCase());
  const subj = baseSubject(o.subject) === o.subject.toLowerCase().trim() ? o.subject.trim() : o.subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  const when = new Date(o.date).toLocaleString();
  const who = o.from ? formatAddress(o.from) : 'someone';
  const text = (o.text ?? '').replace(/\r\n/g, '\n');
  if (r.mode === 'forward') {
    const header = ['---------- Forwarded message ----------', `From: ${who}`, `Date: ${when}`, `Subject: ${o.subject}`, `To: ${o.to.map(formatAddress).join(', ')}`].join('\n');
    return { to: [], cc: [], bcc: [], subject: `Fwd: ${subj}`, body: '', quoted: `${header}\n\n${text}`, forwardOf: o.id };
  }
  const primary = (r.replyTo?.length ? r.replyTo : o.from ? [o.from] : []).filter((a) => notMe(a) || !o.from || r.mode === 'reply');
  let to = primary.length ? primary : o.to.filter(notMe);
  let cc: Address[] = [];
  if (r.mode === 'replyAll') {
    const seen = new Set(to.map((a) => a.address.toLowerCase()));
    cc = [...o.to, ...o.cc].filter((a) => notMe(a) && !seen.has(a.address.toLowerCase()) && (seen.add(a.address.toLowerCase()), true));
  }
  // Replying to your own sent message goes to its recipients.
  if (o.from && mine.has(o.from.address.toLowerCase())) to = o.to;
  const quoted = `On ${when}, ${who} wrote:\n` + text.split('\n').map((l) => `> ${l}`).join('\n');
  return {
    to, cc, bcc: [], subject: `Re: ${subj}`, body: '', quoted,
    inReplyTo: o.messageId, references: [...(o.references ?? []), ...(o.messageId ? [o.messageId] : [])].slice(-20),
  };
}

/** List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058, one click). */
export function parseUnsubscribe(header?: string, post?: string): { mailto?: string; url?: string; oneClick?: boolean } | undefined {
  if (!header) return undefined;
  const links = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const mailto = links.find((l) => /^mailto:/i.test(l));
  const url = links.find((l) => /^https:/i.test(l));
  if (!mailto && !url) return undefined;
  return { mailto, url, oneClick: !!url && /List-Unsubscribe=One-Click/i.test(post ?? '') };
}

/** A short, single-line preview of a message's text. */
export function snippetOf(text: string, max = 140): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const kept: string[] = [];
  for (const l of lines) {
    if (/^>/.test(l)) continue;
    if (/^On .{5,120} wrote:\s*$/.test(l)) break;
    if (/^-{2,}\s*(Original|Forwarded) Message/i.test(l)) break;
    if (/^--\s*$/.test(l)) break;
    kept.push(l);
  }
  const s = kept.join(' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ---------------------------------------------------------------- local filters

export type { Rule as MailRule } from './rules';
/** Does a rule match a message (every condition, or any when the rule says so)? */
export { ruleMatchesV2 as ruleMatches } from './rules';

/** Simple local search over cached messages: words in any order, from:, to:, subject:, label:, in:, is:unread, has:attachment. */
export function matchesQuery(m: MessageSummary & { text?: string }, q: string): boolean {
  const terms = q.toLowerCase().match(/(\w+:"[^"]*"|\w+:\S+|"[^"]+"|\S+)/g) ?? [];
  const addr = (a?: Address) => (a ? `${a.name ?? ''} ${a.address}`.toLowerCase() : '');
  return terms.every((t) => {
    const [k, ...rest] = t.split(':');
    const v = rest.join(':').replace(/^"|"$/g, '');
    if (rest.length) {
      if (k === 'from') return addr(m.from).includes(v);
      if (k === 'to') return [...m.to, ...m.cc].some((a) => addr(a).includes(v));
      if (k === 'subject') return m.subject.toLowerCase().includes(v);
      if (k === 'is') return v === 'unread' ? !m.seen : v === 'flagged' || v === 'starred' ? m.flagged : v === 'read' ? m.seen : true;
      if (k === 'has') return v.startsWith('attach') ? m.hasAttachments : true;
      if (k === 'label') return (m.labels ?? []).some((l) => l.toLowerCase().includes(v));
      if (k === 'in') return m.folder.toLowerCase().includes(v) || (v === 'important' ? m.category === 'important' : v === 'other' ? m.category === 'other' : false);
    }
    const word = t.replace(/^"|"$/g, '');
    return [m.subject, addr(m.from), ...m.to.map(addr), m.snippet, m.text ?? ''].join(' ').toLowerCase().includes(word);
  });
}

/** Kinds of attachment that run code when opened (programs, scripts, shortcuts, macro documents, disk images). */
const RISKY_ATTACHMENT = /\.(exe|msi|msix|appx|bat|cmd|com|scr|pif|cpl|msc|js|jse|vbs|vbe|wsf|wsh|hta|ps1|psm1|lnk|url|scf|reg|jar|chm|iso|img|vhd|vhdx|docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|sh|command|tool|app|desktop|appimage|run|bin|dmg|pkg|mpkg|terminal|workflow|scpt|applescript)$/i;
export function riskyAttachment(name: string): boolean {
  return RISKY_ATTACHMENT.test(name.trim().replace(/[.\s]+$/, ''));
}
