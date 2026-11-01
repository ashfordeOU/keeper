// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: one private place to see where your things, people and
// activities have been. Timeline (day, week, month, year), trips, activities,
// live positions, places, sources and settings. Everything stays on this computer.

import { useEffect, useMemo, useState } from 'react';
import type { MapTrack, TimelineView, TracksOverview } from '../../core/tracks/api';
import { countryLabel } from '../../core/tracks/places';
import { fmtDistance, fmtDuration } from '../../core/tracks/stats';
import { shiftSpan, spanRange, type Span } from '../../core/tracks/timeline';
import { SPORT_LABEL, type LivePosition, type TimelineEntry, type Trip } from '../../core/tracks/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { MapButtons } from '../components/NativeOpen';
import { Empty, Loading, PageHead } from '../components/ui';
import { useAsync, useStore } from '../state';
import { TracksMap, sportColour, type MapMarker } from './TracksMap';
import { Activities, Places, Settings, Sources } from './TracksMore';
import '../styles/tracks.css';

type Tab = 'timeline' | 'trips' | 'activities' | 'live' | 'places' | 'sources' | 'settings';
const TABS: [Tab, string][] = [['timeline', 'Timeline'], ['trips', 'Trips'], ['activities', 'Activities'], ['live', 'Live'], ['places', 'Places'], ['sources', 'Sources'], ['settings', 'Settings']];

export const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const dayLabel = (t: number, year = false) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
export const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Which tab a route argument opens. */
function tabOf(arg?: string): Tab {
  if (!arg) return 'timeline';
  const head = arg.split(':')[0];
  if (head === 'live') return 'live';
  if (head === 'track' || head === 'activities') return 'activities';
  if (head === 'trip' || head === 'trips') return 'trips';
  if (head === 'privacy' || head === 'settings') return 'settings';
  if (head === 'sources' || head === 'import') return 'sources';
  if (head === 'places') return 'places';
  return 'timeline';
}

export function Tracks() {
  const { route, go } = useStore();
  const tab = tabOf(route.arg);
  const [n, setN] = useState(0);
  const ov = useAsync(() => api.tracks.overview(), [n]);
  useEffect(() => api.on('tracks-changed', () => setN((x) => x + 1)), []);
  const file = route.arg?.startsWith('file:') ? route.arg.slice(5) : undefined;
  const o = ov.data;
  return (
    <div className="tk-page">
      <PageHead title="Places & Tracks" sub={o ? summaryLine(o) : 'Where your things, people and activities have been. Private, on this computer.'}>
        <button className="btn sm" onClick={() => void api.tracks.importFiles().then((r) => { if (r.imported.length) go({ name: 'tracks' }); })}><Icon name="down" size={13} />Import…</button>
      </PageHead>
      <div className="seg tk-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} role="tab" className={tab === id && !file ? 'on' : ''} onClick={() => go({ name: 'tracks', arg: id === 'timeline' ? undefined : id })}>{label}</button>)}
      </div>
      {o?.encryptionNote ? <div className="tk-note warn"><Icon name="lock" size={13} />{o.encryptionNote}</div> : null}
      {file ? <FilePreview path={file} /> : !o ? <Loading /> : (
        <>
          {tab === 'timeline' ? <Timeline o={o} search={route.arg === 'search'} /> : null}
          {tab === 'trips' ? <Trips open={route.arg?.startsWith('trip:') ? route.arg.slice(5) : undefined} /> : null}
          {tab === 'activities' ? <Activities open={route.arg?.startsWith('track:') ? route.arg.slice(6) : undefined} /> : null}
          {tab === 'live' ? <Live o={o} selected={route.arg?.startsWith('live:') ? route.arg.slice(5) : undefined} /> : null}
          {tab === 'places' ? <Places /> : null}
          {tab === 'sources' ? <Sources o={o} importNow={route.arg === 'import'} /> : null}
          {tab === 'settings' ? <Settings o={o} /> : null}
        </>
      )}
    </div>
  );
}

function summaryLine(o: TracksOverview): string {
  const c = o.counts;
  const bits = [c.tracks ? `${c.tracks} track${c.tracks === 1 ? '' : 's'}` : '', c.visits ? `${c.visits} visits` : '', c.points ? `${c.points.toLocaleString()} positions` : '', c.photos ? `${c.photos} photos` : ''].filter(Boolean);
  return bits.length ? `${bits.join(' · ')} · ${o.encrypted ? 'encrypted on this computer' : 'on this computer'}` : 'Where your things, people and activities have been. Private, on this computer.';
}

// ---------------------------------------------------------------- timeline

const ENTRY_ICON: Record<TimelineEntry['kind'], string> = { stay: 'pin', move: 'arrowUp', activity: 'bolt', photo: 'image', event: 'calendar' };

export function EntryRow({ e, onPick, selected }: { e: TimelineEntry; onPick?: (id: string) => void; selected?: boolean }) {
  const { go } = useStore();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const dur = e.end - e.start;
  let title = '', sub = '';
  if (e.kind === 'stay') { title = e.name ?? 'A place'; sub = `${hm(e.start)}–${hm(e.end)} · ${fmtDuration(dur / 1000)}`; }
  else if (e.kind === 'move') { title = `${SPORT_LABEL[e.mode]} · ${fmtDistance(e.distanceM)}`; sub = `${hm(e.start)}–${hm(e.end)} · ${fmtDuration(dur / 1000)}`; }
  else if (e.kind === 'activity') { title = e.name; sub = `${hm(e.start)} · ${SPORT_LABEL[e.sport]} · ${fmtDistance(e.distanceM)} · ${fmtDuration(dur / 1000)}`; }
  else if (e.kind === 'photo') { title = e.path.split(/[\\/]/).pop() ?? 'Photo'; sub = hm(e.start); }
  else { title = e.title; sub = `${hm(e.start)}${e.location ? ` · ${e.location}` : ''}`; }
  return (
    <div className={`tk-entry ${e.kind} ${selected ? 'sel' : ''}`} onClick={() => onPick?.(e.kind === 'activity' ? e.track : e.id)}>
      <span className="tk-ico" style={e.kind === 'move' ? { color: sportColour(e.mode) } : e.kind === 'activity' ? { color: sportColour(e.sport) } : undefined}><Icon name={e.kind === 'move' ? 'send' : ENTRY_ICON[e.kind]} size={14} /></span>
      <div className="grow">
        <div className="tk-title">{title}</div>
        <div className="muted small">{sub}</div>
        {naming ? (
          <form className="row tk-inline" onClick={(x) => x.stopPropagation()} onSubmit={(x) => { x.preventDefault(); if (e.kind === 'stay' && name.trim()) void api.tracks.savePlace({ id: '', name: name.trim(), lat: e.lat, lon: e.lon, radiusM: 150, kind: /^home$/i.test(name.trim()) ? 'home' : /^work$/i.test(name.trim()) ? 'work' : 'other' }).then(() => setNaming(false)); }}>
            <input className="input sm" autoFocus value={name} placeholder="Home, Work, Gym…" onChange={(x) => setName(x.target.value)} />
            <button className="btn sm primary" type="submit">Save</button>
            <button className="btn sm ghost" type="button" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : null}
      </div>
      {e.kind === 'stay' && !naming ? <MapButtons compact place={{ lat: e.lat, lon: e.lon, label: e.name }} /> : null}
      {e.kind === 'stay' && !e.place && !naming ? <button className="btn ghost sm" onClick={(x) => { x.stopPropagation(); setNaming(true); }}>Name</button> : null}
      {e.kind === 'activity' ? <button className="btn ghost sm" onClick={(x) => { x.stopPropagation(); go({ name: 'tracks', arg: `track:${e.track}` }); }}>Details</button> : null}
    </div>
  );
}

export function markersOf(entries: TimelineEntry[]): MapMarker[] {
  return entries.flatMap((e): MapMarker[] => {
    if (e.kind === 'stay') return [{ id: e.id, lat: e.lat, lon: e.lon, label: e.name ?? 'A place', kind: 'stay', sub: `${hm(e.start)}–${hm(e.end)}` }];
    if (e.kind === 'photo') return [{ id: e.id, lat: e.lat, lon: e.lon, label: e.path.split(/[\\/]/).pop() ?? 'Photo', kind: 'photo', sub: hm(e.start) }];
    return [];
  });
}

function Timeline({ o, search }: { o: TracksOverview; search?: boolean }) {
  const [span, setSpan] = useState<Span>('day');
  const [at, setAt] = useState<number>(() => o.range && o.range[1] < Date.now() - 86_400_000 ? o.range[1] : Date.now());
  const [view, setView] = useState<TimelineView | null>(null);
  const [sel, setSel] = useState<string | undefined>();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.tracks.search>> | null>(null);
  const [from, to] = spanRange(span, at);
  useEffect(() => {
    let alive = true;
    setView(null);
    void api.tracks.timeline(from, to).then((v) => { if (alive) setView(v); }).catch(() => alive && setView({ entries: [], lines: [], days: [] }));
    return () => { alive = false; };
  }, [from, to, o.counts.tracks, o.counts.visits, o.counts.points, o.counts.photos]);
  const title = span === 'day' ? dayLabel(from, true) : span === 'week' ? `${dayLabel(from)} – ${dayLabel(to - 1, true)}` : span === 'month' ? new Date(from).toLocaleDateString([], { month: 'long', year: 'numeric' }) : String(new Date(from).getFullYear());
  const empty = !o.counts.tracks && !o.counts.visits && !o.counts.points && !o.counts.photos;
  if (empty) return <Welcome />;
  const entries = view?.entries ?? [];
  const lines: MapTrack[] = view?.lines ?? [];
  return (
    <div className="tk-split">
      <div className="tk-col">
        <form className="row tk-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void api.tracks.search(q.trim()).then(setFound); }}>
          <Icon name="search" size={14} />
          <input className="input grow" autoFocus={search} value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setFound(null); }} placeholder="When was I last in Tallinn?" />
        </form>
        {found ? (
          <div className="card pad tk-found">
            <div className="tk-title">{found.answer}</div>
            {found.hits.slice(0, 8).map((h) => <button key={h.stay.id} className="tk-hit" onClick={() => { setSpan('day'); setAt(h.stay.start); setFound(null); }}>{dayLabel(h.stay.start, true)} · {h.stay.name ?? 'A place'}</button>)}
          </div>
        ) : null}
        <div className="row tk-nav">
          <div className="seg">{(['day', 'week', 'month', 'year'] as Span[]).map((s) => <button key={s} className={span === s ? 'on' : ''} onClick={() => setSpan(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
          <button className="btn sm icon" title="Earlier" aria-label="Earlier" onClick={() => setAt(shiftSpan(span, at, -1))}><Icon name="chevronLeft" size={13} /></button>
          <button className="btn sm icon" title="Later" aria-label="Later" onClick={() => setAt(shiftSpan(span, at, 1))}><Icon name="chevronRight" size={13} /></button>
          <button className="btn sm ghost" onClick={() => setAt(Date.now())}>Today</button>
          {o.range ? <button className="btn sm ghost" onClick={() => setAt(o.range![1])}>Latest</button> : null}
        </div>
        <h3 className="tk-h">{title}</h3>
        {!view ? <Loading /> : span === 'day' || span === 'week' ? (
          entries.length ? (
            <div className="tk-list">
              {span === 'week' ? groupByDay(entries).map(([d, es]) => (
                <div key={d}><div className="tk-day">{dayLabel(d)}</div>{es.map((e) => <EntryRow key={e.id} e={e} selected={sel === e.id} onPick={setSel} />)}</div>
              )) : entries.map((e) => <EntryRow key={e.id} e={e} selected={sel === e.id || (e.kind === 'activity' && sel === e.track)} onPick={setSel} />)}
            </div>
          ) : <Empty icon="map" title="Nothing recorded">Try another day, or press Latest.</Empty>
        ) : (
          <div className="tk-list">
            {view.days.filter((d) => d.stays || d.moves || d.activities).map((d) => (
              <button key={d.day} className="tk-dayrow" onClick={() => { setSpan('day'); setAt(d.day); }}>
                <b>{dayLabel(d.day)}</b>
                <span className="muted small grow ellipsis">{d.places.slice(0, 4).join(', ') || `${d.stays} place${d.stays === 1 ? '' : 's'}`}</span>
                <span className="small">{d.activities ? `${d.activities} activit${d.activities === 1 ? 'y' : 'ies'} · ` : ''}{fmtDistance(d.distanceM)}</span>
              </button>
            ))}
            {!view.days.some((d) => d.stays || d.moves || d.activities) ? <Empty icon="map" title="Nothing recorded in this time" /> : null}
          </div>
        )}
      </div>
      <div className="tk-col map">
        <TracksMap lines={lines} markers={markersOf(entries)} selected={sel} onPick={setSel} height={520} />
      </div>
    </div>
  );
}

function groupByDay(entries: TimelineEntry[]): [number, TimelineEntry[]][] {
  const m = new Map<number, TimelineEntry[]>();
  for (const e of entries) {
    const d = new Date(e.start);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return [...m.entries()];
}

function Welcome() {
  const { go } = useStore();
  return (
    <div className="card pad tk-welcome">
      <Icon name="map" size={28} />
      <h3>Your private map of where you have been</h3>
      <p className="muted">Import a GPX, FIT or TCX file, your Google Timeline export or an Apple Health export, or switch on a source. Nothing leaves this computer.</p>
      <div className="row">
        <button className="btn primary" onClick={() => void api.tracks.importFiles()}><Icon name="down" size={13} />Import files…</button>
        <button className="btn" onClick={() => go({ name: 'tracks', arg: 'sources' })}>Add a source</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- trips

function Trips({ open }: { open?: string }) {
  const { go } = useStore();
  const trips = useAsync(() => api.tracks.trips(), []);
  if (trips.loading && !trips.data) return <Loading label="Building trips…" />;
  const list = trips.data ?? [];
  const cur = list.find((t) => t.id === open);
  if (cur) return <TripView trip={cur} />;
  if (!list.length) return <Empty icon="map" title="No trips yet">Trips appear by themselves when your timeline shows a night or more away from home. Name your home on the Places tab to help.</Empty>;
  return (
    <div className="tk-trips">
      {list.map((t) => (
        <button key={t.id} className="card pad hover tk-trip-card" onClick={() => go({ name: 'tracks', arg: `trip:${t.id}` })}>
          <div className="tk-title">{t.title}</div>
          <div className="muted small">{dayLabel(t.start, true)} – {dayLabel(t.end, true)} · {t.days.length} days</div>
          <div className="small">{fmtDistance(t.distanceM)} · {t.countries.map(countryLabel).join(', ') || 'one country'}{t.flights ? ` · ${t.flights} flight${t.flights === 1 ? '' : 's'}` : ''}{t.photos ? ` · ${t.photos} photos` : ''}</div>
        </button>
      ))}
    </div>
  );
}

function TripView({ trip }: { trip: Trip }) {
  const { go } = useStore();
  const [view, setView] = useState<TimelineView | null>(null);
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => { void api.tracks.timeline(trip.start, trip.end + 1).then(setView); }, [trip.id, trip.start, trip.end]);
  const print = async () => {
    const html = await api.tracks.tripHtml(trip.id);
    const f = document.createElement('iframe');
    f.className = 'tk-print-frame';
    // No scripts in the printed page, whatever a place or event is called.
    f.setAttribute('sandbox', 'allow-same-origin allow-modals');
    f.srcdoc = html;
    document.body.appendChild(f);
    f.onload = () => { f.contentWindow?.print(); setTimeout(() => f.remove(), 2000); };
  };
  const shown = useMemo(() => (day === null ? view?.entries ?? [] : trip.days.find((d) => d.day === day)?.entries ?? []), [day, view, trip]);
  const lines = useMemo(() => (view?.lines ?? []).filter((l) => day === null || shown.some((e) => e.id === l.id || (e.kind === 'activity' && e.track === l.id))), [view, shown, day]);
  return (
    <div className="tk-trip">
      <div className="row tk-nav">
        <button className="btn sm ghost" onClick={() => go({ name: 'tracks', arg: 'trips' })}><Icon name="chevronLeft" size={13} />Trips</button>
        <h3 className="tk-h grow">{trip.title}</h3>
        <button className="btn sm" onClick={() => void print()}><Icon name="document" size={13} />Print summary</button>
        <button className="btn sm" onClick={() => void api.tracks.export({ format: 'gpx', from: trip.start, to: trip.end, stays: true })}>Export GPX</button>
        {/* The middle of the trip's area, named after its places, so Maps opens on where it was. */}
        <MapButtons place={{ lat: (trip.bbox[1] + trip.bbox[3]) / 2, lon: (trip.bbox[0] + trip.bbox[2]) / 2, label: trip.places[0] ?? trip.title }} />
      </div>
      <div className="tk-stats">
        <Stat label="Days" value={String(trip.days.length)} />
        <Stat label="Distance" value={fmtDistance(trip.distanceM)} />
        <Stat label="Countries" value={trip.countries.map(countryLabel).join(', ') || '–'} />
        <Stat label="Flights" value={String(trip.flights)} />
        <Stat label="Drives" value={String(trip.drives)} />
        <Stat label="Photos" value={String(trip.photos)} />
      </div>
      <div className="tk-split">
        <div className="tk-col">
          <div className="seg tk-days">
            <button className={day === null ? 'on' : ''} onClick={() => setDay(null)}>All</button>
            {trip.days.map((d, i) => <button key={d.day} className={day === d.day ? 'on' : ''} onClick={() => setDay(d.day)}>Day {i + 1}</button>)}
          </div>
          <div className="tk-list tk-itinerary">
            {trip.days.filter((d) => day === null || d.day === day).map((d, i) => (
              <div key={d.day} className="tk-iday">
                <div className="tk-day">Day {day === null ? i + 1 : trip.days.findIndex((x) => x.day === d.day) + 1} · {dayLabel(d.day)}{d.places.length ? ` · ${d.places.join(', ')}` : ''} <span className="muted">· {fmtDistance(d.distanceM)}</span></div>
                {d.entries.map((e) => <EntryRow key={e.id} e={e} />)}
              </div>
            ))}
          </div>
        </div>
        <div className="tk-col map"><TracksMap lines={lines} markers={markersOf(shown)} height={480} /></div>
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return <div className="tk-stat"><div className="muted small">{label}</div><div className="tk-stat-v">{value}</div></div>;
}

// ---------------------------------------------------------------- live

function Live({ o, selected }: { o: TracksOverview; selected?: string }) {
  const { go } = useStore();
  const [n, setN] = useState(0);
  useEffect(() => api.on('tracks-changed', () => setN((x) => x + 1)), []);
  const list = useAsync(() => api.tracks.live(), [n]);
  // Paired devices are asked more often only while this view is open.
  useEffect(() => {
    if (!o.features.live) return;
    void api.tracks.liveView(true).catch(() => undefined);
    return () => void api.tracks.liveView(false).catch(() => undefined);
  }, [o.features.live]);
  const [sel, setSel] = useState<string | undefined>(selected);
  useEffect(() => setSel(selected), [selected]);
  if (!o.features.live) {
    return (
      <div className="card pad tk-welcome">
        <Icon name="phone" size={26} />
        <h3>See where your devices, items and people are</h3>
        <p className="muted">Live sharing receives positions from OwnTracks, GPS trackers, your own Traccar server, Find My on a Mac and your phone. It is off until you turn it on, and each source has its own switch.</p>
        <div className="row"><button className="btn primary" onClick={() => void api.features.set('tracksLive', true).then(() => go({ name: 'tracks', arg: 'sources' }))}>Turn on live sharing</button></div>
      </div>
    );
  }
  const live: LivePosition[] = list.data ?? [];
  const cur = live.find((p) => p.id === sel);
  return (
    <div className="tk-split">
      <div className="tk-col">
        {o.receiver.running ? <div className="tk-note"><Icon name="plug" size={13} />Receiving at {o.receiver.lanUrl ?? o.receiver.url}. Set it up on the Sources tab.</div> : null}
        {!live.length ? <Empty icon="map" title="No positions yet">Switch on a live source on the Sources tab and send a position.</Empty> : (
          <div className="tk-list">
            {live.map((p) => (
              <div key={p.id} className={`tk-entry live ${sel === p.id ? 'sel' : ''}`} onClick={() => setSel(p.id)}>
                <span className="tk-ico"><Icon name={p.kind === 'item' ? 'tag' : p.kind === 'device' ? 'laptop' : p.kind === 'person' ? 'smile' : 'phone'} size={14} /></span>
                <div className="grow">
                  <div className="tk-title">{p.name}</div>
                  <div className="muted small">{p.address ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`} · {ago(p.t)}{p.acc ? ` · ±${Math.round(p.acc)} m` : ''}</div>
                </div>
                {p.battery !== undefined ? <span className={`tk-batt ${p.battery < 20 ? 'low' : ''}`}><Icon name="battery" size={13} />{Math.round(p.battery)}%{p.charging ? ' ⚡' : ''}</span> : null}
                <MapButtons compact place={{ lat: p.lat, lon: p.lon, label: p.name }} findMy={p.source === 'findmy'} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tk-col map">
        <TracksMap markers={live.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.name, kind: p.kind, sub: ago(p.t) }))} focus={cur ? { lat: cur.lat, lon: cur.lon, z: 15 } : undefined} selected={sel} onPick={setSel} height={480} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- "Show on Map" from the file browser

function FilePreview({ path }: { path: string }) {
  const p = useAsync(() => api.tracks.preview(path), [path]);
  const name = path.split(/[\\/]/).pop();
  const [done, setDone] = useState<string | null>(null);
  if (p.loading) return <Loading label={`Reading ${name}…`} />;
  if (p.error || !p.data) return <Empty icon="warning" title="Keeper could not read this file">{p.error}</Empty>;
  const d = p.data;
  return (
    <div>
      <div className="row tk-nav">
        <h3 className="tk-h grow">{name} <span className="muted small">· {d.format}</span></h3>
        {done ? <span className="muted small">{done}</span> : <button className="btn sm primary" onClick={() => void api.tracks.importFiles([path]).then((r) => setDone(r.imported[0]?.warnings[0] ?? 'Added to your timeline'))}>Add to Places & Tracks</button>}
      </div>
      {d.warnings.length ? <div className="tk-note">{d.warnings[0]}</div> : null}
      <TracksMap lines={d.lines} markers={d.photos.map((x, i) => ({ id: `p${i}`, lat: x.lat, lon: x.lon, label: name ?? 'Photo', kind: 'photo' as const, sub: dayLabel(x.t, true) }))} height={520} />
    </div>
  );
}
