// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mac test run's own logic (scripts/mac-test): the results schema, the
// scrubbing of the owner's identity, the report, and the small parsers.

import { describe, expect, it } from 'vitest';
import { checkPaths } from '../scripts/mac-test/src/app';
import { parseArgs } from '../scripts/mac-test/src/args';
import { chooseAreas } from '../scripts/mac-test/src/areas';
import { keeperHolds } from '../scripts/mac-test/src/areas/awake';
import { allOff, diff, normalise, restoreScript, withoutKeeper } from '../scripts/mac-test/src/areas/stage';
import { cpuTime, parsePs, treeOf } from '../scripts/mac-test/src/areas/usage';
import { peakDb, wordMatch } from '../scripts/mac-test/src/areas/voice';
import { permissionChanges } from '../scripts/mac-test/src/areas/permscreen';
import { cell, renderReport } from '../scripts/mac-test/src/report';
import { SCHEMA_VERSION, summarize, validateResults, type CheckResult, type Results } from '../scripts/mac-test/src/schema';
import { makeScrubber } from '../scripts/mac-test/src/scrub';

const check = (over: Partial<CheckResult> = {}): CheckResult => ({
  id: 'island.notch', area: 'island', title: 'The notch', kind: 'auto', status: 'pass', details: 'fine', startedAt: '2026-11-01T10:00:00.000Z', durationMs: 12, artifacts: [], ...over,
});

function results(checks: CheckResult[]): Results {
  return {
    schemaVersion: SCHEMA_VERSION, tool: { name: 'keeper-mac-test', version: '1.0.0' },
    run: { id: 'keeper-mac-test-2026-11-01-1000', startedAt: '2026-11-01T10:00:00.000Z', finishedAt: '2026-11-01T10:15:00.000Z', durationSec: 900, mode: 'quick', areas: ['island'], dryRun: false, interrupted: false, guided: true, record: false, args: ['--quick'] },
    keeper: { version: '0.1.0', commit: 'abc1234', dirty: false },
    system: { macos: '15.1', build: '24B83', model: 'Mac15,6', chip: 'Apple M3 Pro', ramGB: 36, notch: true, displays: [{ name: 'Color LCD', builtIn: true, main: true }] },
    checks, changes: [{ id: 'stage-values', what: 'Dock', restore: 'defaults', admin: false, restored: true, verified: true }],
    cleanup: { ok: true, items: [{ what: 'Keeper closed', ok: true }] },
    summary: summarize(checks),
  };
}

describe('results schema', () => {
  it('accepts a complete run', () => {
    expect(validateResults(results([check(), check({ id: 'island.hang', status: 'skip' }), check({ id: 'island.x', status: 'fail', error: 'boom' })]))).toEqual([]);
  });
  it('finds what is wrong', () => {
    const r = results([check(), check()]) as any;
    r.checks[1].status = 'maybe';
    r.checks.push(check({ id: 'awake.x', area: 'island' }));
    r.checks.push(check({ id: 'bad id' }));
    r.checks.push(check({ id: 'island.y', artifacts: ['/Users/sam/x.png'] }));
    r.run.mode = 'slow';
    delete r.cleanup;
    const errs = validateResults(r).join('\n');
    expect(errs).toMatch(/used twice/);
    expect(errs).toMatch(/status must be pass, fail or skip/);
    expect(errs).toMatch(/does not start with its area/);
    expect(errs).toMatch(/is not "<area>\.<name>"/);
    expect(errs).toMatch(/paths inside the bundle/);
    expect(errs).toMatch(/run\.mode/);
    expect(errs).toMatch(/missing cleanup/);
    expect(errs).toMatch(/summary\.total/);
  });
  it('counts the summary', () => {
    expect(summarize([check(), check({ status: 'fail' }), check({ status: 'skip' }), check({ status: 'skip' })])).toEqual({ total: 4, pass: 1, fail: 1, skip: 2 });
  });
});

describe('scrubbing the owner\'s identity', () => {
  const s = makeScrubber({
    user: 'sam', fullName: 'Sam Example', home: '/Users/sam',
    hostnames: ["Sam's MacBook Pro", 'Sams-MacBook-Pro', 'Sams-MacBook-Pro.local'],
    serials: ['C02ZK1ABMD6T', 'F5D1234567891ABCD'], ids: ['1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D'],
  });
  it('replaces the home folder with ~ and the user name', () => {
    expect(s.text('/Users/sam/keeper/node_modules/x and /private/Users/sam/y')).toBe('~/keeper/node_modules/x and ~/y');
    expect(s.text('owner sam ran it; samuel and sample stay')).toBe('owner <user> ran it; samuel and sample stay');
    expect(s.text('/Users/samuel/x')).toBe('/Users/samuel/x');
    expect(s.text('Signed in as Sam Example')).toBe('Signed in as <name>');
  });
  it('replaces computer names, longest first and in any case', () => {
    expect(s.text("Sam's MacBook Pro is sams-macbook-pro.local on the network")).toBe('<host> is <host> on the network');
  });
  it('replaces serial numbers and hardware ids, known or by key', () => {
    expect(s.text('serial C02ZK1ABMD6T battery F5D1234567891ABCD uuid 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d')).toBe('serial <serial> battery <serial> uuid <id>');
    expect(s.text('"serial_number" : "XYZ999", "platform_UUID": "AAA", "crashReporterKey" : "f00"')).toBe('"serial_number" : "<redacted>", "platform_UUID": "<redacted>", "crashReporterKey" : "<redacted>"');
    expect(s.text('"IOPlatformSerialNumber" = "OTHER123"')).toBe('"IOPlatformSerialNumber" = "<redacted>"');
    expect(s.text('<key>serial_number</key>\n<string>ABC</string>')).toBe('<key>serial_number</key>\n<string><redacted></string>');
    expect(s.text('      Serial Number (system): Q1W2E3R4')).toBe('      Serial Number (system): <redacted>');
  });
  it('replaces MAC and email addresses, but not times or IPv6', () => {
    expect(s.text('en0 a4:83:e7:12:34:56 and A4-83-E7-12-34-57')).toBe('en0 <mac> and <mac>');
    expect(s.text('at 12:34:56.789 from fe80::1c2b:3a4d:5e6f:7a8b')).toBe('at 12:34:56.789 from fe80::1c2b:3a4d:5e6f:7a8b');
    expect(s.text('mail sam.example@icloud.com or contact@ashforde.org')).toBe('mail <email> or contact@ashforde.org');
  });
  it('cleans file names', () => {
    expect(s.name('Keeper-2026-11-01-Sams-MacBook-Pro.ips')).toBe('Keeper-2026-11-01-host.ips');
  });
});

describe('the report', () => {
  it('has the summary, a table per area, the failures in full and the changes', () => {
    const md = renderReport(results([
      check(),
      check({ id: 'island.hang', kind: 'guided', status: 'skip', details: 'No answer', answer: 'skip' }),
      check({ id: 'awake.hold', area: 'awake', title: 'Hold | with pipe', status: 'fail', details: 'No hold\nseen', error: 'pmset said nothing', note: 'lid was open', artifacts: ['data/a.txt'] }),
    ]), { island: 'Island', awake: 'Keep Awake' });
    expect(md).toMatch(/\*\*1 passed, 1 failed, 1 skipped\*\* \(3 checks\)/);
    expect(md).toMatch(/\| Island \| 1 \| 0 \| 1 \|/);
    expect(md).toMatch(/### Keep Awake/);
    expect(md).toMatch(/\| FAIL \| Hold \\\| with pipe `awake.hold` \| auto \| No hold seen — Owner's note: lid was open \|/);
    expect(md).toMatch(/## Failures in full[\s\S]*pmset said nothing[\s\S]*`data\/a.txt`/);
    expect(md).toMatch(/\| Dock \| defaults \| no \| yes \| yes \|/);
    expect(md).toMatch(/macOS \| 15\.1 \(24B83\)/);
  });
  it('says when a run was a dry run or stopped early', () => {
    const r = results([]);
    r.run.dryRun = true;
    r.run.interrupted = true;
    expect(renderReport(r)).toMatch(/dry run[\s\S]*stopped early/);
  });
  it('keeps table cells on one line', () => {
    expect(cell('a\nb|c', 4)).toBe('a b…');
  });
});

describe('small parsers', () => {
  it('reads ps output and finds a process tree', () => {
    const rows = parsePs(' 1 0 100 1:02.33 /sbin/launchd\n 42 1 2000 0:04.10 Electron\n 43 42 1000 1-00:00:01 Helper\n 44 1 5 0:00.00 other\n');
    expect(rows).toHaveLength(4);
    expect(cpuTime('1-00:00:01')).toBe(86401);
    expect(cpuTime('1:02.50')).toBeCloseTo(62.5);
    expect(treeOf(rows, 42).map((r) => r.pid)).toEqual([42, 43]);
  });
  it('finds Keeper\'s holds in pmset -g assertions', () => {
    const t = '   pid 4243(caffeinate): [0x1] 00:00:05 PreventUserIdleSystemSleep named: "caffeinate"\n   pid 345(powerd): [0x2] 00:10:00 PreventUserIdleSystemSleep named: "Powerd"\n';
    expect(keeperHolds(t, 4242)).toHaveLength(1);
    expect(keeperHolds('   pid 345(powerd): [0x2] PreventUserIdleSystemSleep\n')).toHaveLength(0);
  });
  it('compares spoken words and audio levels', () => {
    expect(wordMatch('Keeper keeps my files tidy', 'keeper keeps my files, tidy!')).toBe(1);
    expect(wordMatch('one two three four', 'one two')).toBe(0.5);
    const b = Buffer.alloc(8);
    b.writeFloatLE(0.5, 0);
    expect(peakDb([b.toString('base64')])).toBeCloseTo(-6.02, 1);
  });
  it('Stage snapshots: normalised, compared and restorable', () => {
    expect(normalise('desktopIcons', '1')).toBe('true');
    expect(normalise('visibleApps', 'Terminal, Finder')).toBe('Finder, Terminal');
    expect(diff({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual(['b']);
    // Keeper's own process disappears when it is killed; that is not an app left hidden.
    expect(diff(withoutKeeper({ visibleApps: 'Electron, Finder, Safari' }), withoutKeeper({ visibleApps: 'Finder, Safari' }))).toEqual([]);
    expect(withoutKeeper({ visibleApps: '<unset>' }).visibleApps).toBe('<unset>');
    const sh = restoreScript({ desktopIcons: '<unset>', dockAutohide: 'false', menubarAutohide: 'true', alertVolume: '75', cursorSize: '1', visibleApps: "Finder, Sam's \"App\"" });
    expect(sh).toMatch(/defaults delete com.apple.finder CreateDesktop/);
    expect(sh).toMatch(/set autohide of dock preferences to false/);
    expect(sh).toMatch(/set autohide menu bar of dock preferences to true/);
    expect(sh).toMatch(/set volume alert volume 75/);
    expect(sh).toMatch(/process "Sam'\\''s App" to true/);
    const off = allOff({ hideDock: true, keystrokes: 'all', backdrop: { kind: 'solid', color: '#000', color2: '#111' }, apps: [{ name: 'x' }] });
    expect(off).toMatchObject({ hideDock: false, keystrokes: 'off', apps: [], backdrop: { kind: 'off' }, spotlight: { mode: 'off' }, resolution: { mode: 'keep' } });
  });
  it('refuses any Electron folder outside the throwaway home', () => {
    expect(checkPaths({ home: '/tmp/r/home', userData: '/tmp/r/home/L/K', temp: '/var/folders/x' }, '/tmp/r/home')).toEqual([]);
    expect(checkPaths({ userData: '/Users/sam/Library/Application Support/Keeper', documents: '/tmp/r/homeX' }, '/tmp/r/home')).toHaveLength(2);
  });
  it('chooses areas and reads options', () => {
    expect(chooseAreas({ quick: true, only: [], skip: [] }).areas.map((a) => a.id)).toEqual(['island', 'awake', 'stage', 'helper', 'voice', 'monitor', 'usage', 'perf']);
    expect(chooseAreas({ quick: false, only: ['notes', 'nope'], skip: [] })).toMatchObject({ unknown: ['nope'] });
    expect(chooseAreas({ quick: false, only: [], skip: ['perf'] }).areas.some((a) => a.id === 'perf')).toBe(false);
    expect(parseArgs(['--quick', '--only=island,Awake', '--out', '/x', '--no-guided'])).toMatchObject({ quick: true, only: ['island', 'awake'], out: '/x', guided: false });
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
  });

describe('the Permissions screen check', () => {
  it('records which became allowed, which need a restart and which are left', () => {
    const c = permissionChanges(
      [{ id: 'screen', name: 'Screen', state: 'missing' }, { id: 'mic', name: 'Mic', state: 'allowed' }, { id: 'fda', name: 'FDA', state: 'missing' }, { id: 'net', name: 'Net', state: 'unknown' }],
      [{ id: 'screen', name: 'Screen', state: 'allowed', restartNeeded: true }, { id: 'mic', name: 'Mic', state: 'allowed' }, { id: 'fda', name: 'FDA', state: 'denied' }, { id: 'net', name: 'Net', state: 'unknown' }],
    );
    expect(c).toEqual({ allowed: ['screen'], restart: ['screen'], left: ['fda'], unknown: ['net'] });
  });
});
});
