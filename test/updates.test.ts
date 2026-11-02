// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { compareVersions, notesToText, pickAsset, pickRelease, pickUpdate, releaseFits, releaseFor, updateInfoFile, wantsBeta, type GhRelease } from '../core/updates';

const asset = (name: string) => ({ name, size: 100, browser_download_url: `https://example.org/${name}` });
const rel = (tag: string, over: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag, html_url: `https://github.com/ashfordeOU/keeper/releases/tag/${tag}`, draft: false, prerelease: false, body: `Notes for ${tag}`,
  assets: ['Keeper-mac-arm64.dmg', 'Keeper-mac-x64.dmg', 'Keeper-mac-arm64.zip', 'Keeper-setup-x64.exe', 'Keeper-portable.exe', 'Keeper-linux-x64.AppImage', 'Keeper-linux-arm64.AppImage', 'Keeper-linux-x64.deb', 'Keeper-linux-x64.rpm', 'Keeper-linux-x64.tar.gz', 'latest.yml', 'Keeper-setup-x64.exe.blockmap'].map(asset),
  ...over,
});

describe('versions', () => {
  it('compares like semver, with pre-releases before releases', () => {
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.3')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
  });

  it('picks the newest stable release, or a beta when asked', () => {
    const list = [rel('v0.1.0'), rel('v0.3.0-beta.1', { prerelease: true }), rel('v0.2.0'), rel('v0.4.0', { draft: true })];
    expect(pickRelease(list, '0.1.0')?.tag_name).toBe('v0.2.0');
    expect(pickRelease(list, '0.1.0', true)?.tag_name).toBe('v0.3.0-beta.1');
    expect(pickRelease(list, '0.2.0')).toBeUndefined();
    expect(releaseFor(list, '0.2.0')?.body).toBe('Notes for v0.2.0');
  });

  it('a beta copy follows betas unless the person turned them off', () => {
    expect(wantsBeta('0.3.0-beta.1', false)).toBe(true);
    expect(wantsBeta('0.3.0-beta.1', false, true)).toBe(false);
    expect(wantsBeta('0.3.0-beta.1', true, true)).toBe(true);
    expect(wantsBeta('0.2.0', false)).toBe(false);
    expect(wantsBeta('0.2.0', true)).toBe(true);
    expect(wantsBeta('0.2.0', true, true)).toBe(true);
    const list = [rel('v0.3.0-beta.1', { prerelease: true }), rel('v0.3.0-beta.2', { prerelease: true }), rel('v0.2.0')];
    expect(pickRelease(list, '0.3.0-beta.1', wantsBeta('0.3.0-beta.1', false))?.tag_name).toBe('v0.3.0-beta.2');
    expect(pickRelease(list, '0.3.0-beta.1', wantsBeta('0.3.0-beta.1', false, true))).toBeUndefined();
  });
});

describe('installer for this computer', () => {
  const a = rel('v0.2.0').assets;
  it('macOS: the dmg for the processor', () => {
    expect(pickAsset(a, 'darwin', 'arm64', 'mac')?.name).toBe('Keeper-mac-arm64.dmg');
    expect(pickAsset(a, 'darwin', 'x64', 'mac')?.name).toBe('Keeper-mac-x64.dmg');
  });
  it('Windows: setup or portable, x64 on ARM when there is no native build', () => {
    expect(pickAsset(a, 'win32', 'x64', 'nsis')?.name).toBe('Keeper-setup-x64.exe');
    expect(pickAsset(a, 'win32', 'arm64', 'nsis')?.name).toBe('Keeper-setup-x64.exe');
    expect(pickAsset(a, 'win32', 'x64', 'portable')?.name).toBe('Keeper-portable.exe');
  });
  it('Linux: the same kind of package that is installed', () => {
    expect(pickAsset(a, 'linux', 'x64', 'appimage')?.name).toBe('Keeper-linux-x64.AppImage');
    expect(pickAsset(a, 'linux', 'arm64', 'appimage')?.name).toBe('Keeper-linux-arm64.AppImage');
    expect(pickAsset(a, 'linux', 'x64', 'deb')?.name).toBe('Keeper-linux-x64.deb');
    expect(pickAsset(a, 'linux', 'x64', 'rpm')?.name).toBe('Keeper-linux-x64.rpm');
    expect(pickAsset(a, 'linux', 'arm64', 'deb')).toBeUndefined();
  });
  it('notes read as text', () => {
    expect(notesToText('## What’s new\n* **Faster** search\n* See [docs](https://x)')).toBe('What’s new\n• Faster search\n• See docs');
  });
});

import { shortNotes, versionNotes } from '../core/updates';

describe('short notes for the hover card', () => {
  it('takes the first bullets as plain one-liners', () => {
    const md = "## What's new\n- **Faster search** across large libraries (#12)\n- New *Bubbles* view by @someone in https://github.com/x/pull/3\n- Fix\n- Four\n- Five";
    expect(shortNotes(md, 3)).toEqual(['Faster search across large libraries', 'New Bubbles view', 'Fix']);
  });
  it('falls back to sentences and trims long lines', () => {
    expect(shortNotes('# Title\nKeeper is faster. It also looks nicer!', 2)).toEqual(['Keeper is faster.', 'It also looks nicer!']);
    expect(shortNotes(`- ${'word '.repeat(40)}`, 1, 30)[0].endsWith('…')).toBe(true);
  });
  it('lists versions newer than (and including) the current one, newest first', () => {
    const rel = (tag: string, body = '- a') => ({ tag_name: tag, html_url: tag, draft: false, prerelease: tag.includes('-'), body, assets: [] });
    const v = versionNotes([rel('v0.1.0'), rel('v0.3.0'), rel('v0.2.0'), rel('v0.4.0-beta.1'), rel('v0.0.9')], '0.1.0');
    expect(v.map((x) => x.version)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
  });
});

describe('the first stable release (1.0.0) and releases for some systems only', () => {
  // What a real release carries (v0.1.0-beta.7), and a macOS-only one.
  const ALL = ['keeper-cli-1.0.0.tgz', 'Keeper-linux-aarch64.rpm', 'Keeper-linux-amd64.deb', 'Keeper-linux-arm64.AppImage', 'Keeper-linux-arm64.deb', 'Keeper-linux-arm64.tar.gz', 'Keeper-linux-x64.tar.gz', 'Keeper-linux-x86_64.AppImage', 'Keeper-linux-x86_64.rpm', 'Keeper-mac-arm64.dmg', 'Keeper-mac-arm64.dmg.blockmap', 'Keeper-mac-arm64.zip', 'Keeper-mac-x64.dmg', 'Keeper-mac-x64.zip', 'Keeper-portable.exe', 'Keeper-setup-x64.exe', 'Keeper-setup-x64.exe.blockmap', 'latest-linux-arm64.yml', 'latest-linux.yml', 'latest-mac-arm64.yml', 'latest-mac-x64.yml', 'latest.yml', 'SHA256SUMS.txt', 'SHA256SUMS.txt.sigstore.json'];
  const MAC = ALL.filter((n) => /mac|SHA256SUMS|keeper-cli/.test(n));
  const full = (tag: string, over: Partial<GhRelease> = {}) => rel(tag, { assets: ALL.map(asset), prerelease: tag.includes('-'), ...over });
  const macOnly = (tag: string) => rel(tag, { assets: MAC.map(asset), prerelease: tag.includes('-') });
  const betas = [full('v0.1.0-beta.7'), full('v0.1.0-beta.6'), full('v0.1.0-beta.4')];
  const fitsFor = (platform: string, arch: string, kind: Parameters<typeof releaseFits>[3]) => (r: GhRelease) => releaseFits(r, platform, arch, kind);

  it('a beta copy that never chose a channel gets 1.0.0, then follows stable', () => {
    const list = [full('v1.0.1-beta.1'), full('v1.0.0'), ...betas];
    expect(pickUpdate(list, '0.1.0-beta.7')?.tag_name).toBe('v1.0.0');
    expect(pickUpdate(list, '0.1.0-beta.4')?.tag_name).toBe('v1.0.0');
    // On 1.0.0 it is a stable copy: the 1.0.1 beta is not offered.
    expect(pickUpdate(list, '1.0.0')).toBeUndefined();
    expect(pickUpdate([full('v1.0.1'), ...list], '1.0.0')?.tag_name).toBe('v1.0.1');
    // Before 1.0.0 exists it keeps following the betas, as before.
    expect(pickUpdate([full('v0.1.0-beta.8'), ...betas], '0.1.0-beta.7')?.tag_name).toBe('v0.1.0-beta.8');
  });

  it('a person who turned betas on keeps betas; one who turned them off gets stable only', () => {
    const list = [full('v1.0.1-beta.1'), full('v1.0.0'), ...betas];
    expect(pickUpdate(list, '0.1.0-beta.7', { beta: true, chosen: true })?.tag_name).toBe('v1.0.1-beta.1');
    expect(pickUpdate(list, '1.0.0', { beta: true, chosen: true })?.tag_name).toBe('v1.0.1-beta.1');
    expect(pickUpdate(list, '0.1.0-beta.7', { beta: false, chosen: true })?.tag_name).toBe('v1.0.0');
    expect(pickUpdate([full('v0.1.0-beta.8'), ...betas], '0.1.0-beta.7', { beta: false, chosen: true })).toBeUndefined();
  });

  it('a stable copy never gets a beta', () => {
    const list = [full('v1.1.0-beta.2'), full('v1.1.0-beta.1'), full('v1.0.0')];
    expect(pickUpdate(list, '1.0.0')).toBeUndefined();
    expect(pickUpdate(list, '1.0.0', { beta: false, chosen: true })).toBeUndefined();
    expect(pickUpdate(list, '1.0.0', { beta: false, chosen: false })).toBeUndefined();
  });

  it('a macOS-only release is offered to Macs and invisible on Windows and Linux', () => {
    const list = [macOnly('v1.0.0'), ...betas];
    expect(pickUpdate(list, '0.1.0-beta.7', { fits: fitsFor('darwin', 'arm64', 'mac') })?.tag_name).toBe('v1.0.0');
    expect(pickUpdate(list, '0.1.0-beta.7', { fits: fitsFor('darwin', 'x64', 'mac') })?.tag_name).toBe('v1.0.0');
    for (const [platform, arch, kind] of [['win32', 'x64', 'nsis'], ['win32', 'arm64', 'nsis'], ['win32', 'x64', 'portable'], ['linux', 'x64', 'appimage'], ['linux', 'arm64', 'appimage'], ['linux', 'x64', 'deb'], ['linux', 'arm64', 'rpm'], ['linux', 'x64', 'tar']] as const) {
      expect(pickUpdate(list, '0.1.0-beta.7', { fits: fitsFor(platform, arch, kind) }), `${platform} ${arch} ${kind}`).toBeUndefined();
    }
    // A Windows copy on 1.0.0 skips a macOS-only 1.0.1 and gets the next release that has its build.
    const later = [full('v1.0.2'), macOnly('v1.0.1'), full('v1.0.0')];
    expect(pickUpdate(later.slice(1), '1.0.0', { fits: fitsFor('win32', 'x64', 'nsis') })).toBeUndefined();
    expect(pickUpdate(later, '1.0.0', { fits: fitsFor('win32', 'x64', 'nsis') })?.tag_name).toBe('v1.0.2');
  });

  it('electron-updater installs need their update information, and components are never installers', () => {
    expect(updateInfoFile('win32', 'x64', 'nsis')).toBe('latest.yml');
    expect(updateInfoFile('linux', 'x64', 'appimage')).toBe('latest-linux.yml');
    expect(updateInfoFile('linux', 'arm64', 'appimage')).toBe('latest-linux-arm64.yml');
    expect(updateInfoFile('darwin', 'arm64', 'mac')).toBeUndefined();
    const noYml = rel('v1.0.0', { assets: ALL.filter((n) => n !== 'latest.yml' && n !== 'latest-linux.yml').map(asset) });
    expect(releaseFits(noYml, 'win32', 'x64', 'nsis')).toBe(false);
    expect(releaseFits(noYml, 'linux', 'x64', 'appimage')).toBe(false);
    expect(releaseFits(noYml, 'linux', 'x64', 'deb')).toBe(true);
    expect(releaseFits(noYml, 'linux', 'arm64', 'appimage')).toBe(true);
    // A macOS-only release that also carries macOS components still has nothing for Linux.
    const withComponents = rel('v1.0.0', { assets: [...MAC, 'keeper-component-ocr-darwin-arm64.tar.gz', 'components-darwin-arm64.json', 'keeper-component-ocr-linux-x64.tar.gz'].map(asset) });
    expect(releaseFits(withComponents, 'linux', 'x64', 'tar')).toBe(false);
    expect(releaseFits(withComponents, 'darwin', 'arm64', 'mac')).toBe(true);
  });

  it('the asset names installed betas look for are unchanged', () => {
    const r = full('v1.0.0');
    expect(pickAsset(r.assets, 'darwin', 'arm64', 'mac')?.name).toBe('Keeper-mac-arm64.dmg');
    expect(pickAsset(r.assets, 'darwin', 'x64', 'mac')?.name).toBe('Keeper-mac-x64.dmg');
    expect(pickAsset(r.assets, 'win32', 'x64', 'nsis')?.name).toBe('Keeper-setup-x64.exe');
    expect(pickAsset(r.assets, 'linux', 'x64', 'appimage')?.name).toBe('Keeper-linux-x86_64.AppImage');
    expect(r.assets.map((a) => a.name)).toEqual(expect.arrayContaining(['latest-mac-arm64.yml', 'latest-mac-x64.yml', 'latest.yml', 'latest-linux.yml', 'SHA256SUMS.txt']));
  });
});
