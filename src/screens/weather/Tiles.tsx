// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The grid of small tiles under the forecast: air quality, UV, wind,
// humidity, feels like, sun, precipitation, pressure and visibility, moon.
// Each has a small drawing; the numbers are always in text too.

import type { ReactNode } from 'react';
import { aqiAdvice, compass, moonPhase, uvAdvice } from '../../../core/forecast';
import type { Weather } from '../../../core/weather';
import { aqiPos, clock, dewComfort, dewPoint, duration, feelsReason, pressureText, sunArc, uvPos, visibilityText } from '../../../core/weather-view';

function Tile({ title, icon, children, wide }: { title: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`wx-tile-card ${wide ? 'wide' : ''}`} aria-label={title}>
      <h3 className="wx-tile-h">{icon}{title}</h3>
      {children}
    </section>
  );
}

const ico = (d: string) => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

/** A half-circle gauge with a coloured track and a marker. */
function Gauge({ pos, label }: { pos: number; label: string }) {
  const a = Math.PI * (1 - pos);
  const x = 50 + 40 * Math.cos(a);
  const y = 50 - 40 * Math.sin(a);
  return (
    <svg viewBox="0 0 100 56" className="wx-gauge" role="img" aria-label={label}>
      <defs>
        <linearGradient id="wx-aqi-g" x1="0" x2="1">
          <stop offset="0" stopColor="#34c759" /><stop offset=".17" stopColor="#facc15" /><stop offset=".33" stopColor="#fb923c" />
          <stop offset=".5" stopColor="#ef4444" /><stop offset=".67" stopColor="#a855f7" /><stop offset="1" stopColor="#7f1d1d" />
        </linearGradient>
      </defs>
      <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="url(#wx-aqi-g)" strokeWidth={8} strokeLinecap="round" />
      <circle cx={x} cy={y} r={6} fill="var(--bg-elev)" stroke="var(--text)" strokeWidth={2.5} />
    </svg>
  );
}

/** A horizontal scale bar with a marker and an optional second tick. */
function Scale({ pos, peak, label, kind }: { pos: number; peak?: number; label: string; kind: 'uv' }) {
  return (
    <div className={`wx-scale ${kind}`} role="img" aria-label={label}>
      <i className="dot" style={{ left: `${pos * 100}%` }} />
      {peak !== undefined ? <i className="peak" style={{ left: `${peak * 100}%` }} /> : null}
    </div>
  );
}

function Compass({ dir, label }: { dir?: number; label: string }) {
  return (
    <svg viewBox="0 0 80 80" className="wx-compass" role="img" aria-label={label}>
      <circle cx={40} cy={40} r={34} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 * Math.PI) / 180;
        const long = i % 9 === 0;
        return <line key={i} x1={40 + (long ? 27 : 30) * Math.sin(a)} y1={40 - (long ? 27 : 30) * Math.cos(a)} x2={40 + 33 * Math.sin(a)} y2={40 - 33 * Math.cos(a)} stroke="var(--text-3)" strokeWidth={long ? 1.6 : 0.8} />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((c, i) => <text key={c} x={40 + 19 * Math.sin((i * Math.PI) / 2)} y={40 - 19 * Math.cos((i * Math.PI) / 2) + 3.5} textAnchor="middle" fontSize={9} fontWeight={c === 'N' ? 700 : 500} fill="var(--text-2)">{c}</text>)}
      {dir !== undefined ? (
        // The arrow points where the wind blows to (from `dir` + 180°).
        <g transform={`rotate(${dir + 180} 40 40)`}>
          <line x1={40} y1={58} x2={40} y2={24} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
          <path d="M40 16 L46 27 L34 27 Z" fill="var(--accent)" />
          <circle cx={40} cy={60} r={3} fill="var(--accent)" />
        </g>
      ) : null}
    </svg>
  );
}

function SunArcSvg({ sunrise, sunset, now, label }: { sunrise: number; sunset: number; now: number; label: string }) {
  const s = sunArc(sunrise, sunset, now);
  const W = 140;
  const H = 54;
  const px = 10 + s.x * (W - 20);
  const py = 8 + s.y * (H - 14);
  return (
    <svg viewBox={`0 0 ${W} ${H + 6}`} className="wx-sunarc" role="img" aria-label={label}>
      <line x1={4} y1={H - 6} x2={W - 4} y2={H - 6} stroke="var(--line-strong)" strokeWidth={1} />
      <path d={`M10 ${H - 6} A${(W - 20) / 2} ${H - 14} 0 0 1 ${W - 10} ${H - 6}`} fill="none" stroke="var(--text-3)" strokeWidth={1.4} strokeDasharray="3 3" />
      {s.up ? (
        <>
          <path d={`M10 ${H - 6} A${(W - 20) / 2} ${H - 14} 0 0 1 ${px} ${py}`} fill="none" stroke="var(--wx-sun)" strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={px} cy={py} r={6} fill="var(--wx-sun)" stroke="var(--bg-elev)" strokeWidth={2} />
        </>
      ) : <circle cx={s.f < 0 ? 10 : W - 10} cy={H - 6} r={4} fill="var(--text-3)" />}
    </svg>
  );
}

function MoonSvg({ phase, label }: { phase: number; label: string }) {
  // The lit part: a disc whose terminator is an ellipse that sweeps across with the phase.
  const r = 22;
  const k = Math.cos(phase * 2 * Math.PI); // 1 new → -1 full
  const waxing = phase < 0.5;
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  const d = `M30 ${30 - r} A${r} ${r} 0 0 ${sweepOuter} 30 ${30 + r} A${rx} ${r} 0 0 ${sweepInner} 30 ${30 - r}Z`;
  return (
    <svg viewBox="0 0 60 60" className="wx-moon" role="img" aria-label={label}>
      <circle cx={30} cy={30} r={r} fill="var(--wx-moon-dark)" />
      <path d={d} fill="var(--wx-moon)" />
    </svg>
  );
}

export function Tiles({ w, units, now = Date.now() }: { w: Weather; units: 'metric' | 'imperial'; now?: number }) {
  const c = w.current;
  const today = w.daily[0];
  const aq = aqiAdvice(c.aqi);
  const uv = uvAdvice(c.uv);
  const moon = moonPhase(now);
  const speed = units === 'imperial' ? 'mph' : 'km/h';
  const precip = units === 'imperial' ? 'in' : 'mm';
  const dp = c.dewPoint ?? dewPoint(c.temp, c.humidity, units);
  // Today's sun, or tomorrow's once today's has set.
  const sunDay = today && now > today.sunset && w.daily[1] ? w.daily[1] : today;
  const rainSoon = c.rainNextHour;
  const fmtRain = (v: number) => (units === 'imperial' ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const wetHour = w.hourly.find((h) => h.rainChance >= 50 && h.t > now);

  return (
    <div className="wx-tiles">
      <Tile title="Air quality" icon={ico('M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7')}>
        {aq && c.aqi !== undefined ? (
          <>
            <div className="wx-tile-row"><span className="wx-tile-big num">{Math.round(c.aqi)}</span><span className={`badge ${aq.tone}`}>{aq.level}</span></div>
            <Gauge pos={aqiPos(c.aqi)} label={`Air quality index ${Math.round(c.aqi)} of 300, ${aq.level}`} />
            <p className="wx-tile-note">{aq.advice}</p>
          </>
        ) : <p className="wx-tile-note">Not available for this place.</p>}
      </Tile>

      <Tile title="UV index" icon={ico('M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z')}>
        {uv ? (
          <>
            <div className="wx-tile-row"><span className="wx-tile-big num">{Math.round(c.uv ?? 0)}</span><span className={`badge ${uv.tone}`}>{uv.level}</span></div>
            <Scale kind="uv" pos={uvPos(c.uv ?? 0)} peak={today ? uvPos(today.uvMax) : undefined} label={`UV index now ${Math.round(c.uv ?? 0)}, today's peak ${Math.round(today?.uvMax ?? 0)}, on a scale of 0 to 11 or more`} />
            <p className="wx-tile-note">{today ? <>Peak today <b>{Math.round(today.uvMax)}</b>. </> : null}{uv.advice}</p>
          </>
        ) : <p className="wx-tile-note">Not available.</p>}
      </Tile>

      <Tile title="Wind" icon={ico('M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7')}>
        <div className="wx-tile-split">
          <div>
            <div className="wx-tile-row"><span className="wx-tile-big num">{Math.round(c.wind)}</span><span className="wx-tile-unit">{speed}</span></div>
            {c.gusts !== undefined ? <div className="wx-tile-note">Gusts <b className="num">{Math.round(c.gusts)} {speed}</b></div> : null}
            {c.windDir !== undefined ? <div className="wx-tile-note">From the {compass(c.windDir)}</div> : null}
          </div>
          <Compass dir={c.windDir} label={c.windDir !== undefined ? `Wind from the ${compass(c.windDir)} at ${Math.round(c.wind)} ${speed}` : `Wind ${Math.round(c.wind)} ${speed}`} />
        </div>
      </Tile>

      <Tile title="Humidity" icon={ico('M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z')}>
        <div className="wx-tile-row"><span className="wx-tile-big num">{Math.round(c.humidity)}%</span></div>
        <div className="wx-meter" role="img" aria-label={`Relative humidity ${Math.round(c.humidity)} percent`}><i style={{ width: `${Math.min(100, Math.max(0, c.humidity))}%` }} /></div>
        <p className="wx-tile-note">Dew point <b className="num">{Math.round(dp)}°</b>. {dewComfort(dp, units)}.</p>
      </Tile>

      <Tile title="Feels like" icon={ico('M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z')}>
        <div className="wx-tile-row"><span className="wx-tile-big num">{Math.round(c.feels)}°</span><span className="wx-tile-unit">actual {Math.round(c.temp)}°</span></div>
        <p className="wx-tile-note">{feelsReason(c.temp, c.feels, c.wind, c.humidity, units)}</p>
      </Tile>

      {sunDay ? (
        <Tile title={now < sunDay.sunrise ? 'Sunrise' : 'Sunset'} icon={ico('M17 18a5 5 0 0 0-10 0M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4')}>
          <div className="wx-tile-row"><span className="wx-tile-big num">{clock(now < sunDay.sunrise ? sunDay.sunrise : sunDay.sunset, w.tz)}</span></div>
          <SunArcSvg sunrise={sunDay.sunrise} sunset={sunDay.sunset} now={now} label={`Sunrise ${clock(sunDay.sunrise, w.tz)}, sunset ${clock(sunDay.sunset, w.tz)}`} />
          <p className="wx-tile-note">{now < sunDay.sunrise ? `Sunset ${clock(sunDay.sunset, w.tz)}` : `Sunrise ${clock(sunDay.sunrise, w.tz)}`} · {duration(sunDay.sunset - sunDay.sunrise)} of daylight</p>
        </Tile>
      ) : null}

      <Tile title="Precipitation" icon={ico('M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25')}>
        <div className="wx-tile-row">
          <span className="wx-tile-big num">{rainSoon !== undefined ? fmtRain(rainSoon) : today?.rainSum !== undefined ? fmtRain(today.rainSum) : `${today?.rainChance ?? 0}%`}</span>
          <span className="wx-tile-unit">{rainSoon !== undefined ? `${precip} in the next hour` : today?.rainSum !== undefined ? `${precip} today` : 'chance today'}</span>
        </div>
        <p className="wx-tile-note">
          {w.nowcast ? `${w.nowcast}. ` : ''}
          {today?.rainSum !== undefined && rainSoon !== undefined ? <>Today <b className="num">{fmtRain(today.rainSum)} {precip}</b> expected, {today.rainChance}% chance. </> : null}
          {!w.nowcast && wetHour ? `Rain likely from ${clock(wetHour.t, w.tz, true)}.` : !w.nowcast && !wetHour ? 'No rain expected in the next 24 hours.' : ''}
        </p>
      </Tile>

      {c.pressure !== undefined || c.visibility !== undefined ? (
        <Tile title="Pressure & visibility" icon={ico('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 12l4-4M12 7v1')}>
          {c.pressure !== undefined ? <div className="wx-tile-kv"><span>Pressure</span><b className="num">{pressureText(c.pressure, units)}</b></div> : null}
          {c.visibility !== undefined ? <div className="wx-tile-kv"><span>Visibility</span><b className="num">{visibilityText(c.visibility, units)}</b></div> : null}
          <p className="wx-tile-note">{c.visibility !== undefined && c.visibility < 2000 ? 'Low visibility: take care on the roads.' : c.pressure !== undefined ? (c.pressure < 1000 ? 'Low pressure: unsettled weather.' : c.pressure > 1022 ? 'High pressure: settled weather.' : 'Normal pressure.') : ''}</p>
        </Tile>
      ) : null}

      <Tile title="Moon" icon={ico('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z')}>
        <div className="wx-tile-split">
          <div>
            <div className="wx-tile-row"><span className="wx-tile-mid">{moon.name}</span></div>
            <p className="wx-tile-note">{moon.illumination}% lit</p>
          </div>
          <MoonSvg phase={moon.phase} label={`${moon.name}, ${moon.illumination} percent lit`} />
        </div>
      </Tile>
    </div>
  );
}
