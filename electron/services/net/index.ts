// SPDX-License-Identifier: AGPL-3.0-or-later
// Network Activity and VPN: which app talks to whom, through which interface,
// how much; the system's VPN connections and whether traffic really goes
// through them. Nothing runs in the background unless the person turns on
// "new app" alerts or VPN auto-reconnect; readings happen while the page is open.

import { app, dialog, net as enet } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import { promises as dnsp } from 'node:dns';
import https from 'node:https';
import nodeNet from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import type { GeoStatus, NetHealth, NetSettings, PublicIpResult, VpnImportPreview, VpnStatus } from '../../../core/api-net';
import { familyOf, scopeOf } from '../../../core/net/addr';
import { applyRates, byApp, byDestination, flowKey, flowsToCsv, ifaceTotals, newInternetApps, serviceFor, type FlowRow, type IfaceTraffic, type NetSample } from '../../../core/net/flows';
import { asnValue, countryValue, dbipUrls, RangeTable, RangeTableBuilder } from '../../../core/net/geo';
import type { DnsServer } from '../../../core/net/parse';
import { defaultRoute, killSwitchAdvice, pathFor, trafficVerdict } from '../../../core/net/route';
import type { IfaceKind, VpnConn } from '../../../core/net/types';
import { parseVpnConfig } from '../../../core/net/vpnconf';
import { run } from '../../../core/platform';
import { setSecret } from '../../store';
import { poll } from '../governor';
import { icons as procIcons } from '../procs';
import { PLATFORM, preciseRoutes, processNames, readConnections, readDns, readIfaceBytes, readIfaces, readRoutes, readVpns, readWifi, tool, vpnConnect } from './system';

const dir = () => path.join(app.getPath('userData'), 'network');
const settingsFile = () => path.join(dir(), 'settings.json');

const DEFAULTS: NetSettings = { hostNames: true, countries: false, latency: true, probeHost: '1.1.1.1', alertNewApps: false, autoReconnect: [] };
let settings: NetSettings = { ...DEFAULTS };
let loaded = false;

async function loadSettings(): Promise<NetSettings> {
  if (loaded) return settings;
  try {
    settings = { ...DEFAULTS, ...JSON.parse(await fsp.readFile(settingsFile(), 'utf8')) };
  } catch {
    /* first run */
  }
  loaded = true;
  return settings;
}

async function saveSettings() {
  await fsp.mkdir(dir(), { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
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

/** Downloads the free DB-IP Lite files (CC BY 4.0) once and keeps a compact table. */
async function buildGeo(kind: 'country' | 'asn', out: string, onProgress: (p: number) => void): Promise<string> {
  let lastErr = '';
  // KEEPER_GEO_FEED points at a folder with dbip-<kind>-lite.csv.gz, for tests and offline mirrors.
  const feed = process.env.KEEPER_GEO_FEED?.replace(/\/$/, '');
  for (const url of feed ? [`${feed}/dbip-${kind}-lite-${new Date().toISOString().slice(0, 7)}.csv.gz`] : dbipUrls(kind)) {
    const res = await enet.fetch(url).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
    if (!res.ok || !res.body) { lastErr = `${res.status} ${res.statusText}`; continue; }
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => { got += c.length; if (total) onProgress(got / total); });
    const lines = readline.createInterface({ input: body.pipe(zlib.createGunzip()), crlfDelay: Infinity });
    const b = new RangeTableBuilder(kind === 'country' ? countryValue : asnValue);
    for await (const line of lines) b.add(line);
    const table = b.build();
    if (table.size < 1000) { lastErr = 'the file was unexpectedly small'; continue; }
    const date = url.match(/(\d{4}-\d{2})\.csv/)?.[1];
    await fsp.mkdir(dir(), { recursive: true });
    await fsp.writeFile(out + '.tmp', table.serialize({ date, source: 'DB-IP Lite (CC BY 4.0) https://db-ip.com' }));
    await fsp.rename(out + '.tmp', out);
    return date ?? '';
  }
  throw new Error(lastErr || 'download failed');
}

export async function geoStatus(): Promise<GeoStatus> {
  await loadSettings();
  if (settings.countries) await loadGeo();
  return geoState;
}

export async function geoDownload(): Promise<GeoStatus> {
  if (geoState.state === 'downloading') return geoState;
  geoState = { state: 'downloading', progress: 0 };
  void (async () => {
    try {
      const date = await buildGeo('country', path.join(dir(), 'countries.bin'), (p) => (geoState = { state: 'downloading', progress: p * 0.4 }));
      await buildGeo('asn', path.join(dir(), 'networks.bin'), (p) => (geoState = { state: 'downloading', progress: 0.4 + p * 0.6 }));
      settings.countries = true;
      await saveSettings();
      geo = null;
      await loadGeo();
      geoState = { ...geoState, date };
    } catch (e) {
      geoState = { state: 'error', message: `Could not download the country table: ${e instanceof Error ? e.message : e}` };
    }
  })();
  return geoState;
}

export async function geoRemove(): Promise<GeoStatus> {
  for (const f of ['countries.bin', 'networks.bin']) await fsp.rm(path.join(dir(), f), { force: true });
  geo = null;
  settings.countries = false;
  await saveSettings();
  geoState = { state: 'off' };
  return geoState;
}

// ---------------------------------------------------------------- sampling

let prevFlows = new Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }>();
let prevIfaceBytes: { at: number; map: Map<string, { rx: number; tx: number }> } | null = null;
let lastSample: NetSample | null = null;
let vpnIfaceNames = new Set<string>();

function kindsOf(ifaces: { name: string; kind: IfaceKind }[]): Map<string, IfaceKind> {
  return new Map(ifaces.map((i) => [i.name, i.kind]));
}

export async function sample(): Promise<NetSample> {
  await loadSettings();
  if (settings.countries) await loadGeo();
  const now = Date.now();
  const [reading, procs, { routes, descriptions }, bytes] = await Promise.all([readConnections(), processNames(), readRoutes(), readIfaceBytes()]);
  const ifaces = await readIfaces(routes, descriptions, vpnIfaceNames);
  const kinds = kindsOf(ifaces);
  const internet = reading.conns.filter((c) => c.remote && scopeOf(c.remote) === 'internet').map((c) => c.remote!);
  const precise = await preciseRoutes(internet);
  const self = process.pid;

  const flows: FlowRow[] = reading.conns.map((c) => {
    const listening = !c.remote && (c.state === 'Listen' || c.proto === 'UDP');
    const p = c.pid !== undefined ? procs.get(c.pid) : undefined;
    const appName = c.pid === self ? 'Keeper' : p?.name ?? c.name ?? (c.pid !== undefined ? `Process ${c.pid}` : 'System or another user');
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

export async function health(): Promise<NetHealth> {
  await loadSettings();
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

// ---------------------------------------------------------------- VPN

let lastVpns: VpnConn[] = [];
const pausedReconnect = new Set<string>();

export async function vpnStatus(): Promise<VpnStatus> {
  await loadSettings();
  const [{ vpns, notes }, { routes, descriptions }, dns] = await Promise.all([readVpns(), readRoutes(0), readDns().catch(() => [] as DnsServer[])]);
  vpnIfaceNames = new Set(vpns.filter((v) => v.state === 'connected' && v.iface).map((v) => v.iface!));
  const ifaces = await readIfaces(routes, descriptions, vpnIfaceNames);
  lastVpns = vpns;
  // Fill in the interface of connected VPNs that didn't say (macOS): the tunnel carrying their traffic.
  const tunnels = ifaces.filter((i) => i.kind === 'vpn' && i.up).map((i) => i.name);
  for (const v of vpns) if (v.state === 'connected' && !v.iface && tunnels.length === 1) v.iface = tunnels[0];
  const verdict = trafficVerdict(routes, kindsOf(ifaces), vpns, dns);
  return { vpns, ifaces, verdict, dns, notes, advice: killSwitchAdvice(PLATFORM), autoReconnect: settings.autoReconnect };
}

export async function vpnAction(id: string, action: 'connect' | 'disconnect') {
  if (!lastVpns.length) await vpnStatus();
  const v = lastVpns.find((x) => x.id === id);
  if (!v) return { ok: false, message: 'That VPN connection is no longer there.' };
  // Disconnecting by hand pauses auto-reconnect for it until it is connected again.
  if (action === 'disconnect') pausedReconnect.add(id);
  else pausedReconnect.delete(id);
  return vpnConnect(v, action === 'connect');
}

// ---------------------------------------------------------------- importing VPN files

const pending = new Map<string, { text: string; fileName: string; at: number }>();

function methodFor(kind: 'wireguard' | 'openvpn'): { method: VpnImportPreview['method']; note: string } {
  if (PLATFORM === 'linux') {
    if (tool('nmcli')) return { method: 'networkmanager', note: kind === 'openvpn' ? 'NetworkManager imports it (the OpenVPN plugin, network-manager-openvpn, must be installed). It keeps the keys in its own protected store.' : 'NetworkManager imports it and keeps the keys in its own protected store. It then appears in your network menu and here.' };
    return { method: 'manual', note: 'NetworkManager is not installed. Save the file and use wg-quick or openvpn, or install NetworkManager.' };
  }
  if (PLATFORM === 'darwin') {
    if (kind === 'wireguard' && existsSync('/Applications/WireGuard.app')) return { method: 'wireguard-app', note: 'Keeper hands the file to the WireGuard app, which asks to add it and keeps the keys in the Keychain.' };
    return { method: 'manual', note: kind === 'wireguard' ? 'Install the free WireGuard app from the App Store, then import the file there.' : 'macOS has no built-in OpenVPN; open the file with your OpenVPN app.' };
  }
  if (PLATFORM === 'win32') {
    const wg = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wireguard.exe');
    if (kind === 'wireguard' && existsSync(wg)) return { method: 'wireguard-app', note: 'Keeper opens the WireGuard app; choose Import tunnel(s) from file. It keeps the keys encrypted.' };
    const ovpnDir = path.join(os.homedir(), 'OpenVPN', 'config');
    if (kind === 'openvpn' && existsSync(path.dirname(ovpnDir))) return { method: 'openvpn-app', note: `Keeper copies the profile into ${ovpnDir}, where the OpenVPN app finds it. Note that the OpenVPN app keeps profiles as plain files there.` };
    return { method: 'manual', note: kind === 'wireguard' ? 'Install the WireGuard app for Windows, then import the file there.' : 'Install the OpenVPN app for Windows, then import the file there.' };
  }
  return { method: 'manual', note: 'Import the file with your VPN app.' };
}

export async function importText(text: string, fileName: string): Promise<VpnImportPreview> {
  if (text.length > 1_000_000) throw new Error('That file is too big to be a VPN configuration.');
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  const summary = parseVpnConfig(text, fileName);
  const token = randomUUID();
  pending.set(token, { text, fileName, at: Date.now() });
  const m = methodFor(summary.kind);
  return { summary, method: m.method, methodNote: m.note, token };
}

export async function importPick(): Promise<VpnImportPreview | null> {
  const r = await dialog.showOpenDialog({ title: 'Import a VPN configuration', properties: ['openFile'], filters: [{ name: 'VPN configuration', extensions: ['conf', 'ovpn'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return importText(await fsp.readFile(r.filePaths[0], 'utf8'), path.basename(r.filePaths[0]));
}

/** Writes the file where only this user can read it, runs `fn`, and always deletes it. */
async function withPrivateFile<T>(name: string, text: string, fn: (p: string) => Promise<T>): Promise<T> {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-vpn-'));
  const p = path.join(d, name);
  try {
    await fsp.writeFile(p, text, { mode: 0o600 });
    return await fn(p);
  } finally {
    await fsp.rm(d, { recursive: true, force: true });
  }
}

export async function importInstall(token: string, opts: { name?: string; keepCopy?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const p = pending.get(token);
  if (!p) return { ok: false, message: 'The file is no longer loaded; choose it again.' };
  const summary = parseVpnConfig(p.text, p.fileName);
  if (summary.issues.some((i) => i.level === 'error')) return { ok: false, message: 'Fix the problems shown first; the file is not valid.' };
  const name = (opts.name || summary.name).replace(/[^\w.-]/g, '-').slice(0, summary.kind === 'wireguard' ? 15 : 40) || 'vpn';
  const ext = summary.kind === 'wireguard' ? 'conf' : 'ovpn';
  if (opts.keepCopy) await setSecret(`vpn-config:${name}`, p.text);
  const { method } = methodFor(summary.kind);
  try {
    if (method === 'networkmanager') {
      const r = await withPrivateFile(`${name}.${ext}`, p.text, (f) => run(tool('nmcli')!, ['connection', 'import', 'type', summary.kind === 'wireguard' ? 'wireguard' : 'openvpn', 'file', f], 60_000));
      if (!r.ok) return { ok: false, message: (r.stderr || r.stdout).trim().split('\n').pop() ?? 'NetworkManager refused the file.' };
      return { ok: true, message: `"${name}" was added to NetworkManager. Connect it from the list.` };
    }
    if (method === 'wireguard-app') {
      if (PLATFORM === 'darwin') {
        // The app copies what it imports, so the temporary file can go once it has been opened.
        await withPrivateFile(`${name}.conf`, p.text, async (f) => { await run('/usr/bin/open', ['-a', 'WireGuard', f], 15_000); await new Promise((r) => setTimeout(r, 4000)); });
        return { ok: true, message: 'The WireGuard app opened with the file; confirm there to add it.' };
      }
      const exe = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wireguard.exe');
      await run('cmd', ['/c', 'start', '', exe], 10_000);
      return { ok: true, message: 'The WireGuard app is open. Choose "Import tunnel(s) from file" and pick the file again (Keeper did not keep a copy on disk).' };
    }
    if (method === 'openvpn-app') {
      const dest = path.join(os.homedir(), 'OpenVPN', 'config', `${name}.ovpn`);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, p.text, { mode: 0o600 });
      return { ok: true, message: `Copied to ${dest}. The OpenVPN app lists it under "${name}".` };
    }
    return { ok: false, message: 'Keeper can\'t add this here; use your VPN app to import the file.' };
  } finally {
    pending.delete(token);
  }
}

// ---------------------------------------------------------------- public address

function getJson(url: string, localAddress?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 6000, localAddress, headers: { 'user-agent': 'Keeper' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(String(JSON.parse(body).ip));
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
  });
}

/**
 * Asks a public "what is my address" service, once normally and once forced
 * out of the physical interface. Only when the person presses the button.
 */
export async function publicIp(): Promise<PublicIpResult> {
  const { routes, descriptions } = await readRoutes(0);
  const ifaces = await readIfaces(routes, descriptions, vpnIfaceNames);
  const physical = ifaces.find((i) => (i.kind === 'wifi' || i.kind === 'ethernet') && i.up && i.addresses.some((a) => a.family === 4 && scopeOf(a.address) !== 'link'));
  const src = physical?.addresses.find((a) => a.family === 4)?.address;
  const [current, currentV6, outside] = await Promise.all([
    getJson('https://api.ipify.org?format=json'),
    getJson('https://api6.ipify.org?format=json'),
    src ? getJson('https://api.ipify.org?format=json', src) : Promise.resolve(undefined),
  ]);
  return { current, currentV6, outsideVpn: outside, outsideIface: physical?.name, error: !current && !currentV6 ? 'No answer from the address service (offline, or blocked).' : undefined };
}

// ---------------------------------------------------------------- settings, export, icons

export async function getSettings(): Promise<NetSettings> {
  return loadSettings();
}

export async function setSettings(patch: Partial<NetSettings>): Promise<NetSettings> {
  await loadSettings();
  settings = { ...settings, ...patch };
  if (patch.probeHost !== undefined && !/^[\w.:-]{1,253}$/.test(patch.probeHost)) settings.probeHost = DEFAULTS.probeHost;
  await saveSettings();
  if (patch.countries === false) geo = null;
  startWatchers();
  return settings;
}

export async function exportCsv(): Promise<string | null> {
  const s = lastSample ?? (await sample());
  const r = await dialog.showSaveDialog({ title: 'Export connections', defaultPath: path.join(app.getPath('downloads'), `Keeper connections ${new Date().toISOString().slice(0, 16).replace(':', '-')}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, flowsToCsv(s.flows));
  return r.filePath;
}

export function icons(paths: string[]): Promise<Record<string, string>> {
  return procIcons(paths);
}

// ---------------------------------------------------------------- optional background watchers

let alertFn: (title: string, detail: string) => void = () => undefined;
let stopAlerts: (() => void) | null = null;
let stopReconnect: (() => void) | null = null;

async function knownApps(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await fsp.readFile(path.join(dir(), 'known-apps.json'), 'utf8')) as string[]);
  } catch {
    return new Set();
  }
}

function startWatchers() {
  stopAlerts?.();
  stopAlerts = null;
  stopReconnect?.();
  stopReconnect = null;
  if (settings.alertNewApps) {
    stopAlerts = poll('net.newApps', { baseMs: 120_000, idleFactor: 2, pauseWhenLocked: true }, async () => {
      const known = await knownApps();
      const first = known.size === 0;
      const s = await sample();
      const fresh = newInternetApps(s.apps, known);
      if (!fresh.length) return;
      for (const a of fresh) known.add(a);
      await fsp.mkdir(dir(), { recursive: true });
      await fsp.writeFile(path.join(dir(), 'known-apps.json'), JSON.stringify([...known]));
      // The first look only learns what is already running.
      if (!first) for (const a of fresh.slice(0, 3)) alertFn(`${a} connected to the internet`, 'First time Keeper has seen it. See Network Activity for where it connects.');
    });
  }
  if (settings.autoReconnect.length) {
    stopReconnect = poll('net.vpnReconnect', { baseMs: PLATFORM === 'win32' ? 180_000 : 60_000, idleFactor: 1 }, async () => {
      const { vpns } = await readVpns();
      lastVpns = vpns;
      for (const id of settings.autoReconnect) {
        const v = vpns.find((x) => x.id === id);
        if (!v || pausedReconnect.has(id) || v.state !== 'disconnected') continue;
        const r = await vpnConnect(v, true);
        alertFn(r.ok ? `Reconnected ${v.name}` : `${v.name} dropped`, r.ok ? 'The VPN had disconnected; Keeper connected it again.' : r.message ?? 'Keeper could not reconnect it.');
      }
    }, { now: false });
  }
}

export async function initNet(deps: { alert: (title: string, detail: string) => void }) {
  alertFn = deps.alert;
  await loadSettings();
  startWatchers();
}
