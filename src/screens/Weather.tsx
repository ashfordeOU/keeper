// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Weather: saved places, a sky-tinted summary of now, the next hours, the next
// ten days, tiles for air, UV, wind, sun and more, official alerts, a rain
// radar, climate comparison and forecasts for places in calendar events.
// Parts live in ./weather/; the reasoning (summary, bars, icons) in core/weather-view.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { addPlace, movePlace, type MonthlyClimate, type RadarFrame, type WeatherAlert } from '../../core/forecast';
import type { Place, Weather as W } from '../../core/weather';
import { api } from '../api';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useT } from '../i18n';
import { useAsync, useStore } from '../state';
import { Days, Hero, NextHours } from './weather/Forecast';
import { PlaceCards, PlaceSearch, placeKey } from './weather/Places';
import { RadarMap } from './weather/RadarMap';
import { Tiles } from './weather/Tiles';
import { Trips } from './weather/Trips';
import '../styles/screens-x.css';
import '../styles/weather.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Tab = 'forecast' | 'radar' | 'compare' | 'trips';
const TABS: Tab[] = ['forecast', 'radar', 'compare', 'trips'];

function Radar({ place }: { place: Place }) {
  const [index, setIndex] = useState<{ host: string; frames: RadarFrame[] } | null | undefined>(undefined);
  useEffect(() => { void api.forecast.radar().then((r) => setIndex(r && r.frames.length ? r : null)).catch(() => setIndex(null)); }, []);
  if (index === undefined) return <Loading label="Loading radar…" />;
  if (!index) return <Empty icon="map" title="Radar is not available right now" />;
  return <RadarMap place={place} index={index} />;
}

function Compare({ places, units }: { places: Place[]; units: 'metric' | 'imperial' }) {
  const [a, setA] = useState(0);
  const [b, setB] = useState(Math.min(1, places.length - 1));
  const [data, setData] = useState<[MonthlyClimate[], MonthlyClimate[]] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!places[a] || !places[b]) return;
    setData(null);
    setError(null);
    void Promise.all([api.forecast.climate(places[a]), api.forecast.climate(places[b])]).then((r) => setData(r as [MonthlyClimate[], MonthlyClimate[]])).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [a, b, places]);
  const conv = (c: number) => (units === 'imperial' ? Math.round(c * 1.8 + 32) : Math.round(c));
  if (places.length < 2) return <div className="small muted">Add a second place to compare their climates month by month.</div>;
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select className="input" value={a} onChange={(e) => setA(+e.target.value)}>{places.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select>
        <span className="muted">vs</span>
        <select className="input" value={b} onChange={(e) => setB(+e.target.value)}>{places.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select>
        <span className="small muted">Averages of the last five years</span>
      </div>
      {error ? <div className="small" style={{ color: 'var(--danger)' }}>{error}</div> : !data ? <Loading label="Reading climate records…" /> : (
        <>
          <Chart labels={MONTHS} height={160} series={[
            { label: `${places[a].name} high`, color: 'var(--c-image)', values: data[0].map((m) => (Number.isFinite(m.avgMax) ? conv(m.avgMax) : null)), format: (v) => `${v}°` },
            { label: `${places[b].name} high`, color: 'var(--c-document)', values: data[1].map((m) => (Number.isFinite(m.avgMax) ? conv(m.avgMax) : null)), format: (v) => `${v}°` },
          ]} yFormat={(v) => `${Math.round(v)}°`} />
          <table className="file-list" style={{ marginTop: 10 }}>
            <thead><tr><th>Month</th><th>{places[a].name}</th><th>{places[b].name}</th></tr></thead>
            <tbody>
              {MONTHS.map((m, i) => (
                <tr key={m}>
                  <td>{m}</td>
                  {[data[0][i], data[1][i]].map((c, k) => <td key={k} className="num">{Number.isFinite(c.avgMax) ? `${conv(c.avgMin)}° – ${conv(c.avgMax)}°` : '—'} · {c.rainMm} mm, {c.rainyDays} wet days{c.sunHours ? ` · ${c.sunHours} h sun` : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function Weather() {
  const t = useT();
  const { settings, updateSettings, toast } = useStore();
  const units = settings?.island.units ?? 'metric';
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [sel, setSel] = useState(0);
  const [wx, setWx] = useState<Record<string, W | undefined>>({});
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  const [metric, setMetric] = useState<'temp' | 'rain' | 'uv' | 'wind'>('temp');
  const [details, setDetails] = useState(false);
  const [tab, setTab] = useState<Tab>('forecast');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const place = places?.[sel];
  const alerts = useAsync<{ supported: boolean; alerts: WeatherAlert[] }>(() => (place ? api.forecast.alerts(place) : Promise.resolve({ supported: false, alerts: [] })), [place?.lat, place?.lon]);

  useEffect(() => { void api.forecast.places().then(setPlaces); }, []);
  // Every saved place's forecast (the cards show their temperature); the service caches them.
  useEffect(() => {
    if (!places) return;
    let live = true;
    setWx({});
    setErrs({});
    for (const p of places) {
      void api.forecast.get(p, units)
        .then((w) => live && setWx((m) => ({ ...m, [placeKey(p)]: w })))
        .catch((e: unknown) => live && setErrs((m) => ({ ...m, [placeKey(p)]: e instanceof Error ? e.message : String(e) })));
    }
    return () => { live = false; };
  }, [places, units]);

  const save = async (list: Place[]) => {
    setPlaces(await api.forecast.savePlaces(list));
    // The Island shows the first place.
    if (list[0] && settings && JSON.stringify(settings.island.place) !== JSON.stringify(list[0])) await updateSettings({ island: { ...settings.island, place: list[0] } });
  };
  const now = useMemo(() => Date.now(), [wx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!places) return <Loading />;
  const w = place ? wx[placeKey(place)] : undefined;
  const err = place ? errs[placeKey(place)] : undefined;
  const deg = units === 'imperial' ? '°F' : '°C';
  const speed = units === 'imperial' ? 'mph' : 'km/h';
  const tabLabel = (k: Tab) => (k === 'forecast' ? t('weather.hourly') : k === 'radar' ? t('weather.radar') : k === 'compare' ? t('weather.compare') : t('weather.trips'));
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : d ? (i + d + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to]);
    tabRefs.current[TABS[to]]?.focus();
  };

  return (
    <div className="wx">
      <PageHead title={t('weather.title')}>
        <div className="seg" role="group" aria-label="Temperature units">
          <button className={units === 'metric' ? 'on' : ''} aria-pressed={units === 'metric'} onClick={() => settings && void updateSettings({ island: { ...settings.island, units: 'metric' } })}>°C</button>
          <button className={units === 'imperial' ? 'on' : ''} aria-pressed={units === 'imperial'} onClick={() => settings && void updateSettings({ island: { ...settings.island, units: 'imperial' } })}>°F</button>
        </div>
      </PageHead>

      <div className="wx-places">
        <PlaceCards places={places} sel={sel} weather={wx} now={now}
          onSelect={setSel}
          onRemove={(i) => { void save(places.filter((_, k) => k !== i)); setSel((s) => (s === i ? 0 : s > i ? s - 1 : s)); }}
          onMove={(from, to) => { const cur = places[sel]; const next = movePlace(places, from, to); void save(next); setSel(Math.max(0, next.indexOf(cur))); }} />
        <PlaceSearch placeholder={t('weather.addPlace')} onPick={(p) => { const next = addPlace(places, p); void save(next); setSel(next.findIndex((x) => x.lat === p.lat && x.lon === p.lon)); toast(`Added ${p.name}`); }} />
      </div>

      {!place ? <Empty icon="sun" title="Add a place to see its weather">Search for a city above. Keeper never looks up where you are on its own.</Empty> : err ? <Empty icon="warning" title="Could not load the forecast">{err}</Empty> : !w ? <Loading label="Loading forecast…" /> : (
        <>
          <Hero place={place} w={w} onToast={toast} now={now} />

          {alerts.data?.alerts.length ? (
            <div className="wx-alerts">
              {alerts.data.alerts.map((a) => (
                <details key={a.id} className={`card pad wx-alert ${a.severity}`}>
                  <summary><Icon name="warning" size={14} /> <b>{a.title}</b> <span className="small muted">{a.headline}</span></summary>
                  <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>
                  {a.instruction ? <p className="small"><b>What to do:</b> {a.instruction}</p> : null}
                  <div className="small muted">{a.source}{a.ends ? ` · until ${new Date(a.ends).toLocaleString()}` : ''}</div>
                </details>
              ))}
            </div>
          ) : null}

          <div className="wx-tabs" role="tablist" aria-label="Weather views">
            {TABS.map((k, i) => (
              <button key={k} ref={(el) => { tabRefs.current[k] = el; }} role="tab" id={`wx-tab-${k}`} aria-selected={tab === k} aria-controls={tab === k ? `wx-panel-${k}` : undefined} tabIndex={tab === k ? 0 : -1}
                data-wx-tab={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} onKeyDown={(e) => onTabKey(e, i)}>{tabLabel(k)}</button>
            ))}
          </div>

          <div role="tabpanel" id={`wx-panel-${tab}`} aria-labelledby={`wx-tab-${tab}`} className="wx-panel">
            {tab === 'forecast' ? (
              <>
                <section className="wx-card" aria-labelledby="wx-h-hours">
                  <div className="wx-card-head">
                    <h2 id="wx-h-hours">{t('weather.hourly')}</h2>
                    <button className="wx-quiet small" aria-expanded={details} aria-controls={details ? 'wx-details' : undefined} onClick={() => setDetails(!details)}>
                      <Icon name="chart" size={12} /> {details ? 'Hide details' : 'Details'}
                    </button>
                  </div>
                  <NextHours w={w} now={now} />
                  {details ? (
                    <div id="wx-details" className="wx-details">
                      <div className="seg" role="group" aria-label="Chart shows">
                        {(['temp', 'rain', 'uv', 'wind'] as const).map((m) => <button key={m} className={metric === m ? 'on' : ''} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === 'temp' ? 'Temperature' : m === 'rain' ? 'Rain' : m === 'uv' ? 'UV' : 'Wind'}</button>)}
                      </div>
                      <div role="img" aria-label={`Chart of the next 24 hours: ${metric === 'temp' ? 'temperature and chance of rain' : metric === 'rain' ? 'rain amount and chance' : metric === 'uv' ? 'UV index' : 'wind speed'}`}>
                        <Chart
                          labels={w.hourly.map((h) => new Date(h.t).toLocaleTimeString([], { hour: 'numeric', timeZone: w.tz }))}
                          height={170}
                          min={metric === 'temp' ? Math.floor(Math.min(...w.hourly.map((h) => h.temp)) - 2) : 0}
                          max={metric === 'rain' ? undefined : metric === 'uv' ? Math.max(8, ...w.hourly.map((h) => h.uv)) : undefined}
                          rightMax={100}
                          yFormat={(v) => (metric === 'temp' ? `${Math.round(v)}°` : metric === 'rain' ? `${v.toFixed(1)}` : `${Math.round(v)}`)}
                          series={
                            metric === 'temp' ? [{ label: 'Temperature', color: 'var(--c-image)', values: w.hourly.map((h) => h.temp), format: (v) => `${Math.round(v)}${deg}` }, { label: 'Chance of rain', color: 'var(--c-document)', values: w.hourly.map((h) => h.rainChance), bars: true, right: true, format: (v) => `${v}%` }]
                            : metric === 'rain' ? [{ label: 'Rain', color: 'var(--c-document)', values: w.hourly.map((h) => h.rain), bars: true, format: (v) => `${v.toFixed(1)} ${units === 'imperial' ? 'in' : 'mm'}` }, { label: 'Chance', color: 'var(--c-video)', values: w.hourly.map((h) => h.rainChance), right: true, format: (v) => `${v}%` }]
                            : metric === 'uv' ? [{ label: 'UV index', color: 'var(--c-audio)', values: w.hourly.map((h) => h.uv), format: (v) => v.toFixed(1) }]
                            : [{ label: 'Wind', color: 'var(--c-installer)', values: w.hourly.map((h) => h.wind), format: (v) => `${Math.round(v)} ${speed}` }]
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </section>
                <div className="wx-body">
                  <section className="wx-card" aria-labelledby="wx-h-days">
                    <div className="wx-card-head"><h2 id="wx-h-days">{t('weather.week')}</h2></div>
                    <Days w={w} units={units} now={now} />
                  </section>
                  <section aria-labelledby="wx-h-now" className="wx-now-tiles">
                    <h2 id="wx-h-now" className="sr-only">Conditions now</h2>
                    <Tiles w={w} units={units} now={now} />
                  </section>
                </div>
              </>
            ) : tab === 'radar' ? (
              <div className="wx-card flush"><Radar place={place} /></div>
            ) : tab === 'compare' ? (
              <div className="wx-card"><Compare places={places} units={units} /></div>
            ) : (
              <div className="wx-card"><Trips units={units} /></div>
            )}
          </div>
        </>
      )}

      <footer className="wx-foot">
        <Icon name="shield" size={12} />
        <span>Forecasts from Open-Meteo. Only the places you add are ever looked up.</span>
        {alerts.data && !alerts.data.supported && place ? <span>Official weather alerts are shown for places in the United States.</span> : null}
      </footer>
    </div>
  );
}
