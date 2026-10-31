// SPDX-License-Identifier: AGPL-3.0-or-later
// The process manager as the interface sees it.

import type { PriorityLevel, ProcSample, ServiceRow } from './procs';

export interface ProcActionResult {
  ok: boolean;
  /** how many processes were acted on */
  done: number;
  failed: { pid: number; name?: string; reason: string; needsAdmin?: boolean }[];
  message?: string;
}

export interface ProcDetails {
  pid: number;
  name: string;
  path?: string;
  command?: string;
  cwd?: string;
  user?: string;
  started?: number;
  /** count of environment variables (values are never sent) */
  envCount?: number;
  memory: { label: string; bytes: number }[];
  openFiles: string[];
  /** more files were open than listed */
  openFilesMore?: number;
  connections: { proto: string; local: string; remote?: string; state?: string }[];
  children: { pid: number; name: string }[];
  /** parts the operating system would not show (not your process, or not supported here) */
  notes: string[];
}

export interface ForceQuitApp {
  pid: number;
  name: string;
  path?: string;
  /** not answering (Windows reports this; elsewhere unknown) */
  notResponding?: boolean;
}

export type ProcAction = 'quit' | 'forceQuit' | 'endTree' | 'suspend' | 'resume' | 'restart';

export interface ProcsApi {
  /**
   * One reading of every process. The interface asks only while the page is
   * open, so nothing runs in the background. `network` also counts connections
   * per process, which costs more and is only done on the Network tab; `disk`
   * reads per-process disk counters (the Disk and Energy tabs; default on).
   */
  sample(opts?: { network?: boolean; disk?: boolean }): Promise<ProcSample>;
  act(action: ProcAction, pids: number[], opts?: { admin?: boolean }): Promise<ProcActionResult>;
  setPriority(pid: number, level: PriorityLevel, opts?: { admin?: boolean }): Promise<ProcActionResult>;
  details(pid: number): Promise<ProcDetails | null>;
  /** small app icons for executable paths, as data URLs (missing when there is none) */
  icons(paths: string[]): Promise<Record<string, string>>;
  reveal(path: string): Promise<void>;
  /** apps with windows, for the Force Quit dialog */
  apps(): Promise<ForceQuitApp[]>;
  restartKeeper(): Promise<void>;
  services(): Promise<{ supported: boolean; services: ServiceRow[]; note?: string }>;
  serviceAction(id: string, scope: 'user' | 'system', action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<ProcActionResult>;
}
