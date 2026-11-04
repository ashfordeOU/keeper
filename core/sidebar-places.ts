// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The sidebar's places, laid out like each system's own file manager so it
// feels at home: Finder's on a Mac (Recents, Shared; Favorites; Locations;
// Tags), File Explorer's on Windows (Home, Gallery, OneDrive; Quick access;
// This PC; Network; Recycle Bin) and GNOME Files' or Dolphin's on Linux
// (Recent, Starred, Home, the standard folders, Trash and bookmarks; Other
// Locations, or Places, Remote and Devices on KDE). Keeper's own Home (the
// front door) always comes first. Servers that dropped stay listed as offline
// until they come back or are forgotten. Plain functions so they are easy to test.

import { formatBytes } from './format';
import type { Place, PlacesModel } from './places';

export interface SidebarRow {
  /** stable key (also the row's data-nav-key) */
  key: string;
  label: string;
  icon: string;
  /** a Keeper page, a place (a folder, disk or server: browse it), or AirDrop */
  route?: { name: string; arg?: string };
  place?: Place;
  airdrop?: boolean;
  /** a server that was connected and is gone now */
  offline?: boolean;
  /** Finder tag colour */
  color?: string;
  /** the real name behind a friendly label (the user name behind Home, the computer's network name), for the tooltip */
  realName?: string;
}

export interface SidebarGroup {
  /** the NavSection id ('top' has no title and never folds) */
  id: string;
  title?: string;
  rows: SidebarRow[];
}

export type Desktop = 'gnome' | 'kde';

export interface SidebarInput {
  platform: string;
  model: PlacesModel;
  /** KDE (Dolphin's layout) or anything else (GNOME Files') on Linux */
  desktop?: Desktop;
  /** tags in use (Finder's on a Mac) */
  tags?: string[];
  /** servers seen before that are not connected now */
  offline?: Place[];
  /** Keeper's cloud and server connections go into Locations: the renderer adds them at this group's end */
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const page = (key: string, label: string, icon: string, route: { name: string; arg?: string }): SidebarRow => ({ key, label, icon, route });
const at = (p: Place, label = p.name, icon = p.icon): SidebarRow => ({ key: p.path || p.id, label, icon, place: p });

/** Finder's standard tag colours, by the tag's name (other tags are grey). */
const FINDER_COLORS: Record<string, string> = {
  red: '#ff4f4f', orange: '#ff9f0a', yellow: '#ffd60a', green: '#30d158', blue: '#0a84ff', purple: '#bf5af2', gray: '#98989d', grey: '#98989d',
};
export function finderTagColor(tag: string): string {
  return FINDER_COLORS[tag.trim().toLowerCase()] ?? 'var(--text-3)';
}

/** The standard folder named `name` (Desktop, Documents…) among the favourites, by its place in the home folder. */
function std(m: PlacesModel, name: string): Place | undefined {
  return m.favorites.find((f) => f.kind === 'folder' && !f.id.startsWith('pin:') && base(f.path) === name);
}
const pins = (m: PlacesModel) => m.favorites.filter((f) => f.id.startsWith('pin:'));
const homeOf = (m: PlacesModel): Place => m.favorites.find((f) => f.kind === 'home') ?? { id: `fav:${m.home}`, name: base(m.home) || 'Home', path: m.home, kind: 'home', icon: 'home' };
const pick = (m: PlacesModel, names: string[]) => names.map((n) => std(m, n)).filter((p): p is Place => !!p);

function trashRow(platform: string): SidebarRow {
  return page('trash', platform === 'win32' ? 'Recycle Bin' : 'Trash', 'trash', { name: 'trash' });
}
const networkRow = (): SidebarRow => page('network', 'Network', 'globe', { name: 'network' });

function diskIcon(p: Place): string {
  if (p.kind === 'network') return 'server';
  if (p.volume === 'removable') return 'usb';
  if (p.volume === 'image') return 'zip';
  return 'disk';
}

/** Connected servers, then the ones that dropped (dimmed, "offline"), without doubles. */
function servers(m: PlacesModel, offline: Place[] = []): SidebarRow[] {
  const live = m.network.map((p) => at(p, p.name, 'server'));
  const gone = offline.filter((o) => !m.network.some((n) => sameServer(n, o))).map((p) => ({ ...at(p, p.name, 'server'), key: `offline:${p.id}`, offline: true }));
  return [...live, ...gone];
}

/** Disks other than the system disk, which the computer's own row stands for (with its free space). */
function systemDisk(platform: string, m: PlacesModel): Place | undefined {
  return platform === 'win32' ? m.volumes.find((v) => /^c:\\?$/i.test(v.path)) ?? m.volumes[0] : m.volumes.find((v) => v.path === '/');
}
/**
 * The computer's row: a name a person recognises. A Mac's own name ("Ana’s MacBook Air") is
 * one; a bare network name ("vm", "DESKTOP-4F2K", "ana-thinkpad-t14") is not, so it becomes
 * "This Mac", "This PC" or "This Computer", with the network name in the tooltip.
 */
export function computerLabel(platform: string, computerName: string): string {
  if (platform === 'win32') return 'This PC';
  const n = computerName.trim();
  if (platform === 'darwin') return /[\s’']/.test(n) ? n : 'This Mac';
  return 'This Computer';
}

/**
 * How full a disk is, for its sidebar row: nothing to show until it is nearly full. Free space
 * appears on hover (quiet text, not a bar); below 10% free it stays in view, in amber, never red.
 */
export function placeCapacity(total: number | undefined, free: number | undefined): { freeText: string; low: boolean } | undefined {
  if (!total || free === undefined || total <= 0) return undefined;
  return { freeText: `${formatBytes(Math.max(0, free))} free`, low: free / total < 0.1 };
}

/** Home is always "Home"; the user name behind it goes in the tooltip. */
function homeRow(m: PlacesModel): SidebarRow {
  const h = homeOf(m);
  const real = base(m.home);
  return { ...at(h, 'Home', 'home'), ...(real && real !== 'Home' ? { realName: real } : {}) };
}

function computerRow(platform: string, m: PlacesModel): SidebarRow {
  const sys = systemDisk(platform, m);
  const root = platform === 'win32' ? sys?.path ?? 'C:\\' : '/';
  const name = computerLabel(platform, m.computerName);
  const row = at({ id: 'computer', name, path: root, kind: 'computer', icon: 'laptop', total: sys?.total, free: sys?.free }, name, 'laptop');
  return m.computerName && m.computerName !== name ? { ...row, realName: m.computerName } : row;
}
const otherDisks = (platform: string, m: PlacesModel) => {
  const sys = systemDisk(platform, m);
  // On Windows every drive is listed under This PC with its free space, C: included.
  return m.volumes.filter((v) => platform === 'win32' || v !== sys).map((v) => at(v, v.name, diskIcon(v)));
};

function mac(i: SidebarInput): SidebarGroup[] {
  const m = i.model;
  const apps = m.favorites.find((f) => f.kind === 'apps');
  const icloud = m.cloud.find((c) => c.provider === 'iCloud Drive');
  return [
    { id: 'top', rows: [page('home', 'Hello', 'home', { name: 'home' }), page('recents', 'Recents', 'clock', { name: 'recents' }), ...(m.shared ? [at(m.shared, 'Shared', 'island')] : [])] },
    {
      id: 'favorites', title: 'Favorites',
      rows: [...(apps ? [at(apps, 'Applications', 'app')] : []), ...pick(m, ['Downloads', 'Movies', 'Music', 'Pictures', 'Desktop', 'Documents']).map((p) => at(p)), trashRow('darwin'), ...pins(m).map((p) => at(p))],
    },
    {
      id: 'locations', title: 'Locations',
      rows: [
        ...(icloud ? [at(icloud, 'iCloud Drive', 'cloud')] : []),
        ...m.cloud.filter((c) => c !== icloud).map((c) => at(c, c.name, 'cloud')),
        homeRow(m),
        computerRow('darwin', m),
        ...otherDisks('darwin', m),
        ...(m.airdrop ? [{ key: 'airdrop', label: 'AirDrop', icon: 'airdrop', airdrop: true }] : []),
        ...servers(m, i.offline),
        networkRow(),
      ],
    },
    ...(i.tags?.length ? [{ id: 'tags', title: 'Tags', rows: i.tags.map((t) => ({ ...page(`tag:${t}`, t, 'tag', { name: 'tag', arg: t }), color: finderTagColor(t) })) }] : []),
  ];
}

function windows(i: SidebarInput): SidebarGroup[] {
  const m = i.model;
  const onedrive = m.cloud.find((c) => c.provider === 'OneDrive');
  return [
    // OneDrive, then other cloud drives (Dropbox, iCloud…), at the top level as File Explorer shows them.
    { id: 'top', rows: [page('home', 'Hello', 'home', { name: 'home' }), page('gallery', 'Gallery', 'image', { name: 'library', arg: 'image' }), ...(onedrive ? [at(onedrive, onedrive.name, 'cloud')] : []), ...m.cloud.filter((c) => c !== onedrive).map((c) => at(c, c.name, 'cloud'))] },
    { id: 'quick', title: 'Quick access', rows: [...pick(m, ['Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos']).map((p) => at(p)), ...pins(m).map((p) => at(p))] },
    {
      id: 'locations', title: 'This PC',
      rows: [computerRow('win32', m), ...otherDisks('win32', m), ...servers(m, i.offline), networkRow(), trashRow('win32')],
    },
  ];
}

function linux(i: SidebarInput): SidebarGroup[] {
  const m = i.model;
  const home = homeRow(m);
  const folders = pick(m, ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos']).map((p) => at(p));
  const marks = [...(m.bookmarks ?? []), ...pins(m)].filter((p, n, all) => all.findIndex((x) => x.path === p.path) === n).map((p) => at(p, p.name, 'folder'));
  const drives = [computerRow('linux', m), ...otherDisks('linux', m)];
  const clouds = m.cloud.map((c) => at(c, c.name, 'cloud'));
  if (i.desktop === 'kde') {
    return [
      { id: 'top', rows: [page('home', 'Hello', 'home', { name: 'home' }), page('recents', 'Recent Files', 'clock', { name: 'recents' })] },
      { id: 'favorites', title: 'Places', rows: [home, ...folders, trashRow('linux'), ...marks] },
      { id: 'remote', title: 'Remote', rows: [networkRow(), ...clouds, ...servers(m, i.offline)] },
      { id: 'locations', title: 'Devices', rows: drives },
    ];
  }
  // GNOME Files: Recent, Starred, Home and the folders in one list (Desktop is not among them), then Other Locations.
  return [
    {
      id: 'top',
      rows: [page('home', 'Hello', 'home', { name: 'home' }), page('recents', 'Recent', 'clock', { name: 'recents' }), page('starred', 'Starred', 'star', { name: 'tag', arg: 'Starred' }), home, ...folders.filter((r) => base(r.place!.path) !== 'Desktop'), trashRow('linux'), ...marks],
    },
    { id: 'locations', title: 'Other Locations', rows: [...clouds, ...drives, ...servers(m, i.offline), networkRow()] },
  ];
}

/** The sidebar's places for this system, in its file manager's order. */
export function buildSidebarPlaces(i: SidebarInput): SidebarGroup[] {
  if (i.platform === 'darwin') return mac(i);
  if (i.platform === 'win32') return windows(i);
  return linux(i);
}

/** "KDE" in XDG_CURRENT_DESKTOP (or DESKTOP_SESSION) means Dolphin's layout; anything else GNOME Files'. */
export function desktopOf(env: Record<string, string | undefined>): Desktop {
  const d = `${env.XDG_CURRENT_DESKTOP ?? ''}:${env.DESKTOP_SESSION ?? ''}`.toLowerCase();
  return /kde|plasma/.test(d) ? 'kde' : 'gnome';
}

// ---------------------------------------------------------------- bookmarks (Linux)

/** GNOME's ~/.config/gtk-3.0/bookmarks: "file:///home/ana/Work Work" per line (folders on this computer only). */
export function parseGtkBookmarks(text: string): Place[] {
  const out: Place[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^file:\/\/(\/\S*)(?:\s+(.+))?$/);
    if (!m) continue;
    let path: string;
    try { path = decodeURIComponent(m[1]); } catch { continue; }
    out.push({ id: `mark:${path}`, name: m[2]?.trim() || base(path) || path, path, kind: 'folder', icon: 'folder' });
  }
  return out;
}

const XML = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Dolphin's ~/.local/share/user-places.xbel: the person's own places. The
 * standard ones (home, trash, network, recent, search) and hidden ones are
 * left out, since the sidebar lists those anyway.
 */
export function parseKdePlaces(xml: string, home: string): Place[] {
  const out: Place[] = [];
  for (const b of xml.matchAll(/<bookmark\s+href="file:\/\/([^"]+)"[^>]*>([\s\S]*?)<\/bookmark>/g)) {
    if (/<IsHidden>true<\/IsHidden>/.test(b[2]) || /<isSystemItem>true<\/isSystemItem>/.test(b[2])) continue;
    let path: string;
    try { path = decodeURIComponent(XML(b[1])); } catch { continue; }
    if (path.replace(/\/$/, '') === home.replace(/\/$/, '')) continue;
    const title = b[2].match(/<title>([\s\S]*?)<\/title>/)?.[1];
    out.push({ id: `mark:${path}`, name: title ? XML(title).trim() : base(path), path, kind: 'folder', icon: 'folder' });
  }
  return out;
}

// ---------------------------------------------------------------- servers that dropped

/** The same server share, whether it is mounted now or was before. */
export function sameServer(a: Place, b: Place): boolean {
  return a.id === b.id || (!!a.server && a.server === b.server && a.name === b.name);
}

/**
 * The servers to remember: those connected now, plus the ones remembered
 * before that are not back (newest first, at most `max`). Forgetting one
 * removes it here too.
 */
export function rememberServers(now: Place[], before: Place[], max = 8): Place[] {
  const keep = (p: Place): Place => ({ id: p.id, name: p.name, path: p.path, kind: 'network', icon: 'server', volume: 'network', protocol: p.protocol, server: p.server });
  const out = now.map(keep);
  for (const b of before) if (!out.some((o) => sameServer(o, b))) out.push(keep(b));
  return out.slice(0, max);
}

/** The address to connect to a server again ("smb://192.168.0.252/Media"). */
export function reconnectAddress(p: Place): string | undefined {
  if (!p.server) return undefined;
  const share = p.name.includes(' on ') ? p.name.slice(0, p.name.lastIndexOf(' on ')) : '';
  return `${p.protocol ?? 'smb'}://${p.server}${share ? `/${encodeURIComponent(share)}` : ''}`;
}
