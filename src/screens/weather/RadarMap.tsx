// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The rain radar: OpenStreetMap tiles with RainViewer's radar frames on top,
// filling the card. Drag to pan, wheel or pinch to zoom; the controls sit on
// the map. Every frame's tiles are loaded up front (hidden) so playback does
// not flicker, and playback stops while the window is hidden.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapTileUrl, radarTileUrl, tileOf, type RadarFrame } from '../../../core/forecast';
import type { Place } from '../../../core/weather';
import { clock, frameLabel, nowFrameIndex } from '../../../core/weather-view';
import { Icon } from '../../components/Icon';

const T = 256;
const MIN_Z = 3;
const MAX_Z = 12;
/** RainViewer's free tiles stop at this zoom; beyond it the radar layer is scaled up. */
const RADAR_MAX_Z = 7;

/** World pixel position of a place at a zoom. */
function worldPx(lat: number, lon: number, z: number): { x: number; y: number } {
  const t = tileOf(lat, lon, z);
  return { x: (t.x + t.fx) * T, y: (t.y + t.fy) * T };
}

interface View { z: number; cx: number; cy: number }

function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [s, setS] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setS({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setS({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

/** True while the window is hidden (minimised, another tab, screen locked). */
function useDocHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

function tilesFor(v: View, w: number, h: number, size: number, z: number) {
  const left = v.cx - w / 2;
  const top = v.cy - h / 2;
  const n = 2 ** z;
  const out: { key: string; x: number; y: number; left: number; top: number }[] = [];
  const x0 = Math.floor(left / size);
  const x1 = Math.floor((left + w) / size);
  const y0 = Math.max(0, Math.floor(top / size));
  const y1 = Math.min(n - 1, Math.floor((top + h) / size));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      out.push({ key: `${z}/${tx}/${ty}`, x: ((tx % n) + n) % n, y: ty, left: tx * size - left, top: ty * size - top });
    }
  }
  return out;
}

const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.visibility = 'hidden'; };

export function RadarMap({ place, index }: { place: Place; index: { host: string; frames: RadarFrame[] } }) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(box);
  const frames = index.frames;
  const nowIdx = useMemo(() => nowFrameIndex(frames), [frames]);
  const [frame, setFrame] = useState(nowIdx);
  const [playing, setPlaying] = useState(true);
  const [opacity, setOpacity] = useState(0.85);
  const docHidden = useDocHidden();
  const home = useCallback((z = 7): View => { const p = worldPx(place.lat, place.lon, z); return { z, cx: p.x, cy: p.y }; }, [place.lat, place.lon]);
  const [view, setView] = useState<View>(() => home());
  useEffect(() => setView(home()), [home]);

  // Playback: one frame every 0.6 s, lingering on "Now" and the last frame; nothing runs while hidden.
  useEffect(() => {
    if (!playing || docHidden || frames.length < 2) return;
    let hold = 0;
    const id = setInterval(() => {
      setFrame((f) => {
        if ((f === nowIdx || f === frames.length - 1) && hold < 2) { hold++; return f; }
        hold = 0;
        return (f + 1) % frames.length;
      });
    }, 600);
    return () => clearInterval(id);
  }, [playing, docHidden, frames.length, nowIdx]);

  const zoomBy = useCallback((dz: number, at?: { x: number; y: number }) => {
    setView((v) => {
      const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z + dz));
      if (z === v.z) return v;
      const k = 2 ** (z - v.z);
      const mx = at ? at.x - w / 2 : 0;
      const my = at ? at.y - h / 2 : 0;
      // Keep the point under the pointer where it is.
      return { z, cx: (v.cx + mx) * k - mx, cy: (v.cy + my) * k - my };
    });
  }, [w, h]);

  // Wheel zoom (needs a non-passive listener to keep the page from scrolling).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 60) return;
      const r = el.getBoundingClientRect();
      zoomBy(acc < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
      acc = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Drag to pan, two fingers to pinch.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.wx-map-ui')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pinch.current = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, cur);
    if (ptrs.current.size === 1) {
      setView((v) => ({ ...v, cx: v.cx - (cur.x - prev.x), cy: v.cy - (cur.y - prev.y) }));
    } else if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = box.current?.getBoundingClientRect();
      const mid = r ? { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } : undefined;
      if (d / pinch.current > 1.5) { zoomBy(1, mid); pinch.current = d; } else if (d / pinch.current < 0.66) { zoomBy(-1, mid); pinch.current = d; }
    }
  };
  const onUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null; };

  const step = (d: number) => { setPlaying(false); setFrame((f) => Math.min(frames.length - 1, Math.max(0, f + d))); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, button')) return;
    if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-1); }
  };

  const base = w && h ? tilesFor(view, w, h, T, view.z) : [];
  const rz = Math.min(view.z, RADAR_MAX_Z);
  const scale = 2 ** (view.z - rz);
  const radar = w && h ? tilesFor(view, w, h, T * scale, rz) : [];
  const pin = worldPx(place.lat, place.lon, view.z);
  const f = frames[frame] ?? frames[0];
  const future = f.time > frames[nowIdx].time;
  const label = frameLabel(f.time, frames[nowIdx].time);

  return (
    <div className="wx-map" ref={box} tabIndex={0} role="region" aria-roledescription="map"
      aria-label={`Rain radar around ${place.name}. Drag to move, scroll or pinch to zoom; space plays or pauses, arrow keys step through frames.`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
      <div className="wx-map-base" aria-hidden>
        {base.map((t) => <img key={t.key} src={mapTileUrl(view.z, t.x, t.y)} alt="" draggable={false} onError={hide} style={{ left: t.left, top: t.top, width: T, height: T }} />)}
      </div>
      {frames.map((fr, i) => (
        <div key={fr.path} className={`wx-map-rain ${i === frame ? 'on' : ''}`} style={{ opacity: i === frame ? opacity : 0 }} aria-hidden>
          {radar.map((t) => <img key={t.key} src={radarTileUrl(index.host, fr, rz, t.x, t.y)} alt="" draggable={false} onError={hide} style={{ left: t.left, top: t.top, width: T * scale, height: T * scale }} />)}
        </div>
      ))}
      <div className="wx-map-pin" style={{ left: pin.x - view.cx + w / 2, top: pin.y - view.cy + h / 2 }} title={place.name} aria-hidden><span>{place.name.split(',')[0]}</span></div>

      <div className="wx-map-ui wx-map-legend" aria-label="Rain intensity: light to heavy" role="img">
        <span>Light</span><i /><span>Heavy</span>
      </div>
      <div className="wx-map-ui wx-map-tools">
        <button className="wx-glass-btn" onClick={() => zoomBy(1)} title="Zoom in" aria-label="Zoom in" disabled={view.z >= MAX_Z}><Icon name="plus" size={14} /></button>
        <button className="wx-glass-btn" onClick={() => zoomBy(-1)} title="Zoom out" aria-label="Zoom out" disabled={view.z <= MIN_Z}><Icon name="minus" size={14} /></button>
        <button className="wx-glass-btn" onClick={() => setView(home(view.z))} title={`Centre on ${place.name}`} aria-label={`Centre on ${place.name}`}><svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden><circle cx={12} cy={12} r={6.5} /><circle cx={12} cy={12} r={1.6} fill="currentColor" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></svg></button>
      </div>
      <div className="wx-map-ui wx-map-bar">
        <button className="wx-glass-btn play" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause radar' : 'Play radar'} aria-pressed={playing}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
        <div className="wx-timeline">
          <div className="wx-ticks" aria-hidden>
            {frames.map((fr, i) => <i key={fr.path} className={`${i === nowIdx ? 'now' : ''} ${fr.time > frames[nowIdx].time ? 'future' : ''} ${i === frame ? 'cur' : ''}`} style={{ left: `${frames.length > 1 ? (i / (frames.length - 1)) * 100 : 50}%` }} />)}
          </div>
          <input type="range" min={0} max={frames.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }}
            aria-label="Radar time" aria-valuetext={`${label}, ${clock(f.time)}${future ? ', forecast' : ''}`} />
          <div className="wx-tl-labels" aria-hidden>
            <span>{frameLabel(frames[0].time, frames[nowIdx].time)}</span>
            <span className="now" style={{ left: `${frames.length > 1 ? (nowIdx / (frames.length - 1)) * 100 : 50}%` }}>Now</span>
            {nowIdx < frames.length - 1 ? <span>{frameLabel(frames[frames.length - 1].time, frames[nowIdx].time)}</span> : <span />}
          </div>
        </div>
        <div className="wx-map-time" aria-live="off">
          <b className="num">{clock(f.time)}</b>
          <span>{future ? `Forecast · ${label}` : label === 'Now' ? 'Latest' : label}</span>
        </div>
        <label className="wx-opacity" title="Rain layer opacity">
          <Icon name="drop" size={13} />
          <input type="range" min={0.3} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} aria-label="Rain layer opacity" />
        </label>
      </div>
      <div className="wx-map-credit">Radar © RainViewer · © OpenStreetMap</div>
    </div>
  );
}
