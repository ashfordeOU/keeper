// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's app updates: three apps with a newer version, one for security.

import type { AppUpdatesApi, AppUpdatesView } from '../core/api-app-updates';
import type { AppUpdate } from '../core/app-updates';

export function mockAppUpdates(): { appUpdates: AppUpdatesApi } {
  let updates: AppUpdate[] = [
    { id: 'feed:com.example.notes', name: 'Field Notes', installed: '3.1', latest: '3.2', source: 'feed', security: true, action: { kind: 'open', url: 'https://example.com/notes' } },
    { id: 'brewCask:sketchpad', name: 'sketchpad', installed: '2.0.4', latest: '2.1.0', source: 'brewCask', action: { kind: 'run', cmd: { file: 'brew', args: ['upgrade', '--cask', 'sketchpad'] } } },
    { id: 'brew:ripgrep', name: 'ripgrep', installed: '14.0.3', latest: '14.1.1', source: 'brew', action: { kind: 'run', cmd: { file: 'brew', args: ['upgrade', 'ripgrep'] } } },
  ];
  const view = (): AppUpdatesView => ({ checkedAt: Date.now() - 3600_000, updates, notes: [], storeApps: 4, checking: false, busy: [], sources: 'Each app’s own update feed and Homebrew' });
  return {
    appUpdates: {
      state: async () => view(),
      check: async () => view(),
      update: async (id) => { const u = updates.find((x) => x.id === id); updates = updates.filter((x) => x.id !== id); return { ok: true, message: `${u?.name ?? 'The app'} is up to date` }; },
      updateAll: async () => { const n = updates.filter((u) => u.action.kind === 'run').length; updates = updates.filter((u) => u.action.kind !== 'run'); return { ok: true, done: n, failed: 0, message: `${n} apps updated` }; },
      openSystemUpdater: async () => ({ ok: true, message: 'Opened your system’s updater' }),
      openStore: async () => undefined,
    },
  };
}
