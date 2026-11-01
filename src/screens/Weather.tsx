// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Weather: saved places, conditions, hourly charts, the week, air quality and
// UV advice, official alerts, a rain radar, climate comparison and forecasts
// for places in upcoming calendar events.

import { useEffect, useMemo, useState } from 'react';
import type { TripForecast } from '../../core/api-x';
import { addPlace, aqiAdvice, mapTileUrl, moonPhase, movePlace, radarTileUrl, tileGrid, uvAdvice, type MonthlyClimate, type RadarFrame, type WeatherAlert } from '../../core/forecast';
import { describeCode, type Place, type Weather as W } from '../../core/weather';
import { api } from '../api';
import { openNative } from '../lib/native';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useT } from '../i18n';
import { useAsync, useStore } from '../state';
import '../styles/screens-x.css';

const WX_ICON: Record<string, string> = { sun: '☀️', partly: '⛅', cloud: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' };
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayName = (t: number, i: number) => (i === 0 ? 'Today' : new Date(t).toLocaleDateString([], { weekday: 'short' }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const h = setTimeout(() => void api.weather.search(q.trim()).then(setFound).catch(() => setFound([])), 300);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className="wx-search">
      <div className="row"><Icon name="search" size={14} /><input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('weather.addPlace')} /></div>
      {found.length ? (
        <div className="menu wx-results">
          {found.map((p) => <button key={`${p.lat},${p.lon}`} onClick={() => { onPick(p); setQ(''); setFound([]); }}><Icon name="map" size={13} />{p.name}<span className="muted small" style={{ marginLeft: 'auto' }}>{p.country}</span></button>)}
        </div>
      ) : null}
    </div>
  );
}

function Radar({ place }: { place: Place }) {
  const [index, setIndex] = useState<{ host: string; frames: RadarFrame[] } | null | undefined>(undefined);
  const [z, setZ] = useState(6);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { void api.forecast.radar().then((r) => { setIndex(r); if (r) setFrame(r.frames.length - 1); }).catch(() => setIndex(null)); }, []);
  useEffect(() => {
    if (!index || !playing) return;
    const h = setInterval(() => setFrame((f) => (f + 1) % index.frames.length), 700);
    return () => clearInterval(h);
  }, [index, playing]);
  const grid = useMemo(() => tileGrid(place.lat, place.lon, z, 3, 3), [place, z]);
  if (index === undefined) return <Loading label="Loading radar…" />;
  if (!index) return <Empty icon="map" title="Radar is not available right now" />;
  const f = index.frames[frame];
  return (
    <div>
      <div className="wx-radar">
        {grid.map((g) => (
          <div key={`${g.x}-${g.y}`} className="wx-tile" style={{ gridColumn: g.col + 1, gridRow: g.row + 1 }}>
            <img src={mapTileUrl(z, g.x, g.y)} alt="" draggable={false} />
            <img className="wx-rain" src={radarTileUrl(index.host, f, z, g.x, g.y)} alt="" draggable={false} />
          </div>
        ))}
        <div className="wx-pin" title={place.name} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm icon" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={12} /></button>
        <input type="range" min={0} max={index.frames.length - 1} value={frame} onChange={(e) => { setPlaying(false); setFrame(+e.target.value); }} className="grow" />
        <span className="small muted num" style={{ width: 70 }}>{hhmm(f.time)}{f.time > Date.now() ? ' (forecast)' : ''}</span>
        <button className="btn sm icon" onClick={() => setZ(Math.max(3, z - 1))} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={12} /></button>
        <button className="btn sm icon" onClick={() => setZ(Math.min(9, z + 1))} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={12} /></button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Radar © RainViewer · Map © OpenStreetMap contributors</div>
    </div>
  );
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
  const [w, setW] = useState<W | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<'temp' | 'rain' | 'uv' | 'wind'>('temp');
  const [tab, setTab] = useState<'forecast' | 'radar' | 'compare' | 'trips'>('forecast');
  const place = places?.[sel];
  const alerts = useAsync<{ supported: boolean; alerts: WeatherAlert[] }>(() => (place ? api.forecast.alerts(place) : Promise.resolve({ supported: false, alerts: [] })), [place?.lat, place?.lon]);
  const trips = useAsync<TripForecast[]>(() => (tab === 'trips' ? api.forecast.trips(units) : Promise.resolve([])), [tab, units]);

  useEffect(() => { void api.forecast.places().then(setPlaces); }, []);
  useEffect(() => {
    if (!place) return;
    setW(null);
    setErr(null);
    void api.forecast.get(place, units).then(setW).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [place, units]);

  const save = async (list: Place[]) => {
    setPlaces(await api.forecast.savePlaces(list));
    // The Island shows the first place.
    if (list[0] && settings && JSON.stringify(settings.island.place) !== JSON.stringify(list[0])) await updateSettings({ island: { ...settings.island, place: list[0] } });
  };

  if (!places) return <Loading />;
  const deg = units === 'imperial' ? '°F' : '°C';
  const speed = units === 'imperial' ? 'mph' : 'km/h';
  const aq = aqiAdvice(w?.current.aqi);
  const uv = uvAdvice(w?.current.uv);
  const moon = moonPhase();
  const today = w?.daily[0];

  return (
    <div className="wx">
      <PageHead title={t('weather.title')} sub="Forecasts from Open-Meteo. Only the places you add are ever looked up.">
        <div className="seg">
          <button className={units === 'metric' ? 'on' : ''} onClick={() => settings && void updateSettings({ island: { ...settings.island, units: 'metric' } })}>°C</button>
          <button className={units === 'imperial' ? 'on' : ''} onClick={() => settings && void updateSettings({ island: { ...settings.island, units: 'imperial' } })}>°F</button>
        </div>
      </PageHead>

      <div className="row wx-places">
        {places.map((p, i) => (
          <div key={`${p.lat},${p.lon}`} className={`chip wx-place ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)}>
            {i > 0 ? <button title="Move left" aria-label="Move left" onClick={(e) => { e.stopPropagation(); void save(movePlace(places, i, i - 1)); setSel(i - 1); }}><Icon name="chevronLeft" size={10} /></button> : null}
            <span>{p.name}</span>
            <button title={t('common.remove')} aria-label={t('common.remove')} onClick={(e) => { e.stopPropagation(); void save(places.filter((_, k) => k !== i)); setSel(0); }}><Icon name="close" size={10} /></button>
          </div>
        ))}
        <PlaceSearch onPick={(p) => { const next = addPlace(places, p); void save(next); setSel(next.findIndex((x) => x.lat === p.lat && x.lon === p.lon)); toast(`Added ${p.name}`); }} />
      </div>

      {!place ? <Empty icon="sun" title="Add a place to see its weather">Search for a city above. Keeper never looks up where you are on its own.</Empty> : err ? <Empty icon="warning" title="Could not load the forecast">{err}</Empty> : !w ? <Loading label="Loading forecast…" /> : (
        <>
          <div className="wx-hero card pad">
            <div className="wx-now">
              <div className="wx-big">{WX_ICON[describeCode(w.current.code).icon]} {Math.round(w.current.temp)}°</div>
              <div>
                <h2>{place.name}</h2>
                <div className="sub">{describeCode(w.current.code).label} · feels like {Math.round(w.current.feels)}{deg}</div>
                {today ? <div className="small muted">High {Math.round(today.max)}° · Low {Math.round(today.min)}° · {today.rainChance}% chance of rain</div> : null}
                {w.nowcast ? <div className="small" style={{ color: 'var(--accent)', marginTop: 4 }}>{w.nowcast}</div> : null}
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <button className="btn sm" data-testid="wx-open-native" onClick={() => void openNative('weather', { lat: place.lat, lon: place.lon, label: place.name }, toast)}><Icon name="external" size={12} /> Open in Weather</button>
                  <button className="btn sm ghost" onClick={() => void openNative('maps', { lat: place.lat, lon: place.lon, label: place.name }, toast)}><Icon name="map" size={12} /> Show on map</button>
                </div>
              </div>
            </div>
            <div className="wx-facts">
              <div><span className="muted small">Wind</span><b>{Math.round(w.current.wind)} {speed}</b></div>
              <div><span className="muted small">Humidity</span><b>{w.current.humidity}%</b></div>
              {today ? <div><span className="muted small">Sunrise</span><b>{hhmm(today.sunrise)}</b></div> : null}
              {today ? <div><span className="muted small">Sunset</span><b>{hhmm(today.sunset)}</b></div> : null}
              <div><span className="muted small">Moon</span><b>{moon.name}</b></div>
            </div>
          </div>

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

          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div className="card pad">
              <h3>Air quality</h3>
              {aq ? <><div className="row" style={{ margin: '6px 0' }}><span className="wx-num">{w.current.aqi}</span><span className={`badge ${aq.tone}`}>{aq.level}</span></div><div className="small sub">{aq.advice}</div></> : <div className="small muted">Not available for this place.</div>}
            </div>
            <div className="card pad">
              <h3>UV index</h3>
              {uv ? <><div className="row" style={{ margin: '6px 0' }}><span className="wx-num">{Math.round(w.current.uv ?? 0)}</span><span className={`badge ${uv.tone}`}>{uv.level}</span><span className="small muted">today’s peak {Math.round(today?.uvMax ?? 0)}</span></div><div className="small sub">{uv.advice}</div></> : <div className="small muted">Not available.</div>}
            </div>
          </div>

          <div className="seg" style={{ margin: '18px 0 10px' }}>
            {(['forecast', 'radar', 'compare', 'trips'] as const).map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k === 'forecast' ? t('weather.hourly') : k === 'radar' ? t('weather.radar') : k === 'compare' ? t('weather.compare') : t('weather.trips')}</button>
            ))}
          </div>

          {tab === 'forecast' ? (
            <>
              <div className="card pad">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <h3>{t('weather.hourly')}</h3>
                  <div className="seg">
                    {(['temp', 'rain', 'uv', 'wind'] as const).map((m) => <button key={m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{m === 'temp' ? 'Temperature' : m === 'rain' ? 'Rain' : m === 'uv' ? 'UV' : 'Wind'}</button>)}
                  </div>
                </div>
                <Chart
                  labels={w.hourly.map((h) => new Date(h.t).toLocaleTimeString([], { hour: 'numeric' }))}
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
              <div className="card pad" style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 8 }}>{t('weather.week')}</h3>
                {(() => {
                  const lo = Math.min(...w.daily.map((d) => d.min));
                  const hi = Math.max(...w.daily.map((d) => d.max));
                  return w.daily.map((d, i) => (
                    <div key={d.t} className="wx-day">
                      <span style={{ width: 52 }}>{dayName(d.t, i)}</span>
                      <span style={{ width: 28 }} title={describeCode(d.code).label}>{WX_ICON[describeCode(d.code).icon]}</span>
                      <span className="small muted num" style={{ width: 44 }}>{d.rainChance ? `${d.rainChance}%` : ''}</span>
                      <span className="num muted" style={{ width: 36, textAlign: 'right' }}>{Math.round(d.min)}°</span>
                      <div className="wx-range"><i style={{ left: `${((d.min - lo) / (hi - lo || 1)) * 100}%`, right: `${100 - ((d.max - lo) / (hi - lo || 1)) * 100}%` }} /></div>
                      <span className="num" style={{ width: 36 }}>{Math.round(d.max)}°</span>
                    </div>
                  ));
                })()}
              </div>
              {alerts.data && !alerts.data.supported ? <div className="small muted" style={{ marginTop: 8 }}>Official weather alerts are shown for places in the United States; they are not available for this region yet.</div> : null}
            </>
          ) : tab === 'radar' ? (
            <div className="card pad"><Radar place={place} /></div>
          ) : tab === 'compare' ? (
            <div className="card pad"><Compare places={places} units={units} /></div>
          ) : (
            <div className="card pad">
              {trips.loading ? <Loading label="Looking at your calendar…" /> : !trips.data?.length ? (
                <Empty icon="calendar" title="No trips in the next two weeks">Events with an address in your calendar (Island settings → calendar link) show their forecast here.</Empty>
              ) : trips.data.map((tr) => (
                <div key={tr.stop.event.uid} className="wx-trip">
                  <div className="grow">
                    <b>{tr.stop.event.title}</b>
                    <div className="small muted">{new Date(tr.stop.event.start).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {tr.stop.location}</div>
                  </div>
                  {tr.day ? <div className="wx-trip-w"><span>{WX_ICON[describeCode(tr.day.code).icon]}</span><b>{Math.round(tr.day.min)}° – {Math.round(tr.day.max)}°</b><span className="small muted">{tr.day.rainChance}% rain</span></div>
                    : <span className="small muted">{tr.place ? 'Too far ahead for a forecast' : 'Place not found'}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
