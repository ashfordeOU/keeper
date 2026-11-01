// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Contacts as vCard 3.0 / 4.0 (RFC 6350): the fields Keeper uses for address
// completion and attendees.

import { escapeText, unfold } from './ical';
import type { Contact } from './types';

function unescape(v: string) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

export function parseVCards(text: string, account = ''): Contact[] {
  const out: Contact[] = [];
  let cur: Contact | null = null;
  for (const line of unfold(text)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i).toUpperCase();
    const value = line.slice(i + 1);
    const name = head.split(';')[0].replace(/^ITEM\d+\./, '');
    if (name === 'BEGIN' && value.toUpperCase() === 'VCARD') {
      cur = { id: '', account, name: '', emails: [], phones: [] };
      continue;
    }
    if (!cur) continue;
    if (name === 'END') {
      if (!cur.name) cur.name = cur.emails[0] ?? cur.org ?? 'Unnamed';
      cur.id = `${account}:${cur.uid ?? cur.name}`;
      out.push(cur);
      cur = null;
    } else if (name === 'FN') cur.name = unescape(value);
    else if (name === 'N' && !cur.name) {
      const [last, first] = value.split(';');
      cur.name = [first, last].filter(Boolean).map(unescape).join(' ');
    } else if (name === 'EMAIL') cur.emails.push(value.trim());
    else if (name === 'TEL') cur.phones.push(value.replace(/^tel:/i, '').trim());
    else if (name === 'ORG') cur.org = unescape(value.split(';')[0]);
    else if (name === 'NOTE') cur.note = unescape(value);
    else if (name === 'BDAY') cur.birthday = value;
    else if (name === 'UID') cur.uid = value.replace(/^urn:uuid:/i, '');
  }
  return out;
}

export function serializeVCard(c: Contact): string {
  const parts = c.name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : '';
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${c.uid ?? c.id}`, `FN:${escapeText(c.name)}`, `N:${escapeText(last)};${escapeText(parts.join(' '))};;;`];
  for (const e of c.emails) L.push(`EMAIL;TYPE=INTERNET:${e}`);
  for (const p of c.phones) L.push(`TEL:${p}`);
  if (c.org) L.push(`ORG:${escapeText(c.org)}`);
  if (c.note) L.push(`NOTE:${escapeText(c.note)}`);
  if (c.birthday) L.push(`BDAY:${c.birthday}`);
  L.push('END:VCARD');
  return L.join('\r\n') + '\r\n';
}

/** Address suggestions for what has been typed so far. */
export function suggest(contacts: Contact[], recent: { name?: string; address: string }[], q: string, limit = 8): { name?: string; address: string }[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: { name?: string; address: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined, address: string) => {
    const k = address.toLowerCase();
    if (seen.has(k) || out.length >= limit) return;
    if ((name ?? '').toLowerCase().includes(s) || k.includes(s)) {
      seen.add(k);
      out.push({ name, address });
    }
  };
  for (const c of contacts) for (const e of c.emails) push(c.name, e);
  for (const r of recent) push(r.name, r.address);
  return out;
}
