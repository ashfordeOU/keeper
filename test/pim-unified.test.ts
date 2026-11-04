// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Combined mailboxes: chosen accounts' inboxes or folders read as one list.

import { describe, expect, it } from 'vitest';
import { inboxOnly, mergeFolders, resolveSources, suggestName, unifiedUnread } from '../core/pim/unified';
import type { MailFolder, MessageSummary } from '../core/pim/types';

const folders: MailFolder[] = [
  { account: 'w', path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 3, total: 10 },
  { account: 'w', path: 'Sent Items', name: 'Sent Items', special: 'sent', unread: 0, total: 4 },
  { account: 'w', path: 'Clients/Acme', name: 'Acme', unread: 2, total: 5 },
  { account: 'h', path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 1, total: 3 },
  { account: 'h', path: '[Gmail]/Sent Mail', name: 'Sent Mail', special: 'sent', unread: 0, total: 9 },
];
const m = (id: string, date: number, messageId?: string): MessageSummary => ({ id, account: id.split(':')[0], folder: 'INBOX', uid: 1, subject: id, to: [], cc: [], date, seen: false, flagged: false, answered: false, snippet: '', hasAttachments: false, messageId });

describe('combined mailboxes', () => {
  it('finds each account’s own special folder and leaves missing ones out', () => {
    expect(resolveSources({ sources: [{ account: 'w', folder: 'sent' }, { account: 'h', folder: 'sent' }, { account: 'h', folder: 'archive' }] }, folders)).toEqual([
      { account: 'w', folder: 'Sent Items' }, { account: 'h', folder: '[Gmail]/Sent Mail' },
    ]);
    expect(resolveSources({ sources: [{ account: 'w', folder: 'Clients/Acme' }, { account: 'w', folder: 'Gone' }, { account: 'w', folder: 'Clients/Acme' }] }, folders)).toEqual([{ account: 'w', folder: 'Clients/Acme' }]);
  });
  it('treats inbox-only combinations like inboxes and counts unread', () => {
    expect(inboxOnly({ sources: [{ account: 'w', folder: 'inbox' }, { account: 'h', folder: 'INBOX' }] })).toBe(true);
    expect(inboxOnly({ sources: [{ account: 'w', folder: 'inbox' }, { account: 'w', folder: 'Clients/Acme' }] })).toBe(false);
    expect(unifiedUnread({ sources: [{ account: 'w', folder: 'inbox' }, { account: 'w', folder: 'Clients/Acme' }] }, folders)).toBe(5);
  });
  it('merges newest first and shows a message sent to two accounts once', () => {
    const got = mergeFolders([[m('w:1', 10, 'same@x'), m('w:2', 30)], [m('h:1', 20, 'same@x'), m('h:2', 40)]]);
    expect(got.map((x) => x.id)).toEqual(['h:2', 'w:2', 'h:1']);
  });
  it('suggests a short name', () => {
    const label = (a: string) => (a === 'w' ? 'Work' : 'Home');
    expect(suggestName([{ account: 'w', folder: 'inbox' }, { account: 'h', folder: 'inbox' }], label)).toBe('Work + Home inboxes');
    expect(suggestName([{ account: 'w', folder: 'sent' }, { account: 'w', folder: 'Clients/Acme' }], label)).toBe('Work mail');
  });
});
