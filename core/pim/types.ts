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
}

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
}

/** One occurrence to draw: a single event, or one instance of a repeating one. */
export interface Occurrence {
  event: CalEvent;
  start: number;
  end: number;
  /** the original start of this instance (for editing one occurrence) */
  instance: number;
}

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
