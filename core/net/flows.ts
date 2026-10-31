// SPDX-License-Identifier: AGPL-3.0-or-later
// Turning raw connections into "which app talks to whom, how much, and which
// way": rates between two readings, grouping by app and by destination, names
// for well-known services, and CSV export.

import type { AddrScope, NetIface } from './types';
import type { PathKind } from './route';

export interface FlowRow {
  /** stable across readings: proto, local and remote ends */
  key: string;
  proto: 'TCP' | 'UDP';
  family: 4 | 6;
  local: string;
  localPort: number;
  remote?: string;
  remotePort?: number;
  state?: string;
  pid?: number;
  app: string;
  appPath?: string;
  scope: AddrScope | 'listening';
  path: PathKind;
  iface?: string;
  gateway?: string;
  host?: string;
  service?: string;
  country?: string;
  asn?: string;
  bytesIn?: number;
  bytesOut?: number;
  rateIn?: number;
  rateOut?: number;
  firstSeen: number;
}

export interface AppTraffic {
  app: string;
  appPath?: string;
  pids: number[];
  conns: number;
  listening: number;
  dests: number;
  rateIn: number;
  rateOut: number;
  bytesIn?: number;
  bytesOut?: number;
  paths: PathKind[];
  /** talks to the internet (not only this computer or the local network) */
  internet: boolean;
  countries: string[];
}

export interface DestTraffic {
  remote: string;
  host?: string;
  service?: string;
  country?: string;
  asn?: string;
  scope: AddrScope | 'listening';
  apps: string[];
  ports: number[];
  conns: number;
  rateIn: number;
  rateOut: number;
  bytesIn?: number;
  bytesOut?: number;
  path: PathKind;
  iface?: string;
}

export interface IfaceTraffic extends NetIface {
  rx?: number;
  tx?: number;
  rxRate?: number;
  txRate?: number;
}

export interface NetSample {
  t: number;
  flows: FlowRow[];
  apps: AppTraffic[];
  dests: DestTraffic[];
  ifaces: IfaceTraffic[];
  totals: { rateIn: number; rateOut: number; vpnIn: number; vpnOut: number; otherIn: number; otherOut: number };
  /** how finely the system counts bytes here: per connection, per process, per interface only, or not at all */
  amounts: 'connection' | 'process' | 'interface' | 'none';
  /** things the system would not show, in plain words */
  notes: string[];
}

export function flowKey(c: { proto: string; local: string; localPort: number; remote?: string; remotePort?: number; pid?: number }): string {
  return `${c.proto}|${c.local}:${c.localPort}|${c.remote ?? '*'}:${c.remotePort ?? '*'}|${c.pid ?? ''}`;
}

/** Bytes per second between two readings; a counter that went backwards (a new connection reusing the key) counts from zero. */
export function rateBetween(prev: number | undefined, now: number | undefined, ms: number): number | undefined {
  if (now === undefined || ms <= 0) return undefined;
  if (prev === undefined) return undefined;
  const d = now >= prev ? now - prev : now;
  return (d * 1000) / ms;
}

/** Fills rateIn/rateOut from the previous reading of each flow. */
export function applyRates(flows: FlowRow[], prev: Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }>, now: number): Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }> {
  const next = new Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }>();
  for (const f of flows) {
    const p = prev.get(f.key);
    if (p) {
      f.firstSeen = p.firstSeen;
      f.rateIn = rateBetween(p.bytesIn, f.bytesIn, now - p.t);
      f.rateOut = rateBetween(p.bytesOut, f.bytesOut, now - p.t);
    }
    next.set(f.key, { bytesIn: f.bytesIn, bytesOut: f.bytesOut, t: now, firstSeen: f.firstSeen });
  }
  return next;
}

const sum = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));

export function byApp(flows: FlowRow[]): AppTraffic[] {
  const m = new Map<string, AppTraffic & { _d: Set<string>; _c: Set<string> }>();
  for (const f of flows) {
    let a = m.get(f.app);
    if (!a) {
      a = { app: f.app, appPath: f.appPath, pids: [], conns: 0, listening: 0, dests: 0, rateIn: 0, rateOut: 0, paths: [], internet: false, countries: [], _d: new Set(), _c: new Set() };
      m.set(f.app, a);
    }
    if (f.pid !== undefined && !a.pids.includes(f.pid)) a.pids.push(f.pid);
    if (f.scope === 'listening') a.listening++;
    else a.conns++;
    if (f.remote) a._d.add(f.remote);
    a.rateIn += f.rateIn ?? 0;
    a.rateOut += f.rateOut ?? 0;
    a.bytesIn = sum(a.bytesIn, f.bytesIn);
    a.bytesOut = sum(a.bytesOut, f.bytesOut);
    if (f.scope !== 'listening' && !a.paths.includes(f.path)) a.paths.push(f.path);
    if (f.scope === 'internet') a.internet = true;
    if (f.country) a._c.add(f.country);
  }
  return [...m.values()].map(({ _d, _c, ...a }) => ({ ...a, dests: _d.size, countries: [..._c] }))
    .sort((x, y) => y.rateIn + y.rateOut - (x.rateIn + x.rateOut) || (y.bytesIn ?? 0) + (y.bytesOut ?? 0) - ((x.bytesIn ?? 0) + (x.bytesOut ?? 0)) || y.conns - x.conns || x.app.localeCompare(y.app));
}

export function byDestination(flows: FlowRow[]): DestTraffic[] {
  const m = new Map<string, DestTraffic>();
  for (const f of flows) {
    if (!f.remote) continue;
    let d = m.get(f.remote);
    if (!d) {
      d = { remote: f.remote, host: f.host, service: f.service, country: f.country, asn: f.asn, scope: f.scope, apps: [], ports: [], conns: 0, rateIn: 0, rateOut: 0, path: f.path, iface: f.iface };
      m.set(f.remote, d);
    }
    if (!d.apps.includes(f.app)) d.apps.push(f.app);
    if (f.remotePort !== undefined && !d.ports.includes(f.remotePort)) d.ports.push(f.remotePort);
    d.conns++;
    d.rateIn += f.rateIn ?? 0;
    d.rateOut += f.rateOut ?? 0;
    d.bytesIn = sum(d.bytesIn, f.bytesIn);
    d.bytesOut = sum(d.bytesOut, f.bytesOut);
  }
  return [...m.values()].sort((x, y) => y.rateIn + y.rateOut - (x.rateIn + x.rateOut) || (y.bytesIn ?? 0) + (y.bytesOut ?? 0) - ((x.bytesIn ?? 0) + (x.bytesOut ?? 0)) || y.conns - x.conns);
}

/** Totals across interfaces: through a VPN or tunnel, and everything else (loopback excluded). */
export function ifaceTotals(ifaces: IfaceTraffic[]): NetSample['totals'] {
  const t = { rateIn: 0, rateOut: 0, vpnIn: 0, vpnOut: 0, otherIn: 0, otherOut: 0 };
  for (const i of ifaces) {
    if (i.kind === 'loopback') continue;
    const rx = i.rxRate ?? 0, tx = i.txRate ?? 0;
    if (i.kind === 'vpn' || i.kind === 'tunnel') { t.vpnIn += rx; t.vpnOut += tx; }
    else { t.otherIn += rx; t.otherOut += tx; t.rateIn += rx; t.rateOut += tx; }
  }
  // Traffic through a VPN also crosses the physical interface (encrypted), so the total is the physical side.
  return t;
}

const SERVICES: [RegExp, string][] = [
  [/(^|\.)1e100\.net$|(^|\.)google(usercontent|apis|video)?\.com$|(^|\.)gstatic\.com$/, 'Google'],
  [/(^|\.)(apple|icloud|mzstatic|aaplimg|apple-dns)\.(com|net)$|(^|\.)push\.apple\.com$/, 'Apple'],
  [/(^|\.)(microsoft|msedge|msn|live|office|windows|azure|outlook|skype|xboxlive|bing)\.(com|net)$|(^|\.)(windowsupdate|azureedge|trafficmanager)\.(com|net)$/, 'Microsoft'],
  [/(^|\.)amazonaws\.com$|(^|\.)aws\.amazon\.com$/, 'Amazon Web Services'],
  [/(^|\.)cloudfront\.net$/, 'Amazon CloudFront'],
  [/(^|\.)(amazon|a2z)\.com$/, 'Amazon'],
  [/(^|\.)akamai(edge|technologies|hd)?\.(net|com)$|(^|\.)akadns\.net$|(^|\.)akam\.net$/, 'Akamai'],
  [/(^|\.)cloudflare\.(com|net)$|(^|\.)one\.one\.one\.one$/, 'Cloudflare'],
  [/(^|\.)fastly(lb)?\.net$/, 'Fastly'],
  [/(^|\.)(facebook|fbcdn|instagram|whatsapp)\.(com|net)$/, 'Meta'],
  [/(^|\.)github(usercontent)?\.com$/, 'GitHub'],
  [/(^|\.)anthropic\.com$|(^|\.)claude\.ai$/, 'Anthropic'],
  [/(^|\.)openai\.com$/, 'OpenAI'],
  [/(^|\.)dropbox(api)?\.com$/, 'Dropbox'],
  [/(^|\.)spotify\.com$|(^|\.)scdn\.co$/, 'Spotify'],
  [/(^|\.)netflix\.com$|(^|\.)nflxvideo\.net$/, 'Netflix'],
  [/(^|\.)zoom\.us$/, 'Zoom'],
  [/(^|\.)slack(-edge)?\.com$/, 'Slack'],
  [/(^|\.)discord(app)?\.(com|gg|net)$/, 'Discord'],
  [/(^|\.)digitalocean\.com$/, 'DigitalOcean'],
  [/(^|\.)hetzner\.(com|de|cloud)$|(^|\.)your-server\.de$/, 'Hetzner'],
  [/(^|\.)ovh\.(net|com)$/, 'OVH'],
  [/(^|\.)linode\.com$|(^|\.)akamaitechnologies\.com$/, 'Akamai'],
];

/** A friendly name for who runs a host, from its DNS name. */
export function serviceFor(host?: string, asn?: string): string | undefined {
  if (host) {
    const h = host.toLowerCase().replace(/\.$/, '');
    for (const [re, name] of SERVICES) if (re.test(h)) return name;
  }
  if (asn) return asn.replace(/^AS\d+\s*/, '') || undefined;
  return undefined;
}

/** Well-known port names, for a quick sense of what a connection is. */
export function portName(port?: number, proto = 'TCP'): string | undefined {
  if (!port) return undefined;
  const m: Record<number, string> = {
    20: 'FTP data', 21: 'FTP', 22: 'SSH', 25: 'mail (SMTP)', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'web', 110: 'mail (POP3)', 123: 'time (NTP)',
    143: 'mail (IMAP)', 443: proto === 'UDP' ? 'web (QUIC)' : 'web (HTTPS)', 445: 'file sharing (SMB)', 465: 'mail (SMTPS)', 500: 'VPN (IKE)', 587: 'mail (submission)',
    853: 'DNS over TLS', 993: 'mail (IMAPS)', 995: 'mail (POP3S)', 1194: 'VPN (OpenVPN)', 1900: 'device discovery (SSDP)', 3389: 'remote desktop', 3478: 'calls (STUN)',
    4500: 'VPN (IPsec)', 5223: 'push notifications', 5228: 'push notifications', 5353: 'device discovery (mDNS)', 51820: 'VPN (WireGuard)', 5900: 'screen sharing (VNC)', 8080: 'web (alternate)', 8443: 'web (alternate)',
  };
  return m[port];
}

/** Apps that talk to the internet now but were not in `known`. */
export function newInternetApps(apps: AppTraffic[], known: Set<string>): string[] {
  return apps.filter((a) => a.internet && !known.has(a.app)).map((a) => a.app);
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  // Cells starting with = + - @ are neutralised so spreadsheets don't run them as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function flowsToCsv(flows: FlowRow[]): string {
  const head = ['app', 'pid', 'protocol', 'local address', 'local port', 'remote address', 'remote port', 'host', 'service', 'country', 'network', 'state', 'path', 'interface', 'bytes in', 'bytes out', 'in per second', 'out per second'];
  const rows = flows.map((f) => [f.app, f.pid, f.proto, f.local, f.localPort, f.remote, f.remotePort, f.host, f.service, f.country, f.asn, f.state, f.path, f.iface, f.bytesIn, f.bytesOut, f.rateIn !== undefined ? Math.round(f.rateIn) : '', f.rateOut !== undefined ? Math.round(f.rateOut) : ''].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}
