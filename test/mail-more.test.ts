// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, second round: rules (and their Sieve and Gmail forms), search with
// filters, inbox tabs, To Reply, remind-if-no-reply, mute and block, sign-in
// codes, sender pictures, dark-mode cards, phishing warnings, link tracking,
// rich text and signatures, templates, AI memory and citations, snooze across
// computers, setup guides, the Dock badge and the notch, and MCP tidying.

import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { conditionMatches, describeRule, evaluateRules, gmailCapable, msString, parseCapabilities, planActions, responseEnd, ruleMatchesV2, sieveCapable, toGmailFilter, toSieve, type Rule } from '../core/pim/rules';
import { ruleMatches } from '../core/pim/mail';
import { describeQuery, hasFilters, imapCriteria, matchMailQuery, orderResults, parseMailQuery, parseWhen } from '../core/pim/search';
import {
  accountForDigit, badgeCount, brandOf, bubbleText, conversationKeys, extractCode, extractSignInLink, gotReply, initials, inTab, isBlocked, isDesignedMail, isMuted,
  nextTextSize, notchAllows, otherKind, remindChoices, senderLook, smartTab, sortReminders, tabCounts, toReply, unreadByAccount,
} from '../core/pim/smart';
import { baseDomain, linksIn, lookalikeOf, phishingWarnings, skeleton } from '../core/pim/phishing';
import { asksForReceipt, MAIL_CONNECTIONS, stripTracking } from '../core/pim/privacy';
import { sanitizeMail, textToHtml } from '../core/pim/sanitize';
import { assemble, cleanEditorHtml, fillTemplate, htmlToText, replyIdentity, replyToOf, sendAs, signatureFor, textToEditorHtml } from '../core/pim/compose-rich';
import { citationParts, cleanMemory, draftPrompt, rememberIn, rewritePrompt, streamInto, TONES } from '../core/pim/mail-ai';
import { adoptRemote, keepsKeywords, mergeEntries, noteBody, readNote, snoozeFromKeyword, snoozeKeyword, snoozeOfFlags } from '../core/pim/snooze-sync';
import { appPasswordLink, GUIDES, guideFor } from '../core/pim/provider-guides';
import { parseVCards, photoUrl } from '../core/pim/vcard';
import { mailMcp, MAIL_TOOLS, type MailMcpBackend } from '../core/pim/mail-mcp';
import type { Account, MessageSummary } from '../core/pim/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 10, 0).getTime();

let n = 0;
function msg(p: Partial<MessageSummary> = {}): MessageSummary {
  n++;
  return { id: `a:INBOX:${n}`, account: 'a', folder: 'INBOX', uid: n, subject: 'Hello', to: [{ address: 'me@x.org' }], cc: [], date: NOW - n * 60_000, seen: false, flagged: false, answered: false, snippet: '', hasAttachments: false, ...p };
}

describe('rules', () => {
  const r = (p: Partial<Rule>): Rule => ({ id: 'r', name: '', enabled: true, when: [{ field: 'from', contains: 'news@' }], then: { action: 'archive' }, ...p });

  it('matches sender, subject, text, attachments and mailing list', () => {
    const m = msg({ from: { name: 'Shop', address: 'news@shop.example' }, subject: 'Your invoice', listId: 'deals.shop.example', hasAttachments: true });
    expect(conditionMatches({ field: 'from', contains: 'NEWS@' }, m)).toBe(true);
    expect(conditionMatches({ field: 'subject', contains: 'invoice' }, m)).toBe(true);
    expect(conditionMatches({ field: 'list', contains: 'deals.shop' }, m)).toBe(true);
    expect(conditionMatches({ field: 'attachment', has: true }, m)).toBe(true);
    expect(conditionMatches({ field: 'attachment', has: false }, m)).toBe(false);
    expect(conditionMatches({ field: 'body', contains: 'refund' }, { ...m, text: 'Your refund is on its way' })).toBe(true);
  });

  it('all / any, account, disabled and empty rules', () => {
    const m = msg({ from: { address: 'news@shop.example' }, subject: 'Sale' });
    expect(ruleMatchesV2(r({ when: [{ field: 'from', contains: 'news@' }, { field: 'subject', contains: 'invoice' }] }), m)).toBe(false);
    expect(ruleMatchesV2(r({ match: 'any', when: [{ field: 'from', contains: 'news@' }, { field: 'subject', contains: 'invoice' }] }), m)).toBe(true);
    expect(ruleMatchesV2(r({ account: 'b' }), m)).toBe(false);
    expect(ruleMatchesV2(r({ enabled: false }), m)).toBe(false);
    expect(ruleMatchesV2(r({ when: [{ field: 'from', contains: '  ' }] }), m)).toBe(false);
    // The old name still works.
    expect(ruleMatches(r({}), m)).toBe(true);
  });

  it('stops after the first matching rule unless told to go on, and plans one destination', () => {
    const m = msg({ from: { address: 'news@shop.example' } });
    const rules = [r({ id: '1', then: { action: 'read' }, stop: false }), r({ id: '2', then: { action: 'label', label: 'Shops' }, also: [{ action: 'move', folder: 'Shops' }] }), r({ id: '3', then: { action: 'trash' } })];
    const hits = evaluateRules(rules, m);
    expect(hits.map((h) => h.rule.id)).toEqual(['1', '2']);
    const plan = planActions(hits.flatMap((h) => h.actions));
    expect(plan).toEqual({ read: true, flag: false, labels: ['Shops'], dest: { kind: 'move', folder: 'Shops' } });
    expect(describeRule(rules[1])).toBe('If sender contains “news@”: label “Shops”, move to Shops');
  });

  it('writes a Sieve script for server rules', () => {
    const s = toSieve([
      r({ name: 'Shops', server: true, when: [{ field: 'from', contains: 'news@' }, { field: 'attachment', has: false }], then: { action: 'read' }, also: [{ action: 'move', folder: 'Shops "A"' }] }),
      r({ name: 'Local only', server: false }),
      r({ name: 'Archive', server: true, when: [{ field: 'subject', contains: 'receipt' }], then: { action: 'archive' } }),
    ], { archive: 'Archive' });
    expect(s).toContain('require ["fileinto", "imap4flags"];');
    expect(s).toContain('if allof (address :contains "from" "news@", not header :contains "Content-Type" "multipart/mixed") {');
    expect(s).toContain('addflag "\\\\Seen";');
    expect(s).toContain('fileinto "Shops \\"A\\"";');
    expect(s).toContain('fileinto "Archive";');
    expect(s).not.toContain('Local only');
    expect(sieveCapable(r({}))).toBe(true);
  });

  it('turns a rule into a Gmail filter', () => {
    const f = toGmailFilter(r({ when: [{ field: 'from', contains: 'a@b.c' }, { field: 'list', contains: 'x y' }, { field: 'attachment', has: true }], then: { action: 'label', label: 'Work' }, also: [{ action: 'archive' }, { action: 'read' }] }))!;
    expect(f.filter.criteria).toEqual({ from: 'a@b.c', hasAttachment: true, query: 'list:"x y"' });
    expect(f.filter.action).toEqual({ addLabelIds: ['label:Work'], removeLabelIds: ['INBOX', 'UNREAD'] });
    expect(gmailCapable(r({ match: 'any' }))).toBe(false);
  });

  it('ManageSieve strings, capabilities and responses', () => {
    expect(msString('keeper')).toBe('"keeper"');
    expect(msString('a\r\nb')).toBe('{4+}\r\na\r\nb');
    expect(parseCapabilities(['"IMPLEMENTATION" "Dovecot"', '"SASL" "PLAIN LOGIN"', '"SIEVE" "fileinto imap4flags"', '"STARTTLS"'])).toEqual({ sasl: ['PLAIN', 'LOGIN'], extensions: ['fileinto', 'imap4flags'], starttls: true, implementation: 'Dovecot' });
    expect(responseEnd('NO (QUOTA) "Too big"')).toEqual({ status: 'NO', text: 'Too big' });
    expect(responseEnd('"SIEVE" "x"')).toBeNull();
  });
});

describe('ManageSieve client', () => {
  it('signs in, writes the script and makes it active', async () => {
    const got: string[] = [];
    let script = '';
    const server = net.createServer((s) => {
      s.write('"IMPLEMENTATION" "Fake"\r\n"SASL" "PLAIN"\r\n"SIEVE" "fileinto"\r\nOK "ready"\r\n');
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString();
        for (;;) {
          const lit = buf.match(/^PUTSCRIPT "(\w+)" \{(\d+)\+\}\r\n/);
          if (lit) {
            const len = Number(lit[2]);
            if (buf.length < lit[0].length + len + 2) return;
            script = buf.slice(lit[0].length, lit[0].length + len);
            buf = buf.slice(lit[0].length + len + 2);
            got.push('PUTSCRIPT');
            s.write('OK\r\n');
            continue;
          }
          const i = buf.indexOf('\r\n');
          if (i < 0) return;
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          got.push(line.split(' ')[0]);
          if (line.startsWith('AUTHENTICATE')) s.write(Buffer.from(line.split('"')[3], 'base64').toString() === '\0ana\0secret' ? 'OK\r\n' : 'NO "bad"\r\n');
          else if (line.startsWith('LOGOUT')) { s.write('OK\r\n'); s.end(); }
          else s.write('OK\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const { putActiveScript } = await import('../electron/services/pim/managesieve');
    const text = 'require ["fileinto"];\r\nif header :contains "subject" "x" { fileinto "X"; }\r\n';
    await putActiveScript({ host: '127.0.0.1', port, user: 'ana', pass: 'secret', plain: true }, 'keeper', text);
    expect(got).toEqual(['AUTHENTICATE', 'PUTSCRIPT', 'SETACTIVE', 'LOGOUT']);
    expect(script).toBe(text);
    await expect(putActiveScript({ host: '127.0.0.1', port, user: 'ana', pass: 'wrong', plain: true }, 'keeper', text)).rejects.toThrow(/did not accept/);
    // Without STARTTLS a password is never sent in the clear.
    await expect(putActiveScript({ host: '127.0.0.1', port, user: 'ana', pass: 'secret' }, 'keeper', text)).rejects.toThrow(/without encryption/);
    server.close();
  });
});

describe('search', () => {
  it('parses filters and dates', () => {
    const q = parseMailQuery('from:ana to:"bob x" subject:plan has:attachment is:unread in:inbox label:work before:2026-03-01 after:7d -lunch "big news" budget', NOW);
    expect(q.from).toEqual(['ana']);
    expect(q.to).toEqual(['bob x']);
    expect(q.subject).toEqual(['plan']);
    expect(q.attachment).toBe(true);
    expect(q.unread).toBe(true);
    expect(q.in).toBe('inbox');
    expect(q.labels).toEqual(['work']);
    expect(q.before).toBe(new Date(2026, 2, 1).getTime());
    expect(q.after).toBe(NOW - 7 * DAY);
    expect(q.not).toEqual(['lunch']);
    expect(q.words).toEqual(['big news', 'budget']);
    expect(hasFilters(q)).toBe(true);
    expect(parseWhen('1y', NOW)).toBe(new Date(2025, 10, 4, 10, 0).getTime());
    expect(describeQuery(parseMailQuery('from:ana is:unread', NOW))).toEqual(['From ana', 'Unread']);
  });

  it('matches messages', () => {
    const m = msg({ from: { name: 'Ana', address: 'ana@x.org' }, subject: 'The plan', hasAttachments: true, labels: ['Work'], date: NOW - DAY });
    expect(matchMailQuery(m, parseMailQuery('from:ana subject:plan has:attachment is:unread label:work after:2d', NOW))).toBe(true);
    expect(matchMailQuery(m, parseMailQuery('is:read', NOW))).toBe(false);
    expect(matchMailQuery(m, parseMailQuery('before:2d', NOW))).toBe(false);
    expect(matchMailQuery(m, parseMailQuery('-plan', NOW))).toBe(false);
    expect(matchMailQuery(m, parseMailQuery('in:sent', NOW))).toBe(false);
    expect(matchMailQuery({ ...m, folder: 'Sent' }, parseMailQuery('in:sent', NOW), { special: 'sent' })).toBe(true);
  });

  it('orders local first, then the server, newest first, each once', () => {
    const a = msg({ messageId: 'a', date: 1 });
    const b = msg({ messageId: 'b', date: 3 });
    const c = msg({ messageId: 'c', date: 5 });
    expect(orderResults([a, b], [c, { ...a, id: 'dup' }]).map((m) => m.messageId)).toEqual(['b', 'a', 'c']);
  });

  it('builds IMAP search criteria', () => {
    expect(imapCriteria(parseMailQuery('', NOW))).toBeNull();
    const c = imapCriteria(parseMailQuery('from:ana is:unread after:2026-01-01', NOW))!;
    expect(c).toMatchObject({ from: 'ana', seen: false, since: new Date(2026, 0, 1) });
    // Several words: the first as it is, the others as NOT (OR (NOT …)), since the server's search has no AND key.
    const w = imapCriteria(parseMailQuery('lunch friday -cancelled', NOW))!;
    expect(w.or).toEqual([{ subject: 'lunch' }, { from: 'lunch' }, { body: 'lunch' }]);
    expect(w.not).toEqual({ or: [{ not: { or: [{ subject: 'friday' }, { from: 'friday' }, { body: 'friday' }] } }, { not: { not: { text: 'cancelled' } } }] });
  });
});

describe('tabs and mailboxes', () => {
  it('Primary is Important; Other splits into Updates and Promos', () => {
    const imp = msg({ category: 'important' });
    const receipt = msg({ category: 'other', subject: 'Your receipt from Shop', from: { address: 'receipts@shop.example' } });
    const promo = msg({ category: 'other', subject: '30% off this weekend only', from: { address: 'news@shop.example' }, unsub: { url: 'https://x' } });
    const sec = msg({ category: 'other', security: true });
    expect([imp, receipt, promo, sec].map(smartTab)).toEqual(['important', 'updates', 'promos', 'important']);
    expect(otherKind({ subject: 'Weekly digest', snippet: '', from: { address: 'hello@x.y' }, unsub: { url: 'https://x' } })).toBe('promos');
    expect(tabCounts([imp, receipt, promo, { ...sec, seen: true }])).toEqual({ all: 3, important: 1, updates: 1, promos: 1 });
    expect(inTab(receipt, 'other')).toBe(true);
    expect(inTab(imp, 'other')).toBe(false);
  });

  it('To Reply: people waiting for your answer', () => {
    const me = ['me@x.org'];
    const ask = msg({ from: { name: 'Ana', address: 'ana@y.org' }, messageId: 'q1', date: NOW - DAY });
    const answered = msg({ from: { address: 'bob@y.org' }, messageId: 'q2', date: NOW - DAY });
    const mine = msg({ folder: 'Sent', from: { address: 'me@x.org' }, to: [{ address: 'bob@y.org' }], inReplyTo: 'q2', messageId: 'r2', date: NOW - DAY / 2 });
    const news = msg({ from: { address: 'news@shop.example' }, unsub: { url: 'https://x' } });
    const robot = msg({ from: { address: 'no-reply@service.example' } });
    const old = msg({ from: { address: 'cara@y.org' }, date: NOW - 30 * DAY });
    const list = toReply([ask, answered, news, robot, old], me, NOW, { sent: [mine] });
    expect(list.map((m) => m.messageId)).toEqual(['q1']);
    expect(toReply([ask], me, NOW, { dismissed: ['q1'] })).toEqual([]);
  });

  it('remind me if no reply', () => {
    const c = remindChoices(NOW);
    expect(c.map((x) => x.label)).toEqual(['In 1 day', 'In 3 days', 'In a week']);
    expect(new Date(c[0].at).getHours()).toBe(9);
    const r = { messageId: 'm1', account: 'a', subject: 'Quote', to: [], sentAt: NOW - 2 * DAY, at: NOW - 1000 };
    const reply = msg({ from: { address: 'bob@y.org' }, inReplyTo: 'm1', date: NOW - DAY });
    expect(gotReply(r, [reply], ['me@x.org'])).toBe(true);
    expect(gotReply(r, [{ ...reply, from: { address: 'me@x.org' } }], ['me@x.org'])).toBe(false);
    const s = sortReminders([r, { ...r, messageId: 'm2' }, { ...r, messageId: 'm3', at: NOW + DAY }], [reply], ['me@x.org'], NOW);
    expect([s.answered.length, s.due.map((x) => x.messageId), s.waiting.map((x) => x.messageId)]).toEqual([1, ['m2'], ['m3']]);
  });

  it('mute and block', () => {
    const m = { messageId: 'c', inReplyTo: 'b', references: ['a', 'b'] };
    expect(conversationKeys(m)).toEqual(['a', 'b', 'b', 'c']);
    expect(isMuted(m, ['a'])).toBe(true);
    expect(isMuted(m, [])).toBe(false);
    expect(isBlocked({ address: 'Spam@Bad.example' }, ['spam@bad.example'])).toBe(true);
    expect(isBlocked({ address: 'x@mail.bad.example' }, ['@bad.example'])).toBe(true);
    expect(isBlocked({ address: 'x@notbad.example' }, ['bad.example'])).toBe(false);
  });

  it('finds sign-in codes and magic links', () => {
    expect(extractCode('Your verification code is 482 913. It expires in 10 minutes.')).toBe('482913');
    expect(extractCode('Use code: K7Q2ZP to sign in')).toBe('K7Q2ZP');
    expect(extractCode('Sign in code\n\n5521\n')).toBe('5521');
    expect(extractCode('Meeting in 2026 about the code review')).toBeUndefined();
    expect(extractCode('Lunch at 1230?')).toBeUndefined();
    const link = extractSignInLink('Click to sign in', '<a href="https://app.example/unsubscribe">Unsubscribe</a><a href="https://app.example/auth/magic?token=abc&amp;x=1">Sign in to App</a>');
    expect(link).toBe('https://app.example/auth/magic?token=abc&x=1');
    expect(extractSignInLink('Our newsletter', '<a href="https://x.example/a">Read</a>')).toBeUndefined();
  });

  it('draws senders from contacts, brands or initials', () => {
    expect(initials({ name: 'Ana María López', address: 'a@x' })).toBe('AL');
    expect(initials({ address: 'news@x.org' })).toBe('N');
    expect(brandOf('noreply@mail.github.com')?.name).toBe('GitHub');
    expect(senderLook({ address: 'Ana@x.org' }, { 'ana@x.org': 'data:image/png;base64,AA==' })).toEqual({ kind: 'photo', src: 'data:image/png;base64,AA==' });
    expect(senderLook({ address: 'ana@x.org' }, { 'ana@x.org': 'https://evil.example/p.png' }).kind).toBe('initials');
  });

  it('designed mail, text sizes, chat bubbles, ⌘ digits', () => {
    expect(isDesignedMail('<table bgcolor="#f60"><tr><td style="background-color:#222">x</td></tr></table>')).toBe(true);
    expect(isDesignedMail('<p>Hi Ana, see you soon.</p>')).toBe(false);
    expect(nextTextSize(14, 1)).toBe(15);
    expect(nextTextSize(12, -1)).toBe(12);
    expect(nextTextSize(22, 1)).toBe(22);
    expect(bubbleText('Sounds good!\n\nOn Tue, Ana <a@x> wrote:\n> old')).toBe('Sounds good!');
    expect(bubbleText('Yes\n-- \nAna')).toBe('Yes');
    const accs = [{ id: 'a' }, { id: 'b' }];
    expect(accountForDigit(2, accs)).toEqual({ id: 'b' });
    expect(accountForDigit(0, accs)).toBe('all');
    expect(accountForDigit(5, accs)).toBeUndefined();
  });

  it('the Dock badge, the notch, unread per account', () => {
    const list = [msg({ category: 'important' }), msg({ category: 'other' }), msg({ category: 'other', security: true }), msg({ seen: true }), msg({ snoozedUntil: NOW + DAY })];
    expect(badgeCount(list, 'all', NOW)).toBe(3);
    expect(badgeCount(list, 'important', NOW)).toBe(2);
    expect(badgeCount(list, 'off', NOW)).toBe(0);
    const m = { account: 'a', from: { address: 'ana@x.org' } };
    expect(notchAllows(m, {})).toBe(true);
    expect(notchAllows(m, { accountOff: true })).toBe(false);
    expect(notchAllows(m, { senders: ['@y.org'] })).toBe(false);
    expect(notchAllows(m, { senders: ['x.org'] })).toBe(true);
    expect(notchAllows({ ...m, security: true }, { senders: ['@y.org'] })).toBe(true);
    expect(unreadByAccount([{ account: 'a', seen: false }, { account: 'a', seen: true }, { account: 'b', seen: false }])).toEqual({ a: 1, b: 1 });
  });
});

describe('phishing warnings', () => {
  it('look-alike domains and skeletons', () => {
    expect(baseDomain('mail.paypal.co.uk')).toBe('paypal.co.uk');
    expect(skeleton('rnicrosoft.com')).toBe('microsoft.com');
    expect(lookalikeOf('paypa1.com', ['paypal.com'])).toBe('paypal.com');
    expect(lookalikeOf('paypal-security.net', ['paypal.com'])).toBe('paypal.com');
    expect(lookalikeOf('paypal.com', ['paypal.com'])).toBeUndefined();
    expect(lookalikeOf('example.org', ['paypal.com'])).toBeUndefined();
  });

  it('names a contact or a brand on a stranger’s address, replies elsewhere, lying links', () => {
    const w = phishingWarnings({
      from: { name: 'Ana Lopez', address: 'ana.lopez@freemail.example' },
      replyTo: [{ address: 'payments@gmail.com' }],
      links: [{ text: 'https://www.mybank.com/login', href: 'https://evil.example/x' }],
      contacts: [{ name: 'Ana Lopez', emails: ['ana@work.example'] }],
    });
    expect(w.map((x) => x.kind).sort()).toEqual(['display-name', 'link-mismatch', 'reply-to']);
    expect(phishingWarnings({ from: { name: 'PayPal', address: 'service@paypal.com' } })).toEqual([]);
    expect(phishingWarnings({ from: { name: 'PayPal Support', address: 'help@secure-mail.example' } }).map((x) => x.kind)).toEqual(['brand-name']);
    expect(phishingWarnings({ from: { address: 'x@y.example' }, headers: { 'authentication-results': 'mx; dmarc=fail' } }).map((x) => x.kind)).toEqual(['auth-failed']);
    expect(linksIn('<a href="https://a.example/?a=1&amp;b=2"><b>Go</b> now</a>')).toEqual([{ text: 'Go now', href: 'https://a.example/?a=1&b=2' }]);
  });
});

describe('privacy', () => {
  it('takes tracking parameters off links', () => {
    expect(stripTracking('https://shop.example/p?id=7&utm_source=mail&utm_campaign=x&fbclid=1#top')).toEqual({ href: 'https://shop.example/p?id=7#top', removed: 3 });
    expect(stripTracking('https://shop.example/p?utm_medium=e').href).toBe('https://shop.example/p');
    expect(stripTracking('https://shop.example/p?q=1')).toEqual({ href: 'https://shop.example/p?q=1', removed: 0 });
    expect(stripTracking('mailto:a@b.c?utm_source=x').removed).toBe(0);
  });
  it('cleans links in mail and in plain text', () => {
    const r = sanitizeMail('<a href="https://a.example/x?mc_cid=1&amp;k=2">x</a>');
    expect(r.cleanedLinks).toBe(1);
    expect(r.html).toContain('href="https://a.example/x?k=2"');
    expect(textToHtml('see https://a.example/?utm_source=x')).toContain('href="https://a.example/"');
  });
  it('read receipts and the connections note', () => {
    expect(asksForReceipt({ 'disposition-notification-to': 'a@b.c' })).toBe(true);
    expect(asksForReceipt({})).toBe(false);
    expect(MAIL_CONNECTIONS.length).toBeGreaterThan(5);
  });
});

describe('rich text, signatures, aliases and templates', () => {
  it('keeps simple formatting only', () => {
    const html = cleanEditorHtml('<div onclick="x()"><b>Bold</b> <i>it</i> <span style="font-size:18px;color:red">big</span><script>alert(1)</script><a href="javascript:x">bad</a><a href="https://ok.example">ok</a><font size="5">f</font></div>');
    expect(html).toBe('<div><b>Bold</b> <i>it</i> <span style="font-size:18px">big</span><a>bad</a><a href="https://ok.example">ok</a><span style="font-size:24px">f</span></div>');
  });
  it('turns HTML into text and back', () => {
    expect(htmlToText('<div>Hi <b>Ana</b></div><ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol><p><a href="https://x.example">site</a></p>')).toBe('Hi Ana\n\n- one\n- two\n\n1. a\n2. b\n\nsite (https://x.example)');
    expect(textToEditorHtml('a <b>\nline\n\nnext')).toBe('<div>a &lt;b&gt;<br>line</div><div><br></div><div>next</div>');
  });
  it('signatures: optional on replies, removable per message', () => {
    const id = { name: 'Ana', email: 'ana@x.org', signature: 'Ana\nAcme' };
    expect(signatureFor(id, { reply: false })).toBe('Ana\nAcme');
    expect(signatureFor(id, { reply: true, onReplies: false })).toBeUndefined();
    expect(signatureFor(id, { reply: true })).toBe('Ana\nAcme');
    expect(signatureFor(id, { reply: false, removed: true })).toBeUndefined();
    const out = assemble({ html: '<div>Hello</div>', text: '', signature: 'Ana', quoted: '> old' });
    expect(out.text).toBe('Hello\n\n-- \nAna\n\n> old');
    expect(out.html).toContain('<div class="keeper-signature">-- <br>Ana</div>');
    expect(out.html).toContain('<blockquote');
  });
  it('aliases with their own Reply-To; replies go from the alias written to', () => {
    const a = { id: 'a', email: 'ana@x.org', identities: [{ name: 'Ana', email: 'ana@x.org' }, { name: 'Sales', email: 'sales@x.org', replyTo: 'team@x.org' }] } as Account;
    expect(sendAs(a).map((i) => i.email)).toEqual(['ana@x.org', 'sales@x.org']);
    expect(replyIdentity(a, { to: [{ address: 'SALES@x.org' }], cc: [] })?.email).toBe('sales@x.org');
    expect(replyIdentity(a, { to: [{ address: 'other@x.org' }], cc: [] })?.email).toBe('ana@x.org');
    expect(replyToOf(a.identities[1])).toEqual([{ address: 'team@x.org' }]);
    expect(replyToOf(a.identities[0])).toBeUndefined();
  });
  it('fills templates', () => {
    expect(fillTemplate('Hi {first_name}, from {my_name} {unknown}', { to: { name: 'Bob Smith', address: 'b@x' }, me: { name: 'Ana', address: 'a@x' } })).toBe('Hi Bob, from Ana {unknown}');
  });
});

describe('AI help pieces', () => {
  it('tones, instructions and memory', () => {
    expect(TONES.map((t) => t.id)).toContain('friendly');
    const p = rewritePrompt('hey', { tone: 'friendly' }, ['I sign as Ana', '']);
    expect(p).toContain('warmer');
    expect(p).toContain('- I sign as Ana');
    expect(draftPrompt('decline politely', { draft: 'x', thread: 't' })).toContain('<thread>');
    expect(cleanMemory(['a', 'A', ' ', 'my password is hunter2-AKIAIOSFODNN7EXAMPLE'])).toEqual(['a']);
    expect(rememberIn('remember that I sign as Ana.')).toBe('I sign as Ana');
    expect(rememberIn('make it shorter')).toBeUndefined();
  });
  it('splits citations and streams into a draft', () => {
    expect(citationParts('It leaves at 7 [1], back on 15 [2, 9].', 2)).toEqual([{ text: 'It leaves at 7 ' }, { cite: 1 }, { text: ', back on 15 ' }, { cite: 2 }, { text: '.' }]);
    expect(streamInto('Hi\n', null, 'More')).toBe('Hi\n\nMore');
    expect(streamInto('Hello world', { start: 6, end: 11 }, 'there')).toBe('Hello there');
  });
});

describe('snooze across computers', () => {
  it('keywords and notes', () => {
    const t = Math.round(NOW / 60_000) * 60_000;
    const k = snoozeKeyword(t);
    expect(k).toMatch(/^\$KSnooze-[0-9a-z]+$/);
    expect(snoozeFromKeyword(k)).toBe(t);
    expect(snoozeOfFlags(['\\Seen', k, snoozeKeyword(t - DAY)])).toBe(t);
    expect(keepsKeywords(new Set(['\\Seen', '\\*']))).toBe(true);
    expect(keepsKeywords(['\\Seen'])).toBe(false);
    const a = [{ messageId: 'm', until: t, at: 1 }];
    const b = [{ messageId: 'm', until: 0, at: NOW, done: true }, { messageId: 'o', until: t, at: 1 }];
    const merged = mergeEntries(a, b);
    expect(merged.find((e) => e.messageId === 'm')?.done).toBe(true);
    expect(readNote(noteBody(merged, NOW))).toHaveLength(2);
    expect(readNote('nonsense')).toEqual([]);
    expect(adoptRemote([{ messageId: 'm', until: t }], merged, NOW - DAY)).toEqual({ snooze: [{ messageId: 'o', until: t }], wake: ['m'] });
  });
});

describe('setup guides', () => {
  it('has one per provider, with the app-password links', () => {
    expect(GUIDES.map((g) => g.id)).toEqual(['gmail', 'outlook', 'icloud', 'yahoo', 'aol', 'fastmail', 'zoho', 'imap']);
    expect(guideFor('x@icloud.com').id).toBe('icloud');
    expect(guideFor('x@hotmail.com').id).toBe('outlook');
    expect(guideFor('x@company.example').id).toBe('imap');
    expect(appPasswordLink(GUIDES[0])?.url).toBe('https://myaccount.google.com/apppasswords');
    expect(appPasswordLink(GUIDES[1])).toBeUndefined();
  });
});

describe('contact photos', () => {
  it('reads pictures inside the card only', () => {
    const [c] = parseVCards('BEGIN:VCARD\r\nFN:Ana\r\nEMAIL:ana@x.org\r\nPHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo=\r\nEND:VCARD\r\n');
    expect(c.photo).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(photoUrl('PHOTO;VALUE=uri', 'https://x.example/a.jpg')).toBeUndefined();
    expect(photoUrl('PHOTO', 'data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
  });
});

describe('MCP tidying and sending', () => {
  const account = { id: 'a', kind: 'imap', label: 'A', identities: [], mail: true, calendar: false, contacts: false, mcp: true } as Account;
  const m1 = msg({ id: 'a:INBOX:1', from: { address: 'x@y.org' }, subject: 'One' });
  const sec = msg({ id: 'a:INBOX:2', subject: 'Your sign-in code is 123456', security: true });
  const backend = (answer: boolean, log: string[]): MailMcpBackend => ({
    accounts: async () => [account], folders: async () => [], search: async () => [m1],
    read: async (id) => ({ summary: id === sec.id ? sec : m1, text: 'hi' }), thread: async () => [m1], saveDraft: async () => undefined,
    approve: async (q) => { log.push(`ask ${q.action} ${q.count}`); return answer; },
    tidy: async (ids, a) => { log.push(`${a.action} ${ids.join(',')}`); },
    proposeSend: async (d) => { log.push(`stage ${d.subject} ${d.to.map((t) => t.address).join(',')}`); },
  });
  it('asks before each batch and does nothing when refused', async () => {
    expect(MAIL_TOOLS.map((t) => t.name)).toEqual(['mail_search', 'mail_read', 'mail_thread', 'mail_draft', 'mail_tidy', 'mail_send']);
    const log: string[] = [];
    const yes = mailMcp(backend(true, log));
    expect((await yes.call('mail_tidy', { ids: ['a:INBOX:1'], action: 'label', label: 'Later' })).isError).toBeFalsy();
    const no = mailMcp(backend(false, log));
    expect((await no.call('mail_tidy', { ids: ['a:INBOX:1'], action: 'archive' })).isError).toBe(true);
    expect(log).toEqual(['ask label “Later” 1', 'label a:INBOX:1', 'ask archive 1']);
    expect((await yes.call('mail_tidy', { ids: ['a:INBOX:2'], action: 'archive' })).isError).toBe(true);
    expect((await yes.call('mail_tidy', { ids: ['a:INBOX:1'], action: 'delete' })).isError).toBe(true);
    expect((await yes.call('mail_tidy', { ids: ['a:INBOX:1'], action: 'move', folder: 'Trash' })).isError).toBe(true);
  });
  it('sending only puts the message in front of the person', async () => {
    const log: string[] = [];
    const r = await mailMcp(backend(true, log)).call('mail_send', { to: ['bob@y.org'], subject: 'Hi', body: 'Hello' });
    expect(r.text).toMatch(/sent only if they press Send/);
    expect(log).toEqual(['stage Hi bob@y.org']);
  });
});
