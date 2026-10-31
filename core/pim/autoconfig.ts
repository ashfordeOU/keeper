// SPDX-License-Identifier: AGPL-3.0-or-later
// Finding a mail provider's servers from an address: well-known providers,
// the provider's own autoconfig file, the public ISP database format, DNS SRV
// records, and finally common host names.

import { find, findAll, parseXml, textOf } from './xml';
import type { ServerSettings } from './types';

export interface MailConfig {
  provider?: string;
  imap?: ServerSettings & { user: string };
  smtp?: ServerSettings & { user: string };
  caldav?: string;
  carddav?: string;
  /** sign in through the provider's page instead of a password */
  oauth?: 'google' | 'microsoft';
  /** a note for the person, e.g. "use an app-specific password" */
  note?: string;
}

const user = (email: string) => email;

/** Built-in settings for the big providers. */
export function knownProvider(email: string): MailConfig | undefined {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const u = user(email);
  if (/^(gmail|googlemail)\.com$/.test(domain)) {
    return {
      provider: 'Google', oauth: 'google', caldav: 'https://apidata.googleusercontent.com/caldav/v2/', carddav: 'https://www.googleapis.com/carddav/v1/principals/',
      imap: { host: 'imap.gmail.com', port: 993, security: 'tls', user: u }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls', user: u },
      note: 'Sign in with Google, or turn on 2-Step Verification and use an app password.',
    };
  }
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) {
    return { provider: 'Microsoft', oauth: 'microsoft', imap: { host: 'outlook.office365.com', port: 993, security: 'tls', user: u }, smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', user: u } };
  }
  if (/^(icloud|me|mac)\.com$/.test(domain)) {
    return {
      provider: 'iCloud', caldav: 'https://caldav.icloud.com/', carddav: 'https://contacts.icloud.com/',
      imap: { host: 'imap.mail.me.com', port: 993, security: 'tls', user: u.split('@')[0] }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls', user: u },
      note: 'Use an app-specific password from your Apple Account settings (Sign-In and Security → App-Specific Passwords).',
    };
  }
  if (/^(fastmail\.(com|fm)|messagingengine\.com)$/.test(domain)) {
    return {
      provider: 'Fastmail', caldav: 'https://caldav.fastmail.com/dav/', carddav: 'https://carddav.fastmail.com/dav/',
      imap: { host: 'imap.fastmail.com', port: 993, security: 'tls', user: u }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'tls', user: u },
      note: 'Use an app password from Fastmail’s Settings → Privacy & Security.',
    };
  }
  if (/^(yahoo|ymail)\.[a-z.]+$/.test(domain)) {
    return { provider: 'Yahoo', caldav: 'https://caldav.calendar.yahoo.com/', imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'tls', user: u }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'tls', user: u }, note: 'Use an app password from your Yahoo account security page.' };
  }
  if (/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/.test(domain)) {
    return { provider: 'Proton', imap: { host: '127.0.0.1', port: 1143, security: 'starttls', user: u }, smtp: { host: '127.0.0.1', port: 1025, security: 'starttls', user: u }, note: 'Proton Mail works through Proton Mail Bridge running on this computer; use the password the Bridge shows.' };
  }
  return undefined;
}

/** Reads a Thunderbird-style autoconfig / ISP database file (clientConfig v1.1). */
export function parseAutoconfig(xml: string, email: string): MailConfig | undefined {
  const doc = parseXml(xml);
  const prov = find(doc, 'emailProvider');
  if (!prov) return undefined;
  const [local, domain] = email.split('@');
  const fill = (s: string) => s.replace(/%EMAILADDRESS%/g, email).replace(/%EMAILLOCALPART%/g, local).replace(/%EMAILDOMAIN%/g, domain);
  const server = (n: (typeof prov) | undefined): (ServerSettings & { user: string }) | undefined => {
    if (!n) return undefined;
    const sock = textOf(find(n, 'socketType')).toUpperCase();
    return {
      host: fill(textOf(find(n, 'hostname'))),
      port: Number(textOf(find(n, 'port'))),
      security: sock === 'SSL' ? 'tls' : sock === 'STARTTLS' ? 'starttls' : 'none',
      user: fill(textOf(find(n, 'username')) || '%EMAILADDRESS%'),
    };
  };
  const incoming = findAll(prov, 'incomingServer').find((n) => n.attrs.type === 'imap');
  const outgoing = findAll(prov, 'outgoingServer').find((n) => n.attrs.type === 'smtp');
  const imap = server(incoming);
  const smtp = server(outgoing);
  if (!imap?.host) return undefined;
  return { provider: textOf(find(prov, 'displayName')) || domain, imap, smtp: smtp?.host ? smtp : undefined };
}

/** The addresses to try, in order, for a domain's autoconfig file. */
export function autoconfigUrls(email: string): string[] {
  const domain = email.split('@')[1];
  const e = encodeURIComponent(email);
  return [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${e}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${e}`,
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
  ];
}

/** Settings from DNS SRV records (RFC 6186): _imaps._tcp, _submission._tcp. */
export function fromSrv(email: string, imaps: { name: string; port: number }[], submission: { name: string; port: number }[]): MailConfig | undefined {
  const i = imaps.find((r) => r.name && r.name !== '.');
  if (!i) return undefined;
  const s = submission.find((r) => r.name && r.name !== '.');
  return {
    imap: { host: i.name, port: i.port || 993, security: 'tls', user: email },
    smtp: s ? { host: s.name, port: s.port || 587, security: s.port === 465 ? 'tls' : 'starttls', user: email } : undefined,
  };
}

/** Last resort: the usual host names. */
export function guess(email: string): MailConfig {
  const domain = email.split('@')[1];
  return { imap: { host: `imap.${domain}`, port: 993, security: 'tls', user: email }, smtp: { host: `smtp.${domain}`, port: 587, security: 'starttls', user: email } };
}
