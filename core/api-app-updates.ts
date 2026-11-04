// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// App updates as the window sees them (core/app-updates.ts has the logic).

import type { UpdatesState } from './app-updates';

export interface AppUpdatesView extends UpdatesState {
  /** a check is running now */
  checking: boolean;
  /** updates being installed now (their ids) */
  busy: string[];
  /** where updates are found on this system, in plain words ("Each app's own feed and Homebrew") */
  sources: string;
}

export interface AppUpdatesApi {
  state(): Promise<AppUpdatesView>;
  /** looks again now */
  check(): Promise<AppUpdatesView>;
  /** updates one app: through its package manager, or the maker's checked download */
  update(id: string): Promise<{ ok: boolean; message: string }>;
  /** every update a package manager can do on its own, one after another */
  updateAll(): Promise<{ ok: boolean; message: string; done: number; failed: number }>;
  /** the system's own updater for system packages (or the command to run) */
  openSystemUpdater(): Promise<{ ok: boolean; message: string }>;
  /** the App Store's updates page (macOS) or the Microsoft Store's library (Windows) */
  openStore(): Promise<void>;
}
