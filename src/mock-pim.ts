// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders and alarms for the browser demo: two accounts,
// a few conversations, a week of events, some to-dos, alarms and timers.

import type { MailView, OpenMessage, Outbox, PimApi, Ring } from '../core/api-pim';
import { classify, followUpDraft, isSnoozed, pickForQuestion, sortTime, subscriptions, triageContext, waitingForReply } from '../core/pim/triage';
import { dueKey, dueNow, nextAlarmTime } from '../core/pim/alarms';
import { occurrences } from '../core/pim/ical';
import { makeReply, matchesQuery, threadMessages, type Draft, type MailRule } from '../core/pim/mail';
import { labelCounts } from '../core/pim/mail-today';
import { badgeCount, extractCode, extractSignInLink, inTab, isBlocked, isDesignedMail, tabCounts, toReply, unreadByAccount, type NoReplyReminder } from '../core/pim/smart';
import { matchMailQuery, orderResults, parseMailQuery } from '../core/pim/search';
import { linksIn, phishingWarnings } from '../core/pim/phishing';
import { parseQuickAdd } from '../core/pim/quickadd';
import { addLog, insights, type LogEntry } from '../core/pim/insights';
import { completeTask, moveToDay } from '../core/pim/tasks';
import type { PimPrefsView } from '../core/pim/prefs';
import type { Account, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Reminder, WorldClock } from '../core/pim/types';
import { suggest } from '../core/pim/vcard';
import { buildCalendarStatus, upcomingFrom } from '../core/pim/week-events';
import type { SystemAccess } from '../core/pim/syscal';
import { extendTimer } from '../core/widget-timer';
import { importSummary } from '../core/pim/mail-import';
import { AREA_NOUN, sourcesFor, IMPORT_SOURCES, type ImportResult } from '../core/pim/import-flow';

type Emit = (channel: string, ...args: unknown[]) => void;

export function mockPim(emit: Emit): { pim: PimApi } {
  const imports: ImportResult[] = [];
  const now = Date.now();
  const day = 86_400_000;
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date(now + dayOffset * day);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const accounts: Account[] = [
    { id: 'work', kind: 'imap', label: 'Work', email: 'alex@studio.example', identities: [{ name: 'Alex Rivera', email: 'alex@studio.example', signature: 'Alex Rivera · Studio North' }], imap: { host: 'imap.studio.example', port: 993, security: 'tls' }, smtp: { host: 'smtp.studio.example', port: 587, security: 'starttls' }, mail: true, calendar: true, contacts: true, color: '#0a84ff' },
    { id: 'home', kind: 'google', label: 'alex.rivera@gmail.com', email: 'alex.rivera@gmail.com', identities: [{ name: 'Alex Rivera', email: 'alex.rivera@gmail.com' }], oauth: 'google', mail: true, calendar: true, contacts: false, color: '#ff375f' },
  ];
  const folders: MailFolder[] = [
    { account: 'work', path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 3, total: 9 },
    { account: 'work', path: 'Sent', name: 'Sent', special: 'sent', unread: 0, total: 2 },
    { account: 'work', path: 'Drafts', name: 'Drafts', special: 'drafts', unread: 0, total: 0 },
    { account: 'work', path: 'Archive', name: 'Archive', special: 'archive', unread: 0, total: 0 },
    { account: 'work', path: 'Clients', name: 'Clients', unread: 0, total: 1 },
    { account: 'work', path: 'Trash', name: 'Trash', special: 'trash', unread: 0, total: 0 },
    { account: 'home', path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 2, total: 5 },
    { account: 'home', path: '[Gmail]/Sent Mail', name: 'Sent Mail', special: 'sent', unread: 0, total: 0 },
    { account: 'home', path: '[Gmail]/Trash', name: 'Trash', special: 'trash', unread: 0, total: 0 },
  ];
  let uid = 100;
  const mk = (account: string, folder: string, o: Partial<MessageSummary> & { subject: string; from: { name?: string; address: string }; date: number }, body: { html?: string; text: string; attachments?: OpenMessage['attachments']; invite?: CalEvent; unsub?: boolean }): MessageSummary => {
    const id = `${account}:${folder}:${++uid}`;
    const m: MessageSummary = { id, account, folder, uid, to: [{ name: 'Alex Rivera', address: account === 'work' ? 'alex@studio.example' : 'alex.rivera@gmail.com' }], cc: [], seen: true, flagged: false, answered: false, snippet: body.text.replace(/\s+/g, ' ').slice(0, 140), hasAttachments: !!body.attachments?.length, messageId: `${uid}@demo`, ...o };
    bodies.set(id, body);
    return m;
  };
  const bodies = new Map<string, { html?: string; text: string; attachments?: OpenMessage['attachments']; invite?: CalEvent; unsub?: boolean }>();
  const ana = { name: 'Ana Lopez', address: 'ana@lopez-design.example' };
  const sam = { name: 'Sam Okafor', address: 'sam@studio.example' };
  const kickoff: CalEvent = { id: 'invite:kick', calendar: 'invite', uid: 'kickoff-42@studio.example', title: 'Website kickoff', start: at(2, 10), end: at(2, 11), allDay: false, location: 'https://meet.google.com/abc-defg-hij', organizer: { email: sam.address, name: sam.name }, attendees: [{ email: 'alex@studio.example', name: 'Alex Rivera', status: 'needs-action' }, { email: ana.address, name: ana.name, status: 'accepted' }] };
  const messages: MessageSummary[] = [
    mk('work', 'INBOX', { subject: 'Homepage drafts — round 2', from: ana, date: now - 25 * 60_000, seen: false, messageId: 'home-2@lopez', inReplyTo: 'home-1@studio', references: ['home-1@lopez', 'home-1@studio'], hasAttachments: true }, {
      text: 'Hi Alex,\n\nHere are the updated homepage drafts with the bigger hero image and the new type. I kept the old layout as option B.\n\nCould you send feedback by Thursday?\n\nThanks,\nAna',
      html: '<p>Hi Alex,</p><p>Here are the updated homepage drafts with the <b>bigger hero image</b> and the new type. I kept the old layout as option B.</p><p><img data-blocked-src="https://cdn.lopez-design.example/preview.png" alt="Preview of the homepage" width="520"></p><p>Could you send feedback by <b>Thursday</b>?</p><p>Thanks,<br>Ana</p>',
      attachments: [{ id: '0', filename: 'Homepage-v2.pdf', contentType: 'application/pdf', size: 2_400_000 }, { id: '1', filename: 'hero.jpg', contentType: 'image/jpeg', size: 820_000 }],
    }),
    mk('work', 'Sent', { subject: 'Re: Homepage drafts', from: { name: 'Alex Rivera', address: 'alex@studio.example' }, to: [ana], date: now - 2 * day, messageId: 'home-1@studio', inReplyTo: 'home-1@lopez' }, { text: 'Looks great! Two small notes: bigger hero image, and could we try the new type?' }),
    mk('work', 'INBOX', { subject: 'Homepage drafts', from: ana, date: now - 3 * day, messageId: 'home-1@lopez' }, { text: 'Hi Alex, first drafts of the homepage attached. Let me know what you think!' }),
    mk('work', 'INBOX', { subject: 'Invitation: Website kickoff', from: sam, date: now - 3 * 3_600_000, seen: false }, { text: 'Sam Okafor invited you to Website kickoff.', invite: kickoff }),
    mk('work', 'INBOX', { subject: 'Invoice #4471 from Acme Hosting', from: { name: 'Acme Hosting', address: 'billing@acme-hosting.example' }, date: now - 5 * 3_600_000, seen: false, hasAttachments: true }, { text: 'Your invoice for October is ready. Amount due: €42.00 by 15 November.', attachments: [{ id: '0', filename: 'invoice-4471.pdf', contentType: 'application/pdf', size: 88_000 }] }),
    mk('work', 'INBOX', { subject: 'Design Weekly: 12 type pairings for 2026', from: { name: 'Design Weekly', address: 'news@designweekly.example' }, date: now - 9 * 3_600_000, bulk: true, listId: 'weekly.designweekly.example', unsub: { url: 'https://designweekly.example/u', oneClick: true } }, {
      text: 'This week: type pairings, a new colour tool and an interview.',
      html: '<table width="100%" style="background:#f4f1ea"><tr><td style="padding:24px"><h2 style="font-family:Georgia">12 type pairings for 2026</h2><img data-blocked-src="https://img.designweekly.example/cover.jpg" width="560" alt="Cover"><p>This week: type pairings, a new colour tool and an interview with a studio in Lisbon.</p><a href="https://designweekly.example/issue/88" title="https://designweekly.example/issue/88" target="_blank">Read the issue</a></td></tr></table>',
      unsub: true,
    }),
    mk('work', 'Clients', { subject: 'Contract signed', from: { name: 'Lena Fischer', address: 'lena@brightside.example' }, date: now - 6 * day, flagged: true }, { text: 'Signed contract attached. Looking forward to starting!' }),
    mk('home', 'INBOX', { subject: 'Saturday hike?', from: { name: 'Jordan', address: 'jordan@example.net' }, date: now - 50 * 60_000, seen: false }, { text: 'Hey! Want to do the coast trail on Saturday? Meet at 8:30 at the station?' }),
    mk('home', 'INBOX', { subject: 'Your flight to Lisbon is confirmed', from: { name: 'Skyway Airlines', address: 'noreply@skyway.example' }, date: now - day, seen: false, flagged: true }, { text: 'Booking ABC123. Departure 12 March 07:40, arrival 10:15. Return 15 March 18:20.' }),
    mk('home', 'INBOX', { subject: 'Book club — next title', from: { name: 'Priya', address: 'priya@example.org' }, date: now - 2 * day }, { text: 'We picked the next book! See you on the 20th.' }),
    // A security alert: always Important.
    mk('home', 'INBOX', { subject: 'New sign-in to your account', from: { name: 'Cloudbox', address: 'no-reply@accounts.cloudbox.example' }, date: now - 12 * 60_000, seen: false, bulk: true }, { text: 'We noticed a new sign-in to your Cloudbox account from Firefox on Linux in Lisbon, Portugal. If this was you, you can ignore this message.' }),
    // Newsletters and shops: Other, and the cleanup list.
    ...[3, 10, 17, 24].map((d, i) => mk('work', 'INBOX', { subject: ['Spring sale: 30% off everything', 'New arrivals you will love', 'Last chance: free shipping ends tonight', 'Your weekly picks'][i], from: { name: 'Northwind Store', address: 'offers@northwind-store.example' }, date: now - d * day - 3_600_000, seen: i === 3, bulk: true, listId: 'offers.northwind-store.example', unsub: { url: 'https://northwind-store.example/u', oneClick: true } }, { text: 'Fresh picks for you this week.', unsub: true })),
    ...[1, 8, 15].map((d, i) => mk('home', 'INBOX', { subject: ['Your daily digest', 'Trending this week in Photography', 'You have 4 new notifications'][i], from: { name: 'Pixelboard', address: 'digest@pixelboard.example' }, date: now - d * day - 7_200_000, seen: false, bulk: true, unsub: { url: 'https://pixelboard.example/u', oneClick: false } }, { text: 'See what people are sharing.', unsub: true })),
    mk('work', 'INBOX', { subject: 'Your order has shipped', from: { name: 'Paperworks', address: 'orders@paperworks.example' }, date: now - 30 * 3_600_000, seen: false }, { text: 'Your order #20931 is on its way and should arrive Friday.' }),
    // Sent mail still waiting for an answer.
    mk('work', 'Sent', { subject: 'Quote for the brand refresh', from: { name: 'Alex Rivera', address: 'alex@studio.example' }, to: [{ name: 'Lena Fischer', address: 'lena@brightside.example' }], date: now - 5 * day, messageId: 'quote-1@studio' }, { text: 'Hi Lena, here is our quote for the brand refresh. Could you let me know by Friday if the timeline works for you?' }),
    mk('work', 'Sent', { subject: 'Studio photos for the case study?', from: { name: 'Alex Rivera', address: 'alex@studio.example' }, to: [sam], date: now - day - 4 * 3_600_000, messageId: 'photos-1@studio' }, { text: 'Hey Sam, do you still have the studio photos from the launch? I would like to use two in the case study.' }),
    mk('home', '[Gmail]/Sent Mail', { subject: 'Dinner on the 14th?', from: { name: 'Alex Rivera', address: 'alex.rivera@gmail.com' }, to: [{ name: 'Marta', address: 'marta@example.net' }], date: now - 9 * day, messageId: 'dinner-1@gmail' }, { text: 'Marta! Are you free for dinner on the 14th? Thinking of the new place by the river.' }),
  ];
  const me = ['alex@studio.example', 'alex.rivera@gmail.com'];
  const sentFolders = new Set(['Sent', '[Gmail]/Sent Mail']);
  const triaged = (list: MessageSummary[]) => {
    const ctx = triageContext({ me, sent: messages.filter((m) => sentFolders.has(m.folder)), contacts: contacts.flatMap((c) => c.emails), important: prefs.importantSenders, other: prefs.otherSenders });
    return list.map((m) => { const t = classify(m, ctx); return { ...m, category: t.category, security: t.security || undefined }; });
  };
  let dismissed: string[] = [];
  // ?calaccess=notDetermined|denied|writeOnly in the browser preview shows the "can't see your calendars" row.
  let sysRaw = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('calaccess')) || 'granted';
  const sysAccess = (): SystemAccess => (sysRaw === 'granted'
    ? { state: 'granted', via: 'files', canRequest: false, message: 'In the browser preview the computer’s calendars are pretend ones.' }
    : { state: sysRaw === 'notDetermined' ? 'notDetermined' : 'denied', via: 'eventkit', raw: sysRaw, canRequest: sysRaw === 'notDetermined', message: sysRaw === 'notDetermined' ? 'Allow calendar access to see the calendars of the Calendar app here (iCloud, Google, Exchange and others).' : 'Calendar access was not allowed. Turn on Keeper in System Settings → Privacy & Security → Calendars.' });
  const calendars: CalendarInfo[] = [
    { id: 'local:calendar', account: 'local', name: 'On this computer', color: '#bf5af2', url: '', readOnly: false, visible: true, tasks: true },
    { id: 'work:cal', account: 'work', name: 'Work', color: '#0a84ff', url: 'https://dav.studio.example/cal/work/', readOnly: false, visible: true },
    { id: 'home:cal', account: 'home', name: 'Personal', color: '#ff375f', url: 'https://apidata.googleusercontent.com/caldav/v2/alex/', readOnly: false, visible: true },
    { id: 'hol:cal', account: 'hol', name: 'Holidays', color: '#30d158', url: 'https://example.org/holidays.ics', readOnly: true, visible: true },
  ];
  const ev = (calendar: string, title: string, start: number, end: number, extra: Partial<CalEvent> = {}): CalEvent => {
    const u = `${title.replace(/\W+/g, '-')}-${start}`;
    return { id: `${calendar}:${u}`, calendar, uid: u, title, start, end, allDay: false, alarms: [{ minutesBefore: 10 }], ...extra };
  };
  const mon = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();
  const wk = (dow: number, h: number, m = 0) => mon + dow * day + (h * 60 + m) * 60_000;
  let events: CalEvent[] = [
    ev('work:cal', 'Standup', wk(0, 9, 15), wk(0, 9, 30), { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', location: 'https://meet.google.com/xyz-abcd-efg' }),
    ev('work:cal', 'Design review', wk(1, 14), wk(1, 15, 30), { location: 'Room 3' }),
    ev('work:cal', 'Lunch with Ana', wk(2, 12, 30), wk(2, 13, 30), { location: 'Café Sol' }),
    ev('work:cal', 'Website kickoff', at(2, 10), at(2, 11), { location: 'https://meet.google.com/abc-defg-hij' }),
    ev('work:cal', 'Quarterly planning', wk(3, 10), wk(3, 12)),
    ev('home:cal', 'Gym', wk(0, 18), wk(0, 19), { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }),
    ev('home:cal', 'Coast trail hike', wk(5, 8, 30), wk(5, 13)),
    ev('home:cal', 'Book club', wk(4, 19), wk(4, 21), { location: 'Priya’s' }),
    ev('home:cal', 'Lisbon trip', mon + 13 * day, mon + 16 * day, { allDay: true, alarms: undefined }),
    ev('hol:cal', 'Public holiday', mon + 10 * day, mon + 11 * day, { allDay: true, alarms: undefined }),
    ev('local:calendar', 'Dentist', at(1, 16), at(1, 16, 45), { location: 'Dr. Mendes' }),
  ];
  let log: LogEntry[] = [];
  let reminders: Reminder[] = [
    { id: 'local:r1', list: 'local', title: 'Pay hosting invoice', due: at(1, 9), done: false, priority: 3 },
    { id: 'local:r2', list: 'local', title: 'Send homepage feedback to Ana', due: at(2, 12), done: false, priority: 2 },
    { id: 'local:r3', list: 'local', title: 'Book a table for Friday', done: false },
    { id: 'local:r4', list: 'local', title: 'Renew passport', notes: 'Photo booth at the station', due: at(10, 9), done: false, priority: 1 },
    { id: 'local:r5', list: 'local', title: 'Back up the laptop', done: true, doneAt: now - day },
  ];
  let alarms: Alarm[] = [
    { id: 'a1', label: 'Wake up', time: '07:00', days: [1, 2, 3, 4, 5], enabled: true, sound: 'chime', snoozeMin: 9 },
    { id: 'a2', label: 'Weekend', time: '09:00', days: [0, 6], enabled: false, sound: 'bell', snoozeMin: 10 },
    { id: 'a3', label: 'Take the bins out', time: '20:30', days: [2], enabled: true, sound: 'beep', snoozeMin: 5 },
  ];
  let timers: CountdownTimer[] = [{ id: 't1', label: 'Pasta', durationMs: 10 * 60_000, endsAt: now + 6 * 60_000 + 12_000 }];
  let clocks: WorldClock[] = [{ zone: 'America/New_York', label: 'New York' }, { zone: 'Europe/Lisbon', label: 'Lisbon' }, { zone: 'Asia/Tokyo', label: 'Tokyo' }];
  const contacts: Contact[] = [
    { id: 'c1', account: 'work', name: 'Ana Lopez', emails: [ana.address], phones: ['+351 21 000 0000'], org: 'Lopez Design' },
    { id: 'c2', account: 'work', name: 'Sam Okafor', emails: [sam.address], phones: [], org: 'Studio North' },
    { id: 'c3', account: 'work', name: 'Lena Fischer', emails: ['lena@brightside.example'], phones: [], org: 'Brightside' },
  ];
  let rules: MailRule[] = [{ id: 'r1', name: 'Invoices', enabled: true, when: [{ field: 'subject', contains: 'invoice' }], then: { action: 'label', label: 'Invoices' } }];
  let noReply: NoReplyReminder[] = [];
  let prefs: PimPrefsView = { notifyPreviews: true, notifyMail: true, undoSendSec: 10, trustedSenders: [], defaultAlertMin: 10, weekStart: 1, showWeekNumbers: false };
  const outbox: (Outbox & { draft: Draft })[] = [];
  const fired = new Set<string>();
  const changed = (k: string) => emit('pim-changed', k);
  const ring = (r: Ring) => emit('pim-ring', r);

  // A small clock so timers and alarms ring in the demo too.
  setInterval(() => {
    const t = Date.now();
    const r = dueNow({ alarms, occurrences: occurrences(events, t - 20 * 60_000, t + day), reminders, timers, fired }, t - 2000, t);
    for (const d of r.due) {
      fired.add(dueKey(d));
      if (d.kind === 'timer') timers = timers.filter((x) => x.id !== d.id);
      ring(d.kind === 'event' ? { kind: 'event', id: d.id, title: d.title, at: d.at, late: d.late, start: d.start, location: d.location, url: d.url } : { kind: d.kind, id: d.id, title: d.title, at: d.at, late: d.late });
      changed('alarms');
    }
  }, 1000);

  const pim: PimApi = {
    accounts: async () => accounts,
    discover: async (email) => (email.endsWith('@gmail.com') ? { provider: 'Google', oauth: 'google' } : { provider: email.split('@')[1], imap: { host: `imap.${email.split('@')[1]}`, port: 993, security: 'tls', user: email }, smtp: { host: `smtp.${email.split('@')[1]}`, port: 587, security: 'starttls', user: email } }),
    testAccount: async () => ({ ok: true, message: 'Mail: connected, sending: works, 2 calendars' }),
    addAccount: async (a) => {
      const n: Account = { id: `acc${accounts.length}`, kind: a.kind, label: a.label ?? a.email ?? 'Account', email: a.email, identities: a.email ? [{ name: a.name ?? 'Me', email: a.email }] : [], mail: a.kind === 'imap', calendar: true, contacts: false };
      accounts.push(n);
      changed('accounts');
      return n;
    },
    signIn: async () => { throw new Error('The demo has no sign-in'); },
    cancelSignIn: async () => undefined,
    updateAccount: async (id, patch) => { const a = accounts.find((x) => x.id === id)!; Object.assign(a, patch); changed('accounts'); return a; },
    removeAccount: async (id) => { accounts.splice(accounts.findIndex((x) => x.id === id), 1); changed('accounts'); },
    oauthReady: async () => ({ google: false, microsoft: false }),

    folders: async () => folders.map((f) => ({ ...f, unread: messages.filter((m) => m.account === f.account && m.folder === f.path && !m.seen).length, total: messages.filter((m) => m.account === f.account && m.folder === f.path).length })),
    messages: async (v: MailView) => {
      const t = Date.now();
      let list = v.folder === 'unified' ? messages.filter((m) => m.folder === 'INBOX' && (!v.account || m.account === v.account))
        : v.folder === 'unified:sent' ? messages.filter((m) => sentFolders.has(m.folder))
          : v.folder === 'snoozed' ? messages.filter((m) => isSnoozed(m, t))
            : v.folder === 'search' ? [...messages]
              : v.folder.startsWith('label:') ? messages.filter((m) => (m.labels ?? []).some((x) => x.toLowerCase() === v.folder.slice(6).toLowerCase()))
              : messages.filter((m) => m.account === v.account && m.folder === v.folder);
      const smart = v.folder.startsWith('smart:') ? (prefs.smartMailboxes ?? []).find((x) => x.id === v.folder.slice(6)) : undefined;
      if (v.folder === 'toreply') list = messages.filter((m) => m.folder === 'INBOX');
      if (smart) { const q = parseMailQuery(smart.query); list = messages.filter((m) => matchMailQuery(m, q)); }
      if (v.folder !== 'snoozed') list = list.filter((m) => !isSnoozed(m, t));
      list = triaged(list).filter((m) => !isBlocked(m.from, prefs.blockedSenders ?? []));
      if (v.folder === 'toreply') list = toReply(list, me, t, { sent: messages.filter((m) => sentFolders.has(m.folder)) });
      let counts: { important: number; other: number; all?: number; updates?: number; promos?: number } | undefined;
      if ((v.folder === 'unified' || v.folder === 'INBOX') && prefs.splitInbox !== false) {
        const c = tabCounts(list);
        counts = { important: c.important, other: c.updates + c.promos, all: c.all, updates: c.updates, promos: c.promos };
        if (v.tab && v.tab !== 'all') list = list.filter((m) => inTab(m, v.tab));
        else if (!v.tab && v.split) list = list.filter((m) => inTab(m, v.split === 'important' ? 'important' : 'other'));
      }
      if (v.filter === 'unread') list = list.filter((m) => !m.seen);
      if (v.filter === 'flagged') list = list.filter((m) => m.flagged);
      if (v.filter === 'attachments') list = list.filter((m) => m.hasAttachments);
      if (v.query) { const exact = list.filter((m) => matchesQuery(m, v.query!)); list = exact.length || v.folder !== 'search' ? exact : pickForQuestion(v.query, list.filter((m) => !m.security), 50); }
      list = [...list].sort((a, b) => sortTime(b, t) - sortTime(a, t));
      return { messages: list, counts, threads: v.threaded ? threadMessages(v.folder === 'unified' ? [...list, ...messages.filter((m) => m.folder === 'Sent' && list.some((x) => x.references?.includes(m.messageId!)))] : list) : undefined };
    },
    searchServer: async (q) => { await new Promise((r) => setTimeout(r, 900)); return /lisbon|flight/i.test(q) ? triaged([{ id: 'home:[Gmail]/All Mail:9', account: 'home', folder: '[Gmail]/All Mail', uid: 9, subject: 'Lisbon apartment — booking confirmed', from: { name: 'Stayfinder', address: 'bookings@stayfinder.example' }, to: [], cc: [], date: now - 40 * day, seen: true, flagged: false, answered: false, snippet: 'Your stay in Alfama, 12–15 March, is confirmed.', hasAttachments: false }]) : []; },
    waiting: async () => waitingForReply(messages, me, Date.now(), { dismissed }).map((w) => ({ message: w.message, days: w.days, to: w.to, count: w.thread.messages.length, overdue: w.days >= (prefs.followUpDays ?? 3) })),
    followUp: async (id) => { const m = messages.find((x) => x.id === id)!; return { ...followUpDraft({ ...m, text: bodies.get(id)?.text }, me), account: m.account }; },
    dismissWaiting: async (id) => { dismissed.push(messages.find((x) => x.id === id)?.messageId ?? id); changed('mail'); },
    subscriptions: async () => subscriptions(messages.filter((m) => m.folder === 'INBOX' || m.folder === 'Archive'), me).map((x) => ({ key: x.key, name: x.name, address: x.address, count: x.count, opened: x.opened, last: x.last, canUnsubscribe: !!x.unsub, neverOpened: x.neverOpened })),
    cleanup: async (key, action) => {
      const sub = subscriptions(messages.filter((m) => m.folder === 'INBOX'), me).find((x) => x.key === key);
      if (!sub) return { how: 'Nothing left', moved: 0 };
      if (action !== 'unsubscribe') for (const m of messages) if (sub.ids.includes(m.id)) m.folder = action === 'trash' ? 'Trash' : 'Archive';
      if (action !== 'trash') prefs.otherSenders = [...(prefs.otherSenders ?? []), sub.address];
      changed('mail');
      const moved = action === 'unsubscribe' ? 0 : sub.ids.length;
      return { how: [action === 'unsubscribe' || action === 'both' ? 'Unsubscribed' : '', moved ? `${moved} messages ${action === 'trash' ? 'deleted' : 'archived'}` : ''].filter(Boolean).join(' · '), moved };
    },
    setCategory: async (address, category) => {
      prefs.importantSenders = (prefs.importantSenders ?? []).filter((x) => x !== address);
      prefs.otherSenders = (prefs.otherSenders ?? []).filter((x) => x !== address);
      (category === 'important' ? (prefs.importantSenders ??= []) : (prefs.otherSenders ??= [])).push(address);
      changed('mail');
    },
    unsnooze: async (ids) => { for (const m of messages) if (ids.includes(m.id)) { m.snoozedUntil = undefined; m.returnedAt = Date.now(); } changed('mail'); },
    write: async (text, task) => { await new Promise((r) => setTimeout(r, 600)); return task === 'shorter' ? text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : task === 'professional' ? text.replace(/^Hey\b/, 'Hello').replace(/Thanks!?/, 'Kind regards,') : task === 'friendly' ? `${text}\n\nHope you are having a great week!` : text; },
    askMail: async (q) => { await new Promise((r) => setTimeout(r, 800)); const src = pickForQuestion(q, triaged(messages).filter((m) => !m.security), 3); return { answer: /flight|lisbon/i.test(q) ? 'Your flight to Lisbon leaves on 12 March at 07:40 and lands at 10:15; the return is on 15 March at 18:20 (booking ABC123) [1].' : src.length ? `The closest match is “${src[0].subject}” from ${src[0].from?.name} [1].` : 'Nothing in your mail matches that.', sources: src }; },
    refresh: async () => { await new Promise((r) => setTimeout(r, 400)); changed('mail'); },
    older: async () => undefined,
    open: async (id, opts) => {
      const m = messages.find((x) => x.id === id)!;
      const b = bodies.get(id)!;
      if (opts?.markRead !== false && !m.seen) { m.seen = true; changed('mail'); }
      const blocked = (b.html?.match(/data-blocked-src/g) ?? []).length;
      const html = (b.html ?? `<div style="white-space:pre-wrap">${b.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).replace(/data-blocked-src="([^"]+)"/g, opts?.allowRemote ? 'src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22520%22 height=%22200%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23d9d4ff%22/%3E%3C/svg%3E"' : 'data-blocked-src="$1"');
      const warnings = phishingWarnings({ from: m.from, links: b.html ? linksIn(b.html) : [], contacts: [], knownDomains: ['studio.example', 'gmail.com'] });
      const code = extractCode(`${m.subject}\n${b.text}`);
      return { summary: m, html, text: b.text, blocked: opts?.allowRemote ? 0 : blocked, trackers: b.unsub ? 2 : 0, attachments: b.attachments ?? [], invite: b.invite ? { method: 'REQUEST', event: b.invite, mine: 'needs-action' } : undefined, unsubscribe: b.unsub ? { url: 'https://designweekly.example/u', oneClick: true } : undefined, headers: {}, warnings: warnings.length ? warnings : undefined, code, signInLink: code ? undefined : extractSignInLink(b.text, b.html), designed: b.html ? isDesignedMail(b.html) : false, remindAt: noReply.find((r) => r.id === id)?.at };
    },
    setRead: async (ids, read) => { for (const m of messages) if (ids.includes(m.id)) m.seen = read; changed('mail'); },
    setFlagged: async (ids, f) => { for (const m of messages) if (ids.includes(m.id)) m.flagged = f; changed('mail'); },
    move: async (ids, folder) => { for (const m of messages) if (ids.includes(m.id)) m.folder = folder; changed('mail'); },
    archive: async (ids) => { for (const m of messages) if (ids.includes(m.id)) m.folder = 'Archive'; changed('mail'); },
    trash: async (ids) => { for (const m of messages) if (ids.includes(m.id)) m.folder = 'Trash'; changed('mail'); },
    junk: async () => undefined,
    snooze: async (ids, until) => { for (const m of messages) if (ids.includes(m.id)) { m.snoozedUntil = until; m.returnedAt = undefined; } changed('mail'); },
    saveAttachment: async (_id, att) => `/Users/demo/Downloads/${att}`,
    openAttachment: async () => undefined,
    unsubscribe: async () => ({ done: true, how: 'Unsubscribed' }),
    trustSender: async (a) => { prefs.trustedSenders.push(a); },
    draftFor: async (id, mode) => { const m = messages.find((x) => x.id === id)!; return makeReply({ original: { ...m, text: bodies.get(id)?.text }, me: ['alex@studio.example', 'alex.rivera@gmail.com'], mode }); },
    send: async (d) => { const o = { id: String(Date.now()), sendAt: d.sendAt ?? Date.now() + prefs.undoSendSec * 1000, subject: d.subject, draft: d, scheduled: !!d.sendAt && d.sendAt - Date.now() > 60_000 }; outbox.push(o); changed('outbox'); setTimeout(() => { const i = outbox.indexOf(o); if (i >= 0) { outbox.splice(i, 1); messages.push(mk(d.account, d.account === 'work' ? 'Sent' : '[Gmail]/Sent Mail', { subject: d.subject, from: { name: 'Alex Rivera', address: accounts.find((a) => a.id === d.account)?.email ?? '' }, to: d.to, date: Date.now() }, { text: d.body })); changed('outbox'); changed('mail'); } }, Math.min(o.sendAt - Date.now(), 2_000_000_000)); return { id: o.id, sendAt: o.sendAt, subject: o.subject, scheduled: o.scheduled }; },
    undoSend: async (id) => { const i = outbox.findIndex((x) => x.id === id); if (i < 0) return null; const [o] = outbox.splice(i, 1); changed('outbox'); return o.draft; },
    outbox: async () => outbox.map(({ draft: _d, ...o }) => o),
    saveDraft: async () => undefined,
    suggest: async (q) => suggest(contacts, [], q),
    ai: async (_id, task) => {
      await new Promise((r) => setTimeout(r, 700));
      if (task === 'summarize') return { text: '• Ana sent round 2 of the homepage drafts: bigger hero image, new type.\n• The old layout is kept as option B.\n• She needs your feedback by Thursday.' };
      if (task === 'reply') return { text: 'Hi Ana,\n\nThanks — these look great. I prefer the new type; let’s go with option A. I’ll send detailed notes by Thursday.\n\nAlex' };
      if (task === 'replies') {
        const options = ['Hi Ana,\n\nThese look great — let’s go with option A and the new type. Detailed notes coming by Thursday.\n\nAlex', 'Hi Ana,\n\nLooks good! Before I decide: could we see the bigger hero with the old layout too? Happy to jump on a quick call.\n\nAlex', 'Hi Ana,\n\nThanks for these. I’m swamped this week, so feedback will come early next week — hope that still works.\n\nAlex'];
        return { text: options[0], options };
      }
      if (task === 'translate') return { text: 'Hola Alex:\n\nAquí tienes los bocetos actualizados de la página de inicio, con la imagen principal más grande y la nueva tipografía. Mantuve el diseño anterior como opción B.\n\n¿Podrías enviarme tus comentarios antes del jueves?\n\nGracias,\nAna' };
      return { text: 'EVENT: Feedback due Thursday 5pm', events: [parseQuickAdd('Homepage feedback due Thursday 5pm')!] };
    },
    respond: async () => { changed('calendar'); },
    rules: async () => rules,
    saveRules: async (r) => { rules = r; },
    pickFiles: async () => ['/Users/demo/Documents/brief.pdf'],

    calendars: async () => calendars,
    setCalendar: async (id, patch) => { Object.assign(calendars.find((c) => c.id === id)!, patch); changed('calendar'); },
    occurrences: async (from, to) => occurrences(events.filter((e) => calendars.find((c) => c.id === e.calendar)?.visible), from, to),
    saveEvent: async (e, opts) => {
      const uidv = e.uid || `ev-${Date.now()}`;
      const next = { ...e, uid: uidv, id: `${e.calendar}:${uidv}` };
      if (opts?.scope === 'this' && opts.instance !== undefined) events.push({ ...next, rrule: undefined, recurrenceId: opts.instance, id: `${next.id}:${opts.instance}` });
      else events = [...events.filter((x) => x.uid !== uidv || x.recurrenceId !== undefined), next];
      changed('calendar');
      return next;
    },
    deleteEvent: async (id, opts) => {
      const e = events.find((x) => x.id === id);
      if (e && opts?.scope === 'this' && e.rrule && opts.instance !== undefined) e.exdates = [...(e.exdates ?? []), opts.instance];
      else events = events.filter((x) => x.id !== id);
      changed('calendar');
    },
    quickAdd: async (text, calendar) => {
      const q = parseQuickAdd(text);
      if (!q) return null;
      return pim.saveEvent({ id: '', uid: '', calendar: calendar ?? 'local:calendar', title: q.title, start: q.start, end: q.end, allDay: q.allDay, rrule: q.rrule, location: q.location, alarms: q.allDay ? undefined : [{ minutesBefore: q.alarm ?? 10 }] });
    },
    parseQuick: async (t) => parseQuickAdd(t),
    subscribe: async (url, name) => { const c: CalendarInfo = { id: `sub${calendars.length}`, account: 'sub', name: name ?? url, color: '#ffd60a', url, readOnly: true, visible: true }; calendars.push(c); changed('calendar'); return c; },
    importIcs: async () => 0,
    exportIcs: async () => '/Users/demo/Downloads/Work.ics',
    syncCalendars: async () => { await new Promise((r) => setTimeout(r, 500)); },
    systemAccess: async (request) => {
      if (request && sysRaw === 'notDetermined') sysRaw = 'granted';
      return sysAccess();
    },
    upcomingEvents: async (from, to, o) => upcomingFrom(occurrences(events, from, to), calendars, accounts, o),
    calendarStatus: async () => buildCalendarStatus({ platform: sysRaw === 'granted' ? 'linux' : 'darwin', system: sysAccess(), calendars, accounts }),
    openCalendarSources: async () => undefined,
    watchCalendar: async () => undefined,
    openEvent: async () => undefined,

    reminders: async () => reminders,
    saveReminder: async (r) => {
      let n: Reminder = { ...r, id: r.id || `local:${Date.now()}`, list: r.list || 'local', created: r.created ?? Date.now() };
      const prev = reminders.find((x) => x.id === n.id);
      if (n.done && !prev?.done) { n = completeTask({ ...n, done: false }).task; log = addLog(log, { kind: 'task', at: Date.now(), taskId: n.id, title: n.title }); }
      reminders = [...reminders.filter((x) => x.id !== n.id), n]; changed('reminders'); return n;
    },
    deleteReminder: async (id) => { reminders = reminders.filter((x) => x.id !== id); changed('reminders'); },
    completeReminder: async (id, done = true) => { const t = reminders.find((x) => x.id === id); return t ? pim.saveReminder(done ? { ...t, done: true } : { ...t, done: false, doneAt: undefined }) : null; },
    snoozeReminder: async (id, minutes) => { reminders = reminders.map((x) => (x.id === id ? { ...x, remindAt: Date.now() + minutes * 60_000 } : x)); changed('reminders'); },
    moveTasks: async (ids, day) => { reminders = reminders.map((x) => (ids.includes(x.id) ? moveToDay(x, day) : x)); changed('reminders'); },
    reorderTasks: async (order) => { const m = new Map(order.map((o) => [o.id, o.order])); reminders = reminders.map((x) => (m.has(x.id) ? { ...x, order: m.get(x.id) } : x)); changed('reminders'); },
    insights: async () => insights(log),
    dueReminders: async () => [],

    alarms: async () => { const t = Date.now(); const ns = alarms.map((a) => nextAlarmTime(a, t)).filter((x): x is number => x !== undefined); return { alarms, timers, clocks, next: ns.length ? Math.min(...ns) : undefined }; },
    saveAlarm: async (a) => { const n = { ...a, id: a.id || `a${Date.now()}` }; alarms = [...alarms.filter((x) => x.id !== n.id), n]; changed('alarms'); return n; },
    deleteAlarm: async (id) => { alarms = alarms.filter((x) => x.id !== id); changed('alarms'); },
    snoozeAlarm: async (id) => { emit('pim-ring-stop', id); },
    stopRinging: async (id) => { emit('pim-ring-stop', id); },
    startTimer: async (label, ms) => { const t = { id: `t${Date.now()}`, label, durationMs: ms, endsAt: Date.now() + ms }; timers.push(t); changed('alarms'); return t; },
    timerAction: async (id, action) => {
      const t = timers.find((x) => x.id === id);
      if (!t) return;
      if (action === 'pause' && t.endsAt) { t.leftMs = t.endsAt - Date.now(); t.endsAt = undefined; }
      if (action === 'resume' && !t.endsAt) { t.endsAt = Date.now() + (t.leftMs ?? t.durationMs); t.leftMs = undefined; }
      if (action === 'restart') { t.endsAt = Date.now() + t.durationMs; t.leftMs = undefined; }
      if (action === 'cancel') timers = timers.filter((x) => x.id !== id);
      if (action === 'extend') Object.assign(t, extendTimer(t));
      changed('alarms');
    },
    saveClocks: async (c) => { clocks = c; changed('alarms'); },
    scheduleWake: async () => ({ ok: false, message: 'Not in the demo' }),

    contacts: async () => contacts,
    saveContact: async (c) => c,
    deleteContact: async () => undefined,
    search: async (q, o) => {
      const pq = parseMailQuery(q);
      const local = triaged(messages).filter((m) => matchMailQuery(m, pq) && (!o?.account || m.account === o.account));
      const all = orderResults(local, []);
      return { messages: all.slice(0, o?.limit ?? 500), local: Math.min(all.length, o?.limit ?? 500) };
    },
    unreadCounts: async () => { const inbox = triaged(messages.filter((m) => m.folder === 'INBOX')); return { byAccount: unreadByAccount(inbox), all: badgeCount(inbox, 'all'), important: badgeCount(inbox, 'important'), labels: labelCounts(messages) }; },
    dismissToReply: async () => { changed('mail'); },
    remindNoReply: async (id, at) => { const m = messages.find((x) => x.id === id)!; noReply = noReply.filter((r) => r.id !== id); if (at !== null) noReply.push({ id, messageId: m.messageId ?? id, account: m.account, subject: m.subject, to: m.to, sentAt: m.date, at }); changed('mail'); },
    noReplyReminders: async () => noReply,
    mute: async (ids, on) => { if (on) for (const m of messages) if (ids.includes(m.id)) m.folder = 'Archive'; changed('mail'); },
    block: async (address, on) => { prefs.blockedSenders = on ? [...(prefs.blockedSenders ?? []), address.toLowerCase()] : (prefs.blockedSenders ?? []).filter((x) => x !== address.toLowerCase()); changed('mail'); },
    reportSpam: async (ids) => { for (const m of messages) if (ids.includes(m.id)) m.folder = 'Junk'; changed('mail'); },
    label: async (ids, label, on) => { for (const m of messages) if (ids.includes(m.id)) m.labels = on ? [...new Set([...(m.labels ?? []), label])] : (m.labels ?? []).filter((x) => x !== label); changed('mail'); },
    undo: async () => null,
    previewAttachment: async (_id, att) => ({ filename: att, contentType: 'text/plain', size: 120, text: 'A preview of the attachment, shown in Keeper.' }),
    printable: async (id) => `<!doctype html><title>${messages.find((x) => x.id === id)?.subject ?? ''}</title>${bodies.get(id)?.html ?? ''}`,
    savePdf: async () => '/Users/demo/Downloads/Message.pdf',
    syncServerRules: async () => accounts.filter((a) => a.mail).map((a) => ({ account: a.id, label: a.label, ok: true, message: 'Written to the server as a Sieve script' })),
    senderPhotos: async () => ({}),
    aiCompose: async (r) => { await new Promise((x) => setTimeout(x, 500)); return r.instruction ? `Hi,\n\n${r.instruction.replace(/^write\s+/i, '')}.\n\nBest,\nAlex` : r.draft; },
    stageCompose: async () => undefined,
    stagedCompose: async () => null,
    dropDraft: async () => undefined,
    importSources: async (area) => sourcesFor(area, 'darwin'),
    foundSources: async () => [{ source: 'thunderbird', ref: '/Users/demo/Library/Thunderbird/Profiles/abc.default', label: 'default', detail: 'Default profile' }, { source: 'apple-mail', ref: '/Users/demo/Library/Mail/V10', label: 'Apple Mail', detail: 'Mail’s folder (V10)' }],
    pickImport: async (source) => [`/Users/demo/Downloads/sample.${IMPORT_SOURCES.find((s) => s.id === source)?.extensions?.[0] ?? 'mbox'}`],
    runImport: async (req) => {
      const id = `imp-${Date.now()}`;
      const area = IMPORT_SOURCES.find((s) => s.id === req.source)!.area;
      for (let i = 0; i <= 10; i++) { emit('pim-import', { id, source: req.source, phase: i < 10 ? 'adding' : 'done', done: i * 42, total: 420, current: 'Inbox' }); await new Promise((r) => setTimeout(r, 120)); }
      const counts = { added: 420, skipped: 3, failed: 0, folders: area === 'mail' ? 4 : 1 };
      const r: ImportResult = { id, area, source: req.source, label: 'sample', at: Date.now(), ...counts, summary: importSummary(counts, AREA_NOUN[area]) };
      imports.unshift(r);
      return r;
    },
    cancelImport: async () => undefined,
    undoImport: async (id) => { const r = imports.find((x) => x.id === id); if (r) r.undone = true; return r ?? null; },
    importHistory: async () => imports,
    exportMail: async () => ({ path: '/Users/demo/Downloads/Inbox.mbox', count: 9 }),
    exportTasks: async () => ({ path: '/Users/demo/Downloads/Tasks.csv', count: 12 }),
    exportContacts: async () => ({ path: '/Users/demo/Downloads/Contacts.vcf', count: 4 }),
    prefs: async () => prefs,
    setPrefs: async (p) => (prefs = { ...prefs, ...p }),
  };
  return { pim };
}
