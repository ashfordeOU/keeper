// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// App controls: every running app (and every app Keeper has settings for) with
// its own network, CPU, memory, login and look settings.

import { useEffect, useMemo, useState } from 'react';
import type { AppRef } from '../../core/appctl';
import type { AppControlState } from '../../core/api-settingsplus';
import { api } from '../api';
import { AppSettingsPanel } from '../components/AppSettingsPanel';
import { Icon } from '../components/Icon';
import { Empty, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/settingsplus.css';

export function AppControls() {
  const { route } = useStore();
  const [running, setRunning] = useState<AppRef[] | null>(null);
  const [saved, setSaved] = useState<AppControlState[]>([]);
  const [pick, setPick] = useState<AppRef | null>(null);
  const [q, setQ] = useState('');

  const load = () => {
    void api.appctl.running().then(setRunning);
    void api.appctl.list().then(setSaved);
  };
  useEffect(load, []);

  const apps = useMemo(() => {
    const m = new Map<string, AppRef>();
    for (const s of saved) m.set((s.app.path ?? s.app.name).toLowerCase(), s.app);
    for (const a of running ?? []) m.set((a.path ?? a.name).toLowerCase(), a);
    return [...m.values()].filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(!!b.pid) - Number(!!a.pid) || a.name.localeCompare(b.name));
  }, [running, saved, q]);

  // "appcontrols" with an app path or name (from Processes, Applications, Network Activity).
  useEffect(() => {
    if (!route.arg || !running) return;
    const a = apps.find((x) => x.path === route.arg || x.name === route.arg || String(x.pid) === route.arg);
    setPick(a ?? { name: route.arg.split(/[\\/]/).pop() ?? route.arg, path: route.arg.includes('/') || route.arg.includes('\\') ? route.arg : undefined });
  }, [route.arg, running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page sp-page" data-testid="appcontrols-page">
      <PageHead title="App controls" sub="Limit, route and tune one app at a time. Keeper shows the exact commands first and says what this system cannot do.">
        <button className="btn sm" onClick={load}><Icon name="refresh" size={13} /> Refresh</button>
      </PageHead>
      <div className="sp-split">
        <div className="card sp-applist">
          <div className="qc-search" style={{ margin: 8 }}><Icon name="search" size={14} /><input placeholder="Find an app" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {!running ? <div className="muted sp-more">Looking for apps…</div> : apps.map((a) => {
            const s = saved.find((x) => x.app.path === a.path || x.app.name === a.name);
            return (
              <div key={(a.path ?? a.name) + (a.pid ?? '')} className={`sp-app ${pick && pick.name === a.name && pick.path === a.path ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={!!pick && pick.name === a.name && pick.path === a.path} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(a); } }} onClick={() => setPick(a)} data-testid={`appctl-app-${a.name}`}>
                <span>{a.name}</span>{a.pid ? null : <span className="muted small">not running</span>}
                {s ? <span className="badge">set</span> : null}
              </div>
            );
          })}
        </div>
        <div>{pick ? <AppSettingsPanel key={(pick.path ?? pick.name) + (pick.pid ?? '')} app={pick} /> : <Empty icon="cpu" title="Pick an app">Its settings appear here.</Empty>}</div>
      </div>
    </div>
  );
}
