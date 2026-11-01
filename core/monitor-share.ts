// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The share card: a 1200×630 picture of the current readings, in light, dark
// or transparent. Pure layout here (what goes where); the page draws it on a
// canvas and saves a PNG.

import { metricText, metricValue, scaleFor, TRAY_METRICS, type LiveReading, type TrayMetric } from './monitor-tray';

export type CardTheme = 'light' | 'dark' | 'transparent';

export interface CardTile {
  metric: TrayMetric;
  label: string;
  value: string;
  values: (number | undefined)[];
  max: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardLayout {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  tiles: CardTile[];
  colors: { bg: string; card: string; text: string; muted: string; line: string };
}

const SETTINGS = { netUnit: 'bytes', memShows: 'used', tempUnit: 'c' } as const;

/** Up to six tiles of what this computer measures, in a 3×2 grid under the title. */
export function shareCardLayout(latest: LiveReading, recent: LiveReading[], opts: { theme: CardTheme; title?: string; at?: Date }): CardLayout {
  const width = 1200;
  const height = 630;
  const metrics = TRAY_METRICS.map((m) => m.id).filter((m) => metricValue(m, latest, SETTINGS) !== undefined).slice(0, 6);
  const cols = 3;
  const pad = 48;
  const gap = 20;
  const top = 170;
  const rows = Math.max(1, Math.ceil(metrics.length / cols));
  const w = (width - pad * 2 - gap * (cols - 1)) / cols;
  const h = (height - top - pad - gap * (rows - 1)) / rows;
  const tiles = metrics.map((m, i) => {
    const vals = recent.map((r) => metricValue(m, r, SETTINGS));
    return {
      metric: m, label: TRAY_METRICS.find((x) => x.id === m)!.label, value: metricText(m, latest, SETTINGS), values: vals,
      max: scaleFor(m, vals.filter((v): v is number => typeof v === 'number')),
      x: pad + (i % cols) * (w + gap), y: top + Math.floor(i / cols) * (h + gap), w, h,
    };
  });
  const dark = opts.theme === 'dark';
  const colors = opts.theme === 'transparent'
    ? { bg: 'rgba(0,0,0,0)', card: 'rgba(20,20,26,0.82)', text: '#f4f4f5', muted: '#b4b4bc', line: 'rgba(255,255,255,0.14)' }
    : dark ? { bg: '#111114', card: '#1b1b20', text: '#f4f4f5', muted: '#9a9aa4', line: 'rgba(255,255,255,0.08)' } : { bg: '#f6f5f2', card: '#ffffff', text: '#18181b', muted: '#6b6b74', line: 'rgba(20,20,30,0.09)' };
  const at = opts.at ?? new Date(latest.t);
  return {
    width, height, title: opts.title?.trim() || 'This computer right now',
    subtitle: `${at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${latest.perCore?.length ? `${latest.perCore.length} cores · ` : ''}${(latest.memTotal / 1024 ** 3).toFixed(0)} GB memory · Keeper`,
    tiles, colors,
  };
}

/** Points of a sparkline inside a box (newest on the right). */
export function sparkPoints(values: (number | undefined)[], max: number, box: { x: number; y: number; w: number; h: number }): [number, number][] {
  const n = Math.max(2, values.length);
  const out: [number, number][] = [];
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    out.push([box.x + (i / (n - 1)) * box.w, box.y + box.h - (Math.min(max, Math.max(0, v)) / (max || 1)) * box.h]);
  });
  return out;
}
