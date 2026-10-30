// SPDX-License-Identifier: AGPL-3.0-or-later
// Health: how hard your computer is working right now, and what keeps it awake.

import { useEffect, useState } from 'react';
import type { HealthReport } from '../../core/api';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead } from '../components/ui';
import { useStore } from '../state';
import { Ring } from './Protection';
import '../styles/screens-b.css';

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function Health() {
  const { toast } = useStore();
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
    const ok = await api.system.killProcess(p.pid);
    toast(ok ? `Quit ${p.name}` : `Could not quit ${p.name}`);
  };

  if (error && !h) return <Empty icon="warning" title="Could not read system health">{error}</Empty>;
  if (!h) return <Loading label="Reading system health…" />;
  const usedMem = h.memory.total - h.memory.free;
  const memPct = (usedMem / h.memory.total) * 100;
  const tone = (v: number) => (v > 85 ? 'var(--danger)' : v > 60 ? 'var(--warn)' : 'var(--ok)');

  return (
    <div>
      <PageHead title="Health" sub={`${h.cpuModel} · ${h.cores} cores · up ${uptime(h.uptimeSec)}`} />
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
          <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Busiest apps</h3></div>
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
