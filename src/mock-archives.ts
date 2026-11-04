// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Archives: one sample archive, in memory.

import type { ArchivesApi, OpenedArchive } from '../core/archives';
import { supportRows } from '../core/archives';

export function mockArchives(): { archives: ArchivesApi } {
  const now = Date.now();
  const sample: OpenedArchive = {
    path: '/Users/demo/Downloads/Holiday photos.zip', name: 'Holiday photos.zip', format: 'zip', size: 48_200_000, encrypted: false, engine: 'keeper',
    entries: [
      { name: 'Holiday photos/', size: 0, dir: true },
      { name: 'Holiday photos/Beach.jpg', size: 4_200_000, dir: false, mtime: now - 9e8 },
      { name: 'Holiday photos/Harbour at dusk.jpg', size: 5_100_000, dir: false, mtime: now - 9e8 },
      { name: 'Holiday photos/Day 2/Old town.jpg', size: 3_900_000, dir: false, mtime: now - 8e8 },
      { name: 'Holiday photos/Day 2/Market.mov', size: 31_000_000, dir: false, mtime: now - 8e8 },
      { name: 'Itinerary.pdf', size: 210_000, dir: false, mtime: now - 1e9 },
    ],
  };
  const tools = { bsdtar: 'tar' };
  return {
    archives: {
      open: async () => sample,
      extract: async (_p, picked) => ({ dest: '/Users/demo/Downloads/Holiday photos', files: picked?.length ?? 5, skipped: [] }),
      peek: async () => { throw new Error('Quick Look inside archives works in the desktop app.'); },
      create: async (paths, o) => `/Users/demo/Downloads/${paths.length === 1 ? (paths[0].split('/').pop() ?? 'Archive').replace(/\.[^.]+$/, '') : 'Archive'}.${o.format}`,
      support: async () => ({ rows: supportRows(tools), sevenZip: false, hint: 'Install the free 7-Zip program, then open the archive again.', platform: 'darwin' }),
      pick: async () => sample.path,
      pickItems: async () => ['/Users/demo/Documents/Report.pdf'],
    },
  };
}
