// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading the network from each operating system, as cheaply as it allows:
// Linux from /proc (plus ss and ip when installed), macOS from nettop and
// netstat, Windows from netstat and route. One or two commands per reading.

import { existsSync, promises as fsp, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { familyOf, maskToPrefix } from '../../../core/net/addr';
import {
  parseBsdNetstatRoutes, parseGetDnsServers, parseGetVpnConnection, parseIpRouteGet, parseLsofF, parseNetshWlan, parseNetstatAno, parseNetstatE, parseNetstatIbn,
  parseNettop, parseNmcliConnections, parseNmcliWifi, parseProcNet, parseProcNetDev, parseProcRoute, parseProcRoute6, parseProcWireless, parseResolvConf,
  parseResolvectlDns, parseRoutePrint, parseScutilDns, parseScutilNcList, parseSs, parseWgDump, parseAirport, type DnsServer, type WifiInfo,
} from '../../../core/net/parse';
import { classifyIface, internetIface } from '../../../core/net/route';
import type { IfaceKind, NetConn, NetIface, RouteEntry, VpnConn } from '../../../core/net/types';
import { powershell, run } from '../../../core/platform';

export const PLATFORM = process.platform;

const which = new Map<string, string | null>();
/** Path of a command-line tool, or null when it isn't installed (checked once). */
export function tool(name: string): string | null {
  if (which.has(name)) return which.get(name)!;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).concat(PLATFORM === 'win32' ? [] : ['/usr/sbin', '/sbin', '/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin']);
  const exts = PLATFORM === 'win32' ? ['.exe', '.cmd', ''] : [''];
  let found: string | null = null;
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      if (existsSync(p)) { found = p; break; }
    }
    if (found) break;
  }
  which.set(name, found);
  return found;
}

const readText = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------- processes

export interface ProcInfo { name: string; path?: string }

let procCache: { at: number; map: Map<number, ProcInfo> } = { at: 0, map: new Map() };

/** Names (and, where cheap, paths) of running processes. Refreshed at most every few seconds. */
export async function processNames(maxAgeMs = 5000): Promise<Map<number, ProcInfo>> {
  if (Date.now() - procCache.at < maxAgeMs) return procCache.map;
  const map = new Map<number, ProcInfo>();
  if (PLATFORM === 'linux') {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const name = readText(`/proc/${d}/comm`).trim();
      if (!name) continue;
      let exe: string | undefined;
      try {
        exe = readlinkSync(`/proc/${d}/exe`);
      } catch {
        /* not ours */
      }
      map.set(Number(d), { name, path: exe });
    }
  } else if (PLATFORM === 'darwin') {
    const r = await run('/bin/ps', ['-axo', 'pid=,comm='], 5000);
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/);
      if (m) map.set(Number(m[1]), { name: path.basename(m[2]), path: m[2].startsWith('/') ? m[2] : undefined });
    }
  } else if (PLATFORM === 'win32') {
    const r = await run('tasklist', ['/fo', 'csv', '/nh'], 8000);
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m) map.set(Number(m[2]), { name: m[1].replace(/\.exe$/i, '') });
    }
  }
  procCache = { at: Date.now(), map };
  return map;
}

// ---------------------------------------------------------------- connections

let inodeOwner = new Map<string, number>();
let inodeScanAt = 0;

/** Linux without ss: which process owns each socket, from /proc/<pid>/fd. Only your own processes are readable. */
function scanInodes(): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${d}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const l = readlinkSync(`/proc/${d}/fd/${fd}`);
        if (l.startsWith('socket:[')) out.set(l.slice(8, -1), Number(d));
      } catch {
        /* closed meanwhile */
      }
    }
  }
  return out;
}

export interface ConnReading {
  conns: NetConn[];
  /** how finely bytes are counted */
  amounts: 'connection' | 'process' | 'interface' | 'none';
  notes: string[];
}

export async function readConnections(): Promise<ConnReading> {
  const notes: string[] = [];
  if (PLATFORM === 'linux') {
    const ss = tool('ss');
    if (ss) {
      const r = await run(ss, ['-tunapiOH'], 8000);
      if (r.ok || r.stdout) {
        const conns = parseSs(r.stdout);
        if (conns.some((c) => c.pid === undefined && c.state !== 'Listen')) notes.push('Other users\' and system programs are shown without a name: Linux only tells you about your own.');
        return { conns, amounts: 'connection', notes };
      }
    }
    const conns = [
      ...parseProcNet(readText('/proc/net/tcp'), 'TCP', 4), ...parseProcNet(readText('/proc/net/tcp6'), 'TCP', 6),
      ...parseProcNet(readText('/proc/net/udp'), 'UDP', 4), ...parseProcNet(readText('/proc/net/udp6'), 'UDP', 6),
    ];
    // Map sockets to processes; a full scan only when new sockets turn up, at most every 2 s.
    const unknown = conns.some((c) => c.inode && c.inode !== '0' && !inodeOwner.has(c.inode));
    if (unknown && Date.now() - inodeScanAt > 2000) { inodeOwner = scanInodes(); inodeScanAt = Date.now(); }
    for (const c of conns) if (c.inode) c.pid = inodeOwner.get(c.inode);
    notes.push('Amounts per app need the "ss" tool (iproute2); install it to see how much each connection moves.');
    return { conns, amounts: 'interface', notes };
  }
  if (PLATFORM === 'darwin') {
    const r = await run('/usr/bin/nettop', ['-L', '1', '-x', '-n', '-J', 'interface,state,bytes_in,bytes_out'], 8000);
    if (r.ok && r.stdout.includes('<->')) return { conns: parseNettop(r.stdout).conns, amounts: 'connection', notes };
    const l = await run('/usr/sbin/lsof', ['-nP', '-iTCP', '-iUDP', '-T', 's', '-F', 'pcPtnT'], 8000);
    notes.push('Without nettop only your own apps\' connections are listed, without amounts.');
    return { conns: parseLsofF(l.stdout), amounts: 'none', notes };
  }
  if (PLATFORM === 'win32') {
    const r = await run('netstat', ['-ano'], 8000);
    notes.push('Windows only counts bytes per app with administrator access; amounts here are for the whole computer.');
    return { conns: parseNetstatAno(r.stdout), amounts: 'interface', notes };
  }
  return { conns: [], amounts: 'none', notes: ['This system is not supported yet.'] };
}

// ---------------------------------------------------------------- routes and interfaces

let routeCache: { at: number; routes: RouteEntry[]; descriptions: Map<string, string> } = { at: 0, routes: [], descriptions: new Map() };

export async function readRoutes(maxAgeMs = 5000): Promise<{ routes: RouteEntry[]; descriptions: Map<string, string> }> {
  if (Date.now() - routeCache.at < maxAgeMs) return routeCache;
  let routes: RouteEntry[] = [];
  const descriptions = new Map<string, string>();
  if (PLATFORM === 'linux') {
    routes = [...parseProcRoute(readText('/proc/net/route')), ...parseProcRoute6(readText('/proc/net/ipv6_route'))];
  } else if (PLATFORM === 'darwin') {
    routes = parseBsdNetstatRoutes((await run('/usr/sbin/netstat', ['-rn'], 5000)).stdout);
  } else if (PLATFORM === 'win32') {
    const p = parseRoutePrint((await run('route', ['print'], 8000)).stdout);
    // IPv4 routes name the interface by its own address; use the interface's name instead.
    const byAddr = new Map<string, string>();
    for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list ?? []) byAddr.set(a.address, name);
    routes = p.routes.map((r) => (r.family === 4 && byAddr.has(r.iface) ? { ...r, iface: byAddr.get(r.iface)! } : r));
    for (const [idx, desc] of p.ifaces) descriptions.set(`#${idx}`, desc);
  }
  routeCache = { at: Date.now(), routes, descriptions };
  return routeCache;
}

const routeGetCache = new Map<string, { at: number; iface?: string; gateway?: string }>();

/**
 * Linux policy routing (as wg-quick sets up) keeps the tunnel's default route
 * in another table that /proc/net/route doesn't show; `ip route get` asks the
 * kernel itself. Cached per address for a minute, a few new ones per reading.
 */
export async function preciseRoutes(addrs: string[], budget = 12): Promise<Map<string, { iface?: string; gateway?: string }>> {
  const out = new Map<string, { iface?: string; gateway?: string }>();
  const ip = PLATFORM === 'linux' ? tool('ip') : null;
  if (!ip) return out;
  const now = Date.now();
  const todo: string[] = [];
  for (const a of new Set(addrs)) {
    const c = routeGetCache.get(a);
    if (c && now - c.at < 60_000) out.set(a, c);
    else todo.push(a);
  }
  await Promise.all(todo.slice(0, budget).map(async (a) => {
    const r = await run(ip, ['route', 'get', a], 3000);
    if (!r.ok) return;
    const g = parseIpRouteGet(r.stdout);
    const v = { at: now, iface: g.iface, gateway: g.gateway };
    routeGetCache.set(a, v);
    out.set(a, v);
  }));
  if (routeGetCache.size > 2000) routeGetCache.clear();
  return out;
}

let wifiNames: Set<string> | null = null;

async function wifiIfaces(): Promise<Set<string>> {
  if (wifiNames) return wifiNames;
  const s = new Set<string>();
  if (PLATFORM === 'linux') {
    try {
      for (const n of readdirSync('/sys/class/net')) if (existsSync(`/sys/class/net/${n}/wireless`) || existsSync(`/sys/class/net/${n}/phy80211`)) s.add(n);
    } catch {
      /* no sysfs */
    }
  } else if (PLATFORM === 'darwin') {
    const r = await run('/usr/sbin/networksetup', ['-listallhardwareports'], 5000);
    for (const m of r.stdout.matchAll(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/g)) s.add(m[1]);
  }
  wifiNames = s;
  return s;
}

let ifaceBytes: { at: number; map: Map<string, { rx: number; tx: number }> } = { at: 0, map: new Map() };

/** Bytes per interface (Windows: only the whole computer, under the name "all"). */
export async function readIfaceBytes(): Promise<{ at: number; map: Map<string, { rx: number; tx: number }> }> {
  let map = new Map<string, { rx: number; tx: number }>();
  if (PLATFORM === 'linux') map = parseProcNetDev(readText('/proc/net/dev'));
  else if (PLATFORM === 'darwin') map = parseNetstatIbn((await run('/usr/sbin/netstat', ['-ibn'], 5000)).stdout);
  else if (PLATFORM === 'win32') {
    const t = parseNetstatE((await run('netstat', ['-e'], 5000)).stdout);
    if (t) map.set('all', t);
  }
  ifaceBytes = { at: Date.now(), map };
  return ifaceBytes;
}

/**
 * Every network interface with what kind it is. `vpnIfaces` (from the VPN
 * list) and the routing table promote macOS utun interfaces that carry the
 * default route to "vpn".
 */
export async function readIfaces(routes: RouteEntry[], descriptions: Map<string, string>, vpnIfaces = new Set<string>()): Promise<NetIface[]> {
  const wifi = await wifiIfaces();
  const viaTunnel = new Set([internetIface(routes, 4), internetIface(routes, 6)].filter(Boolean) as string[]);
  const out: NetIface[] = [];
  const raw = os.networkInterfaces();
  const names = new Set([...Object.keys(raw), ...routes.map((r) => r.iface).filter((n) => !n.startsWith('#'))]);
  for (const name of names) {
    const list = raw[name] ?? [];
    let kind: IfaceKind = classifyIface(name, { platform: PLATFORM, wifi, vpnIfaces, description: descriptions.get(name) });
    if (kind === 'tunnel' && viaTunnel.has(name)) kind = 'vpn';
    let up = list.length > 0;
    if (PLATFORM === 'linux') {
      const st = readText(`/sys/class/net/${name}/operstate`).trim();
      if (st) up = st === 'up' || st === 'unknown';
    }
    out.push({
      name, kind, up, mac: list.find((a) => a.mac && a.mac !== '00:00:00:00:00:00')?.mac,
      addresses: list.map((a) => ({ address: a.address, family: a.family === 'IPv6' || (a.family as unknown) === 6 ? 6 as const : 4 as const, prefix: a.cidr ? Number(a.cidr.split('/')[1]) : a.netmask ? maskToPrefix(a.netmask) : undefined })),
      label: labelFor(name, kind, descriptions.get(name)),
    });
  }
  // Windows IPv6 routes name interfaces by number; give them an entry so they can be classified.
  for (const [k, d] of descriptions) if (!out.some((i) => i.name === k)) out.push({ name: k, kind: classifyIface(k, { description: d }), up: true, addresses: [], label: d });
  return out;
}

function labelFor(name: string, kind: IfaceKind, desc?: string): string {
  if (desc) return desc;
  if (kind === 'wifi') return 'Wi-Fi';
  if (kind === 'ethernet') return 'Ethernet';
  if (kind === 'loopback') return 'This computer';
  if (kind === 'vpn') return 'VPN';
  if (kind === 'tunnel') return 'Tunnel';
  if (kind === 'cellular') return 'Mobile data';
  if (kind === 'virtual') return 'Virtual';
  return name;
}

// ---------------------------------------------------------------- DNS and Wi-Fi

export async function readDns(): Promise<DnsServer[]> {
  if (PLATFORM === 'darwin') return parseScutilDns((await run('/usr/sbin/scutil', ['--dns'], 5000)).stdout);
  if (PLATFORM === 'win32') return parseGetDnsServers((await powershell('Get-DnsClientServerAddress | Select-Object InterfaceAlias,AddressFamily,ServerAddresses | ConvertTo-Json -Compress', 15_000)).stdout);
  const conf = parseResolvConf(readText('/etc/resolv.conf'));
  // A local stub (systemd-resolved) forwards to the real servers; ask it which ones and on which links.
  if (conf.some((d) => d.address.startsWith('127.')) && tool('resolvectl')) {
    const r = await run(tool('resolvectl')!, ['dns'], 4000);
    const real = parseResolvectlDns(r.stdout);
    if (real.length) return real;
  }
  return conf;
}

export async function readWifi(): Promise<WifiInfo | undefined> {
  if (PLATFORM === 'linux') {
    if (tool('nmcli')) {
      const r = await run(tool('nmcli')!, ['-t', '-f', 'ACTIVE,SSID,SIGNAL,CHAN,RATE,SECURITY', 'device', 'wifi'], 4000);
      const w = parseNmcliWifi(r.stdout);
      if (w) return w;
    }
    const q = [...parseProcWireless(readText('/proc/net/wireless')).values()][0];
    return q ? { signal: Math.round((q.quality / 70) * 100), signalDbm: q.level } : undefined;
  }
  if (PLATFORM === 'darwin') return parseAirport((await run('/usr/sbin/system_profiler', ['SPAirPortDataType'], 10_000)).stdout);
  if (PLATFORM === 'win32') return parseNetshWlan((await run('netsh', ['wlan', 'show', 'interfaces'], 5000)).stdout);
  return undefined;
}

// ---------------------------------------------------------------- VPNs

export async function readVpns(): Promise<{ vpns: VpnConn[]; notes: string[] }> {
  const notes: string[] = [];
  const vpns: VpnConn[] = [];
  if (PLATFORM === 'linux') {
    const nm = tool('nmcli');
    if (nm) {
      const r = await run(nm, ['-t', '-f', 'NAME,UUID,TYPE,DEVICE,STATE', 'connection', 'show'], 5000);
      if (r.ok) vpns.push(...parseNmcliConnections(r.stdout));
      else notes.push('NetworkManager is installed but not running, so its VPN connections can\'t be listed.');
    } else notes.push('NetworkManager (nmcli) is not installed, so VPN connections can\'t be listed or switched here.');
    const wg = tool('wg');
    if (wg) {
      const r = await run(wg, ['show', 'all', 'dump'], 4000);
      if (r.ok) {
        for (const [iface, w] of parseWgDump(r.stdout)) {
          const v = vpns.find((x) => x.iface === iface);
          if (v) v.wg = { peers: w.peers };
          else vpns.push({ id: `wg:${iface}`, name: iface, type: 'wireguard', state: 'connected', iface, source: 'wg', wg: { peers: w.peers } });
        }
      } else if (/permission|not permitted/i.test(r.stderr)) notes.push('WireGuard details (peers, last handshake) need administrator access on Linux.');
    }
    // wg-quick tunnels that are up show as interfaces even when wg can't be read.
    for (const n of Object.keys(os.networkInterfaces())) {
      if (/^wg/.test(n) && !vpns.some((v) => v.iface === n)) vpns.push({ id: `wg:${n}`, name: n, type: 'wireguard', state: 'connected', iface: n, source: 'wg' });
    }
  } else if (PLATFORM === 'darwin') {
    vpns.push(...parseScutilNcList((await run('/usr/sbin/scutil', ['--nc', 'list'], 5000)).stdout));
  } else if (PLATFORM === 'win32') {
    const r = await powershell('@(Get-VpnConnection) + @(Get-VpnConnection -AllUserConnection -ErrorAction SilentlyContinue) | Select-Object Name,ServerAddress,TunnelType,ConnectionStatus,Guid | ConvertTo-Json -Compress', 20_000);
    vpns.push(...parseGetVpnConnection(r.stdout));
    const sc = await run('sc', ['queryex', 'type=', 'service', 'state=', 'all'], 8000);
    for (const m of sc.stdout.matchAll(/SERVICE_NAME:\s*WireGuardTunnel\$(\S+)[\s\S]*?STATE\s*:\s*\d+\s+(\w+)/g)) {
      vpns.push({ id: `wgsvc:${m[1]}`, name: m[1], type: 'wireguard', state: m[2] === 'RUNNING' ? 'connected' : m[2].includes('PENDING') ? 'connecting' : 'disconnected', source: 'wireguard-service', iface: m[1] });
    }
  }
  return { vpns, notes };
}

export async function vpnConnect(v: VpnConn, up: boolean): Promise<{ ok: boolean; message?: string; needsAdmin?: boolean }> {
  if (v.source === 'networkmanager') {
    const nm = tool('nmcli')!;
    let r = await run(nm, ['connection', up ? 'up' : 'down', 'uuid', v.id], 60_000);
    if (!r.ok && /not authorized|insufficient privileges/i.test(r.stderr) && tool('pkexec')) r = await run(tool('pkexec')!, [nm, 'connection', up ? 'up' : 'down', 'uuid', v.id], 120_000);
    return r.ok ? { ok: true } : { ok: false, message: (r.stderr || r.stdout).trim().split('\n').pop(), needsAdmin: /not authorized/i.test(r.stderr) };
  }
  if (v.source === 'wg') {
    const q = tool('wg-quick');
    const pk = tool('pkexec');
    if (!q || !pk) return { ok: false, message: 'Switching wg-quick tunnels needs wg-quick and an administrator prompt (pkexec).' };
    const r = await run(pk, [q, up ? 'up' : 'down', v.name], 120_000);
    return r.ok ? { ok: true } : { ok: false, message: r.stderr.trim().split('\n').pop(), needsAdmin: true };
  }
  if (v.source === 'scutil') {
    const r = await run('/usr/sbin/scutil', ['--nc', up ? 'start' : 'stop', v.id], 30_000);
    return r.ok ? { ok: true } : { ok: false, message: (r.stderr || r.stdout).trim() || 'macOS did not start the VPN (it may need a password in its own app).' };
  }
  if (v.source === 'windows-ras') {
    const r = await run('rasdial', up ? [v.name] : [v.name, '/disconnect'], 60_000);
    return r.ok ? { ok: true } : { ok: false, message: r.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? 'Windows refused.' };
  }
  if (v.source === 'wireguard-service') {
    const svc = `WireGuardTunnel$${v.name}`.replace(/'/g, "''");
    const cmd = up ? `Start-Service -Name '${svc}'` : `Stop-Service -Name '${svc}'`;
    const r = await powershell(`try { $p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command',"${cmd.replace(/"/g, '`"')}" -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } catch { exit 5 }`, 120_000);
    return r.ok ? { ok: true } : { ok: false, message: 'Windows needs administrator approval to switch WireGuard tunnels.', needsAdmin: true };
  }
  return { ok: false, message: 'Keeper can\'t switch this connection; use the app that manages it.' };
}

export async function readFileSafe(p: string): Promise<string> {
  return fsp.readFile(p, 'utf8');
}

export { familyOf };
