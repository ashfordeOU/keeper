// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Applications: everything installed, how big it is, and when you last used it;
// with App updates on, which ones have a newer version (src/screens/AppUpdates.tsx).

import { useEffect, useMemo, useState } from 'react';
import { DAY, GB, formatBytes, relativeTime } from '../../core/format';
import type { AppInfo } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead } from '../components/ui';
import { useFeature } from '../features';
import { useAsync, useStore } from '../state';
import { AppUpdatesView } from './AppUpdates';
import '../styles/screens-b.css';

type Filter = 'all' | 'unused' | 'large' | 'updates';
type Sort = 'name' | 'size' | 'used';

export function Apps() {
  const { settings, toast, info, go, route } = useStore();
  const updatesOn = useFeature('appUpdates');
  const list = useAsync(() => api.apps.list(), []);
  const [filter, setFilter] = useState<Filter>(route.arg === 'updates' && updatesOn ? 'updates' : 'all');
  const [updateCount, setUpdateCount] = useState<number | null>(null);
  useEffect(() => { if (route.arg === 'updates' && updatesOn) setFilter('updates'); }, [route.arg, updatesOn]);
  useEffect(() => {
    if (!updatesOn) return;
    const read = () => void api.appUpdates.state().then((v) => setUpdateCount(v.updates.length + (v.system?.count ? 1 : 0))).catch(() => undefined);
    read();
    return api.on('app-updates-changed', read);
  }, [updatesOn]);
  const [sort, setSort] = useState<{ key: Sort; desc: boolean }>({ key: 'size', desc: true });
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<AppInfo | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const unusedDays = settings?.unusedAppDays ?? 180;
  const now = Date.now();

  const apps = useMemo(() => {
    let l = (list.data ?? []).filter((a) => !removed.has(a.id));
    if (q) l = l.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
    if (filter === 'unused') l = l.filter((a) => !a.system && a.lastUsed > 0 && now - a.lastUsed > unusedDays * DAY);
    if (filter === 'large') l = l.filter((a) => a.size >= GB);
    const d = sort.desc ? -1 : 1;
    return [...l].sort((a, b) => (sort.key === 'name' ? a.name.localeCompare(b.name) * d * -1 : sort.key === 'size' ? (a.size - b.size) * d : (a.lastUsed - b.lastUsed) * d));
  }, [list.data, removed, q, filter, sort, now, unusedDays]);

  const total = apps.reduce((n, a) => n + a.size, 0);
  const th = (key: Sort, label: string) => (
    <th onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>{label} {sort.key === key ? (sort.desc ? '↓' : '↑') : ''}</th>
  );

  const uninstall = async (a: AppInfo) => {
    setConfirm(null);
    try {
      const r = await api.apps.uninstall(a.id);
      if (r.failed) toast(`Could not remove ${a.name}`);
      else {
        setRemoved((s) => new Set(s).add(a.id));
        toast(info?.platform === 'win32' ? `Opened the uninstaller for ${a.name}` : `Moved ${a.name} to the Trash`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not remove ${a.name}`);
    }
  };

  return (
    <div>
      <PageHead title="Applications" sub={filter === 'updates' ? 'Newer versions of your apps, from their makers' : list.data ? `${apps.length} apps · ${formatBytes(total)}` : 'Everything installed on this computer'}>
        {filter !== 'updates' ? <input className="input" placeholder="Filter apps" aria-label="Filter apps" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} /> : null}
        <div className="seg">
          <button className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'unused' ? 'on' : ''} aria-pressed={filter === 'unused'} onClick={() => setFilter('unused')}>Unused {Math.round(unusedDays / 30)}+ months</button>
          <button className={filter === 'large' ? 'on' : ''} aria-pressed={filter === 'large'} onClick={() => setFilter('large')}>Over 1 GB</button>
          {updatesOn ? <button className={filter === 'updates' ? 'on' : ''} aria-pressed={filter === 'updates'} onClick={() => setFilter('updates')} data-testid="apps-updates-tab">Updates{updateCount ? <span className="muted"> {updateCount}</span> : null}</button> : null}
        </div>
      </PageHead>
      {filter === 'updates' && updatesOn ? <AppUpdatesView /> : <>
      {list.loading ? <Loading label="Measuring apps…" /> : null}
      {list.error ? <Empty icon="warning" title="Could not list apps">{list.error}</Empty> : null}
      {list.data && !apps.length ? <Empty icon="app" title="No apps match" /> : null}
      {apps.length ? (
        <div className="card">
          <table className="table">
            <thead><tr>{th('name', 'Name')}<th>Version</th>{th('size', 'Size')}{th('used', 'Last used')}<th style={{ width: 120 }} /></tr></thead>
            <tbody>
              {apps.map((a) => {
                const unused = !a.system && a.lastUsed > 0 && now - a.lastUsed > unusedDays * DAY;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="row"><b>{a.name}</b>{a.system ? <span className="badge">System</span> : null}{unused ? <span className="badge warn">Unused</span> : null}</div>
                      <div className="small muted ellipsis" style={{ maxWidth: 380 }} title={a.path}>{a.publisher ?? (info?.home && a.path.startsWith(info.home) ? 'Installed for you' : 'Installed for everyone')}</div>
                    </td>
                    <td className="muted small">{a.version ?? '—'}</td>
                    <td className="num">{a.size ? formatBytes(a.size) : '—'}</td>
                    <td className="muted">{a.lastUsed ? relativeTime(a.lastUsed) : 'Unknown'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn ghost sm icon" title="Show in folder" aria-label="Show in folder" onClick={() => void api.files.reveal(a.path)}><Icon name="reveal" size={13} /></button>
                      <button className="btn ghost sm icon" title="App settings: network, limits, login, language…" aria-label="App settings: network, limits, login, language…" onClick={() => go({ name: 'appcontrols', arg: a.path })}><Icon name="settings" size={13} /></button>
                      {!a.system ? <button className="btn sm" onClick={() => setConfirm(a)}>Uninstall</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      </>}
      {confirm ? (
        <Modal title={`Uninstall ${confirm.name}?`} onClose={() => setConfirm(null)}>
          <p>{info?.platform === 'win32' ? 'Keeper will open the app’s own uninstaller, so it can remove everything it installed.' : `${confirm.name} will be moved to the Trash. You can put it back until you empty the Trash.`}</p>
          <p className="small muted">This frees about {formatBytes(confirm.size)}.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn danger" onClick={() => void uninstall(confirm)}>Uninstall</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
