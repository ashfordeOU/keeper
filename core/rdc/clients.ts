// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How each connection is opened with an outside program on each system: the
// program, its arguments and any temporary file it reads. Pure, so the exact
// command lines are tested for every system.
//
// Passwords never go on a command line (other users can read those). Where the
// program can take one, it goes to its standard input (FreeRDP /from-stdin) or
// into a temporary file only this user can read (mode 0600) that Keeper
// removes shortly after (an SSH askpass helper, a TigerVNC password file, a
// virt-viewer file). Where a program has neither, it asks for the password itself.

import path from 'node:path';
import { toRdp } from './formats';
import { vncObfuscate } from './des';
import type { Os } from './engines';
import { defaultPort, type Connection } from './types';
import { validHost } from './uri';

export interface TempFile {
  path: string;
  content: string | Uint8Array;
  mode: number;
}

export interface LaunchPlan {
  /** in a Keeper terminal tab, or as its own window */
  where: 'terminal' | 'external';
  engine: string;
  file: string;
  args: string[];
  /** written to the program's standard input, then closed */
  stdin?: string;
  /** written before the program starts, removed after `cleanupMs` */
  files?: TempFile[];
  env?: Record<string, string>;
  /** said to the person (e.g. "Remote Desktop asks for the password itself") */
  note?: string;
  cleanupMs?: number;
}

export interface LaunchCtx {
  os: Os;
  /** engine id → the program found for it */
  found: Record<string, { path: string; bin: string } | undefined>;
  /** where to connect (after a gateway this is a local forward) */
  host: string;
  port: number;
  password?: string;
  /** a private temporary folder for this launch */
  tmp: string;
  home: string;
  /** the real host name when `host` is a local forward (SSH checks its key under this name) */
  aliasOf?: string;
  /** a .rdp file's directory etc. are named after this */
  stamp?: string;
  /** the known_hosts file Keeper checked (set when it is not where ssh looks by itself) */
  knownHosts?: string;
}

export class NoEngine extends Error {
  constructor(public engine: string, message: string) {
    super(message);
  }
}

const need = (ctx: LaunchCtx, id: string, what: string) => {
  const f = ctx.found[id];
  if (!f) throw new NoEngine(id, `${what} needs a program that is not installed. See “Programs Keeper can use” on the Remote Desktops page.`);
  return f;
};

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'connection';
const hostPort = (h: string, p: number) => `${h.includes(':') ? `[${h}]` : h}:${p}`;
const userOk = (u: string | undefined) => (u && /^[^\s"'`$;&|<>\\]+$/.test(u) ? u : undefined);

// ---------------------------------------------------------------- RDP

/** FreeRDP 2 and 3 share most switches; the gateway and some sound switches differ. */
export function freerdpArgs(c: Connection, ctx: Pick<LaunchCtx, 'host' | 'port' | 'home' | 'password'>, major: 2 | 3): string[] {
  const r = c.rdp ?? {};
  const a = [`/v:${hostPort(ctx.host, ctx.port)}`, `/t:${c.name}`];
  if (c.user) a.push(`/u:${c.user}`);
  if (c.domain) a.push(`/d:${c.domain}`);
  // The password is read from standard input, never from the command line.
  if (ctx.password !== undefined) a.push('/from-stdin:force');
  if (r.fullscreen) a.push('/f');
  else if (r.width && r.height) a.push(`/size:${r.width}x${r.height}`);
  if (r.dynamicResolution) a.push('/dynamic-resolution');
  if (r.multimon) a.push('/multimon');
  a.push(r.clipboard === false ? '-clipboard' : '+clipboard');
  if (r.drives) a.push(`/drive:home,${ctx.home}`);
  if (r.audio === 'remote') a.push('/audio-mode:1');
  else if (r.audio === 'off') a.push('/audio-mode:2');
  else a.push('/sound');
  if (r.nla === false) a.push('/sec:tls');
  if (r.admin) a.push('/admin');
  a.push(r.ignoreCert ? '/cert:ignore' : '/cert:tofu');
  if (r.gateway) {
    if (major >= 3) a.push(`/gateway:g:${r.gateway}${r.gatewayUser ? `,u:${r.gatewayUser}` : ''}`);
    else { a.push(`/g:${r.gateway}`); if (r.gatewayUser) a.push(`/gu:${r.gatewayUser}`); }
  }
  return a;
}

export function freerdpMajor(bin: string): 2 | 3 {
  return /3(\.exe)?$/.test(bin) ? 3 : 2;
}

export function rdpPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const name = `${safeName(c.name)}${ctx.stamp ? `-${ctx.stamp}` : ''}.rdp`;
  const file = (os: Os) => (os === 'win32' ? path.win32 : path.posix).join(ctx.tmp, name);
  const rdpText = () => toRdp({ ...c, host: ctx.host, port: ctx.port });
  if (ctx.os === 'win32') {
    // A temporary .rdp file for the built-in client; it asks for the password itself.
    const mstsc = need(ctx, 'mstsc', 'Remote Desktop');
    const args = [file('win32')];
    if (c.rdp?.admin) args.push('/admin');
    if (c.rdp?.fullscreen) args.push('/f');
    if (c.rdp?.multimon) args.push('/multimon');
    return { where: 'external', engine: 'mstsc', file: mstsc.path, args, files: [{ path: file('win32'), content: rdpText(), mode: 0o600 }], cleanupMs: 60_000, note: 'Remote Desktop Connection asks for the password itself.' };
  }
  const fr = ctx.found.freerdp;
  if (fr) {
    return { where: 'external', engine: 'freerdp', file: fr.path, args: freerdpArgs(c, ctx, freerdpMajor(fr.bin)), stdin: ctx.password !== undefined ? `${ctx.password}\n` : undefined };
  }
  if (ctx.os === 'darwin') {
    // The Mac's Remote Desktop app (whichever one opens .rdp files) with a temporary .rdp file.
    return { where: 'external', engine: 'open', file: '/usr/bin/open', args: [file('darwin')], files: [{ path: file('darwin'), content: rdpText(), mode: 0o600 }], cleanupMs: 120_000, note: 'Your Remote Desktop app asks for the password itself.' };
  }
  throw new NoEngine('freerdp', 'Remote Desktop needs FreeRDP on Linux: sudo apt install freerdp3-x11');
}

// ---------------------------------------------------------------- SSH and friends

/** An SSH_ASKPASS helper that answers password and passphrase prompts from a private file, nothing else. */
export function askpass(ctx: LaunchCtx): { env: Record<string, string>; files: TempFile[] } | undefined {
  if (ctx.password === undefined || ctx.os === 'win32') return undefined;
  const script = path.posix.join(ctx.tmp, 'askpass.sh');
  const secret = path.posix.join(ctx.tmp, 'secret');
  return {
    env: { SSH_ASKPASS: script, SSH_ASKPASS_REQUIRE: 'force', KEEPER_ASKPASS_FILE: secret },
    files: [
      { path: secret, content: ctx.password, mode: 0o600 },
      { path: script, content: '#!/bin/sh\n# Keeper: answers password prompts only; anything else (a new host key) is refused.\ncase "$1" in\n  *assword*|*assphrase*|*PIN*) cat "$KEEPER_ASKPASS_FILE" ;;\n  *) exit 1 ;;\nesac\n', mode: 0o700 },
    ],
  };
}

export function sshArgs(c: Connection, ctx: Pick<LaunchCtx, 'host' | 'port' | 'aliasOf' | 'knownHosts'>, opts: { tty?: boolean } = {}): string[] {
  const a: string[] = [];
  if (ctx.port !== 22) a.push('-p', String(ctx.port));
  if (c.jump?.length) a.push('-J', c.jump.join(','));
  else if (c.gateway?.kind === 'ssh') a.push('-J', `${c.gateway.user ? `${c.gateway.user}@` : ''}${hostPort(c.gateway.host, c.gateway.port ?? 22).replace(/:22$/, '')}`);
  if (c.keyFile) a.push('-i', c.keyFile, '-o', 'IdentitiesOnly=yes');
  const auth = c.auth;
  if (auth === 'password') a.push('-o', 'PreferredAuthentications=password,keyboard-interactive');
  else if (auth === 'interactive') a.push('-o', 'PreferredAuthentications=keyboard-interactive');
  else if (auth === 'key' || auth === 'agent') a.push('-o', 'PreferredAuthentications=publickey');
  if (c.ssh?.agent) a.push('-A');
  if (c.ssh?.x11) a.push('-X');
  for (const f of c.ssh?.forwards ?? []) {
    const listen = f.bind ? `${f.bind}:${f.listen}` : String(f.listen);
    if (f.kind === 'D') a.push('-D', listen);
    else if (f.host && f.port) a.push(`-${f.kind}`, `${listen}:${f.host.includes(':') ? `[${f.host}]` : f.host}:${f.port}`);
  }
  // Through a local forward the address is 127.0.0.1: check the key under the real name.
  if (ctx.aliasOf) a.push('-o', `HostKeyAlias=${ctx.aliasOf}`);
  if (ctx.knownHosts) a.push('-o', `UserKnownHostsFile=${ctx.knownHosts}`);
  a.push('-o', 'StrictHostKeyChecking=ask', '-o', 'ServerAliveInterval=30');
  if (opts.tty || c.ssh?.command) a.push('-t');
  const user = userOk(c.user);
  a.push(user ? `${user}@${ctx.host}` : ctx.host);
  if (c.ssh?.command) a.push(c.ssh.command);
  return a;
}

export function sshPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const ssh = need(ctx, 'ssh', 'SSH');
  const ap = askpass(ctx);
  return { where: 'terminal', engine: 'ssh', file: ssh.path, args: sshArgs(c, ctx), env: ap?.env, files: ap?.files, cleanupMs: 60_000 };
}

/** A Windows path as WSL sees it: C:\Users\Ana\.ssh\id becomes /mnt/c/Users/Ana/.ssh/id. */
export function wslPath(p: string): string | undefined {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : undefined;
}

export function moshPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const mosh = need(ctx, 'mosh', 'Mosh');
  // On Windows mosh runs inside WSL (wsl.exe) or in MSYS2/Cygwin (their bash): paths are theirs, and
  // they have no SSH_ASKPASS helper from Keeper, so ssh asks for the password in the terminal.
  const wsl = ctx.os === 'win32' && mosh.bin === 'wsl';
  const posixWin = ctx.os === 'win32' && !wsl;
  const pathFor = (p: string) => (wsl ? wslPath(p) : posixWin ? p.replace(/\\/g, '/') : p);
  const sshOpts: string[] = [];
  if (ctx.port !== 22) sshOpts.push(`-p ${ctx.port}`);
  const key = c.keyFile ? pathFor(c.keyFile) : undefined;
  if (key && !/\s/.test(key)) sshOpts.push(`-i ${key}`);
  if (c.jump?.length) sshOpts.push(`-J ${c.jump.join(',')}`);
  if (ctx.aliasOf) sshOpts.push(`-o HostKeyAlias=${ctx.aliasOf}`);
  // Inside WSL, ssh would ask about the host key again: point it at the known_hosts Keeper checked.
  if (wsl) {
    const kh = wslPath(ctx.knownHosts ?? `${ctx.home.replace(/[\\/]+$/, '')}\\.ssh\\known_hosts`);
    if (kh && !/\s/.test(kh)) sshOpts.push(`-o UserKnownHostsFile=${kh}`);
  }
  const args = sshOpts.length ? [`--ssh=ssh ${sshOpts.join(' ')}`] : [];
  const user = userOk(c.user);
  args.push(user ? `${user}@${ctx.host}` : ctx.host);
  if (wsl) return { where: 'terminal', engine: 'mosh', file: mosh.path, args: ['--exec', 'mosh', ...args], note: 'Mosh runs inside WSL; ssh asks for the password in the terminal.' };
  if (posixWin) {
    // MSYS2's and Cygwin's mosh is a script: run it with their own bash, arguments passed as "$@" (no quoting games).
    const bash = mosh.path.replace(/[^\\/]+$/, 'bash.exe');
    return { where: 'terminal', engine: 'mosh', file: bash, args: ['-lc', 'exec mosh "$@"', 'mosh', ...args], note: 'ssh asks for the password in the terminal.' };
  }
  const ap = askpass(ctx);
  return { where: 'terminal', engine: 'mosh', file: mosh.path, args, env: ap?.env, files: ap?.files, cleanupMs: 60_000 };
}

export function telnetPlan(_c: Connection, ctx: LaunchCtx): LaunchPlan {
  const t = need(ctx, 'telnet', 'Telnet');
  if (t.bin === 'plink') return { where: 'terminal', engine: 'telnet', file: t.path, args: ['-telnet', '-P', String(ctx.port), ctx.host] };
  return { where: 'terminal', engine: 'telnet', file: t.path, args: [ctx.host, String(ctx.port)] };
}

export function serialPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const t = need(ctx, 'serial', 'A serial console');
  const s = c.serial ?? { baud: 9600 };
  const dev = c.host;
  if (!/^(COM\d+|\/dev\/[\w./-]+)$/i.test(dev)) throw new Error('Choose a serial device like /dev/ttyUSB0 or COM3');
  const baud = String(s.baud || 9600);
  const bits = String(s.dataBits ?? 8);
  const par = s.parity ?? 'none';
  const stop = String(s.stopBits ?? 1);
  switch (t.bin) {
    // picocom: -y parity, -p stop bits.
    case 'picocom': return { where: 'terminal', engine: 'serial', file: t.path, args: ['-b', baud, '-d', bits, '-y', par[0], '-p', stop, dev] };
    case 'minicom': return { where: 'terminal', engine: 'serial', file: t.path, args: ['-D', dev, '-b', baud] };
    case 'screen': return { where: 'terminal', engine: 'serial', file: t.path, args: [dev, baud] };
    case 'cu': return { where: 'terminal', engine: 'serial', file: t.path, args: ['-l', dev, '-s', baud] };
    default: return { where: 'terminal', engine: 'serial', file: t.path, args: ['-serial', dev, '-sercfg', `${baud},${bits},${par[0]},${stop},N`] };
  }
}

const psQ = (s: string) => `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;

export function winrmPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const ps = need(ctx, 'pwsh', 'PowerShell remoting');
  if (!validHost(ctx.host)) throw new Error('Not a valid computer name');
  const parts = [`Enter-PSSession -ComputerName ${psQ(ctx.host)} -Port ${ctx.port}`];
  if (c.winrm?.ssl || ctx.port === 5986) parts.push('-UseSSL');
  const user = c.user && userOk(c.user) && (!c.domain || userOk(c.domain)) ? (c.domain ? `${c.domain}\\${c.user}` : c.user) : undefined;
  // Get-Credential asks for the password in the terminal; it never passes through Keeper's command line.
  if (user) parts.push(`-Credential (Get-Credential -UserName ${psQ(user)} -Message ${psQ(`Sign in to ${c.name}`)})`);
  if (c.winrm?.auth && c.winrm.auth !== 'Default') parts.push(`-Authentication ${c.winrm.auth}`);
  return { where: 'terminal', engine: 'pwsh', file: ps.path, args: ['-NoLogo', '-NoExit', '-Command', parts.join(' ')] };
}

// ---------------------------------------------------------------- VNC, SPICE, X2Go in their own window

export function vncExternalPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const v = ctx.found.vncviewer;
  if (!v) {
    if (ctx.os === 'darwin') return { where: 'external', engine: 'open', file: '/usr/bin/open', args: [`vnc://${c.user ? `${encodeURIComponent(c.user)}@` : ''}${hostPort(ctx.host, ctx.port)}`], note: 'Screen Sharing asks for the password itself.' };
    throw new NoEngine('vncviewer', 'An outside VNC viewer is not installed. Keeper can show VNC in a tab instead.');
  }
  const args: string[] = [];
  const files: TempFile[] = [];
  if (ctx.password !== undefined) {
    // TigerVNC reads a scrambled password file (the same format as ~/.vnc/passwd).
    const pw = (ctx.os === 'win32' ? path.win32 : path.posix).join(ctx.tmp, 'passwd');
    files.push({ path: pw, content: vncObfuscate(ctx.password), mode: 0o600 });
    args.push('-passwd', pw);
  }
  if (c.vnc?.viewOnly) args.push('-ViewOnly');
  if (c.vnc?.shared !== false) args.push('-Shared');
  args.push(`${ctx.host.includes(':') ? `[${ctx.host}]` : ctx.host}::${ctx.port}`);
  return { where: 'external', engine: 'vncviewer', file: v.path, args, files, cleanupMs: 30_000 };
}

export function spicePlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const rv = need(ctx, 'remote-viewer', 'SPICE');
  const vv = (ctx.os === 'win32' ? path.win32 : path.posix).join(ctx.tmp, `${safeName(c.name)}.vv`);
  const lines = ['[virt-viewer]', 'type=spice', `host=${ctx.host}`, c.spice?.tls ? `tls-port=${ctx.port}` : `port=${ctx.port}`, `title=${c.name.replace(/[\r\n]/g, ' ')}`, 'delete-this-file=1'];
  if (ctx.password !== undefined) lines.push(`password=${ctx.password.replace(/[\r\n]/g, '')}`);
  return { where: 'external', engine: 'remote-viewer', file: rv.path, args: [vv], files: [{ path: vv, content: lines.join('\n') + '\n', mode: 0o600 }], cleanupMs: 30_000 };
}

export function x2goPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  const x = need(ctx, 'x2goclient', 'X2Go');
  const conf = (ctx.os === 'win32' ? path.win32 : path.posix).join(ctx.tmp, 'sessions');
  const id = safeName(c.name);
  const lines = [`[${id}]`, `name=${c.name.replace(/[\r\n\]]/g, ' ')}`, `host=${ctx.host}`, `sshport=${ctx.port}`, `user=${c.user ?? ''}`, `command=${(c.x2go?.command ?? 'XFCE').replace(/[^\w ./-]/g, '')}`, 'speed=2', 'pack=16m-jpeg', 'quality=9', 'sound=true', 'rootless=false', `key=${c.keyFile ?? ''}`, 'autologin=false'];
  return { where: 'external', engine: 'x2goclient', file: x.path, args: [`--session-conf=${conf}`, `--session=${id}`, '--hide'], files: [{ path: conf, content: lines.join('\n') + '\n', mode: 0o600 }], cleanupMs: 120_000, note: 'X2Go asks for the password itself.' };
}

/** The plan for a connection opened with an outside program (VNC only when asked to, else Keeper shows it). */
export function launchPlan(c: Connection, ctx: LaunchCtx): LaunchPlan {
  switch (c.protocol) {
    case 'rdp': return rdpPlan(c, ctx);
    case 'ssh': return sshPlan(c, ctx);
    case 'mosh': return moshPlan(c, ctx);
    case 'telnet': return telnetPlan(c, ctx);
    case 'serial': return serialPlan(c, ctx);
    case 'winrm': return winrmPlan(c, ctx);
    case 'vnc': return vncExternalPlan(c, ctx);
    case 'spice': return spicePlan(c, ctx);
    case 'x2go': return x2goPlan(c, ctx);
    default: throw new Error(`${c.protocol} connections open inside Keeper`);
  }
}

export const portOf = (c: Pick<Connection, 'protocol' | 'port'>) => c.port ?? defaultPort(c.protocol) ?? 0;

/** Every string a plan exposes on a command line or in logs; used to prove no secret is in them. */
export function visibleParts(p: LaunchPlan): string[] {
  return [p.file, ...p.args, ...Object.values(p.env ?? {}), p.note ?? ''];
}
