// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shared pieces of the monitor screens: live readings while the page is
// visible, a tiny sparkline, rates and a confirm button.

import { useEffect, useState } from 'react';
import type { LiveReading } from '../../../core/monitor-tray';
import { api } from '../../api';
import '../../styles/monitor.css';

/** Live readings, only while this page is on screen: hidden or closed, the readings stop. */
export function useLive(everyMs = 1000): { latest?: LiveReading; recent: LiveReading[] } {
  const [s, setS] = useState<{ latest?: LiveReading; recent: LiveReading[] }>({ recent: [] });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void api.sysmon.watch(true).then((r) => alive && setS(r)).catch(() => undefined);
      clearInterval(timer);
      timer = setInterval(() => void api.sysmon.live().then((r) => alive && setS(r)).catch(() => undefined), everyMs);
    };
    const stop = () => {
      clearInterval(timer);
      void api.sysmon.watch(false).catch(() => undefined);
    };
    const vis = () => (document.visibilityState === 'hidden' ? stop() : start());
    start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', vis);
      stop();
    };
  }, [everyMs]);
  return s;
}

/** Re-runs `fn` every `ms` while the page is visible. */
export function useVisibleInterval(fn: () => void, ms: number, deps: unknown[] = []) {
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      fn();
      clearInterval(t);
      t = setInterval(fn, ms);
    };
    const vis = () => (document.visibilityState === 'hidden' ? clearInterval(t) : start());
    start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function Sparkline({ values, max, color = 'var(--accent)', width = 120, height = 28 }: { values: (number | undefined | null)[]; max?: number; color?: string; width?: number; height?: number }) {
  const nums = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const hi = max ?? Math.max(1, ...nums.filter((v): v is number => v !== null)) * 1.1;
  const n = Math.max(2, nums.length);
  const pts = nums.map((v, i) => (v === null ? null : [(i / (n - 1)) * width, height - (Math.min(hi, Math.max(0, v)) / hi) * (height - 2) - 1] as const));
  const line = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join('');
  const first = pts.find(Boolean);
  const last = [...pts].reverse().find(Boolean);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {line && first && last ? <path d={`${line}L${last[0]},${height}L${first[0]},${height}Z`} fill={color} opacity={0.16} /> : null}
      {line ? <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /> : null}
    </svg>
  );
}

/** "1.2 MB/s" */
export function rate(bps: number | undefined): string {
  if (bps === undefined || !Number.isFinite(bps)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = bps;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}/s`;
}

export function tone(pct: number | undefined): string {
  if (pct === undefined) return 'var(--text-3)';
  return pct >= 85 ? 'var(--danger)' : pct >= 60 ? 'var(--warn)' : 'var(--ok)';
}

/** A button that asks once more before doing something that cannot be undone. */
export function ConfirmButton({ label, confirm, onConfirm, className = 'btn ghost sm', disabled }: { label: string; confirm: string; onConfirm: () => void | Promise<void>; className?: string; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  return (
    <button
      className={`${className}${asking ? ' danger' : ''}`}
      disabled={disabled || busy}
      onClick={async () => {
        if (!asking) return setAsking(true);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setAsking(false);
        }
      }}
    >
      {busy ? <span className="spinner" /> : asking ? confirm : label}
    </button>
  );
}

/** Live tiles with sparklines for the Health overview: processor, memory, network, disk, graphics, power. */
export function LiveStrip() {
  const { latest, recent } = useLive(1000);
  if (!latest) return null;
  const pick = (f: (r: LiveReading) => number | undefined) => recent.map(f);
  const memPct = (r: LiveReading) => (r.memTotal ? (r.memUsed / r.memTotal) * 100 : undefined);
  const tiles: { label: string; val: string; sub?: string; vals: (number | undefined)[]; max?: number; color: string }[] = [
    { label: 'Processor', val: `${Math.round(latest.cpu)}%`, sub: latest.perCore ? `${latest.perCore.length} cores` : undefined, vals: pick((r) => r.cpu), max: 100, color: 'var(--accent)' },
    { label: 'Memory', val: `${Math.round(memPct(latest) ?? 0)}%`, vals: pick(memPct), max: 100, color: 'var(--c-video)' },
    { label: 'Network', val: `↓ ${rate(latest.netIn)}`, sub: `↑ ${rate(latest.netOut)}`, vals: pick((r) => (r.netIn ?? 0) + (r.netOut ?? 0)), color: 'var(--ok)' },
    { label: 'Disk', val: rate((latest.diskR ?? 0) + (latest.diskW ?? 0)), sub: latest.diskW !== undefined ? `read ${rate(latest.diskR)} · write ${rate(latest.diskW)}` : undefined, vals: pick((r) => (r.diskR ?? 0) + (r.diskW ?? 0)), color: 'var(--c-document)' },
  ];
  if (latest.gpu !== undefined) tiles.push({ label: 'Graphics', val: `${Math.round(latest.gpu)}%`, vals: pick((r) => r.gpu), max: 100, color: 'var(--c-installer)' });
  if (latest.power !== undefined) tiles.push({ label: 'Power', val: `${latest.power.toFixed(1)} W`, vals: pick((r) => r.power), color: 'var(--c-audio)' });
  if (latest.temp !== undefined) tiles.push({ label: 'Hottest', val: `${Math.round(latest.temp)} °C`, vals: pick((r) => r.temp), max: 105, color: 'var(--danger)' });
  return (
    <div className="mon-tiles" aria-label="Live readings">
      {tiles.map((t) => (
        <div key={t.label} className="card mon-tile">
          <span className="lbl">{t.label}</span>
          <span className="val">{t.val}</span>
          {t.sub ? <span className="sub">{t.sub}</span> : null}
          <Sparkline values={t.vals} max={t.max} color={t.color} width={160} height={26} />
        </div>
      ))}
    </div>
  );
}
