// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the PDF reader (electron/services/pdf-reader.ts).

import { ipcMain } from 'electron';
import { featureOn } from '../services/features';
import { pdfReaderApi } from '../services/pdf-reader';

export function registerPdfReaderIpc() {
  for (const [k, fn] of Object.entries(pdfReaderApi)) {
    ipcMain.handle(`pdfReader.${k}`, async (_e, ...args) => {
      if (!featureOn('pdfReader')) throw new Error('The PDF reader is switched off (Settings → Features)');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
}
