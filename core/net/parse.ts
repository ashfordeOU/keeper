// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Readers for what each operating system says about its network: open
// connections and who owns them, bytes moved, routing tables, DNS servers,
// VPN connections and Wi-Fi. Pure functions, tested against real output.

import { bigToV6, maskToPrefix, procHexAddr, splitHostPort, unmapV4, v4ToInt } from './addr';
import type { NetConn, ProcBytes, RouteEntry, VpnConn } from './types';

const TCP_STATES: Record<string, string> = {
  '01': 'Established', '02': 'SynSent', '03': 'SynReceived', '04': 'FinWait1', '05': 'FinWait2', '06': 'TimeWait',
  '07': 'Closed', '08': 'CloseWait', '09': 'LastAck', '0A': 'Listen', '0B': 'Closing', '0C': 'NewSynReceived',
};

/** Normalises the many spellings of TCP states to one. */
export function normState(s: string | number | undefined): string | undefined {
  if (s === undefined || s === '') return undefined;
  if (typeof s === 'number') {
    // Windows MIB_TCP_STATE as PowerShell writes it in JSON.
    return ({ 1: 'Closed', 2: 'Listen', 3: 'SynSent', 4: 'SynReceived', 5: 'Established', 6: 'FinWait1', 7: 'FinWait2', 8: 'CloseWait', 9: 'Closing', 10: 'LastAck', 11: 'TimeWait', 12: 'DeleteTcb', 100: 'Bound' } as Record<number, string>)[s];
  }
  const k = s.replace(/[-_ ]/g, '').toLowerCase();
  const map: Record<string, string> = {
    estab: 'Established', established: 'Established', listen: 'Listen', listening: 'Listen', synsent: 'SynSent', synrecv: 'SynReceived',
    synreceived: 'SynReceived', finwait1: 'FinWait1', finwait2: 'FinWait2', timewait: 'TimeWait', close: 'Closed', closed: 'Closed',
    closewait: 'CloseWait', lastack: 'LastAck', closing: 'Closing', unconn: undefined as unknown as string, bound: 'Bound',
  };
  return k in map ? map[k] : s;
}

// ---------------------------------------------------------------- Linux

/** /proc/net/tcp, tcp6, udp, udp6. */
export function parseProcNet(text: string, proto: 'TCP' | 'UDP', family: 4 | 6): NetConn[] {
  const out: NetConn[] = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const l = procHexAddr(f[1]);
    const r = procHexAddr(f[2]);
    const remoteSet = !/^0+:0000$/.test(f[2]);
    out.push({
      proto, family, local: l.ip, localPort: l.port,
      remote: remoteSet ? r.ip : undefined, remotePort: remoteSet ? r.port : undefined,
      state: proto === 'TCP' ? TCP_STATES[f[3].toUpperCase()] : remoteSet ? 'Established' : undefined,
      uid: Number(f[7]), inode: f[9],
    });
  }
  return out;
}

/**
 * `ss -tunapiOH` (one socket per line with -O): owner from users:((…)), and
 * per-connection byte counts from the TCP info fields.
 */
export function parseSs(text: string): NetConn[] {
  const out: NetConn[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^(Netid|State)\b/.test(line)) continue;
    const tok = line.split(/\s+/);
    let i = 0;
    let proto: 'TCP' | 'UDP' = 'TCP';
    if (/^(tcp|udp|raw|u_str|u_dgr|u_seq|nl|p_raw|p_dgr|mptcp)$/.test(tok[0])) {
      if (!/^(tcp|udp|mptcp)$/.test(tok[0])) continue;
      proto = tok[0] === 'udp' ? 'UDP' : 'TCP';
      i = 1;
    }
    const state = tok[i];
    const local = splitHostPort(tok[i + 3] ?? '');
    const peer = splitHostPort(tok[i + 4] ?? '');
    if (!local.host) continue;
    const lh = unmapV4(local.host.replace(/%.*$/, ''));
    const ph = peer.host === '*' ? undefined : unmapV4(peer.host.replace(/%.*$/, ''));
    const users = line.match(/users:\(\("([^"]*)",pid=(\d+)/);
    const num = (k: string) => {
      const m = line.match(new RegExp(`\\b${k}:(\\d+)`));
      return m ? Number(m[1]) : undefined;
    };
    out.push({
      proto, family: lh.includes(':') ? 6 : 4, local: lh === '*' ? '0.0.0.0' : lh, localPort: local.port ?? 0,
      remote: ph && !/^(0\.0\.0\.0|::)$/.test(ph) ? ph : undefined, remotePort: ph && peer.port ? peer.port : undefined,
      state: normState(state === 'UNCONN' ? undefined : state),
      pid: users ? Number(users[2]) : undefined, name: users?.[1],
      bytesIn: num('bytes_received'), bytesOut: num('bytes_acked') ?? num('bytes_sent'),
    });
  }
  return out;
}

/** /proc/net/route (IPv4; little-endian hex). */
export function parseProcRoute(text: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  const hex = (h: string) => {
    const n = parseInt(h, 16);
    return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.');
  };
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8) continue;
    const flags = parseInt(f[3], 16);
    if (!(flags & 1)) continue; // RTF_UP
    const gw = hex(f[2]);
    out.push({ family: 4, iface: f[0], dest: hex(f[1]), prefix: maskToPrefix(hex(f[7])), gateway: gw === '0.0.0.0' ? undefined : gw, metric: Number(f[6]) });
  }
  return out;
}

/** /proc/net/ipv6_route (big-endian hex, prefix in hex). */
export function parseProcRoute6(text: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  const addr = (h: string) => bigToV6(BigInt('0x' + h));
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const flags = parseInt(f[8], 16);
    if (!(flags & 1)) continue;
    if (f[9] === 'lo' && f[0] !== '00000000000000000000000000000001') continue;
    const gw = addr(f[4]);
    out.push({ family: 6, iface: f[9], dest: addr(f[0]), prefix: parseInt(f[1], 16), gateway: gw === '::' ? undefined : gw, metric: parseInt(f[5], 16) });
  }
  return out;
}

/** `ip route get <addr>`: "1.1.1.1 via 192.168.1.1 dev wlan0 src 192.168.1.5 uid 1000". */
export function parseIpRouteGet(text: string): { iface?: string; gateway?: string; src?: string } {
  const first = text.split('\n')[0] ?? '';
  return { iface: first.match(/\bdev (\S+)/)?.[1], gateway: first.match(/\bvia (\S+)/)?.[1], src: first.match(/\bsrc (\S+)/)?.[1] };
}

/** /proc/net/dev: bytes per interface. */
export function parseProcNetDev(text: string): Map<string, { rx: number; tx: number }> {
  const out = new Map<string, { rx: number; tx: number }>();
  for (const line of text.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:\s]+):\s*(.*)$/);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length >= 9) out.set(m[1], { rx: f[0], tx: f[8] });
  }
  return out;
}

/** `nmcli -t -f NAME,UUID,TYPE,DEVICE,STATE connection show` (fields joined by ':' with '\:' escapes). */
export function splitNmcli(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ':') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

export function parseNmcliConnections(text: string): VpnConn[] {
  const out: VpnConn[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [name, uuid, type, device, state] = splitNmcli(line);
    if (!/^(vpn|wireguard|tun)$/.test(type ?? '')) continue;
    const st = (state ?? '').toLowerCase();
    out.push({
      id: uuid, name, type: type === 'vpn' ? 'vpn' : type, source: 'networkmanager',
      iface: device && device !== '--' ? device : undefined,
      state: st === 'activated' ? 'connected' : st === 'activating' ? 'connecting' : st === 'deactivating' ? 'disconnecting' : 'disconnected',
    });
  }
  return out;
}

/** `wg show all dump`: interface lines (5 fields) and peer lines (9 fields). Private keys are never kept. */
export function parseWgDump(text: string): Map<string, VpnConn['wg'] & { listenPort?: number; publicKey?: string }> {
  const out = new Map<string, VpnConn['wg'] & { listenPort?: number; publicKey?: string }>();
  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f.length === 5) out.set(f[0], { peers: [], publicKey: f[2], listenPort: Number(f[3]) || undefined });
    else if (f.length >= 9) {
      const w = out.get(f[0]) ?? { peers: [] };
      w.peers.push({
        publicKey: f[1], endpoint: f[3] === '(none)' ? undefined : f[3],
        allowedIps: f[4] === '(none)' ? [] : f[4].split(','), handshake: Number(f[5]) ? Number(f[5]) * 1000 : undefined,
        rx: Number(f[6]) || 0, tx: Number(f[7]) || 0,
      });
      out.set(f[0], w);
    }
  }
  return out;
}

/** Linux /proc/net/wireless: signal quality per Wi-Fi interface. */
export function parseProcWireless(text: string): Map<string, { quality: number; level: number }> {
  const out = new Map<string, { quality: number; level: number }>();
  for (const line of text.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:\s]+):\s+\S+\s+([\d.]+)\.?\s+(-?[\d.]+)\.?/);
    if (m) out.set(m[1], { quality: Number(m[2]), level: Number(m[3]) });
  }
  return out;
}

/** `nmcli -t -f ACTIVE,SSID,SIGNAL,CHAN,RATE,SECURITY device wifi`: the network in use. */
export function parseNmcliWifi(text: string): WifiInfo | undefined {
  for (const line of text.split('\n')) {
    const f = splitNmcli(line);
    if (f[0] === 'yes') return { ssid: f[1] || undefined, signal: Number(f[2]) || undefined, channel: f[3] || undefined, rate: f[4] || undefined, security: f[5] || undefined };
  }
  return undefined;
}

/** `resolvectl dns`: "Link 3 (wg0): 10.2.0.1". */
export function parseResolvectlDns(text: string): DnsServer[] {
  const out: DnsServer[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(?:Global|Link \d+ \(([^)]+)\)):\s*(.*)$/);
    if (!m) continue;
    for (const s of m[2].split(/\s+/).filter(Boolean)) out.push({ address: s.replace(/#.*$/, ''), iface: m[1] });
  }
  return out;
}

export function parseResolvConf(text: string): DnsServer[] {
  return [...text.matchAll(/^\s*nameserver\s+(\S+)/gm)].map((m) => ({ address: m[1].replace(/%.*$/, '') }));
}

// ---------------------------------------------------------------- macOS

/**
 * `lsof -nP -iTCP -iUDP -T s -F pcPtnT`: field output, one field per line,
 * starting with p (pid) then c (command), then one group per socket.
 */
export function parseLsofF(text: string): NetConn[] {
  const out: NetConn[] = [];
  let pid = 0, name = '';
  let cur: Partial<NetConn> & { fam?: string; n?: string } = {};
  const flush = () => {
    if (!cur.n) { cur = {}; return; }
    const [l, r] = cur.n.split('->');
    const lp = splitHostPort(l);
    const rp = r ? splitHostPort(r) : undefined;
    const lh = lp.host === '*' ? (cur.fam === 'IPv6' ? '::' : '0.0.0.0') : unmapV4(lp.host);
    out.push({
      proto: (cur.proto as 'TCP' | 'UDP') ?? 'TCP', family: cur.fam === 'IPv6' ? 6 : 4, local: lh, localPort: lp.port ?? 0,
      remote: rp ? unmapV4(rp.host) : undefined, remotePort: rp?.port, state: cur.state ?? (rp ? 'Established' : undefined), pid, name,
    });
    cur = {};
  };
  for (const line of text.split('\n')) {
    if (!line) continue;
    const k = line[0];
    const v = line.slice(1);
    if (k === 'p') { flush(); pid = Number(v); name = ''; }
    else if (k === 'c') name = v;
    else if (k === 'f') { flush(); }
    else if (k === 't') cur.fam = v;
    else if (k === 'P') cur.proto = v.toUpperCase() === 'UDP' ? 'UDP' : 'TCP';
    else if (k === 'n') cur.n = v;
    else if (k === 'T' && v.startsWith('ST=')) cur.state = normState(v.slice(3));
  }
  flush();
  return out;
}

/**
 * `nettop -L 1 -x -n -J interface,state,bytes_in,bytes_out`: CSV with a process
 * row ("Name.pid") followed by its connection rows
 * ("tcp4 192.168.1.20:51234<->17.57.144.20:5223").
 */
export function parseNettop(text: string): { conns: NetConn[]; procs: ProcBytes[] } {
  const conns: NetConn[] = [];
  const procs: ProcBytes[] = [];
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return { conns, procs };
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const ci = col('interface'), cs = col('state'), cin = col('bytes_in'), cout = col('bytes_out');
  let proc: ProcBytes | undefined;
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const what = f[1] ?? '';
    const bin = Number(f[cin]) || 0, bout = Number(f[cout]) || 0;
    const sock = what.match(/^(tcp|udp)([46])\s+(.+?)<->(.+)$/);
    if (sock) {
      const l = splitHostPort(sock[3]);
      const r = splitHostPort(sock[4]);
      const remote = r.host === '*' ? undefined : unmapV4(r.host.replace(/%.*$/, ''));
      conns.push({
        proto: sock[1] === 'udp' ? 'UDP' : 'TCP', family: sock[2] === '6' ? 6 : 4,
        local: l.host === '*' ? (sock[2] === '6' ? '::' : '0.0.0.0') : unmapV4(l.host.replace(/%.*$/, '')), localPort: l.port ?? 0,
        remote, remotePort: remote ? r.port : undefined, state: normState(f[cs]) ?? (remote ? 'Established' : undefined),
        pid: proc?.pid, name: proc?.name, iface: f[ci] || undefined, bytesIn: bin, bytesOut: bout,
      });
      continue;
    }
    const pm = what.match(/^(.*)\.(\d+)$/);
    if (pm) {
      proc = { pid: Number(pm[2]), name: pm[1], bytesIn: bin, bytesOut: bout };
      procs.push(proc);
    }
  }
  return { conns, procs };
}

/**
 * `netstat -rn` on macOS/BSD. Destinations are abbreviated ("10.8.0/24",
 * "127", "192.168.1"); routes flagged I are bound to one interface and are not
 * used for ordinary traffic.
 */
export function parseBsdNetstatRoutes(text: string): RouteEntry[] {
  const out: RouteEntry[] = [];
  let family: 4 | 6 | 0 = 0;
  for (const line of text.split('\n')) {
    if (/^Internet6:/.test(line)) { family = 6; continue; }
    if (/^Internet:/.test(line)) { family = 4; continue; }
    if (!family || /^Destination/.test(line.trim())) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const [dest, gw, flags, iface] = f;
    if (!flags.includes('U') || flags.includes('I')) continue;
    let net = dest, prefix: number;
    if (dest === 'default') { net = family === 4 ? '0.0.0.0' : '::'; prefix = 0; }
    else if (family === 4) {
      const [a, p] = dest.split('/');
      const parts = a.split('.');
      while (parts.length < 4) parts.push('0');
      net = parts.join('.');
      prefix = p !== undefined ? Number(p) : a.split('.').length * 8;
      if (flags.includes('H') && p === undefined) prefix = 32;
      if (v4ToInt(net) === null) continue;
    } else {
      const [a, p] = dest.split('/');
      net = a.replace(/%.*$/, '');
      prefix = p !== undefined ? Number(p) : 128;
    }
    const gateway = /^(link#|[0-9a-f]{1,2}(:[0-9a-f]{1,2}){5}$)/i.test(gw) ? undefined : gw.replace(/%.*$/, '');
    out.push({ family, dest: net, prefix, gateway, iface, metric: out.length });
  }
  return out;
}

/** `route -n get <addr>` on macOS. */
export function parseRouteGet(text: string): { iface?: string; gateway?: string } {
  return { iface: text.match(/^\s*interface:\s*(\S+)/m)?.[1], gateway: text.match(/^\s*gateway:\s*(\S+)/m)?.[1] };
}

/** `netstat -ibn` on macOS: bytes per interface (the <Link#…> row of each). */
export function parseNetstatIbn(text: string): Map<string, { rx: number; tx: number }> {
  const out = new Map<string, { rx: number; tx: number }>();
  const lines = text.split('\n');
  const head = (lines[0] ?? '').trim().split(/\s+/);
  const ib = head.indexOf('Ibytes'), ob = head.indexOf('Obytes');
  if (ib < 0 || ob < 0) return out;
  for (const line of lines.slice(1)) {
    const f = line.trim().split(/\s+/);
    if (!f[2]?.startsWith('<Link#')) continue;
    // The Address column is empty for some interfaces, shifting the rest left by one.
    const shift = f.length === head.length ? 0 : head.length - f.length;
    const name = f[0].replace(/\*$/, '');
    if (!out.has(name)) out.set(name, { rx: Number(f[ib - shift]) || 0, tx: Number(f[ob - shift]) || 0 });
  }
  return out;
}

/** `scutil --nc list`. */
export function parseScutilNcList(text: string): VpnConn[] {
  const out: VpnConn[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\*?\s*\(([^)]+)\)\s+([0-9A-F-]{36})\s+(.*?)\s+"(.+)"\s+\[([^\]]+)\]\s*$/i);
    if (!m) continue;
    const st = m[1].toLowerCase();
    const kind = m[5];
    const type = /wireguard/i.test(kind) ? 'wireguard' : /L2TP/i.test(kind) ? 'l2tp' : /IKEv2/i.test(kind + m[3]) ? 'ikev2' : /IPSec/i.test(kind) ? 'ipsec' : /PPTP/i.test(kind) ? 'pptp' : /openvpn/i.test(kind) ? 'openvpn' : 'vpn';
    out.push({
      id: m[2], name: m[4], type, source: 'scutil',
      state: st === 'connected' ? 'connected' : st === 'connecting' ? 'connecting' : st === 'disconnecting' ? 'disconnecting' : st === 'disconnected' ? 'disconnected' : 'unknown',
    });
  }
  return out;
}

/** `scutil --dns`: resolvers with their interface. */
export function parseScutilDns(text: string): DnsServer[] {
  const out: DnsServer[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/\n(?=resolver #)/)) {
    if (/scoped/i.test(block.split('\n')[0] ?? '') && !/^resolver #1\b/.test(block)) continue;
    const iface = block.match(/if_index\s*:\s*\d+\s*\(([^)]+)\)/)?.[1];
    const domain = block.match(/^\s*domain\s*:\s*(\S+)/m)?.[1];
    for (const m of block.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)) {
      const k = `${m[1]}|${domain ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ address: m[1].replace(/%.*$/, ''), iface, domain });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Windows

/** `netstat -ano`. */
export function parseNetstatAno(text: string): NetConn[] {
  const out: NetConn[] = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== 'TCP' && f[0] !== 'UDP') continue;
    const l = splitHostPort(f[1]);
    const r = splitHostPort(f[2]);
    const isTcp = f[0] === 'TCP';
    const pid = Number(isTcp ? f[4] : f[3]);
    const remote = r.host === '*' || /^(0\.0\.0\.0|::)$/.test(r.host) ? undefined : unmapV4(r.host.replace(/%.*$/, ''));
    out.push({
      proto: isTcp ? 'TCP' : 'UDP', family: l.host.includes(':') ? 6 : 4, local: unmapV4(l.host.replace(/%.*$/, '')), localPort: l.port ?? 0,
      remote, remotePort: remote ? r.port : undefined, state: isTcp ? normState(f[3]) : undefined, pid: Number.isFinite(pid) ? pid : undefined,
    });
  }
  return out;
}

function asArray<T>(j: T | T[] | null | undefined): T[] {
  return Array.isArray(j) ? j : j ? [j] : [];
}

/** `Get-NetTCPConnection | Select LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json`. */
export function parseGetNetTcp(json: string): NetConn[] {
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  return asArray(j as Record<string, unknown>[]).map((c) => {
    const remote = String(c.RemoteAddress ?? '');
    const r = remote && !/^(0\.0\.0\.0|::)$/.test(remote) ? unmapV4(remote) : undefined;
    const local = unmapV4(String(c.LocalAddress ?? ''));
    return {
      proto: 'TCP' as const, family: local.includes(':') ? 6 as const : 4 as const, local, localPort: Number(c.LocalPort) || 0,
      remote: r, remotePort: r ? Number(c.RemotePort) || undefined : undefined,
      state: normState(c.State as string | number), pid: Number(c.OwningProcess) || undefined,
    };
  });
}

/**
 * `route print`: the IPv4 table (Interface is the interface's own address) and
 * the IPv6 table (If is the interface number from the list at the top).
 */
export function parseRoutePrint(text: string): { routes: RouteEntry[]; ifaces: Map<number, string> } {
  const routes: RouteEntry[] = [];
  const ifaces = new Map<number, string>();
  const lines = text.split(/\r?\n/);
  let section: 'list' | 'v4' | 'v6' | '' = '';
  let pending6: { ifx: string; metric: number; dest: string } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^Interface List/i.test(line)) { section = 'list'; continue; }
    if (/^IPv4 Route Table/i.test(line)) { section = 'v4'; continue; }
    if (/^IPv6 Route Table/i.test(line)) { section = 'v6'; continue; }
    if (/^Persistent Routes/i.test(line.trim())) { section = section === 'v6' ? '' : section === 'v4' ? '' : section; continue; }
    if (section === 'list') {
      const m = line.match(/^\s*(\d+)\.{2,}.*?\.{2,}(.+)$/) ?? line.match(/^\s*(\d+)\.{3}[0-9a-f ]*\.{3,}(.+)$/i);
      if (m) ifaces.set(Number(m[1]), m[2].trim());
      continue;
    }
    if (section === 'v4') {
      const f = line.trim().split(/\s+/);
      if (f.length === 5 && v4ToInt(f[0]) !== null && v4ToInt(f[1]) !== null) {
        routes.push({ family: 4, dest: f[0], prefix: maskToPrefix(f[1]), gateway: f[2] === 'On-link' ? undefined : f[2], iface: f[3], metric: Number(f[4]) });
      }
      continue;
    }
    if (section === 'v6') {
      const f = line.trim().split(/\s+/);
      if (pending6 && f.length === 1 && f[0]) {
        routes.push({ family: 6, dest: pending6.dest.split('/')[0], prefix: Number(pending6.dest.split('/')[1] ?? 128), gateway: f[0] === 'On-link' ? undefined : f[0], iface: `#${pending6.ifx}`, metric: pending6.metric });
        pending6 = null;
        continue;
      }
      pending6 = null;
      if (/^\d+$/.test(f[0] ?? '') && /^\d+$/.test(f[1] ?? '') && f[2]?.includes(':')) {
        if (f.length >= 4) routes.push({ family: 6, dest: f[2].split('/')[0], prefix: Number(f[2].split('/')[1] ?? 128), gateway: f[3] === 'On-link' ? undefined : f[3], iface: `#${f[0]}`, metric: Number(f[1]) });
        else pending6 = { ifx: f[0], metric: Number(f[1]), dest: f[2] };
      }
    }
  }
  return { routes, ifaces };
}

/** `Get-VpnConnection | ConvertTo-Json` (and -AllUserConnection). */
export function parseGetVpnConnection(json: string): VpnConn[] {
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  const TUNNEL = ['pptp', 'l2tp', 'sstp', 'ikev2', 'automatic'];
  return asArray(j as Record<string, unknown>[]).map((c) => {
    const tt = c.TunnelType;
    const type = typeof tt === 'number' ? TUNNEL[tt] ?? 'vpn' : String(tt ?? 'vpn').toLowerCase();
    const st = String(c.ConnectionStatus ?? '').toLowerCase();
    return {
      id: String(c.Guid ?? c.Name), name: String(c.Name), type, server: c.ServerAddress ? String(c.ServerAddress) : undefined, source: 'windows-ras',
      state: st === 'connected' ? 'connected' as const : st === 'connecting' ? 'connecting' as const : st === 'disconnected' ? 'disconnected' as const : 'unknown' as const,
    };
  });
}

/** `Get-DnsClientServerAddress | Select InterfaceAlias,AddressFamily,ServerAddresses | ConvertTo-Json`. */
export function parseGetDnsServers(json: string): DnsServer[] {
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  const out: DnsServer[] = [];
  for (const r of asArray(j as Record<string, unknown>[])) {
    for (const a of asArray(r.ServerAddresses as string[])) out.push({ address: String(a), iface: r.InterfaceAlias ? String(r.InterfaceAlias) : undefined });
  }
  return out;
}

/** `netsh wlan show interfaces`. */
export function parseNetshWlan(text: string): WifiInfo | undefined {
  const get = (k: string) => text.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'mi'))?.[1].trim();
  const ssid = get('SSID');
  if (!ssid) return undefined;
  return { ssid, signal: Number(get('Signal')?.replace('%', '')) || undefined, channel: get('Channel'), rate: get('Receive rate \\(Mbps\\)') ? `${get('Receive rate \\(Mbps\\)')} Mb/s` : undefined, security: get('Authentication') };
}

/** `netstat -e`: total bytes received and sent. */
export function parseNetstatE(text: string): { rx: number; tx: number } | undefined {
  const m = text.match(/^\s*Bytes\s+(\d+)\s+(\d+)/m);
  return m ? { rx: Number(m[1]), tx: Number(m[2]) } : undefined;
}

/** `system_profiler SPAirPortDataType` (macOS): the current network. */
export function parseAirport(text: string): WifiInfo | undefined {
  const block = text.split(/Current Network Information:/)[1];
  if (!block) return undefined;
  const ssid = block.match(/^\s+(.+?):\s*$/m)?.[1];
  const get = (k: string) => block.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm'))?.[1].trim();
  const sn = get('Signal / Noise')?.match(/(-?\d+)\s*dBm/);
  return { ssid, channel: get('Channel'), security: get('Security'), rate: get('Transmit Rate') ? `${get('Transmit Rate')} Mb/s` : undefined, signalDbm: sn ? Number(sn[1]) : undefined };
}

// ---------------------------------------------------------------- shared types

export interface DnsServer {
  address: string;
  iface?: string;
  /** only for names under this domain (split DNS) */
  domain?: string;
}

export interface WifiInfo {
  ssid?: string;
  /** 0–100 */
  signal?: number;
  signalDbm?: number;
  channel?: string;
  rate?: string;
  security?: string;
}
