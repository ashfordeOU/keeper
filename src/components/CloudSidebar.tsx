// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cloud services and servers in the sidebar's Locations: every connection, how
// it is doing, how full it is, and one click to open it.

import { useEffect, useState } from 'react';
import { parseRemoteRoute, remoteRoute } from '../../core/remote/paths';
import type { Connection, ConnStatus } from '../../core/remote/types';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { ConnectionDialog, deviceIcon, errText } from './ConnectionDialog';
import { Icon } from './Icon';
import { NavSection } from './NavSection';
import { ContextMenu, type MenuItem } from './ui';
import '../styles/remote.css';

export const STATE_LABEL: Record<ConnStatus['state'], string> = {
  idle: 'Ready', connecting: 'Connecting…', connected: 'Connected', 'needs-sign-in': 'Sign in again', offline: 'Can’t reach it', error: 'Problem',
};

/** The rows for Locations (`bare`), or a section of their own. */
export function CloudSidebar({ bare }: { bare?: boolean } = {}) {
  const { route, go, toast } = useStore();
  const [data, setData] = useState<{ connections: Connection[]; status: ConnStatus[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [mounting, setMounting] = useState<string | null>(null);

  useEffect(() => {
    const load = () => void api.remote.list().then(setData).catch(() => setData({ connections: [], status: [] }));
    load();
    const offs = [
      api.on('remote-changed', load),
      api.on('remote-status', (s) => setData((d) => (d ? { ...d, status: [...d.status.filter((x) => x.id !== s.id), s] } : d))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const here = route.name === 'remote' ? parseRemoteRoute(route.arg)?.id : undefined;
  const status = (id: string) => data?.status.find((s) => s.id === id);

  const openConn = async (c: Connection) => {
    if (c.kind !== 'smb') return go({ name: 'remote', arg: remoteRoute(c.id, '/') });
    // Shared folders are mounted by the system and then browsed like a disk.
    setMounting(c.id);
    const r = await api.remote.mount(c.id);
    setMounting(null);
    if (r.ok && r.path) go({ name: 'browse', arg: r.path });
    else toast(r.message ?? `Could not open ${c.name}`);
  };

  const menuFor = (e: React.MouseEvent, c: Connection) => {
    e.preventDefault();
    const s = status(c.id);
    const items: MenuItem[] = [
      { label: 'Open', icon: 'folder', run: () => void openConn(c) },
      ...(c.kind === 'rclone' && c.provider ? [{ label: 'Sign In Again…', icon: 'globe', run: () => void api.remote.signIn(c.provider!, c.id).then(() => toast(`Signed in to ${c.name}`), (err) => toast(errText(err))) }] : []),
      ...(c.kind !== 'smb' ? [{ label: s?.state === 'offline' || s?.state === 'error' ? 'Reconnect' : 'Check Now', icon: 'refresh', run: () => void api.remote.check(c.id).then((x) => toast(`${c.name}: ${STATE_LABEL[x.state]}${x.message ? ` — ${x.message}` : ''}`)) }] : []),
      { label: 'Edit…', icon: 'settings', run: () => setEditing(c) },
      { sep: true, label: '' },
      { label: `Remove “${c.name}”`, icon: 'close', danger: true, run: () => { if (confirm(`Remove ${c.name} from Keeper? Nothing on the service or server is deleted.`)) void api.remote.remove(c.id); } },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (!data) return null;
  const rows = (
    <>
        {data.connections.map((c) => {
          const s = status(c.id);
          const q = s?.quota;
          const used = q?.total ? Math.min(1, (q.used ?? q.total - (q.free ?? 0)) / q.total) : undefined;
          return (
            <div key={c.id} className="place-row conn-row" onContextMenu={(e) => menuFor(e, c)}>
              <button className={`nav-item ${here === c.id ? 'active' : ''} ${used !== undefined ? 'has-bar' : ''}`} data-nav-key={`conn:${c.id}`} onClick={() => void openConn(c)} title={`${c.name} — ${STATE_LABEL[s?.state ?? 'idle']}${q?.total ? ` · ${formatBytes(q.free ?? 0)} free of ${formatBytes(q.total)}` : ''}${s?.message ? `\n${s.message}` : ''}`}>
                <Icon name={deviceIcon(c.device)} size={15} />
                <span className="label ellipsis grow">{c.name}</span>
                {mounting === c.id ? <div className="spinner" style={{ width: 11, height: 11 }} /> : <span className={`conn-dot ${s?.state ?? 'idle'}`} aria-label={STATE_LABEL[s?.state ?? 'idle']} />}
                {used !== undefined ? <span className="place-bar" aria-hidden><i style={{ width: `${Math.round(used * 100)}%`, background: used > 0.9 ? 'var(--danger)' : undefined }} /></span> : null}
              </button>
            </div>
          );
        })}
        <button className="nav-item add-conn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} />
          <span className="label ellipsis">{data.connections.length && !bare ? 'Add…' : 'Connect a cloud or server…'}</span>
        </button>
    </>
  );
  return (
    <>
      {bare ? rows : <NavSection id="cloud" title="Cloud & Servers" menuItems={[{ label: 'Add a Connection…', icon: 'plus', run: () => setAdding(true) }]}>{rows}</NavSection>}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {adding ? <ConnectionDialog onClose={() => setAdding(false)} onSaved={(c) => void openConn(c)} /> : null}
      {editing ? <ConnectionDialog edit={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
