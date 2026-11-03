// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Home: a calm start. The greeting and one quiet line (files, free space, how
// the reading of the folders is going, the weather as a small chip); one line
// of suggestion only when something is worth doing; Jump back in, with recent
// files under the projects they belong to; a Today column (events, tasks due,
// what is running); the Library as tiles. Edit Home shows, hides and reorders
// sections and sets how roomy it is. Nothing here polls: lists load once and
// follow the app's change events; pictures load as they come into view.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { prettyFolder } from '../../core/folder-view';
import { formatBytes, relativeTime } from '../../core/format';
import { groupRecent, type RecentGroup } from '../../core/home-groups';
import { attention, headerLine, HOME_DENSITIES, HOME_SECTIONS, homeColumns, moveSection, normalizeHome, RECENT_READ, setSectionShown, SNOOZE_MS, type HomeSectionId, type HomeSettings } from '../../core/home-layout';
import type { MessageSummary } from '../../core/pim/types';
import type { UpcomingEvent } from '../../core/pim/week-events';
import { dayKey, isOverdue, todayTasks, type Task } from '../../core/pim/tasks';
import type { FileEntry, FileKind } from '../../core/types';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, SizeBar, Thumb, Toggle } from '../components/ui';
import { openGuide, useGuideList } from '../guide';
import { useT } from '../i18n';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';
import '../styles/home.css';

const SHELVES: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app'];
/** Kinds shown as a small picture; the rest show their type's icon (a page of text says nothing at 34 px). */
const PICTURES = new Set<FileKind>(['image', 'video']);
/** At this width and over, Today is a column beside the rest. */
const WIDE = 860;

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Weather = Awaited<ReturnType<typeof api.weather.get>>;

function useHome(): [HomeSettings, (h: HomeSettings) => void] {
  const { settings, updateSettings } = useStore();
  const home = normalizeHome(settings?.home);
  return [home, (h) => void updateSettings({ home: h })];
}

/** Runs `fn` once, `ms` after the last of a burst of events. */
function useDebounced(fn: () => void, ms: number): () => void {
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return useCallback(() => { clearTimeout(t.current); t.current = setTimeout(() => f.current(), ms); }, [ms]);
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
      {a.more > 0 ? <button className="home-link quiet" onClick={() => go({ name: 'todo' })}>{a.more} more suggestion{a.more === 1 ? '' : 's'}</button> : null}
      <span className="grow" />
      {a.dismiss ? <button className="home-link" data-testid="home-suggestion-dismiss" title={a.dismiss.how === 'trust' ? 'Trust this: it stops being suggested until it changes (the Fix-it List can show it again)' : 'Ask again in a week'} onClick={() => void dismiss()}>{a.dismiss.label}</button> : null}
      <button className="btn sm" data-testid="home-suggestion-action" onClick={act}>{a.action.label}</button>
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
      <span className="name ellipsis">{f.name}</span>
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

// ---------------------------------------------------------------- Today

interface Running { id: string; icon: string; label: string; detail: string; route: string }

function useToday() {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [running, setRunning] = useState<Running[]>([]);
  const [mail, setMail] = useState<MessageSummary[]>([]);
  const loadPim = useCallback(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const now = Date.now();
    void (api.pim?.upcomingEvents(start.getTime(), end.getTime(), { limit: 20 }) ?? Promise.resolve([]))
      .then((list) => setEvents(list.filter((e) => e.allDay || e.end > now))).catch(() => setEvents([]));
    void (api.pim?.reminders() ?? Promise.resolve([])).then((r) => setTasks(todayTasks(r, dayKey(Date.now())))).catch(() => setTasks([]));
    // Important mail not read yet (Mail's own Important/Other triage), from what is kept on this computer.
    void (api.pim?.messages({ folder: 'unified', split: 'important', filter: 'unread' }) ?? Promise.resolve({ messages: [] }))
      .then((r) => setMail(r.messages.filter((m) => !m.seen && m.category !== 'other'))).catch(() => setMail([]));
  }, []);
  const loadRunning = useCallback(() => {
    void Promise.all([
      api.pim?.alarms().catch(() => null),
      api.island?.state().catch(() => null),
      api.awake?.status().catch(() => null),
      api.studio?.state().catch(() => null),
    ]).then(([alarms, island, awake, studio]) => {
      const out: Running[] = [];
      for (const t of alarms?.timers ?? []) {
        if (t.endsAt) out.push({ id: `timer:${t.id}`, icon: 'timer', label: t.label || 'Timer', detail: `ends ${clock(t.endsAt)}`, route: 'alarms' });
        else if (t.leftMs) out.push({ id: `timer:${t.id}`, icon: 'timer', label: t.label || 'Timer', detail: `paused · ${Math.ceil(t.leftMs / 60_000)} min left`, route: 'alarms' });
      }
      const f = island?.focus;
      if (f && f.mode !== 'idle') out.push({ id: 'focus', icon: 'stopwatch', label: f.mode === 'break' ? 'Break' : 'Focus', detail: f.pausedLeft !== undefined ? 'paused' : f.endsAt ? `until ${clock(f.endsAt)}` : 'counting', route: 'planner' });
      if (awake?.on ?? island?.keepAwake?.on) {
        const until = awake?.session?.endsAt;
        out.push({ id: 'awake', icon: 'coffee', label: 'Keeping awake', detail: until ? `until ${clock(until)}` : 'until you stop it', route: 'awake' });
      }
      const rec = studio && (studio.phase === 'recording' || studio.phase === 'paused') ? studio.since : island?.recording?.since;
      if (rec) out.push({ id: 'rec', icon: 'camera', label: studio?.phase === 'paused' ? 'Recording paused' : 'Recording', detail: `since ${clock(rec)}`, route: 'studio' });
      setRunning(out);
    });
  }, []);
  const pimSoon = useDebounced(() => { loadPim(); loadRunning(); }, 400);
  const runSoon = useDebounced(loadRunning, 600);
  useEffect(() => {
    loadPim();
    loadRunning();
    const offs = [api.on('pim-changed', pimSoon), api.on('awake-changed', runSoon), api.on('studio-changed', runSoon), api.on('island-changed', runSoon)];
    return () => offs.forEach((off) => off());
  }, [loadPim, loadRunning, pimSoon, runSoon]);
  return { events, tasks, running, mail, reloadTasks: loadPim };
}

function TodayColumn({ onHide }: { onHide: () => void }) {
  const { go } = useStore();
  const { events, tasks, running, mail, reloadTasks } = useToday();
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const shownEvents = (events ?? []).slice(0, 5);
  const shownTasks = tasks.slice(0, 5);
  const now = Date.now();
  const empty = events !== null && !events.length && !tasks.length && !running.length && !mail.length;
  return (
    <section className="home-today" aria-labelledby="home-today" data-testid="home-today">
      <div className="section-head">
        <h2 id="home-today">Today</h2>
        <span className="small muted ellipsis home-today-date">{date}</span>
        <span className="grow" />
        <button className="btn ghost icon sm" data-testid="home-today-hide" title="Hide Today (Edit Home shows it again)" aria-label="Hide Today" onClick={onHide}><Icon name="eyeOff" size={13} /></button>
      </div>
      {running.length ? (
        <ul className="home-today-list home-running" aria-label="Running now">
          {running.map((r) => (
            <li key={r.id}><button className="home-today-row" onClick={() => go({ name: r.route as 'awake' })}><Icon name={r.icon} size={13} /><span className="t ellipsis">{r.label}</span><span className="when">{r.detail}</span></button></li>
          ))}
        </ul>
      ) : null}
      {shownEvents.length ? (
        <ul className="home-today-list" aria-label="Events">
          {shownEvents.map((e) => (
            <li key={e.key}>
              <button className="home-today-row" title={[e.title, e.location, e.calendarName].filter(Boolean).join('\n')} onClick={() => void api.pim?.openEvent(e.eventId, e.instance)}>
                <i className="dot" style={{ background: e.color }} />
                <span className="when">{e.allDay ? 'All day' : e.start <= now ? 'Now' : clock(e.start)}</span>
                <span className="t ellipsis">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {(events?.length ?? 0) > shownEvents.length ? <button className="home-link" onClick={() => go({ name: 'calendar' })}>{events!.length - shownEvents.length} more today</button> : null}
      {shownTasks.length ? (
        <ul className="home-today-list" aria-label="Tasks due">
          {shownTasks.map((t) => (
            <li key={t.id} className="home-task">
              <input type="checkbox" aria-label={`Done: ${t.title}`} onChange={() => void api.pim?.completeReminder(t.id, true).then(reloadTasks)} />
              <button className="home-today-row" title={t.notes ? `${t.title}\n${t.notes}` : t.title} onClick={() => go({ name: 'planner', arg: `task:${t.id}` })}>
                <span className="t ellipsis">{t.title}</span>
                {isOverdue(t, now) ? <span className="when late">overdue</span> : t.due ? <span className="when">{clock(t.due)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {tasks.length > shownTasks.length ? <button className="home-link" onClick={() => go({ name: 'planner' })}>{tasks.length - shownTasks.length} more tasks</button> : null}
      {mail.length ? (
        <ul className="home-today-list" aria-label="Important mail">
          {mail.slice(0, 3).map((m) => (
            <li key={m.id}>
              <button className="home-today-row" title={[m.from?.name || m.from?.address, m.subject].filter(Boolean).join('\n')} onClick={() => go({ name: 'mail', arg: m.id })}>
                <Icon name="mail" size={13} />
                <span className="t ellipsis"><b>{m.from?.name || m.from?.address || 'Mail'}</b> · {m.subject || '(no subject)'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mail.length > 3 ? <button className="home-link" onClick={() => go({ name: 'mail' })}>{mail.length - 3} more important</button> : null}
      {empty ? <p className="small muted home-today-empty">Nothing planned today.</p> : events !== null && !events.length && !tasks.length && !mail.length ? <p className="small muted home-today-empty">No more events or tasks today.</p> : null}
      <div className="home-today-links">
        <button className="home-link" onClick={() => go({ name: 'calendar' })}>Calendar</button>
        <button className="home-link" onClick={() => go({ name: 'planner' })}>Planner</button>
        <button className="home-link" onClick={() => go({ name: 'mail' })}>Mail</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Library

function LibrarySection({ style }: { style: HomeSettings['library'] }) {
  const { go, version } = useStore();
  const t = useT();
  const totals = useAsync(() => api.library.totals(), [version]);
  const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
  // Empty kinds are left out once the counts are in.
  const kinds = SHELVES.filter((k) => !totals.data || totals.data[k].count > 0);
  const tip = (k: FileKind) => (totals.data ? `${t(`kindAll.${k}`)}: ${totals.data[k].count.toLocaleString()} · ${formatBytes(totals.data[k].size)}` : t(`kindAll.${k}`));
  return (
    <section className="section" aria-labelledby="home-lib">
      <div className="section-head"><h2 id="home-lib">Library</h2></div>
      {style === 'tiles' ? (
        <div className="home-tiles" data-testid="home-library-tiles">
          {kinds.map((k) => (
            <button key={k} className="home-tile" onClick={() => go({ name: 'library', arg: k })} title={tip(k)}>
              <span className="ico" style={{ background: KIND_COLOR[k] }}><Icon name={k} size={15} /></span>
              <span className="lbl ellipsis">{t(`kindAll.${k}`)}</span>
              <span className="n">{totals.data ? totals.data[k].count.toLocaleString() : '—'}{totals.data ? <small>{formatBytes(totals.data[k].size)}</small> : null}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="home-chips" data-testid="home-library-chips">
          {kinds.map((k) => (
            <button key={k} className="home-chip" onClick={() => go({ name: 'library', arg: k })} title={tip(k)}>
              <i style={{ background: KIND_COLOR[k] }} />{t(`kindAll.${k}`)} <span className="n">{totals.data ? short(totals.data[k].count) : '—'}</span>
            </button>
          ))}
        </div>
      )}
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
      <p className="small muted" style={{ margin: '8px 0 0' }}>On a wide window Today is a column on the right; on a narrow one it takes its place in this order.</p>
    </section>
  );
}

/** Whether the page is wide enough for the Today column (measured when it resizes, never polled). */
function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= WIDE);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}

export function Home() {
  const [home, setHome] = useHome();
  const [editing, setEditing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const wide = useWide(root);
  const { main, side } = homeColumns(home, wide);
  const draw: Record<HomeSectionId, () => React.ReactNode> = {
    suggestions: () => <SuggestionLine />,
    jump: () => <JumpBackIn narrow={!wide} />,
    today: () => <TodayColumn onHide={() => setHome(setSectionShown(home, 'today', false))} />,
    library: () => <LibrarySection style={home.library} />,
    pinned: () => <PinnedSection />,
    weather: () => <WeatherCard />,
    usage: () => <UsageSection />,
  };
  return (
    <div ref={root} className={`home home-${home.density} ${side.length ? 'with-side' : ''}`} data-testid="home">
      <Header editing={editing} onEdit={() => setEditing((e) => !e)} />
      {editing ? <EditPanel home={home} setHome={setHome} /> : null}
      <div className="home-body">
        <div className="home-main">
          {main.map((id) => <div key={id} className="home-slot" data-section={id}>{draw[id]()}</div>)}
        </div>
        {side.length ? <div className="home-side">{side.map((id) => <div key={id} className="home-slot" data-section={id}>{draw[id]()}</div>)}</div> : null}
      </div>
    </div>
  );
}
