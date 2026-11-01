// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Network Activity and VPN as the interface sees them.

import type { NetSample } from './net/flows';
import type { DnsServer, WifiInfo } from './net/parse';
import type { TrafficVerdict } from './net/route';
import type { NetIface, VpnConn } from './net/types';
import type { VpnConfigSummary } from './net/vpnconf';

export interface NetSettings {
  /** look up host names for addresses (reverse DNS, through your normal DNS server) */
  hostNames: boolean;
  /** show countries and networks from a table kept on this computer (downloaded once) */
  countries: boolean;
  /** measure latency to the router and to `probeHost` while the page is open */
  latency: boolean;
  probeHost: string;
  /** notify (Island) when an app talks to the internet for the first time */
  alertNewApps: boolean;
  /** VPN connection ids Keeper reconnects when they drop */
  autoReconnect: string[];
}

export interface GeoStatus {
  state: 'off' | 'downloading' | 'ready' | 'error';
  progress?: number;
  /** month of the data, "2026-10" */
  date?: string;
  ranges?: number;
  message?: string;
}

export interface NetHealth {
  gateway?: string;
  gatewayIface?: string;
  dns: DnsServer[];
  wifi?: WifiInfo;
  /** round trip in ms, or null for no answer; newest last */
  gatewayMs: (number | null)[];
  internetMs: (number | null)[];
  probeHost: string;
}

export interface VpnStatus {
  vpns: VpnConn[];
  ifaces: NetIface[];
  verdict: TrafficVerdict;
  dns: DnsServer[];
  /** which tools were missing or refused, in plain words */
  notes: string[];
  advice: string[];
  /** auto-reconnect choices */
  autoReconnect: string[];
}

export interface PublicIpResult {
  /** through the normal route (the VPN when it is up) */
  current?: string;
  currentV6?: string;
  /** forced through the physical interface; differs from `current` when the VPN is doing its job */
  outsideVpn?: string;
  outsideIface?: string;
  error?: string;
}

export interface VpnImportPreview {
  summary: VpnConfigSummary;
  /** how Keeper would install it here */
  method: 'networkmanager' | 'wireguard-app' | 'wireguard-service' | 'openvpn-app' | 'manual';
  methodNote: string;
  /** token for the install step; the file text is held in memory only */
  token: string;
}

export interface NetApi {
  /** one reading of every connection; asked for only while the page is open */
  sample(): Promise<NetSample>;
  health(): Promise<NetHealth>;
  vpnStatus(): Promise<VpnStatus>;
  vpnAction(id: string, action: 'connect' | 'disconnect'): Promise<{ ok: boolean; message?: string; needsAdmin?: boolean }>;
  /** asks for a .conf / .ovpn file and shows what is in it (secrets hidden) */
  importPick(): Promise<VpnImportPreview | null>;
  importText(text: string, fileName: string): Promise<VpnImportPreview>;
  importInstall(token: string, opts?: { name?: string; keepCopy?: boolean }): Promise<{ ok: boolean; message: string }>;
  publicIp(): Promise<PublicIpResult>;
  settings(): Promise<NetSettings>;
  setSettings(patch: Partial<NetSettings>): Promise<NetSettings>;
  geoStatus(): Promise<GeoStatus>;
  geoDownload(): Promise<GeoStatus>;
  geoRemove(): Promise<GeoStatus>;
  /** saves the current connections as CSV through a save dialog */
  exportCsv(): Promise<string | null>;
  icons(paths: string[]): Promise<Record<string, string>>;
}
