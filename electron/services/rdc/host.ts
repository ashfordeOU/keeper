// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Make this computer reachable": reads whether the system's own remote
// desktop servers are on, switches them (administrator steps under one system
// prompt, through the same runner the settings catalogue uses), starts x11vnc
// or wayvnc when that is the way on this desktop, and checks the security list.
// Nothing here runs until the panel is opened or a switch is pressed.

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../../core/platform';
import { vncObfuscate } from '../../../core/rdc/des';
import type { Os } from '../../../core/rdc/engines';
import {
  GNOME_MANUAL, gnomePlan, KRDP_MANUAL, krdpPlan, listenState, lockoutOn, MAC_MANUAL, MAC_SHARING_LINK, macScreenPlan, parseGrdctl, parseListeners,
  regDword, regString, securityChecks, wayvncArgs, windowsCanHost, winLockoutPlan, winNlaPlan, winRdpPlan, winReads, x11vncArgs,
  type HostId, type HostItem, type HostStatus,
} from '../../../core/rdc/hosting';
import { runCmds } from '../elevate';

export interface HostDeps {
  which(bin: string): Promise<string | null>;
  track(child: ChildProcess): void;
  dataDir: string;
  /** paired devices allowed to reach ports here */
  linkDevices(): Promise<{ device: string; name: string }[]>;
}

const OS = process.platform as Os;
let vncChild: { child: ChildProcess; id: 'x11vnc' | 'wayvnc'; password: boolean } | null = null;

async function listeners() {
  const r = OS === 'linux' ? await run('ss', ['-ltnH'], 5000) : OS === 'darwin' ? await run('netstat', ['-an', '-p', 'tcp'], 5000) : await run('netstat', ['-an', '-p', 'tcp'], 5000);
  return r.ok ? parseListeners(r.stdout) : [];
}

export async function hostStatus(d: HostDeps): Promise<HostStatus> {
  const ls = await listeners();
  const items: HostItem[] = [];
  let nla: boolean | undefined;
  let lockout: boolean | undefined;
  let gnomeUser: boolean | undefined;
  if (OS === 'win32') {
    const [deny, nlaR, ed, acc] = await Promise.all([run(winReads.deny.file, winReads.deny.args), run(winReads.nla.file, winReads.nla.args), run(winReads.edition.file, winReads.edition.args), run(winReads.accounts.file, winReads.accounts.args)]);
    const edition = regString(ed.stdout, 'EditionID');
    const can = windowsCanHost(edition);
    nla = regDword(nlaR.stdout, 'UserAuthentication') !== 0;
    lockout = lockoutOn(acc.stdout);
    items.push({ id: 'win-rdp', name: 'Remote Desktop', protocol: 'rdp', port: 3389, available: can, reason: can ? undefined : 'Windows Home cannot accept Remote Desktop connections. Upgrade to Pro, or share this screen with Keeper (Devices → Remote Access) or a VNC server.', on: regDword(deny.stdout, 'fDenyTSConnections') === 0, listening: listenState(ls, 3389), needsAdmin: true, settingsLink: 'ms-settings:remotedesktop' });
  } else if (OS === 'darwin') {
    const listening = listenState(ls, 5900);
    items.push({ id: 'mac-screen', name: 'Screen Sharing', protocol: 'vnc', port: 5900, available: true, on: listening !== 'no', listening, needsAdmin: true, manual: MAC_MANUAL, settingsLink: MAC_SHARING_LINK });
  } else {
    if (await d.which('grdctl')) {
      const st = await run('grdctl', ['status'], 5000);
      const g = parseGrdctl(st.stdout);
      gnomeUser = g.rdpUser;
      items.push({ id: 'gnome-rdp', name: 'GNOME Remote Desktop (RDP)', protocol: 'rdp', port: 3389, available: true, on: g.rdp, listening: listenState(ls, 3389), needsAdmin: false, manual: GNOME_MANUAL });
      items.push({ id: 'gnome-vnc', name: 'GNOME Remote Desktop (VNC)', protocol: 'vnc', port: 5900, available: true, on: g.vnc, listening: listenState(ls, 5900), needsAdmin: false, manual: GNOME_MANUAL });
    }
    if (await d.which('krdpserver')) items.push({ id: 'krdp', name: 'KDE Remote Desktop (KRdp)', protocol: 'rdp', port: 3389, available: true, listening: listenState(ls, 3389), on: listenState(ls, 3389) !== 'no', needsAdmin: false, manual: KRDP_MANUAL });
    const wayland = !!process.env.WAYLAND_DISPLAY;
    const x11 = await d.which('x11vnc');
    const wv = await d.which('wayvnc');
    items.push({ id: 'x11vnc', name: 'Share this screen over VNC (x11vnc)', protocol: 'vnc', port: 5900, available: !!x11 && !!process.env.DISPLAY && !wayland, reason: !x11 ? 'Install x11vnc: sudo apt install x11vnc' : wayland ? 'This is a Wayland desktop; x11vnc works on X11 only.' : !process.env.DISPLAY ? 'No X display here.' : undefined, on: vncChild?.id === 'x11vnc', listening: listenState(ls, 5900), needsAdmin: false });
    if (wayland) items.push({ id: 'wayvnc', name: 'Share this screen over VNC (wayvnc)', protocol: 'vnc', port: 5900, available: !!wv, reason: wv ? undefined : 'Install wayvnc (wlroots desktops such as Sway): sudo apt install wayvnc', on: vncChild?.id === 'wayvnc', listening: listenState(ls, 5900), needsAdmin: false });
  }
  return { os: OS, items, checks: securityChecks({ os: OS, items, nla, lockout, gnomeUser, vncPassword: vncChild?.password }), viaLink: await d.linkDevices().catch(() => []) };
}

export async function hostSet(d: HostDeps, id: HostId, on: boolean, opts: { password?: string; localOnly?: boolean } = {}): Promise<{ ok: boolean; message: string; manual?: string[] }> {
  if (id === 'win-rdp') {
    const r = await runCmds(winRdpPlan(on));
    return { ok: r.ok, message: r.ok ? (on ? 'Remote Desktop is on, with Network Level Authentication and the firewall rule.' : 'Remote Desktop is off.') : r.message };
  }
  if (id === 'mac-screen') {
    const r = await runCmds(macScreenPlan(on));
    return { ok: r.ok, message: r.ok ? (on ? 'Screen Sharing started. If others still cannot control it, switch it on in System Settings yourself (macOS 12.1 and later need this).' : 'Screen Sharing is off.') : r.message, manual: on ? MAC_MANUAL : undefined };
  }
  if (id === 'gnome-rdp' || id === 'gnome-vnc') {
    const r = await runCmds(gnomePlan(id === 'gnome-rdp' ? 'rdp' : 'vnc', on));
    return { ok: r.ok, message: r.ok ? (on ? 'Turned on. Set the user name and password in GNOME Settings.' : 'Turned off.') : r.message, manual: on ? GNOME_MANUAL : undefined };
  }
  if (id === 'krdp') {
    const r = await runCmds(krdpPlan(on));
    return { ok: r.ok, message: r.ok ? (on ? 'KRdp is on. Add a user in System Settings → Remote Desktop.' : 'KRdp is off.') : r.message, manual: on ? KRDP_MANUAL : undefined };
  }
  // x11vnc / wayvnc: Keeper runs it while Keeper is open.
  if (!on) {
    stopHostVnc();
    return { ok: true, message: 'Stopped sharing this screen over VNC.' };
  }
  stopHostVnc();
  const localOnly = opts.localOnly !== false;
  if (id === 'x11vnc') {
    const bin = await d.which('x11vnc');
    if (!bin) return { ok: false, message: 'x11vnc is not installed: sudo apt install x11vnc' };
    if (!opts.password) return { ok: false, message: 'Choose a password first.' };
    // The password goes into a private file in VNC's own format, never on the command line.
    const dir = path.join(d.dataDir, 'rdc');
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'x11vnc.passwd');
    await fsp.writeFile(file, vncObfuscate(opts.password), { mode: 0o600 });
    const child = spawn(bin, x11vncArgs(process.env.DISPLAY ?? ':0', file, 5900, localOnly), { stdio: 'ignore' });
    d.track(child);
    vncChild = { child, id, password: true };
    child.once('exit', () => { if (vncChild?.child === child) vncChild = null; });
    return { ok: true, message: localOnly ? 'Sharing this screen on port 5900, for this computer only: reach it through Keeper Link or SSH.' : 'Sharing this screen on port 5900 on every network.' };
  }
  const bin = await d.which('wayvnc');
  if (!bin) return { ok: false, message: 'wayvnc is not installed.' };
  const child = spawn(bin, wayvncArgs(5900, localOnly), { stdio: 'ignore' });
  d.track(child);
  vncChild = { child, id: 'wayvnc', password: false };
  child.once('exit', () => { if (vncChild?.child === child) vncChild = null; });
  return { ok: true, message: 'Sharing this screen on port 5900 for this computer only (wayvnc has no password without TLS; reach it through Keeper Link).' };
}

export async function hostFix(check: 'nla' | 'lockout') {
  if (OS !== 'win32') return { ok: false, message: 'Only on Windows' };
  const r = await runCmds(check === 'nla' ? winNlaPlan() : winLockoutPlan());
  return { ok: r.ok, message: r.ok ? 'Done' : r.message };
}

export function stopHostVnc() {
  vncChild?.child.kill();
  vncChild = null;
}

export const hostHome = () => os.homedir();
