// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Check Keeper: one amber row, and a small report.

import type { SelfCheckApi } from '../core/api-selfcheck';
import { aboutText, reportFiles, selfCheckRows } from '../core/selfcheck';

export function mockSelfCheck(): { selfCheck: SelfCheckApi } {
  const rows = () => selfCheckRows({ dataWritable: true, dataFreeBytes: 96 * 1024 ** 3, index: { files: 2148, indexing: false, folders: 6 }, permissions: [{ id: 'screen', name: 'Screen Recording', state: 'missing', usedBy: ['Capture'] }], parts: [{ id: 'island', name: 'Island', wanted: true, state: 'running' }], components: [], keychain: 'ok', crashes7d: 0 });
  return {
    selfCheck: {
      run: async () => ({ rows: rows(), at: Date.now() }),
      fix: async () => ({ ok: true, message: 'Done.' }),
      reportPreview: async () => reportFiles([{ name: 'about.txt', what: 'Keeper’s version, your system and Check Keeper', text: aboutText({ version: '1.0.0', platform: 'darwin', release: '25.1.0', arch: 'arm64', partsOn: ['library', 'island', 'mail'], rows: rows(), at: new Date() }) }, { name: 'last-moments.json', what: 'What Keeper did lately', text: '{"lines":["2026-11-04T09:12:00Z log opened /Users/ana/Documents/Plan.md for ana@example.com"]}' }], { home: '/Users/ana', user: 'ana' }),
      reportSave: async () => ({ ok: true, path: 'keeper-problem-report.zip', message: 'Saved. Attach it to an e-mail or an issue; nothing was sent.' }),
    },
  };
}
