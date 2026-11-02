// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features → Keeper suite: the parts that run in processes of their own (docs/SUITE.md).

import type { PartRole, PartState } from './suite';

export interface SuitePart {
  id: PartRole;
  name: string;
  description: string;
  /** the feature switch that turns it on and off */
  feature: string;
  /** parts run in processes of their own at this start (false: inside the app, as one process) */
  separate: boolean;
  /** its feature switch */
  on: boolean;
  /** it should be running now (on, and something to show) */
  wanted: boolean;
  /** 'shared': running inside the app's process */
  state: PartState | 'shared';
  pid?: number;
  startedAt?: number;
  restarts: number;
  lastCrash?: { at: number; reason: string };
  /** all of the part's processes together: bytes, and percent of one core */
  memory: number;
  cpu: number;
  processes: number;
}

export interface SuiteApi {
  parts(): Promise<SuitePart[]>;
  /** Keeper's own processes together (its main process, windows, graphics; not its services) */
  app(): Promise<{ memory: number; cpu: number; processes: number; pid: number; startedAt: number }>;
  restart(id: PartRole): Promise<SuitePart[]>;
  /** whether parts run separately now, and at the next start */
  separate(): Promise<{ now: boolean; next: boolean; env: string | null }>;
}
