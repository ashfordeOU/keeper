// SPDX-License-Identifier: AGPL-3.0-or-later
// Connections to storage that is not on this computer: cloud services,
// servers, home servers and NAS boxes, and other computers on the network.

/**
 * How Keeper talks to it.
 *  - sftp, ftp, webdav: built in, fast, no extra programs
 *  - rclone: cloud services through the bundled rclone program (seventy-odd providers)
 *  - smb: Windows and Mac file sharing, mounted by the operating system
 */
export type RemoteKind = 'sftp' | 'ftp' | 'webdav' | 'rclone' | 'smb';

/** What sort of machine or service is at the other end, for the icon and the tips. */
export type DeviceKind = 'cloud' | 'home-server' | 'nas' | 'mac' | 'windows' | 'linux' | 'server' | 'unknown';

export interface Connection {
  id: string;
  name: string;
  kind: RemoteKind;
  device?: DeviceKind;
  host?: string;
  port?: number;
  user?: string;
  /** the folder on the server that counts as the top */
  root?: string;
  /** FTPS / HTTPS */
  secure?: boolean;
  /** accept a self-signed certificate (home servers often have one) */
  insecure?: boolean;
  /** sign in with a private key file instead of a password (SFTP) */
  keyFile?: string;
  /** rclone backend, e.g. "drive", "onedrive", "dropbox", "s3" */
  provider?: string;
  /** rclone options that are not secret (region, endpoint, team drive…) */
  options?: Record<string, string>;
  /** list it in library search (names, sizes and dates only; off by default) */
  includeInLibrary?: boolean;
  /** folders kept on this computer too, relative to the connection */
  offline?: string[];
  /** for smb: where the operating system mounted it */
  mountPath?: string;
  createdAt: number;
}

/** What the person fills in to add or change a connection; secrets never come back out. */
export interface ConnectionInput extends Omit<Connection, 'id' | 'createdAt'> {
  id?: string;
  password?: string;
  /** passphrase for keyFile */
  passphrase?: string;
  /** rclone options that are secret (client secret, access key secret…) */
  secrets?: Record<string, string>;
}

export interface RemoteEntry {
  name: string;
  /** path inside the connection, always with forward slashes, starting with "/" */
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mime?: string;
  /** a copy of this is kept on this computer */
  offline?: boolean;
}

export type ConnState = 'idle' | 'connecting' | 'connected' | 'needs-sign-in' | 'offline' | 'error';

export interface Quota {
  used?: number;
  total?: number;
  free?: number;
  trashed?: number;
}

export interface ConnStatus {
  id: string;
  state: ConnState;
  message?: string;
  quota?: Quota;
  checkedAt?: number;
}

export interface Transfer {
  id: string;
  label: string;
  direction: 'up' | 'down' | 'copy';
  bytes: number;
  total: number;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  message?: string;
}

/** One file system that is not this computer's. Paths start with "/" and use forward slashes. */
export interface RemoteFs {
  list(dir: string): Promise<RemoteEntry[]>;
  stat(p: string): Promise<RemoteEntry | null>;
  /** the bytes [start, end) when a range is given */
  read(p: string, opts?: { start?: number; end?: number; signal?: AbortSignal }): Promise<NodeJS.ReadableStream>;
  write(p: string, data: NodeJS.ReadableStream, size?: number): Promise<void>;
  mkdir(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** to the service's own trash where it has one, otherwise gone */
  remove(p: string, isDir: boolean): Promise<void>;
  quota?(): Promise<Quota | undefined>;
  close(): Promise<void>;
}
