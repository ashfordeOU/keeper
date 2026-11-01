// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A world map of where connections go: countries drawn once from an offline
// outline (Natural Earth, public domain), a dot per place and an arc from this
// computer to it. Canvas, redrawn only when the data or the size changes; no
// animation, nothing runs while it is hidden. Used by Network Activity, the
// firewall and an app's details.

import { useEffect, useMemo, useRef, useState } from 'react';
import { countryName, countryPoint, greatCircle, project, worldShapes } from '../../core/fw/monitor';
import '../styles/fw.css';

export interface MapPoint {
  /** a country code, or an exact place */
  country?: string;
  lonLat?: [number, number];
  /** what to call it; defaults to the country name */
  label?: string;
  /** bigger dot for more traffic */
  weight?: number;
  kind: 'vpn' | 'direct' | 'blocked' | 'local' | 'other';
  /** anything the caller wants back on click */
  ref?: unknown;
}

export const MAP_COLORS: Record<MapPoint['kind'], string> = { vpn: '#22a06b', direct: '#3b82f6', blocked: '#e5484d', local: '#8b8d98', other: '#a78bfa' };

/** Where this computer is, roughly: the place set for the weather, else the country of the system's language. */
export function homePoint(place?: { lat?: number; lon?: number } | null): [number, number] {
  if (place && typeof place.lat === 'number' && typeof place.lon === 'number') return [place.lon, place.lat];
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const p = countryPoint(region);
    if (p) return p;
  } catch { /* fall through */ }
  return [0, 20];
}

interface Placed { x: number; y: number; r: number; p: MapPoint; count: number }

export function WorldMap({ points, home, height = 340, onPick, selected }: { points: MapPoint[]; home: [number, number]; height?: number; onPick?: (p: MapPoint[]) => void; selected?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<Placed | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Group by place: one dot per country (or exact place), weighted by traffic.
  const placed = useMemo<Placed[]>(() => {
    if (!w) return [];
    const by = new Map<string, Placed>();
    for (const p of points) {
      const ll = p.lonLat ?? countryPoint(p.country);
      if (!ll) continue;
      const key = `${ll[0]},${ll[1]}`;
      const [x, y] = project(ll[0], ll[1], w, height);
      const have = by.get(key);
      if (have) {
        have.count++;
        have.p = { ...have.p, weight: (have.p.weight ?? 0) + (p.weight ?? 0), kind: have.p.kind === 'blocked' || p.kind === 'blocked' ? 'blocked' : have.p.kind === 'vpn' ? 'vpn' : p.kind };
      } else by.set(key, { x, y, r: 0, p: { ...p }, count: 1 });
    }
    const list = [...by.values()];
    const max = Math.max(1, ...list.map((d) => d.p.weight ?? 0));
    for (const d of list) d.r = 3 + 6 * Math.sqrt((d.p.weight ?? 0) / max);
    return list;
  }, [points, w, height]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const land = css.getPropertyValue('--map-land').trim() || 'rgba(127,127,127,.22)';
    const edge = css.getPropertyValue('--map-edge').trim() || 'rgba(127,127,127,.35)';
    g.clearRect(0, 0, w, height);
    g.fillStyle = land;
    g.strokeStyle = edge;
    g.lineWidth = 0.5;
    for (const s of worldShapes) {
      g.beginPath();
      // Shapes that cross the date line (Russia, Fiji) are drawn in pieces, not with a line across the map.
      let crosses = false;
      for (let i = 0; i < s.length; i += 2) {
        const [x, y] = project(s[i], s[i + 1], w, height);
        const jump = i > 0 && Math.abs(s[i] - s[i - 2]) > 180;
        if (jump) crosses = true;
        if (!i || jump) g.moveTo(x, y); else g.lineTo(x, y);
      }
      if (!crosses) g.closePath();
      g.fill();
      g.stroke();
    }
    // Arcs from here to every place, then the dots on top.
    for (const d of placed) {
      const ll = d.p.lonLat ?? countryPoint(d.p.country)!;
      g.strokeStyle = MAP_COLORS[d.p.kind];
      g.globalAlpha = 0.55;
      g.lineWidth = 1.2;
      g.beginPath();
      let prev: number | undefined;
      for (const [lon, lat] of greatCircle(home, ll, 24)) {
        const [x, y] = project(lon, lat, w, height);
        if (prev === undefined || Math.abs(lon - prev) > 180) g.moveTo(x, y); else g.lineTo(x, y);
        prev = lon;
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    for (const d of placed) {
      g.fillStyle = MAP_COLORS[d.p.kind];
      g.beginPath();
      g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      g.fill();
      if (selected && (d.p.country === selected || d.p.label === selected)) { g.strokeStyle = css.getPropertyValue('--text').trim() || '#000'; g.lineWidth = 2; g.stroke(); }
    }
    const [hx, hy] = project(home[0], home[1], w, height);
    g.fillStyle = css.getPropertyValue('--accent').trim() || '#6366f1';
    g.beginPath();
    g.arc(hx, hy, 5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
  }, [placed, w, height, home, selected]);

  const at = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: Placed | null = null;
    let bd = 14 * 14;
    for (const d of placed) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; best = d; } }
    return best;
  };

  return (
    <div className="world-map" ref={box} style={{ height, position: 'relative' }}>
      <canvas
        ref={canvas}
        style={{ width: '100%', height, display: 'block', cursor: hover ? 'pointer' : 'default' }}
        onMouseMove={(e) => setHover(at(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const d = at(e);
          if (!d || !onPick) return;
          const key = d.p.lonLat ? undefined : d.p.country;
          onPick(points.filter((p) => (key ? p.country === key : p.label === d.p.label)));
        }}
        role="img"
        aria-label={`Map of ${placed.length} places this computer is talking to`}
      />
      {hover ? (
        <div className="world-map-tip" style={{ left: Math.min(hover.x + 10, w - 180), top: Math.max(0, hover.y - 30) }}>
          <b>{hover.p.label ?? countryName(hover.p.country) ?? hover.p.country}</b> · {hover.count} connection{hover.count === 1 ? '' : 's'}
        </div>
      ) : null}
      <div className="world-map-legend small">
        {(['direct', 'vpn', 'blocked'] as const).map((k) => <span key={k}><i style={{ background: MAP_COLORS[k] }} />{k === 'direct' ? 'Direct' : k === 'vpn' ? 'Through the VPN' : 'Blocked'}</span>)}
        <span><i style={{ background: 'var(--accent)' }} />This computer</span>
      </div>
    </div>
  );
}
