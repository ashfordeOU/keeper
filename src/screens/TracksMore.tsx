// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks: activities (stats, charts, records, heatmap, compare),
// places (name, edit, merge; home and work), sources (each its own switch)
// and settings (map, names, privacy zones, where it appears, backup, delete).

import { useEffect, useMemo, useState } from 'react';
import type { ServiceSource, SourceRow, TrackSummary, TracksConfig, TracksOverview } from '../../core/tracks/api';
import { compare, effectiveStats, fmtDistance, fmtDuration, fmtPace, paceSecPerKm, profile, speedKmh, splits } from '../../core/tracks/stats';
import { SPORT_LABEL, type NamedPlace, type Sport, type Track } from '../../core/tracks/types';
import { api } from '../api';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { Empty, Loading, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import { ago, dayLabel, Stat } from './Tracks';
import { TracksMap, sportColour } from './TracksMap';
import { MapButtons } from '../components/NativeOpen';

const paceOrSpeed = (sport: Sport, s: ReturnType<typeof effectiveStats>) => (sport === 'run' || sport === 'walk' || sport === 'hike' ? fmtPace(paceSecPerKm(s)) : speedKmh(s) ? `${speedKmh(s)!.toFixed(1)} km/h` : '–');

// ---------------------------------------------------------------- activities

export function Activities({ open }: { open?: string }) {
  const { go } = useStore();
  const [n, setN] = useState(0);
  useEffect(() => api.on('tracks-changed', () => setN((x) => x + 1)), []);
  const list = useAsync(() => api.tracks.tracks(), [n]);
  const [sport, setSport] = useState<Sport | 'all'>('all');
  const [pick, setPick] = useState<string[]>([]);
  const [mode, setMode] = useState<'list' | 'records' | 'heatmap'>('list');
  if (open) return <ActivityDetail id={open} onBack={() => go({ name: 'tracks', arg: 'activities' })} />;
  if (list.loading && !list.data) return <Loading />;
  const all = (list.data ?? []).filter((t) => !t.planned);
  if (!all.length) return <Empty icon="bolt" title="No activities yet">Import GPX, FIT or TCX files, watch a folder, or connect a sports service on the Sources tab.</Empty>;
  const sports = [...new Set(all.map((t) => t.sport))];
  const shown = all.filter((t) => sport === 'all' || t.sport === sport);
  return (
    <div>
      <div className="row tk-nav">
        <div className="seg">{(['list', 'records', 'heatmap'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'list' ? 'All' : m === 'records' ? 'Personal records' : 'Heatmap'}</button>)}</div>
        <div className="seg">
          <button className={sport === 'all' ? 'on' : ''} onClick={() => setSport('all')}>Every sport</button>
          {sports.map((s) => <button key={s} className={sport === s ? 'on' : ''} onClick={() => setSport(s)}>{SPORT_LABEL[s]}</button>)}
        </div>
        {pick.length === 2 ? <span className="muted small">Comparing two</span> : <span className="muted small">Tick two to compare</span>}
      </div>
      {mode === 'records' ? <Records /> : mode === 'heatmap' ? <Heatmap /> : (
        <>
          {pick.length === 2 ? <Compare a={pick[0]} b={pick[1]} onClose={() => setPick([])} /> : null}
          <div className="tk-acts">
            {shown.map((t) => <ActivityRow key={t.id} t={t} picked={pick.includes(t.id)} onPick={(on) => setPick((p) => (on ? [...p, t.id].slice(-2) : p.filter((x) => x !== t.id)))} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Spark({ pts, color }: { pts: [number, number][]; color: string }) {
  if (pts.length < 2) return <svg className="tk-spark" />;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [lat, lon] of pts) { a = Math.min(a, lon); b = Math.min(b, lat); c = Math.max(c, lon); d = Math.max(d, lat); }
  const kx = Math.cos(((b + d) / 2) * Math.PI / 180);
  const sw = Math.max((c - a) * kx, d - b) || 1;
  const path = pts.map(([lat, lon], i) => `${i ? 'L' : 'M'}${(4 + ((lon - a) * kx / sw) * 40).toFixed(1)} ${(44 - ((lat - b) / sw) * 40).toFixed(1)}`).join('');
  return <svg className="tk-spark" viewBox="0 0 48 48"><path d={path} stroke={color} /></svg>;
}

function ActivityRow({ t, picked, onPick }: { t: TrackSummary; picked: boolean; onPick: (on: boolean) => void }) {
  const { go } = useStore();
  const s = t.stats;
  return (
    <div className="card tk-act" onClick={() => go({ name: 'tracks', arg: `track:${t.id}` })}>
      <input type="checkbox" checked={picked} onClick={(e) => e.stopPropagation()} onChange={(e) => onPick(e.target.checked)} title="Compare" />
      <Spark pts={t.preview} color={sportColour(t.sport)} />
      <div className="grow">
        <div className="tk-title">{t.name}</div>
        <div className="muted small">{dayLabel(t.start, true)} · {SPORT_LABEL[t.sport]} · {t.source}</div>
      </div>
      <div className="tk-nums">
        <span><b>{fmtDistance(s.distanceM)}</b><small>distance</small></span>
        <span><b>{fmtDuration(s.movingS || s.elapsedS)}</b><small>time</small></span>
        <span><b>{paceOrSpeed(t.sport, s)}</b><small>{t.sport === 'run' || t.sport === 'walk' || t.sport === 'hike' ? 'pace' : 'speed'}</small></span>
        <span><b>{s.ascentM ? `${s.ascentM} m` : '–'}</b><small>climb</small></span>
        <span><b>{s.avgHr ?? '–'}</b><small>avg HR</small></span>
      </div>
    </div>
  );
}

function ActivityDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const tr = useAsync(() => api.tracks.track(id), [id]);
  const [by, setBy] = useState<'speed' | 'ele' | 'hr'>('speed');
  const [name, setName] = useState<string | null>(null);
  if (tr.loading) return <Loading />;
  const t = tr.data;
  if (!t) return <Empty icon="bolt" title="This activity is gone" />;
  const s = effectiveStats(t);
  const ele = profile(t.points, 'ele');
  const hr = profile(t.points, 'hr');
  const spd = profile(t.points, 'speed');
  const sp = splits(t.points);
  return (
    <div className="tk-detail">
      <div className="row tk-nav">
        <button className="btn sm ghost" onClick={onBack}><Icon name="chevronLeft" size={13} />Activities</button>
        {name === null ? <h3 className="tk-h grow" onDoubleClick={() => setName(t.name)}>{t.name}</h3> : (
          <form className="row grow" onSubmit={(e) => { e.preventDefault(); void api.tracks.renameTrack(t.id, name).then(() => { setName(null); tr.reload(); }); }}><input className="input grow" autoFocus value={name} onChange={(e) => setName(e.target.value)} /><button className="btn sm primary">Save</button></form>
        )}
        <button className="btn sm" onClick={() => void api.tracks.export({ format: 'gpx', ids: [t.id] })}>Export GPX</button>
        <button aria-label="Delete track" title="Delete track" className="btn sm ghost danger" onClick={() => void api.tracks.removeTrack(t.id).then(onBack)}><Icon name="trash" size={13} /></button>
      </div>
      <div className="muted small">{dayLabel(t.start, true)} · {SPORT_LABEL[t.sport]} · from {t.source}{t.planned ? ' · planned route' : ''}</div>
      <div className="tk-stats">
        <Stat label="Distance" value={fmtDistance(s.distanceM)} />
        <Stat label="Moving time" value={fmtDuration(s.movingS)} />
        <Stat label="Elapsed" value={fmtDuration(s.elapsedS)} />
        <Stat label={t.sport === 'ride' ? 'Speed' : 'Pace'} value={paceOrSpeed(t.sport, s)} />
        <Stat label="Climb" value={`${s.ascentM} m`} />
        <Stat label="Heart rate" value={s.avgHr ? `${s.avgHr} avg · ${s.maxHr} max` : '–'} />
      </div>
      <div className="row tk-nav"><span className="muted small">Colour by</span><div className="seg">{(['speed', 'ele', 'hr'] as const).map((b) => <button key={b} className={by === b ? 'on' : ''} onClick={() => setBy(b)}>{b === 'ele' ? 'Height' : b === 'hr' ? 'Heart rate' : 'Speed'}</button>)}</div></div>
      <TracksMap lines={[{ id: t.id, name: t.name, sport: t.sport, points: t.points }]} colourBy={by} height={380} />
      <div className="tk-charts">
        {ele.some((p) => p.v !== null) ? <div className="card pad"><div className="tk-title">Height</div><Chart labels={ele.map((p) => fmtDistance(p.d))} series={[{ values: ele.map((p) => p.v), color: '#22c55e', label: 'Height', format: (v) => `${Math.round(v)} m` }]} /></div> : null}
        {hr.some((p) => p.v !== null) ? <div className="card pad"><div className="tk-title">Heart rate</div><Chart labels={hr.map((p) => fmtDistance(p.d))} series={[{ values: hr.map((p) => p.v), color: '#ef4444', label: 'Heart rate', format: (v) => `${Math.round(v)} bpm` }]} /></div> : null}
        {spd.some((p) => p.v !== null) ? <div className="card pad"><div className="tk-title">Speed</div><Chart labels={spd.map((p) => fmtDistance(p.d))} series={[{ values: spd.map((p) => p.v), color: '#3b82f6', label: 'Speed', format: (v) => `${v.toFixed(1)} km/h` }]} /></div> : null}
      </div>
      {sp.length > 1 ? (
        <div className="card pad">
          <div className="tk-title">Splits</div>
          <table className="tk-table"><tbody>{sp.map((x) => <tr key={x.index}><td>{x.distanceM === 1000 ? `km ${x.index}` : fmtDistance(x.distanceM)}</td><td>{fmtDuration(x.seconds)}</td><td>{fmtPace(x.seconds / (x.distanceM / 1000))}</td></tr>)}</tbody></table>
        </div>
      ) : null}
    </div>
  );
}

function Records() {
  const r = useAsync(() => api.tracks.records(), []);
  if (r.loading) return <Loading />;
  if (!r.data?.length) return <Empty icon="star" title="No records yet" />;
  return (
    <div className="card pad">
      <table className="tk-table">
        <thead><tr><th>Sport</th><th>Record</th><th>Best</th><th>When</th></tr></thead>
        <tbody>{r.data.map((x) => <tr key={`${x.sport}${x.label}`}><td>{SPORT_LABEL[x.sport]}</td><td>{x.label}</td><td><b>{x.unit === 's' ? fmtDuration(x.value) : x.label === 'Longest' ? fmtDistance(x.value) : `${Math.round(x.value)} m`}</b></td><td className="muted">{dayLabel(x.at, true)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Heatmap() {
  const h = useAsync(() => api.tracks.heatmap(), []);
  if (h.loading) return <Loading />;
  return <TracksMap heat={h.data ?? []} height={520} />;
}

function Compare({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const [ta, setA] = useState<Track | null>(null);
  const [tb, setB] = useState<Track | null>(null);
  useEffect(() => { void api.tracks.track(a).then(setA); void api.tracks.track(b).then(setB); }, [a, b]);
  const c = useMemo(() => (ta && tb ? compare(ta, tb) : null), [ta, tb]);
  if (!ta || !tb || !c) return <Loading />;
  const cmp = c;
  const row = (label: string, f: (s: typeof cmp.a) => string) => <tr><td className="muted">{label}</td><td>{f(cmp.a)}</td><td>{f(cmp.b)}</td></tr>;
  return (
    <div className="card pad tk-compare">
      <div className="row"><div className="tk-title grow">Compare</div><button className="btn sm ghost" onClick={onClose}>Close</button></div>
      <table className="tk-table">
        <thead><tr><th /><th style={{ color: '#3b82f6' }}>{ta.name} · {dayLabel(ta.start)}</th><th style={{ color: '#f97316' }}>{tb.name} · {dayLabel(tb.start)}</th></tr></thead>
        <tbody>
          {row('Distance', (s) => fmtDistance(s.distanceM))}
          {row('Moving time', (s) => fmtDuration(s.movingS))}
          {row('Pace', (s) => fmtPace(paceSecPerKm(s)))}
          {row('Climb', (s) => `${s.ascentM} m`)}
          {row('Avg heart rate', (s) => (s.avgHr ? String(s.avgHr) : '–'))}
        </tbody>
      </table>
      {c.gaps.length ? <div className="muted small">At each kilometre the second was {c.gaps.map((g) => `${g.seconds >= 0 ? '+' : ''}${g.seconds}s`).join(', ')} against the first.</div> : null}
      <TracksMap lines={[{ id: ta.id, name: ta.name, sport: 'ride', points: ta.points }, { id: tb.id, name: tb.name, sport: 'run', points: tb.points }]} colourBy="none" height={300} />
    </div>
  );
}

// ---------------------------------------------------------------- places

export function Places() {
  const [n, setN] = useState(0);
  const p = useAsync(() => api.tracks.places(), [n]);
  const [sel, setSel] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState('');
  const reload = () => setN((x) => x + 1);
  if (p.loading && !p.data) return <Loading />;
  const named = p.data?.named ?? [];
  const freq = (p.data?.frequent ?? []).filter((f) => !named.some((x) => Math.abs(x.lat - f.lat) < 0.002 && Math.abs(x.lon - f.lon) < 0.003));
  return (
    <div className="tk-split">
      <div className="tk-col">
        <h3 className="tk-h">Your places</h3>
        {!named.length ? <p className="muted small">Name a place from the timeline, or one of the places below. Home and work are hidden from exports.</p> : null}
        {named.map((x) => <PlaceRow key={x.id} p={x} picked={sel.includes(x.id)} onPick={(on) => setSel((s) => (on ? [...s, x.id] : s.filter((y) => y !== x.id)))} onSaved={reload} />)}
        {sel.length >= 2 ? (
          <form className="row tk-inline" onSubmit={(e) => { e.preventDefault(); void api.tracks.mergePlaces(sel, mergeName).then(() => { setSel([]); reload(); }); }}>
            <input className="input sm grow" value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder="Name for the merged place" />
            <button className="btn sm primary">Merge {sel.length}</button>
          </form>
        ) : null}
        <h3 className="tk-h">Places you go often</h3>
        {freq.slice(0, 20).map((f) => (
          <div key={f.id} className="tk-entry">
            <span className="tk-ico"><Icon name="pin" size={14} /></span>
            <div className="grow"><div className="tk-title">{f.name ?? `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`}</div><div className="muted small">{f.visits} visits · {fmtDuration(f.totalMs / 1000)} in all · last {dayLabel(f.lastSeen, true)}</div></div>
            <MapButtons compact place={{ lat: f.lat, lon: f.lon, label: f.name }} />
            <button className="btn sm ghost" onClick={() => void api.tracks.savePlace({ id: '', name: f.name ?? 'Home', lat: f.lat, lon: f.lon, radiusM: 150, kind: named.some((x) => x.kind === 'home') ? 'other' : 'home' }).then(reload)}>{named.some((x) => x.kind === 'home') ? 'Name it' : 'This is home'}</button>
          </div>
        ))}
      </div>
      <div className="tk-col map"><TracksMap markers={[...named.map((x) => ({ id: x.id, lat: x.lat, lon: x.lon, label: x.name, kind: 'place' as const, sub: x.kind })), ...freq.slice(0, 20).map((f) => ({ id: f.id, lat: f.lat, lon: f.lon, label: f.name ?? 'A place', kind: 'stay' as const }))]} height={480} /></div>
    </div>
  );
}

function PlaceRow({ p, picked, onPick, onSaved }: { p: NamedPlace; picked: boolean; onPick: (on: boolean) => void; onSaved: () => void }) {
  const [edit, setEdit] = useState<NamedPlace | null>(null);
  if (edit) {
    return (
      <form className="card pad tk-inline col" onSubmit={(e) => { e.preventDefault(); void api.tracks.savePlace(edit).then(() => { setEdit(null); onSaved(); }); }}>
        <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        <div className="row">
          <div className="seg">{(['home', 'work', 'other'] as const).map((k) => <button type="button" key={k} className={edit.kind === k ? 'on' : ''} onClick={() => setEdit({ ...edit, kind: k })}>{k === 'other' ? 'Other' : k === 'home' ? 'Home' : 'Work'}</button>)}</div>
          <label className="small muted">Radius <input className="input sm" type="number" min={25} max={5000} value={edit.radiusM} onChange={(e) => setEdit({ ...edit, radiusM: Number(e.target.value) })} style={{ width: 80 }} /> m</label>
        </div>
        <div className="row"><button className="btn sm primary">Save</button><button type="button" className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn sm ghost danger" onClick={() => void api.tracks.removePlace(p.id).then(onSaved)}>Remove</button></div>
      </form>
    );
  }
  return (
    <div className="tk-entry">
      <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} title="Select to merge" />
      <span className="tk-ico"><Icon name={p.kind === 'home' ? 'home' : p.kind === 'work' ? 'laptop' : 'pin'} size={14} /></span>
      <div className="grow"><div className="tk-title">{p.name}</div><div className="muted small">{p.kind === 'other' ? 'Place' : p.kind === 'home' ? 'Home · hidden from exports' : 'Work · hidden from exports'} · {p.radiusM} m</div></div>
      <MapButtons compact place={{ lat: p.lat, lon: p.lon, label: p.name }} />
      <button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button>
    </div>
  );
}

// ---------------------------------------------------------------- sources

export function Sources({ o, importNow }: { o: TracksOverview; importNow?: boolean }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (importNow) void api.tracks.importFiles(); }, [importNow]);
  const set = (patch: Parameters<typeof api.tracks.setConfig>[0]) => void api.tracks.setConfig(patch);
  const c = o.config;
  return (
    <div className="tk-sources">
      <div className="row tk-nav">
        <button className="btn sm primary" onClick={() => void api.tracks.importFiles()}><Icon name="down" size={13} />Import files…</button>
        <button className="btn sm" disabled={busy} onClick={() => { setBusy(true); void api.tracks.syncNow().then((r) => toast(r.message)).finally(() => setBusy(false)); }}><Icon name="refresh" size={13} />Check sources now</button>
        {!o.features.live ? <button className="btn sm ghost" onClick={() => void api.features.set('tracksLive', true)}>Turn on live sharing</button> : null}
        {!o.features.services ? <button className="btn sm ghost" onClick={() => void api.features.set('tracksServices', true)}>Turn on sports services</button> : null}
      </div>
      {o.sources.map((s) => <SourceCard key={s.id} s={s} c={c} o={o} set={set} />)}
      {o.imports.length ? (
        <div className="card pad">
          <div className="tk-title">Recent imports</div>
          <table className="tk-table"><tbody>{o.imports.slice(0, 12).map((r) => <tr key={r.id}><td>{r.file}</td><td className="muted">{r.format}</td><td>{[r.tracks && `${r.tracks} tracks`, r.visits && `${r.visits} visits`, r.points && `${r.points} positions`, r.photos && `${r.photos} photos`, r.reservations && `${r.reservations} bookings`].filter(Boolean).join(' · ') || r.warnings[0] || 'Nothing new'}</td><td className="muted small">{ago(r.at)}</td></tr>)}</tbody></table>
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ s, c, o, set }: { s: SourceRow; c: TracksConfig; o: TracksOverview; set: (p: Parameters<typeof api.tracks.setConfig>[0]) => void }) {
  const toggle = (on: boolean) => set({ sources: { [s.id]: { on } } } as Parameters<typeof api.tracks.setConfig>[0]);
  const src = s.id !== 'import' ? c.sources[s.id] : null;
  return (
    <div className={`card pad tk-source ${s.on ? 'on' : ''}`} data-source={s.id}>
      <div className="row">
        <div className="grow">
          <div className="tk-title">{s.label}</div>
          <div className="muted small">{s.gives}</div>
          <div className="small"><span className="muted">{s.platforms}</span>{s.id !== 'import' ? <> · <span className={/Waiting|Not|Needs|refused|Wrong|answered|error|cannot/i.test(s.status) ? 'tk-warn' : ''}>{s.status}</span></> : null}</div>
        </div>
        {s.id !== 'import' ? <Toggle on={s.on} onChange={toggle} /> : null}
      </div>
      {s.on && src ? <SourceSettings id={s.id} c={c} o={o} set={set} /> : null}
    </div>
  );
}

function SourceSettings({ id, c, o, set }: { id: SourceRow['id']; c: TracksConfig; o: TracksOverview; set: (p: Parameters<typeof api.tracks.setConfig>[0]) => void }) {
  const { toast } = useStore();
  const [secret, setSecretText] = useState('');
  const s = c.sources;
  const pickInto = async (key: 'folders' | 'photos') => {
    const f = await api.settings.pickFolder();
    if (!f) return;
    if (key === 'folders') set({ sources: { folders: { paths: [...new Set([...s.folders.paths, f])] } } });
    else set({ sources: { photos: { folders: [...new Set([...s.photos.folders, f])] } } });
  };
  if (id === 'folders' || id === 'photos') {
    const list = id === 'folders' ? s.folders.paths : s.photos.folders;
    return (
      <div className="tk-sub">
        {list.map((p) => <div key={p} className="chip">{p}<button onClick={() => set(id === 'folders' ? { sources: { folders: { paths: list.filter((x) => x !== p) } } } : { sources: { photos: { folders: list.filter((x) => x !== p) } } })}>×</button></div>)}
        <button className="btn sm" onClick={() => void pickInto(id === 'folders' ? 'folders' : 'photos')}>Add folder…</button>
        {id === 'folders' ? <p className="muted small">A Garmin watch plugged in by USB shows its activities in GARMIN/Activity. Suunto, Wahoo, Coros and Polar exports work the same way.</p> : null}
      </div>
    );
  }
  if (id === 'ownTracks' || id === 'osmand') {
    const base = o.receiver.lanUrl ?? o.receiver.url ?? `http://127.0.0.1:${s.receiver.port}`;
    return (
      <div className="tk-sub">
        <div className="row">
          <label className="small">Port <input className="input sm" type="number" value={s.receiver.port} onChange={(e) => set({ sources: { receiver: { port: Number(e.target.value) } } })} style={{ width: 90 }} /></label>
          <Toggle on={s.receiver.lan} onChange={(v) => set({ sources: { receiver: { lan: v } } })} label="Reachable from my local network" />
        </div>
        {o.receiver.error ? <div className="tk-warn small">{o.receiver.error}</div> : null}
        {id === 'ownTracks'
          ? <p className="small">In OwnTracks choose HTTP mode, URL <code className="tk-code">{base}/owntracks</code>, any user name and the password <code className="tk-code">{s.receiver.token}</code>.</p>
          : <p className="small">Point the tracker or the Traccar Client app at <code className="tk-code">{base}/osmand?token={s.receiver.token}</code>.</p>}
        {!s.receiver.lan ? <p className="muted small">Only this computer can reach it now. Phones need “Reachable from my local network”, or a VPN to home.</p> : null}
      </div>
    );
  }
  if (id === 'mqtt') {
    return (
      <div className="tk-sub grid2">
        <label className="small">Broker <input className="input sm" value={s.mqtt.host} placeholder="mqtt.example.home" onChange={(e) => set({ sources: { mqtt: { host: e.target.value } } })} /></label>
        <label className="small">Port <input className="input sm" type="number" value={s.mqtt.port} onChange={(e) => set({ sources: { mqtt: { port: Number(e.target.value) } } })} /></label>
        <label className="small">User <input className="input sm" value={s.mqtt.user} onChange={(e) => set({ sources: { mqtt: { user: e.target.value } } })} /></label>
        <label className="small">Topic <input className="input sm" value={s.mqtt.topic} onChange={(e) => set({ sources: { mqtt: { topic: e.target.value } } })} /></label>
        <Toggle on={s.mqtt.tls} onChange={(v) => set({ sources: { mqtt: { tls: v } } })} label="TLS" />
        <form className="row" onSubmit={(e) => { e.preventDefault(); void api.tracks.setSecret('mqtt', secret).then((ok) => { setSecretText(''); toast(ok ? 'Password saved in the keychain' : 'No keychain to keep it in'); }); }}><input className="input sm" type="password" value={secret} placeholder="Password" onChange={(e) => setSecretText(e.target.value)} /><button className="btn sm">Save</button></form>
      </div>
    );
  }
  if (id === 'traccar') {
    return (
      <div className="tk-sub grid2">
        <label className="small">Server <input className="input sm" value={s.traccar.url} placeholder="https://traccar.example.home" onChange={(e) => set({ sources: { traccar: { url: e.target.value } } })} /></label>
        <label className="small">User (blank for a token) <input className="input sm" value={s.traccar.user} onChange={(e) => set({ sources: { traccar: { user: e.target.value } } })} /></label>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void api.tracks.setSecret('traccar', secret).then(() => setSecretText('')); }}><input className="input sm" type="password" value={secret} placeholder="Password or token" onChange={(e) => setSecretText(e.target.value)} /><button className="btn sm">Save</button></form>
      </div>
    );
  }
  if (id === 'strava' || id === 'polar' || id === 'fitbit') {
    const svc = s[id];
    const where = { strava: 'strava.com/settings/api', polar: 'admin.polaraccesslink.com', fitbit: 'dev.fitbit.com/apps' }[id];
    return (
      <div className="tk-sub">
        <p className="muted small">Create your own API app at {where}, with the callback address http://127.0.0.1 (any port). Keeper uses only your credentials and keeps the secret in the keychain.</p>
        <div className="row">
          <input className="input sm" value={svc.clientId} placeholder="Client ID" onChange={(e) => set({ sources: { [id]: { clientId: e.target.value } } } as Parameters<typeof api.tracks.setConfig>[0])} />
          <form className="row" onSubmit={(e) => { e.preventDefault(); void api.tracks.setSecret(id, secret).then(() => { setSecretText(''); toast('Secret saved'); }); }}><input className="input sm" type="password" value={secret} placeholder="Client secret" onChange={(e) => setSecretText(e.target.value)} /><button className="btn sm">Save</button></form>
          {svc.connected
            ? <button className="btn sm" onClick={() => void api.tracks.disconnect(id as ServiceSource)}>Disconnect</button>
            : <button className="btn sm primary" disabled={!o.features.services} onClick={() => void api.tracks.connect(id as ServiceSource).then((r) => toast(r.message))}>Connect</button>}
        </div>
        {svc.lastSync ? <div className="muted small">Last checked {ago(svc.lastSync)}</div> : null}
      </div>
    );
  }
  if (id === 'findMy') return <div className="tk-sub small">{o.findMy.detail}</div>;
  if (id === 'phone') return <div className="tk-sub muted small">Open Keeper’s companion page on your phone and allow location there. The position is sent only while the page is open.</div>;
  if (id === 'link') return <div className="tk-sub muted small">Shows your other Keeper devices that share their location with this one (Devices → that device → Share my location). This computer answers the same question with your phone’s position, or your Home place.</div>;
  if (id === 'mail') return <div className="tk-sub muted small">Reads booking confirmations (flights, hotels, tickets) in the mail accounts you set up in Keeper. Read-only; nothing is marked read.</div>;
  if (id === 'calendar') return <div className="tk-sub muted small">Events with a place show on the timeline and in trips.</div>;
  return null;
}

// ---------------------------------------------------------------- settings

export function Settings({ o }: { o: TracksOverview }) {
  const { toast } = useStore();
  const c = o.config;
  const set = (patch: Parameters<typeof api.tracks.setConfig>[0]) => void api.tracks.setConfig(patch);
  const zones = useAsync(() => api.tracks.zones(), [o.counts.places]);
  const places = useAsync(() => api.tracks.places(), [o.counts.places]);
  const [wipe, setWipe] = useState(0);
  const surf: [keyof TracksConfig['surfaces'], string, string][] = [
    ['sidebar', 'Sidebar', 'Places & Tracks in the sidebar'],
    ['palette', 'Command palette', '“Where is my laptop?” and the like'],
    ['fileMenu', 'File browser', '“Show on Map” when you right-click a GPX, FIT or photo'],
    ['tray', 'Menu bar / tray', 'Where devices and items are, at a glance'],
    ['island', 'Island', '“Arriving in…” and a workout running'],
  ];
  return (
    <div className="tk-settings">
      <section className="card pad">
        <div className="tk-title">Where it appears</div>
        {surf.map(([k, label, sub]) => <div key={k} className="row tk-setrow"><div className="grow"><div>{label}</div><div className="muted small">{sub}</div></div><Toggle on={c.surfaces[k]} onChange={(v) => set({ surfaces: { [k]: v } })} /></div>)}
      </section>
      <section className="card pad">
        <div className="tk-title">Map</div>
        <div className="row tk-setrow"><div className="grow"><div>Online map</div><div className="muted small">Map pictures from a tile server; the area you look at is sent to it. Off: an offline outline.</div></div><Toggle on={c.map.online} onChange={(v) => set({ map: { online: v } })} /></div>
        <label className="small col">Tile server (use your own if you like) <input className="input sm" value={c.map.tileUrl} onChange={(e) => set({ map: { tileUrl: e.target.value } })} /></label>
        <label className="small col">Credit shown on the map <input className="input sm" value={c.map.attribution} onChange={(e) => set({ map: { attribution: e.target.value } })} /></label>
        <div className="row tk-setrow"><span className="grow">Colour tracks by</span><div className="seg">{(['speed', 'ele', 'hr', 'none'] as const).map((b) => <button key={b} className={c.map.colourBy === b ? 'on' : ''} onClick={() => set({ map: { colourBy: b } })}>{b === 'ele' ? 'Height' : b === 'hr' ? 'Heart rate' : b === 'none' ? 'Sport' : 'Speed'}</button>)}</div></div>
        <div className="row tk-setrow"><span className="grow">Dark map in dark mode</span><Toggle on={c.map.dark !== 'off'} onChange={(v) => set({ map: { dark: v ? 'auto' : 'off' } })} /></div>
        {o.tileOverride ? <div className="muted small">A test tile server is set for this unofficial build.</div> : null}
      </section>
      <section className="card pad">
        <div className="tk-title">Place names</div>
        <div className="row tk-setrow"><div className="grow"><div>Look up names for places</div><div className="muted small">Asks a Nominatim server, at most once a second, and remembers every answer. Off: names you give and countries from Keeper’s own outline.</div></div><Toggle on={c.geocode.on} onChange={(v) => set({ geocode: { on: v } })} /></div>
        <label className="small col">Server <input className="input sm" value={c.geocode.endpoint} onChange={(e) => set({ geocode: { endpoint: e.target.value } })} /></label>
        <label className="small">A trip starts <input className="input sm" type="number" min={5} max={2000} value={c.trips.awayKm} style={{ width: 80 }} onChange={(e) => set({ trips: { awayKm: Number(e.target.value) } })} /> km from home</label>
      </section>
      <section className="card pad">
        <div className="tk-title">Privacy</div>
        <p className="muted small">{o.encrypted ? 'Your locations are encrypted on this computer with a key in the system keychain.' : o.encryptionNote ?? 'Your locations stay on this computer.'} Nothing is uploaded. Live receivers are off until you turn them on.</p>
        <div className="tk-title small">Privacy zones</div>
        <p className="muted small">Nothing inside a zone is ever exported. Home and work count as zones by themselves.</p>
        {(zones.data ?? []).map((z) => <div key={z.id} className="chip">{z.name} · {z.radiusM} m<button onClick={() => void api.tracks.removeZone(z.id).then(zones.reload)}>×</button></div>)}
        <div className="row">{(places.data?.named ?? []).filter((p) => p.kind === 'other').slice(0, 6).map((p) => <button key={p.id} className="btn sm ghost" onClick={() => void api.tracks.saveZone({ id: '', name: p.name, lat: p.lat, lon: p.lon, radiusM: Math.max(300, p.radiusM) }).then(zones.reload)}>Hide {p.name}</button>)}</div>
      </section>
      <section className="card pad">
        <div className="tk-title">Back up and delete</div>
        <p className="muted small">{c.lastBackup ? `Last copy saved ${ago(c.lastBackup)}.` : 'No copy saved yet.'}</p>
        <div className="row">
          <button className="btn sm" onClick={() => void api.tracks.backup().then((r) => r.path && toast('Copy saved'))}>Save a copy…</button>
          <button className="btn sm" onClick={() => void api.tracks.export({ format: 'gpx' })}>Export GPX…</button>
          <button className="btn sm" onClick={() => void api.tracks.export({ format: 'kml' })}>KML…</button>
          <button className="btn sm" onClick={() => void api.tracks.export({ format: 'geojson', stays: true })}>GeoJSON…</button>
          <button className="btn sm" onClick={() => void api.tracks.export({ format: 'csv' })}>CSV…</button>
        </div>
        <div className="row tk-setrow">
          {wipe === 0 ? <button className="btn sm danger" onClick={() => setWipe(1)}>Delete everything…</button> : (
            <>
              <span className="tk-warn small grow">Every location, track, place, setting and saved sign-in of Places & Tracks will be deleted. This cannot be undone.</span>
              <button className="btn sm danger" onClick={() => void api.tracks.wipe().then(() => { setWipe(0); toast('Everything was deleted'); })}>Delete everything</button>
              <button className="btn sm ghost" onClick={() => setWipe(0)}>Cancel</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
