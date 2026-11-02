// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cloud & Servers with no connection chosen: every connection as a card (how it
// is doing, how full it is, Browse and Remove), and Add… to connect another.

import { useEffect, useState } from 'react';
import { remoteRoute } from '../../core/remote/paths';
import type { Connection, ConnStatus } from '../../core/remote/types';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { STATE_LABEL } from '../components/CloudSidebar';
import { ConnectionDialog, deviceIcon, errText } from '../components/ConnectionDialog';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/remote.css';

export function RemoteOverview() {
  const { go, toast } = useStore();
  const [data, setData] = useState<{ connections: Connection[]; status: ConnStatus[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void api.remote.list().then(setData).catch(() => setData({ connections: [], status: [] }));
    load();
    const offs = [
      api.on('remote-changed', load),
      api.on('remote-status', (s) => setData((d) => (d ? { ...d, status: [...d.status.filter((x) => x.id !== s.id), s] } : d))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const open = async (c: Connection) => {
    if (c.kind !== 'smb') return go({ name: 'remote', arg: remoteRoute(c.id, '/') });
    // Shared folders are mounted by the system and then browsed like a disk.
    setBusy(c.id);
    const r = await api.remote.mount(c.id).catch((e: unknown) => ({ ok: false, path: undefined, message: errText(e) }));
    setBusy(null);
    if (r.ok && r.path) go({ name: 'browse', arg: r.path });
    else toast(r.message ?? `Could not open ${c.name}`);
  };
  const remove = (c: Connection) => {
    if (confirm(`Remove ${c.name} from Keeper? Nothing on the service or server is deleted.`)) void api.remote.remove(c.id);
  };

  const add = <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add…</button>;
  return (
    <div className="remote-overview">
      <PageHead title="Cloud & Servers" sub="Your cloud storage, servers, NAS and other computers' shared folders, browsed like a folder here.">{data?.connections.length ? add : null}</PageHead>
      {!data ? <Loading /> : !data.connections.length ? (
        <Empty icon="cloud" title="No connections yet" action={add}>Connect Google Drive, Dropbox, OneDrive, an SFTP or WebDAV server, S3 storage or a shared folder on your network.</Empty>
      ) : (
        <div className="conn-cards">
          {data.connections.map((c) => {
            const s = data.status.find((x) => x.id === c.id);
            const q = s?.quota;
            const used = q?.total ? Math.min(1, (q.used ?? q.total - (q.free ?? 0)) / q.total) : undefined;
            return (
              <div key={c.id} className="card conn-card" data-testid="conn-card">
                <div className="conn-card-head">
                  <Icon name={deviceIcon(c.device)} size={20} />
                  <div className="grow conn-card-name">
                    <div className="ellipsis conn-card-title">{c.name}</div>
                    <div className="small muted"><span className={`conn-dot ${s?.state ?? 'idle'}`} aria-hidden /> {STATE_LABEL[s?.state ?? 'idle']}{s?.message ? ` · ${s.message}` : ''}</div>
                  </div>
                </div>
                {used !== undefined && q?.total ? (
                  <div className="conn-card-quota">
                    <div className="progress"><i style={{ width: `${Math.round(used * 100)}%`, background: used > 0.9 ? 'var(--danger)' : undefined }} /></div>
                    <div className="small muted">{formatBytes(q.free ?? 0)} free of {formatBytes(q.total)}</div>
                  </div>
                ) : null}
                <div className="btn-row">
                  <button className="btn sm primary" disabled={busy === c.id} onClick={() => void open(c)}><Icon name="folder" size={13} /> Browse</button>
                  <button className="btn sm ghost" onClick={() => remove(c)}>Remove…</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {adding ? <ConnectionDialog onClose={() => setAdding(false)} onSaved={(c) => void open(c)} /> : null}
    </div>
  );
}
