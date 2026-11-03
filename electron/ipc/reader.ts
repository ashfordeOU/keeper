// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the reader, and `keeper/reader.save` for the browser extension's
// "Save for later in Keeper" (through `keeper browser-host`).

import { ipcMain } from 'electron';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { readerApi, saveFromBrowser, startReader } from '../services/reader';

export function registerReaderIpc(d: { broadcast: (channel: string) => void; alert: (title: string, detail: string) => void }) {
  for (const [k, fn] of Object.entries(readerApi)) ipcMain.handle(`reader.${k}`, async (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args));
  registerKeeperMethod('keeper/reader.save', async (p) => {
    if (!featureOn('reader')) throw new Error('The reader is switched off in Keeper.');
    try {
      const it = await saveFromBrowser(String(p.url ?? ''), typeof p.title === 'string' ? p.title : undefined);
      d.alert('Saved for later', it.title);
      return { ok: true, key: it.key };
    } catch (e) {
      d.alert('Could not save the page', e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  });
  startReader(d);
}
