// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A connection opened as a drive: it shows in Finder, File Explorer or the
// file manager like a disk, and every app can open and save its files. Keeper
// asks the rclone program it already uses for cloud services to serve it
// (`rclone mount` through its remote control). That needs a file-system layer
// from the system: macOS's built-in network file sharing (NFS) or macFUSE,
// WinFsp on Windows, FUSE 3 on Linux. Keeper never installs one; it says
// plainly what is missing and how to get it.
// Pure: what this computer can do, which connections can be drives, where a
// drive goes, what rclone is asked, and the drive's state from rclone's
// numbers. electron/services/remote/drives.ts does the work.

import { normalizeRemote, onServer } from './paths';
import type { Connection } from './types';

// ---------------------------------------------------------------- what this computer can do

/** What was found on this computer; gathered by the service, judged here. */
export interface DriveFacts {
  platform: NodeJS.Platform;
  /** macOS major and minor version, e.g. [15, 4] */
  macVersion?: [number, number];
  /** the rclone program is here */
  rclone: boolean;
  /** what rclone says it can mount with ("mount", "cmount", "nfsmount"); empty when it was not asked */
  types: string[];
  /** macFUSE is installed (/Library/Filesystems/macfuse.fs) */
  macfuse?: boolean;
  /** WinFsp is installed */
  winfsp?: boolean;
  /** /dev/fuse is there and so is fusermount3 (or fusermount) */
  fuse?: boolean;
  /** Keeper runs in a sandbox (Flatpak, Snap, the Mac App Store) that may not mount anything */
  sandboxed?: boolean;
}

export interface DriveSupport {
  ready: boolean;
  /** how rclone mounts here when ready */
  mountType?: 'mount' | 'cmount' | 'nfsmount';
  /** one line: what makes it work, or what is missing */
  title: string;
  detail: string;
  /** what the person can do, in order */
  steps?: string[];
  /** a page that explains the missing piece (the piece's own site) */
  link?: { label: string; url: string };
}

const has = (f: DriveFacts, t: string) => f.types.includes(t);

/** Judges what was found: ready, and how, or what is missing, in plain words. */
export function driveSupport(f: DriveFacts): DriveSupport {
  if (f.sandboxed) {
    return { ready: false, title: 'Not in this copy of Keeper', detail: 'This copy runs in a sandbox that may not add drives to the system.' };
  }
  if (!f.rclone) {
    return { ready: false, title: 'Needs the rclone program', detail: 'Drives are served by rclone, which is missing from this copy of Keeper.', steps: ['Reinstall Keeper, or install rclone and restart Keeper.'] };
  }
  const known = f.types.length > 0;
  if (f.platform === 'darwin') {
    // macOS's own network file sharing needs nothing installed.
    if (has(f, 'nfsmount')) return { ready: true, mountType: 'nfsmount', title: 'Ready', detail: 'Uses the Mac’s built-in network file sharing. Nothing to install.' };
    if (f.macfuse && (has(f, 'cmount') || has(f, 'mount') || !known)) return { ready: true, mountType: has(f, 'cmount') ? 'cmount' : 'mount', title: 'Ready', detail: 'Uses macFUSE, which is installed on this Mac.' };
    return {
      ready: false,
      title: 'Needs a file-system helper',
      detail: 'This rclone cannot use the Mac’s built-in file sharing, and macFUSE is not installed. macOS 15.4 added its own kit for this; Keeper does not use it yet.',
      steps: ['Install macFUSE (free) from its website.', 'On a Mac with Apple silicon, allow its system extension when macOS asks (it may need Recovery).', 'Come back and open the drive again.'],
      link: { label: 'macFUSE', url: 'https://macfuse.github.io/' },
    };
  }
  if (f.platform === 'win32') {
    if (!f.winfsp) {
      return {
        ready: false,
        title: 'Needs WinFsp',
        detail: 'Windows needs the free WinFsp helper to show a connection as a drive letter. Keeper does not install it.',
        steps: ['Install WinFsp (free) from its website.', 'Come back and open the drive again.'],
        link: { label: 'WinFsp', url: 'https://winfsp.dev/' },
      };
    }
    if (known && !has(f, 'cmount') && !has(f, 'mount')) return { ready: false, title: 'This rclone cannot make drives', detail: 'It was built without drive support.', steps: ['Reinstall Keeper to get the rclone it ships with.'] };
    return { ready: true, mountType: has(f, 'cmount') || !known ? 'cmount' : 'mount', title: 'Ready', detail: 'Uses WinFsp, which is installed on this PC.' };
  }
  if (!f.fuse) {
    return {
      ready: false,
      title: 'Needs FUSE 3',
      detail: 'Linux needs FUSE 3 to show a connection as a folder every app can use.',
      steps: ['Install the fuse3 package with your package manager (for example: sudo apt install fuse3).', 'Come back and open the drive again.'],
    };
  }
  if (known && !has(f, 'mount') && !has(f, 'cmount')) return { ready: false, title: 'This rclone cannot make drives', detail: 'It was built without drive support.', steps: ['Install rclone from your package manager, or reinstall Keeper.'] };
  return { ready: true, mountType: has(f, 'mount') || !known ? 'mount' : 'cmount', title: 'Ready', detail: 'Uses FUSE 3, which is on this computer.' };
}

/** "darwin 24.4.0" → macOS [15, 4] (Darwin 20 was macOS 11). */
export function macVersionFromDarwin(release: string): [number, number] | undefined {
  const m = /^(\d+)\.(\d+)/.exec(release);
  if (!m) return undefined;
  const major = Number(m[1]);
  return major >= 20 ? [major - 9, Number(m[2])] : undefined;
}

// ---------------------------------------------------------------- which connections

/** Whether a connection can be opened as a drive, and why not when it cannot. */
export function driveFor(c: Connection): { ok: true } | { ok: false; why: string } {
  switch (c.kind) {
    case 'rclone':
      return { ok: true };
    case 'webdav':
      if (c.insecure) return { ok: false, why: 'This server’s certificate is self-signed, which a drive cannot check.' };
      return { ok: true };
    case 'smb':
      return { ok: false, why: c.mountPath ? 'Shared folders are already a drive, made by the system.' : 'Shared folders become a drive when you connect them.' };
    case 'sftp':
      return { ok: false, why: 'Keeper checks an SFTP server’s key itself, and a drive could not.' };
    case 'ftp':
      return { ok: false, why: 'FTP is not offered as a drive.' };
  }
}

/** rclone's remote for a connection: the named cloud remote, or a WebDAV one made on the spot (never written to disk). */
export function driveRemote(c: Connection, remoteName: string, obscuredPass?: string): string {
  const root = onServer(c.root, '/').replace(/^\/+/, '');
  if (c.kind === 'rclone') return `${remoteName}:${root}`;
  if (c.kind === 'webdav') {
    const scheme = c.secure ? 'https' : 'http';
    const port = c.port ? `:${c.port}` : '';
    const url = `${scheme}://${c.host ?? ''}${port}${normalizeRemote(c.root ?? '/') === '/' ? '' : normalizeRemote(c.root ?? '/')}`;
    const opts = [`url=${quoteOpt(url)}`, ...(c.user ? [`user=${quoteOpt(c.user)}`] : []), ...(obscuredPass ? [`pass=${quoteOpt(obscuredPass)}`] : []), ...(/remote\.php\/(dav|webdav)/.test(c.root ?? '') ? ['vendor=nextcloud'] : ['vendor=other'])];
    return `:webdav,${opts.join(',')}:`;
  }
  throw new Error('This connection cannot be a drive');
}

/** A value in an rclone connection string: quoted when it holds a comma, a colon or a quote (quotes doubled). */
export function quoteOpt(v: string): string {
  return /[,:"'=]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------- where it goes

/** A folder name that is safe on every system. */
export function driveFolderName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return clean || 'Drive';
}

/**
 * Where a drive shows: a drive letter on Windows (from Z: down, skipping the
 * ones in use), a folder in "Keeper Drives" in the home folder elsewhere
 * (with a number when the name is taken by another drive).
 */
export function drivePlace(platform: NodeJS.Platform, home: string, name: string, used: string[]): string {
  if (platform === 'win32') {
    const taken = new Set(used.map((u) => u.slice(0, 1).toUpperCase()));
    for (let c = 'Z'.charCodeAt(0); c >= 'D'.charCodeAt(0); c--) {
      const l = String.fromCharCode(c);
      if (!taken.has(l)) return `${l}:`;
    }
    throw new Error('Every drive letter is in use');
  }
  const base = `${home.replace(/\/+$/, '')}/Keeper Drives/${driveFolderName(name)}`;
  let p = base;
  for (let i = 2; used.includes(p); i++) p = `${base} ${i}`;
  return p;
}

// ---------------------------------------------------------------- what rclone is asked

export interface DriveOptions {
  /** keep opened files on this computer, so they open again without the network */
  keepOpened: boolean;
  /** the most the cache may take, in GB */
  cacheGb: number;
}

/** The parameters for rclone's `mount/mount`. */
export function mountParams(fs: string, mountPoint: string, mountType: string, volumeName: string, o: DriveOptions): Record<string, unknown> {
  return {
    fs,
    mountPoint,
    mountType,
    vfsOpt: {
      // full: what is opened stays in the cache; writes: only changes wait there until they are sent.
      CacheMode: o.keepOpened ? 'full' : 'writes',
      CacheMaxSize: `${Math.max(1, Math.round(o.cacheGb))}G`,
      CacheMaxAge: '720h',
      // Changes are sent a few seconds after the file is closed, so an app saving twice sends once.
      WriteBack: '5s',
      DirCacheTime: '1m',
    },
    mountOpt: { VolumeName: volumeName, NoAppleDouble: true, NoAppleXattr: true },
  };
}

// ---------------------------------------------------------------- how a drive is doing

export type DriveState = 'ready' | 'sending' | 'waiting' | 'full';

export interface DriveStatus {
  state: DriveState;
  /** changes still to send (being sent plus waiting) */
  pending: number;
  /** files that could not be sent; rclone keeps trying */
  errored: number;
  /** what the cache holds now, in bytes */
  cached: number;
}

/** From rclone's `vfs/stats`; `offline` when the connection cannot be reached. */
export function driveStatus(stats: unknown, offline = false): DriveStatus {
  const d = ((stats as { diskCache?: Record<string, unknown> } | null)?.diskCache ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  const pending = n('uploadsInProgress') + n('uploadsQueued');
  const errored = n('erroredFiles');
  const cached = n('bytesUsed');
  const state: DriveState = d.outOfSpace === true ? 'full' : (offline || errored) && pending ? 'waiting' : pending ? 'sending' : 'ready';
  return { state, pending, errored, cached };
}

/** The status in a few words: "Sending 3 changes", "Offline · 2 changes wait". */
export function driveStatusText(s: DriveStatus): string {
  const ch = (k: number) => `${k} change${k === 1 ? '' : 's'}`;
  switch (s.state) {
    case 'sending': return `Sending ${ch(s.pending)}`;
    case 'waiting': return `Can’t reach it · ${ch(s.pending)} ${s.pending === 1 ? 'waits' : 'wait'}`;
    case 'full': return 'This computer’s disk is full';
    default: return 'Up to date';
  }
}
