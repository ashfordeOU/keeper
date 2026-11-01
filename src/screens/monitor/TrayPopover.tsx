// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pop-over under the menu-bar readings: every reading with a sparkline,
// the busiest apps right now, and one click to Health, history or the tool
// launcher. Readings run only while it is open.

import { useEffect, useState } from 'react';
import type { LiveReading } from '../../../core/monitor-tray';
import { metricText, metricValue, scaleFor, TRAY_METRICS, type TrayMetric } from '../../../core/monitor-tray';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Sparkline, tone, useLive, useVisibleInterval } from './common';

const SETTINGS = { netUnit: 'bytes', memShows: 'used', tempUnit: 'c' } as const;
const COLOR: Partial<Record<TrayMetric, string>> = { cpu: 'var(--accent)', mem: 'var(--c-video)', net: 'var(--ok)', disk: 'var(--c-document)', gpu: 'var(--c-installer)', temp: 'var(--danger)', power: 'var(--c-audio)', battery: 'var(--ok)' };

export function TrayPopover() {
  const { latest, recent } = useLive(1000);
  const [top, setTop] = useState<{ name: string; cpu: number }[]>([]);
  // The busiest apps, only while the pop-over is on screen.
  useVisibleInterval(() => void api.procs.sample({ disk: false }).then((s) => setTop([...s.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 5).map((p) => ({ name: p.name, cpu: p.cpu })))).catch(() => undefined), 2000);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && void api.sysmon.closeWindow();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const open = (route: string) => { void api.sysmon.closeWindow(); void openMain(route); };
  const shown = TRAY_METRICS.filter((m) => latest && metricValue(m.id, latest, SETTINGS) !== undefined);
  return (
    <div className="mon-pop">
      <header><Icon name="bolt" size={14} /><b>This computer</b><span className="small muted">{latest ? `${latest.perCore?.length ?? ''} cores` : ''}</span></header>
      <div className="rows">
        {!latest ? <span className="muted">Reading…</span> : shown.map((m) => {
          const vals = recent.map((r: LiveReading) => metricValue(m.id, r, SETTINGS));
          const pct = m.id === 'cpu' || m.id === 'mem' || m.id === 'gpu' ? metricValue(m.id, latest, SETTINGS) : undefined;
          return (
            <div key={m.id} className="row-m">
              <span className="muted">{m.label}</span>
              <Sparkline values={vals} max={scaleFor(m.id, vals.filter((v): v is number => typeof v === 'number'))} color={COLOR[m.id]} width={150} height={22} />
              <span className="v" style={{ color: pct !== undefined ? tone(pct) : undefined }}>{metricText(m.id, latest, SETTINGS)}</span>
            </div>
          );
        })}
      </div>
      {top.length ? <div className="top-apps"><div className="muted small"><span>Busiest now</span><span>CPU</span></div>{top.map((p, i) => <div key={`${p.name}-${i}`}><span className="ellipsis">{p.name}</span><span className="num">{p.cpu.toFixed(1)}%</span></div>)}</div> : null}
      <footer>
        <button className="btn sm" onClick={() => open('health')}>Health</button>
        <button className="btn sm" onClick={() => open('health:history')}>History</button>
        <button className="btn sm" onClick={() => { void api.sysmon.closeWindow(); void api.sysmon.openLauncher(); }}>Tools</button>
      </footer>
    </div>
  );
}

/** Opens the main window on a page (through the launcher's page entries, which do exactly that). */
function openMain(route: string) {
  return api.sysmon.openTool(`page:${route}`);
}
