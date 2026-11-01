// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTALL_SOURCES, detectInstallSource } from '../core/install-source';
import { parseSums, renderAll, renderTemplate } from '../scripts/render-packaging.mjs';

const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe('detectInstallSource', () => {
  it('macOS: Homebrew cask, by its Caskroom record or path', () => {
    const app = '/Applications/Keeper.app/Contents/MacOS/Keeper';
    expect(detectInstallSource(app, {}, 'darwin')).toBe('direct');
    expect(detectInstallSource(app, {}, 'darwin', has('/opt/homebrew/Caskroom/keeper'))).toBe('brew');
    expect(detectInstallSource(app, {}, 'darwin', has('/usr/local/Caskroom/keeper'))).toBe('brew');
    expect(detectInstallSource(app, { HOMEBREW_PREFIX: '/home/me/brew/' }, 'darwin', has('/home/me/brew/Caskroom/keeper'))).toBe('brew');
    expect(detectInstallSource('/opt/homebrew/Caskroom/keeper/1.0/Keeper.app/Contents/MacOS/Keeper', {}, 'darwin')).toBe('brew');
  });

  it('Windows: Scoop, Chocolatey, winget, or the plain installer', () => {
    expect(detectInstallSource('C:\\Users\\me\\scoop\\apps\\keeper\\current\\Keeper.exe', {}, 'win32')).toBe('scoop');
    expect(detectInstallSource('D:/Tools/Scoop/apps/keeper/1.0/Keeper.exe', {}, 'win32')).toBe('scoop');
    expect(detectInstallSource('C:\\ProgramData\\chocolatey\\lib\\keeper-files\\tools\\Keeper.exe', {}, 'win32')).toBe('choco');
    const pf = 'C:\\Program Files\\Keeper\\Keeper.exe';
    expect(detectInstallSource(pf, {}, 'win32')).toBe('direct');
    expect(detectInstallSource(pf, {}, 'win32', has('C:\\ProgramData\\chocolatey\\lib\\keeper-files'))).toBe('choco');
    expect(detectInstallSource(pf, { ChocolateyInstall: 'E:\\choco\\' }, 'win32', has('E:\\choco\\lib\\keeper-files'))).toBe('choco');
    const user = 'C:\\Users\\me\\AppData\\Local\\Programs\\Keeper\\Keeper.exe';
    expect(detectInstallSource(user, {}, 'win32')).toBe('direct');
    // A per-user install is never Chocolatey's, even if the package is around.
    expect(detectInstallSource(user, {}, 'win32', has('C:\\ProgramData\\chocolatey\\lib\\keeper-files'))).toBe('direct');
    expect(detectInstallSource(user, {}, 'win32', has('C:\\Users\\me\\AppData\\Local\\Programs\\Keeper\\.installed-by-winget'))).toBe('winget');
    expect(detectInstallSource('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Ashforde.Keeper_x\\Keeper.exe', {}, 'win32')).toBe('winget');
    // The Microsoft Store's MSIX package.
    expect(detectInstallSource('C:\\Program Files\\WindowsApps\\AshfordeOU.KeeperbyAshforde_0.1.0.0_x64__abc123\\app\\Keeper.exe', {}, 'win32')).toBe('msstore');
  });

  it('Linux: sandboxes first, then the package repositories', () => {
    expect(detectInstallSource('/app/keeper/keeper', { FLATPAK_ID: 'io.github.ashfordeou.keeper' }, 'linux')).toBe('flatpak');
    expect(detectInstallSource('/app/keeper/keeper', {}, 'linux', has('/.flatpak-info'))).toBe('flatpak');
    expect(detectInstallSource('/snap/keeper/12/keeper', { SNAP: '/snap/keeper/12', SNAP_NAME: 'keeper' }, 'linux')).toBe('snap');
    expect(detectInstallSource('/snap/keeper/12/keeper', {}, 'linux')).toBe('snap');
    const opt = '/opt/Keeper/keeper';
    expect(detectInstallSource(opt, {}, 'linux')).toBe('direct');
    expect(detectInstallSource(opt, {}, 'linux', has('/usr/share/licenses/keeper-bin'))).toBe('aur');
    expect(detectInstallSource(opt, {}, 'linux', has('/etc/apt/sources.list.d/keeper.list'))).toBe('apt-repo');
    expect(detectInstallSource(opt, {}, 'linux', has('/etc/apt/sources.list.d/keeper.sources'))).toBe('apt-repo');
    expect(detectInstallSource(opt, {}, 'linux', has('/etc/yum.repos.d/keeper.repo'))).toBe('dnf-repo');
    expect(detectInstallSource(opt, {}, 'linux', has('/etc/zypp/repos.d/keeper.repo'))).toBe('dnf-repo');
  });

  it('Linux: an AppImage or a tarball updates itself whatever repositories exist', () => {
    const all = has('/etc/apt/sources.list.d/keeper.list', '/usr/share/licenses/keeper-bin');
    expect(detectInstallSource('/tmp/.mount_KeeperX/keeper', { APPIMAGE: '/home/me/Keeper.AppImage' }, 'linux', all)).toBe('direct');
    expect(detectInstallSource('/home/me/apps/Keeper-linux-x64/keeper', {}, 'linux', all)).toBe('direct');
  });

  it('other platforms are direct downloads; system package managers keep the updates to themselves', () => {
    expect(detectInstallSource('/usr/local/bin/keeper', {}, 'freebsd')).toBe('direct');
    for (const [k, v] of Object.entries(INSTALL_SOURCES)) {
      expect(v.selfUpdate).toBe(k === 'direct' || k === 'brew' || k === 'winget');
      // The Microsoft Store updates on its own; there is no command to show.
      if (k !== 'direct' && k !== 'msstore') expect(v.updateCommand).toBeTruthy();
    }
  });
});

describe('render-packaging', () => {
  const sums = parseSums(
    [
      `${'a'.repeat(64)}  Keeper-mac-arm64.dmg`,
      `${'B'.repeat(64)} *Keeper-mac-x64.dmg`,
      `${'c'.repeat(64)}  artifacts/keeper-cli-1.2.3.tgz`,
      'not a checksum line',
    ].join('\n'),
  );

  it('reads sha256sum output, with or without the binary-mode star', () => {
    expect(sums).toEqual({
      'Keeper-mac-arm64.dmg': 'a'.repeat(64),
      'Keeper-mac-x64.dmg': 'b'.repeat(64),
      'keeper-cli-1.2.3.tgz': 'c'.repeat(64),
    });
  });

  it('fills version, tag, date and checksums, including names that contain the version', () => {
    const out = renderTemplate('v{{version}} {{tag}} {{date}} {{sha256:Keeper-mac-arm64.dmg}} {{sha256:keeper-cli-{{version}}.tgz}}', {
      version: '1.2.3',
      sums,
      date: '2026-10-30',
    });
    expect(out).toBe(`v1.2.3 v1.2.3 2026-10-30 ${'a'.repeat(64)} ${'c'.repeat(64)}`);
  });

  it('refuses missing checksums, bad versions and unknown placeholders', () => {
    expect(() => renderTemplate('{{sha256:nope.exe}}', { version: '1.2.3', sums, date: 'd' })).toThrow(/nope\.exe/);
    expect(renderTemplate('{{sha256:nope.exe}}', { version: '1.2.3', sums, date: 'd', allowMissing: true })).toBe('MISSING-SHA256');
    expect(() => renderTemplate('x', { version: 'latest', sums, date: 'd' })).toThrow(/not a version/);
    expect(() => renderTemplate('{{oops}}', { version: '1.2.3', sums, date: 'd' })).toThrow(/oops/);
    expect(renderTemplate('{{version}}', { version: '1.0.0-beta.2', sums, date: 'd' })).toBe('1.0.0-beta.2');
  });

  it('renders every channel in packaging/ with real-looking checksums', () => {
    const names = [
      'Keeper-mac-arm64.dmg', 'Keeper-mac-x64.dmg', 'Keeper-setup-x64.exe', 'Keeper-linux-amd64.deb', 'Keeper-linux-arm64.deb',
      'Keeper-linux-x64.tar.gz', 'Keeper-linux-arm64.tar.gz', 'keeper-cli-2.0.0.tgz',
    ];
    const all = Object.fromEntries(names.map((n, i) => [n, String(i).repeat(64)]));
    const out = mkdtempSync(path.join(os.tmpdir(), 'keeper-packaging-'));
    const files = renderAll({ version: '2.0.0', sums: all, date: '2026-10-30', out, cli: path.join(__dirname, '..', 'package.json') });
    const read = (rel: string) => readFileSync(path.join(out, rel), 'utf8');
    expect(files.some((f) => f.endsWith('.tmpl'))).toBe(false);
    expect(read('homebrew/Casks/keeper.rb')).toContain(`version "2.0.0"`);
    expect(read('homebrew/Casks/keeper.rb')).toContain(`arm:   "${'0'.repeat(64)}"`);
    expect(read('homebrew/Formula/keeper-cli.rb')).toContain('7'.repeat(64));
    expect(JSON.parse(read('npm/package.json'))).toMatchObject({ name: 'keeper-cli', version: '2.0.0', bin: { keeper: 'keeper.cjs' } });
    expect(JSON.parse(read('scoop/keeper.json'))).toMatchObject({ version: '2.0.0', architecture: { '64bit': { hash: '2'.repeat(64) } } });
    expect(read('winget/Ashforde.Keeper.installer.yaml')).toContain(`InstallerSha256: ${'2'.repeat(64)}`);
    expect(read('chocolatey/tools/chocolateyInstall.ps1')).toContain('/v2.0.0/Keeper-setup-x64.exe');
    expect(read('aur/keeper-bin/PKGBUILD')).toContain(`sha256sums_aarch64=('${'4'.repeat(64)}')`);
    expect(read('aur/keeper-bin/.SRCINFO')).toContain('pkgver = 2.0.0');
    expect(read('flatpak/io.github.ashfordeou.keeper.yml')).toContain(`sha256: ${'5'.repeat(64)}`);
    expect(read('flatpak/io.github.ashfordeou.keeper.metainfo.xml')).toContain('<release version="2.0.0" date="2026-10-30">');
  });
});
