// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sync between devices, backups and mirrors, as the window sees them.

import type { SnapshotSummary } from './sync/backup';
import type { BackupJobSetting, MirrorJobSetting, StoreTarget, SyncFolderSetting } from './sync/config';
import type { PeerInfo } from './sync/ports';
import type { VersionInfo, VersionPolicy } from './sync/versions';

export type { BackupJobSetting, MirrorJobSetting, StoreTarget, SyncFolderSetting, SnapshotSummary, VersionInfo, VersionPolicy, PeerInfo };

export interface SyncDeviceState {
  id: string;
  name: string;
  online: boolean;
  via?: string;
  lastSync?: number;
  state: 'idle' | 'syncing' | 'offline' | 'error';
  message?: string;
}

export interface SyncFolderStatus extends SyncFolderSetting {
  state: 'idle' | 'scanning' | 'syncing' | 'paused' | 'error' | 'waiting';
  message?: string;
  files: number;
  bytes: number;
  conflicts: number;
  lastScan?: number;
  progress?: { file: string; done: number; total: number; queued: number };
  peers: SyncDeviceState[];
}

export interface BackupJobStatus extends BackupJobSetting {
  state: 'idle' | 'running' | 'error' | 'waiting';
  progress?: { phase: string; file?: string; files: number; bytes: number; totalBytes?: number };
  snapshots?: number;
  storedBytes?: number;
  nextRun?: number;
  /** the password is not remembered on this computer: ask before running */
  needsPassword?: boolean;
  destLabel: string;
  testDue?: boolean;
}

export interface MirrorJobStatus extends MirrorJobSetting {
  state: 'idle' | 'running' | 'error';
  progress?: { file: string; done: number; total: number };
  destLabel: string;
}

export interface SyncOverview {
  deviceId: string;
  deviceName: string;
  paused: boolean;
  /** how this device reaches the others */
  transport: 'link' | 'loopback' | 'none';
  transportMessage?: string;
  peers: PeerInfo[];
  folders: SyncFolderStatus[];
  backups: BackupJobStatus[];
  mirrors: MirrorJobStatus[];
  check321: { copies: number; kinds: number; offsite: boolean; ok: boolean; advice: string[] };
  /** waiting because of battery, the computer being busy, or paused */
  waitingFor?: string;
  bandwidthKBps: number;
  pauseOnBattery: boolean;
  /** phones send photos and videos here through the web companion */
  phoneUploads: { enabled: boolean; folder: string };
  /** folders other devices share with this one, waiting to be accepted */
  offers: { peer: string; peerName: string; id: string; label: string }[];
}

export interface ConflictInfo {
  /** the file with the original name */
  path: string;
  /** the conflict copy beside it */
  copy: string;
  size: number;
  mtime: number;
  copySize: number;
  copyMtime: number;
}

export interface StoreChoice {
  kind: 'folder' | 'connection';
  id?: string;
  label: string;
  /** cloud, server, drive… for the icon */
  detail: string;
  path?: string;
  online?: boolean;
}

export interface SyncApi {
  overview(): Promise<SyncOverview>;
  setPaused(paused: boolean): Promise<SyncOverview>;
  setOptions(patch: { bandwidthKBps?: number; pauseOnBattery?: boolean; deviceName?: string; phoneUploads?: { enabled: boolean; folder: string } }): Promise<SyncOverview>;
  addFolder(input: { id?: string; path: string; label?: string; mode: SyncFolderSetting['mode']; devices: string[]; versioning?: VersionPolicy; ignore?: string[] }): Promise<SyncOverview>;
  updateFolder(id: string, patch: Partial<Omit<SyncFolderSetting, 'id'>>): Promise<SyncOverview>;
  removeFolder(id: string): Promise<SyncOverview>;
  /** "not now" for a folder another device offers */
  ignoreOffer(id: string): Promise<SyncOverview>;
  rescan(id?: string): Promise<void>;
  conflicts(folderId: string): Promise<ConflictInfo[]>;
  resolveConflict(folderId: string, copy: string, keep: 'mine' | 'theirs' | 'both'): Promise<void>;
  versions(folderId: string, rel?: string): Promise<VersionInfo[]>;
  restoreVersion(folderId: string, vrel: string): Promise<string>;
  /** versions of a file anywhere in a synced folder (for the Inspector) */
  versionsFor(absPath: string): Promise<{ folderId: string; rel: string; versions: VersionInfo[] } | null>;
  destinations(): Promise<StoreChoice[]>;
  addBackup(input: { name: string; sources: { name: string; path: string }[]; dest: StoreTarget; schedule: BackupJobSetting['schedule']; password: string; remember: boolean; ignore?: string[]; retention?: BackupJobSetting['retention']; existing?: boolean }): Promise<{ overview: SyncOverview; recovery?: string }>;
  updateBackup(id: string, patch: Partial<Omit<BackupJobSetting, 'id'>>): Promise<SyncOverview>;
  removeBackup(id: string): Promise<SyncOverview>;
  runBackup(id: string, password?: string): Promise<SyncOverview>;
  cancelBackup(id: string): Promise<void>;
  snapshots(id: string, password?: string): Promise<SnapshotSummary[]>;
  snapshotFiles(id: string, name: string, password?: string): Promise<{ path: string; size: number; mtime: number }[]>;
  restore(id: string, name: string, opts: { include?: string[]; target?: string; overwrite?: boolean; password?: string }): Promise<{ files: number; bytes: number; skipped: string[]; target: string }>;
  verifyBackup(id: string, full?: boolean, password?: string): Promise<{ ok: boolean; problems: string[]; checked: number }>;
  addMirror(input: { name: string; local: string; dest: StoreTarget; direction: MirrorJobSetting['direction']; schedule: MirrorJobSetting['schedule']; ignore?: string[] }): Promise<SyncOverview>;
  updateMirror(id: string, patch: Partial<Omit<MirrorJobSetting, 'id'>>): Promise<SyncOverview>;
  removeMirror(id: string): Promise<SyncOverview>;
  runMirror(id: string): Promise<SyncOverview>;
}
