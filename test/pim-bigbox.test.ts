// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A big mailbox against Dovecot: folders (nested and special) with their
// unread numbers, the first page quickly, scrolling back page after page
// without stalling or losing what was loaded at the next check, the server's
// search for old mail, and an old message opening with its attachment.
// 3,000 messages by default; KEEPER_BIG_MAILBOX=50000 for the full-size run.
// The mailbox is written straight into Dovecot's Maildir and removed after.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../core/pim/types';

const require = createRequire(import.meta.url);
const { startDovecot } = require('./servers/dovecot.cjs') as { startDovecot: () => Promise<{ port: number; dir: string; stop: () => void } | null> };

const COUNT = Number(process.env.KEEPER_BIG_MAILBOX) || 3000;
process.env.KEEPER_PIM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-bigbox-'));
const HAS = fs.existsSync('/usr/sbin/dovecot');

let dovecot: Awaited<ReturnType<typeof startDovecot>> = null;
let mail: typeof import('../electron/services/pim/mail');

const message = (i: number) => {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 3_600_000);
  const att = i % 500 === 7;
  return [
    `From: Sender ${i % 97} <s${i % 97}@example.org>`, 'To: Ana <ana@example.org>', `Subject: Message number ${i}`, `Message-ID: <m${i}@example.org>`, `Date: ${d.toUTCString()}`, 'MIME-Version: 1.0',
    ...(att ? ['Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/plain', '', `Body ${i} with a file.`, '--b', 'Content-Type: text/plain; name="file.txt"', 'Content-Disposition: attachment; filename="file.txt"', '', 'attached', '--b--'] : ['Content-Type: text/plain', '', `Body of message ${i}.`]),
    '',
  ].join('\r\n');
};

beforeAll(async () => {
  if (!HAS) return;
  dovecot = await startDovecot();
  if (!dovecot) return;
  const md = path.join(dovecot.dir, 'home/ana/Maildir');
  // Maildir++: INBOX in cur/, a nested folder as ".Projects.2026"; two thirds of the inbox read.
  for (const sub of ['cur', 'new', 'tmp', '.Projects.2026/cur', '.Projects.2026/new', '.Projects.2026/tmp', '.Projects/cur', '.Projects/new', '.Projects/tmp']) fs.mkdirSync(path.join(md, sub), { recursive: true });
  const t = Math.floor(Date.now() / 1000);
  for (let i = 0; i < COUNT; i++) fs.writeFileSync(path.join(md, 'cur', `${t}.M${i}P1.keeper:2,${i % 3 ? 'S' : ''}`), message(i));
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(md, '.Projects.2026/cur', `${t}.N${i}P1.keeper:2,`), message(COUNT + i));
  fs.writeFileSync(path.join(md, 'subscriptions'), 'Projects\nProjects.2026\n');
  if (os.userInfo().uid === 0) execFileSync('chown', ['-R', 'dovecot:dovecot', path.join(dovecot.dir, 'home/ana')]);
  mail = await import('../electron/services/pim/mail');
}, 600_000);
afterAll(() => {
  dovecot?.stop();
  fs.rmSync(process.env.KEEPER_PIM_DIR!, { recursive: true, force: true });
});

const account = (): Account => ({ id: 'big', kind: 'imap', label: 'Big', email: 'ana@example.org', identities: [], imap: { host: '127.0.0.1', port: dovecot?.port ?? 0, security: 'none', user: 'ana' }, mail: true, calendar: false, contacts: false });

describe(`a mailbox of ${COUNT.toLocaleString('en-US')} messages`, () => {
  it.skipIf(!HAS)('lists every folder with the right numbers, pages back smoothly, searches and opens old mail', async () => {
    const m = new mail.MailAccount(account(), async () => ({ user: 'ana', pass: 'secret' }));
    let t0 = Date.now();
    const folders = await m.folders();
    const listMs = Date.now() - t0;
    const inbox = folders.find((f) => f.path === 'INBOX')!;
    expect(inbox).toMatchObject({ special: 'inbox', total: COUNT, unread: Math.ceil(COUNT / 3) });
    expect(folders.find((f) => f.path.replace(/[./]/g, '/') === 'Projects/2026')).toMatchObject({ total: 40, unread: 40 });
    expect(folders.some((f) => f.special === 'sent') && folders.some((f) => f.special === 'trash')).toBe(true);

    t0 = Date.now();
    const first = await m.sync('INBOX');
    const firstMs = Date.now() - t0;
    expect(first.messages).toHaveLength(Math.min(300, COUNT));
    expect(first.messages[0].subject).toBe(`Message number ${COUNT - 1}`);

    // Scrolling back: each page adds older mail, and a check in between keeps it.
    let list = first.messages;
    const pageTimes: number[] = [];
    for (let p = 0; p < 6 && list.length < COUNT; p++) {
      t0 = Date.now();
      const next = await m.older('INBOX');
      pageTimes.push(Date.now() - t0);
      expect(next.length).toBeGreaterThan(list.length);
      list = next;
      if (p === 2) expect((await m.sync('INBOX')).messages.length).toBe(list.length);
    }
    const oldestShown = Math.min(...list.map((x) => x.uid));
    expect(new Set(list.map((x) => x.uid)).size).toBe(list.length);
    // The server's search finds mail far older than the list holds.
    const found = await m.search('INBOX', 'Message number 3');
    expect(found.length).toBeGreaterThan(0);
    const old = await m.summaries('INBOX', [Math.min(...found)]);
    expect(old[0].uid).toBeLessThan(oldestShown + 1 + COUNT);
    // Several words (each an OR of subject, sender and text) and a word left out, as one server search.
    const { imapCriteria, parseMailQuery } = await import('../core/pim/search');
    const many = await m.searchWith('INBOX', imapCriteria(parseMailQuery('message number 1234'))!, { limit: 1000 });
    const subjects = (await m.summaries('INBOX', many)).map((x) => x.subject);
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects.every((x) => /Message number \d*1234/.test(x))).toBe(true);
    const without = await m.searchWith('INBOX', imapCriteria(parseMailQuery('number 1234 -11234'))!, { limit: 1000 });
    expect((await m.summaries('INBOX', without)).some((x) => x.subject.includes('11234'))).toBe(false);
    // An old message with an attachment opens.
    const withFile = (await m.search('INBOX', 'Body 7 with a file')).sort((a, b) => a - b)[0];
    const { body } = await m.body('INBOX', withFile);
    expect(body.attachments.map((a) => a.filename)).toEqual(['file.txt']);
    await m.stop();
    console.log(`big mailbox ${COUNT}: folders ${listMs} ms, first page ${firstMs} ms, older pages ${pageTimes.join('/')} ms, kept ${list.length}`);
    expect(firstMs).toBeLessThan(COUNT > 10_000 ? 60_000 : 20_000);
    expect(Math.max(...pageTimes)).toBeLessThan(20_000);
  }, 900_000);
});
