// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Contract for health history, the Weather page, Toolbox system helpers,
// folder tidying, AI file actions and app updates. Merged into KeeperApi.

import type { MonthlyClimate, RadarFrame, WeatherAlert } from './forecast';
import type { AlertRule, HealthSample, ProcessAlert, SpeedResult } from './monitor';
import type { TidyMode, TidyMove } from './tidy';
import type { CleanResult } from './types';
import type { Place, Weather } from './weather';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
}

export interface Thermal {
  label: string;
  celsius: number;
}

export interface DiskHealth {
  device: string;
  healthy: boolean;
  detail: string;
}

export interface Consumer {
  name: string;
  avgCpu: number;
  share: number;
  batteryShare: number;
  peakMemory: number;
  minutes: number;
}

export interface NetworkInfo {
  hostname: string;
  interfaces: { name: string; address: string; family: 'IPv4' | 'IPv6'; mac: string; internal: boolean }[];
}

export interface Tweak {
  id: string;
  label: string;
  description: string;
  kind: 'toggle' | 'number' | 'action';
  value?: boolean | number;
  /** what changing it will do, shown before asking */
  confirm?: string;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'none' | 'error' | 'unsupported';
  /** the version running now */
  current?: string;
  /** the newer version found */
  version?: string;
  /** release notes (Markdown) */
  notes?: string;
  /** the release page */
  url?: string;
  publishedAt?: string;
  /** download size in bytes */
  size?: number;
  percent?: number;
  message?: string;
  checkedAt?: number;
  /** how this copy updates: in place, through the system package manager, or by downloading the installer */
  method?: 'in-place' | 'package' | 'manual' | 'manager';
  /** set when a package manager owns this copy: who, and the command that updates it */
  manager?: { label: string; command?: string };
  /** Keeper can install it for you (otherwise it opens the download) */
  canInstall?: boolean;
  /** when the downloaded update goes in */
  plan?: import('./update-schedule').UpdatePlan | null;
  /** seconds until it goes in, while the countdown shows */
  countdown?: number;
  /** what is holding it back (a recording, a folder being locked…) */
  waitingFor?: string;
}

export interface AiProviderInfo {
  provider: 'anthropic' | 'openai' | 'ollama';
  /** the model runs on this computer: nothing is sent anywhere */
  local: boolean;
  configured: boolean;
  label: string;
}

export interface KeeperApiX {
  monitor: {
    history(): Promise<HealthSample[]>;
    topToday(): Promise<Consumer[]>;
    alerts(): Promise<{ rules: AlertRule[]; active: ProcessAlert[] }>;
    setAlertRules(rules: AlertRule[]): Promise<AlertRule[]>;
    docker(): Promise<{ available: boolean; containers: DockerContainer[] }>;
    dockerAction(id: string, action: 'stop' | 'start' | 'restart'): Promise<boolean>;
    /** stops a process and everything it started; returns how many were stopped */
    killTree(pid: number): Promise<number>;
    /** stops a coding-agent session running in this folder */
    stopAgent(cwd: string): Promise<number>;
    thermals(): Promise<Thermal[] | null>;
    disks(): Promise<DiskHealth[] | null>;
    speedTest(): Promise<SpeedResult>;
    speedHistory(): Promise<SpeedResult[]>;
  };
  forecast: {
    places(): Promise<Place[]>;
    savePlaces(places: Place[]): Promise<Place[]>;
    get(place: Place, units: 'metric' | 'imperial'): Promise<Weather>;
    alerts(place: Place): Promise<{ supported: boolean; alerts: WeatherAlert[] }>;
    radar(): Promise<{ host: string; frames: RadarFrame[] } | null>;
    climate(place: Place): Promise<MonthlyClimate[]>;
  };
  tools: {
    networkInfo(): Promise<NetworkInfo>;
    /** asks a public service for this computer's internet address (only when the user presses the button) */
    publicIp(): Promise<string>;
    tweaks(): Promise<Tweak[]>;
    setTweak(id: string, value?: boolean | number): Promise<Tweak[]>;
    clearQuarantine(appPath: string): Promise<boolean>;
    resetPermissions(bundleId: string): Promise<boolean>;
    pickApp(): Promise<string | null>;
    pickFiles(filters?: { name: string; extensions: string[] }[]): Promise<string[]>;
    /** saves text or a data: URL to a file the user chooses */
    saveAs(defaultName: string, content: string): Promise<string | null>;
  };
  folders: {
    tidy(dir: string, mode: TidyMode, apply: boolean): Promise<{ moves: TidyMove[]; summary: { group: string; count: number }[]; result?: CleanResult }>;
  };
  aiActions: {
    provider(): Promise<AiProviderInfo>;
    suggestName(path: string): Promise<string>;
    summarize(path: string): Promise<string>;
    receipts(paths: string[]): Promise<{ csvPath: string; rows: Record<string, string | number | null>[] }>;
    altText(path: string): Promise<string>;
    translateSubtitles(path: string, language: string): Promise<string>;
  };
  appInfo: {
    updateStatus(): Promise<UpdateStatus>;
    checkForUpdates(): Promise<UpdateStatus>;
    installUpdate(): Promise<void>;
    downloadUpdate(): Promise<UpdateStatus>;
    /** release notes of the version now running, once after an update (null otherwise) */
    whatsNew(): Promise<{ version: string; notes: string; url: string } | null>;
    releasesPage(): Promise<void>;
    /** a few short lines per version (this one and newer), for hover cards */
    versionNotes(): Promise<import('./updates').VersionNote[]>;
    /** when a downloaded update goes in: now, when Keeper quits, in an hour, tonight, tomorrow morning or a time */
    scheduleUpdate(when: import('./update-schedule').UpdateWhen): Promise<UpdateStatus>;
    loginItem(): Promise<boolean>;
    setLoginItem(on: boolean): Promise<boolean>;
    /** the small Software Update window; `check` (default true) looks for a new version straight away */
    openUpdateWindow(check?: boolean): Promise<void>;
    /** download the update and relaunch into it ("Install and Relaunch") */
    installAndRelaunch(): Promise<UpdateStatus>;
    /** "Skip this version": automatic checks stay quiet about it; closes the update window */
    skipVersion(version: string): Promise<void>;
    /** Settings → Updates in the main window; closes the update window */
    openUpdateSettings(): Promise<void>;
    /** the small About Keeper window */
    openAbout(): Promise<void>;
    /** what About Keeper shows */
    about(): Promise<{ version: string; channel: 'Beta' | 'Stable'; electron: string; chrome: string; node: string; platform: string; arch: string }>;
  };
}
