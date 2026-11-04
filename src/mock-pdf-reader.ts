// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's PDF reader: the desktop app opens real PDFs.

import type { PdfReaderApi } from '../core/pdf-annotate';

export function mockPdfReader(): { pdfReader: PdfReaderApi } {
  const desktop = async (): Promise<never> => { throw new Error('Opening PDFs works in the desktop app.'); };
  return { pdfReader: { read: desktop, pick: async () => null, pickMore: async () => [], save: desktop, hasBackup: async () => false, restore: async () => false } };
}
