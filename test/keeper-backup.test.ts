// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, backupFileName, backupMeta, backupPlan, leftOutWhy, MAX_FILE, packBackup, passwordProblem, safeRel, snapshotDue, snapshotLabel, snapshotName, snapshotsToDrop, unpackBackup } from '../core/keeper-backup';

const FAST = { N: 1 << 10, r: 8, p: 1 };
const meta = { keeper: '1.0.0', created: Date.UTC(2026, 10, 4), from: 'Ana’s laptop · Linux' };

describe('what a copy of Keeper holds', () => {
  it('keeps settings and lists, never passwords, keys or this computer’s pairing', () => {
    expect(leftOutWhy('settings.json')).toBeNull();
    expect(leftOutWhy('workflows.json')).toBeNull();
    expect(leftOutWhy('cues-settings.json')).toBeNull();
    expect(leftOutWhy('terminal/snippets.json')).toBeNull();
    expect(leftOutWhy('secrets.json')).toBe('secret');
    expect(leftOutWhy('lock-key.json')).toBe('secret');
    expect(leftOutWhy('rclone.conf')).toBe('secret');
    expect(leftOutWhy('agents/api-token.json')).toBe('secret');
    expect(leftOutWhy('link/link.json')).toBe('this-computer');
    expect(leftOutWhy('mesh/wg.conf')).toBe('this-computer');
    expect(leftOutWhy('usage-stats.json')).toBe('this-computer');
    expect(leftOutWhy('index.json')).toBe('rebuilt');
    expect(leftOutWhy('brain/vectors.bin')).toBe('rebuilt');
    expect(leftOutWhy('keeper-snapshots/2026-11-03/settings.json')).toBe('rebuilt');
    expect(leftOutWhy('Local State')).toBe('system');
    expect(leftOutWhy('Cookies')).toBe('system');
    expect(leftOutWhy('GPUCache/data_0')).toBe('system');
    expect(leftOutWhy('settings.json.123.tmp')).toBe('rebuilt');
    expect(leftOutWhy('big.json', MAX_FILE + 1)).toBe('too-big');
  });

  it('plans a copy with what is left out grouped by reason', () => {
    const p = backupPlan([{ rel: 'settings.json', size: 10 }, { rel: 'secrets.json', size: 5 }, { rel: 'link/link.json', size: 3 }, { rel: 'inbox.json', size: 7 }, { rel: 'index.json', size: 900 }]);
    expect(p.files.map((f) => f.rel)).toEqual(['inbox.json', 'settings.json']);
    expect(p.bytes).toBe(17);
    expect(p.leftOut.map((x) => [x.why, x.count])).toEqual([['secret', 1], ['this-computer', 1], ['rebuilt', 1]]);
    expect(p.leftOut[0].text).toMatch(/Passwords and keys/);
  });
});

describe('the .keeperbackup file', () => {
  const files = [{ rel: 'settings.json', data: Buffer.from('{"appearance":"dark"}') }, { rel: 'terminal/snippets.json', data: Buffer.from('[1,2,3]') }, { rel: 'empty.json', data: Buffer.alloc(0) }];

  it('packs and opens again with the same password', () => {
    const buf = packBackup(files, meta, 'correct horse', FAST);
    const r = unpackBackup(buf, 'correct horse');
    expect(r.files.map((f) => [f.rel, f.data.toString()])).toEqual([['settings.json', '{"appearance":"dark"}'], ['terminal/snippets.json', '[1,2,3]'], ['empty.json', '']]);
    expect(r.meta).toMatchObject({ format: BACKUP_FORMAT, keeper: '1.0.0', from: 'Ana’s laptop · Linux', files: 3 });
  });

  it('keeps the contents sealed: no settings in the clear, and the header says only who and when', () => {
    const buf = packBackup(files, meta, 'correct horse', FAST);
    expect(buf.includes(Buffer.from('appearance'))).toBe(false);
    expect(backupMeta(buf)).toMatchObject({ keeper: '1.0.0', files: 3 });
  });

  it('a wrong password or a changed byte is said plainly', () => {
    const buf = packBackup(files, meta, 'correct horse', FAST);
    expect(() => unpackBackup(buf, 'wrong horse')).toThrow('That password doesn’t open this backup (or the file was changed).');
    const bent = Buffer.from(buf);
    bent[bent.length - 30] ^= 1;
    expect(() => unpackBackup(bent, 'correct horse')).toThrow(/doesn’t open/);
    // The header is checked too: changing who made it breaks the seal.
    const s = buf.toString('latin1').replace('Ana’s'.normalize(), 'Bob’s');
    if (s !== buf.toString('latin1')) expect(() => unpackBackup(Buffer.from(s, 'latin1'), 'correct horse')).toThrow();
    expect(() => unpackBackup(Buffer.from('hello'), 'x')).toThrow('That file isn’t a Keeper backup.');
  });

  it('refuses a backup from a newer Keeper, with what to do', () => {
    const buf = packBackup(files, meta, 'correct horse', FAST);
    const newer = Buffer.from(buf.toString('latin1').replace('"format":1', '"format":9'), 'latin1');
    expect(() => backupMeta(newer)).toThrow('This backup was made by a newer Keeper. Update Keeper first, then try again.');
  });

  it('never writes outside Keeper’s folder or brings in what a copy leaves out', () => {
    expect(safeRel('a/b.json')).toBe('a/b.json');
    expect(() => safeRel('../evil')).toThrow(/outside/);
    expect(() => safeRel('/etc/passwd')).not.toThrow(); // made relative
    expect(safeRel('/etc/passwd')).toBe('etc/passwd');
    expect(() => safeRel('C:/Windows/x')).toThrow(/outside/);
    expect(() => safeRel('secrets.json')).toThrow(/never holds/);
    expect(() => safeRel('link/link.json')).toThrow(/never holds/);
  });

  it('asks for a password of 8 characters, typed the same twice', () => {
    expect(passwordProblem('short')).toBe('Use 8 characters or more');
    expect(passwordProblem('long enough', 'long enougH')).toBe('The two passwords are not the same');
    expect(passwordProblem('long enough', 'long enough')).toBeNull();
  });
});

describe('nightly copies', () => {
  const now = new Date(2026, 10, 4, 22, 0).getTime(); // Wednesday 4 Nov 2026
  it('names a day, keeps the last 14 and says the day in words', () => {
    expect(snapshotName(now)).toBe('2026-11-04');
    const names = Array.from({ length: 20 }, (_, i) => snapshotName(now - i * 86_400_000));
    expect(snapshotsToDrop([...names, 'notes.txt'])).toEqual(names.slice(14));
    expect(snapshotLabel('2026-11-04', now)).toBe('Today');
    expect(snapshotLabel('2026-11-03', now)).toBe('Yesterday');
    expect(snapshotLabel('2026-11-01', now)).toBe('Sunday');
    expect(snapshotLabel('2026-10-20', now)).toBe('20 Oct');
    expect(snapshotDue(names, now)).toBe(false);
    expect(snapshotDue(names.slice(1), now)).toBe(true);
    expect(backupFileName(now)).toBe('Keeper backup 2026-11-04.keeperbackup');
  });
});
