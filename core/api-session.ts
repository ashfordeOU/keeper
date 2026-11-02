// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The interface's side of crash-proof tabs and Keeper's own processes.

import type { WindowState } from './session';

export interface SessionInitial {
  /** 'main', or the key of a window a tab was moved into */
  key: string;
  /** what to open with (null: start fresh) */
  state: WindowState | null;
  /** the last run ended without quitting (a crash or the system stopping it) */
  crashed: boolean;
  /** started in safe mode after repeated crashes */
  safeMode: boolean;
  /** this window's page stopped and was reloaded */
  reloaded?: boolean;
}

export interface SessionLog {
  log: { at: number; kind: string; detail: string }[];
  dumps: { name: string; at: number; size: number }[];
  crashedLastTime: boolean;
  safeMode: boolean;
}

export interface SessionApi {
  /** synchronous: read once when a window opens */
  initial(): SessionInitial;
  /** saves this window's tabs (written to disk within a second) */
  save(w: WindowState): void;
  /** opens a new window with these tabs (a tab moved out) */
  openWindow(w: WindowState): Promise<string>;
  /** when the last session was saved (0: none) */
  lastSession(): Promise<number>;
  log(): Promise<SessionLog>;
  /** a failure nobody caught in a window: written to the session log */
  rendererError(view: string, text: string, stack?: string): Promise<void>;
  openDumps(): Promise<void>;
  /** a plain-text report to copy */
  report(): Promise<string>;
  /** quits and starts again, in safe mode if asked */
  relaunch(safe: boolean): Promise<void>;
}

export interface KeeperProcess {
  /** stable id: 'main', 'renderer:<window>', 'svc:<name>', 'gpu'… */
  id: string;
  label: string;
  kind: 'main' | 'window' | 'gpu' | 'service' | 'helper' | 'utility' | 'other';
  pid?: number;
  state: 'running' | 'stopped' | 'starting' | 'crashed' | 'idle';
  /** percent of one core, averaged since the last look */
  cpu: number;
  /** working set in bytes */
  memory: number;
  startedAt?: number;
  restarts?: number;
  lastCrash?: { at: number; reason: string };
  /** a Keeper feature it belongs to (Disable switches the feature off) */
  feature?: string;
  canStop: boolean;
  canRestart: boolean;
  detail?: string;
}

export interface SvcApi {
  list(): Promise<KeeperProcess[]>;
  stop(id: string): Promise<KeeperProcess[]>;
  restart(id: string): Promise<KeeperProcess[]>;
  /** stops every piece of background work right now (indexing, reading text, sync, backups, regular checks) for an hour, or resumes it */
  stopAllWork(resume?: boolean): Promise<{ stopped: string[]; heldUntil: number }>;
  /** when stopped background work starts again by itself (0: not stopped) */
  held(): Promise<number>;
  /** Keeper's own ceilings and what it did to stay inside them */
  limits(): Promise<LimitsStatus>;
}

export interface LimitsStatus {
  limits: import('./limits').Limits;
  events: import('./limits').LimitEvent[];
  /** all of Keeper, percent of one core, at the last look */
  cpu: number;
  /** when Keeper went above the processor ceiling (0: below) */
  overSince: number;
  /** helper programs doing a job right now */
  helpers: number;
  /** the last notice shown in the Island about it */
  lastAlert?: { at: number; title: string; detail: string };
}
