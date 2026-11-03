// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for automatic time tracking (electron/services/time-track.ts).

import { ipcMain } from 'electron';
import { startTimeTracking, timeTrackApi } from '../services/time-track';

export function registerTimeTrackIpc(d: { broadcast: (channel: string) => void }) {
  for (const [k, fn] of Object.entries(timeTrackApi)) ipcMain.handle(`timeTrack.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startTimeTracking(d);
}
