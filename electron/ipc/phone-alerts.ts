// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for alerts to your phone.

import { ipcMain } from 'electron';
import { phoneAlertsApi, startPhoneAlerts } from '../services/phone-alerts';

export function registerPhoneAlertsIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(phoneAlertsApi)) ipcMain.handle(`alerts.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startPhoneAlerts(d);
}
