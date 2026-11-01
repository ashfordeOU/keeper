// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Quick Controls.

import { ipcMain } from 'electron';
import type { ControlValue } from '../../core/controls/types';
import type { PermissionGrant } from '../../core/security/types';
import { applyPreset, bind, initControls, list, openSettings, perApp, perAppSet, preview, set, undo } from '../services/controls';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(`controls.${name}`, async (_e, ...args) => fn(...(args as never[])));
}

export function registerControlsIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; alert?: (title: string, detail: string) => void; show?: (route: string) => void }) {
  void initControls(d);
  handle('showPage', () => d.show?.('controls'));
  handle('list', (refresh?: boolean) => list(!!refresh));
  handle('set', (id: string, value: ControlValue, opts?: { confirmWeaker?: boolean }) => set(String(id), value, { confirmWeaker: opts?.confirmWeaker === true }));
  handle('preview', (id: string) => preview(String(id)));
  handle('applyPreset', (id: string, opts?: { confirmWeaker?: boolean }) => applyPreset(String(id), { confirmWeaker: opts?.confirmWeaker === true }));
  handle('undo', (id: string, opts?: { confirmWeaker?: boolean }) => undo(String(id), { confirmWeaker: opts?.confirmWeaker === true }));
  handle('open', (id: string) => openSettings(String(id)));
  handle('bind', (profileId: string, presetId: string | null) => bind(String(profileId), presetId ? String(presetId) : null));
  handle('perApp', () => perApp());
  handle('perAppSet', (g: PermissionGrant, allowed: boolean) => perAppSet(g, allowed === true));
}
