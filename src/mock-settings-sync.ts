// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's settings sharing: one laptop, shared, with one older version.

import type { SettingsSyncApi, SettingsSyncStatus } from '../core/api-settings-sync';
import { DEFAULT_CATEGORIES, type SyncCategory } from '../core/settings-sync';

export function mockSettingsSync(): { settingsSync: SettingsSyncApi } {
  let cats: SyncCategory[] = [...DEFAULT_CATEGORIES];
  let sharing = true;
  const status = async (): Promise<SettingsSyncStatus> => ({
    on: true, categories: cats,
    devices: [{ id: 'laptop', name: 'Ana’s laptop', online: true, sharing, last: { at: Date.now() - 120_000, ok: true } }],
    older: [{ cat: 'look', key: 'theme', label: 'Theme', value: 'meadow', at: Date.now() - 86_400_000, by: 'laptop', replaced: Date.now() - 3_600_000 }],
  });
  return { settingsSync: { status, syncNow: status, setCategories: async (c) => { cats = c; return status(); }, setDevice: async (_d, on) => { sharing = on; return status(); }, restoreOlder: status } };
}
