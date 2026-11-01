// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Network Activity and VPN.

import { ipcMain } from 'electron';
import {
  exportCsv, geoDownload, geoRemove, geoStatus, getSettings, health, icons, importInstall, importPick, importText, initNet, publicIp, sample, setSettings, vpnAction, vpnStatus,
} from '../services/net';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerNetIpc(deps: { alert: (title: string, detail: string) => void }) {
  handle('net.sample', sample);
  handle('net.health', health);
  handle('net.vpnStatus', vpnStatus);
  handle('net.vpnAction', vpnAction);
  handle('net.importPick', importPick);
  handle('net.importText', importText);
  handle('net.importInstall', importInstall);
  handle('net.publicIp', publicIp);
  handle('net.settings', getSettings);
  handle('net.setSettings', setSettings);
  handle('net.geoStatus', geoStatus);
  handle('net.geoDownload', geoDownload);
  handle('net.geoRemove', geoRemove);
  handle('net.exportCsv', exportCsv);
  handle('net.icons', icons);
  void initNet(deps);
}
