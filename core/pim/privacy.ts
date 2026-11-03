// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail privacy with no network: tracking parameters taken off links before
// they open, read-receipt requests that are never answered, and the list of
// every connection Mail makes (shown in Settings so nothing is hidden).

/** Query parameters that only exist to follow a click back to a campaign or a person. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_brand', 'utm_social', 'utm_social-type',
  'gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'yclid',
  'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_cid', 'ss_campaign_id', 'ss_source', 'sc_cid',
  'ml_subscriber', 'ml_subscriber_hash', 'trk', 'trkcampaign', 'trackingid', 'ref_src', 'ref_url', 'spm', 'scm',
  'cmpid', 'campaign_id', 'emci', 'emdi', 'ceid', 'elqtrackid', 'elqtrack', 'elq', 'elqcampaignid', 'sfmc_id', 'sfmc_sub',
  'e_t', 'ecid', 'eid', 'bsft_eid', 'bsft_clkid', 'bsft_uid', 'bsft_mid', 'bsft_aaid', 'bsft_ek', 'wickedid', 'irclickid', 'srsltid',
]);
const TRACKING_PREFIX = /^(utm_|pk_|mtm_|matomo_|piwik_|hsa_|vgo_|_branch_)/i;

/**
 * A link without its tracking parameters. Anything else (the path, other
 * parameters, the fragment) is kept as it was; a link that is not http(s) or
 * cannot be read comes back unchanged.
 */
export function stripTracking(href: string): { href: string; removed: number } {
  const raw = href.trim();
  if (!/^https?:\/\//i.test(raw)) return { href, removed: 0 };
  let u: URL;
  try { u = new URL(raw); } catch { return { href, removed: 0 }; }
  let removed = 0;
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k.toLowerCase()) || TRACKING_PREFIX.test(k)) {
      u.searchParams.delete(k);
      removed++;
    }
  }
  if (!removed) return { href, removed: 0 };
  // URL keeps an empty "?" when the last parameter goes.
  return { href: u.toString().replace(/\?(#|$)/, '$1'), removed };
}

/**
 * Headers that ask for a read receipt. Keeper never answers them (no
 * "Disposition-Notification" is ever sent) and never asks for one either.
 */
export const RECEIPT_HEADERS = ['disposition-notification-to', 'return-receipt-to', 'x-confirm-reading-to'];

export function asksForReceipt(headers: Record<string, string>): boolean {
  return RECEIPT_HEADERS.some((h) => !!headers[h]);
}

/** Every connection Mail makes, for the "connections Mail makes" note. */
export interface MailConnection {
  to: string;
  why: string;
  when: string;
}

export const MAIL_CONNECTIONS: MailConnection[] = [
  { to: 'Your mail provider’s IMAP server', why: 'Reads folders and messages, keeps changes in step, waits for new mail (IDLE)', when: 'While Mail is on' },
  { to: 'Your mail provider’s SMTP server', why: 'Sends what you write, invitation answers and unsubscribe requests by mail', when: 'When something is sent' },
  { to: 'ManageSieve on your mail server (port 4190)', why: 'Writes the rules you mark “also on the server”', when: 'When such rules change, and only if the server offers it' },
  { to: 'Gmail’s API (gmail.googleapis.com)', why: 'Writes the rules you mark “also on the server” as Gmail filters', when: 'Signed in with Google, when such rules change' },
  { to: 'Google or Microsoft sign-in', why: 'Signs in and refreshes the sign-in token', when: 'Only for accounts added with those buttons' },
  { to: 'Autoconfiguration (autoconfig.<your domain>, DNS SRV)', why: 'Finds the servers for an address', when: 'Only while adding an account' },
  { to: 'An unsubscribe address the sender gave', why: 'One-click unsubscribe (a single POST, no cookies)', when: 'Only when you press Unsubscribe' },
  { to: 'Hosts of pictures in a message', why: 'Shows remote pictures', when: 'Only after Load images, or for senders you allowed' },
  { to: 'The AI chosen in Settings → AI & Brain', why: 'Summaries, replies, rewriting, Ask and translation (security mail never goes)', when: 'Only when you use an AI action' },
];

export const MAIL_NEVER = [
  'No read receipts are sent, and none are asked for.',
  'No tracking pixel is loaded; tracking parameters are taken off links before they open.',
  'Sender photos come from your own contacts on this computer; nothing is looked up online.',
  'No server of Keeper’s sees your mail: it goes between this computer and your provider.',
];
