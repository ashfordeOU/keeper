// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security in the browser demo: a Mac with a few things to look at.

import type { SecurityApi, SecurityOverview, SecuritySettings } from '../core/api-security';
import { browserFindings, connectionFindings, malwareFindings, normalizeFindings, permissionFindings, score, scoreLabel, sortFindings, topActions } from '../core/security/score';
import type { BrowserProfile, Finding, PermissionGrant, PersistenceItem, QuarantineItem, ScanProgress, SecurityEvent } from '../core/security/types';
import { scoreExtension } from '../core/security/browsers';

const now = Date.now();
const H = 3600_000;

const grants: PermissionGrant[] = [
  { app: 'us.zoom.xos', service: 'camera', raw: 'kTCCServiceCamera', allowed: true, lastUsed: now - 2 * H, source: 'tcc' },
  { app: 'com.microsoft.teams2', service: 'camera', raw: 'kTCCServiceCamera', allowed: true, lastUsed: now - 26 * H, source: 'tcc' },
  { app: 'us.zoom.xos', service: 'microphone', raw: 'kTCCServiceMicrophone', allowed: true, lastUsed: now - 2 * H, inUse: true, source: 'tcc' },
  { app: 'com.google.Chrome', service: 'microphone', raw: 'kTCCServiceMicrophone', allowed: true, lastUsed: now - 50 * H, source: 'tcc' },
  { app: 'com.obsproject.obs-studio', service: 'screen', raw: 'kTCCServiceScreenCapture', allowed: true, lastUsed: now - 9 * 24 * H, source: 'tcc' },
  { app: 'com.loom.desktop', service: 'screen', raw: 'kTCCServiceScreenCapture', allowed: true, lastUsed: now - 40 * 24 * H, source: 'tcc' },
  { app: 'com.example.KeyboardHelper', service: 'input', raw: 'kTCCServiceListenEvent', allowed: true, source: 'tcc' },
  { app: 'com.raycast.macos', service: 'accessibility', raw: 'kTCCServiceAccessibility', allowed: true, source: 'tcc' },
  { app: 'com.apple.Terminal', service: 'files', raw: 'kTCCServiceSystemPolicyAllFiles', allowed: true, source: 'tcc' },
  { app: 'com.spotify.client', service: 'location', raw: 'kTCCServiceLocation', allowed: false, source: 'tcc' },
];

const ext = (id: string, name: string, permissions: string[], hostPermissions: string[], fromStore = true, enabled = true) => ({ id, name, version: '2.3.1', enabled, permissions, hostPermissions, fromStore, ...scoreExtension({ id, permissions, hostPermissions, fromStore }) });

const browsers: BrowserProfile[] = [
  { browser: 'Chrome', engine: 'chromium', profile: 'Person 1', path: '~/Library/Application Support/Google/Chrome/Default', savedPasswords: true, signedInSync: true, doh: 'automatic', extensions: [
    ext('aaaabbbbccccddddeeeeffffgggghhhh', 'Coupon Finder Pro', ['cookies', 'webRequest', 'tabs', 'history'], ['<all_urls>'], false),
    ext('cjpalhdlnbpafiamejdnhcphjbkeiagm', 'Content blocker', ['webRequest', 'storage'], ['<all_urls>']),
    ext('nngceckbapebfimnlniiiahkandclblb', 'Password manager', ['nativeMessaging', 'clipboardRead'], ['https://*/*']),
  ] },
  { browser: 'Firefox', engine: 'firefox', profile: 'default-release', path: '~/Library/Application Support/Firefox/Profiles/abcd.default-release', savedPasswords: false, signedInSync: false, doh: 'off', extensions: [ext('ublock@x', 'uBlock Origin', ['webRequest', 'webRequestBlocking'], ['<all_urls>'])] },
  { browser: 'Safari', engine: 'webkit', profile: 'Default', path: '~/Library/Safari', savedPasswords: false, extensions: [] },
];

const apps = [
  { app: 'Google Chrome', destinations: 48, countries: ['US', 'IE', 'NL'], trackers: [{ owner: 'Google Ads', category: 'advertising' as const, host: 'googleads.g.doubleclick.net' }, { owner: 'Facebook', category: 'social' as const, host: 'connect.facebook.net' }, { owner: 'Hotjar', category: 'analytics' as const, host: 'script.hotjar.com' }], cleartext: [], bytesOut: 18_400_000 },
  { app: 'Weather Widget', destinations: 3, countries: ['US'], trackers: [{ owner: 'Mixpanel', category: 'analytics' as const, host: 'api.mixpanel.com' }, { owner: 'AppsFlyer', category: 'analytics' as const, host: 'launches.appsflyer.com' }], cleartext: [{ host: 'feeds.weatherwidget.example', port: 80, protocol: 'HTTP' }], bytesOut: 220_000 },
  { app: 'Slack', destinations: 6, countries: ['US'], trackers: [], cleartext: [], bytesOut: 1_900_000 },
];
const listeners = [{ app: 'AirPlay Receiver', port: 7000, address: '*' }, { app: 'node', port: 3000, address: '0.0.0.0' }];

const posture: Finding[] = [
  { id: 'posture.sharing.com.openssh.sshd', area: 'posture', severity: 'low', title: 'Remote Login (SSH) is on', why: 'Other computers on the network can try to sign in to this Mac. Turn it off if you do not use it.', fix: { label: 'Open Sharing settings', settings: 'x-apple.systempreferences:com.apple.Sharing-Settings.extension' } },
  { id: 'posture.roots', area: 'posture', severity: 'medium', title: '1 certificate was added to the system’s trusted list', why: 'A trusted certificate lets whoever holds it read encrypted traffic. Remove any you do not recognise.', detail: 'Proxy Inspection CA' },
  { id: 'posture.telemetry', area: 'posture', severity: 'info', title: 'Your Mac shares analytics with Apple', why: 'Crash and usage reports go to Apple. Your choice.' },
];

const persistence: PersistenceItem[] = [
  { id: 'launch-agent:~/Library/LaunchAgents/com.updater.helper.plist', kind: 'launch-agent', name: 'com.updater.helper.plist', command: '~/Library/Application Support/.helper/updater --silent', location: '~/Library/LaunchAgents/com.updater.helper.plist', signed: false, firstSeen: now - 5 * H },
  { id: 'launch-agent:~/Library/LaunchAgents/com.google.keystone.agent.plist', kind: 'launch-agent', name: 'com.google.keystone.agent.plist', command: '/Library/Google/GoogleSoftwareUpdate/…/GoogleSoftwareUpdateAgent', location: '~/Library/LaunchAgents', signed: true, signer: 'Developer ID Application: Google LLC', firstSeen: now - 60 * 24 * H },
];

let quarantine: QuarantineItem[] = [{ id: 'q1', originalPath: '~/Downloads/invoice_0931.pdf.exe', name: 'invoice_0931.pdf.exe', size: 482_304, sha256: 'e3b0…', detections: [{ engine: 'heuristic', name: 'Keeper.Heuristic.Disguised', severity: 'high', confidence: 'likely' }, { engine: 'clamav', name: 'Win.Trojan.Agent-1234', severity: 'high', confidence: 'certain' }], at: now - 3 * 24 * H }];

const events: SecurityEvent[] = [
  { id: 'e1', at: now - 5 * H, kind: 'persistence', severity: 'high', title: 'New item set to start automatically: com.updater.helper.plist', detail: '~/Library/Application Support/.helper/updater --silent · not signed' },
  { id: 'e2', at: now - 2 * H, kind: 'camera', severity: 'info', title: 'Zoom used your camera', detail: 'For 42 minutes' },
  { id: 'e3', at: now - 26 * H, kind: 'extension', severity: 'medium', title: 'Chrome extension “Coupon Finder Pro” got access to all sites' },
  { id: 'e4', at: now - 3 * 24 * H, kind: 'quarantine', severity: 'medium', title: 'invoice_0931.pdf.exe was moved to quarantine', detail: 'It is encrypted and cannot run.' },
  { id: 'e5', at: now - 3 * 24 * H, kind: 'scan', severity: 'info', title: 'Quick scan finished: 1 found', detail: '18,204 files checked' },
];

let settings: SecuritySettings = { realtime: true, autoQuarantine: true, clamavUpdates: true, hashLookups: false, behaviour: true, persistenceAlerts: true, ruleSources: [], trackerLists: [], extensionLists: [], schedule: 'weekly' };
let ignored: string[] = [];
let scans: ScanProgress[] = [{ id: 's1', kind: 'quick', state: 'done', started: now - 3 * 24 * H, ended: now - 3 * 24 * H + 140_000, files: 18_204, bytes: 9_400_000_000, detections: [], engines: ['heuristic', 'yara', 'clamav'] }];

function overview(): SecurityOverview {
  const all = normalizeFindings([
    ...posture,
    ...permissionFindings(grants),
    ...browserFindings(browsers),
    ...connectionFindings(apps, listeners),
    ...malwareFindings({ active: [], realtime: settings.realtime, engines: { clamav: { installed: true, signatureAgeDays: 1 } }, lastFullScan: now - 12 * 24 * H }),
    { id: `persist.${persistence[0].id}`, area: 'persistence', severity: 'medium', title: `New item set to start automatically: ${persistence[0].name}`, why: 'Malware often installs itself to run at every start. If you just installed something, this is probably it.', detail: `${persistence[0].command} · not signed`, fix: { label: 'Review startup items', action: 'open-startup' } },
  ]).map((f) => ({ ...f, ignored: ignored.includes(f.id) }));
  const counts = { permissions: 0, connections: 0, browsers: 0, posture: 0, malware: 0, persistence: 0 } as SecurityOverview['counts'];
  for (const f of all) if (!f.ignored && f.severity !== 'info') counts[f.area]++;
  const s = score(all);
  return {
    score: s, label: scoreLabel(s), findings: sortFindings(all), top: topActions(all), counts,
    engines: [
      { id: 'builtin', name: 'Keeper’s built-in checks', state: 'on' },
      { id: 'yara', name: 'YARA rules', state: 'on', detail: '5 rules' },
      { id: 'clamav', name: 'ClamAV signatures', state: 'on', detail: 'ClamAV 1.4.1 · signatures 27450', updated: now - 20 * H },
      { id: 'reputation', name: 'Fingerprint lookups', state: settings.hashLookups ? 'on' : 'off' },
      { id: 'xprotect', name: 'XProtect (macOS)', state: 'on', detail: 'Definitions updated 3 days ago' },
    ],
    quarantined: quarantine.length, lastScan: { kind: 'quick', at: scans[0].ended!, files: scans[0].files, found: 1 }, notes: [], checkedAt: now - 60_000,
  };
}

export function mockSecurity(emit: (ch: string, ...a: unknown[]) => void): { security: SecurityApi } {
  return {
    security: {
      overview: async () => overview(),
      permissions: async () => ({ grants, notes: [], platform: 'darwin' }),
      revoke: async (g) => ({ ok: true, message: `${g.app} will have to ask again.` }),
      browsers: async () => browsers,
      connections: async () => ({ apps, listeners, sites: [{ site: 'news.example', thirdParties: [{ host: 'securepubads.g.doubleclick.net', requests: 34, tracker: 'Google Ads' }, { host: 'cdn.taboola.com', requests: 12, tracker: 'Taboola' }, { host: 'fonts.gstatic.com', requests: 4 }], at: now - 10 * 60_000, browser: 'Chrome/130' }], extensionConnected: true }),
      installBrowserHost: async () => ({ installed: ['Chrome', 'Firefox'], extensionFolder: '/Applications/Keeper.app/Contents/Resources/app.asar.unpacked/browser-extension' }),
      persistence: async () => persistence,
      scan: async (kind) => {
        const p: ScanProgress = { id: `s${Date.now()}`, kind, state: 'running', started: Date.now(), files: 0, bytes: 0, detections: [], engines: ['heuristic', 'yara', 'clamav'] };
        let n = 0;
        const t = setInterval(() => {
          n++;
          p.files += 900;
          p.bytes += 420_000_000;
          p.current = `~/Downloads/file-${n}.zip`;
          if (n >= 8) {
            clearInterval(t);
            p.state = 'done';
            p.ended = Date.now();
            p.current = undefined;
            scans = [{ ...p }, ...scans];
          }
          emit('security-scan', { ...p });
        }, 500);
        return p;
      },
      stopScan: async () => undefined,
      scans: async () => scans,
      quarantine: async () => quarantine,
      quarantineFile: async (p) => quarantine[0] ?? ({ id: 'x', originalPath: p, name: p, size: 0, sha256: '', detections: [], at: Date.now() }),
      restore: async (id) => {
        const it = quarantine.find((x) => x.id === id)!;
        quarantine = quarantine.filter((x) => x.id !== id);
        return { path: it.originalPath };
      },
      deleteQuarantined: async (id) => { quarantine = quarantine.filter((x) => x.id !== id); },
      events: async (limit = 200) => events.slice(0, limit),
      settings: async () => settings,
      setSettings: async (p) => (settings = { ...settings, ...p }),
      ignore: async (id, on) => { ignored = on ? [...ignored, id] : ignored.filter((x) => x !== id); },
      fix: async () => ({ ok: true, message: 'Opened the right settings page.' }),
      installClamav: async () => ({ ok: true, message: 'ClamAV installed.' }),
      updateSignatures: async () => ({ ok: true, message: 'Signatures are up to date.' }),
      checkPassword: async (pw) => ({ count: pw === 'password' ? 10_434_004 : 0 }),
      exportReport: async () => null,
    },
  };
}
