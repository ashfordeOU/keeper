// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access in the tray menu: sessions with Stop, your devices with Send
// Files / View / Control, and Get Help / Help Someone. Which of these appear
// is chosen under Devices → Remote Access (core/link/surfaces.ts).

import { Notification } from 'electron';
import { formatCode } from '../../../core/link/help';
import { trayEntries, type TrayEntry } from '../../../core/link/surfaces';
import { featureOn } from '../features';
import { link, linkNode } from './index';
import { screenService } from './access';

const listeners = new Set<() => void>();

/** The tray menu should be built again (devices, sessions or help changed). */
export function onTrayChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let timer: NodeJS.Timeout | undefined;
export function trayChanged() {
  clearTimeout(timer);
  timer = setTimeout(() => listeners.forEach((f) => f()), 300);
}

export function trayAccessItems(showMain: (route?: string) => void): Electron.MenuItemConstructorOptions[] {
  const node = linkNode();
  if (!node?.data || !node.me || !featureOn('link') || node.data.settings.mode === 'off') return [];
  const st = node.state();
  const svc = screenService();
  const offer = node.help.status().offer;
  const entries = trayEntries({
    surfaces: st.settings.surfaces,
    devices: st.devices.map((d) => ({ id: d.id, name: d.name, online: d.online, via: d.via === 'lan' ? 'local' : d.via, canView: true })),
    sessions: (svc?.state().sessions ?? []).filter((s) => s.state !== 'ended'),
    helpOn: featureOn('remoteHelp'),
    helpWaiting: offer ? formatCode(offer.code) : undefined,
    screenOn: featureOn('remoteScreen'),
  });
  const run = (action?: string, arg?: string) => {
    const fail = (e: unknown) => Notification.isSupported() && new Notification({ title: 'Keeper', body: e instanceof Error ? e.message : String(e) }).show();
    switch (action) {
      case 'stopSession': return svc?.stop(arg!);
      case 'sendFiles': return void link.sendFiles(arg!).catch(fail);
      case 'view': return void svc?.view(arg!, { control: false }).catch(fail);
      case 'control': return void svc?.view(arg!, { control: true }).catch(fail);
      case 'details': return showMain(`devices:${arg}`);
      case 'helpStart':
        return void node.help.start().then((o) => {
          showMain('devices:help');
          if (Notification.isSupported()) new Notification({ title: `Help code ${formatCode(o.code)}`, body: `Password ${o.password} · works once, for 10 minutes` }).show();
          trayChanged();
        }, fail);
      case 'helpStop':
        node.help.stop('You ended help');
        return trayChanged();
      case 'helpSomeone': return showMain('devices:help');
    }
  };
  const map = (e: TrayEntry): Electron.MenuItemConstructorOptions => ('separator' in e ? { type: 'separator' } : { label: e.label, enabled: e.enabled !== false, submenu: e.submenu?.map(map), click: e.submenu ? undefined : () => run(e.action, e.arg) });
  return entries.map(map);
}
