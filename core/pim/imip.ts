// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Meeting invitations by mail (iMIP, RFC 6047): read a REQUEST, CANCEL or
// REPLY, and write your answer back to the organiser.

import { parseComponents, parseEvents, serializeEvents } from './ical';
import type { Attendee, CalEvent } from './types';

export interface Invitation {
  method: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH' | 'COUNTER' | string;
  event: CalEvent;
  /** for a REPLY: who answered and how */
  replyFrom?: { email: string; status?: string };
}

export function readInvitation(ics: string): Invitation | undefined {
  const cal = parseComponents(ics).find((c) => c.type === 'VCALENDAR');
  const method = (cal?.props.find((p) => p.name === 'METHOD')?.value ?? 'PUBLISH').toUpperCase();
  const event = parseEvents(ics, 'invite')[0];
  if (!event) return undefined;
  const inv: Invitation = { method, event };
  if (method === 'REPLY' && event.attendees?.[0]) inv.replyFrom = { email: event.attendees[0].email, status: event.attendees[0].status };
  return inv;
}

/** Your answer to an invitation: the event with only you as attendee, METHOD:REPLY. */
export function replyTo(inv: Invitation, me: { email: string; name?: string }, status: 'accepted' | 'declined' | 'tentative', now = Date.now()): { ics: string; subject: string; to?: string } {
  const e = inv.event;
  const mine = e.attendees?.find((a) => a.email.toLowerCase() === me.email.toLowerCase());
  const reply: CalEvent = {
    ...e,
    attendees: [{ email: me.email, name: mine?.name ?? me.name, status, role: mine?.role ?? 'required' }],
    alarms: undefined,
    description: undefined,
  };
  const word = status === 'accepted' ? 'Accepted' : status === 'declined' ? 'Declined' : 'Tentative';
  return { ics: serializeEvents([reply], { method: 'REPLY', now }), subject: `${word}: ${e.title}`, to: e.organizer?.email };
}

/** Applies a REPLY you received to your copy of the event (updates that attendee's answer). */
export function applyReply(event: CalEvent, inv: Invitation): CalEvent {
  if (!inv.replyFrom) return event;
  const email = inv.replyFrom.email.toLowerCase();
  return {
    ...event,
    attendees: (event.attendees ?? []).map((a) => (a.email.toLowerCase() === email ? { ...a, status: inv.replyFrom!.status as Attendee['status'] } : a)),
  };
}
