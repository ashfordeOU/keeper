// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → History: up to a year of processor, memory, network, disk,
// graphics, temperature and power, at the best resolution for the range.
// Drag across a chart to zoom in; peaks, the apps that worked hardest, CSV.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryView } from '../../../core/api-sysmon';
import { formatBytes } from '../../../core/format';
import { series, type Metric } from '../../../core/monitor-history';
import { shortRate } from '../../../core/monitor-tray';
import { api } from '../../api';
import { Chart, type Series } from '../../components/Chart';
import { Empty, Loading } from '../../components/ui';
import { useStore } from '../../state';
import { ConfirmButton, rate } from './common';

const H = 3600_000;
const D = 24 * H;
const RANGES: { id: string; label: string; ms: number }[] = [
  { id: '1h', label: '1 hour', ms: H },
  { id: '6h', label: '6 hours', ms: 6 * H },
  { id: '24h', label: 'Day', ms: D },
  { id: '7d', label: 'Week', ms: 7 * D },
  { id: '30d', label: 'Month', ms: 30 * D },
  { id: '90d', label: '3 months', ms: 90 * D },
  { id: '365d', label: 'Year', ms: 365 * D },
];

const TIER_LABEL: Record<string, string> = { '1m': 'every minute', '5m': 'every 5 minutes', '1h': 'hourly', '1d': 'daily' };
const PEAK_LABEL: Record<string, [string, (v: number) => string]> = {
  cpu: ['Processor', (v) => `${Math.round(v)}%`], mem: ['Memory', (v) => `${Math.round(v)}%`], netIn: ['Download', rate], netOut: ['Upload', rate],
  diskR: ['Disk read', rate], diskW: ['Disk write', rate], gpu: ['Graphics', (v) => `${Math.round(v)}%`], power: ['Power', (v) => `${v.toFixed(1)} W`], temp: ['Temperature', (v) => `${Math.round(v)} °C`],
};

function when(t: number, span: number): string {
  const d = new Date(t);
  if (span <= 2 * D) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (span <= 120 * D) return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (span <= 8 * D ? ` ${d.toLocaleTimeString([], { hour: '2-digit' })}` : '');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

const stamp = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A chart you can drag across to zoom into that part. */
function ZoomChart({ title, sub, series: s, labels, onZoom, ...rest }: { title: string; sub?: string; series: Series[]; labels: string[]; onZoom: (a: number, b: number) => void; max?: number; yFormat?: (v: number) => string; rightMax?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const frac = (x: number) => {
    const r = box.current!.getBoundingClientRect();
    const l = 34;
    const w = r.width - l - 8;
    return Math.min(1, Math.max(0, (x - r.left - l) / w));
  };
  return (
    <div className="card mon-chart">
      <h4>{title}{sub ? <span className="muted">{sub}</span> : null}</h4>
      <div
        ref={box}
        className="mon-zoom"
        onMouseDown={(e) => { const f = frac(e.clientX); setDrag({ a: f, b: f }); }}
        onMouseMove={(e) => drag && setDrag({ ...drag, b: frac(e.clientX) })}
        onMouseUp={() => {
          if (drag && Math.abs(drag.b - drag.a) > 0.02) onZoom(Math.min(drag.a, drag.b), Math.max(drag.a, drag.b));
          setDrag(null);
        }}
        onMouseLeave={() => setDrag(null)}
      >
        <Chart series={s} labels={labels} height={150} {...rest} />
        {drag ? <div className="sel" style={{ left: `calc(34px + (100% - 42px) * ${Math.min(drag.a, drag.b)})`, width: `calc((100% - 42px) * ${Math.abs(drag.b - drag.a)})` }} /> : null}
      </div>
    </div>
  );
}

export function HealthHistory() {
  const { toast } = useStore();
  const [range, setRange] = useState('24h');
  // A zoomed window [from, to] inside the range, or null for the whole range.
  const [zoom, setZoom] = useState<[number, number][]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [v, setV] = useState<HistoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const span = RANGES.find((r) => r.id === range)!.ms;
  const [from, to] = zoom.length ? zoom[zoom.length - 1] : [now - span, now];

  useEffect(() => {
    let alive = true;
    void api.sysmon.history(from, to, 360).then((r) => alive && (setV(r), setErr(null))).catch((e: unknown) => alive && setErr(String(e)));
    return () => { alive = false; };
  }, [from, to]);
  // Follow the present once a minute while not zoomed.
  useEffect(() => {
    if (zoom.length) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [zoom.length]);

  const q = v ? { tier: v.tier, step: v.step, points: v.points } : null;
  const n = q ? Math.max(1, Math.round((to - from) / q.step)) : 0;
  const labels = useMemo(() => Array.from({ length: n }, (_, i) => when(from + i * (q?.step ?? 1), to - from)), [n, from, to, q?.step]);
  const get = (m: Metric) => (q ? series(q, m, from, to) : []);
  const has = (m: Metric) => get(m).some((x) => x !== null);

  const zoomTo = (a: number, b: number) => {
    const f = from + (to - from) * a;
    const t = from + (to - from) * b;
    // Never closer than ten minutes.
    if (t - f < 10 * 60_000) return;
    setZoom([...zoom, [f, t]]);
  };

  if (err && !v) return <Empty icon="warning" title="Could not read the history">{err}</Empty>;
  if (!v) return <Loading label="Reading history…" />;
  const empty = !v.points.length;

  return (
    <div>
      <div className="mon-toolbar">
        <div className="seg" role="tablist" aria-label="Range">
          {RANGES.map((r) => <button key={r.id} className={range === r.id && !zoom.length ? 'on' : ''} onClick={() => { setRange(r.id); setZoom([]); setNow(Date.now()); }}>{r.label}</button>)}
        </div>
        {zoom.length ? <button className="btn ghost sm" onClick={() => setZoom(zoom.slice(0, -1))}>Zoom out</button> : null}
        <span className="grow" />
        <span className="mon-hint">{stamp(from)} – {stamp(to)} · {TIER_LABEL[v.tier]}{v.oldest ? ` · history since ${new Date(v.oldest).toLocaleDateString()}` : ''}</span>
        <button className="btn ghost sm" onClick={async () => { const p = await api.sysmon.exportCsv(from, to); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }}>Export CSV</button>
      </div>

      {empty ? (
        <Empty icon="clock" title="No history for this time yet">Keeper adds a point every minute while Health is on, and keeps up to a year (Health → Settings).</Empty>
      ) : (
        <>
          <div className="mon-charts">
            <ZoomChart title="Processor" sub="average and busiest minute" labels={labels} max={100} yFormat={(x) => `${Math.round(x)}%`} onZoom={zoomTo}
              series={[{ label: 'Average', values: get('cpu'), color: 'var(--accent)', format: (x) => `${x.toFixed(1)}%` }, { label: 'Peak', values: get('cpuMax'), color: 'var(--warn)', format: (x) => `${x.toFixed(1)}%` }]} />
            <ZoomChart title="Memory" sub="share in use" labels={labels} max={100} yFormat={(x) => `${Math.round(x)}%`} onZoom={zoomTo}
              series={[{ label: 'Average', values: get('mem'), color: 'var(--c-video)', format: (x) => `${x.toFixed(1)}%` }, { label: 'Peak', values: get('memMax'), color: 'var(--danger)', format: (x) => `${x.toFixed(1)}%` }]} />
            {has('netIn') || has('netOut') ? (
              <ZoomChart title="Network" labels={labels} yFormat={(x) => shortRate(x)} onZoom={zoomTo}
                series={[{ label: 'Download', values: get('netIn'), color: 'var(--ok)', format: rate }, { label: 'Upload', values: get('netOut'), color: 'var(--c-audio)', format: rate }]} />
            ) : null}
            {has('diskR') || has('diskW') ? (
              <ZoomChart title="Disk" labels={labels} yFormat={(x) => shortRate(x)} onZoom={zoomTo}
                series={[{ label: 'Read', values: get('diskR'), color: 'var(--c-document)', format: rate }, { label: 'Write', values: get('diskW'), color: 'var(--c-image)', format: rate }]} />
            ) : null}
            {has('gpu') ? <ZoomChart title="Graphics" labels={labels} max={100} yFormat={(x) => `${Math.round(x)}%`} onZoom={zoomTo} series={[{ label: 'Busy', values: get('gpu'), color: 'var(--c-installer)', format: (x) => `${x.toFixed(1)}%` }]} /> : null}
            {has('power') || has('temp') ? (
              <ZoomChart title="Power and heat" labels={labels} onZoom={zoomTo} yFormat={(x) => `${Math.round(x)}`}
                series={[...(has('power') ? [{ label: 'Watts', values: get('power'), color: 'var(--c-audio)', format: (x: number) => `${x.toFixed(1)} W` }] : []), ...(has('temp') ? [{ label: '°C', values: get('temp'), color: 'var(--danger)', right: true, format: (x: number) => `${Math.round(x)} °C` }] : [])]} />
            ) : null}
            {has('battery') ? <ZoomChart title="Battery" labels={labels} max={100} yFormat={(x) => `${Math.round(x)}%`} onZoom={zoomTo} series={[{ label: 'Charge', values: get('battery'), color: 'var(--ok)', format: (x) => `${Math.round(x)}%` }]} /> : null}
          </div>
          <p className="mon-hint" style={{ margin: '6px 2px 16px' }}>Drag across a chart to zoom in.</p>

          <div className="grid cols-2">
            <div className="card pad">
              <h3 style={{ marginBottom: 10 }}>Peaks</h3>
              <div className="mon-peaks">
                {v.peaks.map((p) => {
                  const [label, fmt] = PEAK_LABEL[p.metric] ?? [p.metric, String];
                  return <div key={p.metric} className="mon-peak"><span>{label}</span><b>{fmt(p.value)}</b><span>{new Date(p.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>;
                })}
              </div>
            </div>
            <div className="card">
              <div className="section-head" style={{ padding: '12px 14px 0' }}><h3>Worked hardest</h3><span className="small muted">processor time over this range</span></div>
              {v.top.length ? (
                <table className="table">
                  <thead><tr><th>App</th><th>Processor time</th><th>Average</th><th>Most memory</th></tr></thead>
                  <tbody>
                    {v.top.slice(0, 10).map((a) => (
                      <tr key={a.name}><td className="ellipsis" style={{ maxWidth: 200 }}>{a.name}</td><td className="num">{a.cpuMinutes >= 60 ? `${(a.cpuMinutes / 60).toFixed(1)} h` : `${a.cpuMinutes} min`}</td><td className="num">{a.avgCpu}%</td><td className="num">{formatBytes(a.peakMem)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="small muted" style={{ padding: '0 14px 12px' }}>Nothing recorded for this range.</p>}
            </div>
          </div>
        </>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <ConfirmButton label="Delete all history…" confirm="Delete it all?" onConfirm={async () => { await api.sysmon.clearHistory(); setNow(Date.now()); setZoom([]); toast('History deleted'); }} />
      </div>
    </div>
  );
}
