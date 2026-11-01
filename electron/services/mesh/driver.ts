// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh and the real operating system: which WireGuard there is, the
// privileged helper (Linux, macOS) or the administrator prompt (Windows),
// reading routes and counters, and the troubleshooting commands.
//
// Seam for macOS: MacDataPlane picks how the utun interface is made. Today it
// is wireguard-go run by Keeper's helper. A Network Extension variant (a
// packet tunnel provider inside the app, no helper, no password) needs
// Apple's com.apple.developer.networking.networkextension entitlement and a
// Developer ID-signed, notarised build with a system extension; it would
// implement the same three calls and replace the helper on macOS.

import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream, existsSync, promises as fsp, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SYSTEM_DIRS, wireguardGoBuild, wireguardWindows } from '../../../core/mesh/binaries';
import { linuxIface, windowsTunnel, NAMES, type MeshOS, type Step } from '../../../core/mesh/os-plan';
import type { IfaceState, MeshDiag, MeshNetwork } from '../../../core/mesh/types';
import { parseUapiGet, parseWgDump, type WgPeerStats } from '../../../core/mesh/wgconfig';
import type { MeshDriver } from './engine';

const run = (file: string, args: string[], timeout = 15_000) =>
  new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (e, out, err) => resolve({ ok: !e, out: String(out), err: String(err || (e ? e.message : '')) }));
  });

const findSystem = (name: string) => SYSTEM_DIRS.map((d) => path.join(d, name)).find((p) => existsSync(p));

export interface DriverOpts {
  /** Keeper's data folder for the mesh (downloads go to bin/) */
  dir: string;
  /** dist-electron/mesh-helper.cjs */
  helper: string;
  /** asks Windows / the system for administrator rights for a batch (electron/services/elevate.ts) */
  elevate: (steps: { file: string; args: string[]; admin: boolean }[]) => Promise<{ ok: boolean; message: string }>;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** How a macOS utun is made: wireguard-go through the helper today; a Network Extension later. */
export interface MacDataPlane {
  kind: 'wireguard-go' | 'network-extension';
  available(): Promise<boolean>;
  why?: string;
}

export const NETWORK_EXTENSION: MacDataPlane = {
  kind: 'network-extension',
  available: async () => false,
  why: 'needs Apple’s Network Extension entitlement and a Developer ID-signed build',
};

export class RealDriver implements MeshDriver {
  os: MeshOS;
  private helper: HelperClient | null = null;
  private wgGo?: string;
  private wgTool?: string;
  private winWatch = false;

  constructor(private o: DriverOpts) {
    const p = o.platform ?? process.platform;
    this.os = p === 'win32' ? 'win32' : p === 'darwin' ? 'darwin' : 'linux';
  }

  // ---------------------------------------------------------------- which WireGuard

  async detect(): Promise<{ impl?: 'kernel' | 'wireguard-go' | 'wireguard-nt'; bin?: string; wg?: string; state: IfaceState; message?: string }> {
    if (this.os === 'win32') {
      const exe = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wireguard.exe');
      if (existsSync(exe)) return { impl: 'wireguard-nt', bin: exe, state: 'up' };
      if (!wireguardWindows(this.o.arch ?? process.arch)) return { state: 'no-wireguard', message: 'WireGuard for Windows is not made for this computer' };
      // Installed on first use (see run): the official signed installer, hash-checked.
      return { impl: 'wireguard-nt', bin: exe, state: 'up', message: 'WireGuard for Windows will be installed' };
    }
    this.wgTool = findSystem('wg');
    if (this.os === 'linux' && (await this.kernelModule()) && this.wgTool) return { impl: 'kernel', wg: this.wgTool, state: 'up' };
    const go = await this.wireguardGo();
    if (go) return { impl: 'wireguard-go', bin: go, wg: this.wgTool, state: 'up' };
    return {
      state: 'no-wireguard',
      message:
        this.os === 'linux'
          ? 'WireGuard is not available: install wireguard-tools (and the kernel module), or wireguard-go. Keys, addresses and paths still work.'
          : 'WireGuard is not available: install wireguard-go (for example with Homebrew). Keys, addresses and paths still work.',
    };
  }

  private async kernelModule(): Promise<boolean> {
    if (existsSync('/sys/module/wireguard')) return true;
    const rel = os.release();
    for (const f of [`/lib/modules/${rel}/modules.builtin`, `/lib/modules/${rel}/modules.dep`]) {
      try {
        if (/\/wireguard\.ko/.test(readFileSync(f, 'utf8'))) return true;
      } catch {
        /* not there */
      }
    }
    return false;
  }

  /** A pinned wireguard-go from Keeper's release (checked), else a system package. */
  private async wireguardGo(): Promise<string | undefined> {
    const pinned = wireguardGoBuild(this.o.platform ?? process.platform, this.o.arch ?? process.arch);
    if (pinned) {
      try {
        this.wgGo = await download(pinned.url, pinned.sha256, path.join(this.o.dir, 'bin', `wireguard-go-${pinned.sha256.slice(0, 12)}`));
        return this.wgGo;
      } catch {
        /* fall back to a system copy */
      }
    }
    const sys = findSystem('wireguard-go');
    if (sys && statSync(sys).uid === 0) return (this.wgGo = sys);
    return undefined;
  }

  async ifaceName(n: MeshNetwork, index: number): Promise<string> {
    if (this.os === 'linux') return linuxIface(n.id);
    if (this.os === 'win32') return windowsTunnel(n.name);
    const r = await run('/sbin/ifconfig', ['-l']);
    const used = new Set(r.out.split(/\s+/));
    for (let i = 10 + index; i < 100; i++) if (!used.has(`utun${i}`)) return `utun${i}`;
    return `utun${99 - index}`;
  }

  hasIPv6() {
    return this.os !== 'linux' || existsSync('/proc/sys/net/ipv6');
  }

  confPath(tunnel: string) {
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Keeper', 'mesh', `${tunnel}.conf`);
  }

  // ---------------------------------------------------------------- running plans

  async run(steps: Step[]): Promise<{ ok: boolean; message: string }> {
    if (!steps.length) return { ok: true, message: '' };
    if (this.os === 'win32') return this.runWindows(steps);
    const h = await this.ensureHelper();
    return h.request('run', { steps });
  }

  async setCleanup(steps: Step[]) {
    if (this.os === 'win32') return; // the elevated watchdog started with the tunnel cleans up by name
    if (!steps.length && !this.helper) return;
    const h = await this.ensureHelper();
    await h.request('cleanup', { steps });
  }

  private async runWindows(steps: Step[]) {
    const wg = steps.find((s) => s.args[0] === '/installtunnelservice');
    if (wg && !existsSync(wg.file)) await this.installWindows();
    const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const lines: string[] = [];
    // A watchdog, started once with the first tunnel: if Keeper's process goes away, it removes
    // Keeper's tunnels, name rules, firewall rules and NAT (all found by their fixed names).
    if (wg && !this.winWatch) {
      const cleanup = [
        `Get-Service -Name 'WireGuardTunnel$Keeper-*' -ErrorAction SilentlyContinue | ForEach-Object { & ${psq(wg.file)} /uninstalltunnelservice ($_.Name -replace '^WireGuardTunnel\\$','') }`,
        `Get-DnsClientNrptRule | Where-Object Comment -eq ${psq(NAMES.nrpt)} | Remove-DnsClientNrptRule -Force`,
        `Get-NetFirewallRule -Group ${psq(NAMES.winGroup)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
        `Get-NetNat -Name ${psq(NAMES.winNat)} -ErrorAction SilentlyContinue | Remove-NetNat -Confirm:$false`,
      ].join('; ');
      const loop = `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 3 }; ${cleanup}`;
      lines.push(`Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',${psq(loop)})`);
      this.winWatch = true;
    }
    for (const s of steps) {
      const cmd = s.file === 'powershell' ? s.args[s.args.length - 1] : `& ${psq(s.file)} ${s.args.map(psq).join(' ')}`;
      lines.push(s.ignoreError ? `try { ${cmd} } catch { }` : `${cmd}; if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw ${psq(s.file + ' failed')} }`);
    }
    return this.o.elevate([{ file: 'powershell', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('\n')], admin: true }]);
  }

  /** WireGuard for Windows: the official installer, checked against its pinned SHA-256, installed quietly. */
  private async installWindows() {
    const f = wireguardWindows(this.o.arch ?? process.arch);
    if (!f) throw new Error('WireGuard for Windows is not made for this computer');
    const msi = await download(f.url, f.sha256, path.join(this.o.dir, 'bin', path.basename(new URL(f.url).pathname)));
    const r = await this.o.elevate([{ file: 'msiexec', args: ['/i', msi, '/qn', 'DO_NOT_LAUNCH=1'], admin: true }]);
    if (!r.ok) throw new Error(r.message || 'WireGuard for Windows was not installed');
  }

  // ---------------------------------------------------------------- the helper

  private socketPath() {
    const uid = process.getuid?.() ?? 0;
    return this.os === 'darwin' ? `/var/run/keeper-meshd-${uid}.sock` : `/run/keeper-mesh-${uid}.sock`;
  }

  private async ensureHelper(): Promise<HelperClient> {
    if (this.helper?.alive) return this.helper;
    const sock = this.socketPath();
    let c = await HelperClient.connect(sock).catch(() => null);
    if (!c) {
      await this.startHelper(sock);
      for (let i = 0; i < 1200 && !c; i++) {
        await new Promise((r) => setTimeout(r, 100));
        c = await HelperClient.connect(sock).catch(() => null);
      }
      if (!c) throw new Error('The administrator prompt was cancelled, so the network card was not set up');
    }
    await c.request('attach', { pid: process.pid });
    this.helper = c;
    return c;
  }

  private async startHelper(sock: string) {
    const uid = process.getuid?.() ?? 0;
    const pinned = wireguardGoBuild(this.o.platform ?? process.platform, this.o.arch ?? process.arch);
    const args = {
      uid,
      pid: process.pid,
      socket: sock,
      os: this.os,
      state: this.os === 'darwin' ? '/Library/Application Support/Keeper/mesh' : '/var/lib/keeper-mesh',
      wg: this.wgTool,
      ...(this.wgGo && pinned && this.wgGo.includes(pinned.sha256.slice(0, 12)) ? { wgGo: { path: this.wgGo, sha256: pinned.sha256 } } : {}),
    };
    // a system wireguard-go (root-owned, from a package) is used where it is
    if (this.wgGo && !('wgGo' in args)) Object.assign(args, { wgGo: { path: this.wgGo, sha256: crypto.createHash('sha256').update(readFileSync(this.wgGo)).digest('hex') } });
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (uid === 0) {
      spawn(process.execPath, [this.o.helper, JSON.stringify(args)], { env, detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (this.os === 'linux') {
      spawn('pkexec', ['env', 'ELECTRON_RUN_AS_NODE=1', process.execPath, this.o.helper, JSON.stringify(args)], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    await this.installMacDaemon(args);
  }

  /**
   * macOS: a LaunchDaemon, installed once with the administrator dialog. The
   * helper and the runtime it runs with must belong to the administrator, or
   * anything running as you could change what runs as root; Keeper checks.
   */
  private async installMacDaemon(args: Record<string, unknown>) {
    if (statSync(process.execPath).uid !== 0) throw new Error('Move Keeper to Applications (installed by an administrator) before turning on the mesh network card');
    const label = 'org.ashforde.keeper.meshd';
    const dst = `/Library/PrivilegedHelperTools/${label}.cjs`;
    const tpl = await fsp.readFile(path.join(path.dirname(this.o.helper), 'mesh-helper.plist'), 'utf8').catch(() => '');
    const plist = tpl
      .replace('@RUNTIME@', process.execPath)
      .replace('@HELPER@', dst)
      .replace('@ARGS@', JSON.stringify({ ...args, daemon: true, pid: undefined }).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const r = await this.o.elevate([
      { file: '/bin/mkdir', args: ['-p', '/Library/PrivilegedHelperTools'], admin: true },
      { file: '/bin/cp', args: [this.o.helper, dst], admin: true },
      { file: '/usr/sbin/chown', args: ['root:wheel', dst], admin: true },
      { file: '/bin/chmod', args: ['644', dst], admin: true },
      { file: '/bin/sh', args: ['-c', `cat > /Library/LaunchDaemons/${label}.plist <<'KEEPER_EOF'\n${plist}\nKEEPER_EOF`], admin: true },
      { file: '/bin/launchctl', args: ['bootstrap', 'system', `/Library/LaunchDaemons/${label}.plist`], admin: true },
    ]);
    if (!r.ok) throw new Error(r.message);
  }

  // ---------------------------------------------------------------- reading the system

  async readHosts() {
    return fsp.readFile(this.os === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts', 'utf8');
  }

  async localPrefixes(): Promise<string[]> {
    const out = new Set<string>();
    for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (!a.internal && a.cidr) out.add(a.cidr);
    if (this.os === 'linux') {
      for (const fam of ['-4', '-6']) {
        const r = await run('ip', ['-j', fam, 'route', 'show', 'table', 'all']);
        try {
          for (const e of JSON.parse(r.out) as { dst: string; type?: string }[]) if (e.dst && e.dst !== 'default' && (!e.type || e.type === 'unicast')) out.add(e.dst.includes('/') ? e.dst : `${e.dst}/${fam === '-4' ? 32 : 128}`);
        } catch {
          /* no ip tool */
        }
      }
    } else if (this.os === 'darwin') {
      const r = await run('/usr/sbin/netstat', ['-rn', '-f', 'inet']);
      for (const l of r.out.split('\n')) {
        const d = l.trim().split(/\s+/)[0];
        if (/^\d+(\.\d+){0,3}(\/\d+)?$/.test(d)) {
          const parts = d.split('/')[0].split('.');
          const pfx = d.includes('/') ? Number(d.split('/')[1]) : parts.length * 8;
          out.add(`${[...parts, '0', '0', '0'].slice(0, 4).join('.')}/${pfx}`);
        }
      }
    }
    return [...out];
  }

  async defaults() {
    const lan = (await this.localPrefixes()).filter((c) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|f[cd])/i.test(c));
    if (this.os === 'linux') {
      const r4 = await run('ip', ['-j', '-4', 'route', 'show', 'default']);
      const r6 = await run('ip', ['-j', '-6', 'route', 'show', 'default']);
      const d4 = safeJson<{ gateway?: string; dev?: string }[]>(r4.out)?.[0];
      const d6 = safeJson<{ gateway?: string; dev?: string }[]>(r6.out)?.[0];
      const read = (p: string) => fsp.readFile(p, 'utf8').then((t) => t.trim(), () => undefined);
      return { gw4: d4?.gateway, gw6: d6?.gateway, wan: d4?.dev ?? d6?.dev, lan, forwarding: { v4: await read('/proc/sys/net/ipv4/ip_forward'), v6: await read('/proc/sys/net/ipv6/conf/all/forwarding') } };
    }
    if (this.os === 'darwin') {
      const r = await run('/sbin/route', ['-n', 'get', 'default']);
      const gw4 = r.out.match(/gateway:\s*(\S+)/)?.[1];
      const wan = r.out.match(/interface:\s*(\S+)/)?.[1];
      const list = await run('/usr/sbin/networksetup', ['-listallnetworkservices']);
      const services: { name: string; before: string[] }[] = [];
      for (const name of list.out.split('\n').slice(1).map((x) => x.trim()).filter((x) => x && !x.startsWith('*'))) {
        const d = await run('/usr/sbin/networksetup', ['-getdnsservers', name]);
        services.push({ name, before: /There aren't any/.test(d.out) ? [] : d.out.split('\n').map((x) => x.trim()).filter(Boolean) });
      }
      const fw = await run('/usr/sbin/sysctl', ['-n', 'net.inet.ip.forwarding', 'net.inet6.ip6.forwarding']);
      const [v4, v6] = fw.out.split('\n').map((x) => x.trim());
      return { gw4, wan, lan, services, forwarding: { v4, v6 } };
    }
    return { lan };
  }

  async stats(iface: string, impl: string): Promise<WgPeerStats[]> {
    if (this.os === 'win32') {
      const exe = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wg.exe');
      const r = await run(exe, ['show', iface, 'dump']);
      return r.ok ? parseWgDump(r.out) : [];
    }
    if (!this.helper?.alive) return [];
    const r = await this.helper.request('run', { steps: [impl === 'kernel' ? { file: this.wgTool ?? 'wg', args: ['show', iface, 'dump'] } : { file: 'uapi', args: [iface], stdin: 'get=1\n\n' }] });
    const out = r.outputs?.[0] ?? '';
    return impl === 'kernel' ? parseWgDump(out) : parseUapiGet(out);
  }

  async ping(addr: string): Promise<MeshDiag> {
    const args = this.os === 'win32' ? ['-n', '3', addr] : ['-c', '3', '-W', this.os === 'darwin' ? '1000' : '1', addr];
    const r = await run(this.os === 'darwin' && addr.includes(':') ? '/sbin/ping6' : 'ping', this.os === 'darwin' && addr.includes(':') ? ['-c', '3', addr] : args, 15_000);
    const lines = (r.out || r.err).trim().split('\n').filter((l) => /bytes from|time[=<]|loss|Reply/i.test(l)).slice(-4);
    return { ok: r.ok, lines: lines.length ? lines : [r.ok ? 'Replies came back' : 'No reply'] };
  }

  async mtu(addr: string): Promise<MeshDiag> {
    if (addr.includes(':')) return { ok: true, lines: ['MTU probing uses IPv4; this device has an IPv6 mesh address only. The mesh MTU is 1280.'] };
    const probe = async (size: number) => {
      const args = this.os === 'win32' ? ['-n', '1', '-f', '-l', String(size), addr] : this.os === 'darwin' ? ['-c', '1', '-D', '-s', String(size), addr] : ['-c', '1', '-W', '1', '-M', 'do', '-s', String(size), addr];
      return (await run('ping', args, 5000)).ok;
    };
    let lo = 548;
    let hi = 1452;
    if (!(await probe(lo))) return { ok: false, lines: ['Even small packets do not get through'] };
    while (hi - lo > 4) {
      const mid = (lo + hi) >> 1;
      if (await probe(mid)) lo = mid;
      else hi = mid;
    }
    return { ok: true, lines: [`The largest packet that gets through whole: ${lo + 28} bytes (payload ${lo})`] };
  }
}

const safeJson = <T>(s: string): T | undefined => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
};

/** Downloads a file and keeps it only if its SHA-256 matches; returns the path. */
export async function download(url: string, sha256: string, dest: string, fetchFn: typeof fetch = fetch): Promise<string> {
  if (existsSync(dest)) {
    const have = crypto.createHash('sha256').update(await fsp.readFile(dest)).digest('hex');
    if (have === sha256) return dest;
    await fsp.rm(dest, { force: true });
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`Could not download ${path.basename(dest)} (${res.status})`);
  const hash = crypto.createHash('sha256');
  const tmp = `${dest}.download`;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (c: Buffer) => hash.update(c));
  await pipeline(body, createWriteStream(tmp));
  if (hash.digest('hex') !== sha256) {
    await fsp.rm(tmp, { force: true });
    throw new Error(`${path.basename(dest)} did not match its pinned checksum, so it was not used`);
  }
  await fsp.rename(tmp, dest);
  await fsp.chmod(dest, 0o755).catch(() => undefined);
  return dest;
}

/** Talks to the helper over its Unix socket: one JSON line per request and answer. */
export class HelperClient {
  private next = 1;
  private waits = new Map<number, (r: { ok: boolean; message: string; outputs?: string[] }) => void>();
  alive = true;

  private constructor(private s: net.Socket) {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const r = JSON.parse(line) as { id: number; ok: boolean; message: string; outputs?: string[] };
          this.waits.get(r.id)?.(r);
          this.waits.delete(r.id);
        } catch {
          /* ignore */
        }
      }
    });
    s.on('close', () => {
      this.alive = false;
      for (const w of this.waits.values()) w({ ok: false, message: 'The mesh helper stopped' });
      this.waits.clear();
    });
    s.on('error', () => undefined);
  }

  static connect(p: string): Promise<HelperClient> {
    return new Promise((resolve, reject) => {
      const s = net.connect(p);
      s.once('connect', () => resolve(new HelperClient(s)));
      s.once('error', reject);
    });
  }

  request(op: string, body: Record<string, unknown>, timeoutMs = 120_000): Promise<{ ok: boolean; message: string; outputs?: string[] }> {
    const id = this.next++;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waits.delete(id);
        resolve({ ok: false, message: 'The mesh helper did not answer' });
      }, timeoutMs);
      this.waits.set(id, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      this.s.write(JSON.stringify({ id, op, ...body }) + '\n');
    });
  }

  close() {
    this.s.end();
  }
}
