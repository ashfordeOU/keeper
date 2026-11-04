// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The system monitor as the interface sees it: live readings, long-term
// history, dev servers and agents, sensors, process extras, menu-bar
// readings and the tool launcher.

import type { AgentKind } from './agents-detect';
import type { DevProject } from './monitor-devservers';
import type { Peak, Point, TierId } from './monitor-history';
import type { CodeSignature, EnvVar } from './monitor-procinfo';
import type { Sensors } from './monitor-sensors';
import type { ContainerAction, ContainerRow, DiskUse, Engine } from './monitor-containers';
import type { MixerState } from './monitor-mixer';
import type { EnergyRow } from './monitor-energy';
import type { LiveReading, MonitorSettings } from './monitor-tray';

export interface HistoryView {
  tier: TierId;
  /** ms between points */
  step: number;
  points: Point[];
  peaks: Peak[];
  top: { name: string; cpuMinutes: number; avgCpu: number; peakMem: number; minutes: number }[];
  /** the oldest time with any history, or null when empty */
  oldest: number | null;
}

export interface RunningAgent {
  key: string;
  id: string;
  label: string;
  kind: AgentKind;
  pid: number;
  /** it and everything it started */
  pids: number[];
  cpu: number;
  memory: number;
  command?: string;
  cwd?: string;
  /** project name (git root of its folder) */
  project?: string;
  /** listening ports held by it or its children */
  ports: number[];
}

export interface ProcExtras {
  pid: number;
  /** nearest first */
  parents: { pid: number; name: string }[];
  env?: EnvVar[];
  envError?: string;
  signature?: CodeSignature;
  /** listening ports held by this process */
  ports: number[];
}

export interface SysmonResult { ok: boolean; message: string; stopped?: number }

export interface SysmonApi {
  /** the latest live reading and recent ones for sparklines (starts readings for this window until `watch(false)`) */
  watch(on: boolean): Promise<{ latest?: LiveReading; recent: LiveReading[] }>;
  live(): Promise<{ latest?: LiveReading; recent: LiveReading[] }>;
  history(from: number, to: number, maxPoints?: number): Promise<HistoryView>;
  /** saves the range as CSV where the person chooses; returns the file or null */
  exportCsv(from: number, to: number): Promise<string | null>;
  clearHistory(): Promise<void>;
  devServers(all?: boolean): Promise<{ projects: DevProject[] }>;
  /** stops one server (and what it started) or every server of a project */
  stopServer(pid: number): Promise<SysmonResult>;
  stopProject(root: string): Promise<SysmonResult>;
  restartServer(pid: number): Promise<SysmonResult>;
  agents(): Promise<RunningAgent[]>;
  /** quits an agent session and everything it started */
  stopAgentSession(pid: number): Promise<SysmonResult>;
  sensors(): Promise<Sensors>;
  /** parents, environment (hidden unless `reveal`), signature and ports */
  procExtras(pid: number, opts?: { reveal?: boolean; revealSecrets?: boolean; signature?: boolean }): Promise<ProcExtras | null>;
  settings(): Promise<MonitorSettings>;
  setSettings(patch: Partial<MonitorSettings>): Promise<MonitorSettings>;
  /** pictures of the menu-bar readings as data URLs, for Settings previews */
  trayPreview(): Promise<{ metric: string; image: string; title: string }[]>;
  /** the tool launcher: open it, open one tool (in its own window), recent tools */
  openLauncher(): Promise<void>;
  openTool(id: string): Promise<void>;
  recentTools(): Promise<string[]>;
  closeWindow(): Promise<void>;
  /** where results go under the standard output setting (undefined: next to the originals) */
  outputPreview(): Promise<string>;
  /** which menu-bar items exist and their tooltips, the launcher shortcut really registered, and open tool windows */
  trayState(): Promise<{ items: string[]; tooltips: string[]; launcherShortcut?: string; toolWindows?: string[] }>;
  /** Docker or Podman: containers with live use, and disk use */
  containers(): Promise<{ engine: Engine | null; containers: ContainerRow[]; disk: DiskUse[]; note?: string }>;
  containerAction(id: string, action: ContainerAction): Promise<{ ok: boolean; message: string }>;
  /** apps playing sound, with their own volume and mute, and the output device */
  mixer(): Promise<MixerState>;
  setStream(id: string, patch: { volume?: number; muted?: boolean }): Promise<boolean>;
  setOutput(name: string): Promise<boolean>;
  /** Linux: one app plays to its own output (a sink name from mixer().outputs) */
  setStreamOutput(id: string, sink: string): Promise<boolean>;
  /** Sound for each app: what Keeper keeps per app (by app name) */
  soundRules(): Promise<{ on: boolean; rules: import('./sound-rules').SoundRules }>;
  forgetSound(name: string): Promise<import('./sound-rules').SoundRules>;
  /** macOS: energy impact, what holds the computer awake and App Nap per app */
  energy(): Promise<{ supported: boolean; rows: EnergyRow[]; note?: string }>;
  setAppNap(bundleId: string, allowed: boolean): Promise<boolean>;
  /** tabs in browsers linked through Keeper's extension, with the memory and data each uses */
  tabs(): Promise<{ linked: boolean; tabs: { session: string; id: number; browser: string; title: string; url: string; memory?: number; bytes?: number; audible?: boolean; asleep?: boolean }[] }>;
  /** shows the menu-bar pop-over (as clicking a reading does) */
  showPopover(): Promise<void>;
}
