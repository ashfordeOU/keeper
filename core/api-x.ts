// SPDX-License-Identifier: AGPL-3.0-or-later
// Contract for health history, the Weather page, Toolbox system helpers,
// folder tidying, AI file actions and app updates. Merged into KeeperApi.

import type { MonthlyClimate, RadarFrame, TripStop, WeatherAlert } from './forecast';
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
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'unsupported';
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: number;
}

export interface AiProviderInfo {
  provider: 'anthropic' | 'openai' | 'ollama';
  /** the model runs on this computer: nothing is sent anywhere */
  local: boolean;
  configured: boolean;
  label: string;
}

export interface TripForecast {
  stop: TripStop;
  place?: Place;
  day?: Weather['daily'][number];
  units: 'metric' | 'imperial';
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
    trips(units: 'metric' | 'imperial'): Promise<TripForecast[]>;
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
    loginItem(): Promise<boolean>;
    setLoginItem(on: boolean): Promise<boolean>;
  };
}
