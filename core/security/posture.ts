// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Security posture beyond the basic protections: signing in without a password,
// screen lock, sharing services left on, everyday use of an administrator
// account, open Wi-Fi, certificates someone added to the system's trust store,
// extra kernel extensions, and the system's own data-sharing settings.
// Each function turns one command's output into findings, so it can be tested.

import type { Finding } from './types';

const f = (x: Omit<Finding, 'area'>): Finding => ({ area: 'posture', ...x });

// ---------------------------------------------------------------- macOS

export function macAutoLogin(defaultsOut: string, ok: boolean): Finding[] {
  return ok && defaultsOut.trim()
    ? [f({ id: 'posture.autologin', severity: 'high', title: `Your Mac signs in as “${defaultsOut.trim()}” without a password`, why: 'Anyone who turns it on gets straight to your files.', fix: { label: 'Turn off automatic login', settings: 'x-apple.systempreferences:com.apple.Users-Groups-Settings.extension' } })]
    : [];
}

/** `sysadminctl -screenLock status` prints e.g. "screenLock delay is immediate" or "screenLock is off" (on stderr). */
export function macScreenLock(out: string): Finding[] {
  if (/screenLock is off/i.test(out)) return [f({ id: 'posture.screenlock', severity: 'medium', title: 'Your Mac does not ask for a password after sleep or the screen saver', why: 'Someone walking past an unattended Mac can use it.', fix: { label: 'Require a password', settings: 'x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension' } })];
  const m = out.match(/delay is (\d+) seconds/i);
  if (m && Number(m[1]) > 300) return [f({ id: 'posture.screenlock', severity: 'low', title: `Your Mac waits ${Math.round(Number(m[1]) / 60)} minutes before asking for a password`, why: 'A shorter delay protects an unattended Mac.', fix: { label: 'Change the delay', settings: 'x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension' } })];
  return [];
}

/** `launchctl list` lines for sharing services. */
export function macSharing(launchctlList: string): Finding[] {
  const out: Finding[] = [];
  const on = (label: string) => new RegExp(`\\s${label.replace(/\./g, '\\.')}$`, 'm').test(launchctlList);
  const svc: [string, string, string][] = [
    ['com.openssh.sshd', 'Remote Login (SSH) is on', 'Other computers on the network can try to sign in to this Mac.'],
    ['com.apple.screensharing', 'Screen Sharing is on', 'Other computers can see and control this Mac’s screen.'],
    ['com.apple.smbd', 'File Sharing is on', 'Shared folders can be reached from the network.'],
    ['com.apple.AppleFileServer', 'File Sharing (AFP) is on', 'Shared folders can be reached from the network.'],
    ['com.apple.RemoteDesktop.agent', 'Remote Management is on', 'Administrators can control this Mac remotely.'],
  ];
  for (const [label, title, why] of svc) if (on(label)) out.push(f({ id: `posture.sharing.${label}`, severity: 'low', title, why: `${why} Turn it off if you do not use it.`, fix: { label: 'Open Sharing settings', settings: 'x-apple.systempreferences:com.apple.Sharing-Settings.extension' } }));
  return out;
}

/** `system_profiler SPAirPortDataType -json`: the current network's security. */
export function macWifi(json: string): Finding[] {
  try {
    const o = JSON.parse(json);
    for (const iface of o.SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? []) {
      const cur = iface.spairport_current_network_information;
      if (!cur) continue;
      const mode = String(cur.spairport_security_mode ?? '').replace(/^spairport_security_mode_/, '').replace(/_/g, ' ');
      return wifiFinding(cur._name ?? 'this network', mode);
    }
  } catch {
    /* no Wi-Fi */
  }
  return [];
}

/** `security find-certificate -a -c "" -Z /Library/Keychains/System.keychain`: certificates someone added to the system keychain. */
export function macAddedRoots(text: string, keychain = '/Library/Keychains/System.keychain'): Finding[] {
  return addedRootsFindings(macRootList(text).map((c) => ({ ...c, store: keychain })));
}

/** Each certificate in `security find-certificate -a -Z` output: its label and hashes (Apple's own left out). */
export function macRootList(text: string): { name: string; sha1?: string; sha256?: string }[] {
  const out: { name: string; sha1?: string; sha256?: string }[] = [];
  // Each certificate starts with its hashes (-Z: SHA-256 then SHA-1 on newer systems, SHA-1 alone on older) or, without -Z, with "keychain:".
  const blocks: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const starts = /^SHA-256 hash:/.test(line) || (/^SHA-1 hash:/.test(line) && /SHA-1 hash:|keychain:/.test(cur)) || (/^keychain:/.test(line) && /keychain:/.test(cur));
    if (starts && cur) { blocks.push(cur); cur = ''; }
    cur += `${line}\n`;
  }
  if (cur) blocks.push(cur);
  for (const b of blocks) {
    const name = b.match(/"labl"<blob>="([^"]+)"/)?.[1] ?? b.match(/"alis"<blob>="([^"]+)"/)?.[1];
    if (!name || /^com\.apple\.|^Apple /.test(name)) continue;
    out.push({ name, sha1: b.match(/SHA-1 hash:\s*([0-9A-F]+)/i)?.[1]?.toUpperCase(), sha256: b.match(/SHA-256 hash:\s*([0-9A-F]+)/i)?.[1]?.toUpperCase() });
  }
  return out;
}

/** `kmutil showloaded --list-only` (or kextstat): kernel extensions that are not Apple's. */
export function macKexts(text: string): Finding[] {
  const ids = [...new Set([...text.matchAll(/\s([a-z0-9-]+(?:\.[A-Za-z0-9_-]+){2,})\s/g)].map((m) => m[1]).filter((id) => !id.startsWith('com.apple.')))];
  return ids.length ? [f({ id: 'posture.kext', severity: 'info', title: `${ids.length} kernel extension${ids.length > 1 ? 's' : ''} from other developers`, why: 'Kernel extensions run with full control of the system. Remove any you do not recognise.', detail: ids.join(', ') })] : [];
}

/** Sharing crash and usage data with Apple and developers. */
export function macAnalytics(autoSubmit: string): Finding[] {
  return autoSubmit.trim() === '1' ? [f({ id: 'posture.telemetry', severity: 'info', title: 'Your Mac shares analytics with Apple', why: 'Crash and usage reports go to Apple (and developers). Your choice; turn it off if you prefer.', fix: { label: 'Open Analytics settings', settings: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Analytics' } })] : [];
}

// ---------------------------------------------------------------- Windows

export interface WinPosture {
  autoLogon?: string | number;
  rdp?: number;
  admin?: boolean;
  telemetry?: number;
  screenSaverSecure?: string | number;
  inactivity?: number;
  shares?: string[];
  wifiAuth?: string;
  wifiName?: string;
  /** subjects, or subject and thumbprint */
  recentRoots?: (string | { s: string; t?: string })[];
}

export function windowsPosture(o: WinPosture): Finding[] {
  const out: Finding[] = [];
  if (String(o.autoLogon) === '1') out.push(f({ id: 'posture.autologin', severity: 'high', title: 'Windows signs in without a password', why: 'Anyone who turns on this PC gets straight to your files.', fix: { label: 'Turn off automatic sign-in', settings: 'ms-settings:signinoptions' } }));
  if (o.rdp === 0) out.push(f({ id: 'posture.sharing.rdp', severity: 'medium', title: 'Remote Desktop is on', why: 'Other computers can try to sign in to this PC. Turn it off if you do not use it.', fix: { label: 'Open Remote Desktop settings', settings: 'ms-settings:remotedesktop' } }));
  if (o.admin) out.push(f({ id: 'posture.admin', severity: 'low', title: 'You use an administrator account every day', why: 'Malware you run by mistake gets full control of the system. A standard account for daily use limits the damage.' }));
  if (o.telemetry !== undefined && o.telemetry >= 3) out.push(f({ id: 'posture.telemetry', severity: 'info', title: 'Windows sends optional diagnostic data to Microsoft', why: 'Includes details about the apps you use. Your choice; required data alone is enough.', fix: { label: 'Open diagnostics settings', settings: 'ms-settings:privacy-feedback' } }));
  if (String(o.screenSaverSecure) === '0' && !o.inactivity) out.push(f({ id: 'posture.screenlock', severity: 'medium', title: 'Windows does not lock itself when you step away', why: 'Someone walking past an unattended PC can use it.', fix: { label: 'Set the screen to lock', settings: 'ms-settings:lockscreen' } }));
  const shares = (o.shares ?? []).filter((s) => !/^(ADMIN|IPC|[A-Z])\$$/i.test(s));
  if (shares.length) out.push(f({ id: 'posture.sharing.smb', severity: 'low', title: `${shares.length} folder${shares.length > 1 ? 's are' : ' is'} shared on the network`, why: 'Other computers on the network can reach them.', detail: shares.join(', ') }));
  if (o.wifiAuth) out.push(...wifiFinding(o.wifiName ?? 'this network', o.wifiAuth));
  if (o.recentRoots?.length) out.push(...addedRootsFindings(o.recentRoots.map((r) => (typeof r === 'string' ? { name: r } : { name: r.s, sha1: r.t })).map((c) => ({ ...c, name: c.name.match(/CN=([^,]+)/)?.[1] ?? c.name, store: 'Trusted Root Certification Authorities (this computer)' }))));
  return out;
}

// ---------------------------------------------------------------- Linux

export interface LinuxPosture {
  sshActive?: boolean;
  sambaActive?: boolean;
  vncOrRdp?: boolean;
  autologin?: boolean;
  groups?: string;
  lockEnabled?: string;
  crashReports?: boolean;
  wifi?: { ssid: string; security: string };
  localCerts?: string[];
  /** each local certificate's SHA-256, by file name */
  localCertHashes?: Record<string, string>;
  tainted?: number;
}

export function linuxPosture(o: LinuxPosture): Finding[] {
  const out: Finding[] = [];
  if (o.autologin) out.push(f({ id: 'posture.autologin', severity: 'high', title: 'This computer signs in without a password', why: 'Anyone who turns it on gets straight to your files.', fix: { label: 'Turn off automatic login in Users settings' } }));
  if (o.sshActive) out.push(f({ id: 'posture.sharing.ssh', severity: 'low', title: 'The SSH server is running', why: 'Other computers can try to sign in. Fine if you use it; otherwise stop it.', fix: { label: 'Stop it', action: 'run', arg: 'pkexec systemctl disable --now ssh sshd' } }));
  if (o.sambaActive) out.push(f({ id: 'posture.sharing.smb', severity: 'low', title: 'Windows file sharing (Samba) is running', why: 'Shared folders can be reached from the network.' }));
  if (o.vncOrRdp) out.push(f({ id: 'posture.sharing.screen', severity: 'medium', title: 'Remote desktop or screen sharing is running', why: 'Other computers can see and control this screen.' }));
  if (o.lockEnabled?.trim() === 'false') out.push(f({ id: 'posture.screenlock', severity: 'medium', title: 'The screen does not lock when you step away', why: 'Someone walking past an unattended computer can use it.', fix: { label: 'Turn on screen lock', action: 'run', arg: 'gsettings set org.gnome.desktop.screensaver lock-enabled true' } }));
  if (o.crashReports) out.push(f({ id: 'posture.telemetry', severity: 'info', title: 'Crash reports are sent to your distribution', why: 'They can include parts of what was in memory. Your choice.' }));
  if (o.wifi) out.push(...wifiFinding(o.wifi.ssid, o.wifi.security || 'none'));
  if (o.localCerts?.length) out.push(...addedRootsFindings(o.localCerts.map((n) => ({ name: n, sha256: o.localCertHashes?.[n], file: `/usr/local/share/ca-certificates/${n}`, store: '/usr/local/share/ca-certificates' }))));
  if (o.tainted && (o.tainted & (1 << 12))) out.push(f({ id: 'posture.kext', severity: 'info', title: 'Kernel modules from outside your distribution are loaded', why: 'They run with full control of the system (common for graphics and VPN drivers). Remove any you do not recognise.' }));
  return out;
}

// ---------------------------------------------------------------- shared

export function wifiFinding(name: string, security: string): Finding[] {
  const s = security.toLowerCase();
  if (!s || /^(none|open|--)$/.test(s) || /\bopen\b/.test(s)) return [f({ id: 'posture.wifi', severity: 'medium', title: `“${name}” is an open Wi-Fi network`, why: 'Others on it can see traffic that is not encrypted. Use a VPN or a trusted network for anything private.' })];
  if (/\bwep\b/.test(s)) return [f({ id: 'posture.wifi', severity: 'high', title: `“${name}” uses WEP, which is easily broken`, why: 'Anyone nearby can read the traffic. Change the router to WPA2 or WPA3.' })];
  return [];
}

/** One finding per added certificate, shown together when there are several. */
export function addedRootsFindings(certs: { name: string; sha1?: string; sha256?: string; file?: string; store: string }[]): Finding[] {
  return certs.map((c) => f({
    id: `posture.roots.${(c.sha1 ?? c.sha256 ?? c.name).replace(/[^\w.-]+/g, '_').slice(0, 80)}`,
    severity: 'medium',
    title: `The certificate “${c.name}” was added to the system’s trusted list`,
    why: 'A trusted certificate lets whoever holds it read encrypted traffic. Workplaces, VPNs and some developer and security tools add them on purpose; remove any you do not recognise.',
    detail: [c.name, c.store].join(' · '),
    subject: { kind: 'certificate', store: c.store, name: c.name, sha1: c.sha1, sha256: c.sha256, file: c.file },
    group: { key: 'certs', one: '1 certificate was added to the system’s trusted list', many: '{n} certificates were added to the system’s trusted list' },
    confidence: 'unsure',
    learnMore: 'GUIDE#certificates',
  }));
}

/** The basic protections (from the existing Protection check) as findings. */
export function protectionFindings(checks: { id: string; name: string; description: string; status: 'ok' | 'warn' | 'off' | 'unknown'; detail?: string; fix?: string; weight: number }[]): Finding[] {
  return checks.filter((c) => c.status === 'off' || c.status === 'warn').map((c) => f({
    id: `protection.${c.id}`,
    severity: c.status === 'off' ? (c.weight >= 3 ? 'high' : c.weight >= 2 ? 'medium' : 'low') : 'low',
    title: c.status === 'off' ? `${c.name} is off` : `${c.name} needs a look`,
    why: c.description + (c.detail ? ` (${c.detail})` : ''),
    fix: c.fix ? { label: c.fix } : undefined,
  }));
}
