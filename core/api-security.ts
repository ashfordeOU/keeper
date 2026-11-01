// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security, as the interface sees it.

import type { AppPrivacy } from './security/trackers';
import type { BrowserProfile, Finding, PermissionGrant, PersistenceItem, QuarantineItem, ScanKind, ScanProgress, SecurityEvent, SiteReport } from './security/types';

export interface EngineStatus {
  id: 'builtin' | 'yara' | 'clamav' | 'defender' | 'xprotect' | 'reputation';
  name: string;
  state: 'on' | 'off' | 'missing' | 'unavailable';
  detail?: string;
  /** ms since epoch of the signatures in use, when known */
  updated?: number;
}

export interface SecuritySettings {
  /** watch Downloads, Desktop, Documents and startup locations as files arrive */
  realtime: boolean;
  /** move certain detections into quarantine without asking */
  autoQuarantine: boolean;
  /** let Keeper keep ClamAV's signatures current with freshclam */
  clamavUpdates: boolean;
  /** look fingerprints up on MalwareBazaar (abuse.ch): only the SHA-256 is sent */
  hashLookups: boolean;
  /** watch processes for miners and programs running from temporary folders */
  behaviour: boolean;
  /** alert when something new is set to start automatically */
  persistenceAlerts: boolean;
  /** extra YARA rule files or URLs, and malware hash lists */
  ruleSources: string[];
  /** extra tracker lists (Disconnect services.json or plain domain lists) */
  trackerLists: string[];
  /** a list of malicious extension ids (JSON { id: reason }) */
  extensionLists: string[];
  /** scan automatically: off, daily or weekly (quick scan) */
  schedule: 'off' | 'daily' | 'weekly';
}

export interface SecurityOverview {
  score: number;
  label: string;
  findings: Finding[];
  top: Finding[];
  counts: Record<Finding['area'], number>;
  engines: EngineStatus[];
  quarantined: number;
  lastScan?: { kind: ScanKind; at: number; files: number; found: number };
  notes: string[];
  checkedAt: number;
}

export interface ConnectionsView {
  apps: AppPrivacy[];
  listeners: { app: string; port: number; address: string }[];
  sites: SiteReport[];
  /** the browser extension that reports per-site third parties is connected */
  extensionConnected: boolean;
}

export interface SecurityApi {
  overview(refresh?: boolean): Promise<SecurityOverview>;
  permissions(): Promise<{ grants: PermissionGrant[]; notes: string[]; platform: string }>;
  /** forget a permission (macOS tccutil reset) or open the system's settings for it */
  revoke(grant: PermissionGrant): Promise<{ ok: boolean; message: string }>;
  browsers(): Promise<BrowserProfile[]>;
  connections(): Promise<ConnectionsView>;
  /** install the native messaging host so Keeper's browser extension can report */
  installBrowserHost(): Promise<{ installed: string[]; extensionFolder: string }>;
  persistence(): Promise<PersistenceItem[]>;
  scan(kind: ScanKind, paths?: string[]): Promise<ScanProgress>;
  stopScan(id: string): Promise<void>;
  scans(): Promise<ScanProgress[]>;
  quarantine(): Promise<QuarantineItem[]>;
  quarantineFile(path: string): Promise<QuarantineItem>;
  restore(id: string, to?: string): Promise<{ path: string }>;
  deleteQuarantined(id: string): Promise<void>;
  events(limit?: number): Promise<SecurityEvent[]>;
  settings(): Promise<SecuritySettings>;
  setSettings(patch: Partial<SecuritySettings>): Promise<SecuritySettings>;
  ignore(findingId: string, ignored: boolean): Promise<void>;
  /** run a finding's fix (only fixes marked auto) */
  fix(findingId: string): Promise<{ ok: boolean; message: string }>;
  /** install ClamAV through the system's package manager */
  installClamav(): Promise<{ ok: boolean; message: string }>;
  updateSignatures(): Promise<{ ok: boolean; message: string }>;
  /** Pwned Passwords range check; the password never leaves this computer */
  checkPassword(password: string): Promise<{ count: number }>;
  exportReport(): Promise<string | null>;
}
