// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// WireGuard configuration in the three forms Keeper needs:
//   setconf  for `wg setconf` (Linux kernel module and wireguard-go with the wg tool)
//   uapi     for wireguard-go's control socket (no wg tool needed)
//   quick    a complete wg-quick style file (WireGuard for Windows' tunnel service; also shown to people)
// and reading the counters back (`wg show <if> dump` and the UAPI "get" reply).

import { familyOf } from '../net/addr';

export interface WgPeerConf {
  /** for the comment above the peer */
  name?: string;
  pub: string;
  allowed: string[];
  /** "ip:port"; Keeper points it at its own path socket on 127.0.0.1 */
  endpoint?: string;
  /** seconds; 0 or missing = off */
  keepalive?: number;
}

export interface WgIfaceConf {
  priv: string;
  listenPort?: number;
  fwmark?: number;
  peers: WgPeerConf[];
}

export interface QuickExtras {
  addresses: string[];
  dns?: string[];
  mtu?: number;
  /** "off" leaves routing to Keeper (Linux, macOS) */
  table?: string;
}

const hex = (b64: string) => Buffer.from(b64, 'base64').toString('hex');
const b64 = (h: string) => Buffer.from(h, 'hex').toString('base64');

/** Peers in a fixed order (by key), so the same mesh always gives the same file. */
const sorted = (p: WgPeerConf[]) => [...p].sort((a, b) => (a.pub < b.pub ? -1 : a.pub > b.pub ? 1 : 0));

function peerBlock(p: WgPeerConf): string[] {
  const out = ['', '[Peer]'];
  if (p.name) out.splice(1, 0, `# ${p.name.replace(/[\r\n]/g, ' ')}`);
  out.push(`PublicKey = ${p.pub}`);
  if (p.allowed.length) out.push(`AllowedIPs = ${p.allowed.join(', ')}`);
  if (p.endpoint) out.push(`Endpoint = ${p.endpoint}`);
  if (p.keepalive) out.push(`PersistentKeepalive = ${p.keepalive}`);
  return out;
}

/** For `wg setconf <if> <file>`: keys, port and peers only. */
export function setconf(c: WgIfaceConf): string {
  const out = ['[Interface]', `PrivateKey = ${c.priv}`];
  if (c.listenPort) out.push(`ListenPort = ${c.listenPort}`);
  if (c.fwmark) out.push(`FwMark = ${c.fwmark}`);
  for (const p of sorted(c.peers)) out.push(...peerBlock(p));
  return out.join('\n') + '\n';
}

/** A complete wg-quick style file. */
export function quickConf(c: WgIfaceConf, x: QuickExtras): string {
  const out = ['[Interface]', `PrivateKey = ${c.priv}`, `Address = ${x.addresses.join(', ')}`];
  if (c.listenPort) out.push(`ListenPort = ${c.listenPort}`);
  if (x.dns?.length) out.push(`DNS = ${x.dns.join(', ')}`);
  if (x.mtu) out.push(`MTU = ${x.mtu}`);
  if (x.table) out.push(`Table = ${x.table}`);
  for (const p of sorted(c.peers)) out.push(...peerBlock(p));
  return out.join('\n') + '\n';
}

/** The configuration with the private key taken out, for showing and comparing. */
export const redact = (conf: string) => conf.replace(/^(PrivateKey\s*=\s*).*$/m, '$1(kept in the keychain)');

/** wireguard-go's control socket ("set=1"): replaces the whole peer list. */
export function uapiSet(c: WgIfaceConf): string {
  const out = ['set=1', `private_key=${hex(c.priv)}`];
  if (c.listenPort) out.push(`listen_port=${c.listenPort}`);
  if (c.fwmark !== undefined) out.push(`fwmark=${c.fwmark}`);
  out.push('replace_peers=true');
  for (const p of sorted(c.peers)) {
    out.push(`public_key=${hex(p.pub)}`, 'replace_allowed_ips=true');
    if (p.endpoint) out.push(`endpoint=${p.endpoint}`);
    out.push(`persistent_keepalive_interval=${p.keepalive ?? 0}`);
    for (const a of p.allowed) out.push(`allowed_ip=${a}`);
  }
  return out.join('\n') + '\n\n';
}

export interface WgPeerStats {
  pub: string;
  endpoint?: string;
  /** epoch ms, 0 = never */
  lastHandshake: number;
  rx: number;
  tx: number;
}

/** `wg show <if> dump`: first line is the interface, then one tab-separated line per peer. */
export function parseWgDump(text: string): WgPeerStats[] {
  const lines = text.trim().split('\n').slice(1);
  return lines
    .map((l) => l.split('\t'))
    .filter((f) => f.length >= 8)
    .map((f) => ({ pub: f[0], endpoint: f[2] === '(none)' ? undefined : f[2], lastHandshake: Number(f[4]) * 1000, rx: Number(f[5]), tx: Number(f[6]) }));
}

/** wireguard-go's "get=1" reply. */
export function parseUapiGet(text: string): WgPeerStats[] {
  const out: WgPeerStats[] = [];
  let cur: WgPeerStats | null = null;
  let sec = 0;
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (k === 'public_key') {
      cur = { pub: b64(v), lastHandshake: 0, rx: 0, tx: 0 };
      sec = 0;
      out.push(cur);
    } else if (cur) {
      if (k === 'endpoint') cur.endpoint = v;
      else if (k === 'last_handshake_time_sec') sec = Number(v);
      else if (k === 'last_handshake_time_nsec') cur.lastHandshake = sec * 1000 + Math.floor(Number(v) / 1e6);
      else if (k === 'rx_bytes') cur.rx = Number(v);
      else if (k === 'tx_bytes') cur.tx = Number(v);
    }
  }
  for (const s of out) if (!s.lastHandshake && sec) s.lastHandshake = sec * 1000;
  return out;
}

/** What one peer may send from: its addresses, plus approved routes, plus everything if it is the exit node. */
export function allowedIps(p: { a6?: string; a4?: string; routes?: string[] }, opts: { exit?: boolean; acceptRoutes?: boolean } = {}): string[] {
  const out: string[] = [];
  if (p.a6) out.push(`${p.a6}/128`);
  if (p.a4) out.push(`${p.a4}/32`);
  if (opts.acceptRoutes) for (const r of p.routes ?? []) out.push(r);
  if (opts.exit) out.push('0.0.0.0/0', '::/0');
  return [...new Set(out)];
}

/** "ip:port", with brackets for IPv6. */
export const endpoint = (ip: string, port: number) => (familyOf(ip) === 6 ? `[${ip}]:${port}` : `${ip}:${port}`);
