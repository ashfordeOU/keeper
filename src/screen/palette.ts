// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access in the command palette: Get help, Help someone, and each of
// your devices (send files, view, control), where the person chose to show them.

import { api } from '../api';
import { knownDevices, shownIn } from './surfaces';

interface PaletteCommand {
  id: string;
  label: string;
  group: 'Go to' | 'Actions';
  icon: string;
  keywords?: string;
  typed?: boolean;
  run: () => unknown;
}

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function accessCommands(store: { go(r: { name: 'devices'; arg?: string }): void; toast(t: string): void }): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  if (shownIn('help', 'palette')) {
    out.push({ id: 'remote-get-help', label: 'Get Help (show a code for a helper)', group: 'Actions', icon: 'laptop', keywords: 'support remote assist help code', run: async () => { try { const o = await api.access.helpStart(); store.go({ name: 'devices', arg: 'help' }); store.toast(`Help code ${o.code} · password ${o.password}`); } catch (e) { store.toast(clean(e)); } } });
    out.push({ id: 'remote-help-someone', label: 'Help Someone…', group: 'Actions', icon: 'laptop', keywords: 'support remote assist help code connect', run: () => store.go({ name: 'devices', arg: 'help' }) });
  }
  if (shownIn('devices', 'palette')) {
    for (const d of knownDevices()) {
      out.push({ id: `remote-view-${d.id}`, label: `View ${d.name}’s Screen`, group: 'Actions', icon: 'eye', typed: true, keywords: `remote screen watch ${d.name}`, run: () => void api.screen.view(d.id, { control: false }).catch((e) => store.toast(clean(e))) });
      out.push({ id: `remote-control-${d.id}`, label: `Control ${d.name}`, group: 'Actions', icon: 'laptop', typed: true, keywords: `remote screen control ${d.name}`, run: () => void api.screen.view(d.id, { control: true }).catch((e) => store.toast(clean(e))) });
      if (shownIn('sendTo', 'palette')) out.push({ id: `remote-send-${d.id}`, label: `Send Files to ${d.name}…`, group: 'Actions', icon: 'send', typed: true, keywords: `send files ${d.name}`, run: () => void api.link.sendFiles(d.id).catch((e) => store.toast(clean(e))) });
    }
  }
  out.push({ id: 'remote-audit', label: 'Remote Access Log', group: 'Go to', icon: 'history', keywords: 'audit sessions transfers commands log', run: () => store.go({ name: 'devices', arg: 'audit' }) });
  return out;
}
