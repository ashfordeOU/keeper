// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { compareVersions, notesToText, pickAsset, pickRelease, releaseFor, wantsBeta, type GhRelease } from '../core/updates';

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
