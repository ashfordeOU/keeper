// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The "Cloud & servers" part of the interface ↔ main-process contract.

import type { DeviceGuess, LanDevice, Share } from './remote/lan';
import type { FormField, ProviderInfo } from './remote/providers';
import type { Connection, ConnectionInput, ConnStatus, Quota, RemoteEntry, Transfer } from './remote/types';
import type { DriveStatus, DriveSupport } from './remote/drive';

export interface FoundDevice extends LanDevice {
  guess: DeviceGuess;
}

export interface RemoteApi {
  /** saved connections and how each one is doing */
  list(): Promise<{ connections: Connection[]; status: ConnStatus[] }>;
  /** whether cloud services (through rclone) are available in this copy */
  cloudAvailable(): Promise<boolean>;
  providers(): Promise<ProviderInfo[]>;
  providerForm(prefix: string, sub?: string): Promise<FormField[]>;
  /** opens the provider's sign-in page in the browser; resolves when it is done */
  signIn(provider: string, id?: string, client?: { id?: string; secret?: string }): Promise<{ id: string }>;
  cancelSignIn(): Promise<void>;
  test(input: ConnectionInput): Promise<{ ok: boolean; message?: string; entries?: number }>;
  save(input: ConnectionInput): Promise<{ connection: Connection; remembered: boolean }>;
  remove(id: string): Promise<void>;
  check(id: string): Promise<ConnStatus>;
  quota(id: string): Promise<Quota | undefined>;

  listDir(id: string, dir: string): Promise<RemoteEntry[]>;
  mkdir(id: string, dir: string, name: string): Promise<void>;
  rename(id: string, path: string, name: string): Promise<void>;
  removeEntries(id: string, items: { path: string; isDir: boolean }[]): Promise<{ removed: number; failed: string[] }>;
  thumbnail(id: string, entry: RemoteEntry, size: number): Promise<string | null>;
  /** opens with the usual app; saving sends it back */
  open(id: string, entry: RemoteEntry): Promise<string>;
  /** a local copy for the preview, returns its path */
  preview(id: string, entry: RemoteEntry): Promise<string>;
  /** asks for files on this computer and uploads them into the folder */
  uploadPick(id: string, dir: string): Promise<{ done: number; failed: string[] }>;
  upload(id: string, dir: string, paths: string[]): Promise<{ done: number; failed: string[] }>;
  download(id: string, entries: RemoteEntry[], to?: string): Promise<{ done: number; failed: string[]; folder: string }>;
  transfers(): Promise<Transfer[]>;
  cancelTransfer(id: string): Promise<void>;
  setOffline(id: string, path: string, on: boolean): Promise<string | null>;
  search(q: string): Promise<{ id: string; name: string; entry: RemoteEntry }[]>;
  /** drags a remote file out of Keeper (downloads it first) */
  startDrag(id: string, entry: RemoteEntry): Promise<void>;

  /** other machines on the local network, with what they are and how to open them */
  scanLan(): Promise<FoundDevice[]>;
  shares(host: string, user?: string, password?: string): Promise<{ shares: Share[]; message?: string }>;
  /** SMB: mounts it through the system and returns the folder to browse */
  mount(id: string): Promise<{ ok: boolean; path?: string; message?: string }>;

  /** connections as drives (core/remote/drive.ts): what this computer can do */
  driveSupport(): Promise<DriveSupport>;
  /** the connections open as drives now */
  drives(): Promise<OpenDriveInfo[]>;
  openDrive(id: string): Promise<OpenDriveInfo>;
  /** waits for changes still to send */
  closeDrive(id: string): Promise<void>;
  /** shows the drive in Finder, File Explorer or the file manager */
  showDrive(id: string): Promise<void>;
}

/** A connection open as a drive: where it shows and how it is doing. */
export interface OpenDriveInfo {
  id: string;
  name: string;
  place: string;
  status: DriveStatus;
}

export type { Connection, ConnectionInput, ConnStatus, DeviceGuess, FormField, ProviderInfo, Quota, RemoteEntry, Share, Transfer };
