// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The parts of help mode a web browser needs (the web viewer, a phone): code
// and password clean-up, the network tag and the channel secret, in pure JS
// (plain-http pages on the local network get no WebCrypto). Matches
// core/link/help.ts; test/k2k.test.ts checks they agree.

import { concat, hkdf, sha256, toHex, utf8 } from './jscrypto';

/** "123 456-789" → "123456789"; anything else → '' */
export function normalizeCode(s: string): string {
  const d = String(s ?? '').replace(/[\s-]/g, '');
  return /^\d{9}$/.test(d) ? d : '';
}

/** Case-insensitive; the look-alike letters typed by mistake become what they look like. */
export function normalizePassword(s: string): string {
  return String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/Z/g, '2');
}

export function helpTagWeb(code: string): string {
  return toHex(sha256(concat(utf8('keeper-help-tag'), utf8(normalizeCode(code)))).subarray(0, 6));
}

export function helpSecretWeb(code: string, password: string): Uint8Array {
  return hkdf(utf8(`${normalizeCode(code)}|${normalizePassword(password)}`), new Uint8Array(0), utf8('keeper help companion'), 32);
}

export const formatCode = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

/** keeper://help?code=123456789&pw=ABC234 (the password is optional: it can be read out separately). */
export function helpLink(code: string, password?: string): string {
  return `keeper://help?code=${normalizeCode(code)}${password ? `&pw=${encodeURIComponent(normalizePassword(password))}` : ''}`;
}

export function parseHelpLink(s: string): { code: string; password?: string } | null {
  const t = String(s ?? '').trim();
  if (!/^keeper:\/\/help\b/i.test(t)) return null;
  try {
    const u = new URL(t.replace(/^keeper:\/\//i, 'https://x/'));
    const code = normalizeCode(u.searchParams.get('code') ?? '');
    if (!code) return null;
    const pw = u.searchParams.get('pw');
    return { code, password: pw ? normalizePassword(pw) : undefined };
  } catch {
    return null;
  }
}
