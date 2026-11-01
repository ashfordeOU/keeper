// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sample Places for the browser demo: a Mac with iCloud and Proton Drive, a USB
// stick and a NAS at 192.168.0.252.

import type { PlacesApi, TrashItem } from '../core/api-places';
import type { DiscoveredServer, PlacesModel } from '../core/places';

const HOME = '/Users/demo';
const GB = 1024 ** 3;
const DAY = 86_400_000;

export function mockPlaces(): { places: PlacesApi } {
  const now = Date.now();
  let recent = ['smb://192.168.0.252/Media', 'afp://mac-mini.local'];
  let usb = true;
  let nas = true;
  let trash: TrashItem[] = [
    { id: `${HOME}/.Trash/Old budget.xlsx`, name: 'Old budget.xlsx', size: 420_000, isDir: false, original: `${HOME}/Documents/Old budget.xlsx`, deletedAt: now - 2 * 3600_000, volume: 'Macintosh HD' },
    { id: `${HOME}/.Trash/IMG_4102 (1).JPG`, name: 'IMG_4102 (1).JPG', size: 4.9 * 1024 * 1024, isDir: false, original: `${HOME}/Pictures/IMG_4102 (1).JPG`, deletedAt: now - DAY, volume: 'Macintosh HD' },
    { id: `${HOME}/.Trash/Zoom.pkg`, name: 'Zoom.pkg', size: 96 * 1024 * 1024, isDir: false, original: `${HOME}/Downloads/Zoom.pkg`, deletedAt: now - 3 * DAY, volume: 'Macintosh HD' },
    { id: `${HOME}/.Trash/old project`, name: 'old project', size: 38 * 1024 * 1024, isDir: true, deletedAt: now - 9 * DAY, volume: 'Macintosh HD' },
    { id: '/Volumes/KINGSTON/.Trashes/501/photo.png', name: 'photo.png', size: 1.2 * 1024 * 1024, isDir: false, deletedAt: now - 12 * DAY, volume: 'KINGSTON' },
  ];
  const model = (): PlacesModel => ({
    computerName: 'Demo’s MacBook Pro',
    home: HOME,
    favorites: [
      { id: 'fav:/Applications', name: 'Applications', path: '/Applications', kind: 'apps', icon: 'app' },
      ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'].map((n) => ({ id: `fav:${HOME}/${n}`, name: n, path: `${HOME}/${n}`, kind: 'folder' as const, icon: { Desktop: 'screenshot', Documents: 'document', Downloads: 'down', Pictures: 'image', Movies: 'video', Music: 'audio' }[n]! })),
      { id: `fav:${HOME}`, name: 'demo', path: HOME, kind: 'home', icon: 'home' },
      { id: `pin:${HOME}/Projects`, name: 'Projects', path: `${HOME}/Projects`, kind: 'folder', icon: 'folder' },
    ],
    cloud: [
      { id: 'cloud:icloud', name: 'iCloud Drive', path: `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`, kind: 'cloud', icon: 'cloud', provider: 'iCloud Drive' },
      { id: 'cloud:proton', name: 'Proton Drive', path: `${HOME}/Library/CloudStorage/ProtonDrive-demo@proton.me-folder`, kind: 'cloud', icon: 'cloud', provider: 'Proton Drive' },
    ],
    volumes: [
      { id: 'vol:/', name: 'Macintosh HD', path: '/', kind: 'volume', icon: 'archive', volume: 'internal', ejectable: false, total: 494 * GB, free: 61 * GB },
      ...(usb ? [{ id: 'vol:/Volumes/KINGSTON', name: 'KINGSTON', path: '/Volumes/KINGSTON', kind: 'volume' as const, icon: 'archive', volume: 'removable' as const, ejectable: true, total: 64 * GB, free: 22 * GB }] : []),
    ],
    network: nas ? [{ id: 'net:/Volumes/Media', name: 'Media on 192.168.0.252', path: '/Volumes/Media', kind: 'network', icon: 'globe', volume: 'network', ejectable: true, protocol: 'smb', server: '192.168.0.252', total: 4000 * GB, free: 1310 * GB }] : [],
    shared: { id: 'shared', name: 'Shared', path: `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`, kind: 'shared', icon: 'island' },
    airdrop: true,
  });
  const servers: DiscoveredServer[] = [
    { name: 'Living Room NAS', host: 'nas.local', address: '192.168.0.252', port: 445, protocols: ['smb', 'afp'] },
    { name: 'mac-mini', host: 'mac-mini.local', address: '192.168.0.31', protocols: ['smb', 'sftp'] },
    { name: 'printer-scans', host: 'brother.local', address: '192.168.0.60', protocols: ['webdav'] },
  ];
  const wait = <T>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  return {
    places: {
      list: async () => model(),
      eject: async (p) => {
        if (p === '/Volumes/KINGSTON') usb = false;
        if (p === '/Volumes/Media') nas = false;
        return wait({ ok: true }, 500);
      },
      connect: async (req) => {
        nas = true;
        if (!recent.includes(req.address)) recent = [req.address, ...recent];
        return wait({ ok: true, path: '/Volumes/Media' }, 900);
      },
      discover: async () => wait(servers, 1500),
      recentServers: async () => recent,
      forgetServer: async (a) => (recent = recent.filter((x) => x !== a)),
      folderSize: async () => wait({ size: 18.4 * GB, files: 12_400, folders: 830 }, 700),
      openAirDrop: async () => undefined,
      shareTargets: async () => [{ id: 'system', name: 'Share…', kind: 'system' }, { id: 'airdrop', name: 'AirDrop', kind: 'airdrop' }],
      share: async () => ({ ok: true }),
      trash: {
        list: async () => wait({ items: trash, canRestore: true }),
        restore: async (ids) => {
          trash = trash.filter((t) => !ids.includes(t.id));
          return { restored: ids.length, failed: [] };
        },
        remove: async (ids) => {
          trash = trash.filter((t) => !ids.includes(t.id));
          return { removed: ids.length, failed: [] };
        },
        empty: async () => {
          trash = [];
          return { ok: true };
        },
      },
    },
  };
}
