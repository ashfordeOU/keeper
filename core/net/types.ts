// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shapes shared by the network activity view, the VPN page and their parsers.

/** One network connection (or a listening/bound socket) as the operating system reports it. */
export interface NetConn {
  proto: 'TCP' | 'UDP';
  family: 4 | 6;
  local: string;
  localPort: number;
  /** missing for listening sockets and unconnected UDP */
  remote?: string;
  remotePort?: number;
  /** Established, Listen, TimeWait… (TCP only) */
  state?: string;
  pid?: number;
  /** process name, when the source reports it directly */
  name?: string;
  /** Linux socket inode, used to find the owning process */
  inode?: string;
  uid?: number;
  /** total bytes so far, where the operating system counts per connection */
  bytesIn?: number;
  bytesOut?: number;
  /** interface name, when the source reports it (macOS nettop does) */
  iface?: string;
}

/** Bytes per process, for systems that count per process rather than per connection. */
export interface ProcBytes {
  pid: number;
  name: string;
  bytesIn: number;
  bytesOut: number;
}

/** A line of a routing table. Destinations are numeric addresses with a prefix length. */
export interface RouteEntry {
  family: 4 | 6;
  dest: string;
  prefix: number;
  gateway?: string;
  iface: string;
  metric: number;
}

export type AddrScope = 'loopback' | 'lan' | 'link' | 'multicast' | 'internet' | 'unspecified';

export type IfaceKind = 'vpn' | 'tunnel' | 'wifi' | 'ethernet' | 'cellular' | 'loopback' | 'virtual' | 'other';

export interface NetIface {
  name: string;
  kind: IfaceKind;
  /** friendly name: "Wi-Fi", "Work VPN" */
  label?: string;
  addresses: { address: string; family: 4 | 6; prefix?: number }[];
  mac?: string;
  up: boolean;
}

/** A VPN or tunnel connection known to the operating system's network settings. */
export interface VpnConn {
  id: string;
  name: string;
  /** wireguard, openvpn, ipsec, l2tp, ikev2, pptp, sstp, vpn (other) */
  type: string;
  state: 'connected' | 'connecting' | 'disconnected' | 'disconnecting' | 'unknown';
  /** interface it uses while connected (utun4, tun0, wg0…) */
  iface?: string;
  server?: string;
  /** who manages it: networkmanager, scutil, windows-ras, wireguard-service, wg */
  source: string;
  /** WireGuard details from `wg show`, when readable */
  wg?: { peers: { publicKey: string; endpoint?: string; allowedIps: string[]; handshake?: number; rx: number; tx: number }[] };
}
