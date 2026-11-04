// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What can be opened from an event: the meeting's Join link, the event's own
// web address, links written in its notes, its place in a maps app, and its
// attached files. Each opens in the person's own browser or app.

import { meetingLink } from './alarms';
import type { CalEvent } from './types';

export interface EventLink {
  url: string;
  /** a short name: the site ("docs.example.com") or the link's own text */
  label: string;
}

export interface EventOpenables {
  join?: string;
  links: EventLink[];
  /** the address to look up in a maps app, when the place is not a link */
  place?: string;
  attachments: { index: number; name: string; url?: string }[];
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/** A link's site, for its button ("docs.example.com"). */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url.startsWith('www.') ? `https://${url}` : url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 && u.pathname.length < 24 ? u.pathname.replace(/\/$/, '') : '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Only links a browser should open (web pages and mail); nothing that runs on this computer. */
export function safeLink(url: string): string | undefined {
  const u = url.startsWith('www.') ? `https://${url}` : url;
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : undefined;
}

export function eventOpenables(e: Pick<CalEvent, 'location' | 'description' | 'url' | 'attachments'>, limit = 4): EventOpenables {
  const join = meetingLink(e);
  const seen = new Set<string>(join ? [join] : []);
  const links: EventLink[] = [];
  const add = (raw?: string) => {
    const u = raw && safeLink(raw.trim());
    if (!u || seen.has(u) || links.length >= limit || u.startsWith('keeper:')) return;
    seen.add(u);
    links.push({ url: u, label: linkLabel(u) });
  };
  add(e.url);
  for (const m of `${e.location ?? ''}\n${e.description ?? ''}`.match(URL_RE) ?? []) add(m);
  const loc = e.location?.trim();
  const place = loc && !new RegExp(URL_RE.source, 'i').test(loc) && !/^(online|virtual|remote|tbd|tba)$/i.test(loc) ? loc : undefined;
  return { join, links, place, attachments: (e.attachments ?? []).map((a, index) => ({ index, name: a.name ?? 'attachment', url: a.url ? safeLink(a.url) : undefined })) };
}

