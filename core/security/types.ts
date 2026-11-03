// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security: the shapes shared by the checks, the scanner and the page.

import type { Finding as GuideFinding } from '../guide/types';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type Area = 'permissions' | 'connections' | 'browsers' | 'posture' | 'malware' | 'persistence';

/** One plain-English thing worth knowing, with why it matters and what to do. */
export interface Finding {
  id: string;
  area: Area;
  severity: Severity;
  title: string;
  /** why it matters, in a sentence or two */
  why: string;
  detail?: string;
  /** what could happen if it is left as it is (for the guided fix) */
  impact?: string;
  /**
   * What fixes it. kind: auto (Keeper does it, action+arg), open (a settings pane: settings = deep link,
   * with steps), manual (steps only), keeper-page (a Keeper page, action names it).
   * Maps one to one onto the shared guided-fix layer (core/guide) when it is present.
   */
  fix?: { label: string; kind?: 'auto' | 'open' | 'manual' | 'keeper-page'; action?: string; arg?: string; settings?: string; steps?: string[] };
  /** a check Keeper can run again to confirm the fix worked (id of the probe that produced the finding) */
  verify?: string;
  /** a finding the person chose to ignore stays listed but no longer counts */
  ignored?: boolean;
  at?: number;
  /** the exact thing it is about (for details, Trust and the Fix-it List's actions) */
  subject?: GuideFinding['subject'];
  /** shown together with similar findings when there are several */
  group?: GuideFinding['group'];
  confidence?: GuideFinding['confidence'];
  learnMore?: string;
}

// ---------------------------------------------------------------- who can watch what

export type PrivacyService =
  | 'camera' | 'microphone' | 'screen' | 'location' | 'contacts' | 'calendars' | 'reminders' | 'photos'
  | 'files' | 'accessibility' | 'input' | 'automation' | 'bluetooth' | 'notifications' | 'other';

export interface PermissionGrant {
  /** app name, bundle id, package family or flatpak id */
  app: string;
  path?: string;
  service: PrivacyService;
  /** the system's own name for it (kTCCServiceCamera, webcam, devices…) */
  raw: string;
  allowed: boolean;
  /** ms since epoch, when the system records it */
  lastUsed?: number;
  /** still in use right now (Windows records an open start without a stop) */
  inUse?: boolean;
  source: 'tcc' | 'consent-store' | 'flatpak' | 'portal' | 'pipewire' | 'helper';
}

// ---------------------------------------------------------------- browsers

export interface BrowserExtension {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
  permissions: string[];
  hostPermissions: string[];
  /** 0–100, higher is riskier */
  risk: number;
  reasons: string[];
  knownBad?: string;
  fromStore?: boolean;
}

export interface BrowserProfile {
  browser: string;
  engine: 'chromium' | 'firefox' | 'webkit';
  profile: string;
  path: string;
  extensions: BrowserExtension[];
  /** the profile keeps saved passwords (Keeper never reads them) */
  savedPasswords: boolean;
  signedInSync?: boolean;
  /** DNS over HTTPS: off, automatic or secure (strict) */
  doh?: 'off' | 'automatic' | 'secure';
  version?: string;
}

export interface SiteReport {
  /** the site the person visited */
  site: string;
  /** third-party hosts it loaded, with how many requests and whether they are trackers */
  thirdParties: { host: string; requests: number; tracker?: string }[];
  cookies?: number;
  at: number;
  browser?: string;
}

// ---------------------------------------------------------------- malware

export type Engine = 'clamav' | 'yara' | 'hash' | 'heuristic' | 'signature' | 'defender' | 'reputation';

export interface Detection {
  path: string;
  engine: Engine;
  /** e.g. Eicar-Test-Signature, Keeper.Heuristic.DoubleExtension */
  name: string;
  severity: Severity;
  /** how sure: a signature match is certain; a heuristic is a hint */
  confidence: 'certain' | 'likely' | 'possible';
  sha256?: string;
  size?: number;
  /** inside an archive: the path inside it */
  inner?: string;
  why: string;
}

export interface QuarantineItem {
  id: string;
  originalPath: string;
  name: string;
  size: number;
  sha256: string;
  detections: Pick<Detection, 'engine' | 'name' | 'severity' | 'confidence'>[];
  at: number;
  /** file mode, restored with the file */
  mode?: number;
}

export type ScanKind = 'quick' | 'full' | 'custom' | 'realtime';

export interface ScanProgress {
  id: string;
  kind: ScanKind;
  state: 'running' | 'done' | 'stopped' | 'failed';
  started: number;
  ended?: number;
  files: number;
  bytes: number;
  current?: string;
  detections: Detection[];
  engines: Engine[];
  message?: string;
}

// ---------------------------------------------------------------- persistence

export interface PersistenceItem {
  /** stable: kind + location */
  id: string;
  kind: 'launch-agent' | 'launch-daemon' | 'login-item' | 'cron' | 'systemd-user' | 'systemd-system' | 'autostart' | 'run-key' | 'scheduled-task' | 'startup-folder' | 'browser-extension';
  name: string;
  /** what it runs */
  command?: string;
  location: string;
  signer?: string;
  signed?: boolean;
  /** the signing team (macOS) */
  team?: string;
  /** the program's code hash (codesign CDHash) or SHA-256: changes with a new program */
  codeHash?: string;
  /** SHA-256 of the registering file: changes when what it runs changes */
  contentHash?: string;
  /** the program's size and modification time, to notice a new program cheaply */
  programStamp?: string;
  firstSeen: number;
  /** already there when Keeper first looked: not new */
  baseline?: boolean;
}

// ---------------------------------------------------------------- timeline

export interface SecurityEvent {
  id: string;
  at: number;
  kind: 'detection' | 'quarantine' | 'restore' | 'persistence' | 'permission' | 'camera' | 'microphone' | 'extension' | 'scan' | 'posture' | 'connection';
  severity: Severity;
  title: string;
  detail?: string;
  path?: string;
}
