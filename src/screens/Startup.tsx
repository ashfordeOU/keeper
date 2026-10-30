// SPDX-License-Identifier: AGPL-3.0-or-later
// Startup Items: what opens when you sign in, and a switch to stop it.

import { useState } from 'react';
import type { StartupItem } from '../../core/types';
import { api } from '../api';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

const IMPACT: Record<StartupItem['impact'], string> = { high: 'danger', medium: 'warn', low: 'ok', unknown: '' };

export function Startup() {
  const { toast } = useStore();
  const list = useAsync(() => api.startup.list(), []);
  const [items, setItems] = useState<StartupItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const data = items ?? list.data;

  const toggle = async (it: StartupItem, on: boolean) => {
    setBusy(it.id);
    try {
      setItems(await api.startup.toggle(it.id, on));
      toast(`${it.name} ${on ? 'will open' : 'will no longer open'} when you sign in`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change this item');
    } finally {
      setBusy(null);
    }
  };

  const enabled = (data ?? []).filter((i) => i.enabled).length;
  return (
    <div>
      <PageHead title="Startup Items" sub="Apps and helpers that start with your computer. Turning one off deletes nothing — switch it back on any time.">
        <button className="btn" onClick={() => { setItems(null); list.reload(); }}>Refresh</button>
      </PageHead>
      {list.loading && !data ? <Loading /> : null}
      {list.error ? <Empty icon="warning" title="Could not read startup items">{list.error}</Empty> : null}
      {data && !data.length ? <Empty icon="power" title="Nothing starts with your computer" /> : null}
      {data?.length ? (
        <>
          <p className="small muted">{enabled} of {data.length} start when you sign in. System-wide items ask for your password, just like the system settings do.</p>
          <div className="card">
            <table className="table">
              <thead><tr><th>Name</th><th>Impact</th><th>Where</th><th>Scope</th><th style={{ width: 60 }} /></tr></thead>
              <tbody>
                {data.map((it) => (
                  <tr key={it.id} style={{ opacity: it.enabled ? 1 : 0.6 }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{it.name}</div>
                      <div className="small muted ellipsis" style={{ maxWidth: 420 }} title={it.command}>{it.publisher ? `${it.publisher} · ` : ''}{it.command}</div>
                    </td>
                    <td><span className={`badge ${IMPACT[it.impact]}`}>{it.impact === 'unknown' ? 'Unknown' : it.impact.charAt(0).toUpperCase() + it.impact.slice(1)}</span></td>
                    <td className="muted small">{it.source}</td>
                    <td>{it.scope === 'system' ? <span className="badge warn">Needs admin</span> : <span className="badge">You</span>}</td>
                    <td>{busy === it.id ? <div className="spinner" /> : <Toggle on={it.enabled} onChange={(v) => void toggle(it, v)} label={`Start ${it.name} at sign-in`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
