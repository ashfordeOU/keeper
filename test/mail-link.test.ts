// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { mailIdIn, mailLink, notesFromMessage } from '../core/pim/mail-link';

describe('links from tasks and events back to mail', () => {
  it('round-trips a message id with colons, slashes and spaces', () => {
    const id = 'acc1:INBOX/Receipts 2026:4512';
    expect(mailIdIn(`Pay this\n${mailLink(id)}`)).toBe(id);
    expect(mailIdIn('nothing here')).toBeNull();
    expect(mailIdIn('keeper://mail/compose')).toBeNull();
  });
  it('notes say who it is from and keep the link', () => {
    const n = notesFromMessage({ id: 'a:INBOX:1', subject: 'Invoice 42', from: { name: 'Acme', address: 'billing@acme.test' } });
    expect(n).toMatch(/^From an email from Acme <billing@acme\.test>: Invoice 42/);
    expect(mailIdIn(n)).toBe('a:INBOX:1');
  });
});
