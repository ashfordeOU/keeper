// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Packaging: the installers' licence files. The Mac disk image tool stores its
// licence text in Mac Roman, so a byte order mark or a character Mac Roman
// lacks stops `npm run dist:mac` at the disk image step.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript build script
import { MAC_ROMAN_HIGH, macRomanEncodable, markdownToText, toMacRomanText } from '../scripts/license-txt.mjs';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('licence files for the installers', () => {
  it('knows all 128 characters Mac Roman has above ASCII', () => {
    expect([...MAC_ROMAN_HIGH]).toHaveLength(128);
    expect(new Set(MAC_ROMAN_HIGH).size).toBe(128);
  });

  it('makes text Mac Roman can store', () => {
    const t = toMacRomanText('\ufeffKeeper by Ashforde® · “quoted” ‘text’ → next\r\nŁódź – done… ✓\u200b');
    expect(t.startsWith('\ufeff')).toBe(false);
    expect(t).not.toContain('\r');
    expect(t).toContain('Ashforde® · "quoted" \'text\' -> next\n');
    expect(t).toContain('Lódz – done… ?');
    expect(macRomanEncodable(t)).toBe(true);
    expect(macRomanEncodable('\ufeffx')).toBe(false);
    expect(macRomanEncodable('→')).toBe(false);
  });

  it('the committed disk-image licence is current and Mac Roman-safe', () => {
    const want = toMacRomanText(markdownToText(read('LICENSE.md'))) + '\n';
    const dmg = read('build/dmg-license.txt');
    expect(dmg).toBe(want);
    expect(dmg.charCodeAt(0)).not.toBe(0xfeff);
    expect(macRomanEncodable(dmg)).toBe(true);
  });

  it('the committed Windows installer licence is current (UTF-8 with a byte order mark, CRLF)', () => {
    const nsis = read('build/installer-license.txt');
    expect(nsis).toBe('\ufeff' + markdownToText(read('LICENSE.md')).replace(/\n/g, '\r\n') + '\r\n');
  });

  it('the disk image tool itself accepts it (Python mac_roman, where Python is installed)', () => {
    const py = spawnSync('python3', ['-I', '-c', 'import sys; open(sys.argv[1], encoding="utf-8").read().encode("mac_roman"); print("ok")', path.join(root, 'build/dmg-license.txt')], { encoding: 'utf8' });
    if (py.error) return; // no Python here; the check above covers the same table
    expect(py.stdout.trim()).toBe('ok');
    // ...and it is exactly what fails for the Windows file, so the check is real.
    const bad = spawnSync('python3', ['-I', '-c', 'import sys; open(sys.argv[1], encoding="utf-8").read().encode("mac_roman")', path.join(root, 'build/installer-license.txt')], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('UnicodeEncodeError');
  });

  it('no file in build/ is picked up by name for the disk image; electron-builder.yml names both files', () => {
    // electron-builder's own convention: license_LANG / eula_LANG with .txt, .rtf or .html.
    const auto = readdirSync(path.join(root, 'build')).filter((n) => /^(license|eula)_.*\.(txt|rtf|html)$/i.test(n));
    expect(auto).toEqual([]);
    const yml = read('electron-builder.yml');
    const nsis = /\nnsis:[\s\S]*?\n {2}license: (\S+)/.exec(yml)?.[1];
    const dmg = /\ndmg:[\s\S]*?\n {2}license: (\S+)/.exec(yml)?.[1];
    expect(nsis).toBe('build/installer-license.txt');
    expect(dmg).toBe('build/dmg-license.txt');
    expect(existsSync(path.join(root, nsis!))).toBe(true);
    expect(existsSync(path.join(root, dmg!))).toBe(true);
  });
});

describe('native macOS pieces before packaging', () => {
  it('dist and dist:mac build keeper-helper first; a missing helper stops packaging unless overridden', async () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const s of ['dist', 'dist:mac']) expect(pkg.scripts[s]).toMatch(/node scripts\/build-mac-native\.mjs && electron-builder/);
    // @ts-expect-error: a plain JavaScript build script
    const m = await import('../scripts/build-mac-native.mjs');
    expect(m.HELPER_BIN.replace(/\\/g, '/').endsWith('native/macos/KeeperHelper/.build/apple/Products/Release/keeper-helper')).toBe(true);
    const yml = read('electron-builder.yml');
    expect(yml).toContain(`from: ${path.relative(root, m.HELPER_BIN).replace(/\\/g, '/')}`);
    expect(yml).toContain(`from: ${path.relative(root, m.INTENTS_APP).replace(/\\/g, '/')}`);
    expect(m.helperProblem('Swift is not installed', {}).stop).toBe(true);
    const ok = m.helperProblem('Swift is not installed', { KEEPER_ALLOW_NO_HELPER: '1' });
    expect(ok.stop).toBe(false);
    expect(ok.message).toContain('WITHOUT keeper-helper');
  });
});
