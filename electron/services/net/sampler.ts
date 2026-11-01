// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Network Activity's sampling: connections, routes, interface counters, names
// for addresses, countries and networks (a 19 MB table), and latency checks.
// No Electron here, so it runs in its own service process (electron/svc/net-host.ts):
// if it ever fails, the rest of Keeper carries on, and its memory is given back
// when Network Activity has been closed for a while. The main process keeps
// settings, VPN control and the downloads.

import { promises as dnsp } from 'node:dns';
import { promises as fsp } from 'node:fs';
import nodeNet from 'node:net';
import path from 'node:path';
import type { GeoStatus, NetHealth, NetSettings } from '../../../core/api-net';
import { familyOf, scopeOf } from '../../../core/net/addr';
import { applyRates, byApp, byDestination, flowKey, ifaceTotals, serviceFor, type FlowRow, type IfaceTraffic, type NetSample } from '../../../core/net/flows';
import { RangeTable } from '../../../core/net/geo';
import type { DnsServer } from '../../../core/net/parse';
import { defaultRoute, pathFor } from '../../../core/net/route';
import type { IfaceKind } from '../../../core/net/types';
import { PLATFORM, preciseRoutes, processNames, readConnections, readDns, readIfaceBytes, readIfaces, readRoutes, readWifi, tool } from './system';

let dataDir = '';
const dir = () => dataDir;

/** Where the country and network tables live (the app's network folder). */
export function configure(d: string) {
  dataDir = d;
}

// ---------------------------------------------------------------- names for addresses

const hostCache = new Map<string, { host?: string; at: number }>();
let lookups = 0;

/** Reverse DNS through the computer's normal resolver, a few at a time, remembered for an hour. */
function hostFor(ip: string): string | undefined {
  const c = hostCache.get(ip);
  if (c && Date.now() - c.at < 3600_000) return c.host;
  if (!c && lookups < 6) {
    hostCache.set(ip, { at: Date.now() });
    lookups++;
    void Promise.race([dnsp.reverse(ip), new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))])
      .then((names) => hostCache.set(ip, { host: names[0], at: Date.now() }))
      .catch(() => hostCache.set(ip, { at: Date.now() }))
      .finally(() => { lookups--; });
  }
  if (hostCache.size > 5000) hostCache.clear();
  return c?.host;
}

// ---------------------------------------------------------------- countries and networks

let geo: { country?: RangeTable; asn?: RangeTable; date?: string } | null = null;
let geoState: GeoStatus = { state: 'off' };

/** The country table's state, loading it when countries are on. */
export async function geoInfo(countries: boolean): Promise<GeoStatus> {
  if (countries) await loadGeo();
  return geoState;
}

/** Forgets the tables (turned off, removed, or about to be replaced). */
export function dropGeo() {
  geo = null;
  geoState = { state: 'off' };
}

async function loadGeo(): Promise<void> {
  if (geo) return;
  try {
    const c = RangeTable.deserialize(await fsp.readFile(path.join(dir(), 'countries.bin')));
    let asn: RangeTable | undefined;
    try {
      asn = RangeTable.deserialize(await fsp.readFile(path.join(dir(), 'networks.bin'))).table;
    } catch {
      /* countries only */
    }
    geo = { country: c.table, asn, date: c.meta.date as string };
    geoState = { state: 'ready', date: geo.date, ranges: c.table.size + (asn?.size ?? 0) };
  } catch {
    geo = null;
    if (geoState.state !== 'downloading') geoState = { state: 'off' };
  }
}

let prevFlows = new Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }>();
let prevIfaceBytes: { at: number; map: Map<string, { rx: number; tx: number }> } | null = null;
let lastSample: NetSample | null = null;

function kindsOf(ifaces: { name: string; kind: IfaceKind }[]): Map<string, IfaceKind> {
  return new Map(ifaces.map((i) => [i.name, i.kind]));
}

export async function sample(settings: NetSettings, keeperPids: number[] = [], vpnIfaces: string[] = []): Promise<NetSample> {
  if (settings.countries) await loadGeo();
  const vpnIfaceNames = new Set(vpnIfaces);
  const keeper = new Set(keeperPids);
  const now = Date.now();
  const [reading, procs, { routes, descriptions }, bytes] = await Promise.all([readConnections(), processNames(), readRoutes(), readIfaceBytes()]);
  const ifaces = await readIfaces(routes, descriptions, vpnIfaceNames);
  const kinds = kindsOf(ifaces);
  const internet = reading.conns.filter((c) => c.remote && scopeOf(c.remote) === 'internet').map((c) => c.remote!);
  const precise = await preciseRoutes(internet);

  const flows: FlowRow[] = reading.conns.map((c) => {
    const listening = !c.remote && (c.state === 'Listen' || c.proto === 'UDP');
    const p = c.pid !== undefined ? procs.get(c.pid) : undefined;
    const appName = c.pid !== undefined && keeper.has(c.pid) ? 'Keeper' : p?.name ?? c.name ?? (c.pid !== undefined ? `Process ${c.pid}` : 'System or another user');
    const hint = c.iface ?? (c.remote ? precise.get(c.remote)?.iface : undefined);
    const route = listening ? { path: 'local' as const } : pathFor(c.remote, routes, kinds, hint);
    const scope = listening ? 'listening' as const : c.remote ? scopeOf(c.remote) : 'unspecified' as const;
    const host = c.remote && settings.hostNames && (scope === 'internet' || scope === 'lan') ? hostFor(c.remote) : undefined;
    const country = c.remote && scope === 'internet' ? geo?.country?.lookup(c.remote) : undefined;
    const asn = c.remote && scope === 'internet' ? geo?.asn?.lookup(c.remote) : undefined;
    return {
      key: flowKey(c), proto: c.proto, family: c.family, local: c.local, localPort: c.localPort, remote: c.remote, remotePort: c.remotePort, state: c.state,
      pid: c.pid, app: appName, appPath: p?.path, scope, path: route.path, iface: route.iface, gateway: route.gateway,
      host, service: serviceFor(host, asn), country, asn, bytesIn: c.bytesIn, bytesOut: c.bytesOut, firstSeen: now,
    };
  });
  prevFlows = applyRates(flows, prevFlows, now);

  // Interface rates from the byte counters.
  const ifaceRows: IfaceTraffic[] = ifaces.map((i) => {
    const b = bytes.map.get(i.name);
    const pb = prevIfaceBytes?.map.get(i.name);
    const ms = prevIfaceBytes ? bytes.at - prevIfaceBytes.at : 0;
    return { ...i, rx: b?.rx, tx: b?.tx, rxRate: b && pb && ms > 0 ? (Math.max(0, b.rx - pb.rx) * 1000) / ms : undefined, txRate: b && pb && ms > 0 ? (Math.max(0, b.tx - pb.tx) * 1000) / ms : undefined };
  });
  const all = bytes.map.get('all');
  if (all) {
    const pb = prevIfaceBytes?.map.get('all');
    const ms = prevIfaceBytes ? bytes.at - prevIfaceBytes.at : 0;
    ifaceRows.push({ name: 'all', kind: 'other', label: 'All interfaces', up: true, addresses: [], rx: all.rx, tx: all.tx, rxRate: pb && ms > 0 ? (Math.max(0, all.rx - pb.rx) * 1000) / ms : undefined, txRate: pb && ms > 0 ? (Math.max(0, all.tx - pb.tx) * 1000) / ms : undefined });
  }
  prevIfaceBytes = bytes;

  const notes = [...reading.notes];
  if (PLATFORM === 'linux' && !tool('ip') && routes.some((r) => r.iface.startsWith('wg'))) notes.push('Without the "ip" tool Keeper reads only the main routing table, so tunnels set up with policy routing may show as direct.');
  lastSample = {
    t: now, flows, apps: byApp(flows), dests: byDestination(flows), ifaces: ifaceRows, totals: ifaceTotals(ifaceRows), amounts: reading.amounts, notes,
  };
  return lastSample;
}

// ---------------------------------------------------------------- health

const gatewayMs: (number | null)[] = [];
const internetMs: (number | null)[] = [];
let wifiCache: { at: number; v: NetHealth['wifi'] } = { at: 0, v: undefined };
let dnsCache: { at: number; v: DnsServer[] } = { at: 0, v: [] };

/** Round trip of a TCP connection attempt; a refusal still proves the host answered. */
function tcpPing(host: string, ports: number[], timeout = 1500): Promise<number | null> {
  return new Promise((resolve) => {
    const port = ports[0];
    const start = process.hrtime.bigint();
    const s = nodeNet.connect({ host, port, timeout });
    const done = (ok: boolean) => {
      s.destroy();
      if (ok) resolve(Number(process.hrtime.bigint() - start) / 1e6);
      else if (ports.length > 1) void tcpPing(host, ports.slice(1), timeout).then(resolve);
      else resolve(null);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED'));
  });
}

export async function health(settings: NetSettings): Promise<NetHealth> {
  const { routes } = await readRoutes();
  const def = defaultRoute(routes, 4);
  const now = Date.now();
  if (now - dnsCache.at > 30_000) dnsCache = { at: now, v: await readDns().catch(() => []) };
  if (now - wifiCache.at > 30_000) wifiCache = { at: now, v: await readWifi().catch(() => undefined) };
  if (settings.latency) {
    const [g, i] = await Promise.all([
      def?.gateway && familyOf(def.gateway) ? tcpPing(def.gateway, [53, 80, 443]) : Promise.resolve(null),
      tcpPing(settings.probeHost, [443, 80]),
    ]);
    gatewayMs.push(def?.gateway ? g : null);
    internetMs.push(i);
    while (gatewayMs.length > 60) gatewayMs.shift();
    while (internetMs.length > 60) internetMs.shift();
  }
  return { gateway: def?.gateway, gatewayIface: def?.iface, dns: dnsCache.v, wifi: wifiCache.v, gatewayMs: [...gatewayMs], internetMs: [...internetMs], probeHost: settings.probeHost };
}

