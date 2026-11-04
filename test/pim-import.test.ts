// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading other apps' mail, tasks and contacts, and writing them out again.
// Every fixture is made here; no real person's data.

import { describe, expect, it } from 'vitest';
import { appleMailFolder, appleMailVersion, buildMessage, gmailLabels, gmailPlacement, importSummary, MboxSplitter, messageIdOf, olmFolder, parseEmlx, parseOlmMessage, parseProfilesIni, safeFileName, specialOf, splitMbox, targetFolder, thunderbirdMailboxes, thunderbirdRoots, toMboxEntry } from '../core/pim/mail-import';
import { csvRecords, parseCsv, parseLooseDate, repeatFromWords, rruleFromGraph, taskKey, tasksFromApple, tasksFromCsv, tasksFromGoogle, tasksFromIcs, tasksFromMsTodo, tasksFromTodoist, tasksFromTodoistCsv, tasksToCsv, tasksToIcs, toCsv } from '../core/pim/task-import';
import { contactKey, contactsFromCsv, contactsFromVcf, contactsToCsv, contactsToVcf, decodeQuotedPrintable } from '../core/pim/contact-import';
import { IMPORT_SOURCES, percent, sourcesFor } from '../core/pim/import-flow';
import { parseTodos } from '../core/pim/ical';

const msg = (subject: string, body: string, extra: string[] = []) => [`From: Ana <ana@example.org>`, `To: Ben <ben@example.org>`, `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}@example.org>`, 'Date: Mon, 2 Nov 2026 10:00:00 +0000', ...extra, '', body].join('\n');

describe('mbox', () => {
  it('splits messages, unescapes >From and drops the separator line', () => {
    const file = `From ana@example.org Mon Nov  2 10:00:00 2026\n${msg('One', 'Hello\n>From the start\n>>From deeper')}\n\nFrom ben@example.org Tue Nov  3 10:00:00 2026\n${msg('Two', 'Bye')}\n`;
    const got = splitMbox(file);
    expect(got).toHaveLength(2);
    expect(got[0].toString()).toContain('\nFrom the start\n>From deeper');
    expect(got[0].toString()).not.toMatch(/^From ana/);
    expect(messageIdOf(got[1])).toBe('Two@example.org');
  });

  it('reads the same in small chunks as in one piece', () => {
    const file = Buffer.from(Array.from({ length: 30 }, (_, i) => `From x@example.org Mon Nov  2 10:00:00 2026\n${msg(`M${i}`, `Body ${i}\nFrom here is not a separator`)}\n`).join('\n'));
    const out: Buffer[] = [];
    const s = new MboxSplitter((r) => out.push(r));
    for (let i = 0; i < file.length; i += 7) s.push(file.subarray(i, i + 7));
    s.end();
    expect(out).toHaveLength(30);
    expect(out[29].toString()).toContain('From here is not a separator');
  });

  it('treats a file without From lines as one message', () => {
    expect(splitMbox(msg('Lone', 'Hi'))).toHaveLength(1);
  });

  it('writes entries that read back the same', () => {
    const raw = msg('Round', 'line\nFrom inside\n>From quoted');
    const entry = toMboxEntry(raw, 'ana@example.org', Date.UTC(2026, 10, 2, 10));
    expect(entry.toString()).toMatch(/^From ana@example.org Mon Nov  2 10:00:00 2026\n/);
    expect(entry.toString()).toContain('\n>From inside\n>>From quoted');
    const back = splitMbox(Buffer.concat([entry, entry]));
    expect(back).toHaveLength(2);
    expect(back[0].toString().replace(/\r\n$/, '')).toBe(raw);
  });
});

describe('Gmail download', () => {
  it('reads labels with quotes and places messages', () => {
    const raw = msg('L', 'x', ['X-Gmail-Labels: Inbox,Unread,"Work, Projects",Starred']);
    expect(gmailLabels(raw)).toEqual(['Inbox', 'Unread', 'Work, Projects', 'Starred']);
    expect(gmailPlacement(gmailLabels(raw))).toEqual({ folder: 'Inbox', labels: ['Work, Projects'], seen: false, flagged: true });
    expect(gmailPlacement(['Opened', 'Travel']).folder).toBe('Travel');
    expect(gmailPlacement(['Sent', 'Opened']).folder).toBe('Sent');
    expect(gmailPlacement(['Opened']).folder).toBe('Archive');
  });
});

describe('folders', () => {
  it('knows special folder names from several apps and languages', () => {
    expect(specialOf('Sent Items')).toBe('sent');
    expect(specialOf('Deleted Messages')).toBe('trash');
    expect(specialOf('Papierkorb')).toBe('trash');
    expect(specialOf('Junk E-mail')).toBe('junk');
    expect(specialOf('Clients')).toBeUndefined();
    expect(targetFolder(['Sent Messages.mbox'])).toEqual({ path: 'Sent', special: 'sent' });
    expect(targetFolder(['[Gmail]', 'Sent Mail'])).toEqual({ path: 'Sent', special: 'sent' });
    expect(targetFolder(['Work.sbd', 'Clients'])).toEqual({ path: 'Work/Clients' });
  });
});

describe('Apple Mail', () => {
  it('reads .emlx with its flags', () => {
    const raw = msg('Apple', 'Body');
    const plist = '<?xml version="1.0"?><plist version="1.0"><dict><key>flags</key><integer>17</integer></dict></plist>';
    const m = parseEmlx(Buffer.from(`${Buffer.byteLength(raw)}\n${raw}${plist}`))!;
    expect(m.raw.toString()).toBe(raw);
    expect(m).toMatchObject({ seen: true, flagged: true, answered: false, deleted: false });
    expect(parseEmlx(Buffer.from('not a file'))).toBeNull();
  });
  it('finds the folder from the store layout and the newest store', () => {
    expect(appleMailFolder('ABCD-1234/Work.mbox/Clients.mbox/E5F6/Data/1/Messages/12.emlx')).toEqual({ account: 'ABCD-1234', folder: ['Work', 'Clients'] });
    expect(appleMailFolder('Mailboxes/Notes.mbox/Info.plist')).toBeNull();
    expect(appleMailVersion(['MailData', 'V9', 'V10', 'V2'])).toBe('V10');
  });
});

describe('Thunderbird', () => {
  it('reads profiles.ini with the install default', () => {
    const ini = '[Install4F96D1932A9F858E]\nDefault=Profiles/abc.default-release\nLocked=1\n\n[Profile1]\nName=default\nIsRelative=1\nPath=Profiles/xyz.default\nDefault=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n\n[Profile2]\nName=old\nIsRelative=0\nPath=/mnt/old/profile\n';
    const p = parseProfilesIni(ini, '/home/ana/.thunderbird');
    expect(p[0]).toEqual({ name: 'default-release', path: '/home/ana/.thunderbird/Profiles/abc.default-release', isDefault: true });
    expect(p.find((x) => x.name === 'old')!.path).toBe('/mnt/old/profile');
  });
  it('finds mailboxes next to their index and in .sbd folders', () => {
    const files = [
      { path: 'Inbox', size: 100 }, { path: 'Inbox.msf', size: 10 }, { path: 'Sent', size: 50 }, { path: 'Sent.msf', size: 10 },
      { path: 'Work.sbd/Clients', size: 70 }, { path: 'Work.sbd/Clients.msf', size: 10 }, { path: 'Work', size: 0 }, { path: 'filterlog.html', size: 4 },
      { path: 'msgFilterRules.dat', size: 3 }, { path: 'Trash', size: 0 },
    ];
    expect(thunderbirdMailboxes(files).map((b) => b.folder.join('/'))).toEqual(['Inbox', 'Sent', 'Work/Clients']);
  });
  it('looks in the usual places on each system', () => {
    expect(thunderbirdRoots('darwin', '/Users/a')).toEqual(['/Users/a/Library/Thunderbird']);
    expect(thunderbirdRoots('win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Roaming')[0]).toBe('C:\\Users\\a\\AppData\\Roaming\\Thunderbird');
    expect(thunderbirdRoots('linux', '/home/a')).toContain('/home/a/snap/thunderbird/common/.thunderbird');
  });
});

describe('Outlook for Mac archive', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><emails><email><OPFMessageCopySubject>Plans &amp; dates</OPFMessageCopySubject>
<OPFMessageCopySenderAddress><emailAddress OPFContactEmailAddressAddress="ana@example.org" OPFContactEmailAddressName="Ana Lopez"/></OPFMessageCopySenderAddress>
<OPFMessageCopyToAddresses><emailAddress OPFContactEmailAddressAddress="ben@example.org" OPFContactEmailAddressName="ben@example.org"/></OPFMessageCopyToAddresses>
<OPFMessageCopySentTime>2026-11-02T10:00:00</OPFMessageCopySentTime><OPFMessageCopyMessageID>&lt;abc@example.org&gt;</OPFMessageCopyMessageID>
<OPFMessageCopyHTMLBody><![CDATA[<p>Hi <b>Ben</b></p>]]></OPFMessageCopyHTMLBody><OPFMessageGetIsRead>0</OPFMessageGetIsRead>
<OPFMessageCopyAttachmentList><messageAttachment OPFAttachmentContentType="text/plain" OPFAttachmentName="notes.txt" OPFAttachmentURL="com.microsoft.__Attachments/notes.txt"/></OPFMessageCopyAttachmentList></email></emails>`;
  it('reads a message', () => {
    const m = parseOlmMessage(xml)!;
    expect(m).toMatchObject({ subject: 'Plans & dates', from: { name: 'Ana Lopez', address: 'ana@example.org' }, to: [{ address: 'ben@example.org' }], messageId: 'abc@example.org', html: '<p>Hi <b>Ben</b></p>', seen: false });
    expect(m.attachments).toEqual([{ url: 'com.microsoft.__Attachments/notes.txt', name: 'notes.txt', type: 'text/plain' }]);
    expect(olmFolder('Accounts/a@b/com.microsoft.__Messages/Inbox/Work/message_1.xml')).toEqual(['Inbox', 'Work']);
    expect(olmFolder('Accounts/a@b/com.microsoft.__Contacts/c.xml')).toBeNull();
  });
  it('builds a readable message with attachments', async () => {
    const raw = buildMessage({ subject: 'Café plan', from: { name: 'Ana', address: 'ana@example.org' }, to: [{ address: 'ben@example.org' }], date: Date.UTC(2026, 10, 2), messageId: 'm1@example.org', text: 'Hi', html: '<p>Hi</p>', attachments: [{ name: 'a.txt', type: 'text/plain', content: Buffer.from('hello') }] });
    const { simpleParser } = await import('mailparser');
    const p = await simpleParser(raw);
    expect(p.subject).toBe('Café plan');
    expect(p.text?.trim()).toBe('Hi');
    expect(p.html).toContain('<p>Hi</p>');
    expect(p.attachments.map((a) => [a.filename, a.content.toString()])).toEqual([['a.txt', 'hello']]);
    expect(p.messageId).toBe('<m1@example.org>');
  });
});

describe('summary and names', () => {
  it('says what was imported in one line', () => {
    expect(importSummary({ added: 1204, skipped: 3, failed: 0, folders: 6 })).toBe('1,204 messages in 6 folders · 3 already here');
    expect(importSummary({ added: 1, skipped: 0, failed: 2, folders: 1 }, 'event')).toBe('1 event · 2 could not be read');
    expect(safeFileName('Re: a/b?*')).toBe('Re a b');
    expect(safeFileName('...')).toBe('message');
    expect(percent({ done: 5, total: 20 })).toBe(25);
    expect(percent({ done: 5 })).toBeUndefined();
  });
  it('offers the same flow in every part, with Mac-only sources marked elsewhere', () => {
    for (const a of ['mail', 'calendar', 'reminders', 'contacts'] as const) expect(sourcesFor(a, 'linux').length).toBeGreaterThan(0);
    expect(sourcesFor('reminders', 'linux').find((s) => s.id === 'apple-reminders')!.unavailable).toBeTruthy();
    expect(sourcesFor('reminders', 'darwin').find((s) => s.id === 'apple-reminders')!.unavailable).toBeUndefined();
    for (const s of IMPORT_SOURCES) {
      expect(s.steps.length).toBeLessThanOrEqual(4);
      expect(s.label.split(' ').length).toBeLessThanOrEqual(5);
    }
  });
});

describe('CSV', () => {
  it('reads quotes, new lines and other separators', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(csvRecords('\uFEFFTitle,Due\nX,2026-01-02')).toEqual([{ title: 'X', due: '2026-01-02' }]);
  });
  it('writes cells safely for spreadsheets', () => {
    expect(toCsv([['a,b', '=SUM(1)', 'plain']])).toBe('"a,b","\'=SUM(1)",plain\r\n');
  });
  it('reads dates written in many ways', () => {
    expect(parseLooseDate('2026-03-04')).toEqual({ t: new Date(2026, 2, 4, 9).getTime(), allDay: true });
    expect(parseLooseDate('2026-03-04 14:30')).toEqual({ t: new Date(2026, 2, 4, 14, 30).getTime(), allDay: false });
    expect(parseLooseDate('25/12/2026')!.t).toBe(new Date(2026, 11, 25, 9).getTime());
    expect(parseLooseDate('nonsense')).toBeUndefined();
  });
});

describe('tasks', () => {
  it('reads any app’s CSV by its column names', () => {
    const t = tasksFromCsv('Task Name,Description,Due Date,Priority,List,Completed,Subtasks\nPay rent,Flat 2,2026-12-01,High,Home,No,[x] find form | send\nOld,,,,,yes,\n');
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ title: 'Pay rent', notes: 'Flat 2', plannedFor: '2026-12-01', priority: 3, project: 'Home', done: false, list: 'local' });
    expect(t[0].steps).toEqual([{ id: 's0', title: 'find form', done: true }, { id: 's1', title: 'send', done: false }]);
    expect(t[1].done).toBe(true);
  });
  it('reads Todoist CSV with sections, steps and repeats', () => {
    const csv = 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\nsection,Errands,,,,,,,,\ntask,Buy [milk](https://x.example) @shop,,4,1,,,every monday,en,UTC\ntask,Semi-skimmed,,1,2,,,,en,UTC\ntask,Call bank,,2,1,,,2026-12-01,en,UTC\n';
    const t = tasksFromTodoistCsv(csv);
    expect(t.map((x) => x.title)).toEqual(['Buy milk', 'Call bank']);
    expect(t[0]).toMatchObject({ priority: 3, project: 'Errands', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
    expect(t[0].steps?.[0].title).toBe('Semi-skimmed');
    expect(t[1].priority).toBe(1);
    expect(tasksFromCsv(csv)).toHaveLength(2);
  });
  it('turns repeat words into rules', () => {
    expect(repeatFromWords('every day')).toBe('FREQ=DAILY');
    expect(repeatFromWords('every workday')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(repeatFromWords('every other week')).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(repeatFromWords('tomorrow')).toBeUndefined();
  });
  it('reads Todoist’s API answer', () => {
    const t = tasksFromTodoist([
      { id: '1', content: 'Plan trip', priority: 3, project_id: 'p', due: { date: '2026-12-24' } },
      { id: '2', content: 'Book train', parent_id: '1', checked: true },
      { id: '3', content: 'Stand-up', due: { date: '2026-12-01T09:15:00', string: 'every weekday 9:15', is_recurring: true } },
    ], [{ id: 'p', name: 'Holiday' }]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ title: 'Plan trip', priority: 2, project: 'Holiday', plannedFor: '2026-12-24', steps: [{ title: 'Book train', done: true }] });
    expect(t[1]).toMatchObject({ due: new Date(2026, 11, 1, 9, 15).getTime(), rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
  });
  it('reads Google Tasks with sub-tasks as steps', () => {
    const t = tasksFromGoogle([{ title: 'Shopping', items: [
      { id: 'a', title: 'Groceries', due: '2026-12-02T00:00:00.000Z', notes: 'list' },
      { id: 'b', title: 'Eggs', parent: 'a', status: 'completed' },
      { id: 'c', title: 'Gone', deleted: true },
    ] }]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: 'Groceries', notes: 'list', plannedFor: '2026-12-02', project: 'Shopping', steps: [{ title: 'Eggs', done: true }] });
  });
  it('reads Microsoft To Do with checklist, importance and repeats', () => {
    expect(rruleFromGraph({ type: 'weekly', interval: 2, daysOfWeek: ['monday', 'thursday'] })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH');
    const t = tasksFromMsTodo([{ displayName: 'Work', tasks: [{ id: 'x1', title: 'Report', importance: 'high', status: 'notStarted', body: { content: '<p>Q4 <b>numbers</b></p>', contentType: 'html' }, dueDateTime: { dateTime: '2026-12-05T00:00:00.0000000', timeZone: 'UTC' }, checklistItems: [{ id: 'c1', displayName: 'Draft', isChecked: true }], recurrence: { pattern: { type: 'absoluteMonthly', interval: 1 } } }] }]);
    expect(t[0]).toMatchObject({ title: 'Report', priority: 3, notes: 'Q4 numbers', plannedFor: '2026-12-05', project: 'Work', rrule: 'FREQ=MONTHLY', steps: [{ title: 'Draft', done: true }] });
  });
  it('reads Apple Reminders as the Mac reads them', () => {
    const t = tasksFromApple([{ title: 'Water plants', list: 'Home', priority: 1, due: new Date(2026, 11, 3, 18).getTime() }, { title: 'Inbox thing', list: 'Reminders', priority: 9, completed: true }, { title: '  ' }]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ project: 'Home', priority: 3, due: new Date(2026, 11, 3, 18).getTime() });
    expect(t[1]).toMatchObject({ priority: 1, done: true });
    expect(t[1].project).toBeUndefined();
  });
  it('round-trips through .ics and CSV', () => {
    const t = tasksFromCsv('Title,Due,Priority,List,Steps\nA,2026-12-01 10:00,Medium,Home,one | [x] two\n');
    const ics = tasksToIcs(t, Date.UTC(2026, 0, 1));
    expect(ics.match(/BEGIN:VTODO/g)).toHaveLength(1);
    const back = tasksFromIcs(ics);
    expect(back[0]).toMatchObject({ title: 'A', priority: 2, project: 'Home', due: t[0].due });
    expect(back[0].steps?.map((s) => s.done)).toEqual([false, true]);
    expect(parseTodos(ics)).toHaveLength(1);
    const csv = tasksToCsv(t);
    expect(tasksFromCsv(csv)[0]).toMatchObject({ title: 'A', priority: 2, project: 'Home' });
    expect(taskKey(t[0])).toBe(taskKey(back[0]));
  });
});

describe('contacts', () => {
  it('reads vCard 4, 3 and older quoted-printable cards', () => {
    const vcf = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Ana López', 'EMAIL:mailto:ana@example.org', 'TEL;VALUE=uri:tel:+44-20-1234', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=B6rg', 'EMAIL;INTERNET:jorg@example.org', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD'].join('\r\n');
    const c = contactsFromVcf(vcf);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ name: 'Ana López', emails: ['ana@example.org'], phones: ['+44-20-1234'] });
    expect(c[1]).toMatchObject({ name: 'Jörg Müller', emails: ['jorg@example.org'] });
    expect(decodeQuotedPrintable('caf=C3=A9=\r\n!')).toBe('café!');
  });
  it('reads CSV from a web mail and a desktop app', () => {
    const web = contactsFromCsv('Name,Given Name,Family Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Organization 1 - Name,Birthday\nAna Lopez,Ana,Lopez,ana@example.org ::: ana@work.example,,+1 555,Studio,1990-04-02\n');
    expect(web[0]).toMatchObject({ name: 'Ana Lopez', emails: ['ana@example.org', 'ana@work.example'], phones: ['+1 555'], org: 'Studio', birthday: '1990-04-02' });
    const desk = contactsFromCsv('First Name,Last Name,E-mail Address,Mobile Phone,Company\nBen,Ng,ben@example.org,07700,Shop\n,,,,\n');
    expect(desk).toHaveLength(1);
    expect(desk[0]).toMatchObject({ name: 'Ben Ng', emails: ['ben@example.org'], phones: ['07700'], org: 'Shop' });
  });
  it('writes .vcf and CSV that read back', () => {
    const list = contactsFromCsv('Name,E-mail 1,Phone 1\nAna,ana@example.org,123\n');
    expect(contactsFromVcf(contactsToVcf(list))[0]).toMatchObject({ name: 'Ana', emails: ['ana@example.org'], phones: ['123'] });
    expect(contactsFromCsv(contactsToCsv(list))[0].emails).toEqual(['ana@example.org']);
    expect(contactKey({ name: 'X', emails: ['A@B.example'] })).toBe('a@b.example');
  });
});
