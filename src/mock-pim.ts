// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders and alarms for the browser demo: two accounts,
// a few conversations, a week of events, some to-dos, alarms and timers.

import type { MailView, OpenMessage, Outbox, PimApi, Ring } from '../core/api-pim';
import { dueKey, dueNow, nextAlarmTime } from '../core/pim/alarms';
import { occurrences } from '../core/pim/ical';
import { makeReply, matchesQuery, threadMessages, type Draft, type MailRule } from '../core/pim/mail';
import { parseQuickAdd } from '../core/pim/quickadd';
import type { PimPrefsView } from '../core/pim/prefs';
import type { Account, Alarm, CalEvent, CalendarInfo, Contact, CountdownTimer, MailFolder, MessageSummary, Reminder, WorldClock } from '../core/pim/types';
import { suggest } from '../core/pim/vcard';

type Emit = (channel: string, ...args: unknown[]) => void;

export function mockPim(emit: Emit): { pim: PimApi } {
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
    mk('work', 'INBOX', { subject: 'Design Weekly: 12 type pairings for 2026', from: { name: 'Design Weekly', address: 'news@designweekly.example' }, date: now - 9 * 3_600_000 }, {
      text: 'This week: type pairings, a new colour tool and an interview.',
      html: '<table width="100%" style="background:#f4f1ea"><tr><td style="padding:24px"><h2 style="font-family:Georgia">12 type pairings for 2026</h2><img data-blocked-src="https://img.designweekly.example/cover.jpg" width="560" alt="Cover"><p>This week: type pairings, a new colour tool and an interview with a studio in Lisbon.</p><a href="https://designweekly.example/issue/88" title="https://designweekly.example/issue/88" target="_blank">Read the issue</a></td></tr></table>',
      unsub: true,
    }),
    mk('work', 'Clients', { subject: 'Contract signed', from: { name: 'Lena Fischer', address: 'lena@brightside.example' }, date: now - 6 * day, flagged: true }, { text: 'Signed contract attached. Looking forward to starting!' }),
    mk('home', 'INBOX', { subject: 'Saturday hike?', from: { name: 'Jordan', address: 'jordan@example.net' }, date: now - 50 * 60_000, seen: false }, { text: 'Hey! Want to do the coast trail on Saturday? Meet at 8:30 at the station?' }),
    mk('home', 'INBOX', { subject: 'Your flight to Lisbon is confirmed', from: { name: 'Skyway Airlines', address: 'noreply@skyway.example' }, date: now - day, seen: false, flagged: true }, { text: 'Booking ABC123. Departure 12 March 07:40, arrival 10:15. Return 15 March 18:20.' }),
    mk('home', 'INBOX', { subject: 'Book club — next title', from: { name: 'Priya', address: 'priya@example.org' }, date: now - 2 * day }, { text: 'We picked the next book! See you on the 20th.' }),
  ];
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
      let list = v.folder === 'unified' ? messages.filter((m) => m.folder === 'INBOX' && (!v.account || m.account === v.account)) : messages.filter((m) => m.account === v.account && m.folder === v.folder);
      if (v.filter === 'unread') list = list.filter((m) => !m.seen);
      if (v.filter === 'flagged') list = list.filter((m) => m.flagged);
      if (v.filter === 'attachments') list = list.filter((m) => m.hasAttachments);
      if (v.query) list = list.filter((m) => matchesQuery(m, v.query!));
      list = [...list].sort((a, b) => b.date - a.date);
      return { messages: list, threads: v.threaded ? threadMessages(v.folder === 'unified' ? [...list, ...messages.filter((m) => m.folder === 'Sent' && list.some((x) => x.references?.includes(m.messageId!)))] : list) : undefined };
    },
    refresh: async () => { await new Promise((r) => setTimeout(r, 400)); changed('mail'); },
    older: async () => undefined,
    open: async (id, opts) => {
      const m = messages.find((x) => x.id === id)!;
      const b = bodies.get(id)!;
      if (opts?.markRead !== false && !m.seen) { m.seen = true; changed('mail'); }
      const blocked = (b.html?.match(/data-blocked-src/g) ?? []).length;
      const html = (b.html ?? `<div style="white-space:pre-wrap">${b.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).replace(/data-blocked-src="([^"]+)"/g, opts?.allowRemote ? 'src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22520%22 height=%22200%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23d9d4ff%22/%3E%3C/svg%3E"' : 'data-blocked-src="$1"');
      return { summary: m, html, text: b.text, blocked: opts?.allowRemote ? 0 : blocked, trackers: b.unsub ? 2 : 0, attachments: b.attachments ?? [], invite: b.invite ? { method: 'REQUEST', event: b.invite, mine: 'needs-action' } : undefined, unsubscribe: b.unsub ? { url: 'https://designweekly.example/u', oneClick: true } : undefined, headers: {} };
    },
    setRead: async (ids, read) => { for (const m of messages) if (ids.includes(m.id)) m.seen = read; changed('mail'); },
    setFlagged: async (ids, f) => { for (const m of messages) if (ids.includes(m.id)) m.flagged = f; changed('mail'); },
    move: async (ids, folder) => { for (const m of messages) if (ids.includes(m.id)) m.folder = folder; changed('mail'); },
    archive: async (ids) => { for (const m of messages) if (ids.includes(m.id)) m.folder = 'Archive'; changed('mail'); },
    trash: async (ids) => { for (const m of messages) if (ids.includes(m.id)) m.folder = 'Trash'; changed('mail'); },
    junk: async () => undefined,
    snooze: async (ids, until) => { for (const m of messages) if (ids.includes(m.id)) m.snoozedUntil = until; changed('mail'); },
    saveAttachment: async (_id, att) => `/Users/demo/Downloads/${att}`,
    openAttachment: async () => undefined,
    unsubscribe: async () => ({ done: true, how: 'Unsubscribed' }),
    trustSender: async (a) => { prefs.trustedSenders.push(a); },
    draftFor: async (id, mode) => { const m = messages.find((x) => x.id === id)!; return makeReply({ original: { ...m, text: bodies.get(id)?.text }, me: ['alex@studio.example', 'alex.rivera@gmail.com'], mode }); },
    send: async (d) => { const o = { id: String(Date.now()), sendAt: Date.now() + prefs.undoSendSec * 1000, subject: d.subject, draft: d }; outbox.push(o); changed('outbox'); setTimeout(() => { const i = outbox.indexOf(o); if (i >= 0) { outbox.splice(i, 1); messages.push(mk(d.account, d.account === 'work' ? 'Sent' : '[Gmail]/Sent Mail', { subject: d.subject, from: { name: 'Alex Rivera', address: accounts.find((a) => a.id === d.account)?.email ?? '' }, to: d.to, date: Date.now() }, { text: d.body })); changed('outbox'); changed('mail'); } }, prefs.undoSendSec * 1000); return { id: o.id, sendAt: o.sendAt, subject: o.subject }; },
    undoSend: async (id) => { const i = outbox.findIndex((x) => x.id === id); if (i < 0) return null; const [o] = outbox.splice(i, 1); changed('outbox'); return o.draft; },
    outbox: async () => outbox.map(({ draft: _d, ...o }) => o),
    saveDraft: async () => undefined,
    suggest: async (q) => suggest(contacts, [], q),
    ai: async (_id, task) => {
      await new Promise((r) => setTimeout(r, 700));
      if (task === 'summarize') return { text: '• Ana sent round 2 of the homepage drafts: bigger hero image, new type.\n• The old layout is kept as option B.\n• She needs your feedback by Thursday.' };
      if (task === 'reply') return { text: 'Hi Ana,\n\nThanks — these look great. I prefer the new type; let’s go with option A. I’ll send detailed notes by Thursday.\n\nAlex' };
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
    systemAccess: async () => ({ state: 'granted', via: 'files', canRequest: false, message: 'In the browser preview the computer’s calendars are pretend ones.' }),
    watchCalendar: async () => undefined,
    openEvent: async () => undefined,

    reminders: async () => reminders,
    saveReminder: async (r) => { const n = { ...r, id: r.id || `local:${Date.now()}`, list: r.list || 'local' }; reminders = [...reminders.filter((x) => x.id !== n.id), n]; changed('reminders'); return n; },
    deleteReminder: async (id) => { reminders = reminders.filter((x) => x.id !== id); changed('reminders'); },

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
      changed('alarms');
    },
    saveClocks: async (c) => { clocks = c; changed('alarms'); },
    scheduleWake: async () => ({ ok: false, message: 'Not in the demo' }),

    contacts: async () => contacts,
    saveContact: async (c) => c,
    deleteContact: async () => undefined,
    prefs: async () => prefs,
    setPrefs: async (p) => (prefs = { ...prefs, ...p }),
  };
  return { pim };
}
