// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Hello (the start page): a calm start, and the front door to your day and
// your files. The greeting and one quiet line (files, free space, how the
// reading of the folders is going, the weather as a small chip); then Today,
// the one place that answers "what now?" (src/today/Today.tsx); Desktop,
// Documents and Downloads as big tiles; one line of suggestion only when
// something is worth doing (Today's Fix-it card takes its place while shown);
// Jump back in, with recent files under the projects they belong to; a search
// box with the file types under it. Edit Home shows, hides and reorders
// sections and sets how roomy it is. Nothing here polls: lists load once and
// follow the app's change events; pictures load as they come into view.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { prettyFolder } from '../../core/folder-view';
import { formatBytes, relativeTime } from '../../core/format';
import { groupRecent, type RecentGroup } from '../../core/home-groups';
import { attention, headerLine, HOME_DENSITIES, HOME_SECTIONS, homeSections, moveSection, normalizeHome, RECENT_READ, setSectionShown, SNOOZE_MS, type HomeSectionId, type HomeSettings } from '../../core/home-layout';
import { currentPreset } from '../../core/features';
import { setCardShown, TODAY_CARDS, TODAY_SIZES, sizeForPreset, todayCards } from '../../core/today';
import type { FileEntry, FileKind } from '../../core/types';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, SizeBar, Thumb, Toggle } from '../components/ui';
import { openGuide, useGuideList } from '../guide';
import { openHelp } from '../components/HelpSheet';
import { cleanGoals, normalizeTips, tipToday } from '../../core/goals';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';
import '../styles/home.css';
import { frontDoorFolders, shortCount, TYPE_CHIPS, typeLabel, type TypeChipId } from '../../core/file-types';
import { useFeature, useFeatureStates, useHiddenRoutes } from '../features';
import { TodaySection } from '../today/Today';
import { BigButtons } from '../today/BigButtons';
import '../styles/modes.css';
import '../styles/filetypes.css';

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];
/** Kinds shown as a small picture; the rest show their type's icon (a page of text says nothing at 34 px). */
const PICTURES = new Set<FileKind>(['image', 'video']);

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
            <button className="home-link" data-testid="home-speed-up" title="Read at full speed for half an hour, even on battery" onClick={() => void api.library.speedUp().then(() => status.reload())}>Speed up now</button>
          ) : null}
          {w ? (
            <button className="home-weather-chip" data-testid="home-weather-chip" onClick={() => go({ name: 'weather' })} title="Weather">
              <Icon name="sun" size={12} /> {w.place.name} {Math.round(w.current.temp)}° {describeCode(w.current.code).label.toLowerCase()}
            </button>
          ) : null}
        </div>
      </div>
      <div className="home-head-actions">
        <button className={`btn ghost icon ${editing ? 'on' : ''}`} aria-pressed={editing} data-testid="home-edit" title={editing ? 'Done editing Home' : 'Edit Home'} aria-label={editing ? 'Done editing Home' : 'Edit Home'} onClick={onEdit}><Icon name={editing ? 'check' : 'settings'} size={15} /></button>
        <button className="btn ghost icon" data-testid="home-rescan" title={status.data?.lastScan ? `Rescan (updated ${relativeTime(status.data.lastScan)})` : 'Rescan'} aria-label="Rescan the library" disabled={indexing} onClick={() => void api.library.rescan()}><Icon name="refresh" size={15} /></button>
      </div>
      {/* Reading the folders: a thin line instead of a spinner. */}
      {indexing ? <div className={`home-progress ${fraction === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="Reading your folders" aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}><i style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} /></div> : null}
    </header>
  );
}

// ---------------------------------------------------------------- suggestions: one line

function SuggestionLine() {
  const { go } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const [list, reload] = useGuideList();
  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  const a = attention({ disk, findings: list?.findings.filter((f) => f.status === 'open') }, formatBytes);
  if (!a) return null;
  const act = () => (a.action.finding ? openGuide(a.action.finding) : go({ name: a.action.route as 'cleanup' }));
  const dismiss = async () => {
    const d = a.dismiss;
    if (!d) return;
    // The same Trust as the Fix-it List's: this exact item, back if it changes (listed there under trusted).
    if (d.how === 'trust') await api.guide?.trust([d.finding]).catch(() => undefined);
    else await api.guide?.setState(d.finding, { snoozedUntil: Date.now() + SNOOZE_MS }).catch(() => undefined);
    reload();
  };
  return (
    <section className={`home-suggest ${a.kind}`} aria-label="Suggestion" data-testid="home-suggestion">
      <Icon name={a.kind === 'space' ? 'broom' : 'shield'} size={14} />
      <button className="home-suggest-title ellipsis" title={a.detail || a.title} onClick={act}>{a.title}</button>
      {a.more > 0 ? <button className="home-link quiet" data-testid="home-suggestion-all" title={`${a.more} more on the Fix-it List`} onClick={() => go({ name: 'todo' })}>See all ({a.more + 1})</button> : null}
      <span className="grow" />
      {a.dismiss ? <button className="home-link" data-testid="home-suggestion-dismiss" title={a.dismiss.how === 'trust' ? 'Trust this: it stops being suggested until it changes (the Fix-it List can show it again)' : 'Ask again in a week'} onClick={() => void dismiss()}>{a.dismiss.label}</button> : null}
      <button className="btn sm" data-testid="home-suggestion-action" onClick={act}>{a.action.label}</button>
    </section>
  );
}

// ---------------------------------------------------------------- Getting to know Keeper: one tip a day for a week

function TipCard() {
  const { settings, updateSettings, go } = useStore();
  const tips = normalizeTips(settings?.tips);
  const tip = settings ? tipToday(tips, cleanGoals(settings.setupGoals), Date.now()) : null;
  if (!tip) return null;
  const put = (patch: Partial<typeof tips>) => void updateSettings({ tips: { ...tips, ...patch } });
  const act = () => {
    if (tip.id === 'help') openHelp();
    else if (tip.id === 'search') document.getElementById('search')?.focus();
    else if (tip.route) { const i = tip.route.indexOf(':'); go(i < 0 ? { name: tip.route as 'todo' } : { name: tip.route.slice(0, i) as 'settings', arg: tip.route.slice(i + 1) }); }
    put({ done: [...tips.done, tip.id] });
  };
  return (
    <section className="home-tip" aria-label="Tip of the day" data-testid="home-tip">
      <span className="home-tip-kicker">Getting to know Keeper</span>
      <div className="home-tip-body">
        <b>{tip.title}</b>
        <span className="small muted">{tip.text}</span>
      </div>
      {tip.action ? <button className="btn sm" data-testid="home-tip-action" onClick={act}>{tip.action}</button> : null}
      <button className="btn sm ghost icon" title="Put this tip away" aria-label="Put this tip away" data-testid="home-tip-done" onClick={() => put({ done: [...tips.done, tip.id] })}><Icon name="close" size={13} /></button>
      <button className="home-link quiet" data-testid="home-tip-off" title="No more tips (Settings → General turns them on again)" onClick={() => put({ on: false })}>No more tips</button>
    </section>
  );
}

// ---------------------------------------------------------------- Jump back in

/** The arrow keys within Jump back in: ↑↓ through a group and on, ←→ across groups. */
function moveFocus(e: ReactKeyboardEvent<HTMLElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const el = e.target as HTMLElement;
  if (!el.matches('[data-nav]')) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
  const g = Number(el.dataset.group);
  const i = Number(el.dataset.index);
  const inGroup = (gg: number) => all.filter((x) => Number(x.dataset.group) === gg);
  let next: HTMLElement | undefined;
  if (e.key === 'Home') next = all[0];
  else if (e.key === 'End') next = all[all.length - 1];
  else if (e.key === 'ArrowDown') next = inGroup(g)[i + 1] ?? inGroup(g + 1)[0];
  else if (e.key === 'ArrowUp') next = i > 0 ? inGroup(g)[i - 1] : inGroup(g - 1).pop();
  else {
    const list = inGroup(g + (e.key === 'ArrowRight' ? 1 : -1));
    next = list.length ? list[Math.min(i, list.length - 1)] : all[all.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
  }
  if (next) { e.preventDefault(); next.focus(); }
}

function RecentItem({ f, group, index }: { f: FileEntry; group: number; index: number }) {
  const { setSelection, setFocused, play, selection } = useStore();
  const open = () => (f.kind === 'audio' ? play(f) : void api.files.open(f.path));
  return (
    <button
      className={`home-recent-item ${selection.includes(f.path) ? 'selected' : ''}`}
      data-path={f.path}
      data-nav=""
      data-group={group}
      data-index={index}
      title={`${f.path}\nDouble-click or press Enter to open`}
      onClick={() => { setSelection([f.path]); setFocused(f); }}
      onDoubleClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } }}
      draggable
      onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}
    >
      {/* A fixed box: the picture loads when it comes into view and nothing moves when it does. */}
      {PICTURES.has(f.kind) && !f.dir
        ? <span className="thumb"><Thumb file={f} size={96} /></span>
        : <span className="thumb kind" style={{ color: KIND_COLOR[f.dir ? 'folder' : f.kind], background: `color-mix(in srgb, ${KIND_COLOR[f.dir ? 'folder' : f.kind]} 14%, transparent)` }}><Icon name={f.dir ? 'folder' : f.kind} size={16} /></span>}
      <span className="name ellipsis" data-user-text>{f.name}</span>
      <span className="meta">{relativeTime(f.mtime)}</span>
    </button>
  );
}

function GroupCard({ g, n }: { g: RecentGroup<FileEntry>; n: number }) {
  const { go, info } = useStore();
  return (
    <div className="home-group" role="group" aria-labelledby={`home-group-${n}`} data-testid="home-group">
      <div className="home-group-head">
        <span className={`home-group-ico ${g.kind}`}><Icon name={g.kind === 'downloads' ? 'down' : g.kind === 'other' ? 'clock' : 'folder'} size={14} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="home-group-name ellipsis" id={`home-group-${n}`}>{g.name}</div>
          {g.dir ? <div className="home-group-dir ellipsis" title={g.dir}>{prettyFolder(g.dir, info?.home)}</div> : null}
        </div>
        {g.dir ? <button className="home-link" data-testid="home-open-folder" aria-label={`Open folder ${g.name}`} onClick={() => go({ name: 'browse', arg: g.dir })}>Open folder</button> : null}
      </div>
      <div className="home-group-items">
        {g.items.map((f, i) => <RecentItem key={f.path} f={f} group={n} index={i} />)}
      </div>
    </div>
  );
}

function JumpBackIn({ narrow }: { narrow: boolean }) {
  const { go, version, info, settings } = useStore();
  const files = useAsync(() => api.library.recent(RECENT_READ), [version]);
  // A narrow window shows fewer groups and files, so what follows (Today) is not far below.
  const { groups, flat } = useMemo(() => groupRecent(files.data ?? [], { home: info?.home, roots: settings?.folders }, narrow ? { maxGroups: 3, perGroup: 3 } : {}), [files.data, info?.home, settings?.folders, narrow]);
  return (
    <section className="section" aria-labelledby="home-jump">
      <div className="section-head">
        <h2 id="home-jump">Jump back in</h2>
        <span className="grow" />
        <button className="home-link" onClick={() => go({ name: 'recents' })}>All recent files <Icon name="chevronRight" size={12} /></button>
      </div>
      {files.data && !files.data.length ? <p className="small muted">Files you open or change show up here, under the project or folder they belong to.</p> : null}
      {files.data?.length ? (
        flat ? (
          <div className="home-flat" data-testid="home-recent" onKeyDown={moveFocus}>
            {groups[0].items.map((f, i) => <RecentItem key={f.path} f={f} group={0} index={i} />)}
          </div>
        ) : (
          <div className="home-groups" data-testid="home-recent" onKeyDown={moveFocus}>
            {groups.map((g, n) => <GroupCard key={g.dir || '~other'} g={g} n={n} />)}
          </div>
        )
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- Library

function LibrarySection({ style }: { style: HomeSettings['library'] }) {
  const { go, version } = useStore();
  const totals = useAsync(() => api.library.totals(), [version]);
  const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  // Empty kinds are left out once the counts are in.
  const kinds = SHELVES.filter((k) => !totals.data || totals.data[k].count > 0);
  const tip = (k: FileKind) => (totals.data ? `${typeLabel(k)}: ${totals.data[k].count.toLocaleString()} · ${formatBytes(totals.data[k].size)}` : typeLabel(k));
  return (
    <section className="section" aria-labelledby="home-lib">
      <div className="section-head"><h2 id="home-lib">By type</h2><span className="grow" /><button className="home-link" onClick={() => go({ name: 'library' })}>Everywhere <Icon name="chevronRight" size={12} /></button></div>
      {style === 'tiles' ? (
        <div className="home-tiles" data-testid="home-library-tiles">
          {kinds.map((k) => (
            <button key={k} className="home-tile" onClick={() => go({ name: 'library', arg: k })} title={tip(k)}>
              <span className="ico" style={{ background: KIND_COLOR[k] }}><Icon name={k} size={15} /></span>
              <span className="lbl ellipsis">{typeLabel(k)}</span>
              <span className="n">{totals.data ? totals.data[k].count.toLocaleString() : '—'}{totals.data ? <small>{formatBytes(totals.data[k].size)}</small> : null}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="home-chips" data-testid="home-library-chips">
          {kinds.map((k) => (
            <button key={k} className="home-chip" onClick={() => go({ name: 'library', arg: k })} title={tip(k)}>
              <i style={{ background: KIND_COLOR[k] }} />{typeLabel(k)} <span className="n">{totals.data ? short(totals.data[k].count) : '—'}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the front door

/** Desktop, Documents and Downloads: big tiles with how much is in each (from the library, read once). */
function FolderTiles() {
  const { go, version } = useStore();
  const places = useAsync(() => api.places.list(), []);
  const folders = places.data ? frontDoorFolders(places.data.favorites, places.data.home) : [];
  const counts = useAsync(() => Promise.all(folders.map((f) => api.library.typeCounts(f.path).catch(() => null))), [folders.map((f) => f.path).join('|'), version]);
  if (places.data && !folders.length) return null;
  return (
    <section className="section" aria-label="Your folders">
      <div className="home-folders" data-testid="home-folders">
        {(places.data ? folders : [{ name: 'Desktop', path: '', icon: 'screenshot' }, { name: 'Documents', path: '', icon: 'document' }, { name: 'Downloads', path: '', icon: 'down' }]).map((f, i) => {
          const c = counts.data?.[i]?.all;
          const meta = c ? (c.count ? `${c.count.toLocaleString()} file${c.count === 1 ? '' : 's'} · ${formatBytes(c.size)}` : 'Empty') : ' ';
          return (
            <button key={f.name} className="home-folder" data-testid="home-folder" disabled={!f.path} onClick={() => go({ name: 'browse', arg: f.path })} title={f.path ? `Open ${f.path}` : f.name}>
              <span className="ico" aria-hidden><Icon name={f.icon} size={22} /></span>
              <span className="name ellipsis" data-user-text>{f.name}</span>
              <span className="meta ellipsis">{meta}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Find a file: a search box that carries on in the top bar's, and the types (Everywhere) under it. */
function FindSection() {
  const { go, version } = useStore();
  const hidden = useHiddenRoutes();
  const counts = useAsync(() => api.library.typeCounts(), [version]);
  const [text, setText] = useState('');
  const search = (q: string) => {
    if (!q.trim()) return;
    go({ name: 'search', q });
    // Typing goes on in the top bar's search box, where the results page keeps it.
    requestAnimationFrame(() => { const el = document.getElementById('search') as HTMLInputElement | null; if (el) { el.focus(); el.setSelectionRange(q.length, q.length); } });
  };
  const chips = TYPE_CHIPS.filter((c) => (!counts.data || counts.data[c.id].count > 0) && (c.id !== 'web' || !hidden.has('downloads')));
  return (
    <section className="section home-find" aria-labelledby="home-find">
      <h2 id="home-find" className="sr-only">Find a file</h2>
      <label className="home-find-box">
        <Icon name="search" size={17} />
        <input data-testid="home-search" aria-label="Find a file" placeholder="Find a file, say “invoice from March”" value={text}
          onChange={(e) => { setText(e.target.value); search(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') search(text); }} />
        <kbd aria-hidden>{navigator.platform.includes('Mac') ? '⌘F' : 'Ctrl+F'}</kbd>
      </label>
      {chips.length ? <div className="type-chips" role="group" aria-label="Or look by type" data-testid="home-types">
        <span className="lead" aria-hidden>Or by type</span>
        {chips.map((c) => {
          const n = counts.data?.[c.id as TypeChipId];
          return (
            <button key={c.id} className="type-chip" data-chip={c.id} onClick={() => go({ name: 'library', arg: c.id })} title={`${c.tip}, in every folder${n ? ` · ${n.count.toLocaleString()} · ${formatBytes(n.size)}` : ''}`}>
              <i style={{ background: c.color === 'web' ? 'var(--c-installer)' : `var(--c-${c.color})` }} aria-hidden />{c.label}{n ? <span className="n">{shortCount(n.count)}</span> : null}
            </button>
          );
        })}
      </div> : null}
    </section>
  );
}

// ---------------------------------------------------------------- the smaller sections

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
      <div className="section-head"><h2 id="home-usage">Storage</h2><span className="small muted">{formatBytes(disk.free)} free of {formatBytes(disk.total)}</span><span className="grow" /><button className="home-link" onClick={() => go({ name: 'space' })}>Space Map <Icon name="chevronRight" size={12} /></button></div>
      <SizeBar total={disk.total} parts={[
        ...(totals.data ? SHELVES.map((k) => ({ size: totals.data![k].size, color: KIND_COLOR[k], label: KIND_LABEL[k] })) : []),
        { size: Math.max(0, disk.total - disk.free - libTotal), color: 'var(--text-3)', label: 'Everything else' },
      ]} />
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
          <div className="seg" role="radiogroup" aria-label="Library style"><button role="radio" aria-checked={home.library === 'tiles'} className={home.library === 'tiles' ? 'on' : ''} onClick={() => setHome({ ...home, library: 'tiles' })}>Tiles</button><button role="radio" aria-checked={home.library === 'chips'} className={home.library === 'chips' ? 'on' : ''} onClick={() => setHome({ ...home, library: 'chips' })}>Chips</button></div>
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
      <TodayCardsEdit />
    </section>
  );
}

/** Which cards Today shows: the preset's set until the person picks their own. */
function TodayCardsEdit() {
  const { settings, updateSettings } = useStore();
  const states = useFeatureStates();
  const preset = useMemo(() => (settings ? currentPreset(settings) : undefined), [settings]);
  if (!settings) return null;
  const t = settings.today;
  const shown = todayCards(t, preset, () => true);
  const set = (cards: typeof shown | null) => void updateSettings({ today: { ...t, cards } });
  const offered = TODAY_CARDS.filter((c) => states?.get(c.feature)?.on !== false);
  return (
    <div className="home-edit-today" data-testid="home-edit-today-cards">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, margin: '14px 0 6px' }}>
        <h4 style={{ margin: 0 }}>Today’s cards</h4>
        {t.cards ? <button className="home-link" onClick={() => set(null)}>Use the {sizeForPreset(preset) === 'simple' ? 'calm three' : sizeForPreset(preset) === 'full' ? 'full set' : 'usual five'}</button> : <span className="small muted">{TODAY_SIZES[sizeForPreset(preset)].length} cards, chosen for your setup</span>}
      </div>
      <ul className="home-edit-list">
        {offered.map((c) => (
          <li key={c.id} data-testid={`home-edit-card-${c.id}`}>
            <div className="grow"><div style={{ fontWeight: 550 }}>{c.name}</div><div className="small muted">{c.description}</div></div>
            <Toggle label={`Show ${c.name}`} on={shown.includes(c.id)} onChange={(v) => set(setCardShown(shown, c.id, v))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Home() {
  const [home, setHome] = useHome();
  const [editing, setEditing] = useState(false);
  const { settings } = useStore();
  const states = useFeatureStates();
  const big = useFeature('bigButtons');
  const preset = useMemo(() => (settings ? currentPreset(settings) : undefined), [settings]);
  const fixit = settings ? todayCards(settings.today, preset, (f) => states?.get(f)?.on ?? true).includes('fixit') : false;
  const root = useRef<HTMLDivElement>(null);
  // Narrow windows show fewer recent files, so what follows is not far below.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 860));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const draw: Record<HomeSectionId, () => React.ReactNode> = {
    folders: () => <FolderTiles />,
    search: () => <FindSection />,
    suggestions: () => <SuggestionLine />,
    jump: () => <JumpBackIn narrow={narrow} />,
    today: () => <TodaySection onHide={() => setHome(setSectionShown(home, 'today', false))} onChooseCards={() => { setEditing(true); requestAnimationFrame(() => document.querySelector('[data-testid="home-edit-today-cards"]')?.scrollIntoView({ block: 'nearest' })); }} />,
    library: () => <LibrarySection style={home.library} />,
    pinned: () => <PinnedSection />,
    weather: () => <WeatherCard />,
    usage: () => <UsageSection />,
  };
  return (
    <div ref={root} className={`home home-${home.density}`} data-testid="home">
      <Header editing={editing} onEdit={() => setEditing((e) => !e)} />
      {editing ? <EditPanel home={home} setHome={setHome} /> : null}
      <div className="home-body">
        <div className="home-main">
          {/* The week's tip stands on its own, so it shows whether or not Today has taken over the suggestion line. */}
          <TipCard />
          {/* Big buttons (Simple and Family's own part, there for anyone): six large buttons first. */}
          {big ? <BigButtons /> : null}
          {homeSections(home, fixit).map((id) => <div key={id} className="home-slot" data-section={id}>{draw[id]()}</div>)}
        </div>
      </div>
    </div>
  );
}
