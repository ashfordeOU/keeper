// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sample Cloud & servers for the browser demo: Google Drive, a home server on
// the network, a Nextcloud and a NAS over SFTP.

import type { FoundDevice, RemoteApi } from '../core/api-remote';
import { classifyDevice } from '../core/remote/lan';
import { normalizeRemote } from '../core/remote/paths';
import { formFor, providerCatalog } from '../core/remote/providers';
import type { Connection, ConnStatus, RemoteEntry } from '../core/remote/types';
import providersJson from '../test/fixtures/rclone-providers.json';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;

export function mockRemote(): { remote: RemoteApi } {
  const now = Date.now();
  let connections: Connection[] = [
    { id: 'gdrive', name: 'Google Drive', kind: 'rclone', provider: 'drive', device: 'cloud', createdAt: now - 40 * DAY },
    { id: 'umbrel', name: 'umbrel', kind: 'smb', host: 'umbrel.local', root: 'umbrel', device: 'home-server', createdAt: now - 10 * DAY },
    { id: 'cloud', name: 'Nextcloud', kind: 'webdav', host: 'cloud.example.org', secure: true, root: '/remote.php/dav/files/demo', user: 'demo', device: 'server', createdAt: now - 20 * DAY, offline: ['/Documents'] },
    { id: 'nas', name: 'Studio NAS', kind: 'sftp', host: 'nas.local', user: 'demo', device: 'nas', createdAt: now - 5 * DAY },
  ];
  const status: Record<string, ConnStatus> = {
    gdrive: { id: 'gdrive', state: 'connected', quota: { total: 2048 * GB, used: 731 * GB, free: 1317 * GB }, checkedAt: now - 60_000 },
    umbrel: { id: 'umbrel', state: 'idle' },
    cloud: { id: 'cloud', state: 'needs-sign-in', message: 'Sign in again to keep using this connection.', checkedAt: now - 3600_000 },
    nas: { id: 'nas', state: 'connected', quota: { total: 16_000 * GB, used: 9_420 * GB, free: 6_580 * GB } },
  };
  const f = (name: string, size: number, ago: number): Omit<RemoteEntry, 'path'> => ({ name, isDir: false, size, mtime: now - ago });
  const d = (name: string, ago = DAY): Omit<RemoteEntry, 'path'> => ({ name, isDir: true, size: 0, mtime: now - ago });
  const trees: Record<string, Record<string, Omit<RemoteEntry, 'path'>[]>> = {
    gdrive: {
      '/': [d('Documents'), d('Photos', 2 * DAY), d('Shared with me', 9 * DAY), d('Taxes 2026', 30 * DAY), f('Trip budget.xlsx', 48_000, 3 * 3600_000), f('Wedding playlist.m3u', 3_200, 5 * DAY), f('Logo final.png', 820_000, 2 * DAY)],
      '/Documents': [f('Lease agreement.pdf', 1.4 * MB, 60 * DAY), f('Resume 2026.docx', 92_000, 12 * DAY), f('Notes.md', 6_000, DAY)],
      '/Photos': [f('IMG_2041.HEIC', 3.1 * MB, 2 * DAY), f('IMG_2042.HEIC', 2.8 * MB, 2 * DAY), f('Beach.jpg', 4.4 * MB, 20 * DAY), f('Sunset.jpg', 3.9 * MB, 21 * DAY), f('Clip.mov', 88 * MB, 22 * DAY)],
    },
    cloud: { '/': [d('Documents'), d('Photos'), f('Readme.md', 1_200, 90 * DAY)], '/Documents': [f('Invoice 0412.pdf', 210_000, 4 * DAY)] },
    nas: {
      '/': [d('Media'), d('Backups'), d('USB Seagate 4TB (external)'), f('nas-notes.txt', 900, 40 * DAY)],
      '/Media': [d('Movies'), d('Music'), d('TV')],
      '/Backups': [f('macbook-2026-10-30.sparsebundle', 182 * GB, DAY)],
      '/USB Seagate 4TB (external)': [d('Camera dumps'), f('old-laptop.img', 240 * GB, 200 * DAY)],
    },
  };
  const list = (id: string, dir: string): RemoteEntry[] =>
    (trees[id]?.[normalizeRemote(dir)] ?? []).map((e) => ({ ...e, path: normalizeRemote(`${dir}/${e.name}`) }));
  const devices: FoundDevice[] = ([
    { name: 'umbrel', host: 'umbrel.local', address: '192.168.0.40', protocols: ['smb', 'http'], webTitle: 'umbrelOS' },
    { name: 'DiskStation', host: 'DiskStation.local', address: '192.168.0.252', protocols: ['smb', 'afp', 'sftp', 'webdavs'], txt: { model: 'DS923+' } },
    { name: 'Ana’s Mac mini', host: 'Anas-Mac-mini.local', address: '192.168.0.31', protocols: ['smb'], txt: { model: 'Macmini9,1' } },
    { name: 'DESKTOP-7Q2LM0K', host: 'DESKTOP-7Q2LM0K', protocols: ['smb'] },
    { name: 'homelab', host: 'homelab.local', address: '192.168.0.12', protocols: ['ssh'], txt: {} },
  ] as FoundDevice[]).map((x) => ({ ...x, guess: classifyDevice(x) }));
  const drives = new Map<string, import('../core/api-remote').OpenDriveInfo>();
  const wait = <T>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));

  return {
    remote: {
      list: async () => ({ connections, status: connections.map((c) => status[c.id] ?? { id: c.id, state: 'idle' }) }),
      cloudAvailable: async () => true,
      providers: async () => providerCatalog(providersJson),
      providerForm: async (prefix, sub) => formFor(providersJson, prefix, sub),
      signIn: async () => wait({ id: `new${Date.now() % 1000}` }, 1200),
      cancelSignIn: async () => undefined,
      test: async (input) => wait(input.host?.includes('nope') ? { ok: false, message: 'Can’t reach it right now.' } : { ok: true, entries: 7 }, 700),
      save: async (input) => {
        const c: Connection = { ...input, id: input.id ?? `c${Date.now() % 100000}`, name: input.name || input.host || 'Connection', createdAt: Date.now() };
        connections = [...connections.filter((x) => x.id !== c.id), c];
        status[c.id] = { id: c.id, state: 'connected' };
        return { connection: c, remembered: true };
      },
      remove: async (id) => void (connections = connections.filter((c) => c.id !== id)),
      check: async (id) => wait(status[id] ?? { id, state: 'connected' }),
      quota: async (id) => status[id]?.quota,
      listDir: async (id, dir) => {
        const c = connections.find((x) => x.id === id);
        return wait(list(id, dir).map((e) => ({ ...e, offline: c?.offline?.some((o) => e.path.startsWith(o)) || undefined })), 250);
      },
      mkdir: async (id, dir, name) => void (trees[id] ??= {})[normalizeRemote(dir)]?.push(d(name, 0)),
      rename: async () => undefined,
      removeEntries: async (_id, items) => ({ removed: items.length, failed: [] }),
      thumbnail: async () => null,
      open: async (_id, e) => `/tmp/${e.name}`,
      preview: async (_id, e) => `/tmp/${e.name}`,
      uploadPick: async () => wait({ done: 2, failed: [] }, 900),
      upload: async (_id, _dir, paths) => ({ done: paths.length, failed: [] }),
      download: async (_id, entries) => wait({ done: entries.length, failed: [], folder: '/Users/demo/Downloads' }, 800),
      transfers: async () => [],
      cancelTransfer: async () => undefined,
      setOffline: async (id, p, on) => {
        const c = connections.find((x) => x.id === id);
        if (c) c.offline = on ? [...(c.offline ?? []), p] : (c.offline ?? []).filter((x) => x !== p);
        return on ? `/Users/demo/Keeper Offline/${c?.name}${p}` : null;
      },
      search: async (q) => (q.toLowerCase().includes('beach') ? [{ id: 'gdrive', name: 'Google Drive', entry: { ...f('Beach.jpg', 4.4 * MB, 20 * DAY), path: '/Photos/Beach.jpg' } }] : []),
      startDrag: async () => undefined,
      scanLan: async () => wait(devices, 1200),
      shares: async (host) => wait(host.startsWith('umbrel') || host === '192.168.0.40'
        ? { shares: [{ name: 'umbrel', comment: 'umbrelOS files' }, { name: 'Seagate Expansion', comment: 'External drive', external: true }] }
        : host.startsWith('DiskStation') || host === '192.168.0.252' ? { shares: [{ name: 'Media' }, { name: 'Backups' }, { name: 'usbshare1', comment: 'USB disk 1', external: true }] }
          : { shares: [{ name: 'Public' }, { name: 'Users' }] }, 600),
      mount: async (id) => ({ ok: true, path: `/Volumes/${connections.find((c) => c.id === id)?.root ?? 'Share'}` }),
      driveSupport: async () => ({ ready: true, mountType: 'nfsmount', title: 'Ready', detail: 'Uses the Mac’s built-in network file sharing. Nothing to install.' }),
      drives: async () => [...drives.values()],
      openDrive: async (id) => {
        const c = connections.find((x) => x.id === id);
        const d = { id, name: c?.name ?? 'Drive', place: `/Users/demo/Keeper Drives/${c?.name ?? 'Drive'}`, status: { state: 'ready' as const, pending: 0, errored: 0, cached: 0 } };
        drives.set(id, d);
        return d;
      },
      closeDrive: async (id) => { drives.delete(id); },
      showDrive: async () => undefined,
    },
  };
}
