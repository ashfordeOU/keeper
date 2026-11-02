// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts: the shapes shared by the
// pure logic, the main process and the interface.

export type AccountKind = 'imap' | 'google' | 'microsoft' | 'caldav' | 'ics';

export interface ServerSettings {
  host: string;
  port: number;
  /** 'tls' = encrypted from the start; 'starttls' = upgraded; 'none' only for local test servers */
  security: 'tls' | 'starttls' | 'none';
  user?: string;
}

export interface Identity {
  name: string;
  email: string;
  signature?: string;
}

export interface Account {
  id: string;
  kind: AccountKind;
  /** shown in the sidebar */
  label: string;
  email?: string;
  /** names and addresses you send as; the first is the default */
  identities: Identity[];
  imap?: ServerSettings;
  smtp?: ServerSettings;
  /** CalDAV base URL (or the .ics address for kind 'ics') */
  caldav?: string;
  carddav?: string;
  /** signed in with OAuth (Google, Microsoft) rather than a password */
  oauth?: 'google' | 'microsoft';
  /** which parts are switched on for this account */
  mail: boolean;
  calendar: boolean;
  contacts: boolean;
  /** messages from this account are read into Keeper's brain (search, AI) */
  indexMail?: boolean;
  /** accept self-signed certificates (home servers) */
  insecureTls?: boolean;
  /** coding assistants and other MCP apps may search, read and draft in this account's mail (off unless chosen) */
  mcp?: boolean;
  color?: string;
}

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged';

export interface MailFolder {
  account: string;
  path: string;
  name: string;
  special?: SpecialUse;
  unread: number;
  total: number;
  delimiter?: string;
}

export interface Address {
  name?: string;
  address: string;
}

export interface MessageSummary {
  /** `${account}:${folder}:${uid}` */
  id: string;
  account: string;
  folder: string;
  uid: number;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from?: Address;
  to: Address[];
  cc: Address[];
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  /** a short preview of the text (empty until the body has been read) */
  snippet: string;
  hasAttachments: boolean;
  size?: number;
  labels?: string[];
  /** snoozed until (local, Keeper only) */
  snoozedUntil?: number;
  /** came back from a snooze at this time (sorts as new) */
  returnedAt?: number;
  /** sent to a list or in bulk (List-Id, Precedence: bulk/list, Auto-Submitted) */
  bulk?: boolean;
  listId?: string;
  /** the List-Unsubscribe links */
  unsub?: { mailto?: string; url?: string; oneClick?: boolean };
  /** worked out when listed (core/pim/triage.ts), not stored */
  category?: 'important' | 'other';
  /** a sign-in alert, code or password reset (always Important; never shown to agents) */
  security?: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** inline image referenced from the HTML as cid: */
  cid?: string;
  inline?: boolean;
}

export interface MessageBody {
  id: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
  headers: Record<string, string>;
  /** an invitation inside the message (text/calendar) */
  invite?: string;
  listUnsubscribe?: { mailto?: string; url?: string; oneClick?: boolean };
}

export interface Thread {
  id: string;
  subject: string;
  messages: MessageSummary[];
  last: number;
  unread: number;
  participants: Address[];
}

export interface CalendarInfo {
  id: string;
  account: string;
  name: string;
  color: string;
  /** CalDAV collection URL, Graph calendar id or ics URL */
  url: string;
  readOnly: boolean;
  /** shown in the views */
  visible: boolean;
  ctag?: string;
  syncToken?: string;
  /** holds tasks (VTODO) rather than events */
  tasks?: boolean;
  /** where it comes from when not from an account: the computer's own calendars, holidays, birthdays */
  source?: CalendarSource;
  /** shown in the Island (next-event countdown and the Calendar tab); on unless false */
  island?: boolean;
  /** the colour was chosen here, so syncing keeps it */
  colorSet?: boolean;
  /** the group it is listed under (the account in the system's Calendar app, "Holidays") */
  group?: string;
  /** the system calendar's own id (EventKit, Evolution, Windows), or the holiday country */
  ref?: string;
}

/** Calendars that come from somewhere other than an account added in Keeper. */
export type CalendarSource = 'system' | 'holidays' | 'birthdays';

export interface Attendee {
  email: string;
  name?: string;
  status?: 'needs-action' | 'accepted' | 'declined' | 'tentative';
  role?: 'chair' | 'required' | 'optional';
}

export interface EventAlarm {
  /** minutes before the start (negative = after) */
  minutesBefore: number;
}

export interface CalEvent {
  /** `${calendar}:${uid}` (plus `:${recurrenceId}` for a changed occurrence) */
  id: string;
  calendar: string;
  uid: string;
  title: string;
  /** ms since epoch */
  start: number;
  end: number;
  allDay: boolean;
  /** IANA zone the event was written in (floating when absent) */
  tz?: string;
  location?: string;
  description?: string;
  url?: string;
  rrule?: string;
  exdates?: number[];
  /** set on a changed occurrence of a repeating event */
  recurrenceId?: number;
  attendees?: Attendee[];
  organizer?: Attendee;
  alarms?: EventAlarm[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
  /** the server's version tag (CalDAV ETag) */
  etag?: string;
  /** path of the resource on the server */
  href?: string;
  /** where "Open" takes you: the event on the provider's web page, or the system's Calendar app */
  openUrl?: string;
}

/** One occurrence to draw: a single event, or one instance of a repeating one. */
export interface Occurrence {
  event: CalEvent;
  start: number;
  end: number;
  /** the original start of this instance (for editing one occurrence) */
  instance: number;
}

/** One step of a task (a sub-task, checked off on its own). */
export interface TaskStep {
  id: string;
  title: string;
  done: boolean;
}

/**
 * A task: Keeper's one to-do model, shared by the Reminders page, the
 * Planner and the Island. Local ones live on this computer; ones in a
 * calendar account's task list sync as VTODO (core/pim/ical.ts).
 */
export interface Reminder {
  id: string;
  /** a calendar holding tasks, or 'local' */
  list: string;
  title: string;
  notes?: string;
  due?: number;
  /** remind at (defaults to due) */
  remindAt?: number;
  done: boolean;
  doneAt?: number;
  priority?: 0 | 1 | 2 | 3;
  /** the day it is planned for (yyyy-mm-dd, local); without it and a due date it sits in the Inbox */
  plannedFor?: string;
  /** repeats: an RRULE body such as FREQ=WEEKLY;BYDAY=MO (VTODO RRULE) */
  rrule?: string;
  /** a link to where it came from (keeper://mail/<id> for a task made from an email) */
  url?: string;
  steps?: TaskStep[];
  /** a project or area ("#home"), shown as a tag */
  project?: string;
  /** the person's own order within a day or list (lower first) */
  order?: number;
  /** when it was added */
  created?: number;
  /** focus sessions spent on it */
  focus?: { at: number; minutes: number }[];
  uid?: string;
  etag?: string;
  href?: string;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Alarm {
  id: string;
  label: string;
  /** "07:30" in local time */
  time: string;
  /** days it repeats on (0 = Sunday); empty = once */
  days: Weekday[];
  /** once-only alarms: the date it rings (yyyy-mm-dd), set when created */
  date?: string;
  enabled: boolean;
  sound: 'chime' | 'bell' | 'beep' | 'none';
  snoozeMin: number;
  /** snoozed until */
  snoozedUntil?: number;
  /** last time it rang, so it never rings twice for one time */
  lastFired?: number;
  /** ask the system to wake the computer for it (macOS, needs an administrator once) */
  wake?: boolean;
}

export interface CountdownTimer {
  id: string;
  label: string;
  durationMs: number;
  /** running: when it ends; paused: undefined */
  endsAt?: number;
  /** paused: what was left */
  leftMs?: number;
}

export interface WorldClock {
  zone: string;
  label?: string;
}

export interface Contact {
  id: string;
  account: string;
  name: string;
  emails: string[];
  phones: string[];
  org?: string;
  note?: string;
  birthday?: string;
  uid?: string;
  etag?: string;
  href?: string;
}
