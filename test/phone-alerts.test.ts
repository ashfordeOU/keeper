// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  batchMessage, buildRequest, channelLine, channelProblems, channelsFor, defaultPhoneAlertSettings, emailFor, normalizePhoneAlertSettings, replyProblem, scrubSecret, secretName, secretNeed,
  type AlertChannel, type AlertEvent,
} from '../core/phone-alerts';
import { defaultSettings, mergeSettings } from '../core/settings';

const T = Date.UTC(2026, 10, 3, 12);
const ev = (o: Partial<AlertEvent> = {}): AlertEvent => ({ source: 'monitors', title: 'shop.example is down', detail: 'No answer for 2 minutes', at: T, ...o });
const ch = (o: Partial<AlertChannel>): AlertChannel => ({ id: 'c1', kind: 'ntfy', name: 'Phone', on: true, sources: ['monitors'], ...o });

describe('settings', () => {
  it('starts with no channels and a 30-second wait', () => {
    expect(defaultPhoneAlertSettings()).toEqual({ channels: [], batchSeconds: 30 });
    expect(defaultSettings([], []).phoneAlerts.channels).toEqual([]);
  });
  it('drops unknown kinds and sources, and keeps the wait sensible', () => {
    const s = normalizePhoneAlertSettings({ channels: [ch({ sources: ['monitors', 'nope' as never] }), { id: 'x', kind: 'pager' }], batchSeconds: 99999 });
    expect(s.channels).toHaveLength(1);
    expect(s.channels[0].sources).toEqual(['monitors']);
    expect(s.batchSeconds).toBe(600);
    expect(mergeSettings(defaultSettings([], []), { phoneAlerts: { channels: 'bad' } }).phoneAlerts.channels).toEqual([]);
  });
  it('never keeps a token in the settings', () => {
    expect(secretName('c1')).toBe('alerts.c1');
    expect(secretNeed('telegram')).toBe('required');
    expect(secretNeed('email')).toBe('none');
    expect(secretNeed('ntfy')).toBe('optional');
  });
});

describe('checking a channel', () => {
  it('asks for what each kind needs', () => {
    expect(channelProblems(ch({ kind: 'telegram', chatId: '123456789' }), false)[0]).toMatch(/token/);
    expect(channelProblems(ch({ kind: 'telegram', chatId: '12' }), true)[0]).toMatch(/chat/);
    expect(channelProblems(ch({ kind: 'telegram', chatId: '@keeper_alerts' }), true)).toEqual([]);
    expect(channelProblems(ch({ kind: 'telegram', chatId: '-1001234567890' }), true)).toEqual([]);
    expect(channelProblems(ch({ topic: 'has space' }), false)[0]).toMatch(/one word/);
    expect(channelProblems(ch({ topic: 'keeper-alerts_1' }), false)).toEqual([]);
    expect(channelProblems(ch({ topic: 'ok', server: 'ftp://x' }), false)[0]).toMatch(/web address/);
    expect(channelProblems(ch({ kind: 'email', account: 'a1', to: 'me@example.com' }), false)).toEqual([]);
    expect(channelProblems(ch({ kind: 'email', to: 'me@example.com' }), false)[0]).toMatch(/account/);
  });
  it('wants https for webhooks, except on your own network', () => {
    expect(channelProblems(ch({ kind: 'webhook', url: 'http://example.com/h' }), false)).toHaveLength(1);
    expect(channelProblems(ch({ kind: 'webhook', url: 'https://example.com/h' }), false)).toEqual([]);
    expect(channelProblems(ch({ kind: 'webhook', url: 'http://192.168.1.20:8123/api/webhook/x' }), false)).toEqual([]);
    expect(channelProblems(ch({ kind: 'webhook', url: 'http://nas.local/h' }), false)).toEqual([]);
  });
});

describe('batching', () => {
  it('sends one alert as it is', () => {
    const m = batchMessage([ev()])!;
    expect(m.title).toBe('shop.example is down');
    expect(m.body).toBe('No answer for 2 minutes');
    expect(batchMessage([])).toBeNull();
  });
  it('joins alerts that came together, the urgent ones first', () => {
    const m = batchMessage([ev({ title: 'Automation ran', source: 'automations', at: T }), ev({ title: 'Site down', urgent: true, at: T + 5 }), ev({ title: 'Backup failed', source: 'backups', urgent: true, at: T + 9 })])!;
    expect(m.title).toBe('3 alerts from Keeper');
    expect(m.urgent).toBe(true);
    expect(m.body.split('\n')[0]).toMatch(/^• Site down/);
    expect(m.body.split('\n')[2]).toMatch(/^• Automation ran/);
    expect(batchMessage([ev(), ev({ title: 'b' })])!.title).toBe('2 alerts from Keeper · Site and server checks');
  });
  it('never sends a wall of text', () => {
    const m = batchMessage(Array.from({ length: 30 }, (_, i) => ev({ title: `Alert ${i}`, at: T + i })))!;
    expect(m.body.split('\n')).toHaveLength(13);
    expect(m.body).toMatch(/and 18 more$/);
  });
});

describe('requests', () => {
  const m = batchMessage([ev({ urgent: true })])!;
  it('Telegram: a message from the bot to the chat', () => {
    const r = buildRequest(ch({ kind: 'telegram', chatId: '123456789' }), '1234:AAbbCC', m, 'Keeper/1.0.0');
    expect(r.url).toBe('https://api.telegram.org/bot1234:AAbbCC/sendMessage');
    const body = JSON.parse(r.body);
    expect(body.chat_id).toBe('123456789');
    expect(body.text).toMatch(/shop\.example is down\nNo answer/);
    expect(body.disable_notification).toBe(false);
    expect(() => buildRequest(ch({ kind: 'telegram' }), undefined, m)).toThrow(/token/);
  });
  it('ntfy: the topic on the server, high priority for problems, plain headers', () => {
    const r = buildRequest(ch({ topic: 'my-topic', server: 'https://ntfy.example.org/' }), undefined, batchMessage([ev({ title: 'Café “down”', urgent: true })])!);
    expect(r.url).toBe('https://ntfy.example.org/my-topic');
    expect(r.headers.priority).toBe('high');
    expect(r.headers.title).toBe('Caf down');
    expect(r.headers.authorization).toBeUndefined();
    expect(buildRequest(ch({ topic: 't' }), 'tk_abc', m).headers.authorization).toBe('Bearer tk_abc');
    expect(buildRequest(ch({ topic: 't' }), undefined, m).url).toBe('https://ntfy.sh/t');
  });
  it('webhook: JSON with every alert', () => {
    const r = buildRequest(ch({ kind: 'webhook', url: 'https://hooks.example/k' }), undefined, m);
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({ app: 'keeper', title: 'shop.example is down', urgent: true });
    expect(body.alerts[0]).toMatchObject({ source: 'monitors', at: new Date(T).toISOString() });
  });
  it('e-mail goes through Mail', () => {
    expect(() => buildRequest(ch({ kind: 'email' }), undefined, m)).toThrow(/Mail/);
    const e = emailFor(ch({ kind: 'email', account: 'a1', to: ' me@example.com ' }), m);
    expect(e).toMatchObject({ account: 'a1', to: 'me@example.com', subject: '[Alert] shop.example is down' });
  });
});

describe('replies and errors', () => {
  it('explains what went wrong in plain words', () => {
    expect(replyProblem('telegram', 200, '{"ok":true}')).toBeUndefined();
    expect(replyProblem('telegram', 401, '')).toMatch(/token/);
    expect(replyProblem('telegram', 400, '')).toMatch(/chat/);
    expect(replyProblem('ntfy', 403, '')).toMatch(/access token/);
    expect(replyProblem('webhook', 500, '')).toBe('The service answered 500.');
    expect(replyProblem('webhook', 429, '')).toMatch(/slow down/);
  });
  it('never shows a token', () => {
    expect(scrubSecret('fetch failed https://api.telegram.org/bot1234:SECRET/sendMessage', '1234:SECRET')).not.toMatch(/SECRET/);
    expect(scrubSecret('bad url bot987654:ABCDEFGHIJKLMNOPQRSTUVWX', undefined)).toBe('bad url bot•••');
  });
});

describe('who gets what', () => {
  it('only channels that are on and set up for that kind of alert', () => {
    const s = { channels: [ch({ id: 'a' }), ch({ id: 'b', on: false }), ch({ id: 'c', sources: ['backups'] })], batchSeconds: 0 };
    expect(channelsFor(s, 'monitors').map((c) => c.id)).toEqual(['a']);
    expect(channelsFor(s, 'backups').map((c) => c.id)).toEqual(['c']);
    expect(channelsFor(s, 'fixit')).toEqual([]);
  });
  it('describes each channel in a line', () => {
    expect(channelLine(ch({ topic: 'abc' }))).toBe('ntfy.sh · abc');
    expect(channelLine(ch({ kind: 'webhook', url: 'https://hooks.example:8443/x' }))).toBe('hooks.example:8443');
    expect(channelLine(ch({ kind: 'email', to: 'me@x.org' }))).toBe('E-mail to me@x.org');
  });
});
