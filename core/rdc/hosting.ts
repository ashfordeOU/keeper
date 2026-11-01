// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Make this computer reachable": the system's own remote desktop servers on
// each OS, what turning one on or off runs, and the security checklist. Pure:
// command lists and parsers here, running them in the main process (through
// the same administrator prompt the settings catalogue uses).

import type { Finding } from '../guide/types';
import type { Os } from './engines';

export type HostId = 'win-rdp' | 'mac-screen' | 'gnome-rdp' | 'gnome-vnc' | 'krdp' | 'x11vnc' | 'wayvnc';

export interface HostCmd { file: string; args: string[]; admin?: boolean }

export interface HostItem {
  id: HostId;
  name: string;
  protocol: 'rdp' | 'vnc';
  port: number;
  /** can this computer run it at all */
  available: boolean;
  reason?: string;
  on?: boolean;
  /** listening right now, and where */
  listening?: 'all' | 'local' | 'no';
  needsAdmin: boolean;
  /** steps the person does themselves (what Keeper cannot switch) */
  manual?: string[];
  /** a settings page that helps */
  settingsLink?: string;
}

export interface SecurityCheck {
  id: 'nla' | 'exposed' | 'password' | 'lockout';
  title: string;
  /** undefined: could not tell (advice only) */
  ok?: boolean;
  detail: string;
  /** Keeper can fix it with one click */
  fix?: string;
}

export interface HostStatus {
  os: Os;
  items: HostItem[];
  checks: SecurityCheck[];
  /** paired devices that may reach ports here through Keeper Link */
  viaLink: { device: string; name: string }[];
}

// ---------------------------------------------------------------- Windows

const TS = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server';
const RDP_TCP = `${TS}\\WinStations\\RDP-Tcp`;
/** The language-independent name of the "Remote Desktop" firewall rule group. */
export const RDP_FIREWALL_GROUP = '@FirewallAPI.dll,-28752';

/** "Home" editions (EditionID Core…) cannot accept Remote Desktop connections. */
export function windowsCanHost(editionId: string | undefined): boolean {
  if (!editionId) return true;
  return !/^Core/i.test(editionId.trim());
}

/** A DWORD from `reg query … /v Name` output. */
export function regDword(stdout: string, name: string): number | undefined {
  const m = new RegExp(`\\b${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i').exec(stdout);
  return m ? parseInt(m[1], 16) : undefined;
}

export function regString(stdout: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s+REG_SZ\\s+(.+)`, 'i').exec(stdout);
  return m?.[1].trim();
}

export const winReads = {
  deny: { file: 'reg', args: ['query', TS, '/v', 'fDenyTSConnections'] },
  nla: { file: 'reg', args: ['query', RDP_TCP, '/v', 'UserAuthentication'] },
  edition: { file: 'reg', args: ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'EditionID'] },
  accounts: { file: 'net', args: ['accounts'] },
};

export function winRdpPlan(on: boolean): HostCmd[] {
  const cmds: HostCmd[] = [{ file: 'reg', args: ['add', TS, '/v', 'fDenyTSConnections', '/t', 'REG_DWORD', '/d', on ? '0' : '1', '/f'], admin: true }];
  if (on) cmds.push({ file: 'reg', args: ['add', RDP_TCP, '/v', 'UserAuthentication', '/t', 'REG_DWORD', '/d', '1', '/f'], admin: true });
  cmds.push({ file: 'powershell', args: ['-NoProfile', '-Command', `${on ? 'Enable' : 'Disable'}-NetFirewallRule -Group '${RDP_FIREWALL_GROUP}'`], admin: true });
  return cmds;
}

export const winNlaPlan = (): HostCmd[] => [{ file: 'reg', args: ['add', RDP_TCP, '/v', 'UserAuthentication', '/t', 'REG_DWORD', '/d', '1', '/f'], admin: true }];
export const winLockoutPlan = (): HostCmd[] => [{ file: 'net', args: ['accounts', '/lockoutthreshold:10', '/lockoutwindow:15', '/lockoutduration:15'], admin: true }];

/** "Lockout threshold: Never" (or 0) means unlimited password guesses. */
export function lockoutOn(netAccounts: string): boolean | undefined {
  const m = /Lockout threshold:\s*(\S+)/i.exec(netAccounts);
  if (!m) return undefined;
  return !/^(never|0)$/i.test(m[1]);
}

// ---------------------------------------------------------------- macOS

export const KICKSTART = '/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart';
export const MAC_SHARING_LINK = 'x-apple.systempreferences:com.apple.Sharing-Settings.extension';

export function macScreenPlan(on: boolean): HostCmd[] {
  return on
    ? [{ file: KICKSTART, args: ['-activate', '-configure', '-access', '-on', '-privs', '-all', '-allowAccessFor', '-allUsers', '-restart', '-agent'], admin: true }]
    : [{ file: KICKSTART, args: ['-deactivate', '-configure', '-access', '-off'], admin: true }];
}

export const MAC_MANUAL = [
  'Open System Settings → General → Sharing.',
  'Turn on Screen Sharing (or Remote Management for more control).',
  'macOS 12.1 and later only let you switch on screen control here yourself; Keeper’s switch can start the service but not grant control.',
];

// ---------------------------------------------------------------- Linux

/** `grdctl status` → whether RDP and VNC are on, and if a user name is set. */
export function parseGrdctl(out: string): { rdp?: boolean; vnc?: boolean; rdpUser?: boolean } {
  const r: { rdp?: boolean; vnc?: boolean; rdpUser?: boolean } = {};
  let sec = '';
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^RDP:?$/i.test(line)) { sec = 'rdp'; continue; }
    if (/^VNC:?$/i.test(line)) { sec = 'vnc'; continue; }
    const st = /^Status:\s*(\w+)/i.exec(line);
    if (st && (sec === 'rdp' || sec === 'vnc')) r[sec] = /enabled/i.test(st[1]);
    const u = /^Username:\s*(.*)$/i.exec(line);
    if (u && sec === 'rdp') r.rdpUser = !!u[1].trim() && !/\(empty\)|^\s*$/.test(u[1]);
  }
  return r;
}

export function gnomePlan(proto: 'rdp' | 'vnc', on: boolean): HostCmd[] {
  const cmds: HostCmd[] = [{ file: 'grdctl', args: [proto, on ? 'enable' : 'disable'] }];
  if (on) {
    cmds.push({ file: 'grdctl', args: [proto, 'disable-view-only'] });
    cmds.push({ file: 'systemctl', args: ['--user', 'enable', '--now', 'gnome-remote-desktop.service'] });
  }
  return cmds;
}

export const GNOME_MANUAL = [
  'Open Settings → System → Remote Desktop (Sharing → Remote Desktop on older GNOME).',
  'Set a user name and a strong password there; GNOME also makes the security certificate.',
];

export function krdpPlan(on: boolean): HostCmd[] {
  return [{ file: 'systemctl', args: ['--user', on ? 'enable' : 'disable', '--now', 'app-org.kde.krdpserver.service'] }];
}

export const KRDP_MANUAL = ['Open System Settings → Remote Desktop and add a user with a strong password.'];

/** x11vnc for this X display, listening on this computer only unless asked, with a password file. */
export function x11vncArgs(display: string, passwdFile: string, port = 5900, localOnly = true): string[] {
  const a = ['-display', display, '-rfbport', String(port), '-forever', '-shared', '-rfbauth', passwdFile, '-noxdamage', '-quiet'];
  if (localOnly) a.push('-localhost');
  return a;
}

export function wayvncArgs(port = 5900, localOnly = true): string[] {
  return [localOnly ? '127.0.0.1' : '0.0.0.0', String(port)];
}

// ---------------------------------------------------------------- listening ports

export interface Listener { addr: string; port: number }

/** `ss -ltnH`, `netstat -an` (Windows and macOS) or `lsof -iTCP -sTCP:LISTEN -nP` output → listening sockets. */
export function parseListeners(out: string): Listener[] {
  const found: Listener[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (/LISTEN/i.test(line)) {
      // Pick the first "address:port" or "address.port" token that is a local listener.
      const tokens = line.trim().split(/\s+/);
      for (const t of tokens) {
        const m = /^(\*|\[?[0-9a-fA-F:.%\w]*\]?)[:.](\d{1,5})$/.exec(t);
        if (!m || t.includes('->')) continue;
        const addr = m[1].replace(/^\[|\]$/g, '').replace(/%.*$/, '');
        found.push({ addr: addr === '' ? '*' : addr, port: Number(m[2]) });
        break;
      }
    }
  }
  return found;
}

const LOCAL = /^(127\.|::1$|localhost$)/;

export function listenState(list: Listener[], port: number): 'all' | 'local' | 'no' {
  const on = list.filter((l) => l.port === port);
  if (!on.length) return 'no';
  return on.every((l) => LOCAL.test(l.addr)) ? 'local' : 'all';
}

// ---------------------------------------------------------------- the checklist

export function securityChecks(o: { os: Os; items: HostItem[]; nla?: boolean; lockout?: boolean; vncPassword?: boolean; gnomeUser?: boolean }): SecurityCheck[] {
  const on = o.items.filter((i) => i.on || (i.listening && i.listening !== 'no'));
  const out: SecurityCheck[] = [];
  const rdpOn = on.some((i) => i.protocol === 'rdp');
  if (o.os === 'win32' && rdpOn) out.push({ id: 'nla', title: 'Network Level Authentication is on', ok: o.nla, detail: o.nla ? 'People must sign in before a Remote Desktop session starts.' : 'Without it, the sign-in screen is shown to anyone who connects. Turn it on.', fix: o.nla ? undefined : 'nla' });
  const wide = on.filter((i) => i.listening === 'all');
  out.push({
    id: 'exposed',
    title: 'Not open to the internet',
    ok: on.length === 0 ? true : wide.length ? undefined : true,
    detail: !on.length ? 'Nothing here accepts remote desktop connections.'
      : wide.length ? `${wide.map((w) => `${w.name} (port ${w.port})`).join(', ')} answers on every network. Make sure your router does not forward that port; use Keeper Link instead, which opens no ports.`
        : 'Only this computer can connect directly; others reach it through Keeper Link or SSH.',
  });
  if (on.some((i) => i.id === 'x11vnc' || i.id === 'wayvnc')) out.push({ id: 'password', title: 'A strong password', ok: o.vncPassword, detail: o.vncPassword ? 'The VNC server needs the password you set.' : 'Set a password before others connect (VNC passwords are limited to 8 characters, so reach it through Keeper Link or SSH).' });
  else if (on.some((i) => i.id === 'gnome-rdp')) out.push({ id: 'password', title: 'A strong password', ok: o.gnomeUser, detail: o.gnomeUser ? 'Remote Desktop has a user name and password.' : 'Set a user name and password in Settings → System → Remote Desktop.' });
  else if (rdpOn) out.push({ id: 'password', title: 'A strong password', detail: 'People sign in with your account password: make it long and unique.' });
  if (o.os === 'win32' && rdpOn) out.push({ id: 'lockout', title: 'Account lockout after wrong passwords', ok: o.lockout, detail: o.lockout ? 'Repeated wrong passwords lock the account for a while.' : 'Anyone can keep guessing passwords. Lock the account for 15 minutes after 10 wrong tries.', fix: o.lockout ? undefined : 'lockout' });
  return out;
}

/** Failed checks as To do items (System → To do). */
export function hostingFindings(checks: SecurityCheck[]): Finding[] {
  return checks.filter((c) => c.ok === false).map((c): Finding => ({
    id: `rdc:${c.id}`,
    source: 'rdc-hosting',
    area: 'security',
    severity: c.id === 'nla' || c.id === 'password' ? 'high' : 'medium',
    title: c.id === 'nla' ? 'Turn on Network Level Authentication for Remote Desktop' : c.id === 'lockout' ? 'Lock accounts after repeated wrong passwords' : c.id === 'password' ? 'Set a strong remote desktop password' : c.title,
    why: c.detail,
    fix: { kind: 'page', route: { name: 'rdc', arg: 'host' }, label: 'Open Remote Desktops', steps: [{ text: 'Open Remote Desktops → This computer and follow the checklist.' }] },
  }));
}
