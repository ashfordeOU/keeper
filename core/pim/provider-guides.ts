// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Step-by-step setup for each kind of mail account, shown in the Add account
// dialog. Written for Keeper; links go to the providers' own pages (the
// app-password links are the ones in autoconfig.ts).

import { knownProvider } from './autoconfig';

export type GuideId = 'gmail' | 'outlook' | 'icloud' | 'yahoo' | 'aol' | 'fastmail' | 'zoho' | 'imap';

export interface ProviderGuide {
  id: GuideId;
  name: string;
  /** an address that picks this provider's servers (for the app-password link) */
  sample?: string;
  steps: string[];
  /** a sign-in button does it instead, when this copy of Keeper has one */
  signIn?: 'google' | 'microsoft';
  /** an extra link besides the app-password page */
  help?: { label: string; url: string };
}

export const GUIDES: ProviderGuide[] = [
  {
    id: 'gmail', name: 'Gmail', sample: 'x@gmail.com', signIn: 'google',
    steps: [
      'Easiest: press Sign in with Google (when it is offered) and allow Keeper.',
      'Otherwise turn on 2-Step Verification for your Google Account.',
      'Open the app-password page, make one named “Keeper”, and copy the 16 letters.',
      'Type your Gmail address here, Continue, and paste the app password.',
    ],
  },
  {
    id: 'outlook', name: 'Outlook.com and Microsoft 365', signIn: 'microsoft',
    steps: [
      'Microsoft only allows its sign-in for mail now: press Sign in with Microsoft.',
      'Work or school accounts may need your organisation to allow Keeper.',
      'If this copy of Keeper has no Microsoft sign-in, add a client ID under Developer options in Settings → Mail & Calendar.',
    ],
    help: { label: 'Microsoft’s note on modern sign-in', url: 'https://support.microsoft.com/office/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-apps-c5d65390-9676-4763-b41f-d7986499a90d' },
  },
  {
    id: 'icloud', name: 'iCloud Mail', sample: 'x@icloud.com',
    steps: [
      'Two-factor authentication must be on for your Apple Account.',
      'Open the Apple Account page, Sign-In and Security → App-Specific Passwords, and make one named “Keeper”.',
      'Type your @icloud.com (or @me.com) address here, Continue, and paste it. Calendars and contacts come too.',
    ],
  },
  {
    id: 'yahoo', name: 'Yahoo Mail', sample: 'x@yahoo.com',
    steps: ['Open Yahoo’s account security page and choose Generate app password.', 'Name it “Keeper” and copy it.', 'Type your Yahoo address here, Continue, and paste it.'],
  },
  {
    id: 'aol', name: 'AOL Mail', sample: 'x@aol.com',
    steps: ['Open AOL’s account security page and choose Generate app password.', 'Name it “Keeper” and copy it.', 'Type your AOL address here, Continue, and paste it.'],
  },
  {
    id: 'fastmail', name: 'Fastmail', sample: 'x@fastmail.com',
    steps: ['In Fastmail, open its settings, then Privacy & Security, Manage app passwords, New app password.', 'Give it access to mail (and calendars and contacts if you want them), copy it.', 'Type your Fastmail address here, Continue, and paste it.'],
  },
  {
    id: 'zoho', name: 'Zoho Mail', sample: 'x@zoho.com',
    steps: ['In Zoho Mail, open its settings, then Mail Accounts, and turn on IMAP access.', 'With two-factor sign-in on, make an app-specific password in Zoho Accounts → Security.', 'Type your Zoho address here, Continue, and paste it.'],
  },
  {
    id: 'imap', name: 'Any other provider (IMAP)',
    steps: [
      'Type your address and Continue: Keeper looks up the servers (autoconfiguration and DNS).',
      'If it cannot, open the server settings below and enter what your provider lists for IMAP (incoming, usually port 993) and SMTP (outgoing, usually 465 or 587).',
      'Use an app password if your provider has them; your usual password otherwise.',
    ],
  },
];

/** The page where this provider's app password is made, from the same table the account dialog uses. */
export function appPasswordLink(g: ProviderGuide): { provider: string; url: string } | undefined {
  if (!g.sample) return undefined;
  const c = knownProvider(g.sample);
  return c?.appPasswordUrl ? { provider: c.provider ?? g.name, url: c.appPasswordUrl } : undefined;
}

/** The guide for an address being typed. */
export function guideFor(email: string): ProviderGuide {
  const d = email.toLowerCase().split('@')[1] ?? '';
  if (/^(gmail|googlemail)\.com$/.test(d)) return GUIDES[0];
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return GUIDES[1];
  if (/^(icloud|me|mac)\.com$/.test(d)) return GUIDES[2];
  if (/^(yahoo|ymail|rocketmail)\.[a-z.]+$/.test(d)) return GUIDES[3];
  if (/^aol\.[a-z.]+$/.test(d)) return GUIDES[4];
  if (/^(fastmail\.[a-z]+|fastmail\.fm)$/.test(d)) return GUIDES[5];
  if (/^zoho(mail)?\.[a-z.]+$/.test(d)) return GUIDES[6];
  return GUIDES[GUIDES.length - 1];
}
