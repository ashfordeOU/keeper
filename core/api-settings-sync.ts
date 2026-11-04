// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings that follow you between your computers, as the window sees it (core/settings-sync.ts).

import type { OlderVersion, SyncCategory } from './settings-sync';

export interface SettingsSyncStatus {
  on: boolean;
  categories: SyncCategory[];
  /** paired computers, and whether this one shares with each */
  devices: { id: string; name: string; online: boolean; sharing: boolean; last?: { at: number; ok: boolean; message?: string } }[];
  older: OlderVersion[];
}

export interface SettingsSyncApi {
  status(): Promise<SettingsSyncStatus>;
  syncNow(): Promise<SettingsSyncStatus>;
  setCategories(cats: SyncCategory[]): Promise<SettingsSyncStatus>;
  /** share with a paired computer, or stop */
  setDevice(device: string, on: boolean): Promise<SettingsSyncStatus>;
  /** brings back an older version (index in `older`); it travels as the newest */
  restoreOlder(index: number): Promise<SettingsSyncStatus>;
}
