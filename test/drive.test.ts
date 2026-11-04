// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Connections as drives (core/remote/drive.ts): what each computer needs, which connections
// can be drives, where they go, what rclone is asked and how a drive is doing.
import { describe, expect, it } from 'vitest';
import { driveFolderName, driveFor, drivePlace, driveRemote, driveStatus, driveStatusText, driveSupport, macVersionFromDarwin, mountParams, quoteOpt, type DriveFacts } from '../core/remote/drive';
import type { Connection } from '../core/remote/types';

const facts = (p: Partial<DriveFacts>): DriveFacts => ({ platform: 'linux', rclone: true, types: ['mount'], ...p });
const conn = (p: Partial<Connection>): Connection => ({ id: 'c1', name: 'Studio NAS', kind: 'rclone', createdAt: 0, ...p });

describe('what this computer needs', () => {
  it('Linux: ready with FUSE 3, says how to get it otherwise', () => {
    expect(driveSupport(facts({ fuse: true }))).toMatchObject({ ready: true, mountType: 'mount' });
    const no = driveSupport(facts({ fuse: false }));
    expect(no.ready).toBe(false);
    expect(no.title).toBe('Needs FUSE 3');
    expect(no.steps?.[0]).toMatch(/fuse3/);
  });

  it('a Mac uses its own network file sharing first, then macFUSE, and never pretends', () => {
    expect(driveSupport(facts({ platform: 'darwin', types: ['nfsmount', 'mount'] }))).toMatchObject({ ready: true, mountType: 'nfsmount' });
    expect(driveSupport(facts({ platform: 'darwin', types: ['cmount'], macfuse: true }))).toMatchObject({ ready: true, mountType: 'cmount' });
    const none = driveSupport(facts({ platform: 'darwin', types: ['mount'], macfuse: false }));
    expect(none.ready).toBe(false);
    expect(none.link?.url).toMatch(/macfuse/);
    expect(none.detail).toMatch(/15\.4/);
  });

  it('Windows needs WinFsp and gets a drive letter', () => {
    expect(driveSupport(facts({ platform: 'win32', types: ['cmount'], winfsp: false }))).toMatchObject({ ready: false, title: 'Needs WinFsp' });
    expect(driveSupport(facts({ platform: 'win32', types: ['cmount'], winfsp: true }))).toMatchObject({ ready: true, mountType: 'cmount' });
    expect(driveSupport(facts({ platform: 'win32', types: ['nfsmount'], winfsp: true })).ready).toBe(false);
  });

  it('without rclone, or in a sandbox, nothing is offered', () => {
    expect(driveSupport(facts({ rclone: false, fuse: true })).title).toBe('Needs the rclone program');
    expect(driveSupport(facts({ sandboxed: true, fuse: true })).ready).toBe(false);
  });

  it('reads the macOS version from Darwin’s', () => {
    expect(macVersionFromDarwin('24.4.0')).toEqual([15, 4]);
    expect(macVersionFromDarwin('25.0.0')).toEqual([16, 0]);
    expect(macVersionFromDarwin('19.6.0')).toBeUndefined();
  });
});

describe('which connections', () => {
  it('cloud services and WebDAV can; the rest say why not', () => {
    expect(driveFor(conn({ kind: 'rclone' })).ok).toBe(true);
    expect(driveFor(conn({ kind: 'webdav' })).ok).toBe(true);
    for (const kind of ['sftp', 'ftp', 'smb'] as const) {
      const r = driveFor(conn({ kind }));
      expect(r.ok, kind).toBe(false);
      if (!r.ok) expect(r.why.length).toBeGreaterThan(10);
    }
    expect(driveFor(conn({ kind: 'webdav', insecure: true })).ok).toBe(false);
  });

  it('a cloud drive is its named remote; WebDAV is made on the spot with the scrambled password', () => {
    expect(driveRemote(conn({ kind: 'rclone', root: '/Photos' }), 'keeper-c1')).toBe('keeper-c1:Photos');
    expect(driveRemote(conn({ kind: 'rclone' }), 'keeper-c1')).toBe('keeper-c1:');
    const dav = driveRemote(conn({ kind: 'webdav', host: 'cloud.example.org', secure: true, root: '/remote.php/dav/files/ana', user: 'ana' }), 'x', 'OBSC');
    expect(dav).toBe(':webdav,url="https://cloud.example.org/remote.php/dav/files/ana",user=ana,pass=OBSC,vendor=nextcloud:');
    expect(driveRemote(conn({ kind: 'webdav', host: '127.0.0.1', port: 8080 }), 'x')).toBe(':webdav,url="http://127.0.0.1:8080",vendor=other:');
    expect(() => driveRemote(conn({ kind: 'sftp' }), 'x')).toThrow();
    expect(quoteOpt('a,b"c')).toBe('"a,b""c"');
    expect(quoteOpt('plain')).toBe('plain');
  });
});

describe('where it goes and what rclone is asked', () => {
  it('a folder in Keeper Drives, or a free drive letter from Z: down', () => {
    expect(drivePlace('linux', '/home/ana', 'Studio NAS', [])).toBe('/home/ana/Keeper Drives/Studio NAS');
    expect(drivePlace('darwin', '/Users/ana', 'Team: Drive?', ['/Users/ana/Keeper Drives/Team Drive'])).toBe('/Users/ana/Keeper Drives/Team Drive 2');
    expect(drivePlace('win32', 'C:\\Users\\ana', 'x', ['C:', 'Z:', 'Y:'])).toBe('X:');
    expect(() => drivePlace('win32', '', 'x', 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:`))).toThrow();
    expect(driveFolderName(' .. ')).toBe('Drive');
  });

  it('keeps opened files or only changes, within the cache size', () => {
    const p = mountParams('keeper-c1:', '/m', 'mount', 'Studio NAS', { keepOpened: true, cacheGb: 5 }) as { vfsOpt: Record<string, string>; mountOpt: Record<string, unknown> };
    expect(p.vfsOpt.CacheMode).toBe('full');
    expect(p.vfsOpt.CacheMaxSize).toBe('5G');
    expect(p.mountOpt.VolumeName).toBe('Studio NAS');
    expect((mountParams('f', '/m', 'mount', 'n', { keepOpened: false, cacheGb: 0 }) as { vfsOpt: Record<string, string> }).vfsOpt).toMatchObject({ CacheMode: 'writes', CacheMaxSize: '1G' });
  });
});

describe('how a drive is doing', () => {
  it('from rclone’s numbers, with the network', () => {
    expect(driveStatus(null)).toEqual({ state: 'ready', pending: 0, errored: 0, cached: 0 });
    const sending = driveStatus({ diskCache: { uploadsInProgress: 1, uploadsQueued: 2, bytesUsed: 900 } });
    expect(sending).toMatchObject({ state: 'sending', pending: 3, cached: 900 });
    expect(driveStatusText(sending)).toBe('Sending 3 changes');
    const waiting = driveStatus({ diskCache: { uploadsQueued: 1 } }, true);
    expect(driveStatusText(waiting)).toBe('Can’t reach it · 1 change waits');
    expect(driveStatus({ diskCache: { erroredFiles: 2, uploadsQueued: 2 } }).state).toBe('waiting');
    expect(driveStatus({ diskCache: { outOfSpace: true } }).state).toBe('full');
    expect(driveStatusText(driveStatus({}))).toBe('Up to date');
  });
});
