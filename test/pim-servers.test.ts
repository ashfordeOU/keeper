// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper's mail and calendar clients against real servers started here:
// Dovecot for IMAP (skipped when Dovecot is not installed), an in-process
// SMTP server, and a small CalDAV server.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { occurrences, parseEvents } from '../core/pim/ical';
import type { Account, CalEvent } from '../core/pim/types';

const require = createRequire(import.meta.url);
const { startDovecot } = require('./servers/dovecot.cjs') as { startDovecot: () => Promise<{ port: number; stop: () => void; log: () => string } | null> };
const { startCalDav } = require('./servers/caldav.cjs') as { startCalDav: () => Promise<{ port: number; url: string; log: { method: string; url: string }[]; put: (cal: string, name: string, data: string) => string; remove: (href: string) => void; cals: Record<string, { items: Map<string, { data: string; etag: string }> }>; stop: () => Promise<void> }> };

process.env.KEEPER_PIM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-pim-test-'));

const RAW = (subject: string, extra = '') => [
  'From: Ana Lopez <ana@example.org>',
  'To: Alex <alex@example.org>',
  `Subject: ${subject}`,
  `Message-ID: <${subject.replace(/\W/g, '')}@example.org>`,
  'Date: Mon, 2 Nov 2026 10:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="b1"',
  extra,
  '',
  '--b1',
  'Content-Type: multipart/alternative; boundary="b2"',
  '',
  '--b2',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi Alex, caf=C3=A9 at 3? See the plan attached.',
  '--b2',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p onclick="x()">Hi Alex, <b>café</b> at 3?</p><img src="https://tracker.example/p.gif" width="1" height="1"><img src="https://cdn.example/a.png">',
  '--b2--',
  '--b1',
  'Content-Type: application/pdf; name="=?utf-8?q?Pl=C3=A4n.pdf?="',
  'Content-Disposition: attachment; filename="=?utf-8?q?Pl=C3=A4n.pdf?="',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 test').toString('base64'),
  '--b1--',
  '',
].join('\r\n');

let dovecot: Awaited<ReturnType<typeof startDovecot>> = null;
let mail: typeof import('../electron/services/pim/mail');

beforeAll(async () => {
  dovecot = await startDovecot();
  mail = await import('../electron/services/pim/mail');
}, 30_000);
afterAll(() => dovecot?.stop());

const account = (): Account => ({ id: 'test', kind: 'imap', label: 'Test', email: 'ana@example.org', identities: [{ name: 'Ana', email: 'ana@example.org' }], imap: { host: '127.0.0.1', port: dovecot!.port, security: 'none', user: 'ana' }, mail: true, calendar: false, contacts: false });

describe('IMAP against Dovecot', () => {
  it.skipIf(!fs.existsSync('/usr/sbin/dovecot'))('lists folders, syncs, reads, flags, moves, searches and watches', async () => {
    const m = new mail.MailAccount(account(), async () => ({ user: 'ana', pass: 'secret' }));
    await m.append('INBOX', RAW('Lunch'), []);
    await m.append('INBOX', RAW('Second', 'In-Reply-To: <Lunch@example.org>\r\nReferences: <Lunch@example.org>'), []);
    const folders = await m.folders();
    expect(folders.map((f) => [f.path, f.special])).toEqual(expect.arrayContaining([['INBOX', 'inbox'], ['Sent', 'sent'], ['Trash', 'trash'], ['Archive', 'archive']]));
    expect(folders.find((f) => f.path === 'INBOX')).toMatchObject({ unread: 2, total: 2 });

    const r = await m.sync('INBOX');
    expect(r.added).toHaveLength(2);
    const lunch = r.messages.find((x) => x.subject === 'Lunch')!;
    expect(lunch).toMatchObject({ from: { name: 'Ana Lopez', address: 'ana@example.org' }, seen: false, hasAttachments: true, messageId: 'Lunch@example.org' });
    expect(lunch.snippet).toBe('Hi Alex, café at 3? See the plan attached.');
    expect(r.messages.find((x) => x.subject === 'Second')!.references).toEqual(['Lunch@example.org']);

    const { body } = await m.body('INBOX', lunch.uid);
    expect(body.attachments.map((a) => a.filename)).toEqual(['Plän.pdf']);
    expect(body.html).toContain('café');
    expect(body.text).toContain('café at 3');

    await m.setFlags('INBOX', [lunch.uid], '\\Seen', true);
    await m.setFlags('INBOX', [lunch.uid], '\\Flagged', true);
    const again = await m.sync('INBOX');
    expect(again.added).toHaveLength(0);
    expect(again.messages.find((x) => x.uid === lunch.uid)).toMatchObject({ seen: true, flagged: true });

    expect(await m.search('INBOX', 'Second')).toHaveLength(1);

    // The server says when mail arrives (IDLE); nothing polls.
    let told = 0;
    await m.watch('INBOX', () => { told++; });
    await new Promise((res) => setTimeout(res, 1500));
    await m.append('INBOX', RAW('Third'), []);
    for (let i = 0; i < 40 && !told; i++) await new Promise((res) => setTimeout(res, 100));
    expect(told).toBeGreaterThan(0);

    await m.move('INBOX', [lunch.uid], 'Archive');
    expect((await m.sync('Archive')).messages.map((x) => x.subject)).toEqual(['Lunch']);
    const inbox = await m.sync('INBOX');
    expect(inbox.messages.map((x) => x.subject).sort()).toEqual(['Second', 'Third']);
    await m.remove('INBOX', [inbox.messages[0].uid], 'Trash');
    expect((await m.sync('Trash')).messages).toHaveLength(1);
    await m.stop();
  }, 30_000);

  it.skipIf(!fs.existsSync('/usr/sbin/dovecot'))('refuses a wrong password', async () => {
    const m = new mail.MailAccount(account(), async () => ({ user: 'ana', pass: 'wrong' }));
    await expect(m.test()).rejects.toThrow();
  }, 15_000);
});

describe('SMTP', () => {
  it('sends a composed message with threading headers, Markdown HTML and an attachment', async () => {
    const got: { from: string; to: string[]; raw: Buffer }[] = [];
    const server = new SMTPServer({
      authOptional: false, secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
      onAuth: (a, _s, cb) => (a.username === 'ana' && a.password === 'secret' ? cb(null, { user: 'ana' }) : cb(new Error('Invalid login'))),
      onData: (stream, s, cb) => { const chunks: Buffer[] = []; stream.on('data', (c: Buffer) => chunks.push(c)); stream.on('end', () => { got.push({ from: (s.envelope.mailFrom as { address: string }).address, to: s.envelope.rcptTo.map((x) => x.address), raw: Buffer.concat(chunks) }); cb(); }); },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.server.address() as { port: number }).port;
    const file = path.join(process.env.KEEPER_PIM_DIR!, 'brief.txt');
    fs.writeFileSync(file, 'the brief');
    const acc: Account = { ...account(), imap: undefined, smtp: { host: '127.0.0.1', port, security: 'none', user: 'ana' } } as Account;
    const { raw, envelope } = await mail.compose({
      from: { name: 'Ana', address: 'ana@example.org' }, to: [{ name: 'Bob', address: 'bob@example.org' }], cc: [], bcc: [{ address: 'secret@example.org' }],
      subject: 'Re: Plans', text: 'Yes **please**', html: '<p>Yes <strong>please</strong></p>', inReplyTo: 'm1@x', references: ['m0@x', 'm1@x'], attachments: [{ filename: 'brief.txt', path: file }],
    });
    expect(envelope.to.sort()).toEqual(['bob@example.org', 'secret@example.org']);
    await mail.smtpVerify(acc, { user: 'ana', pass: 'secret' });
    await mail.smtpSend(acc, { user: 'ana', pass: 'secret' }, raw, envelope);
    await expect(mail.smtpSend(acc, { user: 'ana', pass: 'nope' }, raw, envelope)).rejects.toThrow();
    expect(got).toHaveLength(1);
    const p = await simpleParser(got[0].raw);
    expect(p.subject).toBe('Re: Plans');
    expect(p.inReplyTo).toBe('<m1@x>');
    expect(p.html).toContain('<strong>please</strong>');
    expect(p.attachments[0].filename).toBe('brief.txt');
    // Bcc recipients get it but are not written in the message.
    expect(got[0].raw.toString()).not.toContain('secret@example.org');
    server.close();
  }, 20_000);
});

describe('CalDAV against a test server', () => {
  it('discovers calendars, syncs incrementally, writes, edits one occurrence and deletes', async () => {
    const dav = await import('../electron/services/pim/dav');
    const s = await startCalDav();
    const auth = { basic: { user: 'ana', pass: 'secret' } };
    await expect(dav.discover(s.url, { basic: { user: 'ana', pass: 'bad' } })).rejects.toThrow('did not accept');
    const d = await dav.discover(s.url, auth);
    expect(d.calendars.map((c) => [c.name, c.color, c.components.join()])).toEqual([['Work', '#FF2968', 'VEVENT'], ['Tasks', '#0A84FF', 'VTODO']]);
    const work = d.calendars[0].url;

    // Another app adds an event; the first sync gets everything and a token.
    s.put('/dav/cal/ana/work/', 'a.ics', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\nSUMMARY:Existing\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
    const first = await dav.syncCalendar(work, 'w', auth, undefined, { from: 0, to: Date.UTC(2030, 0, 1) });
    expect(first.full).toBe(true);
    expect(first.events.map((e) => e.title)).toEqual(['Existing']);
    expect(first.syncToken).toMatch(/sync\//);

    // Keeper writes a repeating event.
    const standup: CalEvent = { id: 'w:standup', calendar: 'w', uid: 'standup', title: 'Standup', start: Date.UTC(2026, 10, 2, 9), end: Date.UTC(2026, 10, 2, 9, 15), allDay: false, rrule: 'FREQ=DAILY;COUNT=5', alarms: [{ minutesBefore: 5 }] };
    const saved = await dav.putEvent(work, auth, [standup]);
    expect(saved.etag).toBeTruthy();
    // Writing again without the version is refused (someone may have changed it).
    await expect(dav.putEvent(work, auth, [standup])).rejects.toThrow();

    // Only what changed comes back next time.
    const second = await dav.syncCalendar(work, 'w', auth, first.syncToken, { from: 0, to: Date.UTC(2030, 0, 1) });
    expect(second.full).toBe(false);
    expect(second.events.map((e) => e.title)).toEqual(['Standup']);

    // One occurrence moved: the master and the change are stored as one object.
    const moved: CalEvent = { ...standup, recurrenceId: Date.UTC(2026, 10, 4, 9), start: Date.UTC(2026, 10, 4, 11), end: Date.UTC(2026, 10, 4, 11, 15), rrule: undefined, title: 'Standup (late)' };
    const again = await dav.putEvent(work, auth, [standup, moved], saved);
    const stored = s.cals['/dav/cal/ana/work/'].items.get(new URL(saved.href).pathname)!.data;
    expect(stored).toContain('RECURRENCE-ID:20261104T090000Z');
    const occ = occurrences(parseEvents(stored, 'w'), Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 10));
    expect(occ.map((o) => new Date(o.start).toISOString().slice(5, 16))).toEqual(['11-02T09:00', '11-03T09:00', '11-04T11:00', '11-05T09:00', '11-06T09:00']);

    // Removed elsewhere: the next sync reports it gone.
    s.remove('/dav/cal/ana/work/a.ics');
    const third = await dav.syncCalendar(work, 'w', auth, second.syncToken, { from: 0, to: Date.UTC(2030, 0, 1) });
    expect(third.removedHrefs.some((h) => h.endsWith('/a.ics'))).toBe(true);

    await dav.deleteHref(saved.href, auth, again.etag);
    expect(s.cals['/dav/cal/ana/work/'].items.size).toBe(0);

    // Tasks.
    const t = await dav.putTodo(d.calendars[1].url, auth, { id: 't', list: 'tasks', uid: 'pay', title: 'Pay rent', due: Date.UTC(2026, 10, 1, 9), done: false });
    const sync = await dav.syncCalendar(d.calendars[1].url, 'tasks', auth, undefined, { from: 0, to: Date.UTC(2030, 0, 1) });
    expect(sync.todos.map((x) => [x.title, x.done])).toEqual([['Pay rent', false]]);
    expect(t.href).toContain('/dav/cal/ana/tasks/');
    await s.stop();
  }, 20_000);
});

describe('OAuth sign-in (loopback)', () => {
  it('opens the provider page, takes the code from the redirect and exchanges it with PKCE', async () => {
    const { signIn } = await import('../electron/services/pim/oauth');
    const { vi } = await import('vitest');
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      posted.push(init.body);
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      // The "browser": follows the authorization address straight back to Keeper with a code.
      const browser = async (url: string) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'the-code');
        back.searchParams.set('state', u.searchParams.get('state')!);
        const http = await import('node:http');
        await new Promise<void>((r) => http.get(back.toString(), (res) => { res.resume(); res.on('end', () => r()); }));
      };
      const t = await signIn('google', { clientId: 'cid' }, 'a@gmail.com', browser);
      expect(t.access).toBe('at');
      expect(t.refresh).toBe('rt');
      const body = new URLSearchParams(posted[0]);
      expect(body.get('code')).toBe('the-code');
      expect(body.get('code_verifier')?.length).toBeGreaterThan(40);
      expect(body.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

      // A redirect with the wrong state is refused.
      const forged = async (url: string) => {
        const back = new URL(new URL(url).searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'x');
        back.searchParams.set('state', 'not-it');
        const http = await import('node:http');
        await new Promise<void>((r) => http.get(back.toString(), (res) => { res.resume(); res.on('end', () => r()); }));
      };
      await expect(signIn('microsoft', { clientId: 'cid' }, undefined, forged)).rejects.toThrow('did not match');
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);
});
