// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own use of the computer, for Settings → Performance.

import type { ResourceMode, WorkKind } from './governor';

export interface KeeperUsage {
  /** percent of one processor core, all of Keeper's processes together */
  cpu: number;
  /** bytes of memory only Keeper uses */
  memory: number;
  processes: number;
  mode: ResourceMode;
  /** drawing with the graphics card at this start (Minimal mode turns it off from the next start) */
  hardwareGraphics?: boolean;
  conditions: { onBattery: boolean; locked: boolean; idleSec: number; thermal: string; lowPower: boolean; memoryLow: boolean };
  /** background work, what it is doing and why it waits */
  tasks: { id: string; label: string; kind: WorkKind; state: 'working' | 'waiting' | 'idle'; detail?: string; pending?: number }[];
  /** regular checks and how often they look right now (null = paused) */
  checks: { name: string; everyMs: number | null; runs: number; /** the features that own it */ features?: string[] }[];
  /** only with KEEPER_POLL_LOG=1: what each check has cost since start */
  pollLog?: PollLog;
}

export interface PollStat {
  name: string;
  runs: number;
  /** total wall time and main-process processor time of its runs, ms */
  wallMs: number;
  cpuMs: number;
  /** programs it started, and how many of each */
  spawns: number;
  programs: Record<string, number>;
}

export interface PollLog {
  since: number;
  /** costliest first */
  polls: PollStat[];
  /** programs started outside any regular check (timers of their own, clicks) */
  outside: { program: string; count: number }[];
}

export interface UsageApi {
  get(): Promise<KeeperUsage>;
}
