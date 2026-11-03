// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Time Tracking: where the day went (a timeline and totals by project, app and
// site), the week, project rules, what is kept, and CSV. Recorded only on this
// computer (electron/services/time-track.ts).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimeStatus } from '../../core/api-time';
import { dayKey, duration, NO_PROJECT, weekOf, type DaySummary, type TimeRule, type TimeTrackOptions, type Total } from '../../core/time-track';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import '../styles/time.css';

type Tab = 'day' | 'week' | 'projects' | 'settings';
const COLORS = ['var(--accent)', 'var(--c-installer)', 'var(--c-audio)', 'var(--c-image)', 'var(--c-video)', 'var(--c-app)', 'var(--c-document)', 'var(--c-archive)'];

/** A steady colour per project (or app, when no project is set). */
function colorFor(key: string, keys: string[]): string {
  if (key === NO_PROJECT) return 'var(--c-other)';
  const i = keys.filter((k) => k !== NO_PROJECT).indexOf(key);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
}

const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function TimeTracking() {
  const { toast } = useStore();
  const [st, setSt] = useState<TimeStatus | null>(null);
  const [tab, setTab] = useState<Tab>('day');
  const load = useCallback(() => void api.timeTrack.status().then(setSt).catch(() => undefined), []);
  useEffect(() => {
    load();
    const off = api.on('time-changed', load);
    const off2 = api.on('settings-changed', load);
    return () => { off(); off2(); };
  }, [load]);
  if (!st) return <div className="page"><PageHead title="Time Tracking" /></div>;
  const pause = async (minutes?: number) => setSt(await api.timeTrack.setPaused(true, minutes));
  return (
    <div className="page tt-page" data-testid="time-page">
      <PageHead title="Time Tracking" sub="Where your time goes: apps, documents and sites, recorded only on this computer.">
        {st.paused ? <button className="btn primary" data-testid="tt-resume" onClick={async () => setSt(await api.timeTrack.setPaused(false))}>Resume</button> : (
          <>
            <button className="btn" data-testid="tt-pause-hour" onClick={() => void pause(60)}>Pause for an hour</button>
            <button className="btn" data-testid="tt-pause" onClick={() => void pause()}>Pause</button>
          </>
        )}
      </PageHead>
      <Now st={st} />
      <Tabs label="Time tracking" value={tab} onChange={setTab} items={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'projects', label: 'Projects' }, { id: 'settings', label: 'Settings' }]} />
      {tab === 'day' ? <DayView rules={st.rules} onError={toast} /> : tab === 'week' ? <WeekView rules={st.rules} /> : tab === 'projects' ? <Projects st={st} setSt={setSt} /> : <Options st={st} setSt={setSt} />}
    </div>
  );
}

function Now({ st }: { st: TimeStatus }) {
  const [, setT] = useState(0);
  useEffect(() => { const t = setInterval(() => setT((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const text = !st.supported ? 'This desktop does not tell Keeper which app is in front (Wayland), so nothing can be recorded here.'
    : st.paused ? (st.pausedUntil ? `Paused until ${clock(st.pausedUntil)}.` : 'Paused until you resume.')
    : st.away ? 'Not counting: nobody is at the computer.'
    : st.now ? `${st.now.app}${st.now.title ? ` — ${st.now.title}` : ''}${st.now.site ? ` · ${st.now.site}` : ''} · ${duration(Date.now() - st.now.since)}`
    : 'Waiting for the next app to come to the front.';
  return (
    <div className={`tt-now${st.recording ? ' on' : ''}`} role="status" data-testid="tt-now">
      <span className="tt-dot" aria-hidden />
      <div className="tt-now-text"><b>{st.recording ? 'Recording' : st.paused ? 'Paused' : 'Not recording'}</b> <span className="muted">{text}</span></div>
      <span className="muted small">{st.encrypted ? 'Encrypted on this computer' : 'Only on this computer'}</span>
    </div>
  );
}

function Bars({ title, items, keys, colorize, testid }: { title: string; items: Total[]; keys: string[]; colorize?: boolean; testid?: string }) {
  const max = items[0]?.ms ?? 1;
  return (
    <section className="card tt-bars" aria-label={title} data-testid={testid}>
      <h3>{title}</h3>
      {items.length ? (
        <ol>
          {items.slice(0, 12).map((t) => (
            <li key={t.key}>
              <span className="tt-bar-label" title={t.key}>{colorize ? <i className="tt-swatch" style={{ background: colorFor(t.key, keys) }} aria-hidden /> : null}<span className="tt-ell">{t.key}</span></span>
              <span className="tt-bar" aria-hidden><i style={{ width: `${Math.max(2, (t.ms / max) * 100)}%`, background: colorize ? colorFor(t.key, keys) : undefined }} /></span>
              <span className="tt-bar-ms">{duration(t.ms)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="muted small">Nothing yet.</p>}
    </section>
  );
}

function DayView({ rules, onError }: { rules: TimeRule[]; onError: (m: string) => void }) {
  const today = dayKey(Date.now());
  const [day, setDay] = useState(today);
  const [sum, setSum] = useState<DaySummary | null>(null);
  const load = useCallback(() => void api.timeTrack.day(day).then((r) => setSum(r.summary)).catch(() => setSum(null)), [day]);
  useEffect(() => {
    load();
    const off = api.on('time-changed', load);
    const t = day === today ? setInterval(load, 60_000) : undefined;
    return () => { off(); if (t) clearInterval(t); };
  }, [load, day, today, rules]);
  const keys = useMemo(() => sum?.projects.map((p) => p.key) ?? [], [sum]);
  const exportDay = async () => {
    try {
      const r = await api.timeTrack.exportCsv(day, day);
      if (r.saved) onError(`Saved ${r.rows} row${r.rows === 1 ? '' : 's'} to ${r.path}`);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  // The timeline covers the hours with something in them (at least 8), on whole hours.
  const range = useMemo(() => {
    const base = new Date(`${day}T00:00:00`).getTime();
    if (!sum?.first || !sum.last) return { from: base + 8 * 3600_000, to: base + 18 * 3600_000 };
    let from = Math.floor((sum.first - base) / 3600_000);
    let to = Math.ceil((sum.last - base) / 3600_000);
    if (to - from < 8) { const pad = 8 - (to - from); from = Math.max(0, from - Math.floor(pad / 2)); to = Math.min(24, Math.max(to + Math.ceil(pad / 2), from + 8)); }
    return { from: base + from * 3600_000, to: base + to * 3600_000 };
  }, [sum, day]);
  const span = range.to - range.from;
  const hours = Array.from({ length: Math.round(span / 3600_000) + 1 }, (_, i) => range.from + i * 3600_000);
  return (
    <div className="tt-day">
      <div className="tt-daybar">
        <button className="btn sm" aria-label="Day before" onClick={() => setDay(shiftDay(day, -1))}><Icon name="chevronLeft" size={14} /></button>
        <h2 className="tt-dayname" data-testid="tt-dayname">{day === today ? 'Today' : longDay(day)}</h2>
        <button className="btn sm" aria-label="Day after" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}><Icon name="chevronRight" size={14} /></button>
        {day !== today ? <button className="btn sm ghost" onClick={() => setDay(today)}>Today</button> : null}
        <span className="grow" />
        <b className="tt-total" data-testid="tt-total">{duration(sum?.total ?? 0)}</b>
        <button className="btn sm" data-testid="tt-export-day" onClick={() => void exportDay()}>Export CSV</button>
        <button className="btn sm ghost" aria-label="Delete this day" onClick={async () => { if (confirm('Delete everything recorded on this day?')) { await api.timeTrack.removeDay(day); load(); } }}><Icon name="trash" size={14} /></button>
      </div>
      <section className="card tt-timeline" aria-label="Timeline" data-testid="tt-timeline">
        <div className="tt-track">
          {sum?.blocks.map((b, i) => {
            const left = ((Math.max(b.start, range.from) - range.from) / span) * 100;
            const width = Math.max(0.3, ((Math.min(b.end, range.to) - Math.max(b.start, range.from)) / span) * 100);
            const label = `${clock(b.start)}–${clock(b.end)} · ${b.app}${b.project ? ` · ${b.project}` : ''}`;
            return <span key={i} className="tt-block" role="img" aria-label={label} title={label} style={{ left: `${left}%`, width: `${width}%`, background: colorFor(b.project ?? NO_PROJECT, keys) }} />;
          })}
        </div>
        <div className="tt-hours" aria-hidden>{hours.map((h, i) => <span key={h} style={{ left: `${(i / (hours.length - 1)) * 100}%` }}>{new Date(h).toLocaleTimeString([], { hour: 'numeric' })}</span>)}</div>
        {!sum?.total ? <p className="muted small">Nothing recorded on this day.</p> : null}
      </section>
      <div className="tt-grid">
        <Bars title="Projects" items={sum?.projects ?? []} keys={keys} colorize testid="tt-projects" />
        <Bars title="Apps" items={sum?.apps ?? []} keys={keys} testid="tt-apps" />
        <Bars title="Sites" items={sum?.sites ?? []} keys={keys} />
        <Bars title="Documents and windows" items={sum?.titles ?? []} keys={keys} />
      </div>
    </div>
  );
}

function WeekView({ rules }: { rules: TimeRule[] }) {
  const [monday, setMonday] = useState(dayKey(weekOf(Date.now())));
  const [w, setW] = useState<Awaited<ReturnType<typeof api.timeTrack.week>> | null>(null);
  useEffect(() => { void api.timeTrack.week(monday).then(setW).catch(() => setW(null)); }, [monday, rules]);
  const keys = w?.projects.map((p) => p.key) ?? [];
  const max = Math.max(1, ...(w?.days.map((d) => d.total) ?? [1]));
  const thisWeek = dayKey(weekOf(Date.now()));
  const sunday = shiftDay(monday, 6);
  return (
    <div className="tt-week" data-testid="tt-week">
      <div className="tt-daybar">
        <button className="btn sm" aria-label="Week before" onClick={() => setMonday(shiftDay(monday, -7))}><Icon name="chevronLeft" size={14} /></button>
        <h2 className="tt-dayname">{monday === thisWeek ? 'This week' : `Week of ${longDay(monday)}`}</h2>
        <button className="btn sm" aria-label="Week after" disabled={monday >= thisWeek} onClick={() => setMonday(shiftDay(monday, 7))}><Icon name="chevronRight" size={14} /></button>
        <span className="grow" />
        <b className="tt-total">{duration(w?.total ?? 0)}</b>
        <button className="btn sm" onClick={() => void api.timeTrack.exportCsv(monday, sunday)}>Export CSV</button>
      </div>
      <section className="card tt-weekbars" aria-label="Each day">
        {w?.days.map((d) => (
          <div key={d.day} className="tt-weekrow">
            <span className="tt-weekday">{shortDay(d.day)}</span>
            <span className="tt-stack" role="img" aria-label={`${shortDay(d.day)}: ${duration(d.total)}${d.projects.length ? ` (${d.projects.map((p) => `${p.key} ${duration(p.ms)}`).join(', ')})` : ''}`}>
              {d.projects.map((p) => <i key={p.key} title={`${p.key} · ${duration(p.ms)}`} style={{ width: `${(p.ms / max) * 100}%`, background: colorFor(p.key, keys) }} />)}
            </span>
            <span className="tt-bar-ms">{d.total ? duration(d.total) : ''}</span>
          </div>
        ))}
      </section>
      <Bars title="Projects this week" items={w?.projects ?? []} keys={keys} colorize />
    </div>
  );
}

function Projects({ st, setSt }: { st: TimeStatus; setSt: (s: TimeStatus) => void }) {
  const [rules, setRules] = useState<TimeRule[]>(st.rules);
  useEffect(() => setRules(st.rules), [st.rules]);
  const save = async (next: TimeRule[]) => { setRules(next); setSt(await api.timeTrack.saveRules(next)); };
  const edit = (i: number, patch: Partial<TimeRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="tt-rules" data-testid="tt-rules">
      <p className="muted small">Time goes to the first project whose rule matches. A site rule also covers its subdomains.</p>
      {rules.map((r, i) => (
        <div key={r.id} className="card tt-rule" role="group" aria-label={`Rule for ${r.project || 'a project'}`}>
          <input className="input" value={r.project} placeholder="Project" aria-label="Project" onChange={(e) => edit(i, { project: e.target.value })} onBlur={() => void save(rules)} />
          <span className="muted small">when</span>
          <select className="input" value={r.field} aria-label="What the rule looks at" onChange={(e) => void save(rules.map((x, j) => (j === i ? { ...x, field: e.target.value as TimeRule['field'] } : x)))}>
            <option value="any">anything</option><option value="app">the app</option><option value="title">the window title</option><option value="site">the site</option>
          </select>
          <span className="muted small">contains</span>
          <input className="input" value={r.contains} placeholder="words" aria-label="Contains" onChange={(e) => edit(i, { contains: e.target.value })} onBlur={() => void save(rules)} />
          <button className="btn sm ghost" aria-label="Remove this rule" onClick={() => void save(rules.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <button className="btn" data-testid="tt-add-rule" onClick={() => setRules([...rules, { id: Math.random().toString(36).slice(2, 10), project: '', field: 'any', contains: '' }])}><Icon name="plus" size={14} /> Add a rule</button>
    </div>
  );
}

function Options({ st, setSt }: { st: TimeStatus; setSt: (s: TimeStatus) => void }) {
  const { updateSettings, toast } = useStore();
  const o = st.options;
  const [ex, setEx] = useState('');
  const set = (patch: Partial<TimeTrackOptions>) => void updateSettings({ timeTrack: { ...o, ...patch } });
  return (
    <div className="card pad tt-options">
      <Row title="Keep window titles" desc="Document and page names. Off keeps only the app and site."><Toggle on={o.titles} label="Keep window titles" onChange={(v) => set({ titles: v })} /></Row>
      <Row title="Keep websites" desc="The site in front, from Keeper’s browser extension."><Toggle on={o.sites} label="Keep websites" onChange={(v) => set({ sites: v })} /></Row>
      <Row title="Stop counting when away" desc="Nobody touching the computer for this long ends the time.">
        <select className="input" value={o.idleMinutes} aria-label="Stop counting when away" onChange={(e) => set({ idleMinutes: Number(e.target.value) })}>{[2, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
      </Row>
      <Row title="Keep recorded time for" desc="Older days are deleted.">
        <select className="input" value={o.keepDays} aria-label="Keep recorded time for" onChange={(e) => set({ keepDays: Number(e.target.value) })}>{[[7, 'A week'], [30, 'A month'], [90, 'Three months'], [365, 'A year'], [3650, 'Ten years']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Row>
      <Row title="Never record" desc="Apps and sites left out entirely, such as password managers.">
        <div className="tt-exclude">
          <div className="chips">{o.exclude.map((x) => <span key={x} className="chip">{x}<button aria-label={`Record ${x} again`} onClick={() => set({ exclude: o.exclude.filter((y) => y !== x) })}><Icon name="close" size={11} /></button></span>)}</div>
          <form className="tt-add" onSubmit={(e) => { e.preventDefault(); if (ex.trim()) { set({ exclude: [...new Set([...o.exclude, ex.trim()])] }); setEx(''); } }}>
            <input className="input" value={ex} placeholder="App name or site" aria-label="App or site never to record" onChange={(e) => setEx(e.target.value)} />
            <button className="btn sm" type="submit">Add</button>
          </form>
        </div>
      </Row>
      <Row title="Delete everything" desc="Every recorded day and its key. Rules and settings stay.">
        <button className="btn danger" data-testid="tt-wipe" onClick={async () => { if (confirm('Delete all recorded time? This cannot be undone.')) { setSt(await api.timeTrack.wipe()); toast('All recorded time is deleted'); } }}>Delete everything</button>
      </Row>
      {st.note ? <p className="small" role="note">{st.note}</p> : null}
    </div>
  );
}
