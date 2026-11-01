// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Sensors: graphics use, temperatures, fans and power draw, read
// only through public interfaces, and an honest list of what this system
// does not show.

import { useState } from 'react';
import { formatBytes } from '../../../core/format';
import type { Sensors } from '../../../core/monitor-sensors';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/ui';
import { tone, useVisibleInterval } from './common';

export function HealthSensors() {
  const [s, setS] = useState<Sensors | null>(null);
  useVisibleInterval(() => void api.sysmon.sensors().then(setS).catch(() => undefined), 4000);
  if (!s) return <Loading label="Reading sensors…" />;
  const watts = s.power.package ?? (s.power.battery !== undefined ? Math.abs(s.power.battery) : undefined);
  return (
    <div>
      <div className="mon-tiles">
        <div className="card mon-tile"><span className="lbl">Graphics</span><span className="val">{s.gpus.length ? `${Math.round(Math.max(...s.gpus.map((g) => g.util ?? 0)))}%` : '—'}</span><span className="sub">{s.gpus.length ? `${s.gpus.length} adapter${s.gpus.length === 1 ? '' : 's'}` : 'not available'}</span></div>
        <div className="card mon-tile"><span className="lbl">Hottest</span><span className="val" style={{ color: s.temps[0] ? tone(s.temps[0].celsius) : undefined }}>{s.temps[0] ? `${Math.round(s.temps[0].celsius)} °C` : '—'}</span><span className="sub">{s.temps[0]?.label ?? 'not published here'}</span></div>
        <div className="card mon-tile"><span className="lbl">Fans</span><span className="val">{s.fans.length ? `${Math.max(...s.fans.map((f) => f.rpm))} rpm` : '—'}</span><span className="sub">{s.fans.length ? `${s.fans.length} fan${s.fans.length === 1 ? '' : 's'}` : 'not published here'}</span></div>
        <div className="card mon-tile"><span className="lbl">Power</span><span className="val">{watts !== undefined ? `${watts.toFixed(1)} W` : '—'}</span><span className="sub">{s.power.package !== undefined ? 'processor package' : s.power.battery !== undefined ? (s.power.battery >= 0 ? 'from the battery' : 'charging the battery') : 'not available'}</span></div>
      </div>

      {s.gpus.length ? (
        <>
          <div className="section-head"><h3>Graphics</h3></div>
          <div className="mon-gpus">
            {s.gpus.map((g, i) => (
              <div key={`${g.name}-${i}`} className="card pad col" style={{ gap: 6 }}>
                <b>{g.name}</b>
                <div className="row small"><span className="grow">Busy{g.approx ? ' (estimated from clock speed)' : ''}</span><b className="num">{g.util !== undefined ? `${Math.round(g.util)}%` : '—'}</b></div>
                <div className="mon-bar"><i style={{ width: `${g.util ?? 0}%`, background: tone(g.util) }} /></div>
                {g.memTotal ? <div className="row small"><span className="grow">Memory</span><span className="num">{formatBytes(g.memUsed ?? 0)} of {formatBytes(g.memTotal)}</span></div> : null}
                {g.temp !== undefined ? <div className="row small"><span className="grow">Temperature</span><span className="num">{g.temp} °C</span></div> : null}
                {g.power !== undefined ? <div className="row small"><span className="grow">Power</span><span className="num">{g.power.toFixed(1)} W</span></div> : null}
                {g.procs?.length ? <div className="small muted">Using it: {g.procs.slice(0, 4).map((p) => `${p.name} (${formatBytes(p.memory)})`).join(', ')}</div> : null}
                <span className="small muted">{g.source}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Temperatures</h3></div>
          {s.temps.length ? (
            <table className="table"><tbody>{s.temps.slice(0, 16).map((t, i) => <tr key={`${t.label}-${i}`}><td>{t.label}</td><td className="num" style={{ color: tone(t.critical ? (t.celsius / t.critical) * 100 : t.celsius) }}>{t.celsius.toFixed(0)} °C</td><td className="small muted">{t.critical ? `limit ${t.critical} °C` : ''}</td></tr>)}</tbody></table>
          ) : <p className="small muted" style={{ padding: '0 14px 12px' }}>This system does not publish temperatures.</p>}
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="card">
            <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Fans</h3></div>
            {s.fans.length ? <table className="table"><tbody>{s.fans.map((f) => <tr key={f.label}><td>{f.label}</td><td className="num">{f.rpm} rpm</td><td className="small muted">{f.max ? `of ${f.max}` : ''}</td></tr>)}</tbody></table> : <p className="small muted" style={{ padding: '0 14px 12px' }}>No fan readings here.</p>}
          </div>
          <div className="card pad">
            <h3 style={{ marginBottom: 8 }}>Power draw</h3>
            {s.power.battery !== undefined ? <div className="row small"><span className="grow">Battery</span><b className="num">{s.power.battery >= 0 ? `${s.power.battery.toFixed(1)} W out` : `${Math.abs(s.power.battery).toFixed(1)} W in`}</b></div> : null}
            {s.power.domains?.map((d) => <div key={d.name} className="row small"><span className="grow">{d.name}</span><b className="num">{d.watts.toFixed(1)} W</b></div>)}
            {!s.power.source.length ? <p className="small muted">Not available here.</p> : <p className="small muted" style={{ marginTop: 6 }}>From {s.power.source.join(' and ')}.</p>}
          </div>
        </div>
      </div>

      {s.limits.length ? (
        <div className="card pad mon-limits">
          <h3 style={{ marginBottom: 6 }}><Icon name="info" size={14} /> What this computer does not show</h3>
          <ul>{s.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
