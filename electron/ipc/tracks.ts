// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Places & Tracks, and its answers to the keeper command.

import { ipcMain } from 'electron';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { keeperTracks, startTracks, tracks } from '../services/tracks';

export const TRACKS_METHODS = Object.keys(tracks) as (keyof typeof tracks)[];

export function registerTracksIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; trayChanged?: () => void }) {
  for (const m of TRACKS_METHODS) {
    ipcMain.handle(`tracks.${m}`, (_e, ...args: unknown[]) => {
      // Switched off: only the overview, settings and deleting everything answer.
      if (!featureOn('tracks') && !['overview', 'brief', 'setConfig', 'wipe'].includes(m)) throw new Error('Places & Tracks is switched off in Settings → Features.');
      return (tracks[m] as (...a: unknown[]) => unknown)(...args);
    });
  }
  registerKeeperMethod('keeper/tracks', (p) => {
    if (!featureOn('tracks')) throw new Error('Places & Tracks is switched off in Settings → Features.');
    return keeperTracks(p);
  });
  startTracks(d);
}
