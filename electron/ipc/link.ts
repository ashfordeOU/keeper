// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for Keeper Link (Devices & Remote).

import { ipcMain } from 'electron';
import { link, startLink } from '../services/link';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export async function registerLinkIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; show: (route?: string) => void }) {
  handle('link.state', () => link.state());
  handle('link.setSettings', (p: never) => link.setSettings(p));
  handle('link.rename', (n: string) => link.rename(n));
  handle('link.discover', () => link.discover());
  handle('link.invite', () => link.invite());
  handle('link.cancelInvite', () => link.cancelInvite());
  handle('link.pair', (t: never) => link.pair(t));
  handle('link.confirmPair', (id: string, ok: boolean) => link.confirmPair(id, ok));
  handle('link.forget', (dev: string) => link.forget(dev));
  handle('link.setPermissions', (dev: string, p: never, auto?: boolean) => link.setPermissions(dev, p, auto));
  handle('link.renameDevice', (dev: string, n: string) => link.renameDevice(dev, n));
  handle('link.check', (dev: string) => link.check(dev));
  handle('link.sendFiles', (dev: string, paths?: string[]) => link.sendFiles(dev, paths));
  handle('link.answerOffer', (id: string, ok: boolean, always?: boolean) => link.answerOffer(id, ok, always));
  handle('link.sendClipboard', (dev: string) => link.sendClipboard(dev));
  handle('link.shares', (dev: string) => link.shares(dev));
  handle('link.list', (dev: string, share: string, dir: string) => link.list(dev, share, dir));
  handle('link.download', (dev: string, share: string, file: string) => link.download(dev, share, file));
  handle('link.addShare', (p?: string) => link.addShare(p));
  handle('link.removeShare', (id: string) => link.removeShare(id));
  handle('link.addForward', (f: never) => link.addForward(f));
  handle('link.removeForward', (id: string) => link.removeForward(id));
  handle('link.companionInvite', (viaTunnel?: boolean) => link.companionInvite(viaTunnel));
  handle('link.answerCompanion', (id: string, ok: boolean) => link.answerCompanion(id, ok));
  handle('link.forgetCompanion', (id: string) => link.forgetCompanion(id));
  handle('link.pending', () => link.pending());
  handle('link.tunnel.status', () => link.tunnel.status());
  handle('link.tunnel.start', (mode: never, token?: string, hostname?: string) => link.tunnel.start(mode, token, hostname));
  handle('link.tunnel.stop', () => link.tunnel.stop());
  handle('link.tunnel.installService', (on: boolean) => link.tunnel.installService(on));
  await startLink(d);
}
