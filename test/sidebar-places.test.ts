// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { classifyMounts, detectCloud, favoriteFolders, type Place, type PlacesModel } from '../core/places';
import { buildSidebarPlaces, desktopOf, finderTagColor, parseGtkBookmarks, parseKdePlaces, reconnectAddress, rememberServers, sameServer, type SidebarGroup } from '../core/sidebar-places';

const labels = (g: SidebarGroup[]) => Object.fromEntries(g.map((x) => [x.id, x.rows.map((r) => r.label)]));
const titles = (g: SidebarGroup[]) => g.map((x) => x.title ?? '');

// ---------------------------------------------------------------- a Mac
const macHome = '/Users/ana';
const macCloud = detectCloud({
  platform: 'darwin', home: macHome, env: {},
  list: (d) => (d.endsWith('CloudStorage') ? ['ProtonDrive-ana@proton.me-folder', 'Dropbox', 'GoogleDrive-ana@gmail.com'] : []),
  exists: (p) => p.includes('com~apple~CloudDocs'),
});
const macDisks = classifyMounts('darwin', [
  { device: '/dev/disk3s1s1', mount: '/', fstype: 'apfs', options: ['local'] },
  { device: '/dev/disk5s1', mount: '/Volumes/Backup', fstype: 'apfs', options: ['local'] },
  { device: '/dev/disk6s1', mount: '/Volumes/STICK', fstype: 'msdos', options: [] },
  { device: '//guest@192.168.0.252/Media', mount: '/Volumes/Media', fstype: 'smbfs', options: [] },
], { labels: new Map([['/', 'Macintosh HD']]) });
const mac: PlacesModel = {
  computerName: 'Ana’s MacBook Air', home: macHome,
  favorites: [...favoriteFolders('darwin', macHome, () => true), { id: 'pin:/Users/ana/Work', name: 'Work', path: '/Users/ana/Work', kind: 'folder', icon: 'folder' }],
  cloud: macCloud, volumes: macDisks.volumes.map((v) => ({ ...v, total: 500, free: 100 })), network: macDisks.network,
  shared: { id: 'shared', name: 'Shared', path: '/Users/ana/Library/Mobile Documents/com~apple~CloudDocs', kind: 'shared', icon: 'island' },
  airdrop: true,
};

describe('on a Mac: Finder’s sidebar', () => {
  const g = buildSidebarPlaces({ platform: 'darwin', model: mac, tags: ['Red', 'Work', 'Blue'] });
  it('Recents and Shared; Favorites; Locations; Tags, in Finder’s order', () => {
    expect(titles(g)).toEqual(['', 'Favorites', 'Locations', 'Tags']);
    const l = labels(g);
    expect(l.top).toEqual(['Home', 'Recents', 'Shared']);
    expect(l.favorites).toEqual(['Applications', 'Downloads', 'Movies', 'Music', 'Pictures', 'Desktop', 'Documents', 'Trash', 'Work']);
    expect(l.locations).toEqual(['iCloud Drive', 'Dropbox', 'Google Drive (ana@gmail.com)', 'Proton Drive (ana@proton.me)', 'ana', 'Ana’s MacBook Air', 'Backup', 'STICK', 'AirDrop', 'Media on 192.168.0.252', 'Network']);
    expect(l.tags).toEqual(['Red', 'Work', 'Blue']);
  });
  it('the computer stands for the system disk (with its free space); other disks and servers can be ejected', () => {
    const loc = g.find((x) => x.id === 'locations')!.rows;
    const me = loc.find((r) => r.label === 'Ana’s MacBook Air')!;
    expect(me.place).toMatchObject({ path: '/', total: 500, free: 100 });
    expect(loc.find((r) => r.label === 'STICK')).toMatchObject({ icon: 'usb', place: { ejectable: true } });
    expect(loc.find((r) => r.label === 'Media on 192.168.0.252')).toMatchObject({ icon: 'server', place: { ejectable: true, server: '192.168.0.252' } });
    expect(loc.find((r) => r.label === 'AirDrop')?.airdrop).toBe(true);
    expect(loc.find((r) => r.label === 'ana')?.place?.path).toBe('/Users/ana');
  });
  it('Finder’s tag colours, grey for the person’s own', () => {
    const tags = g.find((x) => x.id === 'tags')!.rows;
    expect(tags[0]).toMatchObject({ color: '#ff4f4f', route: { name: 'tag', arg: 'Red' } });
    expect(finderTagColor('Work')).toBe('var(--text-3)');
    expect(finderTagColor(' blue ')).toBe('#0a84ff');
  });
  it('no Tags section without tags, no Shared without iCloud Drive', () => {
    const plain = buildSidebarPlaces({ platform: 'darwin', model: { ...mac, shared: undefined } });
    expect(titles(plain)).toEqual(['', 'Favorites', 'Locations']);
    expect(labels(plain).top).toEqual(['Home', 'Recents']);
  });
});

// ---------------------------------------------------------------- Windows
const winHome = 'C:\\Users\\Ana';
const win: PlacesModel = {
  computerName: 'DESKTOP-1', home: winHome,
  favorites: favoriteFolders('win32', winHome, () => true),
  cloud: detectCloud({ platform: 'win32', home: winHome, env: { OneDrive: 'C:\\Users\\Ana\\OneDrive' }, list: () => [], exists: (p) => /OneDrive$|Dropbox$/.test(p) }),
  volumes: [
    { id: 'vol:C:\\', name: 'Windows (C:)', path: 'C:\\', kind: 'volume', icon: 'archive', volume: 'internal', total: 1000, free: 400 },
    { id: 'vol:E:\\', name: 'USB (E:)', path: 'E:\\', kind: 'volume', icon: 'archive', volume: 'removable', ejectable: true, total: 64, free: 60 },
  ],
  network: [{ id: 'net:Z:\\', name: 'Media on nas (Z:)', path: 'Z:\\', kind: 'network', icon: 'globe', volume: 'network', ejectable: true, protocol: 'smb', server: 'nas' }],
  airdrop: false,
};

describe('on Windows: File Explorer’s navigation pane', () => {
  const g = buildSidebarPlaces({ platform: 'win32', model: win });
  it('Home, Gallery, OneDrive and other clouds; Quick access; This PC with every drive; Network; Recycle Bin', () => {
    expect(titles(g)).toEqual(['', 'Quick access', 'This PC']);
    const l = labels(g);
    expect(l.top).toEqual(['Home', 'Gallery', 'OneDrive', 'Dropbox']);
    expect(l.quick).toEqual(['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos']);
    expect(l.locations).toEqual(['This PC', 'Windows (C:)', 'USB (E:)', 'Media on nas (Z:)', 'Network', 'Recycle Bin']);
  });
  it('Gallery is every picture; drives show their free space', () => {
    expect(g[0].rows[1].route).toEqual({ name: 'library', arg: 'image' });
    const c = g.find((x) => x.id === 'locations')!.rows.find((r) => r.label === 'Windows (C:)')!;
    expect(c.place).toMatchObject({ total: 1000, free: 400 });
    expect(g.find((x) => x.id === 'locations')!.rows[0].place).toMatchObject({ path: 'C:\\', free: 400 });
  });
});

// ---------------------------------------------------------------- Linux
const lxHome = '/home/ana';
const lxDisks = classifyMounts('linux', [
  { device: '/dev/nvme0n1p2', mount: '/', fstype: 'ext4', options: [] },
  { device: '/dev/sdb1', mount: '/media/ana/STICK', fstype: 'vfat', options: [] },
  { device: '//nas/media', mount: '/mnt/media', fstype: 'cifs', options: [] },
]);
const linux: PlacesModel = {
  computerName: 'thinkpad', home: lxHome,
  favorites: favoriteFolders('linux', lxHome, () => true),
  cloud: [], volumes: lxDisks.volumes, network: lxDisks.network, airdrop: false,
  bookmarks: parseGtkBookmarks('file:///home/ana/Projects Projects\nfile:///home/ana/My%20Books\nsftp://host/x Remote\n'),
};

describe('on Linux: GNOME Files and Dolphin', () => {
  it('GNOME: Recent, Starred, Home, the folders, Trash and bookmarks; then Other Locations', () => {
    const g = buildSidebarPlaces({ platform: 'linux', model: linux, desktop: 'gnome' });
    expect(titles(g)).toEqual(['', 'Other Locations']);
    const l = labels(g);
    expect(l.top).toEqual(['Home', 'Recent', 'Starred', 'Home Folder', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Trash', 'Projects', 'My Books']);
    expect(l.locations).toEqual(['thinkpad', 'STICK', 'media on nas', 'Network']);
    expect(g[0].rows.find((r) => r.label === 'Starred')?.route).toEqual({ name: 'tag', arg: 'Starred' });
  });
  it('KDE: Places, Remote and Devices', () => {
    const g = buildSidebarPlaces({ platform: 'linux', model: linux, desktop: 'kde' });
    expect(titles(g)).toEqual(['', 'Places', 'Remote', 'Devices']);
    const l = labels(g);
    expect(l.top).toEqual(['Home', 'Recent Files']);
    expect(l.favorites).toEqual(['Home Folder', 'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Trash', 'Projects', 'My Books']);
    expect(l.remote).toEqual(['Network', 'media on nas']);
    expect(l.locations).toEqual(['thinkpad', 'STICK']);
  });
  it('knows the desktop from the environment', () => {
    expect(desktopOf({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe('kde');
    expect(desktopOf({ DESKTOP_SESSION: 'plasmawayland' })).toBe('kde');
    expect(desktopOf({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('gnome');
    expect(desktopOf({})).toBe('gnome');
  });
  it('reads GNOME bookmarks (folders on this computer only) and Dolphin’s own places', () => {
    expect(linux.bookmarks!.map((b) => [b.name, b.path])).toEqual([['Projects', '/home/ana/Projects'], ['My Books', '/home/ana/My Books']]);
    const xbel = `<?xml version="1.0"?><xbel>
      <bookmark href="file:///home/ana"><title>Home</title><info><metadata><isSystemItem>true</isSystemItem></metadata></info></bookmark>
      <bookmark href="file:///home/ana/Photos%202026"><title>Photos &amp; more</title></bookmark>
      <bookmark href="file:///home/ana/Old"><title>Old</title><info><metadata><IsHidden>true</IsHidden></metadata></info></bookmark>
      <bookmark href="remote:/"><title>Network</title></bookmark>
    </xbel>`;
    expect(parseKdePlaces(xbel, '/home/ana').map((b) => [b.name, b.path])).toEqual([['Photos & more', '/home/ana/Photos 2026']]);
  });
});

// ---------------------------------------------------------------- servers that drop
describe('servers that drop stay listed as offline', () => {
  const media: Place = { id: 'net:/Volumes/Media', name: 'Media on 192.168.0.252', path: '/Volumes/Media', kind: 'network', icon: 'globe', volume: 'network', ejectable: true, protocol: 'smb', server: '192.168.0.252' };
  it('remembers servers seen, keeps them when they go, forgets none twice', () => {
    const seen = rememberServers([media], []);
    expect(seen).toHaveLength(1);
    expect(rememberServers([], seen)).toEqual(seen);
    expect(rememberServers([{ ...media, id: 'net:/Volumes/Media-1', path: '/Volumes/Media-1' }], seen)).toHaveLength(1);
    expect(rememberServers([], Array.from({ length: 12 }, (_, i) => ({ ...media, id: `n${i}`, name: `S${i}`, server: `h${i}` })))).toHaveLength(8);
  });
  it('shows a dropped server dimmed in Locations, and connects to it again by its address', () => {
    const g = buildSidebarPlaces({ platform: 'darwin', model: { ...mac, network: [] }, offline: [media] });
    const row = g.find((x) => x.id === 'locations')!.rows.find((r) => r.offline)!;
    expect(row).toMatchObject({ label: 'Media on 192.168.0.252', offline: true });
    expect(reconnectAddress(media)).toBe('smb://192.168.0.252/Media');
    // Back again: listed once, connected.
    const back = buildSidebarPlaces({ platform: 'darwin', model: mac, offline: [media] }).find((x) => x.id === 'locations')!.rows.filter((r) => r.label === 'Media on 192.168.0.252');
    expect(back).toHaveLength(1);
    expect(back[0].offline).toBeUndefined();
    expect(sameServer(media, { ...media, id: 'other' })).toBe(true);
  });
});
