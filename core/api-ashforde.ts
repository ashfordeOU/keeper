// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Ashforde apps: install, update and work with Keeper's sister
// apps (core/ashforde). Monorail is the first, on macOS.

import type { MonorailState, ShortcutClash } from './ashforde/monorail';

export interface AshfordePrefs {
  /** show the workspace and slide in the Island */
  showInIsland: boolean;
  /** Keeper's Focus sessions switch Monorail's focus mode on and off */
  followFocus: boolean;
  /** Keeper's presentation mode switches Monorail's */
  followPresentation: boolean;
  /** Monorail takes the theme closest to Keeper's */
  matchTheme: boolean;
  /** Keeper's small windows float over the strip (rules added to Monorail's settings) */
  floatKeeperWindows: boolean;
  /** AI tools connected to Keeper may use Monorail ('ask' prompts each time) */
  aiTools: 'off' | 'ask' | 'allow';
  /** check for Monorail updates once a day */
  checkUpdates: boolean;
}

export const DEFAULT_ASHFORDE_PREFS: AshfordePrefs = {
  showInIsland: true,
  followFocus: true,
  followPresentation: true,
  matchTheme: false,
  floatKeeperWindows: true,
  aiTools: 'ask',
  checkUpdates: true,
};

export interface MonorailStatus {
  /** this computer can run it (macOS 13 or later) */
  supported: boolean;
  /** why not, in plain words */
  unsupportedReason?: string;
  installed: boolean;
  path?: string;
  version?: string;
  running: boolean;
  /** Keeper turned on Monorail's local API and state.json */
  connected: boolean;
  /** the local API answers */
  apiReady: boolean;
  /** Monorail has Accessibility access (unknown until it runs) */
  accessibility?: boolean;
  state?: MonorailState;
  /** a newer release, when one was found */
  update?: { version: string; notes?: string; url?: string };
  lastCheck?: number;
  /** the signature of the installed copy, as checked */
  signature?: { ok: boolean; reason: string };
  /** each with a free key Keeper can switch to (suggestion) */
  clashes: (ShortcutClash & { suggestion?: string; suggestionLabel?: string })[];
  /** who offers Monorail's updates: Monorail's own updater (unless it is off), or Keeper */
  updatesBy?: 'monorail' | 'keeper';
  /** the slider bar is at the top, so the Island makes room */
  sliderAtTop: boolean;
  /** what is going on right now (installing, updating…) */
  busy?: { step: string; progress?: number };
  error?: string;
}

export interface AshfordeOverview {
  platform: string;
  apps: { id: string; name: string; tagline: string; description: string; homepage: string; offered: boolean; elsewhere: string; together: string[]; enabled: boolean }[];
}

export interface AshfordeApi {
  overview(): Promise<AshfordeOverview>;
  monorail(): Promise<MonorailStatus>;
  /** downloads the latest release, checks its checksum and signature, and installs it */
  install(): Promise<MonorailStatus>;
  update(): Promise<MonorailStatus>;
  checkUpdate(): Promise<MonorailStatus>;
  /** quits it and moves it to the Trash; its settings stay unless `settings` is true */
  uninstall(settings?: boolean): Promise<MonorailStatus>;
  launch(): Promise<MonorailStatus>;
  quit(): Promise<MonorailStatus>;
  /** turns on Monorail's local API and state.json so Keeper can follow and drive it */
  connect(): Promise<MonorailStatus>;
  /** opens the right page of System Settings for a permission */
  openPermission(topic: 'accessibility'): Promise<{ ok: boolean; label?: string; message?: string }>;
  /** a monorail:// action: settings, palette, focus-mode, workspace… */
  action(kind: string, arg?: string | number | boolean): Promise<{ ok: boolean; message?: string }>;
  prefs(): Promise<AshfordePrefs>;
  setPrefs(patch: Partial<AshfordePrefs>): Promise<AshfordePrefs>;
  /** switches Keeper's shortcut (a dotted setting, e.g. "island.captureShortcut") to a free key */
  useShortcut(setting: string, accelerator: string): Promise<MonorailStatus>;
  /** how Keeper and Monorail are sharing things right now (docs/KEEPER-MONORAIL.md) */
  coexist(): Promise<CoexistStatus>;
}

/** Keeper and Monorail on one Mac, as Keeper sees it now. */
export interface CoexistStatus {
  /** Monorail is running and its local API answers */
  active: boolean;
  /** Monorail answered Keeper's hello (newer versions), with its version */
  peer?: { app: string; version?: string };
  focus: { owner: 'keeper' | 'monorail' | null; keeper: boolean; monorail: boolean };
  presentation: { owner: 'keeper' | 'monorail' | null; keeper: boolean; monorail: boolean };
  /** what the last Stage did to Monorail's layout, and what Keeper put back */
  lastStage?: { at: number; intact: boolean; moved: number; missing: number; reordered: number; note: string };
  /** a put-it-back loop Keeper stopped (count since start) */
  loopsStopped: number;
  /** a note about the desktop picture both apps want */
  desktop?: string;
  updatesBy?: 'monorail' | 'keeper';
}
