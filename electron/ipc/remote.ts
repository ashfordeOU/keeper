// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Cloud & servers.

import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron';
import type { ConnectionInput, RemoteEntry } from '../../core/remote/types';
import { connect } from '../services/places';
import * as remote from '../services/remote';
import { listShares, scanLan } from '../services/remote/lan';

interface Deps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  /** the same thumbnails as local files get */
  thumbnail: (path: string, size: number) => Promise<string | null>;
}

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export async function registerRemoteIpc(d: Deps) {
  await remote.initRemote(d.broadcast);
  handle('remote.list', () => remote.list());
  handle('remote.cloudAvailable', () => remote.rcloneAvailable());
  handle('remote.providers', () => remote.providers());
  handle('remote.providerForm', (prefix: string, sub?: string) => remote.providerForm(prefix, sub));
  handle('remote.signIn', async (provider: string, id?: string, client?: { id?: string; secret?: string }) => ({ id: (await remote.signIn(provider, id, client)).id }));
  handle('remote.cancelSignIn', () => remote.cancelSignIn());
  handle('remote.test', (input: ConnectionInput) => remote.test(input));
  handle('remote.save', (input: ConnectionInput) => remote.saveConnection(input));
  handle('remote.remove', (id: string) => remote.remove(id));
  handle('remote.check', (id: string) => remote.check(id));
  handle('remote.quota', (id: string) => remote.quota(id));
  handle('remote.listDir', (id: string, dir: string) => remote.listDir(id, dir));
  handle('remote.mkdir', async (id: string, dir: string, name: string) => {
    await remote.mkdir(id, dir, name);
    d.broadcast('remote-changed');
  });
  handle('remote.rename', async (id: string, p: string, name: string) => {
    await remote.rename(id, p, name);
    d.broadcast('remote-changed');
  });
  handle('remote.removeEntries', async (id: string, items: { path: string; isDir: boolean }[]) => {
    const r = await remote.removeEntries(id, items);
    d.broadcast('remote-changed');
    return r;
  });
  handle('remote.thumbnail', (id: string, e: RemoteEntry, size: number) => remote.thumbnail(id, e, size, d.thumbnail));
  handle('remote.open', (id: string, e: RemoteEntry) => remote.open(id, e));
  handle('remote.preview', (id: string, e: RemoteEntry) => remote.preview(id, e));
  handle('remote.uploadPick', async (id: string, dir: string) => {
    const win = BrowserWindow.getFocusedWindow();
    const r = await (win ? dialog.showOpenDialog(win, { properties: ['openFile', 'openDirectory', 'multiSelections'] }) : dialog.showOpenDialog({ properties: ['openFile', 'openDirectory', 'multiSelections'] }));
    if (r.canceled || !r.filePaths.length) return { done: 0, failed: [] };
    return remote.upload(id, dir, r.filePaths);
  });
  handle('remote.upload', (id: string, dir: string, paths: string[]) => remote.upload(id, dir, paths));
  handle('remote.download', (id: string, entries: RemoteEntry[], to?: string) => remote.download(id, entries, to));
  handle('remote.transfers', () => remote.listTransfers());
  handle('remote.cancelTransfer', (tid: string) => remote.cancelTransfer(tid));
  handle('remote.setOffline', (id: string, p: string, on: boolean) => remote.setOffline(id, p, on));
  handle('remote.search', (q: string) => remote.search(q));
  handle('remote.scanLan', () => scanLan());
  handle('remote.shares', (host: string, user?: string, password?: string) => listShares(host, user, password));
  handle('remote.mount', async (id: string) => {
    const c = remote.list().connections.find((x) => x.id === id);
    if (!c?.host) return { ok: false, message: 'That connection no longer exists' };
    const address = `smb://${c.user ? `${encodeURIComponent(c.user)}@` : ''}${c.host}${c.root ? `/${c.root.replace(/^\/+/, '')}` : ''}`;
    const r = await connect({ address, user: c.user, remember: false });
    if (r.ok && r.path) await remote.setMountPath(id, r.path);
    d.broadcast('places-changed');
    return r;
  });
  // Dragging a remote file out: download it, then hand the local copy to the system.
  ipcMain.on('remote.startDrag', async (e, id: string, entry: RemoteEntry) => {
    try {
      const local = await remote.preview(id, entry);
      const icon = nativeImage.createFromPath(local);
      e.sender.startDrag({ file: local, icon: icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') : icon.resize({ width: 64 }) });
    } catch {
      /* nothing to drag */
    }
  });
}
