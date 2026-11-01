// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Containers: Docker or Podman containers with live use, the
// engine's disk use, and stop, start, restart and pause per container.

import { useCallback, useState } from 'react';
import { formatBytes } from '../../../core/format';
import type { ContainerAction, ContainerRow, DiskUse, Engine } from '../../../core/monitor-containers';
import { api } from '../../api';
import { Empty, Loading } from '../../components/ui';
import { useStore } from '../../state';
import { ConfirmButton, tone, useVisibleInterval } from './common';

export function HealthContainers() {
  const { toast } = useStore();
  const [v, setV] = useState<{ engine: Engine | null; containers: ContainerRow[]; disk: DiskUse[]; note?: string } | null>(null);
  const load = useCallback(() => void api.sysmon.containers().then(setV).catch(() => setV({ engine: null, containers: [], disk: [], note: 'Could not ask the container engine.' })), []);
  useVisibleInterval(load, 5000, [load]);
  const act = async (c: ContainerRow, a: ContainerAction) => {
    const r = await api.sysmon.containerAction(c.id, a);
    toast(r.message);
    setTimeout(load, 500);
  };
  if (!v) return <Loading label="Asking Docker or Podman…" />;
  if (!v.engine) return <Empty icon="server" title="No container engine running">{v.note ?? 'Start Docker or Podman to see containers here.'}</Empty>;
  const running = v.containers.filter((c) => c.state === 'running');
  const reclaim = v.disk.reduce((n, d) => n + d.reclaimable, 0);
  return (
    <div>
      <div className="mon-tiles">
        <div className="card mon-tile"><span className="lbl">{v.engine === 'docker' ? 'Docker' : 'Podman'}</span><span className="val">{running.length} running</span><span className="sub">{v.containers.length - running.length} stopped</span></div>
        <div className="card mon-tile"><span className="lbl">Processor</span><span className="val">{running.reduce((n, c) => n + (c.cpu ?? 0), 0).toFixed(1)}%</span><span className="sub">of one core, all containers</span></div>
        <div className="card mon-tile"><span className="lbl">Memory</span><span className="val">{formatBytes(running.reduce((n, c) => n + (c.memUsed ?? 0), 0))}</span><span className="sub">in use by containers</span></div>
        <div className="card mon-tile"><span className="lbl">Disk</span><span className="val">{formatBytes(v.disk.reduce((n, d) => n + d.size, 0))}</span><span className="sub">{formatBytes(reclaim)} could be freed</span></div>
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Container</th><th>State</th><th>CPU</th><th>Memory</th><th>Network in / out</th><th>Disk read / write</th><th /></tr></thead>
          <tbody>
            {v.containers.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="small muted ellipsis" style={{ maxWidth: 260 }} title={`${c.image} · ${c.id}${c.ports ? ` · ${c.ports}` : ''}`}>{c.image}{c.ports ? ` · ${c.ports}` : ''}</div></td>
                <td><span className="mon-kind small"><span className={`mon-dot${c.state === 'running' ? '' : c.state === 'paused' ? ' warn' : ' idle'}`} />{c.status || c.state}</span></td>
                <td className="num" style={{ color: c.cpu !== undefined ? tone(c.cpu) : undefined }}>{c.cpu !== undefined ? `${c.cpu.toFixed(1)}%` : '—'}</td>
                <td className="num">{c.memUsed ? formatBytes(c.memUsed) : '—'}</td>
                <td className="num small">{c.netIn !== undefined ? `${formatBytes(c.netIn)} / ${formatBytes(c.netOut ?? 0)}` : '—'}</td>
                <td className="num small">{c.blockRead !== undefined ? `${formatBytes(c.blockRead)} / ${formatBytes(c.blockWrite ?? 0)}` : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {c.state === 'running' ? (
                    <>
                      <button className="btn ghost sm" onClick={() => void act(c, 'pause')}>Pause</button>
                      <ConfirmButton label="Restart" confirm="Restart it?" onConfirm={() => act(c, 'restart')} />
                      <ConfirmButton label="Stop" confirm="Stop it?" onConfirm={() => act(c, 'stop')} />
                    </>
                  ) : c.state === 'paused' ? <button className="btn ghost sm" onClick={() => void act(c, 'unpause')}>Resume</button> : <button className="btn ghost sm" onClick={() => void act(c, 'start')}>Start</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.disk.length ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Disk use</h3><span className="small muted">“system df” of the engine</span></div>
          <table className="table">
            <thead><tr><th>Kind</th><th>Total</th><th>In use</th><th>Size</th><th>Could be freed</th></tr></thead>
            <tbody>{v.disk.map((d) => <tr key={d.type}><td>{d.type}</td><td className="num">{d.total}</td><td className="num">{d.active}</td><td className="num">{formatBytes(d.size)}</td><td className="num">{formatBytes(d.reclaimable)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
