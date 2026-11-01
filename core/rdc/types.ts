// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops: saved connections to other computers by any protocol, the
// sessions that are open now, and how each one is reached. Plain data, shared
// by the main process, the interface and the `keeper rdc` command.

export type Protocol = 'rdp' | 'vnc' | 'ssh' | 'mosh' | 'telnet' | 'serial' | 'spice' | 'x2go' | 'winrm' | 'web' | 'keeper';

export const PROTOCOLS: { id: Protocol; label: string; port?: number }[] = [
  { id: 'rdp', label: 'Remote Desktop (RDP)', port: 3389 },
  { id: 'vnc', label: 'VNC', port: 5900 },
  { id: 'ssh', label: 'SSH', port: 22 },
  { id: 'mosh', label: 'Mosh', port: 22 },
  { id: 'telnet', label: 'Telnet', port: 23 },
  { id: 'serial', label: 'Serial console' },
  { id: 'spice', label: 'SPICE', port: 5900 },
  { id: 'x2go', label: 'X2Go / NX', port: 22 },
  { id: 'winrm', label: 'PowerShell remoting', port: 5985 },
  { id: 'web', label: 'Web console', port: 443 },
  { id: 'keeper', label: 'Keeper device' },
];

export const defaultPort = (p: Protocol): number | undefined => PROTOCOLS.find((x) => x.id === p)?.port;

/** An SSH port forward saved with a connection (-L, -R or -D). */
export interface PortForward {
  kind: 'L' | 'R' | 'D';
  /** the port that listens (here for -L/-D, on the server for -R) */
  listen: number;
  bind?: string;
  /** where it leads (not for -D) */
  host?: string;
  port?: number;
}

/** How a connection is reached when it is not reached directly. */
export type Gateway =
  | { kind: 'none' }
  /** through an SSH server: a tunnel for VNC/RDP/…, a jump host for SSH */
  | { kind: 'ssh'; host: string; port?: number; user?: string; keyFile?: string }
  /** through an HTTP (CONNECT) or SOCKS5 proxy */
  | { kind: 'proxy'; type: 'http' | 'socks5'; host: string; port: number; user?: string }
  /** through a paired Keeper device (Keeper Link port forward): no ports open to the internet */
  | { kind: 'link'; device: string }
  /** through the mesh network: just another address for the same computer */
  | { kind: 'mesh'; address: string };

export interface RdpOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
  /** use every monitor */
  multimon?: boolean;
  /** share this computer's drives with the remote one */
  drives?: boolean;
  clipboard?: boolean;
  audio?: 'local' | 'remote' | 'off';
  /** a Remote Desktop Gateway (host[:port]) */
  gateway?: string;
  gatewayUser?: string;
  /** Network Level Authentication (sign in before the session starts); on by default */
  nla?: boolean;
  /** the admin / console session */
  admin?: boolean;
  /** resize the remote desktop with the window */
  dynamicResolution?: boolean;
  /** accept a certificate that does not check out (self-signed); off by default */
  ignoreCert?: boolean;
}

export interface VncOptions {
  viewOnly?: boolean;
  scale?: 'fit' | 'none';
  /** let other viewers stay connected (on by default) */
  shared?: boolean;
  /** open in an outside viewer instead of a Keeper tab */
  external?: boolean;
  /** lossless (ZRLE first, the default) or fast (Tight with JPEG first, for slow links) */
  picture?: 'lossless' | 'fast';
}

export interface SshOptions {
  x11?: boolean;
  agent?: boolean;
  forwards?: PortForward[];
  /** run this instead of a shell */
  command?: string;
}

export interface SerialOptions {
  baud: number;
  dataBits?: 5 | 6 | 7 | 8;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: 1 | 2;
}

export interface WebOptions {
  /** the page to open (https://idrac.local/ …); defaults to https://host[:port]/ */
  url?: string;
  /** a certificate fingerprint ("sha256/…") to trust for this console only */
  pin?: string;
}

export interface Connection {
  id: string;
  name: string;
  protocol: Protocol;
  /** host name or address; the device path for serial; the device id for Keeper devices */
  host: string;
  port?: number;
  user?: string;
  /** Windows domain (RDP) */
  domain?: string;
  folder?: string;
  tags?: string[];
  color?: string;
  favourite?: boolean;
  notes?: string;
  /** how to sign in (SSH): password, a key file, the agent, or questions from the server */
  auth?: 'password' | 'key' | 'agent' | 'interactive' | 'none';
  keyFile?: string;
  /** do not store the password: ask for it each time */
  askEveryTime?: boolean;
  /** a password is stored in the system keychain (set by Keeper, never the password itself) */
  hasPassword?: boolean;
  gateway?: Gateway;
  /** SSH ProxyJump chain: user@host:port, … */
  jump?: string[];
  /** network card address, for Wake-on-LAN */
  mac?: string;
  rdp?: RdpOptions;
  vnc?: VncOptions;
  ssh?: SshOptions;
  serial?: SerialOptions;
  web?: WebOptions;
  winrm?: { ssl?: boolean; auth?: 'Default' | 'Negotiate' | 'Kerberos' | 'Basic' };
  spice?: { tls?: boolean };
  /** the desktop X2Go starts (XFCE, MATE, LXDE, KDE…) */
  x2go?: { command?: string };
  /** a trusted SSH host key fingerprint (SHA256:…) learned on first connect */
  hostKey?: string;
  created: number;
  lastUsed?: number;
}

export type SessionKind = 'inapp' | 'external' | 'terminal' | 'web' | 'keeper';

export interface RdcSession {
  id: string;
  connId?: string;
  name: string;
  protocol: Protocol;
  kind: SessionKind;
  state: 'connecting' | 'connected' | 'closed' | 'error';
  error?: string;
  started: number;
  /** what the picture is (VNC) */
  width?: number;
  height?: number;
  desktop?: string;
  /** the Keeper terminal running it */
  terminal?: string;
  /** the outside program running it */
  program?: string;
  pid?: number;
  /** how it is reached, in words ("through Keeper Link (Desk)") */
  via?: string;
}

export type Online = 'online' | 'offline' | 'unknown';

/** What to do after Connect, for the interface. */
export interface ConnectResult {
  session?: RdcSession;
  /** the page to open in a new Keeper tab */
  route?: { name: string; arg?: string; q?: string };
  /** sign-in needed and nothing stored */
  needPassword?: boolean;
  /** first connection to this SSH server: compare and trust its key */
  hostKey?: { host: string; port: number; type: string; fingerprint: string; changed?: boolean };
  /** a page that does not trust its certificate */
  cert?: { fingerprint: string; issuer?: string };
  message?: string;
}

export interface ProbeResult {
  port: number;
  open: boolean;
  ms?: number;
}
