// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Contacts in and out: vCard files (3.0 and 4.0, also the older 2.1 with
// quoted-printable text) and CSV from any app (the columns are found by name:
// a web mail's export, a desktop mail app's export, a spreadsheet).

import { csvRecords, toCsv } from './task-import';
import { parseVCards, serializeVCard } from './vcard';
import type { Contact } from './types';

/** Quoted-printable text inside an older vCard (ENCODING=QUOTED-PRINTABLE), decoded as UTF-8. */
export function decodeQuotedPrintable(v: string): string {
  const bytes: number[] = [];
  const s = v.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(s[i], 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Cards from a .vcf file: older cards' quoted-printable lines (with soft line
 * breaks) are decoded first, "mailto:" and "tel:" are taken off, and people
 * without any name or address are left out.
 */
export function contactsFromVcf(text: string, account = 'local'): Contact[] {
  // Soft line breaks of quoted-printable values join the next line.
  const joined = text.replace(/^([^:\r\n]*ENCODING=QUOTED-PRINTABLE[^:\r\n]*:)((?:[^\r\n]*=\r?\n)*[^\r\n]*)/gim, (_, head: string, val: string) => {
    const charsetless = head.replace(/;ENCODING=QUOTED-PRINTABLE/i, '').replace(/;CHARSET=[^;:]+/i, '');
    return `${charsetless}${decodeQuotedPrintable(val).replace(/\r?\n/g, '\\n')}`;
  });
  return parseVCards(joined, account)
    .map((c) => ({ ...c, emails: [...new Set(c.emails.map((e) => e.replace(/^mailto:/i, '').trim()).filter(Boolean))], phones: c.phones.map((p) => p.replace(/^tel:/i, '').trim()).filter(Boolean) }))
    .filter((c) => c.name !== 'Unnamed' || c.emails.length || c.phones.length);
}

const first = (r: Record<string, string>, names: string[]) => names.map((n) => r[n]).find((v) => v && v.trim());
const allOf = (r: Record<string, string>, re: RegExp) => Object.entries(r).filter(([k, v]) => re.test(k) && v).flatMap(([, v]) => v.split(/\s*:::\s*|\s*;\s*/)).map((x) => x.trim()).filter(Boolean);

/** People from a CSV file; the columns are found by their names in English. */
export function contactsFromCsv(text: string, account = 'local'): Contact[] {
  const out: Contact[] = [];
  for (const r of csvRecords(text)) {
    const given = first(r, ['given name', 'first name', 'firstname', 'first']);
    const family = first(r, ['family name', 'last name', 'lastname', 'surname', 'last']);
    const name = first(r, ['name', 'display name', 'full name', 'fn']) ?? [given, family].filter(Boolean).join(' ');
    const emails = [...new Set(allOf(r, /(e-?mail).*(address|value)$|^e-?mail( \d+)?$|^email address$/))].filter((e) => e.includes('@'));
    const phones = [...new Set(allOf(r, /phone.*(value|number)?$|^mobile|^(home|business|work) phone|^telephone/))];
    const org = first(r, ['organization 1 - name', 'organization name', 'organization', 'company', 'org']);
    if (!name && !emails.length && !phones.length) continue;
    const bday = first(r, ['birthday', 'birth date', 'bday']);
    const c: Contact = { id: '', account, name: name || emails[0] || phones[0], emails, phones };
    if (org) c.org = org;
    const note = first(r, ['notes', 'note']);
    if (note) c.note = note;
    if (bday && /^\d{4}-\d{2}-\d{2}$|^--\d{2}-\d{2}$/.test(bday)) c.birthday = bday;
    out.push(c);
  }
  return out;
}

/** Many contacts as one .vcf file. */
export function contactsToVcf(list: Contact[]): string {
  return list.map(serializeVCard).join('');
}

/** Contacts as CSV with the usual columns. */
export function contactsToCsv(list: Contact[]): string {
  return toCsv([['Name', 'E-mail 1', 'E-mail 2', 'Phone 1', 'Phone 2', 'Organization', 'Birthday', 'Notes'], ...list.map((c) => [c.name, c.emails[0] ?? '', c.emails[1] ?? '', c.phones[0] ?? '', c.phones[1] ?? '', c.org ?? '', c.birthday ?? '', c.note ?? ''])]);
}

/** The same person already there: the same first address, or else the same name. */
export function contactKey(c: Pick<Contact, 'name' | 'emails'>): string {
  return (c.emails[0] ?? `name:${c.name}`).trim().toLowerCase();
}
