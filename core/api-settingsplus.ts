// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The interface's view of the settings catalogue, per-app controls and
// browser tab controls.

import type { AppRef, ControlId, Priority, Support } from './appctl';
import type { BrowserSession, BrowserTab, ContentType, ContentValue } from './browser-tabs';
import type { DetectedBrowser, SetupBrowserId } from './browser-setup';
import type { After, ChangeRecord, Category, Os, ProfilePreviewItem, ReadResult, Risk } from './settings-catalog/types';

/** A catalogue entry as the interface shows it (commands are previewed separately). */
export interface CatalogEntry {
  id: string;
  os: Os;
  versions?: string;
  category: Category;
  title: string;
  description: string;
  kind: 'toggle' | 'choice' | 'number' | 'text';
  on?: string;
  off?: string;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
  unit?: string;
  systemDefault: string;
  admin: boolean;
  after: After;
  afterText: string;
  risk: Risk;
  warning?: string;
  steps?: string[];
  sources: string[];
  advice: boolean;
  /** the technical name (defaults domain key, registry path, sysctl…) */
  technical: string;
}

export interface ChangePreview {
  id: string;
  title: string;
  from?: string;
  to: string;
  /** the exact commands, one per line */
  commands: string[];
  backup?: string;
  admin: boolean;
  afterText: string;
  risk: Risk;
  warning?: string;
  error?: string;
}

export interface BackupInfo {
  id: string;
  at: number;
  settingId: string;
  title: string;
  kind: 'defaults' | 'reg' | 'gsettings';
  target: string;
  file: string;
}

export interface CatalogApi {
  /** this computer's entries (or all with `all`) */
  list(all?: boolean): Promise<{ os: Os; entries: CatalogEntry[]; counts: Record<Os, number> }>;
  search(query: string): Promise<CatalogEntry[]>;
  /** current values; reads that share a command run it once */
  read(ids: string[]): Promise<ReadResult[]>;
  preview(id: string, value: string): Promise<ChangePreview>;
  apply(id: string, value: string): Promise<{ ok: boolean; message: string; record?: ChangeRecord }>;
  /** puts the system's own value back (removes Keeper's override where possible) */
  reset(id: string): Promise<{ ok: boolean; message: string; record?: ChangeRecord }>;
  log(): Promise<ChangeRecord[]>;
  undo(changeId: string): Promise<{ ok: boolean; message: string }>;
  backups(): Promise<BackupInfo[]>;
  restoreBackup(id: string): Promise<{ ok: boolean; message: string }>;
  favourites(): Promise<string[]>;
  setFavourite(id: string, on: boolean): Promise<string[]>;
  exportProfile(name: string, ids?: string[]): Promise<string>;
  previewProfile(text: string): Promise<{ name: string; items: ProfilePreviewItem[] }>;
  applyProfile(text: string, ids: string[]): Promise<{ id: string; ok: boolean; message: string }[]>;
}

export interface AppControlInfo {
  id: ControlId;
  title: string;
  description: string;
  support: Support;
  note?: string;
  admin: boolean;
}

/** What Keeper has set for one app (remembered, and put back when the app or Keeper starts again). */
export interface AppControlState {
  key: string;
  app: AppRef;
  network?: 'allow' | 'deny';
  bandwidthKbps?: number;
  bandwidthPorts?: number[];
  vpn?: 'vpn' | 'bypass';
  dnsException?: boolean;
  priority?: Priority;
  cpuPercent?: number;
  memMB?: number;
  autoSuspendMin?: number;
  paused?: boolean;
  startAtLogin?: boolean;
  notifications?: boolean;
  alwaysLight?: boolean;
  language?: string;
  volume?: number;
  gpu?: 0 | 1 | 2;
  defaultFor?: string[];
  keepAwake?: boolean;
}

export interface AppCtlApi {
  controls(): Promise<AppControlInfo[]>;
  list(): Promise<AppControlState[]>;
  get(app: AppRef): Promise<AppControlState>;
  /** the exact commands a change would run */
  preview(app: AppRef, patch: Partial<AppControlState>): Promise<{ commands: string[]; notes: string[]; error?: string }>;
  set(app: AppRef, patch: Partial<AppControlState>): Promise<{ ok: boolean; message: string; state: AppControlState }>;
  /** removes everything Keeper set for the app */
  clear(app: AppRef): Promise<{ ok: boolean; message: string }>;
  /** running apps to pick from (name, path, pid, bundle id) */
  running(): Promise<AppRef[]>;
}

export interface BrowserTabsApi {
  sessions(): Promise<{ sessions: BrowserSession[]; limits: { browser: string; text: string }[]; hostInstalled: boolean }>;
  /** mute, sleep, close, focus, reload */
  tab(session: string, tabId: number, action: 'mute' | 'unmute' | 'discard' | 'close' | 'focus' | 'reload'): Promise<{ ok: boolean; message?: string }>;
  info(session: string, tabId: number): Promise<BrowserTab | null>;
  siteSettings(session: string, url: string): Promise<Partial<Record<ContentType, string>>>;
  setSite(session: string, site: string, type: ContentType, value: ContentValue): Promise<{ ok: boolean; message?: string }>;
  clearSite(session: string, origin: string): Promise<{ ok: boolean; message?: string }>;
  blockThirdPartyCookies(session: string, block: boolean): Promise<{ ok: boolean; message?: string }>;
  /** sends Keeper's blocklists to every linked browser as blocking rules */
  syncBlocking(): Promise<{ ok: boolean; message: string }>;
  siteBlocking(session: string, site: string, on: boolean): Promise<{ ok: boolean; message?: string }>;
  /** send these sites through a proxy (or null to stop) */
  siteProxy(session: string, sites: string[], proxy: { type: 'PROXY' | 'SOCKS5' | 'HTTPS'; host: string; port: number } | null): Promise<{ ok: boolean; message?: string }>;
  /** registers the native messaging host for installed browsers (Keeper also does this by itself) */
  installHost(): Promise<{ ok: boolean; message: string }>;
  /** the browsers on this computer: registered with Keeper, extension connected */
  setup(): Promise<BrowserSetupStatus>;
  /** "Add to Chrome": opens the store page, or the extensions page with the folder shown and its path copied */
  addExtension(id: SetupBrowserId): Promise<AddExtensionResult>;
  /** shows the extension's folder again and copies its path */
  revealExtension(id: SetupBrowserId): Promise<{ ok: boolean; folder: string }>;
}

export interface BrowserSetupStatus {
  browsers: DetectedBrowser[];
  /** any browser's extension is talking to Keeper */
  connected: boolean;
}

export interface AddExtensionResult {
  ok: boolean;
  /** store: the store page opened; unpacked: the extensions page and the folder */
  mode: 'store' | 'unpacked' | 'unsupported';
  /** the browser opened the page */
  opened: boolean;
  page?: string;
  /** the folder (Chromium) or manifest.json (Firefox) to choose */
  folder?: string;
  message?: string;
}
