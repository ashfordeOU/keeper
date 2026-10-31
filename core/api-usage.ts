// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper's own use of the computer, for Settings → Keeper's own usage.

import type { ResourceMode, WorkKind } from './governor';

export interface KeeperUsage {
  /** percent of one processor core, all of Keeper's processes together */
  cpu: number;
  /** bytes of memory only Keeper uses */
  memory: number;
  processes: number;
  mode: ResourceMode;
  conditions: { onBattery: boolean; locked: boolean; idleSec: number; thermal: string; lowPower: boolean; memoryLow: boolean };
  /** background work, what it is doing and why it waits */
  tasks: { id: string; label: string; kind: WorkKind; state: 'working' | 'waiting' | 'idle'; detail?: string; pending?: number }[];
  /** regular checks and how often they look right now (null = paused) */
  checks: { name: string; everyMs: number | null; runs: number }[];
}

export interface UsageApi {
  get(): Promise<KeeperUsage>;
}
