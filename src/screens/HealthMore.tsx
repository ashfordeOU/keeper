// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The lower half of Health: the last 24 hours, what worked hardest, alert
// rules, coding agents, Docker, temperatures, disk health and a speed test.

import { useEffect, useMemo, useState } from 'react';
import type { Consumer, DiskHealth, DockerContainer, Thermal } from '../../core/api-x';
import { formatBytes, relativeTime } from '../../core/format';
import type { AgentSession } from '../../core/island';
import { bucketize, type AlertRule, type HealthSample, type ProcessAlert, type SpeedResult } from '../../core/monitor';
import { api } from '../api';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useT } from '../i18n';
import { useStore } from '../state';
import '../styles/screens-x.css';

type Range = 1 | 6 | 24;

export function HealthMore({ processes, onQuit }: { processes: { pid: number; name: string }[]; onQuit: (p: { pid: number; name: string }) => void }) {
  const t = useT();
  const { toast } = useStore();
  const [hist, setHist] = useState<HealthSample[]>([]);
  const [range, setRange] = useState<Range>(24);
  const [top, setTop] = useState<Consumer[]>([]);
  const [alerts, setAlerts] = useState<{ rules: AlertRule[]; active: ProcessAlert[] }>({ rules: [], active: [] });
  const [docker, setDocker] = useState<{ available: boolean; containers: DockerContainer[] } | null>(null);
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [temps, setTemps] = useState<Thermal[] | null | undefined>(undefined);
  const [disks, setDisks] = useState<DiskHealth[] | null | undefined>(undefined);
  const [speeds, setSpeeds] = useState<SpeedResult[]>([]);
  const [testing, setTesting] = useState(false);

  const load = () => {
    void api.monitor.history().then(setHist);
    void api.monitor.topToday().then(setTop);
    void api.monitor.alerts().then(setAlerts);
    void api.monitor.docker().then(setDocker);
    void api.island.state().then((s) => setAgents(s.agents)).catch(() => undefined);
  };
  useEffect(() => {
    load();
    void api.monitor.thermals().then(setTemps).catch(() => setTemps(null));
    void api.monitor.disks().then(setDisks).catch(() => setDisks(null));
    void api.monitor.speedHistory().then(setSpeeds);
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
  }, []);

  const now = Date.now();
  const from = now - range * 3600_000;
  const buckets = range === 1 ? 60 : range === 6 ? 72 : 96;
  const labels = useMemo(() => Array.from({ length: buckets }, (_, i) => new Date(from + (i * (now - from)) / buckets).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), [from, buckets, now]);
  const cpu = bucketize(hist, (s) => s.cpu, from, now, buckets);
  const mem = bucketize(hist, (s) => (s.memUsed / s.memTotal) * 100, from, now, buckets);
  const batt = bucketize(hist, (s) => s.battery, from, now, buckets);
  const hasBattery = batt.some((v) => v !== null);
  const pidOf = (name: string) => processes.find((p) => p.name === name || p.name.startsWith(name));

  const saveRule = async (r: AlertRule) => setAlerts({ ...alerts, rules: await api.monitor.setAlertRules(alerts.rules.map((x) => (x.id === r.id ? r : x))) });

  const speedTest = async () => {
    setTesting(true);
    try {
      const r = await api.monitor.speedTest();
      setSpeeds((s) => [...s, r]);
    } catch (e) {
      toast(`Speed test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="section">
      <div className="section-head">
        <h2>{t('health.today')}</h2>
        <div className="seg">{([1, 6, 24] as Range[]).map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 24 ? '24 h' : `${r} h`}</button>)}</div>
      </div>
      {hist.length < 2 ? <div className="card pad small muted">Keeper records how hard your computer works once a minute. Charts appear after a few minutes.</div> : (
        <div className="hx-charts">
          <div className="card pad"><h3>Processor</h3><Chart labels={labels} max={100} min={0} yFormat={(v) => `${Math.round(v)}%`} series={[{ label: 'Processor', color: 'var(--c-video)', values: cpu, format: (v) => `${Math.round(v)}%` }]} /></div>
          <div className="card pad"><h3>Memory</h3><Chart labels={labels} max={100} min={0} yFormat={(v) => `${Math.round(v)}%`} series={[{ label: 'Memory in use', color: 'var(--c-document)', values: mem, format: (v) => `${Math.round(v)}%` }]} /></div>
          {hasBattery ? <div className="card pad"><h3>Battery</h3><Chart labels={labels} max={100} min={0} yFormat={(v) => `${Math.round(v)}%`} series={[{ label: 'Battery', color: 'var(--c-installer)', values: batt, format: (v) => `${Math.round(v)}%` }]} /></div> : null}
        </div>
      )}

      {alerts.active.length ? (
        <div className="card pad hx-alert" style={{ marginBottom: 12 }}>
          <h3 style={{ marginBottom: 6 }}><Icon name="warning" size={14} /> Working hard right now</h3>
          {alerts.active.map((a) => {
            const p = pidOf(a.name);
            return (
              <div key={a.rule + a.name} className="row small" style={{ padding: '4px 0' }}>
                <span className="grow"><b>{a.name}</b> has been {alerts.rules.find((r) => r.id === a.rule)?.kind === 'memory' ? `using ${formatBytes(a.value)} of memory` : `using ${Math.round(a.value)}% of a processor core`} since {relativeTime(a.since)}</span>
                {p ? <button className="btn sm danger" onClick={() => onQuit(p)}>Quit</button> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="grid cols-2">
        <div className="card pad">
          <h3 style={{ marginBottom: 8 }}>{t('health.topToday')}</h3>
          {!top.length ? <span className="small muted">Not enough history yet.</span> : (
            <div className="hx-top">
              <span className="small muted">App</span><span className="small muted">Share</span><span className="small muted">On battery</span>
              {top.slice(0, 8).map((c) => (
                <div key={c.name} style={{ display: 'contents' }}>
                  <span className="ellipsis" title={`Average ${c.avgCpu.toFixed(1)}% · peak memory ${formatBytes(c.peakMemory)}`}>{c.name}</span>
                  <span className="num">{Math.round(c.share * 100)}%</span>
                  <span className="num muted">{c.batteryShare ? `${Math.round(c.batteryShare * 100)}%` : '—'}</span>
                  <div className="hx-bar"><i style={{ width: `${Math.round(c.share * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 8 }}>Tell me when an app misbehaves</h3>
          {alerts.rules.map((r) => (
            <div key={r.id} className="row small" style={{ padding: '6px 0', flexWrap: 'wrap' }}>
              <Toggle on={r.enabled} onChange={(v) => void saveRule({ ...r, enabled: v })} />
              <span>{r.kind === 'cpu' ? 'Uses more than' : 'Uses more than'}</span>
              {r.kind === 'cpu'
                ? <><input className="input" type="number" aria-label="Percent of a core" style={{ width: 64 }} value={r.threshold} min={10} max={1000} onChange={(e) => void saveRule({ ...r, threshold: Math.max(10, +e.target.value) })} /> <span>% of a core</span></>
                : <><input className="input" type="number" aria-label="Gigabytes of memory" style={{ width: 64 }} value={Math.round(r.threshold / 1024 ** 3)} min={1} onChange={(e) => void saveRule({ ...r, threshold: Math.max(1, +e.target.value) * 1024 ** 3 })} /> <span>GB of memory</span></>}
              <span>for</span>
              <input className="input" type="number" aria-label="Minutes" style={{ width: 56 }} value={r.minutes} min={1} max={120} onChange={(e) => void saveRule({ ...r, minutes: Math.max(1, +e.target.value) })} />
              <span>minutes</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>You get a notification with the app’s name; quitting is always your choice.</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card pad">
          <h3 style={{ marginBottom: 8 }}>Coding agents</h3>
          {!agents.length ? <span className="small muted">No Claude Code or Codex sessions in the last few hours.</span> : agents.map((a) => (
            <div key={a.id} className="row small" style={{ padding: '5px 0' }}>
              <span className={`badge ${a.state === 'waiting' || a.state === 'stuck' ? 'warn' : a.state === 'working' ? 'accent' : 'ok'}`}>{a.state}</span>
              <span className="grow ellipsis" title={a.summary}><b>{a.project}</b> <span className="muted">· {a.tool} · {relativeTime(a.updatedAt)}</span></span>
              <button className="btn ghost sm" onClick={() => void api.island.openAgent(a.id)}>Open</button>
              {a.cwd && (a.state === 'working' || a.state === 'waiting' || a.state === 'stuck') ? (
                <button className="btn ghost sm" onClick={async () => { const n = await api.monitor.stopAgent(a.cwd!); toast(n ? `Stopped ${a.project}` : 'That session is no longer running'); }}>Stop</button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 8 }}>Containers</h3>
          {!docker ? <span className="small muted">Checking…</span> : !docker.available ? <span className="small muted">Docker is not running on this computer.</span> : !docker.containers.length ? <span className="small muted">No containers.</span> : docker.containers.map((c) => (
            <div key={c.id} className="row small" style={{ padding: '5px 0' }}>
              <span className={`badge ${c.state === 'running' ? 'ok' : ''}`}>{c.state}</span>
              <span className="grow ellipsis" title={`${c.image} · ${c.status} ${c.ports}`}><b>{c.name}</b> <span className="muted">· {c.image}</span></span>
              {c.state === 'running' ? (
                <>
                  <button className="btn ghost sm" onClick={async () => { await api.monitor.dockerAction(c.id, 'restart'); load(); }}>Restart</button>
                  <button className="btn ghost sm" onClick={async () => { await api.monitor.dockerAction(c.id, 'stop'); load(); }}>Stop</button>
                </>
              ) : <button className="btn ghost sm" onClick={async () => { await api.monitor.dockerAction(c.id, 'start'); load(); }}>Start</button>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="card pad">
          <h3 style={{ marginBottom: 8 }}>Temperatures and disks</h3>
          {temps === undefined ? <span className="small muted">Reading sensors…</span> : temps === null ? <div className="small muted">This system does not share temperatures without administrator access.</div> : temps.map((th) => (
            <div key={th.label} className="row small" style={{ padding: '3px 0' }}><span className="grow">{th.label}</span><b className="num" style={{ color: th.celsius > 85 ? 'var(--danger)' : th.celsius > 70 ? 'var(--warn)' : undefined }}>{th.celsius}°C</b></div>
          ))}
          <div className="divider" />
          {disks === undefined ? <span className="small muted">Checking disks…</span> : !disks ? <div className="small muted">Disk health is not available (install smartmontools for detailed checks).</div> : disks.map((dk) => (
            <div key={dk.device} className="row small" style={{ padding: '3px 0' }}><span className="grow">{dk.device}</span><span className={`badge ${dk.healthy ? 'ok' : 'danger'}`}>{dk.healthy ? 'Healthy' : 'Failing'}</span><span className="muted">{dk.detail}</span></div>
          ))}
        </div>
        <div className="card pad">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>Internet speed</h3>
            <button className="btn sm" disabled={testing} onClick={() => void speedTest()}>{testing ? <><span className="spinner" /> Testing…</> : 'Run test'}</button>
          </div>
          {speeds.length ? (
            <>
              <div className="row" style={{ gap: 24 }}>
                <div className="stat"><span className="v">{speeds[speeds.length - 1].downMbps}</span><span className="l">Mbps down</span></div>
                <div className="stat"><span className="v">{speeds[speeds.length - 1].upMbps}</span><span className="l">Mbps up</span></div>
                <div className="stat"><span className="v">{speeds[speeds.length - 1].pingMs}</span><span className="l">ms ping</span></div>
              </div>
              {speeds.length > 1 ? <Chart height={110} labels={speeds.map((s) => new Date(s.t).toLocaleDateString([], { month: 'short', day: 'numeric' }))} series={[{ label: 'Download', color: 'var(--c-installer)', values: speeds.map((s) => s.downMbps), format: (v) => `${v} Mbps` }, { label: 'Upload', color: 'var(--c-video)', values: speeds.map((s) => s.upMbps), format: (v) => `${v} Mbps` }]} /> : null}
            </>
          ) : <span className="small muted">Measures download, upload and latency against a nearby public test server. Nothing else is sent.</span>}
        </div>
      </div>
    </div>
  );
}
