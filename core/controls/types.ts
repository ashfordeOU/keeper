// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Controls: system network, firewall, privacy and security settings that
// Keeper can switch directly where the system allows, and walks the person to
// otherwise. Pure types, shared by the app, the tests and the docs table.

export type Os = 'darwin' | 'win32' | 'linux';

export type ControlGroup = 'network' | 'firewall' | 'privacy' | 'security';

/**
 * How a control can be changed on a system:
 *  direct  Keeper switches it, no password
 *  admin   Keeper switches it after the system's administrator prompt
 *  guide   apps are not allowed to change it; Keeper opens the right Settings page and guides
 *  none    the system has no such setting
 */
export type How = 'direct' | 'admin' | 'guide' | 'none';

export type ControlValue = boolean | string;

export interface ControlDef {
  id: string;
  group: ControlGroup;
  label: string;
  /** one plain sentence */
  desc: string;
  /** a switch, or one of a few choices */
  kind: 'bool' | 'choice';
  choices?: { value: string; label: string }[];
  /** per system: how, plus a short honest note */
  support: Record<Os, { how: How; note?: string }>;
  /** the guide/Settings topic to open when Keeper cannot change it */
  topic?: string;
  /** the value that is the less protective one (turning to it asks first) */
  weaker?: ControlValue;
  /** why the weaker value matters, shown before switching to it */
  risk?: string;
  /** Keeper's own setting (no system change) */
  keeper?: boolean;
}

export interface ControlState {
  id: string;
  /** null = could not tell */
  value: ControlValue | null;
  how: How;
  /** the reason when it cannot be read or changed here */
  note?: string;
}

/** One thing to run to change or read a setting. */
export type Step =
  | { kind: 'cmd'; cmd: string; args: string[] }
  | { kind: 'ps'; script: string }
  /** shell command run once as administrator (macOS osascript / Linux pkexec), batched with others */
  | { kind: 'admin-sh'; script: string }
  /** PowerShell run once elevated (UAC), batched with others */
  | { kind: 'admin-ps'; script: string }
  /** one of Keeper's own settings */
  | { kind: 'keeper'; id: string; value: ControlValue };

export interface Change {
  id: string;
  from: ControlValue | null;
  to: ControlValue;
}

/** What the system looks like, gathered once per read (device names and so on). */
export interface Ctx {
  os: Os;
  /** macOS: the Wi-Fi device (en0) and the primary network service name ("Wi-Fi") */
  macWifiDevice?: string;
  macService?: string;
  /** Linux: the active connection name and its interface */
  nmConnection?: string;
  iface?: string;
  /** Linux firewall front end found */
  linuxFirewall?: 'ufw' | 'firewalld' | 'none';
  /** Windows: the main adapter's alias */
  winAdapter?: string;
  /** desktop on Linux */
  gnome?: boolean;
  tools?: Record<string, boolean>;
}

export interface Preset {
  id: string;
  name: string;
  desc: string;
  values: Record<string, ControlValue>;
}

export interface LogEntry {
  id: string;
  at: number;
  title: string;
  changes: Change[];
  undone?: boolean;
}
