// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes in the browser demo: a Mac with a full Trash, FileVault off,
// old phone backups and no backup yet — built with the same checkers as the app.

import type { GuideApi, GuideList } from '../core/api-guide';
import { mergeFindings, summarize, trustState, verifyResult } from '../core/guide/aggregate';
import { backupFindings, FLOWS, flowAsFinding, protectionFindings, searchHowTo, spaceFindings, startupFindings } from '../core/guide/builtin';
import type { Finding, FindingDetails, FindingState } from '../core/guide/types';
import { extensionPageUrl, extensionStoreUrl, permissionMeaning, scoreExtension } from '../core/security/browsers';
import { addedRootsFindings } from '../core/security/posture';
import { browserFindings, persistenceFindings } from '../core/security/score';
import type { Finding as SecFinding } from '../core/security/types';

const GB = 1024 ** 3;
const DAY = 86_400_000;

/** The demo Mac's security findings: added certificates, extensions with broad access and new login items. */
function securityDemo(gone: Set<string>): Finding[] {
  const ext = (id: string, name: string, version: string, permissions: string[], hostPermissions: string[]) => ({ id, name, version, enabled: true, permissions, hostPermissions, fromStore: true, ...scoreExtension({ id, permissions, hostPermissions, fromStore: true }) });
  const sec: SecFinding[] = [
    ...addedRootsFindings([
      { name: 'Corp Proxy Inspection CA', sha1: '3A1F00C2B9E4D7A6F1C0B2E3D4A5968778695A4B', store: '/Library/Keychains/System.keychain' },
      { name: 'mkcert development CA', sha1: '7C2E91AA0B3D5F6E7D8C9B0A1F2E3D4C5B6A7980', store: '/Library/Keychains/System.keychain' },
      { name: 'Charles Proxy CA', sha1: 'B4D6E8F0A2C4E6081A3C5E7F9B1D3F5A7C9E0B2D', store: '/Library/Keychains/System.keychain' },
    ]),
    ...browserFindings([
      { browser: 'Brave', engine: 'chromium', profile: 'Personal', path: '/Users/demo/Library/Application Support/BraveSoftware/Brave-Browser/Default', savedPasswords: false, extensions: [ext('llangkpnndilncfkpgcpolnmgjgnompo', 'Tab Session Manager', '6.12.2', ['tabs', 'storage', 'scripting'], ['<all_urls>']), ext('bmjmipppabdlpjccanalncobmbacckjn', 'Video Downloader Professional', '1.5.3', ['downloads', 'webRequest'], ['<all_urls>'])] },
      { browser: 'Chrome', engine: 'chromium', profile: 'Work', path: '/Users/demo/Library/Application Support/Google/Chrome/Default', savedPasswords: false, extensions: [ext('ddkjiahejlhfcafbddmgiahcphecmpfh', 'uBlock Origin Lite', '2024.11.25', ['declarativeNetRequest', 'scripting'], ['<all_urls>']), ext('jjhefcfhmnkfeepcpnilbbkaadhngkbi', 'Readwise Highlighter', '0.17.1', ['contextMenus', 'storage', 'scripting'], ['<all_urls>'])] },
    ]),
    ...persistenceFindings([
      { id: 'launch-agent:/Users/demo/Library/LaunchAgents/actions.runner.ashfordeOU-arksa.arksa-mac-1.plist', kind: 'launch-agent', name: 'actions.runner.ashfordeOU-arksa.arksa-mac-1.plist', command: '/Users/demo/actions-runner/runsvc.sh', location: '/Users/demo/Library/LaunchAgents/actions.runner.ashfordeOU-arksa.arksa-mac-1.plist', signed: false, codeHash: 'a41c9e0f', firstSeen: Date.now() - 2 * DAY },
      { id: 'launch-daemon:/Library/LaunchDaemons/com.docker.socket.plist', kind: 'launch-daemon', name: 'com.docker.socket.plist', command: '/Library/PrivilegedHelperTools/com.docker.socket', location: '/Library/LaunchDaemons/com.docker.socket.plist', signed: true, signer: 'Developer ID Application: Docker Inc (9BNSXJN65R)', team: '9BNSXJN65R', firstSeen: Date.now() - 3 * DAY },
      { id: 'launch-agent:/Users/demo/Library/LaunchAgents/com.updater.helper.plist', kind: 'launch-agent', name: 'com.updater.helper.plist', command: '/Users/demo/Library/Application Support/.helper/updater --silent', location: '/Users/demo/Library/LaunchAgents/com.updater.helper.plist', signed: false, codeHash: '9f8e7d6c', firstSeen: Date.now() - 5 * 3600_000 },
    ], new Set()),
  ];
  return sec.filter((f) => !gone.has(`security:${f.id}`)).map((f) => ({
    id: `security:${f.id}`, source: 'security', area: f.area === 'browsers' ? 'privacy' : 'security', severity: f.severity, title: f.title, why: f.why, detail: f.detail,
    subject: f.subject, group: f.group, confidence: f.confidence, learnMore: f.learnMore,
    fix: f.subject?.kind === 'extension' ? { kind: 'auto', action: 'fixit.extension', label: `Remove it in ${f.subject.browser}` } : f.subject?.kind === 'certificate' ? { kind: 'auto', action: 'fixit.certificate', label: 'Remove it', needsAdmin: true } : { kind: 'auto', action: 'fixit.login-item', label: 'Turn it off', needsAdmin: f.subject?.kind === 'login-item' && f.subject.where === 'launch-daemon' },
  }));
}

/** Details as the app gathers them, from what the demo knows. */
function demoDetails(f: Finding): FindingDetails {
  const s = f.subject;
  const sections: FindingDetails['sections'] = [];
  if (s?.kind === 'login-item') {
    sections.push({ title: 'What was found', rows: [{ label: 'Name', value: s.tool ? s.tool.name : s.name }, { label: 'Label', value: s.label ?? s.name, mono: true }, { label: 'File', value: s.path, mono: true }, { label: 'Runs', value: s.program ?? '', mono: true }, { label: 'Starts at login', value: 'Yes (RunAtLoad)' }, { label: 'Kept running', value: 'Yes, restarted if it stops (KeepAlive)' }, { label: 'First noticed', value: new Date(s.firstSeen ?? Date.now()).toLocaleString() }] });
    sections.push({ title: 'Who made it', rows: s.signed ? [{ label: 'Signed by', value: s.signer?.replace(/^Developer ID Application: /, '').replace(/ \(\w+\)$/, '') ?? '' }, { label: 'Developer team', value: s.team ?? '' }, { label: 'Checked by Apple (notarized)', value: 'Yes' }] : [{ label: 'Signed', value: 'No — Keeper cannot tell who made it' }] });
    sections.push({ title: 'The file’s contents', rows: [], mono: true, text: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${s.label}</string>\n  <key>ProgramArguments</key><array><string>${s.program}</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict>\n</plist>` });
  } else if (s?.kind === 'extension') {
    const store = extensionStoreUrl(s.browser, s.id, s.fromStore);
    sections.push({ title: 'The extension', rows: [{ label: 'Name', value: s.name }, { label: 'Version', value: s.version ?? '' }, { label: 'ID', value: s.id, mono: true }, { label: 'Browser', value: s.browser }, { label: 'Profile', value: s.profile }, ...(store ? [{ label: 'Store page', value: store, url: store }] : []), { label: 'Its page in the browser', value: extensionPageUrl(s.browser, s.id), mono: true }] });
    sections.push({ title: 'What it may do', rows: [...s.hostPermissions, ...s.permissions].map((p) => ({ label: p, value: permissionMeaning(p) })) });
  } else if (s?.kind === 'certificate') {
    sections.push({ title: 'The certificate', rows: [{ label: 'Name', value: s.name }, { label: 'Subject', value: `CN=${s.name}` }, { label: 'Issued by', value: `CN=${s.name}` }, { label: 'Valid until', value: new Date(Date.now() + 400 * DAY).toLocaleDateString() }, { label: 'SHA-1 fingerprint', value: s.sha1 ?? '', mono: true }, { label: 'Kept in', value: s.store, mono: true }] });
  } else if (f.detail) sections.push({ title: 'What was found', rows: [{ label: 'Details', value: f.detail }] });
  const conf = { sure: 'Keeper is sure this needs doing.', likely: 'Probably worth a look.', unsure: 'Often fine: Keeper lists it so nothing changes without you knowing.' } as const;
  return { sections, why: f.why, confidence: f.confidence ? conf[f.confidence] : undefined, learnMore: f.learnMore ? { label: 'Learn more', url: 'https://github.com/ashfordeOU/keeper/blob/main/docs/GUIDE.md' } : undefined, actions: { reveal: s?.kind === 'login-item' || (s?.kind === 'certificate' && !!s.file), extensionPage: s?.kind === 'extension' ? s.browser : undefined } };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockGuide(emit: (channel: string, ...args: unknown[]) => void): { guide: GuideApi } {
  let trash = { bytes: 6.4 * GB, count: 212 };
  let fileVault: 'off' | 'ok' = 'off';
  let startupOff = false;
  const states: Record<string, FindingState> = {};
  const gone = new Set<string>();
  const checkedAt = Date.now() - 4 * 60_000;

  const found = (): Finding[] => [
    ...spaceFindings({ platform: 'darwin', disk: { free: 21 * GB, total: 494 * GB }, trash, phoneBackups: { bytes: 38 * GB, count: 3 }, oldVideos: { bytes: 24 * GB, count: 11 } }),
    ...protectionFindings([{ id: 'filevault', name: 'FileVault', description: 'Encrypts your disk so a lost Mac does not leak your files.', status: fileVault }, { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: 'off' }], 'darwin'),
    ...startupFindings(startupOff ? [] : ['Dropbox', 'Teams', 'Adobe Creative Cloud'].map((n) => ({ id: n, name: n, enabled: true, impact: 'high', scope: 'user' }))),
    ...backupFindings({ jobs: 0 }),
    ...securityDemo(gone),
  ];
  const list = (): GuideList => {
    const findings = mergeFindings(found(), states);
    return { findings, summary: summarize(findings, checkedAt), checkedAt, platform: 'darwin' };
  };
  const changed = () => emit('guide-changed', list().summary);
  const get = (id: string) => {
    if (id.startsWith('flow:')) {
      const flow = FLOWS.find((f) => `flow:${f.id}` === id);
      const f = flow && flowAsFinding(flow, 'darwin');
      return f ? { ...f, state: {}, status: 'open' as const } : null;
    }
    return list().findings.find((f) => f.id === id) ?? null;
  };

  const guide: GuideApi = {
    list: async () => list(),
    refresh: async () => { await wait(500); changed(); return list(); },
    summary: async () => list().summary,
    setState: async (id, patch) => { if (patch === null) delete states[id]; else states[id] = { ...states[id], ...patch }; changed(); return list(); },
    setStates: async (ids, patch) => { for (const id of ids) { if (patch === null) delete states[id]; else states[id] = { ...states[id], ...patch }; } changed(); return list(); },
    trust: async (ids) => { for (const id of ids) { const f = list().findings.find((x) => x.id === id); if (f) states[id] = trustState(f, states[id]); } changed(); return list(); },
    untrust: async (id) => { const { trusted: _t, ...rest } = states[id] ?? {}; states[id] = rest; changed(); return list(); },
    details: async (id) => { await wait(200); const f = list().findings.find((x) => x.id === id); return f ? demoDetails(f) : null; },
    reveal: async () => ({ ok: true }),
    preview: async (id) => {
      await wait(250);
      const sf = list().findings.find((x) => x.id === id);
      if (sf?.subject?.kind === 'login-item') return { summary: `Keeper stops it and moves ${sf.subject.name} to the Trash, so it no longer starts by itself. A copy of the file is kept, so Undo puts it back and starts it again.`, items: [{ label: sf.subject.path }, { label: sf.subject.program ?? '', detail: 'what it runs (left in place)' }], undoable: true, needsAdmin: sf.subject.where === 'launch-daemon' };
      if (sf?.subject?.kind === 'certificate') return { summary: `Keeper removes “${sf.subject.name}” from the System keychain. A copy is kept, so Undo adds it back.`, items: [{ label: sf.subject.name, detail: `SHA-1 ${sf.subject.sha1}` }], undoable: true, needsAdmin: true };
      if (sf?.subject?.kind === 'extension') return { summary: `Keeper opens ${sf.subject.browser} at the page for “${sf.subject.name}”. Press Remove there: browsers only let you remove extensions yourself.`, items: [{ label: sf.subject.name }], undoable: false, opensOnly: true };
      if (id === 'space:trash') return { summary: `${trash.count} items (${(trash.bytes / GB).toFixed(1)} GB) will be deleted for good.`, items: ['Old project export.zip', 'Screen Recording 2026-03-02.mov', 'IMG_4410.HEIC', 'Invoice draft.pages'].map((label) => ({ label })), bytes: trash.bytes, undoable: false };
      return { summary: '3 apps will no longer open by themselves when you sign in. They stay installed.', items: ['Dropbox', 'Teams', 'Adobe Creative Cloud'].map((label) => ({ label })), undoable: true };
    },
    apply: async (id) => {
      await wait(700);
      if (id === 'space:trash') trash = { bytes: 0, count: 0 };
      if (id === 'performance:startup') startupOff = true;
      if (id.startsWith('security:') && !id.includes('browser.ext')) gone.add(id);
      if (id.includes('browser.ext')) return { ok: true, message: 'Opened the browser at the extension. Press Remove there if you do not need it.', pending: true };
      states[id] = { doneAt: Date.now() };
      changed();
      return { ok: true, message: id === 'space:trash' ? 'The Trash is empty.' : id.startsWith('security:') ? 'Done. A copy is kept for Undo.' : '3 apps will no longer start by themselves.', undoable: id === 'performance:startup' || id.startsWith('security:') };
    },
    undo: async (id) => { if (id === 'performance:startup') startupOff = false; gone.delete(id); delete states[id]; changed(); return { ok: true, message: 'Put back.' }; },
    open: async (t) => ({ ok: true, label: t.topic ?? 'System Settings' }),
    verify: async (id) => {
      await wait(600);
      // In the demo, turning FileVault on "works" the second time it is checked.
      if (id === 'protection:filevault') fileVault = 'ok';
      const r = verifyResult(id, found());
      if (r === 'done') states[id] = { doneAt: Date.now() };
      changed();
      return r;
    },
    mini: async () => undefined,
    flows: async () => FLOWS,
    get: async (id) => get(id),
    howTo: async (q) => searchHowTo(q).slice(0, 8).map(({ flow }) => ({ id: `flow:${flow.id}`, title: flow.title, area: flow.area })),
    explain: async (_id, mode) => { await wait(500); return { ok: true, text: mode === 'explain' ? 'In the demo there is no AI connected. In Keeper, the AI you chose explains this in plain words — the steps work without it.' : '1. Open System Settings.\n2. Go to Privacy & Security.\n3. Scroll to FileVault and press Turn On…' }; },
    focus: () => undefined,
  };
  return { guide };
}
