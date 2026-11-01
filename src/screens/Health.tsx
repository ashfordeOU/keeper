// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health: how hard your computer is working right now, and what keeps it awake.

import { lazy, Suspense, useEffect, useState } from 'react';
import type { HealthReport } from '../../core/api';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead } from '../components/ui';
import { useStore } from '../state';
import { Ring } from './Protection';
import { HealthMore } from './HealthMore';
import { ForceQuitDialog, Processes, Services } from './Processes';
import '../styles/screens-b.css';
import '../styles/monitor.css';
import { useFeature } from '../features';

// The monitor's deeper tabs load only when opened.
const HealthHistory = lazy(() => import('./monitor/HealthHistory').then((m) => ({ default: m.HealthHistory })));
const HealthDev = lazy(() => import('./monitor/HealthDev').then((m) => ({ default: m.HealthDev })));
const HealthSensors = lazy(() => import('./monitor/HealthSensors').then((m) => ({ default: m.HealthSensors })));
const HealthContainers = lazy(() => import('./monitor/HealthContainers').then((m) => ({ default: m.HealthContainers })));
const HealthApps = lazy(() => import('./monitor/HealthApps').then((m) => ({ default: m.HealthApps })));
const ShareCardDialog = lazy(() => import('./monitor/ShareCard').then((m) => ({ default: m.ShareCardDialog })));
const LiveStrip = lazy(() => import('./monitor/common').then((m) => ({ default: m.LiveStrip })));
const MonitorSettingsPanel = lazy(() => import('./monitor/MonitorSettings').then((m) => ({ default: m.MonitorSettingsPanel })));

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

type HealthTab = 'overview' | 'history' | 'processes' | 'dev' | 'containers' | 'apps' | 'sensors' | 'services' | 'settings';

const TAB_SUB: Record<HealthTab, string> = {
  overview: '', history: 'Up to a year of how hard this computer worked', processes: 'Every program running on this computer, and what it uses',
  dev: 'Coding agents, AI tools and dev servers, by project', containers: 'Docker or Podman containers and what they use', apps: 'Volume per app, browser tabs and energy', sensors: 'Graphics, temperatures, fans and power draw', services: 'Background services that start on their own',
  settings: 'Menu-bar readings, alerts, history, the tool launcher and where results go',
};

function HealthTabs({ tab }: { tab: HealthTab }) {
  const { go } = useStore();
  const history = useFeature('monitorHistory');
  const dev = useFeature('devServers');
  const sensors = useFeature('monitorSensors');
  const containers = useFeature('containers');
  const tabs = ([['overview', 'Overview'], ['history', 'History'], ['processes', 'Processes'], ['dev', 'Dev & agents'], ['containers', 'Containers'], ['apps', 'Sound & tabs'], ['sensors', 'Sensors'], ['services', 'Services'], ['settings', 'Settings']] as const)
    .filter(([id]) => (id !== 'history' || history) && (id !== 'dev' || dev) && (id !== 'sensors' || sensors) && (id !== 'containers' || containers));
  return (
    <div className="seg health-tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go({ name: 'health', arg: id === 'overview' ? undefined : id })}>{label}</button>
      ))}
    </div>
  );
}

/** Health: an overview, every running process (a full task manager), and the system's services. */
export function Health() {
  const { route } = useStore();
  const arg = route.arg === 'force-quit' ? 'processes' : route.arg;
  const tab: HealthTab = arg && arg in TAB_SUB ? (arg as HealthTab) : 'overview';
  if (tab === 'overview') return <HealthOverview />;
  return (
    <div>
      <PageHead title="Health" sub={TAB_SUB[tab]}><HealthTabs tab={tab} /></PageHead>
      <Suspense fallback={<Loading />}>
        {tab === 'processes' ? <Processes /> : tab === 'services' ? <Services /> : tab === 'history' ? <HealthHistory /> : tab === 'dev' ? <HealthDev /> : tab === 'sensors' ? <HealthSensors /> : tab === 'containers' ? <HealthContainers /> : tab === 'apps' ? <HealthApps /> : <div style={{ maxWidth: 820 }}><MonitorSettingsPanel /></div>}
      </Suspense>
    </div>
  );
}

function HealthOverview() {
  const { toast, go } = useStore();
  const [forceQuit, setForceQuit] = useState(false);
  const [share, setShare] = useState(false);
  const [h, setH] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quit, setQuit] = useState<{ pid: number; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.system.health().then((r) => { if (alive) { setH(r); setError(null); } }).catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const kill = async (p: { pid: number; name: string }) => {
    setQuit(null);
    // Stops the app and everything it started (helpers, child servers).
    const n = await api.monitor.killTree(p.pid);
    toast(n ? `Quit ${p.name}${n > 1 ? ` and ${n - 1} helper${n > 2 ? 's' : ''}` : ''}` : `Could not quit ${p.name}`);
  };

  if (error && !h) return <Empty icon="warning" title="Could not read system health">{error}</Empty>;
  if (!h) return <Loading label="Reading system health…" />;
  const usedMem = h.memory.total - h.memory.free;
  const memPct = (usedMem / h.memory.total) * 100;
  const tone = (v: number) => (v > 85 ? 'var(--danger)' : v > 60 ? 'var(--warn)' : 'var(--ok)');

  return (
    <div>
      <PageHead title="Health" sub={`${h.cpuModel} · ${h.cores} cores · up ${uptime(h.uptimeSec)}`}><button className="btn ghost sm" onClick={() => setShare(true)} title="A picture of the current readings to save or copy">Share card…</button><HealthTabs tab="overview" /></PageHead>
      {share ? <Suspense fallback={null}><ShareCardDialog onClose={() => setShare(false)} /></Suspense> : null}
      <Suspense fallback={null}><LiveStrip /></Suspense>
      <div className="kv-grid" style={{ marginBottom: 16 }}>
        <div className="card pad col" style={{ alignItems: 'center' }}><Ring value={h.cpuPercent} size={120} color={tone(h.cpuPercent)} label={`${Math.round(h.cpuPercent)}%`} sub="processor" /><span className="small muted">Load {h.loadAvg.map((l) => l.toFixed(1)).join(' · ')}</span></div>
        <div className="card pad col" style={{ alignItems: 'center' }}><Ring value={memPct} size={120} color={tone(memPct)} label={`${Math.round(memPct)}%`} sub="memory" /><span className="small muted">{formatBytes(usedMem)} of {formatBytes(h.memory.total)}</span></div>
        {h.battery ? (
          <div className="card pad col" style={{ alignItems: 'center' }}>
            <Ring value={h.battery.percent} size={120} color={h.battery.percent < 20 ? 'var(--danger)' : 'var(--ok)'} label={`${Math.round(h.battery.percent)}%`} sub={h.battery.charging ? 'charging' : 'battery'} />
            <span className="small muted">{h.battery.health ? `Health ${h.battery.health}%` : ''}{h.battery.cycles ? ` · ${h.battery.cycles} cycles` : ''}</span>
          </div>
        ) : null}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Busiest apps</h3><div className="btn-row"><button className="btn ghost sm" onClick={() => setForceQuit(true)}>Force Quit…</button><button className="btn ghost sm" onClick={() => go({ name: 'health', arg: 'processes' })}>All processes <Icon name="chevronRight" size={12} /></button></div></div>
          <table className="table">
            <thead><tr><th>App</th><th>Processor</th><th>Memory</th><th /></tr></thead>
            <tbody>
              {h.processes.map((p) => (
                <tr key={p.pid}>
                  <td className="ellipsis" style={{ maxWidth: 220 }} title={`PID ${p.pid}`}>{p.name}</td>
                  <td className="num">{p.cpu.toFixed(1)}%</td>
                  <td className="num">{formatBytes(p.memory)}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost sm" onClick={() => setQuit(p)}>Quit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="card pad">
            <h3 style={{ marginBottom: 8 }}>Keeping your computer awake</h3>
            {h.awakeBlockers.length ? h.awakeBlockers.map((b) => <div key={b} className="item-row"><Icon name="coffee" size={13} /> {b}</div>) : <span className="small muted">Nothing — your computer can sleep normally.</span>}
          </div>
          <div className="card">
            <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Local servers</h3><span className="small muted">Dev servers and databases listening on this computer</span></div>
            {h.listening.length ? (
              <table className="table">
                <thead><tr><th>Port</th><th>Program</th><th /></tr></thead>
                <tbody>
                  {h.listening.map((l) => (
                    <tr key={`${l.port}-${l.pid}`}>
                      <td className="num mono">{l.port}</td>
                      <td>{l.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn ghost sm" onClick={() => void api.system.openExternal(`http://localhost:${l.port}`)}>Open</button>
                        <button className="btn ghost sm" onClick={() => setQuit({ pid: l.pid, name: `${l.name} (port ${l.port})` })}>Stop</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="small muted" style={{ padding: '0 14px 12px' }}>None running.</p>}
          </div>
        </div>
      </div>

      <HealthMore processes={h.processes} onQuit={setQuit} />
      {forceQuit ? <ForceQuitDialog onClose={() => setForceQuit(false)} /> : null}

      {quit ? (
        <Modal title={`Quit ${quit.name}?`} onClose={() => setQuit(null)}>
          <p>Unsaved work in this app may be lost.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setQuit(null)}>Cancel</button>
            <button className="btn danger" onClick={() => void kill(quit)}>Quit</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
