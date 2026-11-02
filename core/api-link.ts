// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Link in the interface: this device, paired devices, pairing, sending
// files, shared folders, port forwarding, the phone companion and the tunnel.

import type { CarrierKind } from './link/channel';
import type { TunnelMode } from './link/cloudflared';
import type { Permission, PermissionSet } from './link/perms';
import type { Progress } from './link/transfer';
import type { DeviceMeta } from './link/fleet';

export type { CarrierKind, Permission, PermissionSet, Progress as LinkTransfer };

/** How far this device reaches out. */
export type LinkMode = 'off' | 'lan' | 'internet';

export interface LinkSettings {
  mode: LinkMode;
  /** "Never leaves my network": no relay, no mailbox, no tunnel, even in internet mode */
  localOnly: boolean;
  port: number;
  /** a Keeper Relay base URL (https://…), optional */
  relayUrl: string;
  /** ntfy-compatible server for finding devices over the internet ('' = off) */
  mailbox: string;
  /** STUN servers for direct internet connections (reserved for WebRTC) */
  stun: string[];
  /** where files sent to this device go ('' = Downloads/Keeper) */
  downloadDir: string;
  /** keep the clipboard the same on devices that allow it */
  clipboardSync: boolean;
  /** allow forwards and the SOCKS proxy to reach this device's local network, not only itself */
  forwardLan: boolean;
  shares: LinkShare[];
  /** let devices on this network find this computer before anything is paired (otherwise Link listens only on this computer until you pair) */
  discoverable?: boolean;
  /** where remote access shows up (tray, Island, palette, right-click menu); missing = everywhere */
  surfaces?: Record<string, string[]>;
}

export interface LinkShare {
  id: string;
  name: string;
  path: string;
}

export interface LinkDevice {
  id: string;
  name: string;
  os: string;
  fingerprint: string;
  pairedAt: number;
  lastSeen?: number;
  permissions: PermissionSet;
  /** accept files from it without asking */
  autoAccept: boolean;
  online: boolean;
  /** how it is connected right now */
  via?: CarrierKind;
  where?: string;
  /** round-trip time of the last check, ms */
  rtt?: number;
  /** seen on this network */
  nearby?: boolean;
  /** groups, tags, notes and saved commands (yours, kept on this device) */
  meta?: DeviceMeta;
  /** the carriers under the connection right now, with bytes moved on each */
  paths?: { kind: string; where?: string; since: number; bytesIn: number; bytesOut: number; active: boolean }[];
}

export interface ThisDevice {
  id: string;
  name: string;
  os: string;
  fingerprint: string;
  /** false when the system keychain was not available and the key is in a file only this user can read */
  keyProtected: boolean;
  addresses: string[];
  port: number;
  listening: boolean;
  /** reachable from the local network (false until something is paired, pairing is open, or findable is on) */
  lanOpen?: boolean;
  /** this device's key is in the keychain, which will not open now (Link waits instead of making a new key) */
  keyWaiting?: boolean;
  relay?: { url: string; connected: boolean; error?: string };
  tunnel?: TunnelStatus;
  wireguard?: string[];
}

export interface TunnelStatus {
  mode: TunnelMode;
  state: 'off' | 'downloading' | 'starting' | 'connected' | 'reconnecting' | 'error' | 'stopped';
  url?: string;
  connections: number;
  since?: number;
  restarts: number;
  lastError?: string;
  download?: number;
  /** installed as a system service, keeps running after Keeper quits */
  service: boolean;
  hasToken: boolean;
}

export interface PairInvite {
  code: string;
  /** keeper://pair?… for the QR code */
  link: string;
  /** a QR code image (data URL) */
  qr: string;
  expires: number;
}

export interface PairPrompt {
  id: string;
  /** six digits to compare */
  sas: string;
  peer: { name: string; os: string; fingerprint: string };
  role: 'host' | 'joiner';
}

export interface NearbyDevice {
  id: string;
  name: string;
  os: string;
  addresses: string[];
  port: number;
  pairing: boolean;
  paired: boolean;
}

export interface FileOffer {
  id: string;
  from: string;
  fromName: string;
  name: string;
  size: number;
}

export interface Forward {
  id: string;
  device: string;
  kind: 'port' | 'socks';
  localPort: number;
  host?: string;
  port?: number;
  active: boolean;
  error?: string;
}

export interface RemoteEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface CompanionInvite {
  url: string;
  qr: string;
  expires: number;
  /** false on plain HTTP over the local network; true through the tunnel */
  https: boolean;
}

export interface Companion {
  id: string;
  name: string;
  created: number;
  lastSeen?: number;
  online: boolean;
  /** may open a terminal here from the phone page */
  terminal?: boolean;
}

export interface LinkState {
  me: ThisDevice;
  settings: LinkSettings;
  devices: LinkDevice[];
  transfers: Progress[];
  forwards: Forward[];
  companions: Companion[];
}

export interface LinkApi {
  state(): Promise<LinkState>;
  setSettings(patch: Partial<LinkSettings>): Promise<LinkState>;
  rename(name: string): Promise<void>;
  /** look for Keeper devices on this network */
  discover(): Promise<NearbyDevice[]>;
  /** show a code and QR here so another device can pair */
  invite(): Promise<PairInvite>;
  cancelInvite(): Promise<void>;
  /** pair with a device that shows a code (from discover) or by a keeper://pair link / address */
  pair(target: { deviceId?: string; address?: string; code?: string; link?: string }): Promise<{ ok: boolean; error?: string; device?: string }>;
  /** answer the six-digit comparison */
  confirmPair(id: string, ok: boolean): Promise<void>;
  forget(device: string): Promise<void>;
  setPermissions(device: string, perms: PermissionSet, autoAccept?: boolean): Promise<void>;
  renameDevice(device: string, name: string): Promise<void>;
  /** connect now and measure */
  check(device: string): Promise<{ ok: boolean; via?: CarrierKind; rtt?: number; error?: string }>;
  sendFiles(device: string, paths?: string[]): Promise<void>;
  answerOffer(id: string, accept: boolean, always?: boolean): Promise<void>;
  sendClipboard(device: string): Promise<void>;
  shares(device: string): Promise<LinkShare[]>;
  list(device: string, share: string, dir: string): Promise<RemoteEntry[]>;
  download(device: string, share: string, file: string): Promise<string>;
  addShare(path?: string): Promise<LinkState>;
  removeShare(id: string): Promise<LinkState>;
  addForward(f: { device: string; kind: 'port' | 'socks'; localPort: number; host?: string; port?: number }): Promise<Forward>;
  removeForward(id: string): Promise<void>;
  companionInvite(viaTunnel?: boolean): Promise<CompanionInvite>;
  /** allow or refuse a phone that scanned the QR code */
  answerCompanion(id: string, ok: boolean): Promise<void>;
  forgetCompanion(id: string): Promise<void>;
  /** let a phone open a terminal here, or not */
  setCompanionTerminal(id: string, on: boolean): Promise<void>;
  /** prompts already waiting when the window opened */
  pending(): Promise<{ pairs: PairPrompt[]; offers: FileOffer[] }>;
  tunnel: {
    status(): Promise<TunnelStatus>;
    start(mode: TunnelMode, token?: string, hostname?: string): Promise<TunnelStatus>;
    stop(): Promise<TunnelStatus>;
    installService(on: boolean): Promise<TunnelStatus>;
  };
}
