// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's backups of Keeper itself: 214 files, two nightly copies.

import type { KeeperBackupApi, KeeperBackupStatus } from '../core/api-keeper-backup';
import { WHY_TEXT } from '../core/keeper-backup';

export function mockKeeperBackup(): { keeperBackup: KeeperBackupApi } {
  const day = 86_400_000;
  const status = async (): Promise<KeeperBackupStatus> => ({
    files: 214, bytes: 3_400_000,
    leftOut: [{ why: 'secret', text: WHY_TEXT.secret, count: 2, examples: ['secrets.json'] }, { why: 'rebuilt', text: WHY_TEXT.rebuilt, count: 3, examples: ['index.json'] }],
    snapshots: [{ name: '2026-11-04', label: 'Today', bytes: 3_400_000 }, { name: '2026-11-03', label: 'Yesterday', bytes: 3_390_000 }],
  });
  const meta = { format: 1, keeper: '1.0.0', created: Date.now() - 2 * day, from: 'Ana’s laptop · macOS', files: 214, bytes: 3_400_000 };
  return {
    keeperBackup: {
      status, saveFile: async () => '/Users/demo/Documents/Keeper backup.keeperbackup', writeFile: async (_p, f) => f, sendTo: async () => true,
      pickFile: async () => ({ file: '/Users/demo/Downloads/Keeper backup.keeperbackup', meta }), inspect: async () => meta,
      restoreFile: async () => ({ files: 214 }), snapshotNow: status, restoreSnapshot: async () => ({ files: 214 }),
    },
  };
}
