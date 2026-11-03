// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Fix-it List: Trust by fingerprint (kept across restarts, back when the
// item changes), extension names from _locales, the table of known tools that
// start at login (a GitHub Actions runner, Docker, Homebrew…), grouping,
// plain severity words, launchd plists and the certificates in a keychain.

import { describe, expect, it } from 'vitest';
import { mergeFindings, trustState } from '../core/guide/aggregate';
import { groupRows, groupTitle, severityWord } from '../core/guide/group';
import { fingerprint, hashText } from '../core/guide/trust';
import type { Finding, FindingState, Subject } from '../core/guide/types';
import { chromiumExtension, extensionStoreUrl, localizedName, permissionMeaning } from '../core/security/browsers';
import { KNOWN_TOOLS, labelOf, recognise, runnerOf, signerName, startupVerdict } from '../core/security/known-tools';
import { launchdJob, parsePlist } from '../core/security/plist';
import { macAddedRoots, macRootList } from '../core/security/posture';
import { browserFindings, persistenceFindings } from '../core/security/score';

const login = (o: Partial<Extract<Subject, { kind: 'login-item' }>> = {}): Subject => ({ kind: 'login-item', path: '/Users/a/Library/LaunchAgents/x.plist', where: 'launch-agent', name: 'x.plist', program: '/opt/x/run', contentHash: 'c1', ...o });
const ext = (o: Partial<Extract<Subject, { kind: 'extension' }>> = {}): Subject => ({ kind: 'extension', browser: 'Brave', profile: 'Default', id: 'llangkpnndilncfkpgcpolnmgjgnompo', name: 'Tab Saver', version: '1.0', permissions: ['tabs', 'storage'], hostPermissions: ['<all_urls>'], ...o });
const finding = (id: string, subject?: Subject, o: Partial<Finding> = {}): Finding => ({ id, source: 'security', area: 'security', severity: 'medium', title: id, why: 'w', fix: { kind: 'manual', steps: [] }, subject, ...o });
/** Saved to disk and read back, as across a restart. */
const restart = (s: Record<string, FindingState>) => JSON.parse(JSON.stringify(s)) as Record<string, FindingState>;

describe('Trust by fingerprint', () => {
  it('hashes stably', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('a trusted item stays trusted across a restart', () => {
    const f = finding('security:persist.a', login({ signed: false, codeHash: 'h1' }));
    const states = restart({ [f.id]: trustState(f, undefined, 1000) });
    const [v] = mergeFindings([f], states, 2000);
    expect(v.status).toBe('trusted');
    expect(v.changed).toBeUndefined();
    expect(states[f.id].trusted?.title).toBe(f.id);
  });

  it('an unsigned login item comes back when its program changes', () => {
    const f = finding('security:persist.a', login({ signed: false, codeHash: 'h1' }));
    const states = restart({ [f.id]: trustState(f) });
    const [v] = mergeFindings([finding(f.id, login({ signed: false, codeHash: 'h2' }))], states);
    expect(v.status).toBe('open');
    expect(v.changed).toBe(true);
  });

  it('a signed login item stays trusted through an update from the same developer, not another signer', () => {
    const a = finding('security:persist.d', login({ signed: true, signer: 'Developer ID Application: Docker Inc (9BNSXJN65R)', team: '9BNSXJN65R', codeHash: 'cd1' }));
    const states = restart({ [a.id]: trustState(a) });
    expect(mergeFindings([finding(a.id, login({ signed: true, signer: 'Developer ID Application: Docker Inc (9BNSXJN65R)', team: '9BNSXJN65R', codeHash: 'cd2' }))], states)[0].status).toBe('trusted');
    expect(mergeFindings([finding(a.id, login({ signed: true, signer: 'Developer ID Application: Someone (AAAAAAAAAA)', team: 'AAAAAAAAAA' }))], states)[0].status).toBe('open');
    expect(mergeFindings([finding(a.id, login({ signed: false, codeHash: 'x' }))], states)[0].status).toBe('open');
    // What it runs changed (the plist), or a different program.
    expect(mergeFindings([finding(a.id, login({ signed: true, team: '9BNSXJN65R', contentHash: 'c2' }))], states)[0].status).toBe('open');
    expect(mergeFindings([finding(a.id, login({ signed: true, team: '9BNSXJN65R', program: '/tmp/evil' }))], states)[0].status).toBe('open');
  });

  it('an extension comes back with a new version or new permissions, not when its permissions are reordered', () => {
    const e = finding('security:browser.ext.Brave.x', ext());
    const states = restart({ [e.id]: trustState(e) });
    expect(mergeFindings([finding(e.id, ext({ permissions: ['storage', 'tabs'] }))], states)[0].status).toBe('trusted');
    expect(mergeFindings([finding(e.id, ext({ version: '1.1' }))], states)[0].status).toBe('open');
    expect(mergeFindings([finding(e.id, ext({ permissions: ['tabs', 'storage', 'cookies'] }))], states)[0].status).toBe('open');
  });

  it('a certificate is known by its fingerprint', () => {
    const c = (sha1: string): Subject => ({ kind: 'certificate', store: '/Library/Keychains/System.keychain', name: 'Corp CA', sha1 });
    const f = finding('security:posture.roots.AA', c('AA'));
    const states = restart({ [f.id]: trustState(f) });
    expect(mergeFindings([f], states)[0].status).toBe('trusted');
    expect(mergeFindings([finding(f.id, c('BB'))], states)[0].status).toBe('open');
  });

  it('findings without a subject are trusted by id; ignore and snooze still win', () => {
    const f = finding('protection:firewall');
    expect(fingerprint(f)).toBe(fingerprint({ ...f, title: 'other words' }));
    const states = restart({ [f.id]: trustState(f) });
    expect(mergeFindings([f], states)[0].status).toBe('trusted');
    expect(mergeFindings([f], { [f.id]: { ...states[f.id], ignored: true } })[0].status).toBe('ignored');
    // Trusting clears an earlier snooze or ignore.
    expect(trustState(f, { ignored: true, snoozedUntil: 5 }).ignored).toBeUndefined();
  });
});

describe('extension names', () => {
  const locales: Record<string, string> = {
    en: JSON.stringify({ appName: { message: 'Readwise Highlighter' }, appDesc: { message: 'Save highlights' } }),
    de: JSON.stringify({ APPNAME: { message: 'Readwise Markierer' } }),
  };
  const messages = (loc: string) => locales[loc];

  it('resolves __MSG_ names from _locales, without regard to case, preferring the person’s language', () => {
    expect(localizedName('__MSG_appName__', messages, 'en')).toBe('Readwise Highlighter');
    expect(localizedName('__MSG_APPNAME__', messages, 'en')).toBe('Readwise Highlighter');
    expect(localizedName('__MSG_appName__', messages, 'en', ['de_DE', 'de'])).toBe('Readwise Markierer');
    expect(localizedName('__MSG_appName__', messages, 'fr')).toBe('Readwise Highlighter');
    expect(localizedName('__MSG_missing__', messages, 'en')).toBeUndefined();
    expect(localizedName('Plain Name', undefined)).toBe('Plain Name');
    expect(localizedName('__MSG_appName__', (l) => (l === 'en' ? '﻿{ broken' : undefined), 'en')).toBeUndefined();
  });

  it('a Chromium extension gets its real name; the id only when there is none', () => {
    const id = 'llangkpnndilncfkpgcpolnmgjgnompo';
    const manifest = JSON.stringify({ name: '__MSG_appName__', default_locale: 'en', version: '3.2', permissions: ['tabs'], host_permissions: ['<all_urls>'] });
    expect(chromiumExtension(id, manifest, undefined, {}, messages)?.name).toBe('Readwise Highlighter');
    expect(chromiumExtension(id, manifest, { manifest: { name: 'From Preferences' } }, {}, () => undefined)?.name).toBe('From Preferences');
    expect(chromiumExtension(id, manifest, undefined, {}, () => undefined)?.name).toBe(id);
  });

  it('explains permissions and links to the store', () => {
    expect(permissionMeaning('<all_urls>')).toBe('read and change every website you visit');
    expect(permissionMeaning('cookies')).toMatch(/cookies/);
    expect(permissionMeaning('storage')).toMatch(/settings/);
    expect(permissionMeaning('https://mail.google.com/*')).toBe('read and change https://mail.google.com');
    expect(extensionStoreUrl('Brave', 'llangkpnndilncfkpgcpolnmgjgnompo')).toBe('https://chromewebstore.google.com/detail/llangkpnndilncfkpgcpolnmgjgnompo');
    expect(extensionStoreUrl('Chrome', 'llangkpnndilncfkpgcpolnmgjgnompo', false)).toBeUndefined();
  });

  it('extension findings carry the exact extension and a group', () => {
    const [f] = browserFindings([{ browser: 'Brave', engine: 'chromium', profile: 'Personal', path: '/p', savedPasswords: false, extensions: [{ id: 'abc', name: 'Video Downloader Professional', version: '1.5', enabled: true, permissions: ['downloads'], hostPermissions: ['<all_urls>'], risk: 50, reasons: ['can read and change every website you visit'] }] }]);
    expect(f.subject).toMatchObject({ kind: 'extension', browser: 'Brave', id: 'abc', version: '1.5', profile: 'Personal', profileDir: '/p' });
    expect(f.group?.key).toBe('ext-broad');
  });
});

describe('things that start at login', () => {
  it('recognises the person’s own GitHub Actions runner', () => {
    expect(runnerOf('actions.runner.ashfordeOU-arksa.arksa-mac-1')).toEqual({ repo: 'ashfordeOU/arksa', runner: 'arksa-mac-1' });
    expect(runnerOf('actions.runner.myorg.box')).toEqual({ repo: 'myorg', runner: 'box' });
    const v = startupVerdict({ name: 'actions.runner.ashfordeOU-arksa.arksa-mac-1.plist', program: '/Users/a/actions-runner/runsvc.sh', signed: false });
    expect(v.tool?.id).toBe('github-runner');
    expect(v.title).toBe('GitHub Actions runner for ashfordeOU/arksa starts automatically');
    expect(v.severity).toBe('low');
    expect(v.why).toMatch(/Trust/);
  });

  it('says who made Docker when Docker Inc signed it, and is wary of a look-alike', () => {
    const docker = startupVerdict({ name: 'com.docker.socket.plist', program: '/Library/PrivilegedHelperTools/com.docker.socket', signed: true, signer: 'Developer ID Application: Docker Inc (9BNSXJN65R)', notarized: true });
    expect(docker).toMatchObject({ severity: 'low', title: 'Docker Desktop starts automatically' });
    expect(docker.why).toMatch(/Docker Inc/);
    expect(docker.tool?.verified).toBe(true);
    const fake = startupVerdict({ name: 'com.docker.helper.plist', program: '/tmp/x', signed: true, signer: 'Developer ID Application: Evil Ltd (AAAAAAAAAA)' });
    expect(fake.severity).toBe('medium');
    expect(fake.title).toMatch(/named like Docker/);
    expect(startupVerdict({ name: 'com.docker.vmnetd.plist', signed: false }).severity).toBe('medium');
  });

  it('recognises common developer tools from a table', () => {
    const name = (n: string, program?: string, signer?: string) => recognise({ name: n, program, signed: !!signer, signer })?.name;
    expect(name('homebrew.mxcl.postgresql@16.plist', '/opt/homebrew/opt/postgresql@16/bin/postgres')).toBe('Homebrew service: postgresql@16');
    expect(name('x.plist', '/opt/homebrew/opt/redis/bin/redis-server')).toBe('Homebrew service');
    expect(name('com.tailscale.ipnextension.plist', undefined, 'Developer ID Application: Tailscale Inc. (W5364U7YZB)')).toBe('Tailscale');
    expect(name('com.1password.1password-launcher.plist', undefined, 'Developer ID Application: AgileBits Inc. (2BUA8C4S2C)')).toBe('1Password');
    expect(name('docker.service')).toBe('Docker Desktop');
    expect(name('com.example.thing.plist', '/Applications/Thing.app/Contents/MacOS/thing')).toBeUndefined();
    // Every row is usable data.
    for (const t of KNOWN_TOOLS) expect(t.id && t.name && t.maker && (t.label || t.program)).toBeTruthy();
  });

  it('says “something new runs at login”, never “malware”, and lowers signed items', () => {
    const unsigned = startupVerdict({ name: 'com.updater.helper.plist', program: '/Users/a/.helper/updater', signed: false });
    expect(unsigned).toMatchObject({ severity: 'medium', title: 'Something new runs at login: com.updater.helper' });
    const signed = startupVerdict({ name: 'com.acme.agent.plist', signed: true, signer: 'Developer ID Application: Acme Corp (ABCDE12345)', notarized: true });
    expect(signed.severity).toBe('low');
    expect(signed.title).toBe('Something new runs at login: com.acme.agent (Acme Corp)');
    for (const v of [unsigned, signed]) expect(`${v.title} ${v.why}`).not.toMatch(/malware/i);
    const items = persistenceFindings([{ id: 'launch-agent:/x/com.docker.socket.plist', kind: 'launch-agent', name: 'com.docker.socket.plist', location: '/x/com.docker.socket.plist', command: '/Library/PrivilegedHelperTools/com.docker.socket', signed: true, signer: 'Developer ID Application: Docker Inc (9BNSXJN65R)', team: '9BNSXJN65R', firstSeen: 1 }], new Set());
    expect(items[0]).toMatchObject({ severity: 'low', title: 'Docker Desktop starts automatically', group: { key: 'login-items' } });
    expect(items[0].subject).toMatchObject({ kind: 'login-item', team: '9BNSXJN65R', tool: { id: 'docker', maker: 'Docker Inc', verified: true } });
    expect(items[0].why).not.toMatch(/malware/i);
  });

  it('reads signer names and labels', () => {
    expect(signerName('Developer ID Application: Docker Inc (9BNSXJN65R)')).toEqual({ name: 'Docker Inc', team: '9BNSXJN65R' });
    expect(signerName('CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond')).toEqual({ name: 'Microsoft Corporation' });
    expect(labelOf({ name: 'tailscaled.service' })).toBe('tailscaled');
  });
});

describe('grouping and words', () => {
  const f = (id: string, key?: string, severity: Finding['severity'] = 'medium'): Finding => finding(id, undefined, { severity, group: key ? { key, one: '1 browser extension with broad access', many: '{n} browser extensions with broad access' } : undefined });

  it('groups three or more alike in the place of the first, keeping the order', () => {
    const rows = groupRows([f('a', 'ext'), f('b'), f('c', 'ext', 'high'), f('d', 'ext'), f('e', 'other'), f('g', 'other')]);
    expect(rows.map((r) => (r.kind === 'one' ? r.finding.id : `[${r.items.map((i) => i.id).join('')}]`))).toEqual(['[acd]', 'b', 'e', 'g']);
    const g = rows[0];
    expect(g.kind === 'group' && g.title).toBe('3 browser extensions with broad access');
    expect(g.kind === 'group' && g.severity).toBe('high');
    expect(groupRows([f('a', 'ext'), f('b', 'ext')], 2)[0].kind).toBe('group');
    expect(groupTitle({ one: '1 thing', many: '{n} things' }, 1)).toBe('1 thing');
  });

  it('says how important in plain words', () => {
    expect(['critical', 'high', 'medium', 'low', 'info'].map((s) => severityWord(s as Finding['severity']))).toEqual(['Important', 'Important', 'Worth a look', 'Low', 'Low']);
  });
});

describe('launchd plists and keychains', () => {
  it('reads what a launch agent runs and when', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>actions.runner.ashfordeOU-arksa.arksa-mac-1</string>
  <key>ProgramArguments</key>
  <array><string>/Users/a/actions-runner/runsvc.sh</string><string>--once &amp; done</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>WorkingDirectory</key><string>/Users/a/actions-runner</string>
  <key>StartInterval</key><integer>300</integer>
  <key>EnvironmentVariables</key><dict/>
</dict>
</plist>`;
    const job = launchdJob(parsePlist(xml));
    expect(job).toEqual({ label: 'actions.runner.ashfordeOU-arksa.arksa-mac-1', program: '/Users/a/actions-runner/runsvc.sh', args: ['--once & done'], runAtLoad: true, keepAlive: 'when SuccessfulExit', workingDirectory: '/Users/a/actions-runner', startInterval: 300 });
    expect(launchdJob(parsePlist('<plist><dict><key>Program</key><string>/bin/x</string><key>KeepAlive</key><true/></dict></plist>'))).toMatchObject({ program: '/bin/x', keepAlive: true });
    expect(parsePlist('not a plist')).toBeUndefined();
  });

  it('lists each added certificate with its hashes, one finding each', () => {
    const out = `SHA-256 hash: 1111111111111111111111111111111111111111111111111111111111111111
SHA-1 hash: AAAA000000000000000000000000000000000000
keychain: "/Library/Keychains/System.keychain"
attributes:
    "alis"<blob>="Corp Proxy CA"
    "labl"<blob>="Corp Proxy CA"
SHA-256 hash: 2222222222222222222222222222222222222222222222222222222222222222
SHA-1 hash: BBBB000000000000000000000000000000000000
keychain: "/Library/Keychains/System.keychain"
attributes:
    "labl"<blob>="com.apple.kerberos.kdc"
SHA-1 hash: CCCC000000000000000000000000000000000000
keychain: "/Library/Keychains/System.keychain"
attributes:
    "labl"<blob>="mkcert development CA"
`;
    expect(macRootList(out)).toEqual([
      { name: 'Corp Proxy CA', sha1: 'AAAA000000000000000000000000000000000000', sha256: '1111111111111111111111111111111111111111111111111111111111111111' },
      { name: 'mkcert development CA', sha1: 'CCCC000000000000000000000000000000000000', sha256: undefined },
    ]);
    const f = macAddedRoots(out);
    expect(f.map((x) => x.id)).toEqual(['posture.roots.AAAA000000000000000000000000000000000000', 'posture.roots.CCCC000000000000000000000000000000000000']);
    expect(f[0].subject).toMatchObject({ kind: 'certificate', sha1: 'AAAA000000000000000000000000000000000000', store: '/Library/Keychains/System.keychain' });
    expect(f[0].group?.key).toBe('certs');
  });
});
