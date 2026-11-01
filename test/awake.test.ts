// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  addRecord, caffeinateArgs, closedDisplaySafe, conditionHolds, DEFAULT_OPTIONS, describeRule, describeSpec, evaluate, extend, ipMatches, matchingRules,
  migrateOldTriggers, newSession, normalizeAwakeSettings, parseDuration, parsePmsetAssertions, parsePmsetSleepDisabled, parsePowercfgLid, parsePowercfgRequests,
  parseSystemdInhibit, pmsetDisableSleep, powercfgLid, ruleMatches, specFromCli, specFromOptions, summarize, systemdInhibitArgs, trackFalse, triggerConditionHolds, windowsHoldScript, fmtDuration,
  type AwakeRule, type Facts,
} from '../core/awake-engine';

const NOW = new Date(2026, 9, 31, 14, 0).getTime(); // a Saturday afternoon
const facts = (o: Partial<Facts> = {}): Facts => ({
  now: NOW, onPower: true, battery: 80, externalDisplays: 0, apps: ['Safari', 'Final Cut Pro'], frontApp: 'Safari', cpu: 10, usb: [], bluetooth: [], volumes: [],
  interfaces: ['en0'], ips: ['192.168.1.20'], dns: ['1.1.1.1'], idleSec: 0, agentsRunning: 0, terminalSessions: 0, keeperJobs: [], downloadsActive: 0, ...o,
});
const session = (spec: Parameters<typeof newSession>[0] = {}) => newSession(spec, DEFAULT_OPTIONS, NOW, 's1', { percent: 80, onPower: false });

describe('sessions', () => {
  it('lasts for a while, until a time, or until turned off', () => {
    expect(session({ minutes: 30 }).endsAt).toBe(NOW + 30 * 60_000);
    expect(session({ until: NOW + 5000, minutes: 30 }).endsAt).toBe(NOW + 5000);
    expect(session().endsAt).toBeUndefined();
    expect(describeSpec({})).toBe('Until you turn it off');
    expect(describeSpec({ minutes: 90 })).toBe('For 1 h 30 min');
  });

  it('ends when the time is up and reminds just before', () => {
    const s = session({ minutes: 30 });
    expect(evaluate(s, facts({ now: NOW + 26 * 60_000 }))).toMatchObject({ end: false, remind: true });
    expect(evaluate(s, facts({ now: NOW + 30 * 60_000 }))).toEqual({ end: true, why: 'Time is up' });
  });

  it('ends on low battery, low power, heat and unplugging when asked', () => {
    const s = session();
    expect(evaluate(s, facts({ onPower: false, battery: 9 }))).toMatchObject({ end: true });
    expect(evaluate(s, facts({ onPower: true, battery: 9 }))).toMatchObject({ end: false }); // charging: fine
    expect(evaluate(s, facts({ lowPowerMode: true }))).toMatchObject({ end: true, why: 'Low Power Mode is on' });
    expect(evaluate(s, facts({ thermal: 'critical' }))).toMatchObject({ end: true });
    const p = session({ options: { onlyOnPower: true } });
    expect(evaluate(p, facts({ onPower: false }))).toEqual({ end: true, why: 'Unplugged from power' });
  });

  it('a "while" session ends only after its condition has been false for the grace period', () => {
    let s = session({ while: [{ kind: 'app', value: 'final cut' }] });
    expect(evaluate(s, facts())).toMatchObject({ end: false });
    const gone = facts({ apps: ['Safari'] });
    s = trackFalse(s, gone);
    expect(s.falseSince).toBe(NOW);
    expect(evaluate(s, gone)).toMatchObject({ end: false });
    expect(evaluate(s, { ...gone, now: NOW + 31_000 })).toMatchObject({ end: true });
    s = trackFalse(s, facts()); // came back
    expect(s.falseSince).toBeUndefined();
  });

  it('downloads keep it awake while the file grows or has a partial name', () => {
    const c = { kind: 'file' as const, value: '/d/big.iso' };
    expect(conditionHolds(c, facts({ paths: { '/d/big.iso': { exists: true, size: 1, mtime: NOW - 5_000 } } }))).toBe(true);
    expect(conditionHolds(c, facts({ paths: { '/d/big.iso': { exists: true, size: 1, mtime: NOW - 120_000 } } }))).toBe(false);
    expect(conditionHolds(c, facts({ paths: { '/d/big.iso': { exists: false, size: 0, mtime: 0, partial: true } } }))).toBe(true);
  });

  it('display may sleep when asked, or after the screen-saver delay', () => {
    expect(evaluate(session({ options: { display: 'allow-sleep' } }), facts())).toMatchObject({ displayAllowed: true });
    const s = session({ options: { screenSaverAfterMin: 5 } });
    expect(evaluate(s, facts({ idleSec: 60 }))).toMatchObject({ displayAllowed: false });
    expect(evaluate(s, facts({ idleSec: 301 }))).toMatchObject({ displayAllowed: true, screenSaverNow: true });
  });

  it('extends a running session from its end, or from now', () => {
    expect(extend(session({ minutes: 10 }), 30, NOW).endsAt).toBe(NOW + 40 * 60_000);
    expect(extend(session(), 30, NOW).endsAt).toBe(NOW + 30 * 60_000);
  });

  it('understands typed durations', () => {
    expect(parseDuration('30m', NOW)).toEqual({ minutes: 30 });
    expect(parseDuration('1h30m', NOW)).toEqual({ minutes: 90 });
    expect(parseDuration('2 hours', NOW)).toEqual({ minutes: 120 });
    expect(parseDuration('45', NOW)).toEqual({ minutes: 45 });
    expect(new Date(parseDuration('until 18:30', NOW)!.until!).getHours()).toBe(18);
    const nine = parseDuration('9:00 am', NOW)!.until!;
    expect(nine).toBeGreaterThan(NOW);
    expect(new Date(nine).getHours()).toBe(9); // tomorrow morning
    expect(parseDuration('forever', NOW)).toEqual({});
    expect(parseDuration('soon', NOW)).toBeUndefined();
  });
});

describe('triggers', () => {
  const rule = (o: Partial<AwakeRule>): AwakeRule => ({ id: 'r', name: 'R', enabled: true, match: 'all', conditions: [], priority: 0, reactivateAfterMin: 0, ...o });

  it('each kind of condition', () => {
    const f = facts({ externalDisplays: 1, usb: ['Logitech Receiver'], bluetooth: ['AirPods Pro'], volumes: ['/Volumes/Backup'], ssid: 'Office', interfaces: ['en0', 'utun3'], idleSec: 600, downloadsActive: 1, calendarBusy: true, audioOutput: 'AirPods Pro', agentsRunning: 1 });
    const t = (c: Parameters<typeof triggerConditionHolds>[0]) => triggerConditionHolds(c, f);
    expect(t({ kind: 'display' })).toBe(true);
    expect(t({ kind: 'usb', value: 'logitech' })).toBe(true);
    expect(t({ kind: 'bluetooth', value: 'airpods' })).toBe(true);
    expect(t({ kind: 'drive', value: 'backup' })).toBe(true);
    expect(t({ kind: 'wifi', value: 'office' })).toBe(true);
    expect(t({ kind: 'wifi', value: 'Home' })).toBe(false);
    expect(t({ kind: 'vpn' })).toBe(true);
    expect(t({ kind: 'idle', threshold: 5 })).toBe(true);
    expect(t({ kind: 'downloads' })).toBe(true);
    expect(t({ kind: 'calendar' })).toBe(true);
    expect(t({ kind: 'audioOutput', value: 'airpods' })).toBe(true);
    expect(t({ kind: 'agent' })).toBe(true);
    expect(t({ kind: 'appFront', value: 'safari' })).toBe(true);
    expect(t({ kind: 'appFront', value: 'final cut' })).toBe(false);
    expect(t({ kind: 'ip', value: '192.168.1.0/24' })).toBe(true);
    expect(t({ kind: 'dns', value: '1.1.1.1' })).toBe(true);
    expect(t({ kind: 'battery', threshold: 50, power: true })).toBe(true);
    expect(t({ kind: 'power', not: true })).toBe(false);
  });

  it('schedules, including windows that cross midnight', () => {
    const sat = 6;
    expect(triggerConditionHolds({ kind: 'schedule', days: [sat], from: '13:00', to: '15:00' }, facts())).toBe(true);
    expect(triggerConditionHolds({ kind: 'schedule', days: [1], from: '13:00', to: '15:00' }, facts())).toBe(false);
    const night = new Date(2026, 10, 1, 2, 0).getTime(); // Sunday 02:00, window started Saturday 22:00
    expect(triggerConditionHolds({ kind: 'schedule', days: [sat], from: '22:00', to: '06:00' }, facts({ now: night }))).toBe(true);
  });

  it('AND / OR and priorities; a snoozed trigger waits', () => {
    const a = rule({ id: 'a', priority: 2, conditions: [{ kind: 'power' }, { kind: 'display' }] });
    const b = rule({ id: 'b', priority: 1, match: 'any', conditions: [{ kind: 'power' }, { kind: 'display' }] });
    const f = facts();
    expect(ruleMatches(a, f)).toBe(false);
    expect(ruleMatches(b, f)).toBe(true);
    expect(matchingRules([a, b], facts({ externalDisplays: 1 })).map((r) => r.id)).toEqual(['b', 'a']);
    expect(matchingRules([b], f, { b: NOW + 60_000 })).toEqual([]);
    expect(describeRule(b)).toContain(' or ');
  });

  it('IP patterns', () => {
    expect(ipMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('11.1.2.3', '10.0.0.0/8')).toBe(false);
    expect(ipMatches('192.168.0.7', '192.168.0.*')).toBe(true);
    expect(ipMatches('fe80::1', 'FE80::1')).toBe(true);
  });

  it('older rules carry over into triggers', () => {
    const r = migrateOldTriggers([{ id: 'x', kind: 'app', enabled: true, value: 'Zoom', allowDisplaySleep: true }]);
    expect(r[0]).toMatchObject({ id: 'x', match: 'all', conditions: [{ kind: 'app', value: 'Zoom' }], options: { display: 'allow-sleep' } });
    const s = normalizeAwakeSettings(undefined, [{ id: 'y', kind: 'power', enabled: false }]);
    expect(s.triggers[0]).toMatchObject({ id: 'y', enabled: false });
    expect(normalizeAwakeSettings({ quick: [-1, 0] }).quick.length).toBeGreaterThan(0);
  });
});

describe('each system', () => {
  it('macOS caffeinate dies with Keeper; display only when asked', () => {
    expect(caffeinateArgs({ display: 'keep-on' }, 42)).toEqual(['-i', '-d', '-m', '-w', '42']);
    expect(caffeinateArgs({ display: 'allow-sleep' }, 42)).toEqual(['-i', '-m', '-w', '42']);
    expect(pmsetDisableSleep(true)).toEqual(['-a', 'disablesleep', '1']);
    expect(parsePmsetSleepDisabled(' SleepDisabled\t\t1\n')).toBe(true);
    expect(parsePmsetSleepDisabled(' SleepDisabled\t\t0\n')).toBe(false);
  });

  it('Linux systemd-inhibit blocks what the session needs', () => {
    expect(systemdInhibitArgs({ display: 'keep-on', closedDisplay: false }, 'Keep awake')).toEqual(['--what=sleep:idle', '--who=Keeper', '--why=Keep awake', '--mode=block', 'sleep', 'infinity']);
    expect(systemdInhibitArgs({ display: 'allow-sleep', closedDisplay: true }, 'x')[0]).toBe('--what=sleep:handle-lid-switch');
  });

  it('Windows holds the right flags and lets go when Keeper ends', () => {
    // ES_CONTINUOUS | SYSTEM | DISPLAY, and ES_CONTINUOUS | SYSTEM, in decimal: PowerShell reads 0x8… as a negative Int32 that [uint32] refuses.
    expect(windowsHoldScript({ display: 'keep-on' }, 123)).toContain(`[uint32]${0x80000003}`);
    expect(windowsHoldScript({ display: 'allow-sleep' }, 123)).toContain(`[uint32]${0x80000001}`);
    expect(windowsHoldScript({ display: 'keep-on' }, 123)).toContain(`[uint32]${0x80000000})`);
    expect(windowsHoldScript({ display: 'keep-on' }, 123)).not.toMatch(/\[uint32\]0x[89a-f]/i);
    expect(windowsHoldScript({ display: 'keep-on' }, 123)).toContain('Get-Process -Id 123');
    expect(windowsHoldScript({ display: 'keep-on' }, 1.5 as unknown as number)).toContain('-Id 1 ');
    expect(powercfgLid(0, 0)[0]).toEqual(['/setacvalueindex', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', '0']);
    expect(parsePowercfgLid('Current AC Power Setting Index: 0x00000001\nCurrent DC Power Setting Index: 0x00000001')).toEqual({ ac: 1, dc: 1 });
  });

  it('reads who keeps the computer awake', () => {
    const mac = parsePmsetAssertions('   pid 412(coreaudiod): [0x0000a12] 00:12:01 PreventUserIdleSystemSleep named: "com.apple.audio.context"\n   pid 900(Keeper): [0x1] 00:01:00 PreventUserIdleDisplaySleep named: "Keep awake"');
    expect(mac).toEqual([{ who: 'coreaudiod', what: 'PreventUserIdleSystemSleep', why: 'com.apple.audio.context' }, { who: 'Keeper', what: 'PreventUserIdleDisplaySleep', why: 'Keep awake' }]);
    const win = parsePowercfgRequests('DISPLAY:\r\n[PROCESS] \\Device\\HarddiskVolume3\\Program Files\\Keeper\\Keeper.exe\r\nKeep awake\r\n\r\nSYSTEM:\r\nNone.\r\n');
    expect(win).toEqual([{ who: 'Keeper.exe', what: 'display', why: 'Keep awake' }]);
    const lin = parseSystemdInhibit('WHO            UID  USER PID  COMM            WHAT                     WHY                MODE\nKeeper         1000 ana  4321 systemd-inhibit sleep:idle               Keep awake         block\n');
    expect(lin[0]).toMatchObject({ who: 'Keeper', what: 'sleep:idle', why: 'Keep awake' });
  });

  it('closed-lid mode ends itself on low battery, heat or low power', () => {
    expect(closedDisplaySafe({ onPower: false, battery: 15 })).toMatchObject({ ok: false });
    expect(closedDisplaySafe({ onPower: true, battery: 15 })).toEqual({ ok: true });
    expect(closedDisplaySafe({ onPower: true, thermal: 'serious' })).toMatchObject({ ok: false });
    expect(closedDisplaySafe({ onPower: true, lowPowerMode: true })).toMatchObject({ ok: false });
  });
});

describe('statistics', () => {
  it('totals, longest, average, per day and battery used', () => {
    let list = addRecord([], { start: NOW - 3_600_000, end: NOW, source: 'manual', reason: 'x', why: 'Time is up', batteryUsed: 7 });
    list = addRecord(list, { start: NOW - 3 * 86_400_000, end: NOW - 3 * 86_400_000 + 1_800_000, source: 'trigger', reason: 'y', why: 'Ended' });
    const s = summarize(list, NOW);
    expect(s).toMatchObject({ sessions: 2, totalMs: 5_400_000, longestMs: 3_600_000, averageMs: 2_700_000, batteryUsed: 7, bySource: { manual: 1, trigger: 1 } });
    expect(s.week[6]).toBe(3_600_000);
    expect(s.week[3]).toBe(1_800_000);
    expect(addRecord(new Array(500).fill(list[0]), list[0]).length).toBe(500);
  });
});

describe('requests from the command line, links and the Island', () => {
  it('turns `keeper awake on --for 2h --while-app Zoom --allow-display-sleep` into a session', () => {
    const s = specFromCli({ for: '2h', 'while-app': 'Zoom', 'allow-display-sleep': true, 'while-audio': true });
    expect(s.minutes).toBe(120);
    expect(s.while).toEqual([{ kind: 'app', value: 'Zoom' }, { kind: 'audio' }]);
    expect(s.options?.display).toBe('allow-sleep');
    expect(s.source).toBe('cli');
    expect(specFromCli({ until: '18:30' }).until).toBeGreaterThan(Date.now() - 86_400_000);
    expect(specFromCli({ 'while-cpu': '70' }).while).toEqual([{ kind: 'cpu', threshold: 70 }]);
    expect(specFromCli({ 'closed-lid': true, 'end-below': '25' }).options).toMatchObject({ closedDisplay: true, endBelowBattery: 25 });
    expect(() => specFromCli({ for: 'soon-ish' })).toThrow(/duration/);
    expect(() => specFromCli({ until: 'lunch' })).toThrow(/time/);
  });

  it('keeps the older Island options working', () => {
    const s = specFromOptions({ minutes: 60, whileApp: 'Keynote', allowDisplaySleep: true, stopBelowBattery: 20, onlyOnPower: true }, 'Presentation mode');
    expect(s).toMatchObject({ minutes: 60, source: 'presentation', reason: 'Presentation mode', while: [{ kind: 'app', value: 'Keynote' }] });
    expect(s.options).toEqual({ display: 'allow-sleep', onlyOnPower: true, endBelowBattery: 20 });
    expect(specFromOptions({}, 'Focus session').source).toBe('focus');
    expect(specFromOptions({ whileFile: '/d/x.iso' }).while).toEqual([{ kind: 'file', value: '/d/x.iso' }]);
  });

  it('says short sessions in seconds', () => {
    expect(fmtDuration(12_000)).toBe('12 s');
    expect(fmtDuration(0)).toBe('0 min');
    expect(fmtDuration(90 * 60_000)).toBe('1 h 30 min');
  });

  it('settings: bad values fall back, older Island rules carry over once', () => {
    const a = normalizeAwakeSettings({ quick: [-5, 0, 'x' as never], iconStyle: 'teapot' as never, defaults: { display: 'nope' } as never }, [{ id: 'o1', kind: 'display', enabled: true }]);
    expect(a.quick.length).toBeGreaterThan(0);
    expect(a.iconStyle).toBe('cup');
    expect(a.defaults.display).toBe('keep-on');
    expect(a.triggers[0]).toMatchObject({ id: 'o1', enabled: true, match: 'all', priority: 0 });
    // Once triggers exist in the new place, the old list is ignored.
    expect(normalizeAwakeSettings({ triggers: [] }, [{ id: 'o1', kind: 'display', enabled: true }]).triggers).toEqual([]);
  });
});
