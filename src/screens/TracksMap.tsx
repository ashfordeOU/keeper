// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Places & Tracks map: raster tiles from the tile server you choose
// (fetched and cached by Keeper itself), or Keeper's offline world outline when
// the online map is off or unreachable. Tracks are drawn as polylines coloured
// by speed, height or heart rate; many markers are clustered. Light and dark
// follow Keeper's theme. Drag to move, scroll or +/− to zoom.

import { useEffect, useMemo, useRef, useState } from 'react';
import { worldShapes } from '../../core/fw/monitor';
import { cluster, colouredRuns, fitZoom, fromPixel, TILE, toPixel, type ColourBy } from '../../core/tracks/geo';
import type { MapTrack } from '../../core/tracks/api';
import type { Point } from '../../core/tracks/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useTracksConfig } from './TracksSurfaces';
import '../styles/tracks.css';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: 'stay' | 'photo' | 'device' | 'item' | 'person' | 'phone' | 'tracker' | 'place';
  sub?: string;
}

const SPORT_COLOUR: Record<string, string> = { run: '#f97316', ride: '#3b82f6', walk: '#22c55e', hike: '#16a34a', drive: '#8b5cf6', flight: '#0ea5e9', train: '#a855f7', boat: '#06b6d4', swim: '#14b8a6', ski: '#64748b', row: '#0891b2', other: '#e11d48' };
export const sportColour = (s: string) => SPORT_COLOUR[s] ?? SPORT_COLOUR.other;

// Tile pictures are kept as object URLs for the life of the window (a few hundred at most).
const tileUrls = new Map<string, string | null>();
const tileWaiting = new Map<string, Promise<string | null>>();
function loadTile(z: number, x: number, y: number): Promise<string | null> {
  const k = `${z}/${x}/${y}`;
  if (tileUrls.has(k)) return Promise.resolve(tileUrls.get(k)!);
  let p = tileWaiting.get(k);
  if (!p) {
    p = api.tracks.tile(z, x, y).then((b) => {
      const url = b ? URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })) : null;
      tileUrls.set(k, url);
      return url;
    }).catch(() => null).finally(() => tileWaiting.delete(k));
    tileWaiting.set(k, p);
  }
  return p;
}

function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function TracksMap({ lines = [], markers = [], heat, height = 420, colourBy, focus, selected, onPick }: {
  lines?: MapTrack[];
  markers?: MapMarker[];
  heat?: [number, number][];
  height?: number;
  colourBy?: ColourBy;
  /** a spot to centre on */
  focus?: { lat: number; lon: number; z?: number };
  selected?: string;
  onPick?: (id: string) => void;
}) {
  const cfg = useTracksConfig();
  const dark = useDark();
  const box = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const [view, setView] = useState<{ lat: number; lon: number; z: number } | null>(null);
  const [tiles, setTiles] = useState<Record<string, string | null>>({});
  const [hover, setHover] = useState<MapMarker | null>(null);
  const moved = useRef(false);
  const by: ColourBy = colourBy ?? cfg?.map.colourBy ?? 'speed';
  const online = !!cfg?.map.online;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Fit everything in view when the content changes (unless the person has moved the map).
  const contentKey = useMemo(() => `${lines.map((l) => `${l.id}:${l.points.length}`).join(',')}|${markers.map((m) => m.id).join(',')}|${heat?.length ?? 0}`, [lines, markers, heat]);
  useEffect(() => { moved.current = false; }, [contentKey]);
  useEffect(() => {
    if (!w || moved.current) return;
    if (focus) { setView({ lat: focus.lat, lon: focus.lon, z: focus.z ?? 14 }); return; }
    const pts: { lat: number; lon: number }[] = [...lines.flatMap((l) => l.points), ...markers, ...(heat ?? []).map(([lat, lon]) => ({ lat, lon }))];
    if (!pts.length) { setView({ lat: 30, lon: 10, z: 1 }); return; }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of pts) { a = Math.min(a, p.lon); b = Math.min(b, p.lat); c = Math.max(c, p.lon); d = Math.max(d, p.lat); }
    setView({ lat: (b + d) / 2, lon: (a + c) / 2, z: Math.min(16, fitZoom([a, b, c, d], w, height)) });
  }, [contentKey, w, height, focus?.lat, focus?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const z = view?.z ?? 1;
  const [cx, cy] = view ? toPixel(view.lat, view.lon, z) : [0, 0];
  const left = cx - w / 2, top = cy - height / 2;
  const sx = (lat: number, lon: number): [number, number] => { const [x, y] = toPixel(lat, lon, z); return [x - left, y - top]; };

  // Tiles in view (online map only).
  const need = useMemo(() => {
    if (!view || !w || !online) return [];
    const n = 2 ** z;
    const out: { k: string; x: number; y: number; tx: number; ty: number }[] = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      for (let ty = Math.max(0, Math.floor(top / TILE)); ty <= Math.min(n - 1, Math.floor((top + height) / TILE)); ty++) out.push({ k: `${z}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, tx, ty });
    }
    return out;
  }, [view, w, height, online, z, left, top]);
  useEffect(() => {
    let alive = true;
    for (const t of need) {
      if (t.k in tiles) continue;
      void loadTile(z, t.tx, t.ty).then((u) => { if (alive) setTiles((m) => (m[t.k] === u ? m : { ...m, [t.k]: u })); });
    }
    return () => { alive = false; };
  }, [need]); // eslint-disable-line react-hooks/exhaustive-deps
  const tilesShown = need.filter((t) => tiles[t.k]);
  const offline = !online || (need.length > 0 && need.every((t) => t.k in tiles && !tiles[t.k]));

  // The offline outline, projected for this zoom.
  const outline = useMemo(() => {
    if (!view || !w || !offline) return '';
    let d = '';
    for (const s of worldShapes) {
      let seg = '';
      for (let i = 0; i < s.length; i += 2) {
        const [x, y] = toPixel(Math.max(-85, Math.min(85, s[i + 1])), s[i], z);
        seg += `${i ? 'L' : 'M'}${(x - left).toFixed(1)} ${(y - top).toFixed(1)}`;
      }
      d += seg + 'Z';
    }
    return d;
  }, [view, w, offline, z, left, top]);

  const runs = useMemo(() => {
    if (!view) return [];
    return lines.flatMap((l) => colouredRuns(l.points, by === 'none' ? 'none' : by).map((r, i) => ({ id: `${l.id}:${i}`, track: l.id, color: r.color || sportColour(l.sport), d: pathOf(r.points, sx) })));
  }, [lines, by, view, w, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const clusters = useMemo(() => (view ? cluster(markers, z, 40) : []), [markers, z, view]);

  // Heatmap on a canvas (thousands of points).
  useEffect(() => {
    const c = heatRef.current;
    if (!c || !view || !heat) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = height * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, height);
    g.globalCompositeOperation = dark ? 'lighter' : 'multiply';
    g.fillStyle = dark ? 'rgba(255,120,40,0.18)' : 'rgba(230,60,20,0.16)';
    for (const [lat, lon] of heat) {
      const [x, y] = sx(lat, lon);
      if (x < -4 || y < -4 || x > w + 4 || y > height + 4) continue;
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }, [heat, view, w, height, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging and zooming.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const zoomAt = (dz: number, px = w / 2, py = height / 2) => {
    if (!view) return;
    const nz = Math.max(1, Math.min(18, view.z + dz));
    if (nz === view.z) return;
    const at = fromPixel(left + px, top + py, view.z);
    const [ax, ay] = toPixel(at.lat, at.lon, nz);
    const c = fromPixel(ax - px + w / 2, ay - py + height / 2, nz);
    moved.current = true;
    setView({ lat: c.lat, lon: c.lon, z: nz });
  };

  const dim = dark && cfg?.map.dark !== 'off';
  return (
    <div className={`tk-map ${dark ? 'dark' : ''}`} ref={box} style={{ height }} data-online={online && !offline ? '1' : '0'}
      onPointerDown={(e) => { if ((e.target as Element).closest('button')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx, cy }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !view) return;
        const c = fromPixel(d.cx - (e.clientX - d.x), d.cy - (e.clientY - d.y), view.z);
        moved.current = true;
        setView({ ...view, lat: Math.max(-85, Math.min(85, c.lat)), lon: c.lon });
      }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={(e) => { const r = box.current!.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); }}
      onDoubleClick={(e) => { const r = box.current!.getBoundingClientRect(); zoomAt(1, e.clientX - r.left, e.clientY - r.top); }}>
      <svg width={w} height={height} className="tk-svg" role="img" aria-label="Map">
        {offline ? <path d={outline} className="tk-land" /> : null}
        <g className={dim && cfg?.map.dark !== 'off' ? 'tk-tiles dim' : 'tk-tiles'}>
          {tilesShown.map((t) => <image key={t.k} href={tiles[t.k]!} x={t.x} y={t.y} width={TILE} height={TILE} />)}
        </g>
        <g className="tk-lines">
          {runs.map((r) => <path key={r.id} d={r.d} className={`track-line ${selected === r.track ? 'sel' : ''}`} data-track={r.track} stroke={r.color} onClick={() => onPick?.(r.track)} />)}
        </g>
        <g className="tk-markers">
          {clusters.map((c) => {
            const [x, y] = sx(c.lat, c.lon);
            if (x < -20 || y < -20 || x > w + 20 || y > height + 20) return null;
            const m = c.items[0];
            if (c.items.length > 1) return <g key={`c${m.id}`} className="map-cluster" transform={`translate(${x},${y})`} onClick={() => zoomAt(2, x, y)}><circle r={11 + Math.min(10, Math.log2(c.items.length) * 2)} /><text dy="4">{c.items.length}</text></g>;
            return <g key={m.id} className={`map-marker k-${m.kind} ${selected === m.id ? 'sel' : ''}`} transform={`translate(${x},${y})`} onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(m.id)}><circle r={m.kind === 'photo' ? 5 : 7} /></g>;
          })}
        </g>
      </svg>
      {heat ? <canvas ref={heatRef} className="tk-heat" style={{ width: w, height }} /> : null}
      {hover ? (() => { const [x, y] = sx(hover.lat, hover.lon); return <div className="tk-tip" style={{ left: x + 10, top: y - 10 }}><b>{hover.label}</b>{hover.sub ? <span>{hover.sub}</span> : null}</div>; })() : null}
      <div className="tk-zoom">
        <button className="btn sm icon" title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(1)}><Icon name="plus" size={13} /></button>
        <button className="btn sm icon" title="Zoom out" onClick={() => zoomAt(-1)}>−</button>
      </div>
      <div className="tk-attr">
        {online && !offline ? cfg?.map.attribution : online ? 'Map offline: showing the outline' : (
          <button className="link-btn" onClick={() => void api.tracks.setConfig({ map: { online: true } })}>Offline outline · Use the online map</button>
        )}
      </div>
    </div>
  );
}

function pathOf(points: Point[], sx: (lat: number, lon: number) => [number, number]): string {
  let d = '';
  let lastX = NaN, lastY = NaN;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = sx(points[i].lat, points[i].lon);
    // Skip points closer than half a pixel to the last one drawn.
    if (i && i < points.length - 1 && Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5) continue;
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    lastX = x; lastY = y;
  }
  return d;
}
