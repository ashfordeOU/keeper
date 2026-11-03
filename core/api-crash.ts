// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Crash reports as the window sees them (core/crash-report.ts has the format).

import type { CrashBody } from './crash-report';

export interface CrashReportsStatus {
  /** the switch, and nothing turning it off */
  on: boolean;
  /** turned off by an administrator's policy or an environment setting */
  locked: boolean;
  offText?: string;
  /** exactly what the next send would be (null when nothing waits) */
  next: CrashBody | null;
  /** problems waiting, counted with repeats */
  waiting: number;
  last?: { at: number; body: CrashBody };
  /** where reports go */
  host: string;
}

export interface CrashReportsApi {
  status(): Promise<CrashReportsStatus>;
  /** off deletes what was waiting */
  setOn(on: boolean): Promise<CrashReportsStatus>;
  /** deletes what was waiting */
  clear(): Promise<CrashReportsStatus>;
  /** sends what is waiting now instead of with the next batch */
  sendNow(): Promise<CrashReportsStatus>;
}
