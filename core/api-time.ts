// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Time tracking as the window sees it (core/time-track.ts has the logic).

import type { DaySummary, TimeRule, TimeSpan, TimeTrackOptions, summarizeWeek } from './time-track';

export interface TimeStatus {
  /** recording now (on, not paused, someone at the computer) */
  recording: boolean;
  paused: boolean;
  /** a pause with an end; undefined pauses until Resume */
  pausedUntil?: number;
  /** away from the computer or the screen locked */
  away: boolean;
  /** this computer tells Keeper which app is in front (not on Wayland) */
  supported: boolean;
  /** what is in front now, as it is being recorded */
  now?: { app: string; title?: string; site?: string; since: number };
  options: TimeTrackOptions;
  rules: TimeRule[];
  /** the data on disk is encrypted with a key in the system keychain */
  encrypted: boolean;
  /** a problem reading the data, in plain words */
  note?: string;
  /** days with something recorded, newest first */
  days: string[];
}

export interface TimeTrackApi {
  status(): Promise<TimeStatus>;
  /** one day ("YYYY-MM-DD"): its spans and totals */
  day(day: string): Promise<{ spans: TimeSpan[]; summary: DaySummary }>;
  /** the week starting on this Monday ("YYYY-MM-DD") */
  week(monday: string): Promise<ReturnType<typeof summarizeWeek>>;
  /** pause (for some minutes, or until Resume) or resume */
  setPaused(paused: boolean, minutes?: number): Promise<TimeStatus>;
  saveRules(rules: TimeRule[]): Promise<TimeStatus>;
  /** asks where to save, then writes the days from..to as CSV */
  exportCsv(from: string, to: string): Promise<{ saved: boolean; path?: string; rows?: number }>;
  /** deletes one day */
  removeDay(day: string): Promise<TimeStatus>;
  /** deletes everything recorded and its key */
  wipe(): Promise<TimeStatus>;
  /** test hook (only with KEEPER_TIME_TEST, never in official builds): pretend this is in front now */
  testFront?(sample: { app: string; title?: string; site?: string } | null): Promise<void>;
}
