// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The bigger desktop widgets: a week of events and tasks, world clocks with
// working hours, a timer ring and a 7-day forecast. Each reads what Keeper
// already has (calendar change notices, the weather cache, the calendar
// service's timers) and wakes once a minute at most, or once a second only
// while a timer runs. Buttons and fields are no-drag, so the rest of the card
// still moves the widget.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarInfo, CountdownTimer } from '../../core/pim/types';
import { dayKey } from '../../core/pim/tasks';
import type { Weather } from '../../core/weather';
import { condition } from '../../core/weather-view';
import { forecastDays, type DayPart } from '../../core/widget-forecast';
import { cleanMinutes, plusMinute, TIMER_PRESETS, timerText, timerView, type TimerLike } from '../../core/widget-timer';
import { weekAddPlan, weekGrid, weekOf, type WeekCard } from '../../core/widget-week';
import { cellHours, DEFAULT_WORK, dayFraction, minutesIn, offsetFromViewer, overlapCells, overlapRanges, quarters, resolvePlace, viewerDayStart, workCells } from '../../core/widget-world';
import { DEFAULT_WORLD, type WidgetConfig, type WorldPlace } from '../../core/widgets';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { openNative } from '../lib/native';
import { addTaskFromText, useTasks } from '../pim/tasks-ui';
import { CalendarAccessRow, useCalendarStatus, useWeekEvents } from '../pim/week-events-ui';
import { WxGlyph } from '../screens/weather/WxGlyph';

const MIN = 60_000;
const hm = (t: number, tz?: string, short = false) => {
  try {
    return new Date(t).toLocaleTimeString([], { hour: short ? 'numeric' : '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return '—';
  }
};
/** "6 AM" or "06" as the computer writes an hour. */
const hourOnly = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric' });

/** Saves a widget's options (the window and the Widgets page both reload on the change notice). */
function saveOptions(w: WidgetConfig, patch: Partial<WidgetConfig['options']>) {
  return api.widgets.save({ ...w, options: { ...w.options, ...patch } });
}

/** A text field in a desktop-layer window asks for the keyboard when clicked. */
const askFocus = () => void api.widgets.focus?.().catch(() => undefined);

/** The time, updated on each new minute (one timer, re-armed each minute). */
export function useMinute(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let t: number;
    const arm = () => {
      t = window.setTimeout(() => { setNow(Date.now()); arm(); }, MIN - (Date.now() % MIN) + 50);
    };
    arm();
    return () => window.clearTimeout(t);
  }, []);
  return now;
}

/** The time every second while `on` and the window can be seen; otherwise it stands still. */
function useSeconds(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return undefined;
    let t: number | undefined;
    const run = () => {
      window.clearInterval(t);
      t = undefined;
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      t = window.setInterval(() => setNow(Date.now()), 1000);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', run); };
  }, [on]);
  return now;
}

// ---------------------------------------------------------------- Week

const DEFAULT_TASK_COLOR = '#bf5af2';

function useCalendars(): CalendarInfo[] {
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  useEffect(() => {
    const load = () => void api.pim?.calendars?.().then(setCals).catch(() => undefined);
    load();
    return api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never);
  }, []);
  return cals;
}

function WeekCardView({ c, onDone, done }: { c: WeekCard; onDone: () => void; done: boolean }) {
  const t = useT();
  const time = c.at !== undefined ? hm(c.at, undefined, true) : '';
  if (c.kind === 'event') {
    return (
      <button className={`wgw-card ev${c.allDay ? ' all' : ''}`} style={{ ['--c' as string]: c.color }} title={c.title}
        onClick={() => void openNative('calendar', { eventUrl: c.openUrl, date: c.at })}>
        {time ? <span className="wgw-time">{c.part === 'last' ? `→ ${time}` : time}</span> : null}
        <span className="wgw-t">{c.title}</span>
      </button>
    );
  }
  return (
    <div className={`wgw-card task${done ? ' done' : ''}${c.carried ? ' carried' : ''}`} style={{ ['--c' as string]: c.color }} title={c.title}>
      <i className="wgw-dot" aria-hidden />
      <span className="wgw-body">{time ? <span className="wgw-time">{time}</span> : null}<span className="wgw-t">{c.title}</span></span>
      <button className="wgw-x" aria-label={`${t('widget.markDone')}: ${c.title}`} title={t('widget.markDone')} onClick={onDone}>×</button>
    </div>
  );
}

function AddField({ day, label, calendars }: { day: string; label: string; calendars: CalendarInfo[] }) {
  const t = useT();
  const [text, setText] = useState('');
  const add = async () => {
    const plan = weekAddPlan(text, day);
    if (!plan) return;
    setText('');
    try {
      if (plan.kind === 'event') {
        const prefs = await api.pim.prefs().catch(() => null);
        const ok = (c?: CalendarInfo) => !!c && c.visible && !c.readOnly && !c.tasks;
        const cal = [calendars.find((c) => c.id === prefs?.defaultCalendar), ...calendars].find(ok);
        if (cal) {
          await api.pim.saveEvent({ id: '', uid: '', calendar: cal.id, title: plan.title, start: plan.start, end: plan.end, allDay: false, rrule: plan.rrule, location: plan.location });
          return;
        }
        // No calendar to write to: a task with that time instead.
        await addTaskFromText(plan.title, { plannedFor: dayKey(plan.start), due: plan.start });
        return;
      }
      await addTaskFromText(plan.text, { plannedFor: plan.plannedFor });
    } catch {
      setText(text);
    }
  };
  return (
    <input className="wgw-add" value={text} placeholder={t('widget.add')} aria-label={t('widget.addTask').replace('{day}', label)}
      onPointerDown={askFocus} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') void add(); if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); } }} />
  );
}

export function WeekWidget({ w }: { w: WidgetConfig }) {
  const t = useT();
  const now = useMinute();
  const today = dayKey(now);
  const [offset, setOffset] = useState(0);
  const [weekStart, setWeekStart] = useState(1);
  useEffect(() => {
    const load = () => void api.pim?.prefs?.().then((p) => setWeekStart(p.weekStart ?? 1)).catch(() => undefined);
    load();
    return api.on('pim-changed', ((k: string) => { if (k === 'prefs') load(); }) as never);
  }, []);
  const days = useMemo(() => weekOf(today, weekStart, offset), [today, weekStart, offset]);
  const events = useWeekEvents(days, { watch: false });
  const { tasks } = useTasks();
  const calendars = useCalendars();
  const [status, reloadStatus] = useCalendarStatus();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const colors = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const cols = useMemo(() => weekGrid(days, events, tasks, today, colors, DEFAULT_TASK_COLOR), [days, events, tasks, today, colors]);
  const first = new Date(cols[0].start);
  const narrow = w.bounds.width / 7 < 92;
  const done = (c: WeekCard) => {
    setGone((s) => new Set(s).add(c.id));
    void api.pim.completeReminder(c.id, true).catch(() => setGone((s) => { const n = new Set(s); n.delete(c.id); return n; }));
  };
  return (
    <div className={`wgw${narrow ? ' narrow' : ''}`} data-testid="widget-week">
      <div className="wgw-head">
        <b className="wg-ell">{t('widget.weekOf').replace('{date}', first.toLocaleDateString([], { month: 'short', day: 'numeric' }))}</b>
        <span className="wgw-nav">
          <button aria-label={t('widget.prevWeek')} title={t('widget.prevWeek')} onClick={() => setOffset(offset - 1)}><Icon name="chevronLeft" size={12} /></button>
          <button className={offset === 0 ? 'on' : ''} onClick={() => setOffset(0)}>{t('widget.thisWeek')}</button>
          <button aria-label={t('widget.nextWeek')} title={t('widget.nextWeek')} onClick={() => setOffset(offset + 1)}><Icon name="chevronRight" size={12} /></button>
        </span>
      </div>
      {status?.row ? <div className="wg-access"><CalendarAccessRow status={status} onChange={reloadStatus} /></div> : null}
      <div className="wgw-grid">
        {cols.map((c) => {
          const d = new Date(c.start);
          const label = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
          return (
            <div key={c.day} className={`wgw-col${c.today ? ' today' : ''}${c.past ? ' past' : ''}`} data-day={c.day}>
              <div className="wgw-day"><span>{d.toLocaleDateString([], { weekday: 'short' })}</span><b>{d.getDate()}</b></div>
              <div className="wgw-cards">
                {c.cards.filter((x) => !gone.has(x.id)).map((x) => <WeekCardView key={x.key} c={x} done={false} onDone={() => done(x)} />)}
              </div>
              <AddField day={c.day} label={label} calendars={calendars} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- World clocks with working hours

/** A strip cell coloured by the quarters worked: full, none, or a split. */
function cellBg(mask: number, on: string, off: string): string {
  const n = quarters(mask);
  if (n === 4) return on;
  if (n === 0) return off;
  const stops = [0, 1, 2, 3].map((q) => `${mask & (1 << q) ? on : off} ${q * 25}% ${(q + 1) * 25}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function Strip({ cells, digits, kind, title }: { cells: number[]; digits?: number[]; kind: 'work' | 'overlap'; title?: string }) {
  const on = kind === 'overlap' ? 'var(--wgc-overlap)' : 'var(--wgc-on)';
  return (
    <div className={`wgc-strip ${kind}`} title={title}>
      {cells.map((m, i) => <i key={i} style={{ background: cellBg(m, on, 'var(--wgc-off)') }}>{digits ? digits[i] : null}</i>)}
    </div>
  );
}

function WorldList({ places, now }: { places: WorldPlace[]; now: number }) {
  const d = new Date(now);
  return (
    <div className="wg-world">
      {places.slice(0, 6).map((p) => {
        let h = 12;
        try { h = Math.floor(minutesIn(p.zone, now) / 60); } catch { /* unknown zone */ }
        const work = p.work ?? DEFAULT_WORK;
        const day = h >= 7 && h < 19;
        const m = (() => { try { return minutesIn(p.zone, now); } catch { return -1; } })();
        const working = m >= 0 && (work.start < work.end ? m >= work.start && m < work.end : m >= work.start || m < work.end);
        return (
          <div key={p.zone + p.label} className="wg-world-row">
            <span className="wg-world-dot" data-day={day ? '1' : '0'}>{day ? '☀︎' : '☾'}</span>
            <span className="wg-ell">{p.label}{working ? <i className="wgc-working" aria-hidden /> : null}</span>
            <b>{hm(d.getTime(), p.zone)}</b>
          </div>
        );
      })}
    </div>
  );
}

export function WorldWidget({ w }: { w: WidgetConfig }) {
  const t = useT();
  const now = useMinute();
  const places = w.options.places ?? DEFAULT_WORLD;
  const [preview, setPreview] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const from = viewerDayStart(now);
  const at = preview === null ? now : from + preview * MIN;
  const rows = useMemo(() => places.map((p) => {
    try {
      return { p, cells: workCells(p.zone, p.work ?? DEFAULT_WORK, from), hours: cellHours(p.zone, from) };
    } catch {
      return { p, cells: Array.from({ length: 24 }, () => 0), hours: undefined };
    }
  }), [places, from]);
  const overlap = useMemo(() => overlapCells(rows.map((r) => r.cells)), [rows]);
  const shared = useMemo(() => overlapRanges(overlap, from), [overlap, from]);
  if (w.bounds.width < 400) return <WorldList places={places} now={now} />;
  // City hours in the cells when each cell is wide enough for two digits.
  const digits = (w.bounds.width - 40) * 0.62 / 24 >= 15 * w.style.size;
  const sliderValue = preview ?? Math.round((now - from) / MIN);
  const add = () => {
    const p = resolvePlace(text);
    if (!p) { setBad(true); return; }
    setBad(false);
    setText('');
    if (!places.some((x) => x.zone === p.zone && x.label === p.label)) void saveOptions(w, { places: [...places, p].slice(0, 8) });
  };
  const remove = (i: number) => void saveOptions(w, { places: places.filter((_, j) => j !== i) });
  const total = shared.minutes ? `${Math.floor(shared.minutes / 60)}${shared.minutes % 60 ? `:${String(shared.minutes % 60).padStart(2, '0')}` : ''} h` : '—';
  const overlapTitle = shared.ranges.length ? shared.ranges.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ') : t('widget.noOverlap');
  return (
    <div className="wgc" data-testid="widget-world">
      <div className="wgc-table" style={{ ['--rows' as string]: rows.length + 1 }}>
        <span className="wgc-axis-l">
          <input className={`wgc-add${bad ? ' bad' : ''}`} value={text} placeholder={t('widget.addCity')} aria-label={t('widget.addCity')} aria-invalid={bad || undefined}
            title={bad ? t('widget.unknownCity') : 'Tokyo, Dubai, Europe/Paris…'}
            onPointerDown={askFocus} onChange={(e) => { setText(e.target.value); setBad(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setText(''); setBad(false); e.currentTarget.blur(); } }} />
        </span>
        <div className="wgc-axis" aria-hidden>{[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{hourOnly(from + h * 3_600_000)}</span>)}</div>
        {rows.map(({ p, cells, hours }, i) => {
          const off = offsetFromViewer(p.zone, at);
          let dayDiff = 0;
          try { dayDiff = Math.sign(Number(new Intl.DateTimeFormat('en-CA', { timeZone: p.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).replace(/-/g, '')) - Number(dayKey(at).replace(/-/g, ''))); } catch { /* unknown zone */ }
          return (
            <div key={`${p.zone}|${p.label}|${i}`} className="wgc-row">
              <span className="wgc-name" title={`${p.label} · ${p.zone}${off ? ` (${off})` : ''}`}>
                <span className="wg-ell">{p.label}</span>
                <button className="wgc-x" aria-label={t('widget.removeCity').replace('{city}', p.label)} title={t('widget.removeCity').replace('{city}', p.label)} onClick={() => remove(i)}>×</button>
              </span>
              <b className="wgc-time">{hm(at, p.zone)}{dayDiff ? <sup>{dayDiff > 0 ? '+1' : '−1'}</sup> : null}</b>
              <Strip cells={cells} digits={digits ? hours : undefined} kind="work" />
            </div>
          );
        })}
        <div className="wgc-row overlap">
          <span className="wgc-name ov" title={overlapTitle}><span className="wg-ell">{t('widget.overlap')}</span></span>
          <b className="wgc-time">{total}</b>
          <Strip cells={overlap} kind="overlap" title={overlapTitle} />
        </div>
        <div className="wgc-now" aria-hidden style={{ gridRow: `2 / span ${rows.length + 1}` }}><i style={{ left: `${dayFraction(at, from) * 100}%` }} className={preview === null ? '' : 'preview'} /></div>
        <span className="wgc-now-btn">
          {preview !== null ? <span className="wg-dim">{hm(at)}</span> : null}
          <button className={preview === null ? 'on' : ''} onClick={() => setPreview(null)} title={hm(now)}>{t('widget.now')}</button>
        </span>
        <input className="wgc-slider" type="range" min={0} max={24 * 60 - 15} step={15} value={sliderValue} aria-label={hm(at)}
          onChange={(e) => setPreview(Number(e.target.value))} onDoubleClick={() => setPreview(null)} />
      </div>
      {bad ? <div className="wgc-foot"><span className="wgc-bad">{t('widget.unknownCity')}</span></div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Timer

function useTimers(): [CountdownTimer[] | null, boolean] {
  const [timers, setTimers] = useState<CountdownTimer[] | null>(null);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    if (!api.pim?.alarms) { setOk(false); return undefined; }
    const load = () => void api.pim.alarms().then((r) => { setTimers(r.timers.map((x) => ({ ...x }))); setOk(true); }).catch(() => setOk(false));
    load();
    return api.on('pim-changed', ((k: string) => { if (k === 'alarms') load(); }) as never);
  }, []);
  return [timers, ok];
}

export function TimerWidget({ w }: { w: WidgetConfig }) {
  const t = useT();
  const minutes = cleanMinutes(w.options.minutes);
  const [timers, pimOk] = useTimers();
  // When the calendar service is off, the widget keeps its own countdown (it does not ring).
  const [local, setLocal] = useState<TimerLike | undefined>(undefined);
  const mine = timers?.find((x) => x.id === w.options.timerId);
  const cur: TimerLike | undefined = pimOk ? mine : local;
  const running = cur?.endsAt !== undefined;
  const now = useSeconds(running);
  const v = timerView(cur, minutes, Math.max(now, Date.now() - 1000));
  useEffect(() => {
    if (!pimOk && local?.endsAt !== undefined && v.leftMs <= 0) setLocal(undefined);
  }, [pimOk, local, v.leftMs]);
  const act = useCallback(async (what: 'start' | 'pause' | 'reset' | 'plus' | number) => {
    const id = mine?.id;
    try {
      if (!pimOk) throw new Error('local');
      if (what === 'start') {
        if (id && mine?.endsAt === undefined) await api.pim.timerAction(id, 'resume');
        else if (!id) { const tm = await api.pim.startTimer(t('widget.timer'), minutes * MIN); await saveOptions(w, { timerId: tm.id }); }
      } else if (what === 'pause') {
        if (id) await api.pim.timerAction(id, 'pause');
      } else if (what === 'reset') {
        if (id) await api.pim.timerAction(id, 'cancel');
        if (w.options.timerId) await saveOptions(w, { timerId: undefined });
      } else if (what === 'plus') {
        if (id) await api.pim.timerAction(id, 'extend');
        else await saveOptions(w, { minutes: plusMinute(minutes) });
      } else {
        if (id) await api.pim.timerAction(id, 'cancel');
        await saveOptions(w, { minutes: what, timerId: undefined });
      }
    } catch {
      const n = Date.now();
      if (what === 'start') setLocal((l) => (l ? (l.endsAt === undefined ? { ...l, endsAt: n + (l.leftMs ?? l.durationMs), leftMs: undefined } : l) : { durationMs: minutes * MIN, endsAt: n + minutes * MIN }));
      else if (what === 'pause') setLocal((l) => (l?.endsAt !== undefined ? { ...l, leftMs: Math.max(0, l.endsAt - n), endsAt: undefined } : l));
      else if (what === 'reset') setLocal(undefined);
      else if (what === 'plus') { if (local) setLocal((l) => (l ? { ...l, durationMs: l.durationMs + MIN, ...(l.endsAt !== undefined ? { endsAt: l.endsAt + MIN } : { leftMs: (l.leftMs ?? l.durationMs) + MIN }) } : l)); else void saveOptions(w, { minutes: plusMinute(minutes) }); }
      else { setLocal(undefined); void saveOptions(w, { minutes: what }); }
    }
  }, [mine, pimOk, minutes, w, t, local]);
  const R = 44;
  const C = 2 * Math.PI * R;
  return (
    <div className={`wgt ${v.state}`} data-testid="widget-timer">
      <div className="wgt-ring">
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} className="wgt-track" />
          <circle cx="50" cy="50" r={R} className="wgt-arc" strokeDasharray={`${C * v.fraction} ${C}`} transform="rotate(-90 50 50)" />
        </svg>
        <div className="wgt-mid">
          <b className="wgt-time" role="timer" aria-live="off">{timerText(v.leftMs)}</b>
          <span className="wgt-sub">{v.state === 'idle' ? t('widget.minutes').replace('{n}', String(minutes)) : v.state === 'paused' ? t('widget.pause') : t('widget.timer')}</span>
        </div>
      </div>
      <div className="wgt-btns">
        {v.state === 'running'
          ? <button className="wgt-main" onClick={() => void act('pause')}>{t('widget.pause')}</button>
          : <button className="wgt-main" onClick={() => void act('start')}>{v.state === 'paused' ? t('widget.resume') : t('widget.start')}</button>}
        <button onClick={() => void act('reset')} disabled={v.state === 'idle'}>{t('widget.reset')}</button>
        <button onClick={() => void act('plus')}>{t('widget.plusMin')}</button>
      </div>
      <div className="wgt-chips" role="group">
        {TIMER_PRESETS.map((p) => <button key={p} className={minutes === p ? 'on' : ''} aria-pressed={minutes === p} onClick={() => void act(p)}>{p}</button>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 7-day forecast

/** The weather Keeper already has (the Island's cache): read on show and, at most once a minute, after the Island changes. */
function useWeatherCache(): Weather | null | undefined {
  const [wx, setWx] = useState<Weather | null | undefined>(undefined);
  const last = useRef(0);
  useEffect(() => {
    const load = () => { last.current = Date.now(); void api.weather.get().then(setWx).catch(() => setWx((x) => x ?? null)); };
    load();
    return api.on('island-changed', () => { if (Date.now() - last.current > MIN) load(); });
  }, []);
  return wx;
}

const PART_KEY: Record<DayPart, string> = { night: 'widget.night', morning: 'widget.morning', afternoon: 'widget.afternoon', evening: 'widget.evening' };

export function ForecastWidget({ w }: { w: WidgetConfig }) {
  const t = useT();
  const wx = useWeatherCache();
  const now = useMinute();
  const days = useMemo(() => (wx ? forecastDays(wx, now, 7) : []), [wx, now]);
  if (wx === undefined) return <div className="wg-dim wg-center">…</div>;
  if (!wx || !days.length) return <div className="wg-dim wg-center">{t('widget.noForecast')}</div>;
  const glyph = Math.round(30 * Math.min(1.3, Math.max(0.8, w.bounds.width / 780)));
  return (
    <div className="wgf" data-testid="widget-forecast" title={wx.place.name} onDoubleClick={() => void openNative('weather', { lat: wx.place.lat, lon: wx.place.lon, label: wx.place.name })}>
      {days.map((d) => {
        const c = condition(d.code);
        return (
          <div key={d.key} className={`wgf-day${d.today ? ' today' : ''}`}>
            <div className="wgf-name"><b>{d.today ? t('widget.today') : new Date(`${d.key}T12:00`).toLocaleDateString([], { weekday: 'short' })}</b><span>{new Date(`${d.key}T12:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></div>
            <WxGlyph code={d.code} size={glyph} label={c.label} />
            <div className="wgf-cond wg-ell">{c.label}</div>
            <div className="wgf-temp"><b>{d.hiC}°</b><span>{d.loC}°</span><small>C</small></div>
            <div className="wgf-temp f"><b>{d.hiF}°</b><span>{d.loF}°</span><small>F</small></div>
            <div className="wgf-rain" title={`${t('widget.rain')} ${d.rain}%`}><Icon name="drop" size={10} />{d.rain}%</div>
            <div className="wgf-parts">
              {d.parts.map((p) => (
                <div key={p.part} className="wgf-part" title={`${t(PART_KEY[p.part])}: ${p.rain === null ? '—' : `${p.rain}%`}`}>
                  <span className="wg-ell">{t(PART_KEY[p.part])}</span>
                  <span className="wgf-bar"><i style={{ width: `${p.rain ?? 0}%` }} /></span>
                  <span className="wgf-pct">{p.rain === null ? '—' : `${p.rain}%`}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
