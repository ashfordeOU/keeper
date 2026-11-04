// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Backing up and moving Keeper itself, as the window sees it (core/keeper-backup.ts has the rules).

import type { BackupMeta, LeftOutWhy } from './keeper-backup';

export interface KeeperBackupStatus {
  /** what a copy holds now */
  files: number;
  bytes: number;
  leftOut: { why: LeftOutWhy; text: string; count: number; examples: string[] }[];
  /** nightly copies, newest first ("Today", "Yesterday", "Tuesday") */
  snapshots: { name: string; label: string; bytes: number }[];
}

export interface KeeperBackupApi {
  status(): Promise<KeeperBackupStatus>;
  /** asks where, then saves a .keeperbackup sealed with this password; null when cancelled */
  saveFile(password: string): Promise<string | null>;
  /** saves to a given path (tests and the keeper command) */
  writeFile(password: string, file: string): Promise<string>;
  /** sends a sealed copy to a paired computer over Keeper Link */
  sendTo(device: string, password: string): Promise<boolean>;
  /** asks for a .keeperbackup and says what it is (without the password) */
  pickFile(): Promise<{ file: string; meta: BackupMeta } | null>;
  inspect(file: string): Promise<BackupMeta>;
  /** opens it with the password and puts it in place at a restart (Keeper restarts by itself) */
  restoreFile(file: string, password: string): Promise<{ files: number }>;
  snapshotNow(): Promise<KeeperBackupStatus>;
  restoreSnapshot(name: string): Promise<{ files: number }>;
}
