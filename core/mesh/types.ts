// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh: a private IP network between your paired devices, built on
// WireGuard. These are the shapes the app, the window and the command line
// share. See docs/MESH.md.

/** How packets reach a peer right now. */
export type MeshPath = 'lan' | 'internet' | 'relay' | 'none';

export const PATH_LABEL: Record<MeshPath, string> = {
  lan: 'Direct (LAN)',
  internet: 'Direct (internet)',
  relay: 'Relayed',
  none: 'Not connected',
};

/** Your own device, or someone else's device you invited. */
export type MeshRole = 'own' | 'guest';

/** A way to reach a device, as it tells its peers. */
export interface Candidate {
  kind: 'lan' | 'public' | 'relay';
  /** "ip:port" (IPv6 in brackets) or, for a relay, its https address */
  addr: string;
}

/** Who may reach which ports on this device over the mesh. */
export interface MeshRule {
  id: string;
  /** a device id, or "own" (your devices) or "guests" (everyone you invited) */
  from: string;
  proto: 'tcp' | 'udp' | 'any';
  /** "all", or a list like "22, 80, 8000-8100" */
  ports: string;
  note?: string;
}

export interface MeshMember {
  device: string;
  role: MeshRole;
  added: number;
}

export interface MeshNetwork {
  /** 16 hex characters, random, made by the device that created the network */
  id: string;
  name: string;
  /** device ids that may join; the person on each device still says yes */
  members: MeshMember[];
  /** inbound rules on this device */
  rules: MeshRule[];
  /** IPv4 too (inside 100.64.0.0/10), as well as the IPv6 ULA */
  ipv4: boolean;
  prefix6: string;
  prefix4?: string;
  created: number;
  /** the device that made it */
  owner: string;
}

export interface MeshPeerView {
  device: string;
  name: string;
  dns: string;
  role: MeshRole;
  online: boolean;
  /** this device has said yes and sent a signed key */
  joined: boolean;
  a6?: string;
  a4?: string;
  wgKey?: string;
  path: MeshPath;
  endpoint?: string;
  /** WireGuard sends to this peer itself (direct handoff): its packets bypass Keeper */
  bypass?: boolean;
  latencyMs?: number;
  lastHandshake?: number;
  rx: number;
  tx: number;
  offersExit: boolean;
  routes: string[];
  routesAccepted: boolean;
  /** the signature over its WireGuard key checked out against its Link identity */
  keyVerified: boolean;
  error?: string;
}

export interface MeshNetView extends MeshNetwork {
  me: { a6: string; a4?: string; dns: string };
  peers: MeshPeerView[];
  /** a local route already uses this network's IPv4 range */
  conflict?: string;
}

export type IfaceState = 'off' | 'starting' | 'up' | 'config-only' | 'needs-admin' | 'no-wireguard' | 'error';

export interface MeshState {
  /** the Keeper Mesh feature is on (Settings → Features) */
  feature: boolean;
  /** you switched the mesh on */
  on: boolean;
  iface: {
    state: IfaceState;
    name?: string;
    impl?: 'kernel' | 'wireguard-go' | 'wireguard-nt' | 'none';
    message?: string;
  };
  wgPub?: string;
  port: number;
  candidates: Candidate[];
  networks: MeshNetView[];
  exit: { using?: string; offering: boolean; killSwitch: boolean; dnsThrough: boolean; allowLan: boolean };
  advertise: { routes: string[]; approved: boolean };
  dns: { suffix: string; responder?: string; split: 'on' | 'off' | 'failed'; hosts: boolean; message?: string };
  relay?: { url: string; connected: boolean };
  /** invitations waiting for an answer on this device */
  invites: MeshInvite[];
  /** where each control appears besides the Mesh page */
  places: Record<MeshControl, MeshPlace[]>;
}

export interface MeshInvite {
  id: string;
  net: string;
  name: string;
  from: string;
  fromName: string;
  role: MeshRole;
}

/** Places outside the Mesh page where a mesh control can appear (the page always has everything). */
export type MeshPlace = 'tray' | 'island' | 'palette';
export type MeshControl = 'power' | 'exit' | 'addresses';

/** Which places each control can go to. */
export const MESH_PLACE_CHOICES: Record<MeshControl, MeshPlace[]> = {
  power: ['tray', 'palette'],
  exit: ['tray', 'island', 'palette'],
  addresses: ['tray', 'palette'],
};

export const MESH_CONTROL_LABEL: Record<MeshControl, string> = {
  power: 'Mesh on and off',
  exit: 'Exit node',
  addresses: 'Device addresses (copy)',
};

export const MESH_PLACE_LABEL: Record<MeshPlace, string> = { tray: 'Menu bar / tray', island: 'Island', palette: 'Command palette' };

export const DEFAULT_PLACES: Record<MeshControl, MeshPlace[]> = { power: ['tray', 'palette'], exit: ['tray', 'island', 'palette'], addresses: ['tray', 'palette'] };

/** Keeps only places a control can actually go to. */
export function cleanPlaces(p: Partial<Record<MeshControl, MeshPlace[]>> | undefined): Record<MeshControl, MeshPlace[]> {
  const out = { ...DEFAULT_PLACES };
  for (const k of Object.keys(MESH_PLACE_CHOICES) as MeshControl[]) if (Array.isArray(p?.[k])) out[k] = [...new Set(p![k]!.filter((x) => MESH_PLACE_CHOICES[k].includes(x)))];
  return out;
}

export interface TrayRow {
  label: string;
  checked?: boolean;
  submenu?: TrayRow[];
}

export interface MeshDiag {
  ok: boolean;
  lines: string[];
}

export interface MeshApi {
  state(): Promise<MeshState>;
  setOn(on: boolean): Promise<MeshState>;
  createNetwork(name: string, ipv4?: boolean): Promise<MeshState>;
  renameNetwork(id: string, name: string): Promise<MeshState>;
  removeNetwork(id: string): Promise<MeshState>;
  addMember(net: string, device: string, role: MeshRole): Promise<MeshState>;
  removeMember(net: string, device: string): Promise<MeshState>;
  answerInvite(id: string, ok: boolean): Promise<MeshState>;
  setExit(device: string | null, opts?: { killSwitch?: boolean; dnsThrough?: boolean; allowLan?: boolean }): Promise<MeshState>;
  offerExit(on: boolean): Promise<MeshState>;
  advertise(routes: string[]): Promise<MeshState>;
  acceptRoutes(device: string, on: boolean): Promise<MeshState>;
  saveRule(net: string, rule: MeshRule): Promise<MeshState>;
  removeRule(net: string, id: string): Promise<MeshState>;
  setDns(p: { suffix?: string; hosts?: boolean }): Promise<MeshState>;
  ping(device: string): Promise<MeshDiag>;
  pathTest(device: string): Promise<MeshDiag>;
  mtuProbe(device: string): Promise<MeshDiag>;
  setPlaces(p: Partial<Record<MeshControl, MeshPlace[]>>): Promise<MeshState>;
  /** what the tray / menu bar shows for the mesh right now (labels only; for checking placement) */
  trayPreview(): Promise<TrayRow[]>;
  /** the generated WireGuard configuration (private key left out) */
  config(net: string): Promise<string>;
}
