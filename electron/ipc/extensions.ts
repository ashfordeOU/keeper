// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for extensions.

import { ipcMain } from 'electron';
import type { FileEntry } from '../../core/types';
import { extensionsApi, startExtensions } from '../services/extensions';

export function registerExtensionsIpc(d: { broadcast: (channel: string) => void; searchFiles: (q: string, n: number) => FileEntry[] }) {
  for (const [k, fn] of Object.entries(extensionsApi)) ipcMain.handle(`extensions.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  startExtensions(d);
}
