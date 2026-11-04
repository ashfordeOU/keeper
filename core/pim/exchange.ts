// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Exchange servers run by an organisation (not Microsoft 365): Keeper finds
// them with Autodiscover and uses what they offer to mail apps (IMAP and
// SMTP, when switched on). Exchange's own protocol (EWS) is not spoken yet;
// when the server offers nothing else, the person is told plainly what works.

import type { MailConfig } from './autoconfig';

/** Where an organisation's Autodiscover answers (POX, the plain XML form). */
export function autodiscoverUrls(email: string): string[] {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return [`https://autodiscover.${domain}/autodiscover/autodiscover.xml`, `https://${domain}/autodiscover/autodiscover.xml`];
}

/** The Autodiscover request (Outlook's "response schema" asks for every protocol). */
export function autodiscoverRequest(email: string): string {
  const esc = email.replace(/[<>&"]/g, '');
  return `<?xml version="1.0" encoding="utf-8"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006"><Request><EMailAddress>${esc}</EMailAddress><AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema></Request></Autodiscover>`;
}

const val = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1]?.trim();

export interface ExchangeInfo {
  name?: string;
  /** Exchange Web Services address (calendars and mail in Exchange's own protocol) */
  ews?: string;
  imap?: { host: string; port: number; ssl: boolean };
  smtp?: { host: string; port: number; ssl: boolean; encryption?: string };
  /** another address to ask (a redirect inside the answer) */
  redirect?: string;
}

/** Reads an Autodiscover answer. */
export function parseAutodiscover(xml: string): ExchangeInfo | null {
  if (!/<Autodiscover\b/i.test(xml)) return null;
  const out: ExchangeInfo = { name: val(xml, 'DisplayName') };
  const redirect = val(xml, 'RedirectAddr') ?? val(xml, 'RedirectUrl');
  if (redirect) out.redirect = redirect;
  for (const block of xml.match(/<Protocol>[\s\S]*?<\/Protocol>/gi) ?? []) {
    const type = val(block, 'Type')?.toUpperCase();
    const server = val(block, 'Server');
    const port = Number(val(block, 'Port'));
    const ssl = (val(block, 'SSL') ?? 'on').toLowerCase() !== 'off';
    const ews = val(block, 'EwsUrl') ?? val(block, 'ASUrl');
    if ((type === 'EXCH' || type === 'EXPR') && ews && !out.ews) out.ews = ews;
    if (type === 'IMAP' && server) out.imap = { host: server, port: port || (ssl ? 993 : 143), ssl };
    if (type === 'SMTP' && server) out.smtp = { host: server, port: port || 587, ssl, encryption: val(block, 'Encryption') };
  }
  return out;
}

/** Mail settings from what the Exchange server offers, with a plain note on what works. */
export function exchangeConfig(email: string, info: ExchangeInfo): MailConfig {
  const host = info.ews ? new URL(info.ews).hostname : email.split('@')[1];
  if (info.imap) {
    return {
      provider: 'Exchange',
      imap: { host: info.imap.host, port: info.imap.port, security: info.imap.ssl && info.imap.port !== 143 ? 'tls' : 'starttls', user: email },
      smtp: info.smtp ? { host: info.smtp.host, port: info.smtp.port, security: info.smtp.port === 465 ? 'tls' : 'starttls', user: email } : { host, port: 587, security: 'starttls', user: email },
      note: 'Your organisation’s Exchange server offers IMAP, so mail works here. For its calendars and contacts, use this computer’s own Calendar app (Keeper reads it) or ask whether CalDAV is available.',
    };
  }
  return {
    provider: 'Exchange',
    imap: { host, port: 993, security: 'tls', user: email },
    smtp: { host, port: 587, security: 'starttls', user: email },
    note: `Your organisation uses Exchange${info.ews ? ` (${host})` : ''} without IMAP for mail apps. Keeper doesn’t speak Exchange’s own protocol yet: ask your IT team to turn on IMAP and SMTP for you, and add Exchange to this computer’s own Calendar app, whose calendars Keeper shows.`,
  };
}

/** An Autodiscover endpoint that asks for a password (HTTP 401 with NTLM, Negotiate or Basic) is an Exchange server. */
export function looksLikeExchange(status: number, wwwAuthenticate: string | null): boolean {
  return status === 401 && /ntlm|negotiate|basic/i.test(wwwAuthenticate ?? '');
}
