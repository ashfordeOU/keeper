// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Permissions screen in the browser demo: a Mac part-way through setting
// up, so every state shows (allowed, not yet, turned off, not needed, can't be
// checked, restart needed). Allow flips a row after a moment, as if the person
// answered macOS's question.

import { featureDef, featureStates } from '../core/features';
import { buildReport, type PermissionsApi, type RawPermission } from '../core/permissions';
import type { KeychainApi } from '../core/keychain';
import type { AllSettings } from '../core/settings';

export function mockPermissions(get: () => AllSettings): { permissions: PermissionsApi; keychain: KeychainApi } {
  const raw: Record<string, RawPermission> = {
    accessibility: 'authorized', screen: 'notDetermined', input: 'notDetermined', microphone: 'authorized', camera: 'denied',
    fullDisk: 'notDetermined', 'automation.systemevents': 'authorized', 'automation.finder': 'notDetermined', 'automation.music': 'notRunning',
    'automation.notes': 'notDetermined', notifications: 'authorized', calendars: 'notDetermined', reminders: 'denied', location: 'notDetermined',
    localNetwork: 'unknown', loginItem: 'notDetermined',
  };
  const restartPending = new Set<string>();
  const on = () => new Set([...featureStates(get(), 'darwin').values()].filter((f) => f.on).map((f) => f.id));
  const later = (id: string, v: RawPermission, ms = 1500) => setTimeout(() => { raw[id] = v; if (id === 'screen' || id === 'input') restartPending.add(id); }, ms);
  return {
    permissions: {
      list: async () => buildReport('darwin', raw, on(), (id) => featureDef(id)?.name ?? id, { helper: true, restartPending }),
      request: async (id) => {
        if (raw[id] === 'denied') return { ok: true, opened: 'settings' };
        if (id === 'localNetwork') return { ok: true, opened: 'test', message: 'Keeper looked for devices on the network.' };
        later(id, 'authorized');
        return { ok: true, opened: id === 'fullDisk' ? 'settings' : id === 'loginItem' ? 'action' : 'prompt' };
      },
      openSettings: async () => true,
      test: async () => ({ ok: true, message: 'Keeper looked for devices on the network.' }),
      restart: async () => { restartPending.clear(); location.reload(); },
    },
    // ?keychain=locked shows the banner for a keychain that said no.
    keychain: (() => {
      let state: 'ok' | 'locked' = new URLSearchParams(location.search).get('keychain') === 'locked' ? 'locked' : 'ok';
      return {
        status: async () => ({ state, platform: 'darwin', unreadable: state === 'ok' ? undefined : 3 }),
        retry: async () => { state = 'ok'; return { state, platform: 'darwin' }; },
      };
    })(),
  };
}
