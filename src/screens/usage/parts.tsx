// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shared pieces of the AI usage tracker: the overview (kept fresh while on
// screen), rings, bars, sparklines, one limit row and the provider badge.

import { useCallback, useEffect, useState } from 'react';
import type { UsageOverview } from '../../../core/api-ai-usage';
import { amountText, countdown, providerInfo, type Account, type Limit } from '../../../core/usage-tracker/model';
import type { HistoryPoint, PriorityItem } from '../../../core/usage-tracker/priority';
import { api } from '../../api';
import '../../styles/ai-usage.css';

/** The tracker's overview; updates when the main process says something changed. */
export function useUsage(): { o: UsageOverview | null; reload: () => void; refresh: () => Promise<void>; busy: boolean } {
  const [o, setO] = useState<UsageOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => void api.aiUsage.overview().then(setO).catch(() => undefined), []);
  useEffect(() => {
    reload();
    const off = api.on('ai-usage' as never, () => reload());
    const vis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', vis);
    // Countdowns tick while shown.
    const t = setInterval(() => { if (document.visibilityState === 'visible') setO((x) => (x ? { ...x } : x)); }, 30_000);
    return () => { off?.(); document.removeEventListener('visibilitychange', vis); clearInterval(t); };
  }, [reload]);
  const refresh = async () => {
    setBusy(true);
    try { setO(await api.aiUsage.refresh()); } finally { setBusy(false); }
  };
  return { o, reload, refresh, busy };
}

export function toneOf(left: number | undefined, urgency?: PriorityItem['urgency']): string {
  if (urgency === 'used-up' || (left !== undefined && left <= 2)) return 'var(--danger)';
  if (urgency === 'running-out' || (left !== undefined && left <= 30)) return 'var(--warn)';
  return 'var(--ok)';
}

/** A circular ring of the share left, with the provider's letters inside. */
export function Ring({ left, color, glyph, size = 34, track = 'var(--bg-active)' }: { left?: number; color: string; glyph?: string; size?: number; track?: string }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const f = left === undefined ? 0 : Math.max(0, Math.min(1, left / 100));
  return (
    <span className="uring" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={3.5} />
        {left !== undefined ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} /> : null}
      </svg>
      {glyph ? <span className="glyph">{glyph}</span> : null}
    </span>
  );
}

export function Badge({ a }: { a: Pick<Account, 'provider' | 'color' | 'icon'> }) {
  const info = providerInfo(a.provider);
  return <span className="ubadge" style={{ background: a.color ?? info.color }}>{a.icon && a.icon.length <= 2 ? a.icon : info.glyph}</span>;
}

export function Bar({ pct, color }: { pct: number; color: string }) {
  return <div className="ubar" role="presentation"><i style={{ width: `${Math.max(1, Math.min(100, pct))}%`, background: color }} /></div>;
}

/** A small line of the share used (or the amount) over the last week. */
export function Spark({ points, color = 'var(--accent)', width = 64, height = 22 }: { points: HistoryPoint[]; color?: string; width?: number; height?: number }) {
  const vals = points.map((p) => p.p ?? p.u).filter((v): v is number => typeof v === 'number');
  if (vals.length < 2) return <svg className="sp" width={width} height={height} aria-hidden />;
  const usePct = points.some((p) => p.p !== undefined);
  const max = usePct ? 100 : Math.max(...vals) || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const d = points.filter((p) => (p.p ?? p.u) !== undefined).map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / Math.max(1, t1 - t0)) * (width - 2) + 1).toFixed(1)},${(height - 1 - (((p.p ?? p.u)! / max) * (height - 2))).toFixed(1)}`).join(' ');
  return <svg className="sp" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden><path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}

export const resetText = (l: Limit, now = Date.now()) => (l.resetsAt ? countdown(l.resetsAt - now) : '');

/** One row of the Priority tab. */
export function PriorityRow({ i }: { i: PriorityItem }) {
  const reset = resetText(i.limit);
  const out = i.urgency === 'used-up';
  return (
    <div className={`urow ${out ? 'out' : ''}`} data-testid="usage-row" data-account={i.accountId} data-limit={i.limit.key}>
      <Ring left={i.left} color={out ? 'var(--text-3)' : i.color} glyph={i.icon && i.icon.length <= 2 ? i.icon : i.glyph} />
      <div className="who">
        <b>{i.limit.label}{i.limit.estimated ? <span className="muted" style={{ fontWeight: 400 }}> · estimated</span> : null}</b>
        <span>{i.accountName}{i.urgency === 'running-out' && i.runsOutAt && (i.left ?? 0) > 0 ? ` · runs out in ${countdown(i.runsOutAt - Date.now())}` : ''}</span>
      </div>
      <div className="num">
        <b>{out ? 'Used up' : `${Math.round(i.left ?? 0)}% left`}</b>
        <span>{reset ? (out || i.urgency === 'expiring' ? `resets in ${reset}` : reset) : ''}</span>
      </div>
    </div>
  );
}

/** One limit of the All Metrics tab: a bar, the amounts and a sparkline. */
export function MetricRow({ l, item, points, color }: { l: Limit; item?: PriorityItem; points: HistoryPoint[]; color: string }) {
  const left = l.usedPercent === undefined ? undefined : 100 - l.usedPercent;
  const amount = amountText(l);
  return (
    <div className="umet" data-testid="usage-metric">
      <div className="top"><span>{l.label}{l.estimated ? <span className="muted"> · estimated</span> : null}</span><em>{left !== undefined ? `${Math.round(left)}% left` : amount}</em></div>
      {l.usedPercent !== undefined ? <Bar pct={l.usedPercent} color={item?.urgency === 'used-up' ? 'var(--text-3)' : toneOf(left, item?.urgency) === 'var(--ok)' ? color : toneOf(left, item?.urgency)} /> : null}
      <div className="sub">{left !== undefined && amount ? <span>{amount}</span> : null}{l.resetsAt ? <span>{l.key === 'renewal' ? 'renews in' : 'resets in'} {resetText(l)}</span> : null}{l.note ? <span>{l.note}</span> : null}</div>
      <Spark points={points} color={color} />
    </div>
  );
}
