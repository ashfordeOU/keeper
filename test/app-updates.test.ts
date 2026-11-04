// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  appUpdateFindings, checkDue, compareVersions, emptyUpdates, feedUpdate, mergeUpdates, normalizeAppUpdateSettings, ownApp, parseAppcast, parseAptUpgradable, parseBrewOutdated,
  parseDnfCheckUpdate, parseFlatpakUpdates, parseSnapRefresh, parseWingetUpgrade, safeUrl, updateCounts, type AppUpdate,
} from '../core/app-updates';
import { downloadName, ed25519Valid } from '../core/app-updates-verify';

const APPCAST = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Field Notes</title>
    <item>
      <title>3.2 beta</title>
      <sparkle:channel>beta</sparkle:channel>
      <sparkle:version>330</sparkle:version>
      <enclosure url="https://example.com/beta.zip" length="10" type="application/octet-stream" sparkle:edSignature="AAA" />
    </item>
    <item>
      <title>3.2</title>
      <sparkle:version>320</sparkle:version>
      <sparkle:shortVersionString>3.2</sparkle:shortVersionString>
      <sparkle:releaseNotesLink>https://example.com/notes/3.2?a=1&amp;b=2</sparkle:releaseNotesLink>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:criticalUpdate></sparkle:criticalUpdate>
      <enclosure url="https://example.com/FieldNotes-3.2.zip" length="1234" type="application/octet-stream" sparkle:edSignature="c2ln" />
    </item>
    <item>
      <title>3.1</title>
      <enclosure url="https://example.com/FieldNotes-3.1.zip" sparkle:version="310" sparkle:shortVersionString="3.1" length="1200" type="application/octet-stream" />
    </item>
  </channel>
</rss>`;

describe('versions', () => {
  it('compares numbers part by part, pre-releases first', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('v3.1.4', '3.1.5')).toBe(-1);
    expect(compareVersions('1.0-beta.2', '1.0')).toBe(-1);
    expect(compareVersions('1.0-beta.10', '1.0-beta.2')).toBe(1);
    expect(compareVersions('14.1.1', '14.0.3')).toBe(1);
  });
});

describe('Sparkle appcasts', () => {
  it('takes the newest item outside a channel, with its notes, signature and minimum system', () => {
    const it0 = parseAppcast(APPCAST)!;
    expect(it0.version).toBe('320');
    expect(it0.shortVersion).toBe('3.2');
    expect(it0.notes).toBe('https://example.com/notes/3.2?a=1&b=2');
    expect(it0.edSignature).toBe('c2ln');
    expect(it0.length).toBe(1234);
    expect(it0.critical).toBe(true);
    expect(it0.minimumSystemVersion).toBe('13.0');
  });
  it('reads versions written on the enclosure (older appcasts)', () => {
    const it1 = parseAppcast(APPCAST.replace(/<item>\s*<title>3\.2<\/title>[\s\S]*?<\/item>/, ''))!;
    expect(it1).toMatchObject({ version: '310', shortVersion: '3.1', critical: false });
  });
  it('returns null for something that is not an appcast', () => {
    expect(parseAppcast('<html><body>Not found</body></html>')).toBeNull();
  });
  const app = { id: 'com.example.notes', name: 'Field Notes', path: '/Applications/Field Notes.app', version: '3.1', build: '310', feedUrl: 'https://example.com/appcast.xml', publicKey: 'a2V5' };
  it('offers a checked download when the app has a signing key', () => {
    const u = feedUpdate(app, parseAppcast(APPCAST), '14.5')!;
    expect(u).toMatchObject({ id: 'feed:com.example.notes', installed: '3.1', latest: '3.2', security: true, source: 'feed' });
    expect(u.action).toEqual({ kind: 'download', url: 'https://example.com/FieldNotes-3.2.zip', edSignature: 'c2ln', publicKey: 'a2V5', length: 1234 });
  });
  it('opens the notes page instead when there is no key to check the download with', () => {
    const u = feedUpdate({ ...app, publicKey: undefined }, parseAppcast(APPCAST), '14.5')!;
    expect(u.action).toEqual({ kind: 'open', url: 'https://example.com/notes/3.2?a=1&b=2' });
  });
  it('says nothing when the app is current, the Mac is too old, or the feed is not https', () => {
    expect(feedUpdate({ ...app, build: '320', version: '3.2' }, parseAppcast(APPCAST), '14.5')).toBeNull();
    expect(feedUpdate(app, parseAppcast(APPCAST), '12.7')).toBeNull();
    expect(feedUpdate({ ...app, publicKey: undefined }, parseAppcast(APPCAST.replace(/https:/g, 'http:')), '14.5')).toBeNull();
  });
  it('accepts only https', () => {
    expect(safeUrl('https://a.example/x')).toBe(true);
    expect(safeUrl('http://a.example/x')).toBe(false);
    expect(safeUrl('file:///etc/passwd')).toBe(false);
    expect(safeUrl('not a url')).toBe(false);
  });
  it('leaves Keeper and other Ashforde apps to their own updates', () => {
    expect(ownApp('io.github.ashfordeou.keeper')).toBe(true);
    expect(ownApp('org.ashforde.macslider')).toBe(true);
    expect(ownApp('com.example.notes')).toBe(false);
  });
});

describe('checking a download', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  const data = Buffer.from('the maker’s update');
  const sig = sign(null, data, privateKey).toString('base64');
  it('accepts the maker’s signature and refuses anything else', () => {
    expect(ed25519Valid(raw, sig, data)).toBe(true);
    expect(ed25519Valid(raw, sig, Buffer.from('a changed update'))).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
    expect(ed25519Valid(other, sig, data)).toBe(false);
    expect(ed25519Valid('short', sig, data)).toBe(false);
  });
  it('names the saved file from the address, safely', () => {
    expect(downloadName('https://example.com/dl/Field%20Notes%203.2.dmg?x=1')).toBe('Field Notes 3.2.dmg');
    expect(downloadName('https://example.com/dl/..%2F..%2Fevil')).toBe('evil');
    expect(downloadName('https://example.com/', 'Field Notes')).toBe('Field Notes');
  });
});

describe('package managers', () => {
  it('reads Homebrew’s outdated list', () => {
    const json = JSON.stringify({ formulae: [{ name: 'ripgrep', installed_versions: ['14.0.3'], current_version: '14.1.1' }], casks: [{ name: 'sketchpad', installed_versions: '2.0.4', current_version: '2.1.0' }, { name: '--bad', current_version: '1' }] });
    const l = parseBrewOutdated(json);
    expect(l.map((u) => u.id)).toEqual(['brewCask:sketchpad', 'brew:ripgrep']);
    expect(l[0].action).toEqual({ kind: 'run', cmd: { file: 'brew', args: ['upgrade', '--cask', 'sketchpad'] } });
    expect(parseBrewOutdated('not json')).toEqual([]);
  });
  it('reads winget’s table from its header, with names cut short', () => {
    const out = [
      '   - \r   \\ \r',
      'Name                         Id                        Version      Available    Source',
      '------------------------------------------------------------------------------------------',
      'Mozilla Firefox (x64 en-US)  Mozilla.Firefox           119.0        120.0.1      winget',
      'Microsoft Visual Studio Co…  Microsoft.VisualStudioCode 1.84.0      1.85.1       winget',
      'Some Tool                    Vendor.SomeTool           Unknown      2.0          winget',
      '3 upgrades available.',
      '',
      'The following packages have an upgrade available, but require explicit targeting for upgrade:',
    ].join('\n');
    const l = parseWingetUpgrade(out);
    expect(l.map((u) => [u.id, u.installed, u.latest])).toEqual([
      ['winget:Mozilla.Firefox', '119.0', '120.0.1'],
      ['winget:Microsoft.VisualStudioCode', '1.84.0', '1.85.1'],
      ['winget:Vendor.SomeTool', '?', '2.0'],
    ]);
    expect(l[1].name).toBe('Microsoft Visual Studio Co');
    expect(l[0].action.kind === 'run' && l[0].action.cmd.args).toEqual(['upgrade', '--id', 'Mozilla.Firefox', '--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
    expect(parseWingetUpgrade('No installed package found matching input criteria.')).toEqual([]);
  });
  it('reads Flatpak, Snap, apt and dnf', () => {
    const fp = parseFlatpakUpdates('org.example.Paint\t2.1\norg.example.Old\t1.0\n', 'org.example.Paint\t2.2\tPaint\norg.example.Runtime\t1\tRuntime\n');
    expect(fp).toHaveLength(1);
    expect(fp[0]).toMatchObject({ id: 'flatpak:org.example.Paint', name: 'Paint', installed: '2.1', latest: '2.2' });
    const sn = parseSnapRefresh('Name     Version  Rev  Size  Publisher  Notes\nchromium 120.0    2700 160MB canonical  -\n', 'Name Version Rev Tracking Publisher Notes\nchromium 119.0 2690 latest/stable canonical -\n');
    expect(sn[0]).toMatchObject({ id: 'snap:chromium', installed: '119.0', latest: '120.0' });
    expect(sn[0].action.kind === 'run' && sn[0].action.cmd.admin).toBe(true);
    const apt = parseAptUpgradable('Listing... Done\nfirefox/jammy-security 120.0+build1 amd64 [upgradable from: 119.0+build2]\nlibfoo1/jammy-updates 1.2 amd64 [upgradable from: 1.1]\n');
    expect(apt).toEqual([{ name: 'firefox', latest: '120.0+build1', installed: '119.0+build2', security: true }, { name: 'libfoo1', latest: '1.2', installed: '1.1', security: false }]);
    const dnf = parseDnfCheckUpdate('\nfirefox.x86_64   120.0-1.fc39   updates\nbash.x86_64   5.2.21-1.fc39   updates\nObsoleting Packages\nold.noarch 1 updates\n', 'FEDORA-2023-abc Important/Sec. firefox-120.0-1.fc39.x86_64\n');
    expect(dnf).toEqual([{ name: 'firefox', latest: '120.0-1.fc39', security: true }, { name: 'bash', latest: '5.2.21-1.fc39', security: false }]);
  });
});

describe('one list and the Fix-it List', () => {
  const feed: AppUpdate = { id: 'feed:x', name: 'Sketchpad', installed: '2.0', latest: '2.1', source: 'feed', security: true, action: { kind: 'open', url: 'https://x' } };
  const cask: AppUpdate = { id: 'brewCask:sketchpad', name: 'sketchpad', installed: '2.0', latest: '2.1', source: 'brewCask', action: { kind: 'run', cmd: { file: 'brew', args: [] } } };
  it('keeps the package manager’s row when an app is found twice, and its security flag', () => {
    const l = mergeUpdates([[feed], [cask]]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ source: 'brewCask', security: true });
  });
  it('writes one calm row, security first', () => {
    const s = { ...emptyUpdates(), checkedAt: 1, updates: mergeUpdates([[feed], [{ ...cask, id: 'brew:rg', name: 'ripgrep' }]]) };
    const f = appUpdateFindings(s);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'updates:apps', area: 'updates', severity: 'medium', title: '1 app has security updates' });
    expect(f[0].fix).toEqual({ kind: 'page', route: { name: 'apps', arg: 'updates' }, label: 'See updates' });
    expect(appUpdateFindings({ ...s, updates: [{ ...cask, security: undefined }, { ...cask, id: 'b', name: 'b' }] })[0]).toMatchObject({ title: '2 apps have updates', severity: 'low' });
    expect(appUpdateFindings({ ...emptyUpdates(), system: { count: 3, security: 1, manager: 'apt' } })[0]).toMatchObject({ title: '3 system updates waiting', severity: 'medium' });
    expect(appUpdateFindings(emptyUpdates())).toEqual([]);
    expect(updateCounts({ ...s, system: { count: 4, security: 2, manager: 'dnf' } })).toEqual({ apps: 2, security: 3, system: 4 });
  });
  it('knows when a check is due, and cleans its settings', () => {
    expect(checkDue(0, 24)).toBe(true);
    expect(checkDue(Date.now() - 3600_000, 24)).toBe(false);
    expect(normalizeAppUpdateSettings({ everyHours: 5, auto: false } as never)).toEqual({ auto: false, everyHours: 24, selfUpdating: false });
    expect(normalizeAppUpdateSettings(undefined)).toEqual({ auto: true, everyHours: 24, selfUpdating: false });
  });
});
