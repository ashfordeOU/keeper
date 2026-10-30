// SPDX-License-Identifier: AGPL-3.0-or-later
// The Places part of the interface ↔ main-process contract: favourites, cloud
// drives, disks, network servers, Connect to Server, the Trash and sharing.

import type { DiscoveredServer, Place, PlacesModel } from './places';

export interface TrashItem {
  /** where the item sits in the Trash (used to restore or delete it) */
  id: string;
  name: string;
  size: number;
  isDir: boolean;
  /** where it was before it was deleted, when the system or Keeper knows */
  original?: string;
  deletedAt?: number;
  /** "Macintosh HD", "USB STICK"…: which disk's trash holds it */
  volume?: string;
}

export interface TrashListing {
  items: TrashItem[];
  /** e.g. macOS needs Full Disk Access to read the Trash */
  note?: string;
  canRestore: boolean;
}

export interface ConnectRequest {
  address: string;
  user?: string;
  password?: string;
  remember?: boolean;
}

export interface ConnectResult {
  ok: boolean;
  /** where the share can be browsed once connected (a mount point, drive letter or gvfs path) */
  path?: string;
  message?: string;
}

export interface ShareTarget {
  id: string;
  name: string;
  /** 'system' = the operating system's share menu (AirDrop, Mail, Messages… on macOS) */
  kind: 'system' | 'email' | 'device' | 'airdrop';
}

export interface PlacesApi {
  list(): Promise<PlacesModel>;
  eject(path: string): Promise<{ ok: boolean; message?: string }>;
  connect(req: ConnectRequest): Promise<ConnectResult>;
  /** servers announcing themselves on the local network (takes about two seconds) */
  discover(): Promise<DiscoveredServer[]>;
  recentServers(): Promise<string[]>;
  forgetServer(address: string): Promise<string[]>;
  folderSize(path: string): Promise<{ size: number; files: number; folders: number }>;
  openAirDrop(): Promise<void>;
  shareTargets(): Promise<ShareTarget[]>;
  share(paths: string[], target?: string): Promise<{ ok: boolean; message?: string }>;
  trash: {
    list(): Promise<TrashListing>;
    restore(ids: string[]): Promise<{ restored: number; failed: string[] }>;
    remove(ids: string[]): Promise<{ removed: number; failed: string[] }>;
    empty(): Promise<{ ok: boolean; message?: string }>;
  };
}

export type { DiscoveredServer, Place, PlacesModel };
