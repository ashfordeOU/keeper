// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing mail in rich text, with no network: the editor's HTML cleaned to
// what mail clients show well, a plain-text copy for the text part, the
// signature of the address you send from (optional on replies, removable per
// message), send-from aliases with their own Reply-To, and templates.

import type { Account, Address, Identity } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tags the editor may produce and that every mail client shows. */
const KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'p', 'div', 'ul', 'ol', 'li', 'a', 'blockquote', 'span', 'font', 'h1', 'h2', 'h3', 'pre', 'code', 'hr']);

/**
 * The editor's HTML, kept to simple formatting: bold, italic, underline,
 * lists, links (http, https, mailto), quotes and text sizes. Scripts, event
 * handlers, styles other than font-size and everything else are dropped.
 */
export function cleanEditorHtml(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!KEEP.has(t)) return '';
    if (m.startsWith('</')) return `</${t}>`;
    const kept: string[] = [];
    if (t === 'a') {
      const href = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const v = (href?.[2] ?? href?.[3] ?? href?.[4] ?? '').trim().replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/i.test(v)) kept.push(`href="${esc(v)}"`);
    }
    const size = attrs.match(/font-size\s*:\s*([\d.]+(px|pt|em|rem|%)|small|medium|large|x-large|xx-large|x-small)/i);
    if (size) kept.push(`style="font-size:${size[1]}"`);
    if (t === 'font') {
      const s = attrs.match(/\bsize\s*=\s*["']?([1-7])/i);
      if (s) return `<span style="font-size:${['', '10px', '13px', '16px', '18px', '24px', '32px', '48px'][Number(s[1])]}">`;
      return '<span>';
    }
    return `<${t}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  });
  return out.replace(/<\/font>/gi, '</span>').trim();
}

/** Plain text from simple HTML: paragraphs and line breaks kept, lists as "- " and "1. ", links as "text (url)". */
export function htmlToText(html: string): string {
  const item = (inner: string) => inner.replace(/<[^>]+>/g, '').trim();
  let t = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => `\n${[...inner.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|$)/gi)].map((x, i) => `${i + 1}. ${item(x[1])}`).join('\n')}\n`)
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => `\n${[...inner.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|$)/gi)].map((x) => `- ${item(x[1])}`).join('\n')}\n`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      const h = href.replace(/^mailto:/i, '');
      return label && label !== h && label !== href ? `${label} (${href})` : h;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain text (or Markdown-ish) into the editor's HTML, for drafts written before rich text. */
export function textToEditorHtml(text: string): string {
  if (!text) return '';
  if (/<\/(p|div|b|i|ul|ol|a|span)>|<br\s*\/?>/i.test(text)) return cleanEditorHtml(text);
  return text.split(/\n{2,}/).map((p) => `<div>${esc(p).replace(/\n/g, '<br>')}</div>`).join('<div><br></div>');
}

// ---------------------------------------------------------------- identities and aliases

/** Every address an account sends as: the account's own, then its aliases. */
export function sendAs(a: Pick<Account, 'id' | 'email' | 'identities'>): (Identity & { account: string })[] {
  const list = a.identities.length ? a.identities : [{ name: '', email: a.email ?? '' }];
  return list.filter((i) => i.email).map((i) => ({ ...i, account: a.id }));
}

/**
 * The address to send a reply from: the alias the original was written to
 * (so a reply to sales@ goes from sales@), else the account's own.
 */
export function replyIdentity(a: Pick<Account, 'id' | 'email' | 'identities'>, original?: { to: Address[]; cc: Address[] }): Identity | undefined {
  const mine = sendAs(a);
  if (original) {
    const got = new Set([...original.to, ...original.cc].map((x) => x.address.toLowerCase()));
    const hit = mine.find((i) => got.has(i.email.toLowerCase()));
    if (hit) return hit;
  }
  return mine[0];
}

export function replyToOf(i?: Identity): Address[] | undefined {
  const r = i?.replyTo?.trim();
  return r ? [{ address: r }] : undefined;
}

/**
 * Whether the signature goes under this message: always on new mail; on
 * replies and forwards unless the account says otherwise; never once the
 * person took it off this message.
 */
export function signatureFor(i: Identity | undefined, o: { reply: boolean; onReplies?: boolean; removed?: boolean }): string | undefined {
  const sig = i?.signature?.trim();
  if (!sig || o.removed) return undefined;
  if (o.reply && o.onReplies === false) return undefined;
  return sig;
}

/** The message's text and HTML with the signature under what was written (and above the quote). */
export function assemble(o: { html?: string; text: string; signature?: string; quoted?: string }): { text: string; html: string } {
  const bodyHtml = o.html ? cleanEditorHtml(o.html) : textToEditorHtml(o.text);
  const bodyText = o.html ? htmlToText(o.html) : o.text;
  const sigText = o.signature ? `-- \n${o.signature}` : '';
  const sigHtml = o.signature ? `<div class="keeper-signature">-- <br>${esc(o.signature).replace(/\n/g, '<br>')}</div>` : '';
  const quoteHtml = o.quoted ? `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${esc(o.quoted.replace(/^> ?/gm, '')).replace(/\n/g, '<br>')}</blockquote>` : '';
  return {
    text: [bodyText, sigText, o.quoted ?? ''].filter(Boolean).join('\n\n'),
    html: [bodyHtml, sigHtml ? `<br>${sigHtml}` : '', quoteHtml ? `<br>${quoteHtml}` : ''].join(''),
  };
}

// ---------------------------------------------------------------- templates

export interface MailTemplate {
  id: string;
  name: string;
  subject?: string;
  /** the editor's HTML (or plain text) */
  body: string;
}

/** {first_name}, {name}, {email}, {my_name}, {date} and {day} filled in; unknown ones kept as typed. */
export function fillTemplate(text: string, v: { to?: Address; me?: Address; now?: number }): string {
  const now = new Date(v.now ?? Date.now());
  const name = v.to?.name?.trim() || '';
  const vars: Record<string, string> = {
    first_name: name.split(/\s+/)[0] || '',
    name,
    email: v.to?.address ?? '',
    my_name: v.me?.name ?? '',
    my_first_name: (v.me?.name ?? '').split(/\s+/)[0] ?? '',
    date: now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
    day: now.toLocaleDateString(undefined, { weekday: 'long' }),
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}
