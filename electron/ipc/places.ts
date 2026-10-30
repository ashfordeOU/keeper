// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for Places: favourites, cloud drives, disks, servers, the Trash and sharing.

import { ipcMain } from 'electron';
import type { ConnectRequest } from '../../core/api-places';
import type { Journal } from '../../core/journal';
import {
  connect, discover, eject, emptyTrash, folderSize, forgetServer, listPlaces, listTrash, openAirDrop, recentServers, remoteFolders, removeFromTrash,
  restoreTrash, share, shareTargets, useJournal, watchPlaces,
} from '../services/places';
import { settings } from '../store';

interface Deps {
  journal: () => Journal | undefined;
  broadcast: (channel: string, ...args: unknown[]) => void;
  /** network drives and cloud folders to keep out of the library walk */
  setRemoteExclusions: (paths: string[]) => void;
  changed: () => void;
}

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerPlacesIpc(d: Deps) {
  useJournal(d.journal);
  const exclusions = () => d.setRemoteExclusions(settings().includeRemote ? [] : remoteFolders());
  watchPlaces(() => {
    exclusions();
    d.broadcast('places-changed');
  });
  setTimeout(exclusions, 3000);

  handle('places.list', async () => {
    const m = await listPlaces();
    exclusions();
    return m;
  });
  handle('places.eject', async (p: string) => {
    const r = await eject(p);
    d.broadcast('places-changed');
    return r;
  });
  handle('places.connect', async (req: ConnectRequest) => {
    const r = await connect(req);
    d.broadcast('places-changed');
    return r;
  });
  handle('places.discover', () => discover());
  handle('places.recentServers', () => recentServers());
  handle('places.forgetServer', (a: string) => forgetServer(a));
  handle('places.folderSize', (p: string) => folderSize(p));
  handle('places.openAirDrop', () => openAirDrop());
  handle('places.shareTargets', () => shareTargets());
  handle('places.share', (paths: string[], target?: string) => share(paths, target));
  handle('places.trash.list', () => listTrash());
  handle('places.trash.restore', async (ids: string[]) => {
    const r = await restoreTrash(ids);
    d.changed();
    return r;
  });
  handle('places.trash.remove', (ids: string[]) => removeFromTrash(ids));
  handle('places.trash.empty', () => emptyTrash());
}
