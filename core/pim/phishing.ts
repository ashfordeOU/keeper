// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Warnings for mail that pretends to be someone it is not: a contact's or a
// well-known company's name on a stranger's address, a domain one letter off
// a real one (or written with look-alike letters), replies that go somewhere
// else than the sender, links whose text names one place and lead to another,
// and a sender the provider's own checks failed. Pure: no network.

import { BRANDS } from './smart';
import type { Address } from './types';

export type PhishKind = 'display-name' | 'brand-name' | 'lookalike' | 'reply-to' | 'link-mismatch' | 'auth-failed' | 'punycode';

export interface PhishWarning {
  kind: PhishKind;
  /** a sentence for the banner */
  message: string;
  /** how serious: 2 = likely an attack, 1 = worth a look */
  level: 1 | 2;
}

export interface PhishInput {
  from?: Address;
  replyTo?: Address[];
  /** the raw header values (lower-case names) */
  headers?: Record<string, string>;
  /** links in the message (their visible text and where they go) */
  links?: { text: string; href: string }[];
  /** people you know: names and their addresses */
  contacts?: { name: string; emails: string[] }[];
  /** domains you deal with (your own, your contacts', ones you write to) */
  knownDomains?: string[];
}

const lc = (s?: string) => (s ?? '').toLowerCase().trim();
const domainOf = (a?: string) => lc(a).split('@')[1] ?? '';

/** The registrable part of a domain, roughly: "mail.paypal.co.uk" → "paypal.co.uk". */
export function baseDomain(d: string): string {
  const parts = lc(d).replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const two = parts.slice(-2).join('.');
  // Common two-part endings.
  if (/^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join('.');
  return two;
}

/** Letters that look like others in common fonts, mapped to what they imitate. */
const CONFUSABLE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd', ɡ: 'g', ո: 'n', ս: 'u', ʏ: 'y', ӏ: 'l', '0': 'o', '1': 'l',
};
const SEQ: [RegExp, string][] = [[/rn/g, 'm'], [/vv/g, 'w'], [/cl/g, 'd']];

/** A domain with look-alikes replaced (for comparing with real ones). */
export function skeleton(d: string): string {
  let s = [...lc(d)].map((c) => CONFUSABLE[c] ?? c).join('');
  for (const [r, to] of SEQ) s = s.replace(r, to);
  return s;
}

function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/** The real domain a look-alike imitates, if any (not the domain itself). */
export function lookalikeOf(domain: string, real: string[]): string | undefined {
  const d = baseDomain(domain);
  if (!d) return undefined;
  const label = d.split('.')[0];
  for (const r0 of real) {
    const r = baseDomain(r0);
    if (!r || r === d) continue;
    const rl = r.split('.')[0];
    if (rl.length < 4) continue;
    // Same letters once look-alikes are undone, or one or two letters off a name of some length.
    if (skeleton(d) === skeleton(r)) return r;
    const dist = editDistance(label, rl, 2);
    if (label !== rl && (dist === 1 || (dist === 2 && rl.length >= 8))) return r;
    // "paypal-security.com", "secure-paypal.net".
    if (label !== rl && new RegExp(`(^|[-.])${rl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([-.]|$)`).test(label)) return r;
  }
  return undefined;
}

const BRAND_DOMAINS = Object.keys(BRANDS);
const BRAND_NAMES = [...new Set(Object.values(BRANDS).map((b) => b.name))];

/** Where a link's text says it goes (when the text is itself an address). */
function textHost(text: string): string | undefined {
  const t = text.trim().replace(/[)\].,;:]+$/, '');
  const m = t.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i);
  return m ? lc(m[1]).replace(/^www\./, '') : undefined;
}

function hostOf(href: string): string | undefined {
  try { return new URL(href).hostname.toLowerCase().replace(/^www\./, ''); } catch { return undefined; }
}

export function phishingWarnings(i: PhishInput): PhishWarning[] {
  const out: PhishWarning[] = [];
  const from = lc(i.from?.address);
  const fromDomain = domainOf(from);
  const name = (i.from?.name ?? '').trim();
  const known = [...new Set([...(i.knownDomains ?? []), ...(i.contacts ?? []).flatMap((c) => c.emails.map(domainOf))].filter(Boolean))];
  const add = (w: PhishWarning) => { if (!out.some((x) => x.kind === w.kind)) out.push(w); };

  // A contact's name on an address that is not theirs.
  if (name && from) {
    const n = lc(name);
    const contact = (i.contacts ?? []).find((c) => lc(c.name) === n && c.name.trim().split(/\s+/).length >= 2);
    if (contact && !contact.emails.some((e) => lc(e) === from)) add({ kind: 'display-name', level: 2, message: `This uses the name of your contact ${contact.name}, but comes from ${from}, which is not one of their addresses.` });
    // An address written into the name that differs from the real one.
    const inName = name.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
    if (inName && lc(inName[0]) !== from) add({ kind: 'display-name', level: 2, message: `The sender's name shows ${inName[0]}, but the mail really comes from ${from}.` });
    // A well-known company's name on another domain.
    const brand = BRAND_NAMES.find((b) => b.length >= 3 && new RegExp(`(^|[^\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(name));
    if (brand) {
      const domains = BRAND_DOMAINS.filter((d) => BRANDS[d].name === brand);
      const ok = domains.some((d) => fromDomain === d || fromDomain.endsWith(`.${d}`)) || baseDomain(fromDomain).startsWith(lc(brand).replace(/[^a-z0-9]/g, ''));
      if (!ok) add({ kind: 'brand-name', level: 1, message: `The name says ${brand}, but the mail comes from ${fromDomain || 'another address'}.` });
    }
  }

  // Look-alike domains (of brands and of people you deal with).
  if (fromDomain) {
    if (/(^|\.)xn--/.test(fromDomain)) add({ kind: 'punycode', level: 1, message: `The sender's domain (${fromDomain}) is written with letters from another alphabet, which can imitate a familiar name.` });
    const real = lookalikeOf(fromDomain, [...BRAND_DOMAINS, ...known]);
    if (real && !known.includes(baseDomain(fromDomain))) add({ kind: 'lookalike', level: 2, message: `${fromDomain} looks like ${real} but is a different domain.` });
  }

  // Replies go elsewhere.
  const rt = (i.replyTo ?? []).map((a) => lc(a.address)).filter(Boolean);
  if (fromDomain && rt.length) {
    const other = rt.find((a) => baseDomain(domainOf(a)) !== baseDomain(fromDomain));
    const freemail = /^(gmail|googlemail|yahoo|outlook|hotmail|live|aol|icloud|me|mail|gmx|proton|protonmail|yandex|zoho)\./;
    if (other && (freemail.test(baseDomain(domainOf(other))) || !known.includes(baseDomain(domainOf(other))))) add({ kind: 'reply-to', level: 1, message: `Replies would go to ${other}, not to ${from}.` });
  }

  // Links whose text names another place.
  for (const l of i.links ?? []) {
    const shown = textHost(l.text);
    const real = hostOf(l.href);
    if (!shown || !real) continue;
    if (baseDomain(shown) !== baseDomain(real)) {
      add({ kind: 'link-mismatch', level: 2, message: `A link shows ${shown} but goes to ${real}.` });
      break;
    }
  }

  // The provider's own checks (SPF, DKIM, DMARC).
  const auth = lc(i.headers?.['authentication-results'] ?? '');
  if (/\bdmarc=fail\b/.test(auth) || (/\bspf=fail\b/.test(auth) && /\bdkim=(fail|none)\b/.test(auth))) add({ kind: 'auth-failed', level: 2, message: 'Your provider could not confirm that this mail really comes from the sender’s domain.' });

  return out.sort((a, b) => b.level - a.level);
}

/** Links in a message's HTML: their visible text and where they go. */
export function linksIn(html: string): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    out.push({ text, href: m[2].replace(/&amp;/g, '&') });
    if (out.length > 400) break;
  }
  return out;
}
