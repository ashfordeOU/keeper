// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A believable Mac on a VPN for the browser demo: apps talking to services
// around the world, one leaking over IPv6, numbers that move each reading.

import type { NetApi, NetSettings, VpnStatus } from '../core/api-net';
import { applyRates, byApp, byDestination, flowKey, ifaceTotals, serviceFor, type FlowRow, type IfaceTraffic } from '../core/net/flows';
import { killSwitchAdvice } from '../core/net/route';
import { parseVpnConfig } from '../core/net/vpnconf';

interface Seed { app: string; pid: number; remote?: string; port?: number; host?: string; cc?: string; asn?: string; path: FlowRow['path']; iface?: string; rate: number; proto?: 'TCP' | 'UDP'; state?: string; listen?: number; scope?: FlowRow['scope'] }

const seeds: Seed[] = [
  { app: 'Browser', pid: 512, remote: '142.250.74.46', port: 443, host: 'lhr48s27-in-f14.1e100.net', cc: 'GB', asn: 'AS15169 Google LLC', path: 'vpn', iface: 'utun4', rate: 380_000 },
  { app: 'Browser', pid: 512, remote: '151.101.1.140', port: 443, host: 'reddit.map.fastly.net', cc: 'US', asn: 'AS54113 Fastly, Inc.', path: 'vpn', iface: 'utun4', rate: 120_000, proto: 'UDP' },
  { app: 'Browser', pid: 513, remote: '104.18.32.47', port: 443, cc: 'US', asn: 'AS13335 Cloudflare, Inc.', path: 'vpn', iface: 'utun4', rate: 42_000 },
  { app: 'Mail', pid: 620, remote: '17.57.144.20', port: 993, host: 'p71-imap.mail.me.com', cc: 'US', asn: 'AS714 Apple Inc.', path: 'vpn', iface: 'utun4', rate: 3_000 },
  { app: 'Music', pid: 640, remote: '23.40.62.8', port: 443, host: 'a23-40-62-8.deploy.static.akamaitechnologies.com', cc: 'DE', asn: 'AS20940 Akamai International B.V.', path: 'vpn', iface: 'utun4', rate: 160_000 },
  { app: 'Editor', pid: 700, remote: '140.82.121.4', port: 443, host: 'lb-140-82-121-4-fra.github.com', cc: 'DE', asn: 'AS36459 GitHub, Inc.', path: 'vpn', iface: 'utun4', rate: 9_000 },
  { app: 'Updater', pid: 455, remote: '2606:4700::6810:84e5', port: 443, cc: 'US', asn: 'AS13335 Cloudflare, Inc.', path: 'direct', iface: 'en0', rate: 55_000 },
  { app: 'Assistant', pid: 820, remote: '160.79.104.10', port: 443, host: 'api.anthropic.com', cc: 'US', asn: 'AS399358 Anthropic, PBC', path: 'vpn', iface: 'utun4', rate: 6_000 },
  { app: 'Keeper', pid: 900, remote: '192.168.1.40', port: 445, host: 'nas.local', path: 'lan', iface: 'en0', rate: 22_000, scope: 'lan' },
  { app: 'Printer Helper', pid: 330, remote: '192.168.1.23', port: 631, host: 'printer.local', path: 'lan', iface: 'en0', rate: 0, scope: 'lan' },
  { app: 'mDNSResponder', pid: 212, remote: '224.0.0.251', port: 5353, path: 'lan', iface: 'en0', rate: 200, proto: 'UDP', scope: 'multicast' },
  { app: 'node', pid: 770, listen: 5173, path: 'local', rate: 0 },
  { app: 'node', pid: 770, remote: '127.0.0.1', port: 5432, path: 'local', rate: 1_500, scope: 'loopback' },
  { app: 'postgres', pid: 780, listen: 5432, path: 'local', rate: 0 },
  { app: 'Messages', pid: 410, remote: '17.57.146.10', port: 5223, host: 'courier.push.apple.com', cc: 'US', asn: 'AS714 Apple Inc.', path: 'vpn', iface: 'utun4', rate: 200 },
  { app: 'Video Call', pid: 860, remote: '170.114.10.89', port: 8801, cc: 'NL', asn: 'AS30103 Zoom Video Communications, Inc.', path: 'vpn', iface: 'utun4', rate: 210_000, proto: 'UDP' },
];

let counters = new Map<string, { in: number; out: number }>();
let prev = new Map<string, { bytesIn?: number; bytesOut?: number; t: number; firstSeen: number }>();
let ifaceBytes = { en0: { rx: 8_400_000_000, tx: 1_200_000_000 }, utun4: { rx: 2_100_000_000, tx: 300_000_000 }, lo0: { rx: 900_000_000, tx: 900_000_000 } };
let lastT = 0;
const gw: (number | null)[] = [];
const net: (number | null)[] = [];
let settings: NetSettings = { hostNames: true, countries: true, latency: true, probeHost: '1.1.1.1', alertNewApps: false, autoReconnect: ['wg-home'] };
let homeUp = true;

function sample() {
  const now = Date.now();
  const ms = lastT ? now - lastT : 2000;
  lastT = now;
  const flows: FlowRow[] = seeds.map((s, i) => {
    const key = flowKey({ proto: s.proto ?? 'TCP', local: s.remote?.includes(':') ? '2001:db8::20' : '192.168.1.20', localPort: s.listen ?? 50000 + i, remote: s.remote, remotePort: s.port, pid: s.pid });
    const c = counters.get(key) ?? { in: s.rate * 30, out: s.rate * 3 };
    const wobble = 0.6 + Math.random() * 0.8;
    c.in += (s.rate * wobble * ms) / 1000;
    c.out += (s.rate * 0.12 * wobble * ms) / 1000;
    counters.set(key, c);
    const vpnPath = homeUp ? s.path : s.path === 'vpn' ? 'direct' : s.path;
    return {
      key, proto: s.proto ?? 'TCP', family: s.remote?.includes(':') ? 6 : 4, local: s.remote?.includes(':') ? '2001:db8::20' : s.listen ? '0.0.0.0' : '192.168.1.20', localPort: s.listen ?? 50000 + i,
      remote: s.remote, remotePort: s.port, state: s.listen ? 'Listen' : s.proto === 'UDP' ? undefined : 'Established', pid: s.pid, app: s.app,
      appPath: `/Applications/${s.app}.app/Contents/MacOS/${s.app}`,
      scope: s.listen ? 'listening' : s.scope ?? 'internet', path: vpnPath, iface: vpnPath === 'vpn' ? 'utun4' : s.iface === 'utun4' ? 'en0' : s.iface,
      host: s.host, service: serviceFor(s.host, s.asn), country: s.cc, asn: s.asn,
      bytesIn: s.listen ? undefined : Math.round(c.in), bytesOut: s.listen ? undefined : Math.round(c.out), firstSeen: now - (i + 1) * 60_000,
    };
  });
  prev = applyRates(flows, prev, now);
  const vIn = homeUp ? flows.filter((f) => f.path === 'vpn').reduce((a, f) => a + (f.rateIn ?? 0), 0) : 0;
  const vOut = homeUp ? flows.filter((f) => f.path === 'vpn').reduce((a, f) => a + (f.rateOut ?? 0), 0) : 0;
  const allIn = flows.filter((f) => f.path !== 'local').reduce((a, f) => a + (f.rateIn ?? 0), 0);
  const allOut = flows.filter((f) => f.path !== 'local').reduce((a, f) => a + (f.rateOut ?? 0), 0);
  ifaceBytes = {
    en0: { rx: ifaceBytes.en0.rx + (allIn * 1.04 * ms) / 1000, tx: ifaceBytes.en0.tx + (allOut * 1.06 * ms) / 1000 },
    utun4: { rx: ifaceBytes.utun4.rx + (vIn * ms) / 1000, tx: ifaceBytes.utun4.tx + (vOut * ms) / 1000 },
    lo0: ifaceBytes.lo0,
  };
  const ifaces: IfaceTraffic[] = [
    { name: 'en0', kind: 'wifi', label: 'Wi-Fi', up: true, mac: 'a4:5e:60:11:22:33', addresses: [{ address: '192.168.1.20', family: 4, prefix: 24 }, { address: '2001:db8::20', family: 6, prefix: 64 }], rx: ifaceBytes.en0.rx, tx: ifaceBytes.en0.tx, rxRate: allIn * 1.04, txRate: allOut * 1.06 },
    { name: 'utun4', kind: 'vpn', label: 'Home (WireGuard)', up: homeUp, addresses: homeUp ? [{ address: '10.2.0.2', family: 4, prefix: 32 }] : [], rx: ifaceBytes.utun4.rx, tx: ifaceBytes.utun4.tx, rxRate: vIn, txRate: vOut },
    { name: 'lo0', kind: 'loopback', label: 'This computer', up: true, addresses: [{ address: '127.0.0.1', family: 4, prefix: 8 }], rx: ifaceBytes.lo0.rx, tx: ifaceBytes.lo0.tx, rxRate: 1500, txRate: 1500 },
    { name: 'awdl0', kind: 'virtual', label: 'Virtual', up: true, addresses: [] },
  ];
  return { t: now, flows, apps: byApp(flows), dests: byDestination(flows), ifaces, totals: ifaceTotals(ifaces), amounts: 'connection' as const, notes: [] };
}

function vpnStatus(): VpnStatus {
  const vpns: VpnStatus['vpns'] = [
    { id: 'wg-home', name: 'Home', type: 'wireguard', state: homeUp ? 'connected' : 'disconnected', iface: homeUp ? 'utun4' : undefined, server: 'home.example.net:51820', source: 'scutil', wg: homeUp ? { peers: [{ publicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', endpoint: '203.0.113.5:51820', allowedIps: ['0.0.0.0/0'], handshake: Date.now() - 42_000, rx: 2_100_000_000, tx: 300_000_000 }] } : undefined },
    { id: 'office', name: 'Office (IKEv2)', type: 'ikev2', state: 'disconnected', server: 'vpn.example.com', source: 'scutil' },
  ];
  const ifaces = sample().ifaces;
  return {
    vpns, ifaces,
    verdict: homeUp
      ? { vpnUp: true, allV4: true, allV6: false, v6Leak: true, dnsOutside: [], v4Iface: 'utun4', v6Iface: 'en0', summary: 'IPv4 traffic goes through the VPN (utun4), but IPv6 traffic can still leave through en0.' }
      : { vpnUp: false, allV4: false, allV6: false, v6Leak: false, dnsOutside: [], v4Iface: 'en0', v6Iface: 'en0', summary: 'No VPN is connected. Internet traffic leaves through en0.' },
    dns: [{ address: homeUp ? '10.2.0.1' : '192.168.1.1', iface: homeUp ? 'utun4' : 'en0' }, { address: '10.0.0.53', iface: 'utun4', domain: 'corp.example' }],
    notes: [], advice: killSwitchAdvice('darwin'), autoReconnect: settings.autoReconnect,
  };
}

const pendingText = new Map<string, { text: string; name: string }>();

export function mockNet(): { net: NetApi } {
  return {
    net: {
      sample: async () => sample(),
      health: async () => {
        gw.push(2 + Math.random() * 3);
        net.push(Math.random() < 0.04 ? null : 18 + Math.random() * 14 + (homeUp ? 9 : 0));
        while (gw.length > 60) gw.shift();
        while (net.length > 60) net.shift();
        return {
          gateway: '192.168.1.1', gatewayIface: homeUp ? 'utun4' : 'en0', probeHost: settings.probeHost, gatewayMs: [...gw], internetMs: [...net],
          dns: vpnStatus().dns, wifi: { ssid: 'Home 5G', channel: '36 (5GHz, 80MHz)', security: 'WPA2/WPA3 Personal', rate: '864 Mb/s', signalDbm: -52 },
        };
      },
      vpnStatus: async () => vpnStatus(),
      vpnAction: async (id, action) => {
        if (id === 'wg-home') homeUp = action === 'connect';
        await new Promise((r) => setTimeout(r, 600));
        return id === 'office' && action === 'connect' ? { ok: false, message: 'The server asked for a password: connect from System Settings → VPN once to save it.' } : { ok: true };
      },
      importPick: async () => {
        const text = '[Interface]\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nAddress = 10.66.0.2/32\nDNS = 10.66.0.1\n\n[Peer]\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nAllowedIPs = 0.0.0.0/0\nEndpoint = travel.example.org:51820\nPersistentKeepalive = 25\n';
        const token = 'demo-' + Date.now();
        pendingText.set(token, { text, name: 'travel.conf' });
        return { summary: parseVpnConfig(text, 'travel.conf'), method: 'wireguard-app', methodNote: 'Keeper hands the file to the WireGuard app, which asks to add it and keeps the keys in the Keychain.', token };
      },
      importText: async (text, fileName) => ({ summary: parseVpnConfig(text, fileName), method: 'manual', methodNote: 'Demo: nothing is installed.', token: 'demo' }),
      importInstall: async () => ({ ok: true, message: 'The WireGuard app opened with the file; confirm there to add it.' }),
      publicIp: async () => {
        await new Promise((r) => setTimeout(r, 700));
        return homeUp ? { current: '203.0.113.5', currentV6: '2001:db8:1234::20', outsideVpn: '198.51.100.77', outsideIface: 'en0' } : { current: '198.51.100.77', currentV6: '2001:db8:1234::20', outsideVpn: '198.51.100.77', outsideIface: 'en0' };
      },
      settings: async () => settings,
      setSettings: async (p) => (settings = { ...settings, ...p }),
      geoStatus: async () => (settings.countries ? { state: 'ready', date: '2026-10', ranges: 1_186_000 } : { state: 'off' }),
      geoDownload: async () => { settings.countries = true; return { state: 'ready', date: '2026-10', ranges: 1_186_000 }; },
      geoRemove: async () => { settings.countries = false; return { state: 'off' }; },
      exportCsv: async () => '/Users/demo/Downloads/Keeper connections.csv',
      icons: async () => ({}),
    },
  };
}
