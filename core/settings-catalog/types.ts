// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The settings catalogue: system settings people usually change by typing
// commands (defaults, registry, gsettings, sysctl…) or by digging through
// buried toggles, described as data. Every entry says how to read the current
// value, how to change it, how to put it back, whether it needs an
// administrator, what has to restart, how risky it is, and where it is
// documented. Keeper only ever runs the operations described here — never a
// command typed into the interface.

export type Os = 'darwin' | 'win32' | 'linux';

export type Category =
  | 'Finder & files' | 'Dock & desktop' | 'Screenshots' | 'Keyboard & mouse' | 'Menu bar & taskbar' | 'Windows & spaces'
  | 'Browser' | 'Power & sleep' | 'Search & indexing' | 'Privacy' | 'Security' | 'Network' | 'Developer'
  | 'Performance' | 'Updates' | 'Appearance' | 'Sound' | 'Time & language' | 'Services' | 'Storage';

export const CATEGORIES: Category[] = [
  'Finder & files', 'Dock & desktop', 'Screenshots', 'Keyboard & mouse', 'Menu bar & taskbar', 'Windows & spaces', 'Browser',
  'Power & sleep', 'Search & indexing', 'Privacy', 'Security', 'Network', 'Developer', 'Performance', 'Updates', 'Appearance',
  'Sound', 'Time & language', 'Services', 'Storage',
];

export type Risk = 'low' | 'medium' | 'high';

/** What must happen for a change to show. */
export type After = 'none' | 'relaunch-dock' | 'relaunch-finder' | 'relaunch-menubar' | 'relaunch-explorer' | 'relaunch-app' | 'logout' | 'restart';

export type ValueType = 'bool' | 'int' | 'float' | 'string';

/** The operations Keeper knows how to perform. Nothing else can run. */
export type Op =
  | { t: 'defaults'; domain: string; key: string; type: ValueType; currentHost?: boolean; system?: boolean }
  | { t: 'pmset'; key: string; scope?: 'a' | 'b' | 'c' }
  | { t: 'mdutil'; volume: string }
  | { t: 'spctl' }
  | { t: 'reg'; hive: 'HKCU' | 'HKLM'; path: string; name: string; type: 'REG_DWORD' | 'REG_SZ' }
  | { t: 'powercfg'; what: 'hibernate' | 'monitor-timeout-ac' | 'standby-timeout-ac' | 'monitor-timeout-dc' | 'standby-timeout-dc' }
  | { t: 'service'; name: string }
  | { t: 'winfeature'; name: string }
  | { t: 'gsettings'; schema: string; key: string; type: ValueType }
  | { t: 'sysctl'; key: string }
  | { t: 'systemd'; unit: string; user?: boolean }
  | { t: 'timedatectl'; what: 'ntp' | 'local-rtc' }
  /** shown and explained, never changed by Keeper (fstab, GRUB): the person follows the steps */
  | { t: 'advice'; read?: { file: string; args: string[] } };

export interface Choice {
  value: string;
  label: string;
}

export interface SettingDef {
  id: string;
  os: Os;
  /** e.g. "macOS 13+", "Windows 11", "GNOME 42+" */
  versions?: string;
  category: Category;
  title: string;
  /** plain English: what it does and why someone would change it */
  description: string;
  /** how the value is presented */
  kind: 'toggle' | 'choice' | 'number' | 'text';
  op: Op;
  /** for toggles: the raw values meaning on and off */
  on?: string;
  off?: string;
  choices?: Choice[];
  min?: number;
  max?: number;
  unit?: string;
  /** the system's own value; restoring writes it back (or removes the override when `removeToRestore`) */
  systemDefault: string;
  /** restoring removes Keeper's value instead of writing the default (defaults delete / reg delete) */
  removeToRestore?: boolean;
  admin: boolean;
  after: After;
  risk: Risk;
  /** extra plain-English warning for medium/high risk */
  warning?: string;
  /** steps for advice entries */
  steps?: string[];
  sources: string[];
  keywords?: string[];
}

/** A command Keeper runs: never through a shell, arguments passed as a list. */
export interface Cmd {
  file: string;
  args: string[];
  admin?: boolean;
}

export interface ReadResult {
  id: string;
  /** raw value as the system reports it; undefined when not set (the system default applies) */
  raw?: string;
  /** the value shown: raw, or the default when unset */
  value: string;
  isDefault: boolean;
  error?: string;
}

export interface ChangeRecord {
  id: string;
  settingId: string;
  title: string;
  os: Os;
  at: number;
  from?: string;
  to: string;
  /** the value was not set before: restoring removes it */
  wasUnset: boolean;
  backup?: string;
  undone?: boolean;
  by: 'person' | 'profile' | 'agent' | 'restore';
}

export interface SetupProfile {
  format: 'keeper-setup-profile';
  version: 1;
  name: string;
  created: number;
  os: Os;
  settings: { id: string; value: string }[];
}

export interface ProfilePreviewItem {
  id: string;
  title: string;
  from?: string;
  to: string;
  admin: boolean;
  after: After;
  risk: Risk;
  status: 'change' | 'same' | 'unknown-setting' | 'other-os' | 'invalid-value';
}
