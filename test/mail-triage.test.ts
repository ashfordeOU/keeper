// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail sorting and follow-up: Important / Other with security alerts, sent
// mail waiting for an answer, subscriptions, snooze and send-later times, the
// undo-send window, keyboard-shortcut sets, and the limits on what coding
// assistants may see of mail over MCP.

import { describe, expect, it } from 'vitest';
import { hiddenFolder, mailMcp, MAIL_TOOLS, visibleToAgents, type MailMcpBackend } from '../core/pim/mail-mcp';
import { matchesQuery } from '../core/pim/mail';
import { bindings, comboOf, makeResolver, showCombo } from '../core/pim/shortcuts';
import {
  canUndo, classify, dueSnoozes, followUpDraft, hasSignInCode, isAutomatedSender, isOfflineError, isSecurityAlert, isSnoozed, keywords, mergeResults,
  nextSnoozeWake, outboxPhase, pickForQuestion, redactCodes, sendLaterChoices, snoozeChoices, sortTime, splitSuggestions, subscriptions, triageContext,
  voiceSamples, waitingForReply,
} from '../core/pim/triage';
import { knownProvider } from '../core/pim/autoconfig';
import type { Account, MailFolder, MessageSummary } from '../core/pim/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 10, 0).getTime(); // a Wednesday, 10:00
let uid = 0;
const msg = (o: Partial<MessageSummary> & { from?: MessageSummary['from'] }): MessageSummary => {
  const u = ++uid;
  return { id: `a:INBOX:${u}`, account: 'a', folder: 'INBOX', uid: u, subject: 'Hello', to: [{ address: 'me@x.org' }], cc: [], date: NOW - DAY, seen: false, flagged: false, answered: false, snippet: '', hasAttachments: false, ...o };
};
const ana = { name: 'Ana Lopez', address: 'ana@lopez.example' };

describe('Important and Other', () => {
  const ctx = triageContext({ me: ['me@x.org'], sent: [msg({ folder: 'Sent', from: { address: 'me@x.org' }, to: [{ address: 'bob@friend.example' }], messageId: 'mine-1@x' })], contacts: ['ana@lopez.example'] });

  it('puts people you know and replies to your mail in Important', () => {
    expect(classify(msg({ from: ana }), ctx).category).toBe('important');
    expect(classify(msg({ from: { address: 'bob@friend.example' } }), ctx)).toMatchObject({ category: 'important', why: 'Someone you write to' });
    expect(classify(msg({ from: { address: 'carol@new.example' }, inReplyTo: 'mine-1@x' }), ctx)).toMatchObject({ category: 'important', why: 'A reply to your mail' });
    // A stranger writing to you directly, by name.
    expect(classify(msg({ from: { name: 'Dee', address: 'dee@company.example' } }), ctx).category).toBe('important');
  });

  it('puts newsletters, receipts and machine mail in Other', () => {
    expect(classify(msg({ from: { address: 'news@shop.example' }, bulk: true, listId: 'news.shop.example' }), ctx).category).toBe('other');
    expect(classify(msg({ from: { address: 'orders@shop.example' } }), ctx).category).toBe('other');
    expect(classify(msg({ from: { address: 'no-reply@service.example' } }), ctx).category).toBe('other');
    expect(classify(msg({ from: { address: 'hello@em.brand.example' } }), ctx).category).toBe('other');
    // Sent to a list you are on, not to you.
    expect(classify(msg({ from: { address: 'dee@company.example' }, to: [{ address: 'all@company.example' }] }), ctx).category).toBe('other');
    // Even a contact's newsletter is Other.
    expect(classify(msg({ from: ana, unsub: { url: 'https://x/u' } }), ctx).category).toBe('other');
  });

  it('always puts security alerts in Important, even from machines and lists', () => {
    for (const subject of ['New sign-in to your account', 'Your verification code is 482913', 'Reset your password', 'Security alert: unusual activity', 'Your one-time code', 'Confirm your sign-in', 'Ihr Bestätigungscode']) {
      const t = classify(msg({ from: { address: 'no-reply@accounts.example' }, subject, bulk: true }), ctx);
      expect(t, subject).toMatchObject({ category: 'important', security: true });
    }
    expect(classify(msg({ from: { address: 'no-reply@bank.example' }, subject: 'Notice', snippet: 'We noticed a new sign-in from Firefox on Linux' }), ctx).security).toBe(true);
    // Ordinary mail mentioning a password is not an alert.
    expect(isSecurityAlert({ subject: 'Lunch?', snippet: 'Want to grab lunch on Friday?' })).toBe(false);
    expect(isSecurityAlert({ subject: 'Spring sale', snippet: '30% off everything' })).toBe(false);
  });

  it('follows the person\'s own choice for a sender, but never hides a security alert', () => {
    const own = triageContext({ me: ['me@x.org'], sent: [], important: ['orders@shop.example'], other: ['ANA@lopez.example'] });
    expect(classify(msg({ from: { address: 'orders@shop.example' } }), own).category).toBe('important');
    expect(classify(msg({ from: ana }), own).category).toBe('other');
    expect(classify(msg({ from: ana, subject: 'Your login code' }), own).category).toBe('important');
  });

  it('knows machine senders', () => {
    expect(isAutomatedSender({ address: 'noreply@x.com' })).toBe(true);
    expect(isAutomatedSender({ address: 'newsletter+weekly@x.com' })).toBe(true);
    expect(isAutomatedSender({ address: 'ana@x.com' })).toBe(false);
    expect(isAutomatedSender(undefined)).toBe(true);
  });

  it('searches by label and Important / Other', () => {
    const m = { ...msg({ labels: ['Invoices', 'Work/Clients'] }), category: 'important' as const };
    expect(matchesQuery(m, 'label:invoices')).toBe(true);
    expect(matchesQuery(m, 'label:clients')).toBe(true);
    expect(matchesQuery(m, 'label:travel')).toBe(false);
    expect(matchesQuery(m, 'in:important')).toBe(true);
    expect(matchesQuery(m, 'in:other')).toBe(false);
  });
});

describe('sign-in codes', () => {
  it('finds codes next to code words only', () => {
    expect(hasSignInCode('Your verification code is 482913')).toBe(true);
    expect(hasSignInCode('Use 123 456 to sign in')).toBe(true);
    expect(hasSignInCode('Your login code: AB12CD')).toBe(true);
    expect(hasSignInCode('Meet at 1500 on Friday')).toBe(false);
    expect(hasSignInCode('Order 20931 has shipped')).toBe(false);
  });
  it('blanks them in text', () => {
    expect(redactCodes('Your code is 482913.')).not.toContain('482913');
    expect(redactCodes('Use code: AB12CD to continue')).not.toContain('AB12CD');
    expect(redactCodes('The meeting is at 3pm in room 214')).toBe('The meeting is at 3pm in room 214');
  });
});

describe('waiting for a reply', () => {
  const me = ['me@x.org'];
  const sent = (o: Partial<MessageSummary>) => msg({ folder: 'Sent', from: { name: 'Me', address: 'me@x.org' }, to: [ana], ...o });

  it('lists your sent mail that nobody answered, across folders', () => {
    const q = sent({ subject: 'Quote', messageId: 'q1@x', date: NOW - 5 * DAY });
    const answered = sent({ subject: 'Lunch?', messageId: 'l1@x', date: NOW - 4 * DAY });
    const reply = msg({ from: ana, subject: 'Re: Lunch?', inReplyTo: 'l1@x', references: ['l1@x'], date: NOW - 3 * DAY });
    const w = waitingForReply([q, answered, reply], me, NOW);
    expect(w.map((x) => x.message.subject)).toEqual(['Quote']);
    expect(w[0]).toMatchObject({ days: 5, to: [ana] });
  });

  it('puts a conversation back on the list when you wrote last', () => {
    const a1 = sent({ messageId: 't1@x', date: NOW - 6 * DAY, subject: 'Plan' });
    const r1 = msg({ from: ana, messageId: 't2@l', inReplyTo: 't1@x', references: ['t1@x'], date: NOW - 5 * DAY, subject: 'Re: Plan' });
    const a2 = sent({ messageId: 't3@x', inReplyTo: 't2@l', references: ['t1@x', 't2@l'], date: NOW - 2 * DAY, subject: 'Re: Plan' });
    const w = waitingForReply([a1, r1, a2], me, NOW);
    expect(w).toHaveLength(1);
    expect(w[0].message.id).toBe(a2.id);
    expect(w[0].thread.messages).toHaveLength(3);
  });

  it('counts a copy of the same message once, skips machines, old mail, dismissed and mail to yourself', () => {
    const a = sent({ messageId: 'dup@x', date: NOW - DAY });
    const copy = { ...a, id: 'a:[Gmail]/All Mail:9', folder: '[Gmail]/All Mail' };
    expect(waitingForReply([a, copy], me, NOW)).toHaveLength(1);
    expect(waitingForReply([sent({ to: [{ address: 'noreply@shop.example' }] })], me, NOW)).toHaveLength(0);
    expect(waitingForReply([sent({ date: NOW - 60 * DAY })], me, NOW, { maxDays: 30 })).toHaveLength(0);
    expect(waitingForReply([sent({ messageId: 'gone@x' })], me, NOW, { dismissed: ['gone@x'] })).toHaveLength(0);
    expect(waitingForReply([sent({ to: [{ address: 'ME@x.org' }] })], me, NOW)).toHaveLength(0);
    expect(waitingForReply([sent({ date: NOW - 3_600_000 })], me, NOW, { minDays: 1 })).toHaveLength(0);
  });

  it('writes a follow-up to the same people in the same conversation', () => {
    const m = sent({ subject: 'Quote for the refresh', messageId: 'q@x', references: ['earlier@l'], cc: [{ address: 'sam@x.org' }], text: 'Here is the quote.' } as Partial<MessageSummary>);
    const d = followUpDraft({ ...m, text: 'Here is the quote.' }, me);
    expect(d.to).toEqual([ana]);
    expect(d.cc).toEqual([{ address: 'sam@x.org' }]);
    expect(d.subject).toBe('Re: Quote for the refresh');
    expect(d.inReplyTo).toBe('q@x');
    expect(d.references).toEqual(['earlier@l', 'q@x']);
    expect(d.body).toMatch(/^Hi Ana,/);
    expect(d.quoted).toContain('> Here is the quote.');
  });
});

describe('subscriptions', () => {
  it('groups by list or sender and puts the ones you never open first', () => {
    const shop = (seen: boolean, d: number) => msg({ from: { name: 'Shop', address: 'offers@shop.example' }, bulk: true, listId: 'offers.shop.example', unsub: { url: 'https://shop.example/u', oneClick: true }, seen, date: NOW - d * DAY });
    const news = (seen: boolean, d: number) => msg({ from: { name: 'Weekly', address: 'news@weekly.example' }, unsub: { mailto: 'mailto:u@weekly.example' }, seen, date: NOW - d * DAY });
    const list = [shop(false, 1), shop(false, 8), shop(false, 15), news(true, 2), news(false, 9), msg({ from: ana, seen: false }), msg({ from: { address: 'me@x.org' }, bulk: true }), msg({ from: { address: 'no-reply@accounts.example' }, bulk: true, subject: 'New sign-in to your account' })];
    const s = subscriptions(list, ['me@x.org']);
    expect(s.map((x) => x.name)).toEqual(['Shop', 'Weekly']);
    expect(s[0]).toMatchObject({ key: 'list:offers.shop.example', count: 3, opened: 0, neverOpened: true });
    expect(s[0].unsub).toMatchObject({ oneClick: true });
    expect(s[0].ids).toHaveLength(3);
    expect(s[1]).toMatchObject({ count: 2, opened: 1, neverOpened: false });
    expect(s[0].last).toBe(NOW - DAY);
    // The same message in the inbox and in All Mail counts once.
    const one = shop(false, 3);
    const copy = { ...one, id: 'a:[Gmail]/All Mail:77', folder: '[Gmail]/All Mail', messageId: 'same@shop' };
    expect(subscriptions([{ ...one, messageId: 'same@shop' }, copy, shop(false, 4)])[0].count).toBe(2);
  });
});

describe('snooze, send later and undo send', () => {
  it('offers sensible snooze times', () => {
    const c = snoozeChoices(NOW);
    expect(c.map((x) => x.label)).toEqual(['Later today (1:00 PM)', 'This evening', 'Tomorrow morning', 'This weekend', 'Next week'].map((l, i) => (i === 0 ? c[0].label : l)));
    expect(new Date(c.find((x) => x.label === 'Tomorrow morning')!.at).getHours()).toBe(8);
    expect(new Date(c.find((x) => x.label === 'This weekend')!.at).getDay()).toBe(6);
    expect(new Date(c.find((x) => x.label === 'Next week')!.at).getDay()).toBe(1);
    for (const x of c) expect(x.at).toBeGreaterThan(NOW);
    // Late at night there is no "later today" or "this evening".
    const late = snoozeChoices(new Date(2026, 10, 4, 22, 30).getTime()).map((x) => x.label);
    expect(late).not.toContain('This evening');
    expect(late.some((l) => l.startsWith('Later today'))).toBe(false);
  });

  it('offers send-later times in the future', () => {
    const c = sendLaterChoices(NOW);
    expect(c.every((x) => x.at > NOW)).toBe(true);
    expect(c.map((x) => x.label)).not.toContain('This morning (8:00)');
    expect(sendLaterChoices(new Date(2026, 10, 4, 6, 0).getTime())[0].label).toBe('This morning (8:00)');
  });

  it('wakes snoozed mail on time and sorts it as new', () => {
    const snoozes = [{ id: 'a', until: NOW + 1000 }, { id: 'b', until: NOW - 1 }, { id: 'c', until: NOW + 50 }];
    expect(nextSnoozeWake(snoozes, NOW)).toBe(NOW + 50);
    expect(nextSnoozeWake([], NOW)).toBeUndefined();
    const { due, waiting } = dueSnoozes(snoozes, NOW);
    expect(due.map((x) => x.id)).toEqual(['b']);
    expect(waiting.map((x) => x.id)).toEqual(['a', 'c']);
    const m = msg({ date: NOW - 3 * DAY, snoozedUntil: NOW + DAY });
    expect(isSnoozed(m, NOW)).toBe(true);
    expect(isSnoozed(m, NOW + 2 * DAY)).toBe(false);
    expect(sortTime(m, NOW + 2 * DAY)).toBe(NOW + DAY);
    expect(sortTime({ ...m, snoozedUntil: undefined, returnedAt: NOW - 10 }, NOW)).toBe(NOW - 10);
  });

  it('can be undone only before it goes', () => {
    const q = { sendAt: NOW + 10_000, queuedAt: NOW };
    expect(outboxPhase(q, NOW)).toEqual({ phase: 'undo', left: 10_000 });
    expect(canUndo(q, NOW + 9_999)).toBe(true);
    expect(canUndo(q, NOW + 10_000)).toBe(false);
    expect(outboxPhase(q, NOW + 10_001).phase).toBe('due');
    expect(outboxPhase({ sendAt: NOW + DAY, scheduled: true }, NOW).phase).toBe('scheduled');
    expect(canUndo({ sendAt: NOW + DAY, scheduled: true }, NOW)).toBe(true);
    expect(outboxPhase({ sendAt: NOW - 1, error: 'refused' }, NOW).phase).toBe('failed');
    expect(canUndo({ sendAt: NOW + 5, error: 'refused' }, NOW)).toBe(false);
  });

  it('knows when the server is out of reach', () => {
    expect(isOfflineError(Object.assign(new Error('getaddrinfo ENOTFOUND imap.x'), { code: 'ENOTFOUND' }))).toBe(true);
    expect(isOfflineError(new Error('Connection not available'))).toBe(true);
    expect(isOfflineError(new Error('Mailbox does not exist'))).toBe(false);
  });
});

describe('search and AI helpers', () => {
  it('puts local results first and each message once', () => {
    const a = msg({ messageId: 'x1' });
    const b = msg({ messageId: 'x2' });
    const serverCopy = { ...a, id: 'a:Archive:7' };
    expect(mergeResults([a], [serverCopy, b]).map((m) => m.messageId)).toEqual(['x1', 'x2']);
  });

  it('picks the mail that fits a question', () => {
    const flight = msg({ subject: 'Your flight to Lisbon is confirmed', snippet: 'Departure 12 March 07:40', date: NOW - 30 * DAY });
    const other = msg({ subject: 'Book club', snippet: 'Next title', date: NOW - DAY });
    expect(keywords('When does my flight to Lisbon leave?')).toEqual(['flight', 'lisbon', 'leave']);
    expect(pickForQuestion('When does my flight to Lisbon leave?', [other, flight], 5, NOW)).toEqual([flight]);
  });

  it('splits three suggested replies', () => {
    expect(splitSuggestions('Yes, sounds good!\n===\nCould we do Tuesday?\n===\nSorry, not this time.')).toEqual(['Yes, sounds good!', 'Could we do Tuesday?', 'Sorry, not this time.']);
    expect(splitSuggestions('1. Yes please.\n2. Maybe later?\n3. No thanks.')).toEqual(['Yes please.', 'Maybe later?', 'No thanks.']);
    expect(splitSuggestions('Just one reply')).toEqual(['Just one reply']);
  });

  it('learns your voice from your own sent mail only', () => {
    const mine = msg({ from: { address: 'me@x.org' }, snippet: 'Hey! Sounds great, see you there. Cheers, M', date: NOW - DAY });
    const theirs = msg({ from: ana, snippet: 'Dear Sir or Madam, we are pleased to inform you…' });
    expect(voiceSamples([mine, theirs], ['me@x.org'])).toEqual([mine.snippet]);
  });
});

describe('keyboard shortcuts', () => {
  it('reads key presses the same way on every computer', () => {
    expect(comboOf({ key: 'R', metaKey: true, shiftKey: true }, true)).toBe('mod+shift+r');
    expect(comboOf({ key: 'r', ctrlKey: true }, false)).toBe('mod+r');
    expect(comboOf({ key: '#', shiftKey: true }, false)).toBe('#');
    expect(comboOf({ key: 'U', shiftKey: true }, false)).toBe('shift+u');
    expect(comboOf({ key: 'ArrowDown' }, true)).toBe('ArrowDown');
  });

  it('maps each set, with the person\'s changes on top', () => {
    const gmail = bindings('gmail');
    expect(gmail.get('e')).toBe('archive');
    expect(gmail.get('#')).toBe('trash');
    expect(gmail.get('b')).toBe('snooze');
    const apple = bindings('apple');
    expect(apple.get('mod+r')).toBe('reply');
    expect(apple.get('mod+shift+r')).toBe('replyAll');
    expect(apple.get('e')).toBeUndefined();
    const fast = bindings('superhuman');
    expect(fast.get('e')).toBe('archive');
    expect(fast.get('h')).toBe('snooze');
    const own = bindings('gmail', { archive: 'y, Shift+E', trash: '' });
    expect(own.get('y')).toBe('archive');
    expect(own.get('shift+e')).toBe('archive');
    expect(own.get('e')).toBeUndefined();
    expect(own.get('#')).toBeUndefined();
  });

  it('understands two-key sequences', () => {
    const r = makeResolver(bindings('gmail'));
    expect(r('g', 0)).toBe('wait');
    expect(r('i', 100)).toBe('important');
    expect(r('g', 200)).toBe('wait');
    // Too slow: the second key counts on its own.
    expect(r('j', 5000)).toBe('next');
    expect(r('z', 6000)).toBeUndefined();
  });

  it('shows keys the way the computer writes them', () => {
    expect(showCombo('mod+shift+r', true)).toBe('⌘⇧R');
    expect(showCombo('mod+shift+r', false)).toBe('Ctrl+Shift+R');
    expect(showCombo('g i', false)).toBe('G then I');
  });
});

describe('providers', () => {
  it('knows AOL and Zoho too', () => {
    expect(knownProvider('me@aol.com')?.imap?.host).toBe('imap.aol.com');
    expect(knownProvider('me@zoho.eu')?.imap?.host).toBe('imap.zoho.eu');
    expect(knownProvider('me@zohomail.com')?.smtp?.host).toBe('smtp.zoho.com');
  });
  it('links to the page that makes an app password, and says Outlook needs sign-in', () => {
    expect(knownProvider('me@gmail.com')?.appPasswordUrl).toBe('https://myaccount.google.com/apppasswords');
    for (const e of ['me@icloud.com', 'me@yahoo.com', 'me@fastmail.com', 'me@aol.com', 'me@zoho.eu']) expect(knownProvider(e)?.appPasswordUrl).toMatch(/^https:\/\//);
    const ms = knownProvider('me@outlook.com');
    expect(ms?.signInOnly).toBe(true);
    expect(ms?.appPasswordUrl).toBeUndefined();
  });
});

describe('mail for coding assistants (MCP)', () => {
  const acc = (id: string, mcp: boolean): Account => ({ id, kind: 'imap', label: id, email: `${id}@x.org`, identities: [], mail: true, calendar: false, contacts: false, mcp });
  const folders: MailFolder[] = [
    { account: 'work', path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 0, total: 0 },
    { account: 'work', path: 'Bin', name: 'Bin', special: 'trash', unread: 0, total: 0 },
    { account: 'work', path: 'Spam', name: 'Spam', unread: 0, total: 0 },
  ];
  const m = (o: Partial<MessageSummary>): MessageSummary => msg({ account: 'work', id: `work:INBOX:${++uid}`, from: ana, ...o });
  const good = m({ subject: 'Homepage drafts', snippet: 'Here are the drafts, api key sk-ant-abcdefghijklmnopqrstuvwxyz0123456789' });
  const code = m({ subject: 'Your sign-in code', snippet: 'Use 482913 to sign in' });
  const reset = m({ subject: 'Reset your password', snippet: 'Click the link to choose a new password' });
  const spam = m({ folder: 'Spam', id: 'work:Spam:1', subject: 'You won' });
  const trash = m({ folder: 'Bin', id: 'work:Bin:2', subject: 'Old' });
  const home = { ...m({ subject: 'Private' }), account: 'home', id: 'home:INBOX:3' };
  const all = [good, code, reset, spam, trash, home];
  const drafts: unknown[] = [];
  const backend: MailMcpBackend = {
    accounts: async () => [acc('work', true), acc('home', false)],
    folders: async () => folders,
    search: async () => all,
    read: async (id) => {
      const s = all.find((x) => x.id === id);
      if (!s) throw new Error('none');
      return { summary: s, text: s === good ? 'Hi! The password: hunter2hunter2 and code is 123456. Thanks' : s.snippet };
    },
    thread: async (id) => all.filter((x) => x.id === id || x === code),
    saveDraft: async (d) => { drafts.push(d); },
  };
  const mcp = mailMcp(backend);

  it('offers search, read and drafts only', () => {
    expect(MAIL_TOOLS.map((t) => t.name)).toEqual(['mail_search', 'mail_read', 'mail_thread', 'mail_draft']);
    expect(MAIL_TOOLS.every((t) => !t.annotations.destructiveHint)).toBe(true);
    expect(MAIL_TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual(['mail_draft']);
  });

  it('refuses to send, delete or move', async () => {
    for (const name of ['mail_send', 'mail_delete', 'mail_move', 'send_mail']) expect((await mcp.call(name, { id: good.id })).isError).toBe(true);
  });

  it('never shows Spam, Trash, security mail or accounts not shared', async () => {
    const r = await mcp.call('mail_search', { query: '' });
    const ids = (r.structured as { messages: { id: string }[] }).messages.map((x) => x.id);
    expect(ids).toEqual([good.id]);
    for (const id of [code.id, reset.id, spam.id, trash.id, home.id]) expect((await mcp.call('mail_read', { id })).isError, id).toBe(true);
    expect(hiddenFolder('[Gmail]/Spam', [], 'x')).toBe(true);
    expect(hiddenFolder('Deleted Items', [], 'x')).toBe(true);
    expect(hiddenFolder('Clients/Spammy Co', [], 'x')).toBe(false);
    expect(visibleToAgents(good, new Set(['work']), folders)).toBe(true);
  });

  it('blanks secrets and codes in what it returns', async () => {
    const s = await mcp.call('mail_search', { query: 'drafts' });
    expect(s.text).not.toContain('sk-ant-');
    const r = await mcp.call('mail_read', { id: good.id });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('From: Ana Lopez <ana@lopez.example>');
    expect(r.text).not.toContain('hunter2hunter2');
    expect(r.text).not.toContain('123456');
    const t = await mcp.call('mail_thread', { id: good.id });
    expect(t.text).toContain(good.id);
    expect(t.text).not.toContain(code.id);
  });

  it('writes drafts (never sends) and only in shared accounts', async () => {
    const r = await mcp.call('mail_draft', { reply_to: good.id, body: 'Thanks, looks good.' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/nothing was sent/);
    expect(drafts.at(-1)).toMatchObject({ account: 'work', subject: 'Re: Homepage drafts', to: [ana], body: 'Thanks, looks good.' });
    expect((await mcp.call('mail_draft', { account: 'home', to: ['x@y.org'], body: 'hi' })).isError).toBe(true);
    expect((await mcp.call('mail_draft', { reply_to: code.id, body: 'hi' })).isError).toBe(true);
  });

  it('says how to share an account when none is', async () => {
    const none = mailMcp({ ...backend, accounts: async () => [acc('work', false)] });
    const r = await none.call('mail_search', { query: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Settings/);
  });
});
