// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { aboutText, checkSummary, redact, reportFiles, reportName, selfCheckRows, type SelfCheckFacts } from '../core/selfcheck';

const GB = 1024 ** 3;
const healthy: SelfCheckFacts = {
  dataWritable: true, dataFreeBytes: 80 * GB, index: { files: 2148, indexing: false, folders: 6 },
  permissions: [{ id: 'screen', name: 'Screen Recording', state: 'allowed', usedBy: ['Capture'] }, { id: 'mic', name: 'Microphone', state: 'missing', usedBy: [] }],
  parts: [{ id: 'island', name: 'Island', wanted: true, state: 'running' }, { id: 'widgets', name: 'Desktop widgets', wanted: false, state: 'off' }],
  components: [{ id: 'ffmpeg', name: 'Video tools', state: 'installed', neededBy: ['convert'] }, { id: 'rclone', name: 'Cloud connector', state: 'missing', neededBy: ['remote'] }, { id: 'speech', name: 'Speech engine', state: 'missing', neededBy: [] }],
  keychain: 'ok', crashes7d: 0,
};

describe('Check Keeper', () => {
  it('a healthy Keeper is all green', () => {
    const rows = selfCheckRows(healthy);
    expect(rows.map((r) => r.id)).toEqual(['data', 'space', 'index', 'permissions', 'parts', 'components', 'keychain', 'crashes']);
    expect(rows.every((r) => r.state === 'ok')).toBe(true);
    expect(checkSummary(rows)).toBe('All 8 checks look good');
    expect(rows.find((r) => r.id === 'index')!.detail).toBe('2,148 files known.');
    expect(rows.find((r) => r.id === 'components')!.detail).toBe('1 checked and ready; the rest come when first used.');
    expect(selfCheckRows({ dataWritable: true, index: { files: 1, indexing: false, folders: 1 } })[1].detail).toBe('1 file known.');
  });
  it('each amber row says what is wrong in plain words, with a Fix', () => {
    const rows = selfCheckRows({
      dataWritable: false, dataFreeBytes: 1 * GB, index: { files: 0, indexing: false, folders: 3 },
      permissions: [{ id: 'screen', name: 'Screen Recording', state: 'denied', usedBy: ['Capture'] }, { id: 'ax', name: 'Accessibility', state: 'missing', usedBy: ['Typed snippets'] }],
      parts: [{ id: 'island', name: 'Island', wanted: true, state: 'failed' }],
      components: [{ id: 'ffmpeg', name: 'Video tools', state: 'error', error: 'checksum', neededBy: ['convert'] }],
      keychain: 'locked', crashes7d: 2,
    });
    expect(rows.every((r) => r.state === 'amber' && r.fix)).toBe(true);
    expect(checkSummary(rows)).toBe('8 things to look at');
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by('permissions').detail).toBe('Screen Recording and Accessibility are not allowed yet.');
    expect(by('permissions').fix).toEqual({ label: 'Allow', route: 'settings:privacy' });
    expect(by('parts').fix?.action).toBe('restart:island');
    expect(by('components').fix?.action).toBe('component:ffmpeg');
    expect(by('index').fix?.action).toBe('rescan');
    expect(by('crashes').detail).toBe('Keeper stopped unexpectedly 2 times this week.');
    expect(by('crashes').fix?.action).toBe('report');
    expect(checkSummary([rows[0]])).toBe('1 thing to look at');
  });
  it('reading the folders, no keychain, and nothing extra running are fine', () => {
    const rows = selfCheckRows({ dataWritable: true, index: { files: 0, indexing: true, folders: 3 }, parts: [], keychain: 'none' });
    expect(rows.every((r) => r.state === 'ok')).toBe(true);
    expect(rows.find((r) => r.id === 'keychain')!.detail).toMatch(/until Keeper quits/);
  });
});

describe('the problem report keeps private things out', () => {
  const ctx = { home: '/Users/ana', user: 'ana', host: 'Anas-MacBook' };
  it('home folders, other people’s folders, names and the computer’s name', () => {
    expect(redact('opened /Users/ana/Documents/Tax 2025.pdf', ctx)).toBe('opened ~/Documents/Tax 2025.pdf');
    expect(redact('C:\\Users\\Ana\\Desktop\\a.txt', { home: 'C:\\Users\\Ana', user: 'Ana' })).toBe('~\\Desktop\\a.txt');
    expect(redact('json path C:\\\\Users\\\\Ana\\\\x', { home: 'C:\\Users\\Ana' })).toBe('json path ~\\\\x');
    expect(redact('/home/bob/x and /Users/carol/y', ctx)).toBe('/home/<user>/x and /Users/<user>/y');
    expect(redact('user ana on Anas-MacBook (banana stays)', ctx)).toBe('user <user> on <computer> (banana stays)');
  });
  it('e-mail addresses, keys and tokens', () => {
    const t = redact([
      'from ana.lopez@example.com',
      'Authorization: Bearer abcdefghijklmnop.qrstu',
      'key sk-proj-ABCDEFGHIJKLMNOPQRSTUV',
      'gh ghp_ABCDEFGHIJKLMNOPQRSTUVWX123',
      'aws AKIAABCDEFGHIJKLMNOP',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      '{"password":"hunter22","token": "abc123"}',
      'https://x.test/cb?api_key=zzz999&ok=1',
      'telegram 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1',
      'blob 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    ].join('\n'), ctx);
    expect(t).not.toMatch(/ana\.lopez|abcdefghijklmnop|sk-proj|ghp_|AKIA|eyJhbGci|hunter22|abc123|zzz999|AAHdq|9f86d081/);
    expect(t).toMatch(/<email>/);
    expect(t).toMatch(/Bearer <secret>/);
    expect(t).toMatch(/"password":"<secret>"/);
    expect(t).toMatch(/ok=1/);
  });
  it('network and hardware addresses, but not the loopback', () => {
    expect(redact('connect 192.168.1.20 and 127.0.0.1 via aa:bb:cc:dd:ee:ff', ctx)).toBe('connect <ip> and 127.0.0.1 via <mac>');
  });
  it('leaves ordinary log lines readable', () => {
    const line = '2026-11-04T09:12:00.000Z warn index: 2148 files in 3.2 s (electron/services/notices.ts:42)';
    expect(redact(line, ctx)).toBe(line);
  });
  it('every file is redacted and very long ones are cut to their end', () => {
    const files = reportFiles([{ name: 'a.txt', what: 'x', text: 'ana@example.com' }, { name: 'big.txt', what: 'y', text: `${'x'.repeat(3 * 1024 * 1024)}END` }], ctx);
    expect(files[0].text).toBe('<email>');
    expect(files[1].text.endsWith('END')).toBe(true);
    expect(files[1].text.length).toBeLessThan(2.1 * 1024 * 1024);
  });
  it('the about file says what was checked and that nothing was sent', () => {
    const t = aboutText({ version: '1.0.0', platform: 'linux', release: '6.1', arch: 'x64', partsOn: ['library', 'island'], rows: selfCheckRows(healthy), at: new Date('2026-11-04T10:00:00Z') });
    expect(t).toMatch(/^Keeper 1\.0\.0/);
    expect(t).toMatch(/All 8 checks look good/);
    expect(t).toMatch(/Nothing was sent/);
    expect(reportName(new Date('2026-11-04T10:00:00Z'))).toBe('keeper-problem-report-2026-11-04.zip');
  });
});
