// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own findings and guided flows, built from what its checkers know.
// Pure: the Electron side gathers the facts and passes them in.

import { formatBytes } from '../format';
import type { Area, Finding, Fix, GuideFlow, GuideStep } from './types';

export type Platform = 'darwin' | 'win32' | 'linux';
const GB = 1024 ** 3;

const s = (text: string, extra: Partial<GuideStep> = {}): GuideStep => ({ text, ...extra });

// ---------------------------------------------------------------- space and storage

export interface SpaceFacts {
  platform: Platform;
  disk?: { free: number; total: number };
  trash?: { bytes: number; count: number };
  /** phone backups kept on this computer */
  phoneBackups?: { bytes: number; count: number };
  /** big videos not opened for months */
  oldVideos?: { bytes: number; count: number };
  /** Windows Storage Sense switched on (undefined when unknown) */
  storageSense?: boolean;
  /** bytes the last Clean Up scan found */
  cleanable?: number;
  /** a Trash smaller than this is not worth a mention (default 1 GB) */
  trashMin?: number;
}

export function spaceFindings(f: SpaceFacts): Finding[] {
  const out: Finding[] = [];
  const src = 'space';
  if (f.disk && f.disk.total > 0) {
    const pct = f.disk.free / f.disk.total;
    if (pct < 0.1 || f.disk.free < 15 * GB) {
      out.push({
        id: 'space:low', source: src, area: 'space', severity: pct < 0.05 || f.disk.free < 5 * GB ? 'critical' : 'high',
        title: `Only ${formatBytes(f.disk.free)} free on this disk`,
        why: 'A nearly full disk makes the computer slow, stops updates from installing and can make apps lose work when they cannot save.',
        impact: f.cleanable ? `Clean Up can free about ${formatBytes(f.cleanable)}` : undefined, impactBytes: f.cleanable,
        fix: { kind: 'page', route: { name: 'cleanup' }, label: 'Open Clean Up', steps: [s('Press Scan to see caches, old installers and leftovers that are safe to remove.'), s('Tick what you want gone and press Clean Up. Your own files go to the Trash, so nothing is lost by mistake.'), s('Then look at Space Map for the biggest folders.')] },
      });
    }
  }
  if (f.trash && f.trash.bytes > (f.trashMin ?? GB)) {
    out.push({
      id: 'space:trash', source: src, area: 'space', severity: f.trash.bytes > 10 * GB ? 'medium' : 'low',
      title: `The ${f.platform === 'win32' ? 'Recycle Bin' : 'Trash'} holds ${formatBytes(f.trash.bytes)}`,
      why: 'Files in the Trash still take up space until it is emptied.',
      impact: `frees ${formatBytes(f.trash.bytes)}`, impactBytes: f.trash.bytes,
      fix: { kind: 'auto', action: 'emptyTrash', label: `Empty the ${f.platform === 'win32' ? 'Recycle Bin' : 'Trash'}` },
    });
  }
  if (f.phoneBackups && f.phoneBackups.bytes > 2 * GB) {
    out.push({
      id: 'space:phone-backups', source: src, area: 'storage', severity: 'low',
      title: `${f.phoneBackups.count} phone backup${f.phoneBackups.count === 1 ? '' : 's'} use ${formatBytes(f.phoneBackups.bytes)}`,
      why: 'Old iPhone and iPad backups stay on the computer after you replace or restore the device.',
      impact: `up to ${formatBytes(f.phoneBackups.bytes)}`, impactBytes: f.phoneBackups.bytes,
      fix: f.platform === 'darwin'
        ? { kind: 'open', link: 'storage', label: 'Open Storage', steps: [s('In {term:mac.storage}, press the ⓘ next to “iOS Files”.'), s('Select backups of devices you no longer have and press Delete.'), s('Keep the newest backup of each device you still use.')] }
        : { kind: 'manual', steps: [s('Open the Apple Devices app (or iTunes) → Edit → Preferences → Devices.'), s('Select backups of devices you no longer have and press Delete Backup.')] },
    });
  }
  if (f.oldVideos && f.oldVideos.bytes > 5 * GB) {
    out.push({
      id: 'space:old-videos', source: src, area: 'storage', severity: 'low',
      title: `${f.oldVideos.count} big videos you have not opened for months (${formatBytes(f.oldVideos.bytes)})`,
      why: 'Moving them to an external drive or a cloud folder frees room without losing them.',
      impact: `up to ${formatBytes(f.oldVideos.bytes)}`, impactBytes: f.oldVideos.bytes,
      fix: { kind: 'page', route: { name: 'large', q: 'videos over 1 GB not opened in 6 months' }, label: 'Show them', steps: [s('Select the videos you want to keep elsewhere.'), s('Drag them onto an external drive or a cloud folder in the sidebar, or right-click → Move to…'), s('After the copy finishes, move the originals to the Trash.')] },
    });
  }
  if (f.platform === 'win32' && f.storageSense === false) {
    out.push({
      id: 'space:storage-sense', source: src, area: 'storage', severity: 'low',
      title: 'Storage Sense is off',
      why: 'Windows can empty the Recycle Bin and temporary files on a schedule so the disk does not fill up.',
      fix: { kind: 'open', link: 'storageSense', label: 'Open Storage Sense', steps: [s('Turn on {term:win.storageSense}.', { diagram: 'settings-toggle', term: 'win.storageSense' }), s('Under “Cleanup of temporary files”, keep it on; choose how long files may stay in the Recycle Bin.')] },
    });
  }
  return out;
}

// ---------------------------------------------------------------- the system's own protection

export interface ProtectionFact { id: string; name: string; description: string; status: 'ok' | 'warn' | 'off' | 'unknown'; detail?: string; fix?: string }

/** How to turn each built-in protection on, per system. */
function protectionFix(id: string, platform: Platform, hint?: string): Fix {
  const manual = (text?: string): Fix => ({ kind: 'manual', steps: [s(text ?? hint ?? 'Open your system settings and turn it on.')] });
  if (platform === 'darwin') {
    switch (id) {
      case 'filevault': return { kind: 'open', link: 'encryption', label: 'Open FileVault', steps: [s('Next to {term:mac.fileVault}, press {term:mac.turnOn}.', { diagram: 'settings-button', term: 'mac.fileVault' }), s('Choose how to unlock if you forget your password: your Apple Account or a recovery key. If you choose a key, write it down somewhere safe — not on this Mac.'), s('Encryption runs in the background; you can keep working.')] };
      case 'firewall': return { kind: 'open', link: 'firewall', label: 'Open Firewall', steps: [s('Turn on {term:mac.firewall}.', { diagram: 'settings-toggle', term: 'mac.firewall' }), s('Optional: Options… → turn on “Stealth mode” so your Mac does not answer probes on public networks.')] };
      case 'gatekeeper': return { kind: 'open', link: 'security', label: 'Open Privacy & Security', steps: [s('Scroll to Security. Under “Allow applications from”, choose “App Store and identified developers”.', { diagram: 'settings-list', term: 'mac.privacySecurity' })] };
      case 'updates': return { kind: 'open', link: 'updates', label: 'Open Software Update', steps: [s('Press the ⓘ next to “Automatic updates”.'), s('Turn on “Install Security Responses and system files”.', { diagram: 'settings-toggle' })] };
      case 'sip': case 'xprotect': return manual('This is part of macOS and is normally always on. If it shows off, restart the Mac; if it stays off, ask whoever set up this Mac — it can only be changed from Recovery.');
    }
  }
  if (platform === 'win32') {
    switch (id) {
      case 'defender': case 'realtime': case 'signatures': return { kind: 'open', link: 'security', label: 'Open Windows Security', steps: [s('Open “Virus & threat protection”.'), s('Under “Virus & threat protection settings” press Manage settings and turn Real-time protection on.', { diagram: 'settings-toggle' }), s('Under “Virus & threat protection updates” press Protection updates → Check for updates.')] };
      case 'firewall': return { kind: 'open', link: 'firewall', label: 'Open Firewall & network protection', steps: [s('For each network marked “off”, open it and turn Microsoft Defender Firewall on.', { diagram: 'settings-toggle', term: 'win.firewall' })] };
      case 'bitlocker': return { kind: 'open', link: 'encryption', label: 'Open Device encryption', steps: [s('Turn on {term:win.deviceEncryption}.', { diagram: 'settings-toggle', term: 'win.deviceEncryption' }), s('If the page is missing, search Start for “Manage BitLocker” (Pro editions) and turn BitLocker on for the C: drive. Save the recovery key to your Microsoft account or print it.')] };
      case 'updates': return { kind: 'open', link: 'updates', label: 'Open Windows Update', steps: [s('Press “Check for updates” and install what is offered.'), s('Under Advanced options, keep updates from pausing for long periods.')] };
      case 'smartscreen': return { kind: 'open', link: 'security', label: 'Open Windows Security', steps: [s('Open “App & browser control” → Reputation-based protection settings and turn the switches on.', { diagram: 'settings-toggle' })] };
      case 'uac': return manual('Search Start for “Change User Account Control settings” and move the slider back to the default (third notch).');
    }
  }
  if (platform === 'linux') {
    switch (id) {
      case 'firewall': return { kind: 'manual', steps: [s('Open a terminal and run: sudo ufw enable (Ubuntu, Debian, Mint).'), s('On Fedora and others with firewalld: sudo systemctl enable --now firewalld.'), s('Keeper’s Terminal can run it for you: Terminal → paste the command.')] };
      case 'updates': return { kind: 'manual', steps: [s('Debian, Ubuntu: sudo apt install unattended-upgrades && sudo dpkg-reconfigure unattended-upgrades.'), s('Fedora: sudo dnf install dnf-automatic && sudo systemctl enable --now dnf-automatic-install.timer.')] };
      case 'encryption': return manual('Full-disk encryption is chosen when Linux is installed. To protect files now, use Keeper’s Locked folders for what matters most.');
    }
  }
  return manual();
}

export function protectionFindings(checks: ProtectionFact[], platform: Platform): Finding[] {
  return checks
    .filter((c) => c.status === 'off' || c.status === 'warn')
    .map((c): Finding => ({
      id: `protection:${c.id}`, source: 'protection', area: 'security',
      severity: c.status === 'off' ? (['filevault', 'bitlocker', 'encryption', 'firewall', 'defender', 'realtime'].includes(c.id) ? 'high' : 'medium') : 'low',
      title: `${c.name}: ${c.status === 'off' ? 'off' : 'only partly on'}`,
      why: c.description + (c.detail ? ` (${c.detail})` : ''),
      fix: protectionFix(c.id, platform, c.fix),
    }));
}

// ---------------------------------------------------------------- the rest of Keeper

export function updateFindings(u: { state: string; version?: string; method?: string; manager?: { command?: string } } | undefined): Finding[] {
  if (!u || (u.state !== 'available' && u.state !== 'ready')) return [];
  return [{
    id: 'updates:keeper', source: 'updates', area: 'updates', severity: 'medium',
    title: u.state === 'ready' ? `Keeper ${u.version} is ready to install` : `Keeper ${u.version} is available`,
    why: 'Updates bring fixes, including security fixes.',
    fix: u.method === 'manager' && u.manager?.command
      ? { kind: 'manual', steps: [s(`Keeper was installed with a package manager. Run: ${u.manager.command}`)] }
      : { kind: 'page', route: { name: 'settings', arg: 'updates' }, label: 'Open Updates', steps: [s(u.state === 'ready' ? 'Press “Restart and update”, or choose Later to pick a time.' : 'Press Download and install.')] },
  }];
}

export function startupFindings(items: { id: string; name: string; enabled: boolean; impact: string; scope: string }[]): Finding[] {
  const heavy = items.filter((i) => i.enabled && i.impact === 'high' && i.scope === 'user');
  if (heavy.length < 2) return [];
  return [{
    id: 'performance:startup', source: 'startup', area: 'performance', severity: heavy.length >= 4 ? 'medium' : 'low',
    title: `${heavy.length} heavy apps start when you sign in`,
    why: 'Each one slows start-up and keeps using memory in the background, even when you do not need it.',
    fix: { kind: 'auto', action: 'disableHeavyStartup', label: 'Stop them starting by themselves' },
  }];
}

export function backupFindings(b: { jobs: number; check321?: { ok: boolean; copies: number; kinds: number; offsite: boolean; advice: string[] }; testDue?: number }): Finding[] {
  const out: Finding[] = [];
  if (b.jobs === 0) {
    out.push({
      id: 'backup:none', source: 'backup', area: 'backup', severity: 'high',
      title: 'Nothing is backed up',
      why: 'A broken disk, theft or a mistake can lose files for good. A backup keeps a second copy somewhere else.',
      fix: { kind: 'page', route: { name: 'sync', arg: 'backups' }, label: 'Set up a backup', steps: [s('Press “New backup”.'), s('Choose what to keep safe (Documents, Pictures, Desktop…).'), s('Choose where: an external drive, a NAS, or a cloud service you connected.'), s('Write down the recovery key Keeper shows — it is the only way back in if you forget the password.')] },
    });
  } else if (b.check321 && !b.check321.ok) {
    out.push({
      id: 'backup:321', source: 'backup', area: 'backup', severity: 'medium',
      title: 'Backups could be safer',
      why: `The 3-2-1 rule: three copies, on two kinds of storage, one away from home. Now: ${b.check321.copies} cop${b.check321.copies === 1 ? 'y' : 'ies'}, ${b.check321.kinds} kind${b.check321.kinds === 1 ? '' : 's'}${b.check321.offsite ? ', one away from home' : ', none away from home'}.`,
      fix: { kind: 'page', route: { name: 'sync', arg: 'backups' }, label: 'Open Backups', steps: b.check321.advice.map((a) => s(a)) },
    });
  }
  if (b.testDue) {
    out.push({
      id: 'backup:test', source: 'backup', area: 'backup', severity: 'low',
      title: `${b.testDue} backup${b.testDue === 1 ? ' has' : 's have'} not been test-restored for a while`,
      why: 'A backup you have never restored from might not work when you need it.',
      fix: { kind: 'page', route: { name: 'sync', arg: 'backups' }, label: 'Test a restore', steps: [s('Open the backup and press Restore → pick one file → restore it to a new folder.'), s('Open the restored file to check it.')] },
    });
  }
  return out;
}

export function networkFindings(v: { vpnUp: boolean; v6Leak: boolean; dnsOutside: string[] } | undefined): Finding[] {
  if (!v?.vpnUp) return [];
  const out: Finding[] = [];
  if (v.v6Leak) out.push({
    id: 'network:v6-leak', source: 'network', area: 'network', severity: 'high',
    title: 'Some traffic goes around your VPN (IPv6)',
    why: 'Websites that use IPv6 can see your real address even though the VPN is on.',
    fix: { kind: 'page', route: { name: 'vpn' }, label: 'Open VPN', steps: [s('Turn on your VPN app’s “block IPv6” or “kill switch” option, or turn IPv6 off for this network while you use the VPN.'), s('Then press “Check again” on Keeper’s VPN page.')] },
  });
  if (v.dnsOutside.length) out.push({
    id: 'network:dns-leak', source: 'network', area: 'privacy', severity: 'medium',
    title: 'Website look-ups go around your VPN (DNS)',
    why: `Your internet provider can see which sites you visit: look-ups go to ${v.dnsOutside.join(', ')} outside the VPN.`,
    fix: { kind: 'page', route: { name: 'vpn' }, label: 'Open VPN', steps: [s('In your VPN app, turn on “use VPN DNS” or “prevent DNS leaks”.'), s('Then press “Check again” on Keeper’s VPN page.')] },
  });
  return out;
}

export function lockFindings(unlocked: { path: string; since?: number }[], now = Date.now()): Finding[] {
  const long = unlocked.filter((u) => u.since && now - u.since > 3600_000);
  if (!long.length) return [];
  return [{
    id: 'privacy:unlocked', source: 'lock', area: 'privacy', severity: 'low',
    title: `${long.length} locked folder${long.length === 1 ? ' has' : 's have'} been open for over an hour`,
    why: 'While unlocked, anyone using this computer can read them.',
    fix: { kind: 'auto', action: 'relockFolders', label: 'Lock them again' },
  }];
}

// ---------------------------------------------------------------- guided flows ("How do I…?")

const open = (link: string, steps: GuideStep[], label?: string): Fix => ({ kind: 'open', link, steps, label });

export const FLOWS: GuideFlow[] = [
  { id: 'free-space', title: 'Free up space', area: 'space', why: 'Caches, the Trash, old downloads and big forgotten files are usually the quickest wins.',
    fix: { all: { kind: 'page', route: { name: 'cleanup' }, label: 'Open Clean Up', steps: [s('Press Scan.'), s('Tick what you want gone (all safe by default) and press Clean Up.'), s('Then open Space Map to see which folders are biggest, and Duplicates for copies.')] } } },
  { id: 'camera-access', title: 'Stop apps using my camera', area: 'privacy', why: 'Only apps you trust should be able to turn your camera on.',
    fix: {
      darwin: open('camera', [s('In {term:mac.camera}, switch off apps that should not use it.', { diagram: 'settings-toggle', term: 'mac.camera' })], 'Open Camera settings'),
      win32: open('camera', [s('Turn off “Let apps access your camera” for apps that should not use it.', { diagram: 'settings-toggle', term: 'win.camera' }), s('Desktop apps are listed at the bottom; they can only be turned off together.')], 'Open Camera settings'),
      linux: open('camera', [s('Turn off camera access for apps that should not use it (Flatpak apps are listed separately).', { diagram: 'settings-toggle' })], 'Open Camera settings'),
    } },
  { id: 'microphone-access', title: 'Stop apps using my microphone', area: 'privacy', why: 'Only apps you trust should hear you.',
    fix: {
      darwin: open('microphone', [s('In {term:mac.microphone}, switch off apps that should not use it.', { diagram: 'settings-toggle', term: 'mac.microphone' })]),
      win32: open('microphone', [s('Turn off microphone access for apps that should not use it.', { diagram: 'settings-toggle', term: 'win.microphone' })]),
      linux: open('microphone', [s('Turn off microphone access for apps that should not use it.', { diagram: 'settings-toggle' })]),
    } },
  { id: 'screen-access', title: 'See which apps can record my screen', area: 'privacy', why: 'Screen recording can see everything you see, including passwords as you type them.',
    fix: { darwin: open('screen', [s('In {term:mac.screenRecording}, switch off apps you do not use for calls or recordings.', { diagram: 'settings-toggle', term: 'mac.screenRecording' })]), win32: open('screen', [s('Turn off apps that should not take screenshots of other windows.', { diagram: 'settings-toggle' })]), linux: open('screen', [s('Screen sharing asks each time on Wayland. Under X11, any app can capture the screen — prefer a Wayland session.')]) } },
  { id: 'encrypt-disk', title: 'Encrypt my disk', area: 'security', why: 'If the computer is lost or stolen, nobody can read your files without your password.',
    fix: {
      darwin: protectionFix('filevault', 'darwin'),
      win32: protectionFix('bitlocker', 'win32'),
      linux: protectionFix('encryption', 'linux'),
    } },
  { id: 'turn-on-firewall', title: 'Turn on the firewall', area: 'security', why: 'It blocks connections from outside that you did not ask for.',
    fix: { darwin: protectionFix('firewall', 'darwin'), win32: protectionFix('firewall', 'win32'), linux: protectionFix('firewall', 'linux') } },
  { id: 'backup-photos', title: 'Back up my photos', area: 'backup', why: 'Photos are often the one thing that cannot be replaced.',
    fix: { all: { kind: 'page', route: { name: 'sync', arg: 'backups' }, label: 'Open Backups', steps: [s('Press “New backup” and choose Pictures.'), s('Choose a drive, a NAS or a connected cloud service.'), s('Keep the recovery key Keeper shows somewhere safe.')] } } },
  { id: 'block-trackers', title: 'Block trackers and ads', area: 'privacy', why: 'Trackers follow you across sites and apps to build a profile of you.',
    fix: { all: { kind: 'page', route: { name: 'netactivity' }, label: 'Open Network Activity', steps: [s('See which apps talk to tracking and advertising servers.'), s('Turn on blocklists in the firewall settings (where available) to stop them for every app.')] } } },
  { id: 'startup-apps', title: 'Stop apps opening at start-up', area: 'performance', why: 'Fewer apps at sign-in means a faster start and more free memory.',
    fix: { all: { kind: 'page', route: { name: 'startup' }, label: 'Open Startup Items', steps: [s('Switch off what you do not need right after signing in.'), s('System items need your password; leave those you do not recognise until you have checked them.')] } } },
  { id: 'storage-optimise', title: 'Let the system clear space by itself', area: 'storage', why: 'The system can empty the Trash and temporary files on a schedule.',
    fix: {
      darwin: open('storage', [s('Under Recommendations, turn on {term:mac.optimizeStorage} and “Empty Trash Automatically”.', { diagram: 'settings-button', term: 'mac.optimizeStorage' })]),
      win32: open('storageSense', [s('Turn on {term:win.storageSense}.', { diagram: 'settings-toggle', term: 'win.storageSense' })]),
      linux: open('storage', [s('Turn on “Automatically delete trash content” and “Automatically delete temporary files”.', { diagram: 'settings-toggle' })]),
    } },
  { id: 'lock-folder', title: 'Lock a private folder', area: 'privacy', why: 'Locked folders are encrypted; only you can open them, with your password, Touch ID or Windows Hello.',
    fix: { all: { kind: 'page', route: { name: 'browse' }, label: 'Open Browse', steps: [s('Right-click the folder → Lock Folder…'), s('Choose how to unlock it, then save the recovery key somewhere safe.')] } } },
  { id: 'software-updates', title: 'Keep the system up to date', area: 'updates', why: 'Most attacks use holes that updates have already fixed.',
    fix: { darwin: protectionFix('updates', 'darwin'), win32: protectionFix('updates', 'win32'), linux: protectionFix('updates', 'linux') } },
];

export function flowFix(flow: GuideFlow, platform: Platform): Fix | undefined {
  return flow.fix[platform] ?? flow.fix.all;
}

/** A guided flow as a finding, so the same panel shows both. */
export function flowAsFinding(flow: GuideFlow, platform: Platform): Finding | undefined {
  const fix = flowFix(flow, platform);
  return fix ? { id: `flow:${flow.id}`, source: 'flows', area: flow.area as Area, severity: 'info', title: flow.title, why: flow.why, fix } : undefined;
}

// ---------------------------------------------------------------- "How do I…?"

const GOALS: { flow: string; phrases: string[] }[] = [
  { flow: 'free-space', phrases: ['free up space', 'disk full', 'clean my mac', 'clean up', 'storage full', 'make room', 'delete junk', 'speed up'] },
  { flow: 'camera-access', phrases: ['stop apps watching my camera', 'camera access', 'who uses my camera', 'webcam', 'camera privacy'] },
  { flow: 'microphone-access', phrases: ['stop apps listening', 'microphone access', 'who uses my microphone', 'mic privacy'] },
  { flow: 'screen-access', phrases: ['screen recording', 'who can see my screen', 'screen capture permission'] },
  { flow: 'encrypt-disk', phrases: ['encrypt my disk', 'filevault', 'bitlocker', 'protect if stolen', 'disk encryption'] },
  { flow: 'turn-on-firewall', phrases: ['turn on firewall', 'firewall', 'block incoming'] },
  { flow: 'backup-photos', phrases: ['back up my photos', 'backup photos', 'back up', 'backup', 'keep files safe'] },
  { flow: 'block-trackers', phrases: ['block trackers', 'block ads', 'stop tracking', 'privacy trackers'] },
  { flow: 'startup-apps', phrases: ['apps opening at startup', 'slow startup', 'login items', 'startup apps'] },
  { flow: 'storage-optimise', phrases: ['storage sense', 'optimize storage', 'empty trash automatically'] },
  { flow: 'lock-folder', phrases: ['lock a folder', 'password protect folder', 'private folder', 'hide folder'] },
  { flow: 'software-updates', phrases: ['update my computer', 'software update', 'windows update', 'security updates'] },
];

/** Goals that match what was typed ("how do I free up space"), best first. */
export function searchHowTo(query: string): { flow: GuideFlow; score: number }[] {
  const q = query.toLowerCase().replace(/^(how (do|can) i|how to|help me|i want to)\s+/, '').replace(/[?!.]/g, '').trim();
  if (!q) return FLOWS.map((flow) => ({ flow, score: 0 }));
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const out: { flow: GuideFlow; score: number }[] = [];
  for (const g of GOALS) {
    const flow = FLOWS.find((f) => f.id === g.flow);
    if (!flow) continue;
    let score = 0;
    for (const p of [flow.title.toLowerCase(), ...g.phrases]) {
      if (p === q) score = Math.max(score, 100);
      else if (p.includes(q) || q.includes(p)) score = Math.max(score, 60);
      else score = Math.max(score, words.filter((w) => p.includes(w)).length * 15);
    }
    if (score > 0) out.push({ flow, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
