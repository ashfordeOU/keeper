// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The sidebar's places, laid out like the system's own file manager
// (core/sidebar-places.ts): Finder's Favorites, Locations and Tags on a Mac;
// File Explorer's Home, Gallery, OneDrive, Quick access and This PC on Windows;
// GNOME Files' or Dolphin's lists on Linux. Disks and servers come and go as
// they connect, with how full they are and Eject; a server that dropped stays,
// dimmed, until it is back or forgotten; Keeper's cloud and server connections
// sit in Locations with their status. Keeper's Home comes first everywhere.
// Types (Documents, Pictures…) are chips on the file list, not places here.

import { useEffect, useState } from 'react';
import { formatBytes } from '../../core/format';
import type { Place, PlacesModel } from '../../core/places';
import { buildSidebarPlaces, placeCapacity, reconnectAddress, rememberServers, sameServer, type SidebarRow } from '../../core/sidebar-places';
import { api } from '../api';
import { useAsync, useStore, type Route } from '../state';
import { folderDrop } from '../fileops';
import { Icon } from './Icon';
import { NavSection } from './NavSection';
import { CloudSidebar } from './CloudSidebar';
import { PlaceFree } from './PlaceFree';
import { ContextMenu, type MenuItem } from './ui';
import { ConnectDialog } from '../screens/Network';
import '../styles/places.css';

/** Keeps the Places model fresh: on mount, when disks come and go, and every half minute. */
export function usePlaces(): [PlacesModel | null, () => void] {
  const [m, setM] = useState<PlacesModel | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => void api.places.list().then((x) => alive && setM(x)).catch(() => undefined);
    load();
    const off = api.on('places-changed', load);
    const t = setInterval(load, 30_000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [n]);
  return [m, () => setN((x) => x + 1)];
}

// Servers seen connected on this computer, so one that drops shows as offline (this window's storage).
const SERVERS_KEY = 'sidebar.servers';
function loadServers(): Place[] {
  try { return JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]') as Place[]; } catch { return []; }
}
function saveServers(list: Place[]) {
  try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

/** A page row (Home, Recents, Trash, a tag…), drawn by the sidebar's own NavItem. */
export type PageItem = (p: { route: Route; icon?: string; label: string; dot?: string; tip?: string }) => React.ReactElement | null;

export function PlacesSidebar({ Item }: { Item: PageItem }) {
  const { route, go, settings, updateSettings, toast, info, trash, version } = useStore();
  const [m, reload] = usePlaces();
  const [known, setKnown] = useState<Place[]>(loadServers);
  const [connect, setConnect] = useState<string | null>(null);
  // Finder's tags on a Mac (Keeper's own elsewhere live in their own section).
  const tags = useAsync(() => (info?.platform === 'darwin' ? api.library.tags() : Promise.resolve([])), [version, info?.platform]);
  useEffect(() => {
    if (!m) return;
    const next = rememberServers(m.network, known);
    if (JSON.stringify(next) !== JSON.stringify(known)) { setKnown(next); saveServers(next); }
  }, [m, known]);
  const forget = (p: Place) => { const next = known.filter((k) => !sameServer(k, p)); setKnown(next); saveServers(next); };
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [ejecting, setEjecting] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  if (!m || !settings) return null;

  const browse = (p: string): Route => ({ name: 'browse', arg: p });
  const active = (r: Route) => route.name === r.name && (route.arg ?? '') === (r.arg ?? '');
  const hide = async (p: Place) => {
    if (p.id.startsWith('pin:')) await updateSettings({ pinned: settings.pinned.filter((x) => x !== p.path) });
    else await updateSettings({ hiddenPlaces: [...new Set([...(settings.hiddenPlaces ?? []), p.id])] });
    reload();
  };
  const menuFor = (e: React.MouseEvent, p: Place) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: 'Open', icon: 'folder', run: () => go(browse(p.path)) },
      { label: info?.platform === 'darwin' ? 'Show in Finder' : 'Show in File Manager', icon: 'reveal', run: () => void api.files.reveal(p.path) },
      { label: 'Get Info', icon: 'info', run: () => void api.places.folderSize(p.path).then((s) => toast(`${p.name}: ${formatBytes(s.size)} in ${s.files.toLocaleString()} files`)) },
    ];
    if (p.ejectable) items.push({ sep: true, label: '' }, { label: `Eject “${p.name}”`, icon: 'eject', run: () => void doEject(p) });
    if (p.kind !== 'volume' && p.kind !== 'network') items.push({ sep: true, label: '' }, { label: 'Remove from Sidebar', icon: 'close', run: () => void hide(p) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const doEject = async (p: Place) => {
    setEjecting(p.path);
    const r = await api.places.eject(p.path);
    setEjecting(null);
    toast(r.ok ? `Ejected ${p.name}. It is safe to unplug.` : r.message ?? `Could not eject ${p.name}`);
    if (r.ok && route.name === 'browse' && route.arg?.startsWith(p.path)) go({ name: 'home' });
    // Ejected on purpose: not "offline" afterwards.
    if (r.ok && p.kind === 'network') forget(p);
    reload();
  };
  const item = (p: Place, opts: { icon?: string; route?: Route; onClick?: () => void; badge?: React.ReactNode; realName?: string } = {}) => {
    const r = opts.route ?? browse(p.path);
    const cap = placeCapacity(p.total, p.free);
    // The full name (the real one behind Home or This Computer, where it is, and how full a disk is) in the tooltip.
    const tip = [p.name, opts.realName && opts.realName !== p.name ? `Named “${opts.realName}” on this computer` : '', p.path && p.path !== p.name ? p.path : '', p.total ? `${formatBytes(p.free ?? 0)} free of ${formatBytes(p.total)}` : ''].filter(Boolean).join('\n');
    return (
      // Files dropped on a folder or disk move there (⌥ or Ctrl copies); on the Trash, they go to the Trash.
      <div key={p.id} className={`place-row ${p.ejectable ? 'has-eject' : ''}`} onContextMenu={(e) => menuFor(e, p)}
        {...(p.id === 'trash' ? folderDrop(undefined, { onTrash: (paths) => void trash(paths) }) : p.path && !opts.onClick && !opts.route ? folderDrop(p.path) : {})}>
        <button className={`nav-item ${!opts.onClick && active(r) ? 'active' : ''}`} data-nav-key={p.path || p.id} data-low={cap?.low ? '1' : undefined} title={tip} onClick={() => (opts.onClick ? opts.onClick() : go(r))}>
          <Icon name={opts.icon ?? p.icon} size={15} />
          <span className="label ellipsis grow">{p.name}</span>
          {opts.badge}
          {/* How full a disk is: quiet free space on hover; in view (amber) only when nearly full. */}
          {cap ? <PlaceFree {...cap} /> : null}
        </button>
        {p.ejectable ? (
          <button className="place-eject" title={`Eject ${p.name}`} aria-label={`Eject ${p.name}`} disabled={ejecting === p.path} onClick={(e) => { e.stopPropagation(); void doEject(p); }}>
            {ejecting === p.path ? <div className="spinner" style={{ width: 11, height: 11 }} /> : <Icon name="eject" size={12} />}
          </button>
        ) : null}
      </div>
    );
  };

  // Folders dragged in from Browse or the system file manager onto the section (not onto a row) are pinned here.
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
    if (!paths.length) return;
    await updateSettings({ pinned: [...new Set([...settings.pinned, ...paths])] });
    toast(paths.length === 1 ? 'Added to the sidebar' : `Added ${paths.length} folders to the sidebar`);
    reload();
  };

  const platform = info?.platform ?? 'linux';
  const offline = known.filter((k) => !m.network.some((n) => sameServer(n, k)));
  const groups = buildSidebarPlaces({ platform, model: m, desktop: m.desktop, tags: (tags.data ?? []).map((t) => t.tag), offline });
  const sectionMenu: MenuItem[] = (settings.hiddenPlaces ?? []).length
    ? [{ label: 'Show all hidden places again', icon: 'eye', run: () => void updateSettings({ hiddenPlaces: [] }).then(reload) }]
    : [];
  // A server that dropped: dimmed, "Offline"; a click connects again, the menu forgets it.
  const offlineRow = (r: SidebarRow) => (
    <div key={r.key} className="place-row offline" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Connect Again…', icon: 'refresh', run: () => setConnect(reconnectAddress(r.place!) ?? '') }, { label: `Forget “${r.label}”`, icon: 'close', run: () => forget(r.place!) }] }); }}>
      <button className="nav-item" data-nav-key={r.key} title={`${r.label} is not connected. Click to connect again.`} onClick={() => setConnect(reconnectAddress(r.place!) ?? '')}>
        <Icon name={r.icon} size={15} />
        <span className="label ellipsis grow">{r.label}</span>
        <span className="place-state">Offline</span>
      </button>
    </div>
  );
  const row = (r: SidebarRow) => {
    if (r.offline) return offlineRow(r);
    if (r.airdrop) return item({ id: 'airdrop', name: r.label, path: '', kind: 'airdrop', icon: 'airdrop' }, { onClick: () => void api.places.openAirDrop() });
    if (r.route) {
      // The Trash takes files dropped on it.
      const el = <Item key={r.key} route={r.route as Route} icon={r.icon} label={r.label} dot={r.color} />;
      return r.key === 'trash' ? <div key={r.key} className="place-row" {...folderDrop(undefined, { onTrash: (paths) => void trash(paths) })}>{el}</div> : el;
    }
    return item({ ...r.place!, name: r.label }, { icon: r.icon, realName: r.realName });
  };
  // Folders dropped on the folder lists (not on a row) are pinned there.
  const pinTarget = (id: string) => id !== 'locations' && id !== 'remote' && id !== 'tags';
  const dropProps = (id: string) => (pinTarget(id) ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => void onDrop(e),
  } : {});
  const dropClass = (id: string) => (pinTarget(id) ? `places-drop ${over ? 'over' : ''}` : '');

  return (
    <>
      {groups.map((g) => g.id === 'top' ? (
        <div key="top" className={`nav-folders ${dropClass('top')}`} role="group" aria-label="Places" data-testid="sidebar-places-top" {...dropProps('top')}>{g.rows.map(row)}</div>
      ) : (
        <NavSection key={g.id} id={g.id} title={g.title} menuItems={sectionMenu} noLimit className={dropClass(g.id)} data-testid={`sidebar-group-${g.id}`} {...dropProps(g.id)}>
          {g.rows.map(row)}
          {/* Keeper's cloud and server connections, with their status, join the system's locations. */}
          {g.id === (platform === 'linux' && m.desktop === 'kde' ? 'remote' : 'locations') ? <CloudSidebar bare /> : null}
        </NavSection>
      ))}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {connect !== null ? <ConnectDialog initial={connect} onClose={() => { setConnect(null); reload(); }} /> : null}
    </>
  );
}
