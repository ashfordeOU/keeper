// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The importer against files made here: mbox, a folder of .eml, an Apple Mail
// store, a Thunderbird profile and an Outlook for Mac archive go into the
// "On this computer" mail, can be exported again and taken back; the task
// services are answered by a stand-in server.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CalEvent, Contact, Reminder } from '../core/pim/types';
import type { ImportProgress } from '../core/pim/import-flow';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-import-test-'));
process.env.KEEPER_PIM_DIR = path.join(dir, 'pim');

const msg = (subject: string, extra: string[] = []) => [`From: Ana <ana@example.org>`, `To: Ben <ben@example.org>`, `Subject: ${subject}`, `Message-ID: <${subject.replace(/\W/g, '')}@example.org>`, 'Date: Mon, 2 Nov 2026 10:00:00 +0000', ...extra, '', `About ${subject}.`].join('\n');

/** A small ZIP (deflate) for the .olm test. */
function zip(files: Record<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, comp);
    central.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

let importer: typeof import('../electron/services/pim/importer');
let LocalMailbox: typeof import('../electron/services/pim/local-mail').LocalMailbox;
let box: InstanceType<typeof LocalMailbox>;
const progress: ImportProgress[] = [];
let reminders: Reminder[] = [];
let contacts: Contact[] = [];
const calendars = new Map<string, CalEvent[]>();

const host = () => ({
  progress: (p: ImportProgress) => progress.push(p),
  localMail: async () => ({ account: 'local-mail', box }),
  mailChanged: async () => undefined,
  addEvents: async (evs: CalEvent[], o: { calendar?: string; name: string }) => { const id = o.calendar ?? `local:cal:${o.name}`; calendars.set(id, [...(calendars.get(id) ?? []), ...evs]); return { calendar: id, created: !o.calendar, uids: [...new Set(evs.map((e) => e.uid))] }; },
  removeEvents: async (c: string) => { calendars.delete(c); },
  reminders: () => reminders,
  addReminders: async (l: Reminder[]) => { reminders = [...reminders, ...l]; },
  removeReminders: async (ids: string[]) => { reminders = reminders.filter((r) => !ids.includes(r.id)); },
  contacts: () => contacts,
  addContacts: async (l: Contact[]) => { contacts = [...contacts, ...l]; },
  removeContacts: async (ids: string[]) => { contacts = contacts.filter((c) => !ids.includes(c.id)); },
  signInToken: async () => 'token-123',
  mailbox: () => box,
  folders: () => box.folders(),
});

beforeAll(async () => {
  importer = await import('../electron/services/pim/importer');
  LocalMailbox = (await import('../electron/services/pim/local-mail')).LocalMailbox;
  box = new LocalMailbox({ id: 'local-mail', kind: 'local', label: 'On this computer', identities: [], mail: true, calendar: false, contacts: false });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (rel: string, content: string | Buffer) => {
  const p = path.join(dir, 'src', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};

describe('mail import', () => {
  it('imports an mbox with flags, skips repeats, exports and undoes', async () => {
    const mbox = file('Work.mbox', [
      `From a Mon Nov  2 10:00:00 2026\n${msg('First', ['Status: RO', 'X-Status: F'])}`,
      `From a Mon Nov  2 10:00:00 2026\n${msg('Second', ['Status: O'])}`,
      `From a Mon Nov  2 10:00:00 2026\n${msg('First', ['Status: RO'])}`,
    ].join('\n\n'));
    const r = await importer.runImport({ source: 'mbox', paths: [mbox] }, host());
    expect(r).toMatchObject({ added: 2, skipped: 1, folders: 1, area: 'mail' });
    expect(r.summary).toBe('2 messages · 1 already here');
    const list = (await box.cached('Imported/Work')).messages;
    expect(list.find((m) => m.subject === 'First')).toMatchObject({ seen: true, flagged: true, snippet: 'About First.' });
    expect(list.find((m) => m.subject === 'Second')!.seen).toBe(false);
    expect((await box.folders()).find((f) => f.path === 'Imported/Work')).toMatchObject({ unread: 1, total: 2 });
    expect(progress.some((p) => p.phase === 'done')).toBe(true);

    // Export and read it back.
    const out = path.join(dir, 'out', 'Work.mbox');
    const ex = await importer.exportMail('local-mail', 'Imported/Work', 'mbox', out, host());
    expect(ex.count).toBe(2);
    expect(fs.readFileSync(out, 'utf8').match(/^From /gm)).toHaveLength(2);
    const emlDir = path.join(dir, 'out', 'eml');
    expect((await importer.exportMail('local-mail', 'Imported/Work', 'eml', emlDir, host())).count).toBe(2);

    const back = await importer.undoImport(r.id, host());
    expect(back?.undone).toBe(true);
    expect((await box.folders()).some((f) => f.path.startsWith('Imported'))).toBe(false);
    expect((await importer.importHistory())[0].undo).toBeUndefined();
  });

  it('splits a Gmail download by its labels', async () => {
    const mbox = file('Takeout/Mail/All mail Including Spam and Trash.mbox', [
      `From 1@xxx Mon Nov  2 10:00:00 2026\n${msg('Hello', ['X-Gmail-Labels: Inbox,Unread,Family'])}`,
      `From 2@xxx Mon Nov  2 10:00:00 2026\n${msg('Sent one', ['X-Gmail-Labels: Sent,Opened'])}`,
    ].join('\n'));
    const r = await importer.runImport({ source: 'mbox', paths: [mbox] }, host());
    expect(r.added).toBe(2);
    expect((await box.cached('Gmail download/Inbox')).messages[0]).toMatchObject({ seen: false, labels: ['Family'] });
    expect((await box.cached('Gmail download/Sent')).messages).toHaveLength(1);
  });

  it('imports a folder of .eml files with sub-folders', async () => {
    file('Saved/a.eml', msg('Eml one'));
    file('Saved/Trips/b.eml', msg('Eml two'));
    file('Saved/notes.pdf', 'x');
    const r = await importer.runImport({ source: 'eml', paths: [path.join(dir, 'src', 'Saved')] }, host());
    expect(r).toMatchObject({ added: 2, folders: 2 });
    expect((await box.cached('Imported/Saved/Trips')).messages[0].subject).toBe('Eml two');
  });

  it('reads an Apple Mail store, leaving deleted messages out', async () => {
    const emlx = (raw: string, flags: number) => `${Buffer.byteLength(raw)}\n${raw}<?xml version="1.0"?><plist><dict><key>flags</key><integer>${flags}</integer></dict></plist>`;
    const root = path.join(dir, 'src', 'Mail', 'V10');
    file('Mail/V10/Mailboxes/Clients.mbox/AB/Data/Messages/1.emlx', emlx(msg('Apple one'), 1));
    file('Mail/V10/Mailboxes/Clients.mbox/AB/Data/Messages/2.emlx', emlx(msg('Apple gone'), 3));
    file('Mail/V10/Mailboxes/Clients.mbox/AB/Data/Messages/3.partial.emlx', emlx(msg('Apple partial'), 0));
    const r = await importer.runImport({ source: 'apple-mail', paths: [root] }, host());
    expect(r).toMatchObject({ added: 2, skipped: 1 });
    expect(r.notes?.[0]).toMatch(/without their attachments/);
    expect((await box.cached('Apple Mail/On My Mac/Clients')).messages.map((m) => m.subject).sort()).toEqual(['Apple one', 'Apple partial']);
  });

  it('reads a Thunderbird profile', async () => {
    const prof = path.join(dir, 'src', 'tb', 'Profiles', 'abc.default');
    file('tb/Profiles/abc.default/Mail/Local Folders/Inbox', `From - Mon Nov  2 10:00:00 2026\nX-Mozilla-Status: 0005\n${msg('Tb one')}\n`);
    file('tb/Profiles/abc.default/Mail/Local Folders/Inbox.msf', 'x');
    file('tb/Profiles/abc.default/ImapMail/imap.example.org/Archives.sbd/2025', `From - Mon Nov  2 10:00:00 2026\n${msg('Tb two')}\n`);
    file('tb/Profiles/abc.default/ImapMail/imap.example.org/Archives.sbd/2025.msf', 'x');
    const r = await importer.runImport({ source: 'thunderbird', paths: [prof] }, host());
    expect(r).toMatchObject({ added: 2, folders: 2 });
    expect((await box.cached('Thunderbird/Local Folders/Inbox')).messages[0]).toMatchObject({ seen: true, flagged: true });
    expect((await box.cached('Thunderbird/imap.example.org/Archives/2025')).messages).toHaveLength(1);
  });

  it('reads an Outlook for Mac archive with attachments', async () => {
    const xml = `<emails><email><OPFMessageCopySubject>From Outlook</OPFMessageCopySubject><OPFMessageCopySenderAddress><emailAddress OPFContactEmailAddressAddress="ana@example.org" OPFContactEmailAddressName="Ana"/></OPFMessageCopySenderAddress><OPFMessageCopySentTime>2026-11-02T10:00:00</OPFMessageCopySentTime><OPFMessageCopyBody>Plain body</OPFMessageCopyBody><OPFMessageGetIsRead>1</OPFMessageGetIsRead><OPFMessageCopyAttachmentList><messageAttachment OPFAttachmentContentType="text/plain" OPFAttachmentName="a.txt" OPFAttachmentURL="Accounts/x/com.microsoft.__Attachments/a.txt"/></OPFMessageCopyAttachmentList></email></emails>`;
    const olm = file('archive.olm', zip({ 'Accounts/x/com.microsoft.__Messages/Inbox/message_1.xml': xml, 'Accounts/x/com.microsoft.__Attachments/a.txt': 'attached' }));
    const r = await importer.runImport({ source: 'olm', paths: [olm] }, host());
    expect(r.added).toBe(1);
    const m = (await box.cached('Outlook archive/Inbox')).messages[0];
    expect(m).toMatchObject({ subject: 'From Outlook', hasAttachments: true, seen: true });
    const { body } = await box.body('Outlook archive/Inbox', m.uid);
    expect(body.attachments.map((a) => a.filename)).toEqual(['a.txt']);
  });

  it('says plainly that .pst files are not read', async () => {
    await expect(importer.runImport({ source: 'pst', paths: ['/x.pst'] }, host())).rejects.toThrow(/can’t read \.pst/);
  });
});

describe('calendar, tasks and contacts import', () => {
  it('imports an .ics into a calendar of its own and takes it back', async () => {
    const ics = file('Team.ics', ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261102T100000Z', 'DTEND:20261102T110000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Stand-up', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID:20261109T100000Z', 'DTSTART:20261109T120000Z', 'DTEND:20261109T130000Z', 'SUMMARY:Stand-up (moved)', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Holiday', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    const r = await importer.runImport({ source: 'ics', paths: [ics] }, host());
    expect(r.summary).toBe('2 events · 1 repeating · 1 changed occurrence');
    expect(calendars.get('local:cal:Team')).toHaveLength(3);
    await importer.undoImport(r.id, host());
    expect(calendars.has('local:cal:Team')).toBe(false);
  });

  it('imports tasks from CSV once, and contacts from vCard', async () => {
    const csv = file('tasks.csv', 'Title,Due\nPay rent,2026-12-01\nCall Ana,\n');
    const r = await importer.runImport({ source: 'tasks-csv', paths: [csv] }, host());
    expect(r.added).toBe(2);
    const again = await importer.runImport({ source: 'tasks-csv', paths: [csv] }, host());
    expect(again).toMatchObject({ added: 0, skipped: 2 });
    await importer.undoImport(r.id, host());
    expect(reminders).toHaveLength(0);

    const vcf = file('people.vcf', 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana\r\nEMAIL:ana@example.org\r\nEND:VCARD\r\n');
    const c = await importer.runImport({ source: 'vcf', paths: [vcf] }, host());
    expect(c.added).toBe(1);
    expect(contacts[0]).toMatchObject({ account: 'local', name: 'Ana' });
  });

  describe('task services', () => {
    let server: http.Server;
    let seen: string[] = [];
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        seen.push(`${req.headers.authorization} ${req.url}`);
        const u = req.url ?? '';
        const send = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (u.startsWith('/g/users/@me/lists')) return send({ items: [{ id: 'L1', title: 'Shopping' }] });
        if (u.startsWith('/g/lists/L1/tasks') && !u.includes('pageToken')) return send({ items: [{ id: 't1', title: 'Milk' }], nextPageToken: 'p2' });
        if (u.startsWith('/g/lists/L1/tasks')) return send({ items: [{ id: 't2', title: 'Bread', status: 'completed' }] });
        if (u === '/m/me/todo/lists') return send({ value: [{ id: 'W', displayName: 'Work' }] });
        if (u.startsWith('/m/me/todo/lists/W/tasks')) return send({ value: [{ id: 'x', title: 'Report', importance: 'high' }] });
        if (u.startsWith('/t/projects')) return send({ results: [{ id: 'p', name: 'Home' }], next_cursor: null });
        if (u.startsWith('/t/tasks')) return send({ results: [{ id: '1', content: 'Sweep', project_id: 'p' }], next_cursor: null });
        res.writeHead(404); res.end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      Object.assign(importer.TASK_APIS, { google: `${base}/g`, graph: `${base}/m`, todoist: `${base}/t` });
    });
    afterAll(() => server.close());

    it('reads Google Tasks across pages, To Do and Todoist with the given token', async () => {
      seen = [];
      expect((await importer.googleTasks('tok')).map((t) => t.title)).toEqual(['Milk', 'Bread']);
      expect((await importer.msTodoTasks('tok'))[0]).toMatchObject({ title: 'Report', priority: 3, project: 'Work' });
      expect((await importer.todoistTasks('tok'))[0]).toMatchObject({ title: 'Sweep', project: 'Home' });
      expect(seen.every((s) => s.startsWith('Bearer tok '))).toBe(true);
      const r = await importer.runImport({ source: 'google-tasks' }, host());
      expect(r.added).toBe(2);
    });
  });
});
