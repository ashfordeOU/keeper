// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keep Awake: start, stop and extend sessions, edit triggers, see who keeps the
// computer awake, statistics. The rules live in core/awake-engine.ts.

import type { AwakeRule, AwakeSettings, AwakeStats, Blocker, SessionOptions, SessionRecord, SessionSource, SessionSpec, WhileCondition } from './awake-engine';

export interface AwakeStatus {
  on: boolean;
  /** the running session */
  session?: {
    id: string;
    startedAt: number;
    endsAt?: number;
    reason: string;
    source: SessionSource;
    while: WhileCondition[];
    options: SessionOptions;
    triggerId?: string;
  };
  /** the triggers that match right now (names), highest priority first */
  matching: string[];
  /** which hold is in place: "powerSaveBlocker", "caffeinate", "systemd-inhibit", "SetThreadExecutionState" */
  holds: string[];
  /** closed-lid mode is active right now */
  closedDisplay: boolean;
  /** macOS: the one-time closed-lid setup (the sudoers rule) is in place; false elsewhere */
  closedLidReady?: boolean;
  /** a step the person still has to take (closed-lid setup, a missing tool) */
  notice?: string;
  /** the screen is allowed to sleep at the moment (display mode or screen-saver timeout) */
  displayAllowed: boolean;
  /** the regular check runs (false = no timer at all) */
  checking: boolean;
  platform: string;
  /** what this computer supports */
  supports: { closedDisplay: boolean; focus: 'shortcuts' | 'gnome' | 'none'; cursor: boolean; lock: boolean; thermal: boolean };
}

export interface TriggerTest {
  matches: boolean;
  conditions: { label: string; holds: boolean }[];
}

export interface AwakeApi {
  status(): Promise<AwakeStatus>;
  start(spec?: SessionSpec): Promise<AwakeStatus>;
  stop(): Promise<AwakeStatus>;
  toggle(spec?: SessionSpec): Promise<AwakeStatus>;
  extend(minutes: number): Promise<AwakeStatus>;
  /** "30m", "2h", "until 18:30" */
  parse(text: string): Promise<{ minutes?: number; until?: number } | null>;
  settings(): Promise<AwakeSettings>;
  setSettings(patch: Partial<AwakeSettings>): Promise<AwakeSettings>;
  saveTrigger(rule: AwakeRule): Promise<AwakeSettings>;
  removeTrigger(id: string): Promise<AwakeSettings>;
  reorderTriggers(ids: string[]): Promise<AwakeSettings>;
  testTrigger(rule: AwakeRule): Promise<TriggerTest>;
  /** what keeps this computer awake right now (all apps, not only Keeper) */
  blockers(): Promise<{ list: Blocker[]; source: string; error?: string }>;
  stats(): Promise<AwakeStats & { recent: SessionRecord[] }>;
  resetStats(): Promise<void>;
  /** a running app list for the "while an app runs" picker */
  apps(): Promise<string[]>;
  /** closed-lid mode: the one-time step (administrator password on macOS) */
  setupClosedDisplay(): Promise<{ ok: boolean; message?: string }>;
}
