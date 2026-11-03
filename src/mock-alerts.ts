// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's phone alerts: one ntfy topic, in memory.

import type { PhoneAlertsApi, PhoneAlertsOverview } from '../core/api-alerts';
import { defaultPhoneAlertSettings, type AlertChannel } from '../core/phone-alerts';

export function mockPhoneAlerts(): { alerts: PhoneAlertsApi } {
  let channels: AlertChannel[] = [{ id: 'n1', kind: 'ntfy', name: 'My phone', on: true, sources: ['monitors', 'backups'], server: 'https://ntfy.sh', topic: 'keeper-demo-7f3k' }];
  const overview = async (): Promise<PhoneAlertsOverview> => ({ channels: channels.map((c) => ({ ...c, hasSecret: false, last: { at: Date.now() - 3600_000, ok: true, message: 'Delivered' } })), settings: { ...defaultPhoneAlertSettings(), channels }, log: [], waiting: 0, accounts: [], memoryOnly: false });
  return {
    alerts: {
      overview,
      save: async (c) => { const id = c.id || `c${Date.now()}`; channels = channels.some((x) => x.id === id) ? channels.map((x) => (x.id === id ? { ...c, id } : x)) : [...channels, { ...c, id }]; return overview(); },
      remove: async (id) => { channels = channels.filter((c) => c.id !== id); return overview(); },
      test: async () => ({ ok: true, message: 'Delivered' }),
      setBatch: () => overview(),
    },
  };
}
