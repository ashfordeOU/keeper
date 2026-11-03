// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Small pieces the network view and the menu bar's network part share: a tiny
// sparkline, app icons from the system (asked once per path) and a letter tile
// when there is none.

import { useEffect, useState } from 'react';
import { api } from '../api';

/** A tiny line of the last readings; flat and quiet when nothing moves. */
export function Spark({ values, w = 64, h = 18, label }: { values: number[]; w?: number; h?: number; label?: string }) {
  const hi = Math.max(1, ...values);
  const pts = values.length < 2 ? `0,${h - 1} ${w},${h - 1}` : values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - (v / hi) * (h - 3)).toFixed(1)}`).join(' ');
  return (
    <svg className="nm-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const iconCache = new Map<string, string>();
/** App icons from the system, asked once per path. */
export function useAppIcons(paths: (string | undefined)[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const key = [...new Set(paths.filter(Boolean))].sort().join('\n');
  useEffect(() => {
    const want = key ? key.split('\n').filter((p) => !iconCache.has(p)) : [];
    const have = () => Object.fromEntries(key.split('\n').filter((p) => iconCache.get(p)).map((p) => [p, iconCache.get(p)!]));
    if (!want.length) { setIcons(have()); return; }
    for (const p of want) iconCache.set(p, '');
    void api.net?.icons(want).then((r) => { for (const [p, d] of Object.entries(r)) iconCache.set(p, d); setIcons(have()); }).catch(() => undefined);
  }, [key]);
  return icons;
}

export function AppIcon({ name, src, size = 28 }: { name: string; src?: string; size?: number }) {
  if (src) return <img className="nm-appicon" src={src} width={size} height={size} alt="" />;
  return <span className="nm-appicon nm-letter" style={{ width: size, height: size }} aria-hidden>{(name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase()}</span>;
}

