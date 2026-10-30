// SPDX-License-Identifier: AGPL-3.0-or-later
// A desktop widget. The same body draws inside its own small window and as a
// live preview on the Widgets page.

import { useEffect, useState } from 'react';
import type { HealthReport, IslandState } from '../../core/api';
import { moonPath, moonPhase, sunTimes } from '../../core/astro';
import { formatBytes } from '../../core/format';
import type { DiskInfo } from '../../core/types';
import { describeCode } from '../../core/weather';
import { countdownParts, type WidgetConfig } from '../../core/widgets';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/widgets.css';

const FONTS: Record<WidgetConfig['style']['font'], string> = {
  system: 'var(--font)',
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', var(--font)",
  serif: "ui-serif, 'New York', Georgia, 'Times New Roman', serif",
  mono: 'var(--mono)',
};

export function widgetSurface(w: WidgetConfig): React.CSSProperties {
  const st = w.style;
  const bg = st.background === 'none' ? 'transparent'
    : st.background === 'solid' ? st.bgColor
    : st.background === 'gradient' ? `linear-gradient(135deg, ${st.bgColor}, ${st.bgColor2})`
    : 'rgba(24, 24, 30, .55)';
  return {
    fontFamily: FONTS[st.font], color: st.color, background: bg, borderRadius: st.radius, opacity: st.opacity,
    fontSize: `${13 * st.size}px`, backdropFilter: st.background === 'glass' ? 'blur(22px) saturate(1.4)' : undefined,
    border: st.background === 'glass' ? '1px solid rgba(255,255,255,.14)' : undefined,
  };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useIsland(): IslandState | null {
  const [s, setS] = useState<IslandState | null>(null);
  useEffect(() => {
    const load = () => void api.island.state().then(setS).catch(() => undefined);
    load();
    const off = api.on('island-changed', load);
    const t = setInterval(load, 30_000);
    return () => { off(); clearInterval(t); };
  }, []);
  return s;
}

function Analog({ now, size = 120 }: { now: number; size?: number }) {
  const d = new Date(now);
  const hand = (deg: number, len: number, w: number, color = 'currentColor') => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => <line key={i} x1="50" y1="6" x2="50" y2={i % 3 ? 10 : 13} stroke="currentColor" strokeOpacity=".6" strokeWidth={i % 3 ? 1.5 : 2.5} transform={`rotate(${i * 30} 50 50)`} />)}
      {hand((d.getHours() % 12) * 30 + d.getMinutes() / 2, 25, 4)}
      {hand(d.getMinutes() * 6 + d.getSeconds() / 10, 36, 3)}
      {hand(d.getSeconds() * 6, 40, 1.2, '#ff6fa3')}
      <circle cx="50" cy="50" r="2.5" fill="currentColor" />
    </svg>
  );
}

function Month({ now }: { now: number }) {
  const d = new Date(now);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="wg-month">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <b key={i}>{x}</b>)}
      {cells.map((n, i) => <span key={i} className={n === d.getDate() ? 'today' : ''}>{n ?? ''}</span>)}
    </div>
  );
}

function Spark({ values, height = 34 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${height - 4 - ((v - min) / Math.max(1, max - min)) * (height - 8)}`).join(' ');
  return <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}

export function WidgetBody({ w }: { w: WidgetConfig }) {
  const now = useNow(w.kind === 'clock' && (w.options.seconds || w.options.analog) ? 1000 : 15_000);
  const isl = useIsland();
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (w.kind === 'disk') void api.system.disks().then(setDisks);
    if (w.kind === 'system') {
      const load = () => void api.system.health().then(setHealth).catch(() => undefined);
      load();
      const t = setInterval(load, 10_000);
      return () => clearInterval(t);
    }
    if (w.kind === 'photo' && w.options.folder) void api.widgets.photos(w.options.folder).then(setPhotos);
    return undefined;
  }, [w.kind, w.options.folder]);

  useEffect(() => {
    if (w.kind !== 'photo' || !photos.length) return;
    let i = Math.floor(Math.random() * photos.length);
    const show = () => void api.files.thumbnail(photos[i++ % photos.length], 900).then(setPhoto);
    show();
    const t = setInterval(show, Math.max(5, w.options.interval ?? 30) * 1000);
    return () => clearInterval(t);
  }, [w.kind, photos, w.options.interval]);

  const d = new Date(now);
  switch (w.kind) {
    case 'clock': {
      const zones = w.options.timeZones ?? [];
      return (
        <div className="wg-center">
          {w.options.analog ? <Analog now={now} size={zones.length ? 96 : 130} /> : <div className="wg-big">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: w.options.seconds ? '2-digit' : undefined })}</div>}
          {zones.length ? (
            <div className="wg-zones">
              {zones.map((z) => {
                let t = '';
                try { t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: z }); } catch { t = '—'; }
                return <span key={z}><b>{t}</b> {z.split('/').pop()?.replace(/_/g, ' ')}</span>;
              })}
            </div>
          ) : !w.options.analog ? <div className="wg-dim">{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div> : null}
        </div>
      );
    }
    case 'date':
      return (
        <div>
          <div className="wg-row"><div className="wg-big" style={{ fontSize: '2.6em' }}>{d.getDate()}</div><div><b>{d.toLocaleDateString([], { weekday: 'long' })}</b><div className="wg-dim">{d.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div></div></div>
          <Month now={now} />
        </div>
      );
    case 'events': {
      const list = (isl?.events ?? []).filter((e) => e.end > now).slice(0, 5);
      return (
        <div>
          <div className="wg-title"><Icon name="calendar" size={13} /> Up next</div>
          {list.length ? list.map((e) => (
            <div key={e.uid} className="wg-ev"><span>{e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><b className="wg-ell">{e.title}</b></div>
          )) : <div className="wg-dim">{isl ? 'Nothing coming up. Add a calendar link in Island settings.' : '…'}</div>}
        </div>
      );
    }
    case 'weather': {
      const wx = isl?.weather;
      if (!wx) return <div className="wg-dim">Choose a place in Island settings to see the weather.</div>;
      return (
        <div>
          <div className="wg-row" style={{ justifyContent: 'space-between' }}>
            <div><div className="wg-big">{Math.round(wx.current.temp)}°</div><div className="wg-dim">{wx.place.name}</div></div>
            <div style={{ textAlign: 'right' }}><b>{describeCode(wx.current.code).label}</b><div className="wg-dim">H {Math.round(wx.daily[0]?.max ?? 0)}° · L {Math.round(wx.daily[0]?.min ?? 0)}°</div></div>
          </div>
          <Spark values={wx.hourly.slice(0, 12).map((h) => h.temp)} />
          <div className="wg-hours">{wx.hourly.slice(0, 12).filter((_, i) => i % 3 === 0).map((h) => <span key={h.t}>{new Date(h.t).getHours()}h <b>{Math.round(h.temp)}°</b></span>)}</div>
          {wx.nowcast ? <div className="wg-dim" style={{ color: '#93c5fd' }}>{wx.nowcast}</div> : null}
        </div>
      );
    }
    case 'countdown': {
      const c = countdownParts(w.options.target ?? now, now);
      return (
        <div className="wg-center">
          <div className="wg-dim">{w.options.title || 'Countdown'}</div>
          {c.past ? <div className="wg-big">It’s here</div> : <div className="wg-big">{c.days}<small> days</small></div>}
          {!c.past ? <div className="wg-dim">{c.hours} h {c.minutes} min · {new Date(w.options.target ?? now).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</div> : null}
        </div>
      );
    }
    case 'sun-moon': {
      const place = isl?.weather?.place;
      const sun = place ? sunTimes(now, place.lat, place.lon) : undefined;
      const moon = moonPhase(now);
      const t = (x?: number) => (x ? new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
      return (
        <div className="wg-row" style={{ gap: 16 }}>
          <svg viewBox="0 0 24 24" width="64" height="64"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".15" /><path d={moonPath(moon.phase)} fill="#f5f0dc" /></svg>
          <div>
            <b>{moon.name}</b><div className="wg-dim">{Math.round(moon.illumination * 100)}% lit</div>
            {sun ? (sun.polar ? <div className="wg-dim">{sun.polar === 'day' ? 'The sun stays up all day' : 'The sun stays down today'}</div> : <div style={{ marginTop: 6 }}>☀︎ {t(sun.sunrise)} · ☾ {t(sun.sunset)}</div>) : <div className="wg-dim">Choose a place in Island settings for sun times.</div>}
          </div>
        </div>
      );
    }
    case 'photo':
      return photo ? <img className="wg-photo" src={photo} alt="" /> : <div className="wg-dim wg-center">{w.options.folder ? 'No photos in this folder' : 'Choose a folder of photos'}</div>;
    case 'text':
      return <div className="wg-text">{w.options.text || 'Your note'}</div>;
    case 'battery': {
      const b = isl?.battery;
      return (
        <div>
          <div className="wg-row"><Icon name={b?.charging ? 'bolt' : 'battery'} size={22} /><div className="wg-big">{b ? `${Math.round(b.percent)}%` : '—'}</div></div>
          {(isl?.devices?.bluetooth ?? []).slice(0, 3).map((x) => <div key={x.name} className="wg-ev"><span className="wg-ell">{x.name}</span><b>{x.percent}%</b></div>)}
        </div>
      );
    }
    case 'disk': {
      const disk = disks.find((x) => (w.options.mount ? x.mount === w.options.mount : x.system)) ?? disks[0];
      if (!disk) return <div className="wg-dim">…</div>;
      const used = 1 - disk.free / Math.max(1, disk.total);
      return (
        <div>
          <div className="wg-title"><Icon name="weight" size={13} /> {disk.label}</div>
          <div className="wg-big">{formatBytes(disk.free)}<small> free</small></div>
          <div className="wg-bar"><i style={{ width: `${used * 100}%` }} /></div>
          <div className="wg-dim">{Math.round(used * 100)}% of {formatBytes(disk.total)} used</div>
        </div>
      );
    }
    case 'system': {
      const mem = health ? 1 - health.memory.free / health.memory.total : 0;
      return (
        <div>
          <div className="wg-title"><Icon name="bolt" size={13} /> System</div>
          <div className="wg-ev"><span>Processor</span><b>{health ? `${Math.round(health.cpuPercent)}%` : '…'}</b></div>
          <div className="wg-bar"><i style={{ width: `${health?.cpuPercent ?? 0}%` }} /></div>
          <div className="wg-ev" style={{ marginTop: 6 }}><span>Memory</span><b>{health ? `${Math.round(mem * 100)}%` : '…'}</b></div>
          <div className="wg-bar"><i style={{ width: `${mem * 100}%` }} /></div>
        </div>
      );
    }
    case 'focus': {
      const f = isl?.focus;
      const left = f && f.mode !== 'idle' ? f.pausedLeft ?? Math.max(0, f.endsAt - now) : 0;
      return (
        <div className="wg-center">
          <div className="wg-dim">{f?.mode === 'break' ? 'Break' : f?.mode === 'focus' ? 'Focusing' : `${f?.rounds ?? 0} rounds today`}</div>
          <div className="wg-big">{left ? `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}` : `${f?.focusMin ?? 25}:00`}</div>
          <button className="wg-btn" onClick={() => void api.island.focus(left ? 'stop' : 'start')}>{left ? 'Stop' : 'Start'}</button>
        </div>
      );
    }
    case 'clipboard': {
      const c = isl?.clips[0];
      return (
        <div>
          <div className="wg-title"><Icon name="clipboard" size={13} /> Last copied{c?.source ? ` · ${c.source}` : ''}</div>
          {c?.image ? <img src={c.image} alt="" style={{ maxHeight: 70, borderRadius: 6 }} /> : <div className="wg-clip">{c?.text ?? 'Nothing yet'}</div>}
        </div>
      );
    }
  }
}

/** The whole widget window. */
export function WidgetView() {
  const [w, setW] = useState<WidgetConfig | null>(null);
  useEffect(() => {
    const load = () => void api.widgets.current().then(setW);
    load();
    return api.on('widgets-changed', load);
  }, []);
  if (!w) return null;
  return (
    <div className={`wg ${w.locked ? 'locked' : ''}`} style={widgetSurface(w)}>
      <WidgetBody w={w} />
    </div>
  );
}
