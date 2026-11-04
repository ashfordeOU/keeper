// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// POP3 accounts: answers and plans, then downloading from a stand-in server
// into the mailbox on this computer, keeping a copy or not, nothing twice,
// dot-stuffed lines read right, and a wrong password said plainly.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { multiLineEnd, parseUidl, pop3Plan, statusLine, unstuff } from '../core/pim/pop3';
import type { Account } from '../core/pim/types';

const require = createRequire(import.meta.url);
const { startPop3 } = require('./servers/pop3.cjs') as { startPop3: (o: { password?: string; messages?: string[] }) => Promise<{ port: number; log: string[]; box: { deleted: boolean }[]; add: (raw: string) => void; stop: () => Promise<void> }> };
process.env.KEEPER_PIM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-pop3-'));
afterAll(() => fs.rmSync(process.env.KEEPER_PIM_DIR!, { recursive: true, force: true }));

const msg = (s: string, body = `About ${s}.`) => [`From: Ana <ana@example.org>`, 'To: Ben <ben@example.org>', `Subject: ${s}`, `Message-ID: <${s.replace(/\W/g, '')}@example.org>`, 'Date: Mon, 2 Nov 2026 10:00:00 +0000', '', body].join('\r\n');

describe('POP3 answers', () => {
  it('reads status lines, multi-line ends, dot-stuffing and UIDL', () => {
    expect(statusLine('+OK 2 messages')).toEqual({ ok: true, text: '2 messages' });
    expect(statusLine('-ERR [AUTH] nope')).toEqual({ ok: false, text: '[AUTH] nope' });
    expect(multiLineEnd(Buffer.from('a\r\nb\r\n.\r\n'))).toBe(6);
    expect(multiLineEnd(Buffer.from('.\r\n'))).toBe(0);
    expect(multiLineEnd(Buffer.from('a\r\nb'))).toBe(-1);
    expect(unstuff(Buffer.from('..hidden\r\nplain\r\n')).toString()).toBe('.hidden\r\nplain\r\n');
    expect(parseUidl('1 abc\r\n2 def\r\n')).toEqual([{ n: 1, uid: 'abc' }, { n: 2, uid: 'def' }]);
  });
  it('plans what to download and what to remove', () => {
    const list = [{ n: 1, uid: 'a' }, { n: 2, uid: 'b' }];
    expect(pop3Plan(list, { a: 1 }, { keep: true, now: 2 })).toEqual({ fetch: [{ n: 2, uid: 'b' }], remove: [] });
    expect(pop3Plan(list, { a: 1 }, { keep: false, now: 2 })).toEqual({ fetch: [{ n: 2, uid: 'b' }], remove: [1] });
    expect(pop3Plan(list, { a: 0 }, { keep: true, now: 8 * 86_400_000, removeAfterDays: 7 }).remove).toEqual([1]);
  });
});

describe('a POP3 account', () => {
  const account = (port: number, keep: boolean, id: string): Account => ({ id, kind: 'pop3', label: 'Pop', email: 'ana@example.org', identities: [], pop3: { host: '127.0.0.1', port, security: 'none', user: 'ana' }, keepOnServer: keep, mail: true, calendar: false, contacts: false });

  it('downloads new mail once and keeps a copy on the server', async () => {
    const srv = await startPop3({ password: 'pw-1', messages: [msg('First'), msg('Dots', 'line\r\n.starts with a dot\r\nend')] });
    const { Pop3Mailbox } = await import('../electron/services/pim/pop3');
    const box = new Pop3Mailbox(account(srv.port, true, 'pop-keep'), async () => ({ user: 'ana', pass: 'pw-1' }));
    try {
      const first = await box.sync('INBOX');
      expect(first.added.map((m) => m.subject).sort()).toEqual(['Dots', 'First']);
      expect(first.messages).toHaveLength(2);
      const dots = first.messages.find((m) => m.subject === 'Dots')!;
      const { body } = await box.body('INBOX', dots.uid);
      expect(body.text).toContain('\n.starts with a dot');
      srv.add(msg('Third'));
      const again = await box.sync('INBOX');
      expect(again.added.map((m) => m.subject)).toEqual(['Third']);
      expect(again.messages).toHaveLength(3);
      expect(srv.box.every((m) => !m.deleted)).toBe(true);
      expect(srv.log.some((l) => /pw-1/.test(l))).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('removes from the server when no copy is kept', async () => {
    const srv = await startPop3({ messages: [msg('Gone soon')] });
    const { Pop3Mailbox } = await import('../electron/services/pim/pop3');
    const box = new Pop3Mailbox(account(srv.port, false, 'pop-move'), async () => ({ user: 'ana', pass: 'secret' }));
    try {
      expect((await box.sync('INBOX')).added).toHaveLength(1);
      expect(srv.box.every((m) => m.deleted)).toBe(true);
      expect((await box.sync('INBOX')).messages).toHaveLength(1);
    } finally {
      await srv.stop();
    }
  });

  it('says plainly when the password is wrong, and refuses no encryption elsewhere', async () => {
    const srv = await startPop3({});
    const { Pop3Mailbox } = await import('../electron/services/pim/pop3');
    try {
      await expect(new Pop3Mailbox(account(srv.port, true, 'pop-bad'), async () => ({ user: 'ana', pass: 'wrong' })).test()).rejects.toThrow(/did not accept the user name or password/);
      const far = { ...account(110, true, 'pop-far'), pop3: { host: 'pop.example.com', port: 110, security: 'none' as const } };
      await expect(new Pop3Mailbox(far, async () => ({ user: 'ana', pass: 'x' })).test()).rejects.toThrow(/without encryption/);
    } finally {
      await srv.stop();
    }
  });
});
