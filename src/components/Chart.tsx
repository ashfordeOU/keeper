// SPDX-License-Identifier: AGPL-3.0-or-later
// Small SVG charts (area/line and bars) with a hover read-out. No libraries.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface Series {
  values: (number | null)[];
  color: string;
  label: string;
  /** draw as bars instead of an area */
  bars?: boolean;
  /** use the right-hand scale */
  right?: boolean;
  format?: (v: number) => string;
}

export function Chart({ series, labels, height = 140, min, max, rightMax, yFormat }: { series: Series[]; labels: string[]; height?: number; min?: number; max?: number; rightMax?: number; yFormat?: (v: number) => string }) {
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so text and lines are never stretched.
  const [W, setW] = useState(600);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 34, r: series.some((s) => s.right) ? 34 : 8, t: 8, b: 20 };
  const n = labels.length;
  const left = series.filter((s) => !s.right).flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = min ?? Math.min(0, ...left);
  const hi = max ?? Math.max(1, ...left) * 1.08;
  const rhi = rightMax ?? Math.max(1, ...series.filter((s) => s.right).flatMap((s) => s.values.filter((v): v is number => v !== null))) * 1.1;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number, right?: boolean) => pad.t + (1 - (v - (right ? 0 : lo)) / ((right ? rhi : hi) - (right ? 0 : lo) || 1)) * (H - pad.t - pad.b);
  const fmt = yFormat ?? ((v: number) => String(Math.round(v)));
  const ticks = useMemo(() => [lo, lo + (hi - lo) / 2, hi], [lo, hi]);

  const paths = series.map((s) => {
    if (s.bars) return null;
    let d = '';
    let area = '';
    let start = -1;
    s.values.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v, s.right).toFixed(1)}`;
      if (start < 0) start = i;
    });
    if (start >= 0) {
      const last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
      area = `${d}L${x(last).toFixed(1)},${y(s.right ? 0 : lo, s.right).toFixed(1)}L${x(start).toFixed(1)},${y(s.right ? 0 : lo, s.right).toFixed(1)}Z`;
    }
    return { d, area };
  });

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 70))));
  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={pad.l - 6} y={y(tv) + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">{fmt(tv)}</text>
          </g>
        ))}
        {series.map((s, si) =>
          s.bars ? (
            s.values.map((v, i) => (v === null || v <= 0 ? null : (
              <rect key={`${si}-${i}`} x={x(i) - Math.max(1.5, (W - pad.l - pad.r) / n / 2.6)} width={Math.max(3, (W - pad.l - pad.r) / n / 1.3)} y={y(v, s.right)} height={Math.max(0, y(s.right ? 0 : lo, s.right) - y(v, s.right))} fill={s.color} opacity={0.55} rx={1.5} />
            )))
          ) : (
            <g key={si}>
              <path d={paths[si]!.area} fill={s.color} opacity={0.14} />
              <path d={paths[si]!.d} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ),
        )}
        {labels.map((l, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--text-3)">{l}</text> : null))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--text-3)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {hover !== null ? (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted">{labels[hover]}</div>
          {series.map((s) => {
            const v = s.values[hover];
            return v === null || v === undefined ? null : <div key={s.label}><span className="dot" style={{ background: s.color }} /> {s.label}: <b>{(s.format ?? fmt)(v)}</b></div>;
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', height = 32 }: { values: (number | null)[]; color?: string; height?: number }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <svg height={height} />;
  const hi = Math.max(...nums, 1);
  const W = 120;
  const pts = values.map((v, i) => (v === null ? null : `${((i / (values.length - 1)) * W).toFixed(1)},${(height - 2 - (v / hi) * (height - 4)).toFixed(1)}`)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
