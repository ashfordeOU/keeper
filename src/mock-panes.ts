// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Side by Side: a small made-up difference between two folders.

import { compareFolders, diffCounts, type CompareItem, type PanesApi } from '../core/panes';

export function mockPanes(): { panes: PanesApi } {
  const now = Date.now();
  const left: CompareItem[] = [
    { rel: 'Holiday photos', isDir: true, size: 0, mtime: now - 9e8 },
    { rel: 'Holiday photos/Beach.jpg', isDir: false, size: 4_200_000, mtime: now - 9e8 },
    { rel: 'Holiday photos/Harbour.jpg', isDir: false, size: 5_100_000, mtime: now - 4e8 },
    { rel: 'Budget 2026.xlsx', isDir: false, size: 48_000, mtime: now - 2e7 },
    { rel: 'Notes.txt', isDir: false, size: 1_200, mtime: now - 6e8 },
  ];
  const right: CompareItem[] = [
    { rel: 'Holiday photos', isDir: true, size: 0, mtime: now - 9e8 },
    { rel: 'Holiday photos/Beach.jpg', isDir: false, size: 4_200_000, mtime: now - 9e8 },
    { rel: 'Holiday photos/Harbour.jpg', isDir: false, size: 5_000_000, mtime: now - 8e8 },
    { rel: 'Notes.txt', isDir: false, size: 1_200, mtime: now - 6e8 },
    { rel: 'Scans', isDir: true, size: 0, mtime: now - 3e8 },
  ];
  return {
    panes: {
      compare: async () => {
        const rows = compareFolders(left, right);
        return { rows: rows.filter((r) => r.state !== 'same' || !r.isDir), truncated: false, counts: diffCounts(rows) };
      },
      copy: async (_f, _t, names) => ({ done: names.length, failed: [] }),
      sync: async () => ({ done: 3, failed: [] }),
    },
  };
}
