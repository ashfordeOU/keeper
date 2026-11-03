// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The network monitor and firewall's newer parts: Ask rules, rules per profile
// and for a while, quick per-app rules, live grouping and filters, rates,
// "where your data goes", CSV, prompt batching and timing, the menu bar's part.
import { describe, expect, it } from 'vitest';
import type { FwAlert, FwConnection } from '../core/api-fw';
import { nftRule, opensnitchRule, windowsRuleScript } from '../core/fw/enforce';
import { ASK_GATHER_MS, ASK_TYPING_MAX_MS, amountText, askTiming, batchAlerts, filterCounts, groupLive, historyCsv, isNewToday, onlineLine, pushSpark, rateText, startOfDay, tally, topApps, topDestinations, whereSummary, whyConnecting, type DestTally } from '../core/fw/live';
import { appRuleId, decide, defaultFwState, enforceableGroups, importRules, exportRules, quickRuleFor, ruleForApp, scopeOf, untilFor, type Conn, type FwRule, type FwState } from '../core/fw/rules';
import { defaultGlanceSettings, glanceLayout, glanceNetView } from '../core/glance';

const NOW = new Date(2026, 10, 3, 15, 0, 0).getTime();
let n = 0;
const rule = (p: Partial<FwRule>): FwRule => ({ id: `r${++n}`, app: 'any', direction: 'out', verdict: 'allow', enabled: true, created: NOW - 1000, ...p });
const st = (rules: FwRule[], extra: Partial<FwState> = {}): FwState => ({ ...defaultFwState(), groups: [{ id: 'mine', name: 'My rules', enabled: true, source: { kind: 'local' }, rules }], ...extra });
const curl = '/usr/bin/curl';
const conn = (p: Partial<Conn> = {}): Conn => ({ app: { path: curl, name: 'curl', devtool: true }, direction: 'out', host: 'api.example.com', ip: '203.0.113.9', port: 443, proto: 'tcp', ...p });

describe('rules: app, host, time and profile', () => {
  it('a rule for one app does not touch another app', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'deny' })]);
    expect(decide(s, conn(), NOW).verdict).toBe('deny');
    expect(decide(s, conn({ app: { path: '/usr/bin/wget', name: 'wget' } }), NOW).verdict).toBe('ask');
  });
  it('a host rule beats an app-wide rule; another host still follows the app-wide one', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'deny' }), rule({ app: { path: curl }, host: '=api.example.com', verdict: 'allow' })]);
    expect(decide(s, conn(), NOW).verdict).toBe('allow');
    expect(decide(s, conn({ host: 'cdn.example.org' }), NOW).verdict).toBe('deny');
  });
  it('an hour-long rule ends; "until quit" ends with the run it was made in', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'deny', until: untilFor('hour', NOW) })]);
    expect(decide(s, conn(), NOW + 59 * 60_000).verdict).toBe('deny');
    expect(decide(s, conn(), NOW + 61 * 60_000).verdict).toBe('ask');
    const q = st([rule({ app: { path: curl }, verdict: 'deny', until: 'quit', created: NOW - 5000 })]);
    expect(decide(q, conn(), NOW, NOW - 10_000).verdict).toBe('deny');
    expect(decide(q, conn(), NOW, NOW - 1000).verdict).toBe('ask');
    expect([untilFor('forever', NOW), untilFor('quit', NOW), untilFor('hour', NOW)]).toEqual([undefined, 'quit', NOW + 3600_000]);
    expect([scopeOf({}), scopeOf({ until: 'quit' }), scopeOf({ until: NOW })]).toEqual(['forever', 'quit', 'hour']);
  });
  it('a rule limited to a profile only counts there', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'deny', profiles: ['public'] })]);
    expect(decide({ ...s, activeProfile: 'home' }, conn(), NOW).verdict).toBe('ask');
    expect(decide({ ...s, activeProfile: 'public' }, conn(), NOW).verdict).toBe('deny');
    expect(defaultFwState().profiles.map((p) => p.name)).toEqual(['Home', 'Work', 'Public Wi-Fi']);
  });
  it('Ask: holds even in a quiet mode; equal rules: deny, then ask, then allow', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'ask' })], { mode: 'silent-allow' });
    const d = decide(s, conn(), NOW);
    expect(d.verdict).toBe('ask');
    expect(d.rule?.verdict).toBe('ask');
    expect(decide(st([rule({ app: { path: curl }, verdict: 'allow' }), rule({ app: { path: curl }, verdict: 'ask' })]), conn(), NOW).verdict).toBe('ask');
    expect(decide(st([rule({ app: { path: curl }, verdict: 'ask' }), rule({ app: { path: curl }, verdict: 'deny' })]), conn(), NOW).verdict).toBe('deny');
  });
  it('Ask rules, ended rules and other profiles never reach the system', () => {
    const s = st([rule({ ip: '198.51.100.1', verdict: 'ask' }), rule({ ip: '198.51.100.2', verdict: 'deny', until: NOW - 1 }), rule({ ip: '198.51.100.3', verdict: 'deny', profiles: ['work'] }), rule({ ip: '198.51.100.4', verdict: 'deny' })]);
    const kept = enforceableGroups(s, NOW)[0].rules.map((r) => r.ip);
    expect(kept).toEqual(['198.51.100.4']);
    expect(nftRule(rule({ ip: '198.51.100.1', verdict: 'ask' }))).toBeNull();
    expect(windowsRuleScript(rule({ ip: '198.51.100.1', verdict: 'ask' }))).toBeNull();
    expect(opensnitchRule(rule({ app: { path: curl }, verdict: 'ask' }))).toBeNull();
  });
  it('Ask rules survive export and import', () => {
    const s = st([rule({ app: { path: curl }, verdict: 'ask', profiles: ['home'] })]);
    const back = importRules(exportRules(s));
    expect(back.problems).toEqual([]);
    expect(back.groups[0].rules[0]).toMatchObject({ verdict: 'ask', profiles: ['home'] });
  });
  it('quick rules: one per app (and host), found again, signed apps by signer', () => {
    const r = ruleForApp({ app: 'curl', path: curl }, 'deny', 'forever', { now: NOW });
    expect(r).toMatchObject({ app: { path: curl }, verdict: 'deny', direction: 'out', until: undefined });
    expect(r.host).toBeUndefined();
    expect(r.id.startsWith(`${appRuleId(curl)}-`)).toBe(true);
    const h = ruleForApp({ app: 'curl', path: curl, signer: 'deb:curl', host: 'api.example.com' }, 'allow', 'hour', { now: NOW, profiles: ['work'] });
    expect(h).toMatchObject({ host: '=api.example.com', app: { signer: 'deb:curl', path: curl }, until: NOW + 3600_000, profiles: ['work'] });
    expect(appRuleId(curl)).not.toBe(appRuleId(curl, 'api.example.com'));
    const s = st([r, h]);
    expect(quickRuleFor(s, curl)?.verdict).toBe('deny');
    expect(quickRuleFor(s, curl, 'api.example.com')?.verdict).toBe('allow');
    expect(quickRuleFor(s, '/usr/bin/wget')).toBeUndefined();
    const signed = conn({ app: { path: curl, name: 'curl', signer: 'deb:curl' } });
    expect(decide({ ...s, activeProfile: 'work' }, signed, NOW).verdict).toBe('allow');
    expect(decide({ ...s, activeProfile: 'home' }, signed, NOW).verdict).toBe('deny');
  });
});

describe('rates and amounts', () => {
  it('short, one unit, never wrapping', () => {
    expect(rateText(0)).toBe('0 B/s');
    expect(rateText(-5)).toBe('0 B/s');
    expect(rateText(NaN)).toBe('0 B/s');
    expect(rateText(512)).toBe('512 B/s');
    expect(rateText(900)).toBe('900 B/s');
    expect(rateText(1000)).toBe('1 KB/s');
    expect(rateText(1024)).toBe('1 KB/s');
    expect(rateText(34 * 1024)).toBe('34 KB/s');
    expect(rateText(3.14 * 1024 * 1024)).toBe('3.1 MB/s');
    expect(rateText(1.2 * 1024 ** 3)).toBe('1.2 GB/s');
    expect(amountText(12 * 1024)).toBe('12 KB');
    expect(onlineLine(0)).toBe('Nothing online right now');
    expect(onlineLine(1)).toBe('1 app online');
    expect(onlineLine(3)).toBe('3 apps online');
  });
  it('sparkline buffers keep the last n values and drop keys gone quiet', () => {
    let b = new Map<string, number[]>();
    for (let i = 1; i <= 5; i++) b = pushSpark(b, new Map([['a', i], ['b', -1]]), 3);
    expect(b.get('a')).toEqual([3, 4, 5]);
    expect(b.get('b')).toEqual([0, 0, 0]);
    b = pushSpark(b, new Map([['a', 6]]), 3);
    expect([...b.keys()]).toEqual(['a']);
  });
});

const row = (p: Partial<FwConnection & { firstSeen?: number }>): FwConnection & { firstSeen?: number } => ({ key: Math.random().toString(36), app: 'curl', appPath: curl, host: 'api.example.com', ip: '203.0.113.9', port: 443, proto: 'TCP', rateIn: 0, rateOut: 0, decision: 'allow', reason: 'No rule yet', ...p });

describe('live: grouped by app, then host', () => {
  const rows = [
    row({ rateIn: 50_000, rateOut: 2000, bytesIn: 10, firstSeen: NOW - 9 * 86_400_000 }),
    row({ port: 8443, rateIn: 1000, firstSeen: NOW - 9 * 86_400_000 }),
    row({ host: 'cdn.example.org', ip: '198.51.100.7', rateIn: 0, decision: 'deny', reason: 'Denied by a rule', firstSeen: NOW - 3600_000 }),
    row({ app: 'Firefox', appPath: '/usr/lib/firefox/firefox', host: 'news.example.net', rateIn: 400_000, country: 'NL', firstSeen: NOW - 60_000 }),
  ];
  it('one row per host, ports merged, apps by traffic', () => {
    const g = groupLive(rows, { now: NOW, watchingSince: NOW - 20 * 86_400_000 });
    expect(g.map((a) => a.app)).toEqual(['Firefox', 'curl']);
    const c = g[1];
    expect(c.hosts.map((h) => h.host)).toEqual(['api.example.com', 'cdn.example.org']);
    expect(c.hosts[0]).toMatchObject({ ports: [443, 8443], conns: 2, rateIn: 51_000 });
    expect(c).toMatchObject({ rateIn: 51_000, rateOut: 2000, conns: 3, blocked: 1, newHosts: 1 });
  });
  it('filters: active, blocked, new today; search by app, host, country or port', () => {
    const o = { now: NOW, watchingSince: NOW - 20 * 86_400_000 };
    expect(groupLive(rows, { ...o, filter: 'active' }).flatMap((a) => a.hosts.map((h) => h.host))).toEqual(['news.example.net', 'api.example.com']);
    expect(groupLive(rows, { ...o, filter: 'blocked' }).flatMap((a) => a.hosts.map((h) => h.host))).toEqual(['cdn.example.org']);
    expect(groupLive(rows, { ...o, filter: 'new' }).flatMap((a) => a.hosts.map((h) => h.host))).toEqual(['news.example.net', 'cdn.example.org']);
    expect(groupLive(rows, { ...o, query: 'nl' }).map((a) => a.app)).toEqual(['Firefox']);
    expect(groupLive(rows, { ...o, query: 'curl 8443' })[0].hosts.map((h) => h.host)).toEqual(['api.example.com']);
    expect(filterCounts(rows, o)).toEqual({ all: 3, active: 2, blocked: 1, new: 2 });
    expect(topApps(groupLive(rows, o), 1).map((a) => a.app)).toEqual(['Firefox']);
  });
  it('"new today" needs watching from before today', () => {
    expect(isNewToday(NOW - 60_000, NOW - 86_400_000, NOW)).toBe(true);
    expect(isNewToday(NOW - 60_000, startOfDay(NOW) + 1, NOW)).toBe(false);
    expect(isNewToday(NOW - 2 * 86_400_000, NOW - 9 * 86_400_000, NOW)).toBe(false);
    expect(isNewToday(undefined, NOW - 9 * 86_400_000, NOW)).toBe(false);
  });
});

describe('where your data goes', () => {
  const t: DestTally = {};
  tally(t, NOW, 'Firefox', 'news.example.net', 5e6, 1e5, 2);
  tally(t, NOW, 'Firefox', 'img.example.net', 1e6, 0, 1);
  tally(t, NOW - 86_400_000, 'Firefox', 'news.example.net', 4e6, 1e5, 1);
  tally(t, NOW, 'curl', 'api.example.com', 2e5, 4e4, 3);
  tally(t, NOW, 'curl', 'nothing.example', 0, 0, 0);
  it('top destinations, for all or one app', () => {
    expect(topDestinations(t, NOW - 7 * 86_400_000, NOW).map((d) => [d.host, d.inB])).toEqual([['news.example.net', 9e6], ['img.example.net', 1e6], ['api.example.com', 2e5]]);
    expect(topDestinations(t, startOfDay(NOW), NOW, { app: 'Firefox' }).map((d) => d.conns)).toEqual([2, 1]);
    expect(topDestinations(t, NOW - 7 * 86_400_000, NOW, { app: 'curl' })[0].apps).toEqual(['curl']);
  });
  it('per app, hosts folded into their domain, with counts', () => {
    const w = whereSummary(t, NOW - 7 * 86_400_000, NOW);
    expect(w.apps.map((a) => a.app)).toEqual(['Firefox', 'curl']);
    expect(w.apps[0].hosts).toEqual([expect.objectContaining({ host: 'example.net', inB: 10e6, conns: 4 })]);
    expect(w.places).toBe(2);
    expect(w.totalIn).toBe(10.2e6);
  });
  it('old days fall away', () => {
    const x: DestTally = {};
    tally(x, NOW - 40 * 86_400_000, 'a', 'h', 1, 1);
    tally(x, NOW, 'a', 'h', 1, 1);
    expect(Object.keys(x)).toEqual([String(startOfDay(NOW))]);
  });
  it('CSV for a spreadsheet, formulas made harmless', () => {
    const csv = historyCsv([{ t: Date.UTC(2026, 10, 3), inB: 10, outB: 2 }], [{ app: '=HYPERLINK("x")', inB: 1, outB: 2 }], [{ host: 'a.example', inB: 3, outB: 4, conns: 5, apps: ['curl', 'wget'] }]);
    expect(csv).toContain('2026-11-03T00:00:00.000Z,10,2');
    expect(csv).toContain(`"'=HYPERLINK(""x"")",1,2`);
    expect(csv).toContain('a.example,3,4,5,curl wget');
  });
});

const alert = (id: string, path: string, host: string, t: number, p: Partial<FwAlert> = {}): FwAlert => ({ id, t, conn: { app: { path, name: path.split('/').pop() }, direction: 'out', host, ip: '203.0.113.1', port: 443, proto: 'tcp' }, monitorOnly: true, attempts: 1, ...p });

describe('the Ask prompt', () => {
  it('batches one prompt per app, oldest app first, newest place first, no repeats', () => {
    const b = batchAlerts([
      alert('1', '/usr/bin/curl', 'a.example.com', NOW - 5000),
      alert('2', '/opt/Notion', 'api.segment.io', NOW - 9000),
      alert('3', '/usr/bin/curl', 'b.example.com', NOW - 1000, { attempts: 3 }),
      alert('4', '/usr/bin/curl', 'a.example.com', NOW - 500),
    ]);
    expect(b.map((x) => x.app)).toEqual(['Notion', 'curl']);
    expect(b[1].hosts).toEqual(['a.example.com', 'b.example.com']);
    expect(b[1]).toMatchObject({ attempts: 5, first: NOW - 5000, last: NOW - 500 });
    expect(b[0].why).toBe('Looks like usage or crash reports.');
  });
  it('says plainly why an app may connect', () => {
    expect(whyConnecting({ host: 'swupdate.example.com' })).toBe('Probably checking for updates.');
    expect(whyConnecting({ host: 'ocsp.digicert.com' })).toBe('Checking that a certificate is still valid.');
    expect(whyConnecting({ host: 'x.example', port: 22 })).toBe('A secure shell (remote login).');
    expect(whyConnecting({ host: 'registry.npmjs.org' })).toBe('Downloading code packages.');
    expect(whyConnecting({ host: 'x.example', browser: true })).toBe('A page you opened, or something it loads.');
    expect(whyConnecting({ host: 'x.example', port: 9999 })).toMatch(/can’t tell/);
  });
  it('gathers for a moment, waits while you type (not forever), respects Later', () => {
    const since = NOW - 10_000;
    expect(askTiming({ now: NOW, idleMs: 60_000, showing: false })).toEqual({ show: false });
    expect(askTiming({ now: NOW, pendingSince: NOW - 1000, idleMs: 60_000, showing: false })).toEqual({ show: false, recheckMs: ASK_GATHER_MS - 1000 });
    expect(askTiming({ now: NOW, pendingSince: since, idleMs: 300, showing: false })).toEqual({ show: false, recheckMs: 1000 });
    expect(askTiming({ now: NOW, pendingSince: since, idleMs: 5000, showing: false }).show).toBe(true);
    expect(askTiming({ now: NOW, pendingSince: NOW - ASK_TYPING_MAX_MS - 1, idleMs: 0, showing: false }).show).toBe(true);
    expect(askTiming({ now: NOW, pendingSince: since, idleMs: 5000, showing: false, snoozedUntil: NOW + 60_000 })).toEqual({ show: false, recheckMs: 60_000 });
    expect(askTiming({ now: NOW, pendingSince: since, idleMs: 0, showing: true }).show).toBe(true);
  });
});

describe('the menu bar part', () => {
  it('a line, short rates, the busiest three and the waiting pill', () => {
    const v = glanceNetView({ apps: 3, down: 34 * 1024, up: 2 * 1024, spark: [1, 2], top: [{ app: 'Spotify', down: 30 * 1024, up: 1024, blocked: false }], waiting: 2, canBlock: true });
    expect(v).toMatchObject({ line: '3 apps online', rates: '↓34 ↑2 KB/s', waiting: '2 waiting', canBlock: true });
    expect(v.top[0]).toMatchObject({ app: 'Spotify', rate: '31 KB/s' });
    expect(glanceNetView({ apps: 0, down: 0, up: 0, spark: [], top: [], waiting: 0, canBlock: false }).waiting).toBeUndefined();
    // Windows without administrator access: no speeds per app, so none are made up.
    const w = glanceNetView({ apps: 2, down: 0, up: 0, spark: [0, 0], top: [{ app: 'Edge', down: 0, up: 0, blocked: false, places: 4 }], waiting: 0, canBlock: true, counted: false });
    expect(w).toMatchObject({ rates: 'speeds not counted', spark: [] });
    expect(w.top[0].rate).toBe('4 places');
  });
  it('shows only when switched on', () => {
    const net = { apps: 1, down: 1, up: 1, spark: [], top: [], waiting: 0, canBlock: false };
    const on = defaultGlanceSettings('darwin');
    expect(glanceLayout({ now: NOW, net }, on, { list: [], total: 0 }).net?.line).toBe('1 app online');
    expect(glanceLayout({ now: NOW, net }, { ...on, sections: { ...on.sections, network: false } }, { list: [], total: 0 }).net).toBeUndefined();
  });
});
