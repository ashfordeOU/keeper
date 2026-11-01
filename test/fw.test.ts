// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { DomainSet, IpSet, detectFormat, parseList } from '../core/fw/blocklist';
import { blockedReply, buildQuery, errorReply, namesIn, parseMessage } from '../core/fw/dns';
import { capabilities, nftRule, nftTable, opensnitchRule, parseEvent5157, parseFirewallLog, pfRules, psq, windowsDefaultBlockScript, windowsRuleScript } from '../core/fw/enforce';
import { arcPath, countryPoint, emptyHistory, greatCircle, isUnusual, matchesSearch, parseSearch, project, record, series, updateBaseline, worldPath, type Baseline } from '../core/fw/monitor';
import { covers, decide, defaultFwState, exportRules, hostMatches, importRules, ipMatches, profileForNetwork, registrable, ruleFromAlert, specificity, suggestMerges, tidy, type Conn, type FwRule, type FwState } from '../core/fw/rules';

const NOW = Date.UTC(2026, 9, 31, 12);
let n = 0;
const rule = (p: Partial<FwRule>): FwRule => ({ id: `r${++n}`, app: 'any', direction: 'out', verdict: 'allow', enabled: true, created: NOW - 1000, ...p });
const st = (rules: FwRule[], extra: Partial<FwState> = {}): FwState => ({ ...defaultFwState(), groups: [{ id: 'mine', name: 'My rules', enabled: true, source: { kind: 'local' }, rules }], ...extra });
const conn = (p: Partial<Conn> = {}): Conn => ({ app: { path: '/Applications/Firefox.app/Contents/MacOS/firefox', name: 'firefox', signer: 'TEAM1', browser: true }, direction: 'out', host: 'tracker.example.com', ip: '93.184.216.34', port: 443, proto: 'tcp', ...p });
const firefox = { path: '/Applications/Firefox.app/Contents/MacOS/firefox' };

describe('rules: matching', () => {
  it('hosts: a domain covers its subdomains, = only the host, *. only subdomains', () => {
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('example.com', 'a.b.example.com')).toBe(true);
    expect(hostMatches('example.com', 'notexample.com')).toBe(false);
    expect(hostMatches('=www.example.com', 'www.example.com')).toBe(true);
    expect(hostMatches('=www.example.com', 'a.www.example.com')).toBe(false);
    expect(hostMatches('*.example.com', 'example.com')).toBe(false);
    expect(hostMatches('*.example.com', 'x.example.com')).toBe(true);
  });
  it('addresses and ranges, v4 and v6, and v4-mapped v6', () => {
    expect(ipMatches('93.184.216.0/24', '93.184.216.34')).toBe(true);
    expect(ipMatches('93.184.216.34', '93.184.216.34')).toBe(true);
    expect(ipMatches('10.0.0.0/8', '11.0.0.1')).toBe(false);
    expect(ipMatches('2606:2800::/32', '2606:2800:220:1::1')).toBe(true);
    expect(ipMatches('93.184.216.0/24', '::ffff:93.184.216.34')).toBe(true);
  });
  it('an app is matched by every identity the rule names (a signer survives renaming)', () => {
    expect(decide(st([rule({ app: { signer: 'TEAM1' }, verdict: 'deny' })]), conn()).verdict).toBe('deny');
    expect(decide(st([rule({ app: { signer: 'TEAM2' }, verdict: 'deny' })]), conn()).verdict).toBe('ask');
    expect(decide(st([rule({ app: { group: 'browsers' }, verdict: 'deny' })]), conn()).verdict).toBe('deny');
    expect(decide(st([rule({ app: { group: 'system' }, verdict: 'deny' })]), conn()).verdict).toBe('ask');
  });
  it('ports and ranges, protocols and directions', () => {
    expect(decide(st([rule({ port: '443', verdict: 'deny' })]), conn()).verdict).toBe('deny');
    expect(decide(st([rule({ port: '8000-9000', verdict: 'deny' })]), conn()).verdict).toBe('ask');
    expect(decide(st([rule({ proto: 'udp', verdict: 'deny' })]), conn()).verdict).toBe('ask');
    expect(decide(st([rule({ direction: 'in', verdict: 'deny' })]), conn()).verdict).toBe('ask');
    expect(decide(st([rule({ direction: 'both', verdict: 'deny' })]), conn()).verdict).toBe('deny');
  });
});

describe('rules: which one wins (the documented order)', () => {
  it('the more specific rule wins, in order: priority, who, where, port, protocol', () => {
    const cases: [FwRule[], 'allow' | 'deny'][] = [
      [[rule({ verdict: 'deny' }), rule({ app: firefox, verdict: 'allow' })], 'allow'], // who beats anything
      [[rule({ app: firefox, verdict: 'deny' }), rule({ app: firefox, host: 'example.com', verdict: 'allow' })], 'allow'], // where
      [[rule({ app: firefox, host: 'example.com', verdict: 'allow' }), rule({ app: firefox, host: 'tracker.example.com', verdict: 'deny' })], 'deny'], // longer domain
      [[rule({ app: firefox, host: 'tracker.example.com', verdict: 'deny' }), rule({ app: firefox, host: '=tracker.example.com', verdict: 'allow' })], 'allow'], // exact host
      [[rule({ app: firefox, ip: '93.184.0.0/16', verdict: 'deny' }), rule({ app: firefox, ip: '93.184.216.0/24', verdict: 'allow' })], 'allow'], // narrower range
      [[rule({ app: firefox, verdict: 'deny' }), rule({ app: firefox, port: '443', verdict: 'allow' })], 'allow'], // port
      [[rule({ app: firefox, port: '443', verdict: 'deny' }), rule({ app: firefox, port: '443', proto: 'tcp', verdict: 'allow' })], 'allow'], // protocol
      [[rule({ app: firefox, host: '=tracker.example.com', verdict: 'allow' }), rule({ verdict: 'deny', priority: 'high' })], 'deny'], // priority above all
      [[rule({ app: firefox, verdict: 'allow' }), rule({ app: firefox, verdict: 'deny' })], 'deny'], // a tie: deny wins
      [[rule({ app: { signer: 'TEAM1' }, verdict: 'deny' }), rule({ app: { signer: 'TEAM1', path: firefox.path }, verdict: 'allow' })], 'allow'], // signer+path beats signer
    ];
    for (const [rules, want] of cases) expect(decide(st(rules), conn()).verdict, JSON.stringify(rules.map((r) => [r.verdict, r.app, r.host, r.ip, r.port, r.proto, r.priority]))).toBe(want);
  });
  it('specificity tuples are ordered as documented', () => {
    expect(specificity(rule({ host: '=a.b.c' }))[2]).toBeGreaterThan(specificity(rule({ host: 'a.b.c' }))[2]);
    expect(specificity(rule({ host: 'a.b.c' }))[2]).toBeGreaterThan(specificity(rule({ ip: '1.2.3.4' }))[2]);
  });
  it('switched-off, expired and "until quit" rules from an earlier run are ignored', () => {
    expect(decide(st([rule({ verdict: 'deny', enabled: false })]), conn(), NOW).verdict).toBe('ask');
    expect(decide(st([rule({ verdict: 'deny', until: NOW - 1 })]), conn(), NOW).verdict).toBe('ask');
    expect(decide(st([rule({ verdict: 'deny', until: NOW + 60_000 })]), conn(), NOW).verdict).toBe('deny');
    expect(decide(st([rule({ verdict: 'deny', until: 'quit', created: NOW - 5000 })]), conn(), NOW, NOW - 1000).verdict).toBe('ask');
  });
  it('a broken rule (port 99999) is skipped instead of breaking every decision', () => {
    expect(decide(st([rule({ port: '99999', verdict: 'deny' }), rule({ app: firefox, verdict: 'allow' })]), conn()).verdict).toBe('allow');
  });
  it('quiet modes decide connections without a rule; a profile can have its own mode', () => {
    expect(decide(st([], { mode: 'silent-allow' }), conn()).verdict).toBe('allow');
    expect(decide(st([], { mode: 'silent-deny' }), conn()).verdict).toBe('deny');
    const s = st([], { mode: 'silent-allow', profiles: [{ id: 'p', name: 'Cafe', groupsOff: [], mode: 'silent-deny' }], activeProfile: 'p' });
    expect(decide(s, conn()).verdict).toBe('deny');
  });
  it('a profile switches whole groups off', () => {
    const s = st([rule({ verdict: 'deny' })], { profiles: [{ id: 'home', name: 'Home', groupsOff: ['mine'] }], activeProfile: 'home' });
    expect(decide(s, conn()).verdict).toBe('ask');
  });
});

describe('profiles and alerts', () => {
  it('switches profile by Wi-Fi name or router when automatic switching is on', () => {
    const s = st([], { autoSwitch: true, profiles: [{ id: 'home', name: 'Home', groupsOff: [], auto: { ssids: ['Home-5G'] } }, { id: 'work', name: 'Work', groupsOff: [], auto: { gateways: ['10.1.0.1'] } }] });
    expect(profileForNetwork(s, { ssid: 'Home-5G' })).toBe('home');
    expect(profileForNetwork(s, { gateway: '10.1.0.1' })).toBe('work');
    expect(profileForNetwork({ ...s, autoSwitch: false }, { ssid: 'Home-5G' })).toBeUndefined();
  });
  it('an answer makes a rule for this app and host, with scopes', () => {
    const r = ruleFromAlert(conn(), 'deny', 'hour', {}, NOW);
    expect(r).toMatchObject({ app: { signer: 'TEAM1', path: firefox.path }, host: '=tracker.example.com', port: '443', verdict: 'deny', until: NOW + 3600_000 });
    expect(ruleFromAlert(conn(), 'allow', 'forever', { wholeDomain: true, anyPort: true }, NOW)).toMatchObject({ host: 'example.com', port: undefined, until: undefined });
    expect(ruleFromAlert(conn({ host: undefined }), 'allow', 'quit', {}, NOW)).toMatchObject({ ip: '93.184.216.34', until: 'quit' });
    expect(registrable('eu.api.example.co.uk')).toBe('example.co.uk');
  });
});

describe('tidy up, merges, import and export', () => {
  it('finds broken, expired, duplicate and covered rules — but not a rule protected by an exception', () => {
    const a = rule({ app: firefox, verdict: 'deny' });
    const b = rule({ app: firefox, host: 'example.com', verdict: 'deny' });
    const dup = rule({ app: firefox, verdict: 'deny' });
    const bad = rule({ port: '99999' });
    const old = rule({ until: NOW - 1 });
    const notes = tidy(st([a, b, dup, bad, old]), NOW);
    expect(notes.find((x) => x.ruleId === b.id)?.kind).toBe('covered');
    expect(notes.find((x) => x.ruleId === dup.id)?.kind).toBe('duplicate');
    expect(notes.find((x) => x.ruleId === bad.id)?.kind).toBe('invalid');
    expect(notes.find((x) => x.ruleId === old.id)?.kind).toBe('expired');
    // deny all, allow example.com, deny tracker.example.com: the last is NOT redundant.
    const outer = rule({ app: firefox, verdict: 'deny' });
    const exc = rule({ app: firefox, host: 'example.com', verdict: 'allow' });
    const inner = rule({ app: firefox, host: 'tracker.example.com', verdict: 'deny' });
    expect(tidy(st([outer, exc, inner]), NOW).some((x) => x.ruleId === inner.id)).toBe(false);
    expect(covers(rule({ ip: '10.0.0.0/8' }), rule({ ip: '10.1.0.0/16' }))).toBe(true);
    expect(covers(rule({ ip: '10.1.0.0/16' }), rule({ ip: '10.0.0.0/8' }))).toBe(false);
  });
  it('suggests one range for several single-port rules', () => {
    const rs = [8001, 8002, 8003].map((p) => rule({ app: firefox, port: String(p) }));
    expect(suggestMerges(rs)[0].merged.port).toBe('8001-8003');
  });
  it('round-trips rules through export/import and refuses bad rules with a reason', () => {
    const s = st([rule({ app: firefox, host: 'example.com', port: '443', verdict: 'deny', hits: 9 })]);
    const back = importRules(exportRules(s));
    expect(back.groups[0].rules[0]).toMatchObject({ host: 'example.com', port: '443', verdict: 'deny' });
    expect(back.groups[0].rules[0].hits).toBeUndefined();
    const bad = JSON.stringify({ format: 'keeper-firewall/1', groups: [{ id: 'g', name: 'G', rules: [{ id: 'x', verdict: 'deny', direction: 'out', port: 'abc' }, { id: 'y', verdict: 'maybe', direction: 'out' }, { id: 'z', verdict: 'deny', direction: 'out', host: 'a b;rm -rf' }] }] });
    const r = importRules(bad);
    expect(r.groups[0].rules).toHaveLength(0);
    expect(r.problems).toHaveLength(3);
    expect(() => importRules('{"format":"other"}')).toThrow();
  });
});

describe('blocklists', () => {
  const hosts = '# comment\n0.0.0.0 ads.example.com tracker.example.net\n127.0.0.1 localhost\n0.0.0.0 0.0.0.0\n::1 ip6-localhost\n';
  const adb = '! title\n||ads.example.com^\n||cdn.example.org^$third-party\n@@||good.ads.example.com^\n##.banner\n||example.com/path^\n';
  const ipl = '# firehol\n1.2.3.0/24\n5.6.7.8\n2001:db8::/32\nnonsense\n';
  it('detects and parses hosts, ad-blocker and address lists', () => {
    expect(detectFormat(hosts)).toBe('hosts');
    expect(detectFormat(adb)).toBe('adblock');
    expect(detectFormat(ipl)).toBe('ips');
    expect(detectFormat('example.com\nads.example.net\n')).toBe('domains');
    expect(parseList(hosts).domains).toEqual(['ads.example.com', 'tracker.example.net']);
    const a = parseList(adb);
    expect(a.domains).toEqual(['ads.example.com', 'cdn.example.org']);
    expect(a.allow).toEqual(['good.ads.example.com']);
    expect(parseList(ipl).cidrs).toEqual(['1.2.3.0/24', '5.6.7.8/32', '2001:db8::/32']);
  });
  it('matches subdomains, honours exceptions, and finds addresses in ranges', () => {
    const d = new DomainSet();
    d.add(['ads.example.com'], 'L1');
    d.allow(['good.ads.example.com']);
    expect(d.match('x.ads.example.com')).toBe('L1');
    expect(d.match('good.ads.example.com')).toBeUndefined();
    expect(d.match('example.com')).toBeUndefined();
    const s = new IpSet();
    s.add(['1.2.3.0/24', '10.0.0.0/8', '2001:db8::/32'], 'IPL');
    expect(s.match('1.2.3.200')).toBe('IPL');
    expect(s.match('10.200.1.1')).toBe('IPL');
    expect(s.match('1.2.4.1')).toBeUndefined();
    expect(s.match('2001:db8::1')).toBe('IPL');
  });
});

describe('DNS messages', () => {
  it('round-trips a query and builds blocked replies (0.0.0.0 for A, :: for AAAA, NXDOMAIN otherwise)', () => {
    const q = buildQuery('ads.example.com', 1, 4242);
    const m = parseMessage(q);
    expect(m).toMatchObject({ id: 4242, questions: [{ name: 'ads.example.com', type: 1 }] });
    const r = parseMessage(blockedReply(q));
    expect(r.id).toBe(4242);
    expect(r.rcode).toBe(0);
    expect(r.answers[0]).toMatchObject({ type: 1, data: '0.0.0.0' });
    expect(parseMessage(blockedReply(buildQuery('x.com', 28))).answers[0].data).toBe('::');
    expect(parseMessage(blockedReply(buildQuery('x.com', 16))).rcode).toBe(3);
    expect(parseMessage(errorReply(q, 2)).rcode).toBe(2);
  });
  it('reads compressed names and finds CNAME targets (cloaked trackers)', () => {
    // A reply: question a.example.com, CNAME → t.tracker.net, A 1.2.3.4
    const q = buildQuery('a.example.com', 1, 7);
    const head = Buffer.from(q);
    head.writeUInt16BE(0x8180, 2);
    head.writeUInt16BE(2, 6);
    const cname = Buffer.concat([Buffer.from([0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 60, 0, 15]), Buffer.from([1, 0x74, 7, ...Buffer.from('tracker'), 3, ...Buffer.from('net'), 0])]);
    const a = Buffer.from([0xc0, 0x2b, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 1, 2, 3, 4]);
    const m = parseMessage(Buffer.concat([head, cname, a]));
    expect(m.answers.map((x) => x.data)).toEqual(['t.tracker.net', '1.2.3.4']);
    expect(namesIn(m)).toEqual(['a.example.com', 't.tracker.net']);
  });
  it('refuses malformed messages instead of reading past the end', () => {
    expect(() => parseMessage(Buffer.from([1, 2, 3]))).toThrow();
    const loop = Buffer.concat([buildQuery('a.com', 1).subarray(0, 12), Buffer.from([0xc0, 0x0c, 0, 1, 0, 1])]);
    loop.writeUInt16BE(1, 4);
    expect(() => parseMessage(loop)).toThrow();
  });
});

describe('enforcement: commands and logs', () => {
  it('Windows rules quote app paths and hosts so they can never run as commands', () => {
    const evil = "C:\\Users\\x\\a'; Remove-Item -Recurse C:\\ ;'.exe";
    const s = windowsRuleScript(rule({ app: { path: evil }, ip: '1.2.3.4', port: '443', verdict: 'deny', note: "x'; calc'" }))!;
    expect(s).toContain("-Program 'C:\\Users\\x\\a''; Remove-Item -Recurse C:\\ ;''.exe'");
    expect(s).toContain("-DisplayName 'Keeper: x''; calc'''");
    expect(s).toMatch(/-Action Block/);
    expect(s).toMatch(/-RemotePort '443'/);
    expect(psq('a’b')).toBe("'a''b'");
    // Host rules need resolved addresses on Windows.
    expect(windowsRuleScript(rule({ host: 'example.com' }))).toBeNull();
    expect(windowsRuleScript(rule({ host: 'example.com' }), ['93.184.216.34'])).toContain("-RemoteAddress @('93.184.216.34')");
    expect(windowsDefaultBlockScript(true)).toMatch(/DefaultOutboundAction Block/);
    expect(windowsDefaultBlockScript(true).indexOf('svchost')).toBeLessThan(windowsDefaultBlockScript(true).indexOf('DefaultOutboundAction Block'));
  });
  it('reads Windows event 5157 and the firewall log', () => {
    const xml = `<Event><System><EventID>5157</EventID><TimeCreated SystemTime='2026-10-31T12:00:00.000Z'/></System><EventData><Data Name='ProcessID'>4321</Data><Data Name='Application'>\\device\\harddiskvolume3\\program files\\app\\app.exe</Data><Data Name='Direction'>%%14593</Data><Data Name='SourceAddress'>192.168.1.5</Data><Data Name='SourcePort'>51000</Data><Data Name='DestAddress'>93.184.216.34</Data><Data Name='DestPort'>443</Data><Data Name='Protocol'>6</Data></EventData></Event>`;
    expect(parseEvent5157(xml)).toMatchObject({ pid: 4321, direction: 'out', remote: '93.184.216.34', remotePort: 443, proto: 'tcp', app: expect.stringContaining('app.exe') });
    expect(parseEvent5157('<Event><EventID>4624</EventID></Event>')).toBeNull();
    const log = '#Version: 1.5\n#Fields: date time action protocol src-ip dst-ip src-port dst-port size tcpflags tcpsyn tcpack tcpwin icmptype icmpcode info path pid\n2026-10-31 12:00:01 DROP TCP 192.168.1.5 93.184.216.34 51001 443 0 - 0 0 0 - - - SEND 4321\n2026-10-31 12:00:02 ALLOW TCP 192.168.1.5 1.1.1.1 51002 443 0 - 0 0 0 - - - SEND 4321\n';
    const got = parseFirewallLog(log);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ remote: '93.184.216.34', remotePort: 443, pid: 4321, direction: 'out', proto: 'tcp' });
  });
  it('nftables: deny before allow, ranges and ports, no way to inject through a rule', () => {
    const t = nftTable([{ id: 'g', name: 'G', enabled: true, source: { kind: 'local' }, rules: [rule({ ip: '1.2.3.0/24', verdict: 'allow' }), rule({ ip: '1.2.3.4', port: '22', verdict: 'deny' })] }], { defaultOutbound: 'drop' });
    expect(t.indexOf('1.2.3.4')).toBeLessThan(t.indexOf('1.2.3.0/24'));
    expect(t).toContain('tcp dport 22');
    expect(t).toMatch(/log prefix "keeper-default " group 7 drop/);
    expect(nftRule(rule({ ip: '1.2.3.4"; flush ruleset; "', verdict: 'deny' }))).toBeNull();
    expect(nftRule(rule({ app: firefox, verdict: 'deny' }))).toBeNull(); // per-app needs cgroups or OpenSnitch
    expect(nftRule(rule({ app: firefox, verdict: 'deny' }), { cgroupOf: () => 'user.slice/app.slice/keeper-firefox.scope' })).toContain('socket cgroupv2 level 3');
  });
  it('OpenSnitch rule files and pf rules', () => {
    const o = JSON.parse(opensnitchRule(rule({ app: firefox, host: 'example.com', port: '443', verdict: 'deny' }))!.json);
    expect(o).toMatchObject({ action: 'deny', duration: 'always', operator: { type: 'list' } });
    expect(o.operator.list.map((x: { operand: string }) => x.operand)).toEqual(['process.path', 'dest.host', 'dest.port']);
    expect(new RegExp(o.operator.list[1].data).test('a.example.com')).toBe(true);
    expect(new RegExp(o.operator.list[1].data).test('badexample.com')).toBe(false);
    const pf = pfRules([{ id: 'g', name: 'G', enabled: true, source: { kind: 'local' }, rules: [rule({ ip: '10.0.0.0/8', port: '445', verdict: 'deny' }), rule({ app: firefox, ip: '1.1.1.1', verdict: 'deny' })] }]);
    expect(pf).toBe('block drop out quick proto tcp to 10.0.0.0/8 port 445\n');
  });
  it('says honestly what each system can enforce', () => {
    expect(capabilities('darwin').perAppBlocking).toBe(false);
    expect(capabilities('darwin', { filterExtension: true }).perAppBlocking).toBe(true);
    expect(capabilities('win32').perAppBlocking).toBe(true);
    expect(capabilities('linux').perAppAlerts).toBe(false);
    expect(capabilities('linux', { opensnitch: true }).perAppAlerts).toBe(true);
  });
});

describe('monitoring: history, unusual transfers, search, map', () => {
  it('keeps minutes for a day, hours for 90 days, days for a year, and thins charts', () => {
    const h = emptyHistory();
    for (let i = 0; i < 3 * 1440; i++) record(h, NOW - (3 * 1440 - i) * 60_000, 'firefox', 1000, 100);
    expect(h.minute.length).toBeLessThanOrEqual(1441);
    expect(h.hour.length).toBe(72);
    const day = series(h, NOW - 24 * 3600_000, NOW);
    expect(day.length).toBeLessThanOrEqual(400);
    expect(day.reduce((a, p) => a + p.inB, 0)).toBe(1440 * 1000);
    const week = series(h, NOW - 7 * 86_400_000, NOW, { app: 'firefox' });
    expect(week.reduce((a, p) => a + p.outB, 0)).toBe(3 * 1440 * 100);
  });
  it('flags a transfer far above an app’s normal only after learning', () => {
    let b: Baseline | undefined;
    for (let i = 0; i < 100; i++) b = updateBaseline(b, 1_000_000 + (i % 5) * 100_000);
    expect(isUnusual(b, 1_200_000).unusual).toBe(false);
    expect(isUnusual(b, 200_000_000).unusual).toBe(true);
    expect(isUnusual(updateBaseline(undefined, 1), 500_000_000).unusual).toBe(false);
  });
  it('search tokens with quotes and negation', () => {
    const t = parseSearch('app:"google chrome" -country:us 443 port:443');
    expect(t).toEqual([{ key: 'app', value: 'google chrome', not: false }, { key: 'country', value: 'us', not: true }, { key: 'text', value: '443', not: false }, { key: 'port', value: '443', not: false }]);
    const row = { app: 'Google Chrome', host: 'x.de', country: 'DE', port: 443 };
    expect(matchesSearch(row, t)).toBe(true);
    expect(matchesSearch({ ...row, country: 'US' }, t)).toBe(false);
    expect(matchesSearch(row, parseSearch('country:germany'))).toBe(true);
  });
  it('projects the world, finds country centres, and splits arcs at the date line', () => {
    expect(project(-180, 90, 360, 180)).toEqual([0, 0]);
    expect(project(0, 0, 360, 180)).toEqual([180, 90]);
    expect(countryPoint('de')).toBeDefined();
    expect(countryPoint('ZZ')).toBeUndefined();
    expect(worldPath(360, 180).length).toBeGreaterThan(1000);
    const pts = greatCircle([-74, 40.7], [139.7, 35.7], 16);
    expect(pts[0][0]).toBeCloseTo(-74, 5);
    expect(pts[16][0]).toBeCloseTo(139.7, 5);
    // New York → Tokyo goes over the north; Los Angeles → Tokyo crosses the date line (two pieces).
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(60);
    expect((arcPath([-118, 34], [139.7, 35.7], 360, 180).match(/M/g) ?? []).length).toBe(2);
  });
});
