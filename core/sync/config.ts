// SPDX-License-Identifier: AGPL-3.0-or-later
// Sync and backup settings. No Node modules here: the window reads this too.

import type { RetentionPolicy } from './backup';
import type { MirrorDirection } from './mirror';
import type { VersionPolicy } from './versions';
import type { SyncMode } from './engine';

export interface SyncFolderSetting {
  id: string;
  path: string;
  label: string;
  mode: SyncMode;
  /** device ids it is shared with */
  devices: string[];
  ignore: string[];
  versioning: VersionPolicy;
  paused?: boolean;
}

/** Where backups and mirrors go: a folder (second drive, NAS share, iCloud Drive on a Mac) or a connection (cloud, server). */
export type StoreTarget =
  | { kind: 'folder'; path: string }
  | { kind: 'connection'; connectionId: string; path: string; label?: string };

export type BackupSchedule = 'manual' | 'hourly' | 'daily' | 'idle' | 'drive';

export interface BackupJobSetting {
  id: string;
  name: string;
  sources: { name: string; path: string }[];
  dest: StoreTarget;
  schedule: BackupSchedule;
  retention: RetentionPolicy;
  ignore: string[];
  created: number;
  lastRun?: number;
  lastOk?: boolean;
  lastMessage?: string;
  /** when Keeper last checked a restore works */
  lastTest?: number;
  paused?: boolean;
}

export interface MirrorJobSetting {
  id: string;
  name: string;
  local: string;
  dest: StoreTarget;
  direction: MirrorDirection;
  ignore: string[];
  schedule: 'manual' | 'hourly' | 'live';
  lastRun?: number;
  lastMessage?: string;
  paused?: boolean;
}

export interface SyncSettings {
  /** this device's name as other devices see it */
  deviceName: string;
  paused: boolean;
  folders: SyncFolderSetting[];
  backups: BackupJobSetting[];
  mirrors: MirrorJobSetting[];
  /** KB/s for sync between devices; 0 = no limit */
  bandwidthKBps: number;
  pauseOnBattery: boolean;
  /** phones send photos and videos here through the web companion */
  phoneUploads: { enabled: boolean; folder: string };
}

export function defaultSyncSettings(deviceName = 'This computer', pictures = ''): SyncSettings {
  return { deviceName, paused: false, folders: [], backups: [], mirrors: [], bandwidthKBps: 0, pauseOnBattery: true, phoneUploads: { enabled: false, folder: pictures } };
}

export function normalizeSyncSettings(s: Partial<SyncSettings> | undefined, d: SyncSettings): SyncSettings {
  const x = { ...d, ...(s ?? {}) };
  x.folders = Array.isArray(x.folders) ? x.folders.filter((f) => f && f.id && f.path) : [];
  x.backups = Array.isArray(x.backups) ? x.backups.filter((b) => b && b.id && b.dest) : [];
  x.mirrors = Array.isArray(x.mirrors) ? x.mirrors.filter((m) => m && m.id && m.dest) : [];
  x.phoneUploads = { ...d.phoneUploads, ...(x.phoneUploads ?? {}) };
  return x;
}

/** The "three copies, two kinds of storage, one away from home" check. */
export function check321(s: SyncSettings, kindOf: (t: StoreTarget) => 'drive' | 'cloud' | 'device' | 'local'): { copies: number; kinds: number; offsite: boolean; ok: boolean; advice: string[] } {
  const kinds = new Set<string>(['local']);
  let copies = 1;
  let offsite = false;
  for (const b of s.backups) {
    if (b.paused) continue;
    copies++;
    const k = kindOf(b.dest);
    kinds.add(k);
    if (k === 'cloud' || k === 'device') offsite = true;
  }
  for (const m of s.mirrors) {
    if (m.paused || m.direction === 'down') continue;
    copies++;
    const k = kindOf(m.dest);
    kinds.add(k);
    if (k === 'cloud') offsite = true;
  }
  if (s.folders.some((f) => f.devices.length && !f.paused)) {
    copies++;
    kinds.add('device');
    offsite = true;
  }
  const advice: string[] = [];
  if (copies < 3) advice.push(copies === 1 ? 'Your files exist in one place only. Add a backup to a drive and one to a cloud service.' : 'Add one more copy: a backup to another drive or a cloud service.');
  if (kinds.size < 2) advice.push('Keep a copy on a different kind of storage (an external drive, a NAS or a cloud service).');
  if (!offsite) advice.push('Keep one copy away from this place: a cloud service or another of your devices.');
  return { copies, kinds: kinds.size, offsite, ok: copies >= 3 && kinds.size >= 2 && offsite, advice };
}
