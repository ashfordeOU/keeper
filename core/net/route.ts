// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which way traffic leaves the computer: the route a destination takes, what
// kind of interface that is (a VPN tunnel, Wi-Fi, Ethernet), and plain-English
// answers to "is everything going through the VPN?".

import { familyOf, inPrefix, scopeOf, unmapV4 } from './addr';
import type { IfaceKind, RouteEntry, VpnConn } from './types';

/** Longest-prefix match, lowest metric first among equals. */
export function lookupRoute(routes: RouteEntry[], ipIn: string): RouteEntry | undefined {
  const ip = unmapV4(ipIn);
  const fam = familyOf(ip);
  let best: RouteEntry | undefined;
  for (const r of routes) {
    if (r.family !== fam) continue;
    if (!inPrefix(ip, r.dest, r.prefix)) continue;
    if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.metric < best.metric)) best = r;
  }
  return best;
}

/** The default route (0.0.0.0/0 or ::/0) traffic to the internet uses. */
export function defaultRoute(routes: RouteEntry[], family: 4 | 6): RouteEntry | undefined {
  return lookupRoute(routes, family === 4 ? '8.8.8.8' : '2001:4860:4860::8888');
}

/**
 * Many VPNs don't replace the default route; they add two halves
 * (0.0.0.0/1 + 128.0.0.0/1, ::/1 + 8000::/1) that beat it. Following real
 * public addresses through the table catches both styles.
 */
export function internetIface(routes: RouteEntry[], family: 4 | 6): string | undefined {
  const probes = family === 4 ? ['8.8.8.8', '151.101.1.1', '203.0.113.9'] : ['2001:4860:4860::8888', '2606:4700::1111'];
  const hits = probes.map((p) => lookupRoute(routes, p)?.iface).filter(Boolean) as string[];
  return hits[0];
}

const VPN_NAME = /^(utun\d+|ipsec\d+|ppp\d+|tun\d*|tap\d+|wg\d*|wg-.+|.*vpn.*|.*tun\d+)$/i;
const VPN_DESC = /(wireguard|wintun|tap-windows|openvpn|vpn|tunnel|wan miniport \((ikev2|l2tp|pptp|sstp)\))/i;

/** What kind of interface a name (and on Windows its description) is. */
export function classifyIface(name: string, opts: { description?: string; vpnIfaces?: Set<string>; wifi?: Set<string>; platform?: string } = {}): IfaceKind {
  const n = name.toLowerCase();
  const d = opts.description ?? '';
  if (opts.vpnIfaces?.has(name)) return 'vpn';
  if (/^lo\d*$|^loopback/i.test(n) || /loopback/i.test(d)) return 'loopback';
  if (VPN_DESC.test(d)) return 'vpn';
  if (opts.platform === 'darwin' && /^utun\d+$/.test(n)) return 'tunnel'; // macOS also uses utun for system services; a VPN list can promote it
  if (VPN_NAME.test(n)) return 'vpn';
  if (opts.wifi?.has(name) || /^(wl|wlan|wlp|wlx|ath|wi-?fi)/i.test(n) || /wireless|wi-?fi|802\.11/i.test(d)) return 'wifi';
  if (/^(en|eth|enp|eno|ens|em|bond|ethernet)/i.test(n) || /ethernet|gbe|realtek|intel\(r\) (ethernet|i2)/i.test(d)) {
    // On macOS en0 is usually Wi-Fi on laptops; the caller's Wi-Fi list decides that.
    return 'ethernet';
  }
  if (/^(pdp_ip|rmnet|wwan|wwp|ccmni)/i.test(n) || /mobile broadband|cellular/i.test(d)) return 'cellular';
  if (/^(docker|br-|veth|virbr|vmnet|vboxnet|bridge|awdl|llw|anpi|ap\d|gif|stf|ifb|dummy|lxc|cni|flannel|kube)/i.test(n) || /hyper-v|virtualbox|vmware|virtual/i.test(d)) return 'virtual';
  return 'other';
}

export type PathKind = 'vpn' | 'direct' | 'local' | 'lan';

/** How a connection to `remote` leaves the computer. */
export function pathFor(remote: string | undefined, routes: RouteEntry[], kinds: Map<string, IfaceKind>, ifaceHint?: string): { path: PathKind; iface?: string; gateway?: string } {
  if (!remote) return { path: 'local' };
  const scope = scopeOf(remote);
  if (scope === 'loopback' || scope === 'unspecified') return { path: 'local', iface: ifaceHint };
  const r = ifaceHint ? { iface: ifaceHint, gateway: undefined } : lookupRoute(routes, remote);
  const iface = r?.iface;
  const kind = iface ? kinds.get(iface) : undefined;
  // Connections to one of this computer's own addresses never leave it.
  if (kind === 'loopback') return { path: 'local', iface };
  if (kind === 'vpn' || kind === 'tunnel') return { path: 'vpn', iface, gateway: r?.gateway };
  if (scope === 'lan' || scope === 'link' || scope === 'multicast') return { path: 'lan', iface, gateway: r?.gateway };
  return { path: 'direct', iface, gateway: r?.gateway };
}

export interface TrafficVerdict {
  /** a VPN is connected */
  vpnUp: boolean;
  /** IPv4 internet traffic goes through the VPN */
  allV4: boolean;
  /** IPv6 internet traffic goes through the VPN (or there is no IPv6 route at all) */
  allV6: boolean;
  /** the computer can reach the IPv6 internet outside the VPN */
  v6Leak: boolean;
  /** DNS servers reached outside the VPN while it is up */
  dnsOutside: string[];
  v4Iface?: string;
  v6Iface?: string;
  summary: string;
}

/** Plain-English answer to "is my traffic going through the VPN?". */
export function trafficVerdict(routes: RouteEntry[], kinds: Map<string, IfaceKind>, vpns: VpnConn[], dns: { address: string; iface?: string; domain?: string }[]): TrafficVerdict {
  const isTunnel = (i?: string) => !!i && (kinds.get(i) === 'vpn' || kinds.get(i) === 'tunnel');
  const vpnUp = vpns.some((v) => v.state === 'connected') || [...kinds.values()].some((k) => k === 'vpn');
  const v4Iface = internetIface(routes, 4);
  const v6Iface = internetIface(routes, 6);
  const allV4 = isTunnel(v4Iface);
  const allV6 = !v6Iface || isTunnel(v6Iface);
  const v6Leak = vpnUp && allV4 && !!v6Iface && !isTunnel(v6Iface);
  const dnsOutside = vpnUp
    ? dns.filter((d) => !d.domain).filter((d) => {
      const s = scopeOf(d.address);
      if (s === 'loopback') return false; // a local stub resolver forwards on; its upstream decides
      const via = d.iface ?? lookupRoute(routes, d.address)?.iface;
      return !isTunnel(via);
    }).map((d) => d.address)
    : [];
  let summary: string;
  if (!vpnUp) summary = v4Iface ? `No VPN is connected. Internet traffic leaves through ${v4Iface}.` : 'No VPN is connected.';
  else if (allV4 && allV6 && !dnsOutside.length) summary = `All internet traffic goes through the VPN (${v4Iface}).`;
  else if (allV4) summary = `IPv4 traffic goes through the VPN (${v4Iface})${v6Leak ? `, but IPv6 traffic can still leave through ${v6Iface}` : ''}${dnsOutside.length ? `${v6Leak ? ', and' : ', but'} DNS questions go to ${dnsOutside.join(', ')} outside it` : ''}.`;
  else summary = `A VPN is connected, but internet traffic still leaves through ${v4Iface ?? 'the normal connection'}: the VPN only covers some addresses (split tunnel).`;
  return { vpnUp, allV4, allV6, v6Leak, dnsOutside, v4Iface, v6Iface, summary };
}

/** Advice for keeping traffic from leaking when the VPN drops, per operating system. */
export function killSwitchAdvice(platform: string): string[] {
  if (platform === 'darwin') {
    return [
      'Use "Connect On Demand" and "Exclude local networks" off in the VPN app, so the tunnel comes back before traffic flows.',
      'For a hard block, the built-in packet filter (pf) can allow traffic only through the VPN interface; WireGuard\'s macOS app does this with "Block untunneled traffic (kill-switch)".',
      'Check here after waking from sleep: macOS may send traffic before the tunnel is back.',
    ];
  }
  if (platform === 'win32') {
    return [
      'The WireGuard app for Windows blocks untunneled traffic when a tunnel has AllowedIPs = 0.0.0.0/0, ::/0 ("kill-switch" in its editor).',
      'For built-in VPNs, set the VPN connection to "Always On" (Settings → Network → VPN → Advanced) and turn off "Use default gateway on remote network" only if you want a split tunnel.',
      'Windows Firewall rules that allow outbound traffic only on the VPN adapter give a hard block.',
    ];
  }
  return [
    'NetworkManager: set the VPN as a secondary connection of your Wi-Fi/Ethernet ("Automatically connect to VPN"), so it starts with the network.',
    'wg-quick: add a nftables/iptables rule that rejects traffic not marked by WireGuard (the PostUp example in the wg-quick manual), or use a policy-routing table that only has the tunnel.',
    'OpenVPN: "redirect-gateway def1" plus "block-outside-dns" style rules; on Linux use firewall rules allowing only the tun interface and the VPN server\'s address.',
  ];
}
