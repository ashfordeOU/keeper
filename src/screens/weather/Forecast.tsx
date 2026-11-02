// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The forecast itself: the hero (sky-tinted, with a one-line summary), the
// hour-by-hour strip and the 10-day list whose rows open into that day's hours.

import { useMemo, useState } from 'react';
import type { Place, Weather } from '../../../core/weather';
import { clock, condition, dayKey, hourlyStrip, hoursOfDay, rangeBar, rangePos, skyFor, summarize, tempColor, type StripItem } from '../../../core/weather-view';
import { Icon } from '../../components/Icon';
import { openNative } from '../../lib/native';
import { WxGlyph } from './WxGlyph';

const r = Math.round;

export function Hero({ place, w, onToast, now = Date.now() }: { place: Place; w: Weather; onToast: (m: string) => void; now?: number }) {
  const today = w.daily[0];
  const c = condition(w.current.code);
  const sky = skyFor(w.current.code, w.current.isDay);
  const summary = useMemo(() => summarize(w, now), [w, now]);
  return (
    <section className={`wx-hero sky-${sky}`} aria-labelledby="wx-hero-place">
      <div className="wx-hero-main">
        <div className="wx-hero-text">
          <h2 id="wx-hero-place" className="wx-hero-place">{place.name.split(',')[0]}</h2>
          {place.name.includes(',') || place.country ? <div className="wx-hero-region">{[place.name.split(',').slice(1).join(',').trim(), place.country].filter(Boolean).join(', ')}</div> : null}
          <div className="wx-hero-temp num" aria-label={`${r(w.current.temp)} degrees`}>{r(w.current.temp)}°</div>
          <div className="wx-hero-cond">{c.label}</div>
          <div className="wx-hero-hl">
            {today ? <span>H {r(today.max)}°</span> : null}
            {today ? <span>L {r(today.min)}°</span> : null}
            <span>Feels like {r(w.current.feels)}°</span>
          </div>
        </div>
        <WxGlyph code={w.current.code} isDay={w.current.isDay} size={132} className="wx-hero-glyph" label={false} />
      </div>
      <p className="wx-hero-summary">{summary}</p>
      {w.nowcast ? <p className="wx-hero-nowcast"><Icon name="drop" size={13} /> {w.nowcast}</p> : null}
      <div className="wx-hero-actions">
        <button className="wx-quiet" data-testid="wx-open-native" onClick={() => void openNative('weather', { lat: place.lat, lon: place.lon, label: place.name }, onToast)}><Icon name="external" size={12} /> Open in Weather</button>
        <button className="wx-quiet" onClick={() => void openNative('maps', { lat: place.lat, lon: place.lon, label: place.name }, onToast)}><Icon name="map" size={12} /> Show on map</button>
      </div>
    </section>
  );
}

function StripCell({ it, tz }: { it: StripItem; tz?: string }) {
  if (it.kind !== 'hour') {
    return (
      <li className={`wx-hr sun ${it.kind}`}>
        <span className="wx-hr-t">{clock(it.t, tz)}</span>
        <svg width={26} height={26} viewBox="0 0 32 32" aria-hidden>
          <path d="M6 22h20" stroke="var(--text-3)" strokeWidth={1.6} strokeLinecap="round" />
          <path d="M10 22a6 6 0 0 1 12 0" fill="var(--wx-sun)" />
          <path d={it.kind === 'sunrise' ? 'M16 6v6M13 9l3-3 3 3' : 'M16 6v6M13 9l3 3 3-3'} stroke="var(--wx-sun)" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="wx-hr-v">{it.kind === 'sunrise' ? 'Sunrise' : 'Sunset'}</span>
        <span className="wx-hr-p" />
      </li>
    );
  }
  const c = condition(it.code);
  return (
    <li className={`wx-hr ${it.now ? 'now' : ''}`} aria-label={`${it.now ? 'Now' : clock(it.t, tz, true)}: ${r(it.temp)}°, ${c.label}${it.rainChance >= 10 ? `, ${it.rainChance}% chance of rain` : ''}`}>
      <span className="wx-hr-t">{it.now ? 'Now' : clock(it.t, tz, true)}</span>
      <WxGlyph code={it.code} isDay={it.isDay} size={28} label={false} />
      <span className="wx-hr-v num">{r(it.temp)}°</span>
      <span className="wx-hr-p num">{it.rainChance >= 10 ? `${it.rainChance}%` : ''}</span>
    </li>
  );
}

/** A scrolling row of hours (and sunrise/sunset). */
export function HourStrip({ items, tz, label }: { items: StripItem[]; tz?: string; label: string }) {
  return (
    // A scrolling region gets focus so the keyboard can scroll it.
    <div className="wx-strip" tabIndex={0} role="region" aria-label={label}>
      <ul>{items.map((it) => <StripCell key={`${it.kind}-${it.t}`} it={it} tz={tz} />)}</ul>
    </div>
  );
}

export function NextHours({ w, now = Date.now() }: { w: Weather; now?: number }) {
  const items = useMemo(() => hourlyStrip(w, now), [w, now]);
  return <HourStrip items={items} tz={w.tz} label="The next 24 hours, hour by hour" />;
}

const dayName = (t: number, i: number, tz?: string) => (i === 0 ? 'Today' : new Date(t + 12 * 3600_000).toLocaleDateString([], { weekday: 'short', timeZone: tz }));
const longDay = (t: number, i: number, tz?: string) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(t + 12 * 3600_000).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }));

export function Days({ w, units, now = Date.now() }: { w: Weather; units: 'metric' | 'imperial'; now?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const lo = Math.min(...w.daily.map((d) => d.min), w.current.temp);
  const hi = Math.max(...w.daily.map((d) => d.max), w.current.temp);
  const all = w.hours ?? w.hourly;
  return (
    <ol className="wx-days">
      {w.daily.map((d, i) => {
        const bar = rangeBar(d.min, d.max, lo, hi);
        const isToday = i === 0 && dayKey(now, w.tz) === dayKey(d.t, w.tz);
        const hours = open === i ? hoursOfDay(all, d.t, w.tz).filter((h) => h.t + 3600_000 > now) : [];
        const c = condition(d.code);
        const id = `wx-day-${i}`;
        return (
          <li key={d.t} className={`wx-day ${open === i ? 'open' : ''}`}>
            <button className="wx-day-row" aria-expanded={open === i} aria-controls={open === i ? id : undefined} onClick={() => setOpen(open === i ? null : i)}
              aria-label={`${longDay(d.t, i, w.tz)}: ${c.label}, low ${r(d.min)}°, high ${r(d.max)}°${d.rainChance ? `, ${d.rainChance}% chance of rain` : ''}`}>
              <span className="wx-day-name">{dayName(d.t, i, w.tz)}</span>
              <span className="wx-day-icon"><WxGlyph code={d.code} size={30} label={false} /></span>
              <span className="wx-day-rain num">{d.rainChance >= 10 ? <><Icon name="drop" size={11} />{d.rainChance}%</> : ''}</span>
              <span className="wx-day-lo num">{r(d.min)}°</span>
              <span className="wx-range" aria-hidden>
                <i style={{ left: `${bar.left}%`, width: `${bar.width}%`, background: `linear-gradient(90deg, ${tempColor(d.min, units)}, ${tempColor(d.max, units)})` }} />
                {isToday ? <b className="wx-range-now" style={{ left: `${rangePos(w.current.temp, lo, hi)}%` }} title={`Now ${r(w.current.temp)}°`} /> : null}
              </span>
              <span className="wx-day-hi num">{r(d.max)}°</span>
              <Icon name="chevronDown" size={14} className="wx-day-chev" />
            </button>
            {open === i ? (
              <div id={id} className="wx-day-detail">
                <div className="wx-day-facts">
                  <span>{c.label}</span>
                  <span>Sunrise {clock(d.sunrise, w.tz)}</span>
                  <span>Sunset {clock(d.sunset, w.tz)}</span>
                  <span>UV up to {r(d.uvMax)}</span>
                  {d.rainSum !== undefined ? <span>{units === 'imperial' ? d.rainSum.toFixed(2) : d.rainSum.toFixed(1)} {units === 'imperial' ? 'in' : 'mm'} of rain</span> : null}
                </div>
                {hours.length ? (
                  <HourStrip tz={w.tz} label={`${longDay(d.t, i, w.tz)}, hour by hour`}
                    items={hours.map((h) => ({ kind: 'hour', t: h.t, temp: h.temp, code: h.code, rainChance: h.rainChance, isDay: h.isDay ?? (h.t >= d.sunrise && h.t < d.sunset), now: false }))} />
                ) : <p className="small muted">Hour-by-hour detail is not available for this day.</p>}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
