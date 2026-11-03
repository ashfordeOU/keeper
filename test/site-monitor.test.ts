// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  defaultName, due, emptyHistory, errorWords, judgeDns, judgeHttp, monitorListText, monitorProblems, newMonitor, nextWake, parseExpect, parseMonitorList, parsePing, pingArgs, record,
  responseSeries, spanWords, startRuntime, step, typicalMs, uptime, type CheckResult,
} from '../core/site-monitor';

const T = Date.UTC(2026, 10, 3, 12);
const web = newMonitor({ id: 'w', kind: 'http', target: 'https://shop.example.com/' }, T);

describe('a monitor', () => {
  it('gets sensible defaults and a name from its address', () => {
    expect(web).toMatchObject({ name: 'shop.example.com', interval: 300, timeout: 10, tlsDays: 14, on: true, alerts: true });
    expect(newMonitor({ kind: 'tcp', target: 'db.local', port: 5432 }, T).name).toBe('db.local:5432');
    expect(newMonitor({ kind: 'ping', target: '10.0.0.1', interval: 7 }, T).interval).toBe(300);
    expect(newMonitor({ kind: 'ping', target: '10.0.0.1' }, T).tlsDays).toBe(0);
    expect(defaultName('http', 'not a url')).toBe('not a url');
  });
  it('says what is wrong in plain words', () => {
    expect(monitorProblems({ kind: 'http', target: 'shop.example.com' })[0]).toMatch(/full address/);
    expect(monitorProblems({ kind: 'http', target: 'ftp://x.example' })[0]).toMatch(/https/);
    expect(monitorProblems({ kind: 'http', target: 'https://x.example', expect: '2xx' })[0]).toMatch(/200-399/);
    expect(monitorProblems({ kind: 'tcp', target: 'db.local' })[0]).toMatch(/port/);
    expect(monitorProblems({ kind: 'tcp', target: 'db.local', port: 70000 })[0]).toMatch(/port/);
    expect(monitorProblems({ kind: 'ping', target: 'bad host!' })[0]).toMatch(/host name/);
    expect(monitorProblems({ kind: 'ping', target: '::1' })).toEqual([]);
    expect(monitorProblems({ kind: 'dns', target: 'example.com' })).toEqual([]);
  });
  it('reads the answers that count as up', () => {
    expect(parseExpect('200-399')).toEqual([[200, 399]]);
    expect(parseExpect('200, 204 ,301-302')).toEqual([[200, 200], [204, 204], [301, 302]]);
    expect(parseExpect('399-200')).toBeUndefined();
    expect(parseExpect('abc')).toBeUndefined();
  });
});

describe('importing a list', () => {
  it('understands addresses, ports, ping, dns, names and comments', () => {
    const r = parseMonitorList(`# my servers
https://example.com
Shop, https://shop.example.com/health
tcp mail.example.com:993
port db.local 5432
tcp://ssh.example.org:22
ping 192.168.1.1
dns example.com MX
nas.local:5000
blog.example.net
10.0.0.8
what is this
`, T);
    expect(r.monitors.map((m) => [m.kind, m.target, m.port ?? m.dnsType ?? '', m.name])).toEqual([
      ['http', 'https://example.com', '', 'example.com'],
      ['http', 'https://shop.example.com/health', '', 'Shop'],
      ['tcp', 'mail.example.com', 993, 'mail.example.com:993'],
      ['tcp', 'db.local', 5432, 'db.local:5432'],
      ['tcp', 'ssh.example.org', 22, 'ssh.example.org:22'],
      ['ping', '192.168.1.1', '', '192.168.1.1'],
      ['dns', 'example.com', 'MX', 'example.com'],
      ['tcp', 'nas.local', 5000, 'nas.local:5000'],
      ['http', 'https://blog.example.net', '', 'blog.example.net'],
      ['ping', '10.0.0.8', '', '10.0.0.8'],
    ]);
    expect(r.skipped).toEqual(['what is this']);
    expect(new Set(r.monitors.map((m) => m.id)).size).toBe(r.monitors.length);
  });
  it('writes the list back in the same form', () => {
    const r = parseMonitorList('Shop, https://shop.example.com\ntcp db.local:5432\ndns example.com TXT', T);
    expect(monitorListText(r.monitors)).toBe('Shop, https://shop.example.com\ntcp db.local:5432\ndns example.com TXT');
    expect(parseMonitorList(monitorListText(r.monitors), T).monitors).toHaveLength(3);
  });
});

describe('judging a check', () => {
  it('web pages: the answer, a word on the page and the certificate', () => {
    expect(judgeHttp(web, { status: 200, ms: 120.4 }, T)).toEqual({ at: T, ok: true, ms: 120, status: 200 });
    expect(judgeHttp(web, { status: 503, ms: 80 }, T)).toMatchObject({ ok: false, message: 'The site answered 503 (unavailable)' });
    const kw = { ...web, keyword: 'Add to basket' };
    expect(judgeHttp(kw, { status: 200, ms: 1, body: '<button>Add to Basket</button>' }, T).ok).toBe(true);
    expect(judgeHttp(kw, { status: 200, ms: 1, body: 'Maintenance' }, T).message).toBe('“Add to basket” is not on the page');
    expect(judgeHttp({ ...web, keyword: 'error', keywordAbsent: true }, { status: 200, ms: 1, body: 'Fatal error' }, T).ok).toBe(false);
    expect(judgeHttp(web, { status: 200, ms: 1, certExpires: T + 10.5 * 86_400_000 }, T).tlsDays).toBe(10);
    expect(judgeHttp(web, { status: 200, ms: 1, certExpires: T - 1000 }, T)).toMatchObject({ ok: false, message: 'The certificate has expired' });
    expect(judgeHttp({ ...web, expect: '200' }, { status: 301, ms: 1 }, T).ok).toBe(false);
  });
  it('DNS: an answer, and the one expected', () => {
    const d = newMonitor({ kind: 'dns', target: 'example.com', dnsExpect: '93.184' }, T);
    expect(judgeDns(d, ['93.184.216.34'], 12, T)).toMatchObject({ ok: true, message: '93.184.216.34' });
    expect(judgeDns(d, ['1.2.3.4'], 12, T).message).toBe('Answer changed: 1.2.3.4');
    expect(judgeDns(d, [], 12, T).ok).toBe(false);
  });
  it('network errors in plain words', () => {
    expect(errorWords('ENOTFOUND')).toBe('The name could not be found');
    expect(errorWords('ECONNREFUSED')).toBe('Nothing answers on that port');
    expect(errorWords('CERT_HAS_EXPIRED')).toBe('The certificate has expired');
    expect(errorWords('EWHATEVER', 'socket   hang up')).toBe('socket hang up');
  });
  it('ping on every system', () => {
    expect(parsePing('64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.345 ms')).toBe(12.345);
    expect(parsePing('Reply from 1.1.1.1: bytes=32 time=9ms TTL=57')).toBe(9);
    expect(parsePing('Reply from 10.0.0.1: bytes=32 time<1ms TTL=64')).toBe(1);
    expect(parsePing('Antwort von 1.1.1.1: Bytes=32 Zeit=14ms TTL=57')).toBe(14);
    expect(parsePing('Request timed out.')).toBeUndefined();
    expect(pingArgs('win32', 'h', 5)).toEqual({ cmd: 'ping', args: ['-n', '1', '-w', '5000', 'h'] });
    expect(pingArgs('darwin', 'h', 5)).toEqual({ cmd: '/sbin/ping', args: ['-c', '1', '-t', '5', 'h'] });
    expect(pingArgs('linux', 'h', 5)).toEqual({ cmd: 'ping', args: ['-c', '1', '-W', '5', 'h'] });
    expect(pingArgs('darwin', '::1', 5).cmd).toBe('/sbin/ping6');
  });
});

describe('down and up again', () => {
  const ok = (at: number, extra: Partial<CheckResult> = {}): CheckResult => ({ at, ok: true, ms: 100, ...extra });
  const bad = (at: number): CheckResult => ({ at, ok: false, message: 'No answer in time' });
  it('one failure is a blip; two in a row is down; the first good check is up', () => {
    let rt = startRuntime(true, T);
    let r = step(rt, ok(T), web);
    expect(r.rt.state).toBe('up');
    expect(r.events).toEqual([]);
    r = step(r.rt, bad(T + 60_000), web);
    expect(r.rt.state).toBe('up');
    expect(r.events).toEqual([]);
    r = step(r.rt, bad(T + 120_000), web);
    expect(r.rt.state).toBe('down');
    expect(r.events).toEqual([{ kind: 'down', message: 'No answer in time' }]);
    r = step(r.rt, bad(T + 180_000), web);
    expect(r.events).toEqual([]);
    r = step(r.rt, ok(T + 600_000), web);
    expect(r.rt.state).toBe('up');
    expect(r.events).toEqual([{ kind: 'up', downFor: 480_000 }]);
    rt = r.rt;
    expect(rt.fails).toBe(0);
  });
  it('a check this computer cannot make is not an outage', () => {
    const r = step(startRuntime(true, T), { at: T, ok: false, unsupported: true, message: 'Ping is not available on this computer' }, web);
    expect(r.rt.state).toBe('paused');
    expect(r.events).toEqual([]);
  });
  it('a certificate about to expire is said once a day', () => {
    let r = step(startRuntime(true, T), ok(T, { tlsDays: 9 }), web);
    expect(r.events).toEqual([{ kind: 'tls', days: 9 }]);
    r = step(r.rt, ok(T + 3600_000, { tlsDays: 9 }), web);
    expect(r.events).toEqual([]);
    r = step(r.rt, ok(T + 86_400_000, { tlsDays: 8 }), web);
    expect(r.events).toEqual([{ kind: 'tls', days: 8 }]);
    expect(step(startRuntime(true, T), ok(T, { tlsDays: 40 }), web).events).toEqual([]);
    expect(step(startRuntime(true, T), ok(T, { tlsDays: 3 }), { tlsDays: 0 }).events).toEqual([]);
  });
});

describe('history', () => {
  it('keeps a day of checks and hourly summaries for a month, for uptime', () => {
    let h = emptyHistory();
    for (let i = 0; i < 48 * 12; i++) h = record(h, { at: T + i * 5 * 60_000, ok: i % 48 !== 0, ms: 100 + (i % 3) });
    const now = T + 48 * 3600_000;
    expect(h.recent.length).toBeLessThanOrEqual(24 * 12 + 1);
    expect(h.hours.length).toBeGreaterThanOrEqual(23);
    expect(uptime(h, now - 86_400_000)).toBeCloseTo(97.92, 1);
    expect(uptime(h, now - 30 * 86_400_000)).toBeCloseTo(97.92, 1);
    expect(uptime(emptyHistory(), T)).toBeUndefined();
    expect(typicalMs(h)).toBe(101);
    // Hourly summaries older than 30 days go.
    h = record(h, { at: now + 40 * 86_400_000, ok: true, ms: 1 });
    expect(h.hours).toEqual([]);
  });
  it('gives the chart half-hour steps with gaps where nothing answered', () => {
    let h = emptyHistory();
    h = record(h, { at: T - 10 * 60_000, ok: true, ms: 100 });
    h = record(h, { at: T - 5 * 60_000, ok: true, ms: 200 });
    h = record(h, { at: T - 2 * 3600_000, ok: false });
    const s = responseSeries(h, T);
    expect(s).toHaveLength(48);
    expect(s[47]).toMatchObject({ ms: 150, ok: true });
    expect(s[44]).toMatchObject({ ms: null, ok: false });
    expect(s[0]).toMatchObject({ ms: null, ok: null });
  });
});

describe('the schedule', () => {
  const a = newMonitor({ id: 'a', kind: 'http', target: 'https://a.example', interval: 60 }, T);
  const b = newMonitor({ id: 'b', kind: 'ping', target: 'b.example', interval: 300 }, T);
  const off = { ...newMonitor({ id: 'c', kind: 'ping', target: 'c.example' }, T), on: false };
  it('checks what is due and never paused ones', () => {
    expect(due([a, b, off], {}, T).map((m) => m.id)).toEqual(['a', 'b']);
    expect(due([a, b, off], { a: T - 30_000, b: T - 299_000 }, T).map((m) => m.id)).toEqual(['b']);
    expect(due([a, b], { a: T - 59_000, b: T }, T).map((m) => m.id)).toEqual(['a']);
  });
  it('sleeps until the next one is due, never less than 15 seconds, and not at all with none on', () => {
    expect(nextWake([a, b], { a: T, b: T }, T)).toBe(60_000);
    expect(nextWake([a], { a: T - 59_000 }, T)).toBe(15_000);
    expect(nextWake([off], {}, T)).toBeUndefined();
    expect(nextWake([], {}, T)).toBeUndefined();
  });
  it('says how long in short words', () => {
    expect(spanWords(30_000)).toBe('1 min');
    expect(spanWords(125 * 60_000)).toBe('2 h 5 min');
    expect(spanWords(5 * 86_400_000)).toBe('5 days');
  });
});
