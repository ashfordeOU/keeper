// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Archives: kinds, engines per computer, browsing, choosing, commands, and
// AES-256 ZIPs (written and read by Keeper, and read by libarchive when the
// system has it).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findZipDirectory, parseZipDirectory } from '../core/archive';
import { createEngine, crumbs, engineFor, expandSelection, extractFolderName, folderView, formatOf, newArchiveName, sevenZipArgs, sevenZipHint, supportRows, tarArgs, unsafeEntry } from '../core/archives';
import { aesCtr, aesKeys, readAesExtra, unzip, untar, zip } from '../core/zipwrite';

const entries = [
  { name: 'Photos/', size: 0, dir: true },
  { name: 'Photos/a.jpg', size: 10, dir: false },
  { name: 'Photos/Day 2/b.jpg', size: 20, dir: false },
  { name: 'Photos/Day 10/c.jpg', size: 5, dir: false },
  { name: 'notes.txt', size: 3, dir: false },
  { name: './loose/d.txt', size: 1, dir: false },
];

describe('kinds', () => {
  it('reads the kind from the first bytes, else the name', () => {
    expect(formatOf('x.bin', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toBe('zip');
    expect(formatOf('x.bin', new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(formatOf('x', new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 7]))).toBe('rar');
    expect(formatOf('a.tar.xz', new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]))).toBe('tar.xz');
    expect(formatOf('a.xz', new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]))).toBe('xz');
    expect(formatOf('a.tzst', new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0]))).toBe('tar.zst');
    expect(formatOf('backup.tgz')).toBe('tar.gz');
    expect(formatOf('disc.iso')).toBe('iso');
    expect(formatOf('movie.part1.rar')).toBe('rar');
    expect(formatOf('readme.txt')).toBeUndefined();
  });
  it('names the folder files are taken out to', () => {
    expect(extractFolderName('Photos.tar.gz')).toBe('Photos');
    expect(extractFolderName('Report 2026.zip')).toBe('Report 2026');
    expect(extractFolderName('film.part1.rar')).toBe('film');
    expect(extractFolderName('.zip')).toBe('Archive');
    expect(newArchiveName(['/a/Trip photos'], 'zip')).toBe('Trip photos.zip');
    expect(newArchiveName(['/a/report.pdf'], '7z')).toBe('report.7z');
    expect(newArchiveName(['/a/x', '/a/y'], 'zip')).toBe('Archive.zip');
  });
});

describe('engines on this computer', () => {
  const none = {};
  const mac = { bsdtar: 'tar' };
  const linux = { gnutar: 'tar' };
  const seven = { gnutar: 'tar', sevenZip: '7zz' };
  it('Keeper reads ZIP and TAR itself everywhere', () => {
    expect(engineFor('zip', none).engine).toBe('keeper');
    expect(engineFor('tar.gz', none).engine).toBe('keeper');
  });
  it('7z and RAR use the system tar (libarchive), else 7-Zip, else say what is missing', () => {
    expect(engineFor('7z', mac)).toEqual({ engine: 'bsdtar', bin: 'tar' });
    expect(engineFor('rar', seven)).toEqual({ engine: '7zip', bin: '7zz' });
    expect(engineFor('7z', linux).missing).toMatch(/7-Zip/);
    expect(engineFor('tar.xz', linux)).toEqual({ engine: 'gnutar', bin: 'tar' });
  });
  it('passwords on 7z and RAR need 7-Zip (libarchive cannot decrypt them)', () => {
    expect(engineFor('7z', mac, { encrypted: true }).missing).toMatch(/Password-protected 7z/);
    expect(engineFor('7z', { ...mac, sevenZip: '7z' }, { encrypted: true }).engine).toBe('7zip');
    expect(engineFor('rar', { sevenZip: '7za', sevenZipLite: true, unrar: 'unrar' }, { encrypted: true }).engine).toBe('unrar');
  });
  it('big ZIPs go to the outside tools', () => {
    expect(engineFor('zip', mac, { big: true }).engine).toBe('bsdtar');
    expect(engineFor('zip', none, { big: true }).engine).toBe('keeper');
  });
  it('making: ZIP by Keeper, 7z by 7-Zip or (without a password) the system tar', () => {
    expect(createEngine('zip', none, 'pw').engine).toBe('keeper');
    expect(createEngine('7z', mac).engine).toBe('bsdtar');
    expect(createEngine('7z', mac, 'pw').missing).toMatch(/needs the free 7-Zip/);
    expect(createEngine('7z', seven, 'pw').engine).toBe('7zip');
  });
  it('says what works here in plain words', () => {
    const rows = supportRows(mac);
    expect(rows.find((r) => r.format === '7z')!.open).toBe('Opens with your system’s tools; with a password needs 7-Zip');
    expect(rows.find((r) => r.format === 'RAR')!.create).toMatch(/Never made/);
    expect(supportRows(linux).find((r) => r.format === '7z')!.ok).toBe(false);
    expect(rows.map((r) => `${r.open} ${r.create}`).join(' ')).not.toMatch(/bsdtar|unrar|system’s tar/);
    expect(sevenZipHint('win32')).toMatch(/7-zip\.org/);
  });
});

describe('commands', () => {
  it('ends the options before names, so a name is never an instruction', () => {
    const x = sevenZipArgs('extract', '/a.7z', { names: ['-rf'], dest: '/out', password: 'pw' });
    expect(x.indexOf('--')).toBeLessThan(x.indexOf('-rf'));
    expect(x).toContain('-ppw');
    expect(sevenZipArgs('list', '/a.7z')).toContain('-p');
    expect(sevenZipArgs('create', '/o.7z', { password: 'pw', names: ['x'] })).toContain('-mhe=on');
    expect(sevenZipArgs('create', '/o.zip', { password: 'pw', format: 'zip', names: ['x'] })).toContain('-mem=AES256');
    const t = tarArgs('extract', '/a.tar.xz', { dest: '/o', names: ['--to-command=x'] });
    expect(t.indexOf('--')).toBeLessThan(t.indexOf('--to-command=x'));
    expect(tarArgs('create7z', '/o.7z', { cwd: '/a', names: ['b'] })).toEqual(['--format', '7zip', '-cf', '/o.7z', '-C', '/a', '--', 'b']);
  });
});

describe('browsing', () => {
  it('shows one folder at a time, with counts and natural order', () => {
    const top = folderView(entries, '');
    expect(top.folders.map((f) => f.name)).toEqual(['loose', 'Photos']);
    expect(top.files.map((f) => f.base)).toEqual(['notes.txt']);
    const p = folderView(entries, 'Photos');
    expect(p.folders.map((f) => [f.name, f.files, f.size])).toEqual([['Day 2', 1, 20], ['Day 10', 1, 5]]);
    expect(p.files.map((f) => f.base)).toEqual(['a.jpg']);
    expect(crumbs('Photos/Day 2')).toEqual([{ name: 'Photos', path: 'Photos' }, { name: 'Day 2', path: 'Photos/Day 2' }]);
  });
  it('choosing a folder takes everything under it', () => {
    expect(expandSelection(entries, ['Photos/Day 2', 'notes.txt']).sort()).toEqual(['Photos/Day 2/b.jpg', 'notes.txt']);
    expect(expandSelection(entries, ['Photos'])).toHaveLength(4);
  });
  it('never takes out names that would land outside the folder', () => {
    expect(unsafeEntry('../evil')).toBe(true);
    expect(unsafeEntry('/etc/passwd')).toBe(true);
    expect(unsafeEntry('C:\\x')).toBe(true);
    expect(unsafeEntry('a/../../b')).toBe(true);
    expect(unsafeEntry('a/b..c')).toBe(false);
  });
});

describe('AES-256 ZIP', () => {
  const files = [{ name: 'docs/', mtime: new Date() }, { name: 'docs/plan.txt', data: Buffer.from('The plan, '.repeat(200)) }, { name: 'tiny.txt', data: Buffer.from('hi') }];
  it('the counter starts at 1, little-endian, and decrypts back', () => {
    const key = Buffer.alloc(32, 7);
    const data = Buffer.from('x'.repeat(100));
    expect(aesCtr(key, aesCtr(key, data)).equals(data)).toBe(true);
    expect(aesCtr(key, data).equals(aesCtr(key, data))).toBe(true);
    const k = aesKeys('pw', Buffer.alloc(16));
    expect([k.key.length, k.mac.length, k.check.length]).toEqual([32, 32, 2]);
  });
  it('writes AE-2 entries that Keeper reads back with the password, and refuses a wrong one', () => {
    const z = zip(files, { password: 'correct horse', aes: true });
    const dir = findZipDirectory(z.subarray(Math.max(0, z.length - 65_557)), z.length)!;
    const listed = parseZipDirectory(z.subarray(dir.offset, dir.offset + dir.size));
    expect(listed.filter((e) => !e.dir).every((e) => e.encrypted)).toBe(true);
    const out = unzip(z, 'correct horse');
    expect(out.find((e) => e.name === 'docs/plan.txt')!.data!.toString()).toBe('The plan, '.repeat(200));
    expect(() => unzip(z, 'wrong')).toThrow(/Wrong password/);
    expect(() => unzip(z)).toThrow(/password/);
    expect(z.includes(Buffer.from('The plan'))).toBe(false);
    // only what was asked for is unpacked
    expect(unzip(z, 'correct horse', undefined, (n) => n === 'tiny.txt').map((e) => e.name)).toEqual(['tiny.txt']);
  });
  it('the extra field says AES-256 and the real method', () => {
    const z = zip([{ name: 'a.txt', data: Buffer.from('a'.repeat(500)) }], { password: 'p', aes: true });
    const extra = z.subarray(30 + 5, 30 + 5 + 11);
    expect(readAesExtra(extra)).toEqual({ version: 2, strength: 3, method: 8 });
    expect(z.readUInt16LE(8)).toBe(99);
  });
  it('the classic encryption still works for those who need it', () => {
    const z = zip(files, { password: 'pw' });
    expect(unzip(z, 'pw').length).toBe(3);
  });
  it('untar picks only the chosen entries', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'karc-'));
    try {
      writeFileSync(path.join(tmp, 'a.txt'), 'a');
      writeFileSync(path.join(tmp, 'b.txt'), 'b');
      let tarFile: Buffer;
      try { tarFile = execFileSync('tar', ['-cf', '-', '-C', tmp, 'a.txt', 'b.txt']); } catch { return; }
      expect(untar(tarFile, undefined, (n) => n === 'b.txt').map((e) => e.name)).toEqual(['b.txt']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('libarchive (bsdtar) opens Keeper’s AES ZIPs, when this computer has it', () => {
    let has = false;
    try { has = /libarchive/.test(execFileSync('bsdtar', ['--version']).toString()); } catch { /* not here */ }
    if (!has) return;
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'karc-'));
    try {
      writeFileSync(path.join(tmp, 'x.zip'), zip(files, { password: 'correct horse', aes: true }));
      execFileSync('bsdtar', ['-xf', path.join(tmp, 'x.zip'), '--passphrase', 'correct horse', '-C', tmp]);
      expect(readFileSync(path.join(tmp, 'docs', 'plan.txt'), 'utf8')).toBe('The plan, '.repeat(200));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
