// SPDX-License-Identifier: AGPL-3.0-or-later
// Favourites and Locations in the sidebar, like a file manager's: the folders
// people use, cloud drives, this computer, every disk (with eject), network
// servers, AirDrop on a Mac, the Network page and the Trash.

import { useEffect, useState } from 'react';
import { formatBytes } from '../../core/format';
import type { Place, PlacesModel } from '../../core/places';
import { api } from '../api';
import { useStore, type Route } from '../state';
import { Icon } from './Icon';
import { ContextMenu, type MenuItem } from './ui';
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

function volumeIcon(p: Place): string {
  if (p.kind === 'network') return 'server';
  if (p.volume === 'removable') return 'usb';
  if (p.volume === 'image') return 'zip';
  if (p.volume === 'optical') return 'disk';
  return 'disk';
}

export function PlacesSidebar() {
  const { route, go, settings, updateSettings, toast, info } = useStore();
  const [m, reload] = usePlaces();
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
    reload();
  };
  const item = (p: Place, opts: { icon?: string; route?: Route; onClick?: () => void; badge?: React.ReactNode } = {}) => {
    const r = opts.route ?? browse(p.path);
    const used = p.total && p.free !== undefined ? 1 - p.free / p.total : undefined;
    return (
      <div key={p.id} className="place-row" onContextMenu={(e) => menuFor(e, p)}>
        <button className={`nav-item ${!opts.onClick && active(r) ? 'active' : ''}`} title={p.total ? `${p.name} — ${formatBytes(p.free ?? 0)} free of ${formatBytes(p.total)}` : p.path} onClick={() => (opts.onClick ? opts.onClick() : go(r))}>
          <Icon name={opts.icon ?? p.icon} size={15} />
          <span className="label ellipsis grow">{p.name}</span>
          {opts.badge}
        </button>
        {used !== undefined ? <div className="place-bar" aria-hidden><i style={{ width: `${Math.round(used * 100)}%`, background: used > 0.9 ? 'var(--danger)' : undefined }} /></div> : null}
        {p.ejectable ? (
          <button className="place-eject" title={`Eject ${p.name}`} disabled={ejecting === p.path} onClick={(e) => { e.stopPropagation(); void doEject(p); }}>
            {ejecting === p.path ? <div className="spinner" style={{ width: 11, height: 11 }} /> : <Icon name="eject" size={12} />}
          </button>
        ) : null}
      </div>
    );
  };

  // Folders dragged in from Browse or the system file manager are pinned here.
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
    if (!paths.length) return;
    await updateSettings({ pinned: [...new Set([...settings.pinned, ...paths])] });
    toast(paths.length === 1 ? 'Added to Favorites' : `Added ${paths.length} folders to Favorites`);
    reload();
  };

  const computerRoot = info?.platform === 'win32' ? m.volumes[0]?.path ?? 'C:\\' : '/';
  // On Linux the root file system is the computer itself: one row with its free space, not two.
  const rootVol = info?.platform === 'linux' ? m.volumes.find((v) => v.path === '/') : undefined;
  const sectionMenu = (e: React.MouseEvent) => {
    if (!(settings.hiddenPlaces ?? []).length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Show all hidden places again', icon: 'eye', run: () => void updateSettings({ hiddenPlaces: [] }).then(reload) }] });
  };

  return (
    <>
      <div className={`nav-section places-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => void onDrop(e)}>
        <div className="nav-title" onContextMenu={sectionMenu}>Favorites</div>
        {m.favorites.map((p) => item(p))}
      </div>

      <div className="nav-section">
        <div className="nav-title" onContextMenu={sectionMenu}>Locations</div>
        {m.shared ? item(m.shared, { icon: 'island' }) : null}
        {m.cloud.map((p) => item(p, { icon: 'cloud' }))}
        {item({ id: 'computer', name: m.computerName, path: computerRoot, kind: 'computer', icon: 'laptop', total: rootVol?.total, free: rootVol?.free })}
        {m.volumes.filter((p) => p !== rootVol).map((p) => item(p, { icon: volumeIcon(p) }))}
        {m.airdrop ? item({ id: 'airdrop', name: 'AirDrop', path: '', kind: 'airdrop', icon: 'airdrop' }, { onClick: () => void api.places.openAirDrop() }) : null}
        {m.network.map((p) => item(p, { icon: 'server' }))}
        {item({ id: 'network', name: 'Network', path: '', kind: 'network', icon: 'globe' }, { route: { name: 'network' } })}
        {item({ id: 'trash', name: info?.platform === 'win32' ? 'Recycle Bin' : 'Trash', path: '', kind: 'folder', icon: 'trash' }, { route: { name: 'trash' } })}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </>
  );
}
