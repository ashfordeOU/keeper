// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Home: a calm start. The greeting and one quiet line (files, free space, the
// weather as a small chip), one Attention card only when something is worth
// doing, the Library as a row of chips, and one Recent section with filters.
// Edit Home shows, hides and reorders sections and sets how roomy it is.

import { useEffect, useState } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { formatBytes, relativeTime } from '../../core/format';
import { attention, headerLine, HOME_DENSITIES, HOME_SECTIONS, moveSection, normalizeHome, RECENT_FILTERS, RECENT_MAX, setSectionShown, visibleSections, type HomeSectionId, type HomeSettings } from '../../core/home-layout';
import type { FileEntry, FileKind } from '../../core/types';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, SizeBar, Thumb, Toggle } from '../components/ui';
import { openGuide, useGuideList } from '../guide';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';
import '../styles/home.css';

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

type Weather = Awaited<ReturnType<typeof api.weather.get>>;

function useHome(): [HomeSettings, (h: HomeSettings) => void] {
  const { settings, updateSettings } = useStore();
  const home = normalizeHome(settings?.home);
  return [home, (h) => void updateSettings({ home: h })];
}

// ---------------------------------------------------------------- header

function Header({ editing, onEdit }: { editing: boolean; onEdit: () => void }) {
  const { go, version } = useStore();
  const status = useAsync(() => api.library.status(), [version]);
  // Files found so far while the folders are read (the walker reports every thousand).
  const [found, setFound] = useState<number | undefined>();
  const disks = useAsync(() => api.system.disks(), []);
  const totals = useAsync(() => api.library.totals(), [version]);
  const weather = useAsync<Weather | null>(() => api.weather.get().catch(() => null), []);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => api.on('progress', (p) => {
    setProgress(p.total > 0 && p.done < p.total ? p.done / p.total : null);
    if (p.task === 'index') setFound(p.found);
  }), []);
  const bg = status.data?.background;
  const indexing = !!status.data?.indexing;
  // While reading or waiting, the line is looked at again now and then (it does not change otherwise).
  const busy = indexing || (bg && bg.pending > 0 && bg.state !== 'idle');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => status.reload(), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  const expected = status.data?.expected;
  const seen = indexing ? Math.max(found ?? 0, status.data?.found ?? 0) : undefined;
  const fraction = progress ?? (seen && expected && expected > seen ? seen / expected : null);
  // Reading or filling in details at the gentle pace: the person can ask for full speed.
  const slowed = !bg?.boostedUntil && (indexing || (!!bg && bg.pending > 0 && bg.state !== 'idle'));
  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  const w = weather.data;
  const breakdown = totals.data && disk ? SHELVES.filter((k) => totals.data![k].size).map((k) => `${KIND_LABEL[k]} ${formatBytes(totals.data![k].size)}`).join(' · ') : '';
  return (
    <header className="home-head">
      <div className="grow">
        <h1>{greeting()}</h1>
        <div className="home-line">
          <span title={disk ? `${disk.label}: ${formatBytes(disk.free)} free of ${formatBytes(disk.total)}${breakdown ? `\n${breakdown}` : ''}` : undefined} data-testid="home-line">
            {status.data || disk ? headerLine({ files: status.data?.files, indexing, free: disk?.free, found: seen, expected, background: bg }, formatBytes) : ' '}
          </span>
          {slowed ? (
            <button className="btn ghost sm" data-testid="home-speed-up" title="Read at full speed for half an hour, even on battery" onClick={() => void api.library.speedUp().then(() => status.reload())}>Speed up now</button>
          ) : null}
          {w ? (
            <button className="home-weather-chip" data-testid="home-weather-chip" onClick={() => go({ name: 'weather' })} title="Weather">
              <Icon name="sun" size={12} /> {w.place.name} {Math.round(w.current.temp)}° {describeCode(w.current.code).label.toLowerCase()}
            </button>
          ) : null}
        </div>
      </div>
      <div className="home-head-actions">
        <button className={`btn ghost icon ${editing ? 'on' : ''}`} aria-pressed={editing} data-testid="home-edit" title={editing ? 'Done editing Home' : 'Edit Home'} onClick={onEdit}><Icon name={editing ? 'check' : 'settings'} size={15} /></button>
        <button className="btn ghost icon" data-testid="home-rescan" title={status.data?.lastScan ? `Rescan (updated ${relativeTime(status.data.lastScan)})` : 'Rescan'} aria-label="Rescan the library" disabled={indexing} onClick={() => void api.library.rescan()}><Icon name="refresh" size={15} /></button>
      </div>
      {/* Reading the folders: a thin line instead of a spinner. */}
      {indexing ? <div className={`home-progress ${fraction === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="Reading your folders" aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}><i style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} /></div> : null}
    </header>
  );
}

// ---------------------------------------------------------------- sections

function AttentionCard() {
  const { go } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const [list] = useGuideList();
  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  const a = attention({ disk, findings: list?.findings.filter((f) => f.status === 'open') }, formatBytes);
  if (!a) return null;
  return (
    <section className="home-card home-attention" aria-label="Needs attention" data-testid="home-attention">
      <Icon name={a.kind === 'space' ? 'broom' : 'shield'} size={18} />
      <div className="grow">
        <h3>{a.title}</h3>
        {a.detail ? <p className="small muted">{a.detail}</p> : null}
      </div>
      <div className="btn-row">
        {a.more > 0 ? <button className="btn ghost sm" onClick={() => go({ name: 'todo' })}>{a.more} more on To do</button> : null}
        <button className="btn primary sm" onClick={() => (a.action.finding ? openGuide(a.action.finding) : go({ name: a.action.route as 'cleanup' }))}>{a.action.label}</button>
      </div>
    </section>
  );
}

function LibrarySection({ style }: { style: HomeSettings['library'] }) {
  const { go, version } = useStore();
  const totals = useAsync(() => api.library.totals(), [version]);
  const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  if (style === 'tiles') {
    return (
      <section className="section" aria-labelledby="home-lib">
        <div className="section-head"><h2 id="home-lib">Library</h2></div>
        <div className="kind-tiles">
          {SHELVES.map((k) => (
            <button key={k} className="kind-tile" onClick={() => go({ name: 'library', arg: k })}>
              <span className="ico" style={{ background: KIND_COLOR[k] }}><Icon name={k} size={16} /></span>
              <span className="small sub">{KIND_LABEL[k]}</span>
              <span className="v">{totals.data ? totals.data[k].count.toLocaleString() : '—'}</span>
              <span className="small muted">{totals.data ? formatBytes(totals.data[k].size) : ''}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="section" aria-labelledby="home-lib">
      <div className="section-head"><h2 id="home-lib">Library</h2></div>
      <div className="home-chips" data-testid="home-library-chips">
        {SHELVES.filter((k) => !totals.data || totals.data[k].count > 0).map((k) => (
          <button key={k} className="home-chip" onClick={() => go({ name: 'library', arg: k })} title={totals.data ? `${KIND_LABEL[k]}: ${totals.data[k].count.toLocaleString()} · ${formatBytes(totals.data[k].size)}` : KIND_LABEL[k]}>
            <i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]} <span className="n">{totals.data ? short(totals.data[k].count) : '—'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RecentSection({ home, setHome }: { home: HomeSettings; setHome: (h: HomeSettings) => void }) {
  const { go, version, setSelection, setFocused, play, selection } = useStore();
  const filter = home.recent;
  const files = useAsync(() => api.library.recent(RECENT_MAX, filter === 'all' ? undefined : filter), [version, filter]);
  const more = () => go(filter === 'download' ? { name: 'downloads' } : filter === 'all' ? { name: 'recents' } : { name: 'library', arg: filter });
  const list = home.recentView === 'list';
  return (
    <section className="section" aria-labelledby="home-recent">
      <div className="section-head">
        <h2 id="home-recent">Recent</h2>
        <div className="home-filters" role="group" aria-label="Show">
          {RECENT_FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} data-testid={`recent-${f.id}`} onClick={() => setHome({ ...home, recent: f.id })}>{f.label}</button>)}
        </div>
        <span className="grow" />
        <button className="btn ghost icon sm" title={list ? 'Show as a grid' : 'Show as a list'} aria-label={list ? 'Show as a grid' : 'Show as a list'} onClick={() => setHome({ ...home, recentView: list ? 'grid' : 'list' })}><Icon name={list ? 'grid' : 'list'} size={13} /></button>
        <button className="btn ghost sm" onClick={more}>See all <Icon name="chevronRight" size={12} /></button>
      </div>
      {files.data && !files.data.length ? <p className="small muted">Nothing here yet.</p> : null}
      <div className={list ? 'home-recent-list' : 'home-recent-grid'} data-testid="home-recent">
        {(files.data ?? []).map((f: FileEntry) => (
          <div
            key={f.path}
            className={`home-recent-item ${selection.includes(f.path) ? 'selected' : ''}`}
            data-path={f.path}
            title={f.path}
            onClick={() => { setSelection([f.path]); setFocused(f); }}
            onDoubleClick={() => (f.kind === 'audio' ? play(f) : void api.files.open(f.path))}
            draggable
            onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}
          >
            {/* A fixed box: the picture loads when it comes into view and nothing moves when it does. */}
            <div className="thumb"><Thumb file={f} size={240} /></div>
            <div className="meta-wrap">
              <div className="name ellipsis">{f.name}</div>
              <div className="meta">{f.source ? `${f.source.name} · ` : ''}{relativeTime(f.mtime)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PinnedSection() {
  const { settings, go } = useStore();
  const pinned = settings?.pinned ?? [];
  if (!pinned.length) return null;
  return (
    <section className="section" aria-labelledby="home-pinned">
      <div className="section-head"><h2 id="home-pinned">Pinned folders</h2></div>
      <div className="home-chips">
        {pinned.map((p) => <button key={p} className="home-chip" title={p} onClick={() => go({ name: 'browse', arg: p })}><Icon name="folder" size={13} />{p.split(/[\\/]/).filter(Boolean).pop() ?? p}</button>)}
      </div>
    </section>
  );
}

function WeatherCard() {
  const { go } = useStore();
  const weather = useAsync<Weather | null>(() => api.weather.get().catch(() => null), []);
  const w = weather.data;
  if (!w) return null;
  return (
    <section className="section">
      <button className="home-card weather-mini" onClick={() => go({ name: 'weather' })}>
        <div className="t">{Math.round(w.current.temp)}°</div>
        <div className="grow">
          <h3>{w.place.name}</h3>
          <div className="small sub">{describeCode(w.current.code).label} · feels {Math.round(w.current.feels)}° · {w.daily[0] ? `${Math.round(w.daily[0].min)}° / ${Math.round(w.daily[0].max)}°` : ''}</div>
          {w.nowcast ? <div className="small" style={{ color: 'var(--accent)' }}>{w.nowcast}</div> : null}
        </div>
      </button>
    </section>
  );
}

function UsageSection() {
  const { go, version } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const totals = useAsync(() => api.library.totals(), [version]);
  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  if (!disk) return null;
  const libTotal = totals.data ? Object.values(totals.data).reduce((n, v) => n + v.size, 0) : 0;
  return (
    <section className="section" aria-labelledby="home-usage">
      <div className="section-head"><h2 id="home-usage">Storage</h2><span className="small muted">{formatBytes(disk.free)} free of {formatBytes(disk.total)}</span><span className="grow" /><button className="btn ghost sm" onClick={() => go({ name: 'space' })}>Space Map <Icon name="chevronRight" size={12} /></button></div>
      <SizeBar total={disk.total} parts={[
        ...(totals.data ? SHELVES.map((k) => ({ size: totals.data![k].size, color: KIND_COLOR[k], label: KIND_LABEL[k] })) : []),
        { size: Math.max(0, disk.total - disk.free - libTotal), color: 'var(--text-3)', label: 'Everything else' },
      ]} />
    </section>
  );
}

function CalendarToday() {
  const { go } = useStore();
  const events = useAsync(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return api.pim?.occurrences(start.getTime(), start.getTime() + 86_400_000).catch(() => []) ?? Promise.resolve([]);
  }, []);
  const list = (events.data ?? []).slice(0, 5);
  return (
    <section className="section" aria-labelledby="home-cal">
      <div className="section-head"><h2 id="home-cal">Today</h2><span className="grow" /><button className="btn ghost sm" onClick={() => go({ name: 'calendar' })}>Calendar <Icon name="chevronRight" size={12} /></button></div>
      {list.length ? (
        <ul className="home-agenda">{list.map((o) => <li key={`${o.event.id}:${o.instance}`}><span className="muted small">{new Date(o.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> {o.event.title}</li>)}</ul>
      ) : <p className="small muted">Nothing on your calendars today.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- Edit Home

function EditPanel({ home, setHome }: { home: HomeSettings; setHome: (h: HomeSettings) => void }) {
  return (
    <section className="home-card home-edit" aria-label="Edit Home" data-testid="home-edit-panel">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h3>Edit Home</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="seg" role="radiogroup" aria-label="Spacing">{HOME_DENSITIES.map((d) => <button key={d.id} role="radio" aria-checked={home.density === d.id} className={home.density === d.id ? 'on' : ''} onClick={() => setHome({ ...home, density: d.id })}>{d.label}</button>)}</div>
          <div className="seg" role="radiogroup" aria-label="Library style"><button role="radio" aria-checked={home.library === 'chips'} className={home.library === 'chips' ? 'on' : ''} onClick={() => setHome({ ...home, library: 'chips' })}>Chips</button><button role="radio" aria-checked={home.library === 'tiles'} className={home.library === 'tiles' ? 'on' : ''} onClick={() => setHome({ ...home, library: 'tiles' })}>Tiles</button></div>
        </div>
      </div>
      <ol className="home-edit-list">
        {home.order.map((id, i) => {
          const s = HOME_SECTIONS.find((x) => x.id === id)!;
          return (
            <li key={id} data-testid={`home-edit-${id}`}>
              <div className="grow"><div style={{ fontWeight: 550 }}>{s.name}</div><div className="small muted">{s.description}</div></div>
              <button className="btn sm ghost icon" title={`Move ${s.name} up`} aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => setHome(moveSection(home, id, -1))}><Icon name="arrowUp" size={13} /></button>
              <button className="btn sm ghost icon" title={`Move ${s.name} down`} aria-label={`Move ${s.name} down`} disabled={i === home.order.length - 1} onClick={() => setHome(moveSection(home, id, 1))}><Icon name="chevronDown" size={13} /></button>
              <Toggle label={`Show ${s.name}`} on={!home.hidden.includes(id)} onChange={(v) => setHome(setSectionShown(home, id, v))} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Home() {
  const [home, setHome] = useHome();
  const [editing, setEditing] = useState(false);
  const draw: Record<HomeSectionId, () => React.ReactNode> = {
    attention: () => <AttentionCard />,
    library: () => <LibrarySection style={home.library} />,
    recent: () => <RecentSection home={home} setHome={setHome} />,
    pinned: () => <PinnedSection />,
    weather: () => <WeatherCard />,
    usage: () => <UsageSection />,
    calendar: () => <CalendarToday />,
  };
  return (
    <div className={`home home-${home.density}`} data-testid="home">
      <Header editing={editing} onEdit={() => setEditing((e) => !e)} />
      {editing ? <EditPanel home={home} setHome={setHome} /> : null}
      {visibleSections(home).map((id) => <div key={id} className="home-slot" data-section={id}>{draw[id]()}</div>)}
    </div>
  );
}
