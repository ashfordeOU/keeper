// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calendar: day, week, month, agenda and year views across every calendar,
// quick add in plain English, drag to move or resize, and an editor for
// repeats, alerts, places and people.

import { mailIdIn } from '../../core/pim/mail-link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { meetingLink } from '../../core/pim/alarms';
import { parseQuickAdd } from '../../core/pim/quickadd';
import { describeRRule, parseRRule } from '../../core/pim/rrule';
import { isoWeek } from '../../core/pim/tz';
import type { CalEvent, CalendarInfo, Occurrence } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { RelatedPanel } from '../components/RelatedPanel';
import { Modal } from '../components/ui';
import { MapButtons } from '../components/NativeOpen';
import { openNative } from '../lib/native';
import { useStore } from '../state';
import { CalendarAccessCard, CalendarSources, useSystemAccess } from './CalendarSources';
import { usePimChanges } from './Mail';
import '../styles/pim.css';

type View = 'day' | 'week' | 'month' | 'agenda' | 'year';
const DAY = 86_400_000;
const HOUR_PX = 44;

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const startOfWeek = (t: number, ws: number) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7)); return d.getTime(); };
const startOfMonth = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(1); return d.getTime(); };
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function range(view: View, cursor: number, ws: number): [number, number] {
  if (view === 'day') return [startOfDay(cursor), addDays(startOfDay(cursor), 1)];
  if (view === 'week') { const s = startOfWeek(cursor, ws); return [s, addDays(s, 7)]; }
  if (view === 'month') { const s = startOfWeek(startOfMonth(cursor), ws); return [s, addDays(s, 42)]; }
  if (view === 'agenda') return [startOfDay(cursor), addDays(startOfDay(cursor), 60)];
  const y = new Date(cursor).getFullYear();
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
}

/** Columns for overlapping events in one day (greedy, like most calendars). */
function layout(occ: Occurrence[]): Map<Occurrence, { col: number; cols: number }> {
  const out = new Map<Occurrence, { col: number; cols: number }>();
  const sorted = [...occ].sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Occurrence[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const cols: number[] = [];
    const place = new Map<Occurrence, number>();
    for (const o of group) {
      let c = cols.findIndex((end) => end <= o.start);
      if (c < 0) { c = cols.length; cols.push(o.end); } else cols[c] = o.end;
      place.set(o, c);
    }
    for (const o of group) out.set(o, { col: place.get(o)!, cols: cols.length });
    group = [];
  };
  for (const o of sorted) {
    if (o.start >= groupEnd && group.length) flush();
    group.push(o);
    groupEnd = Math.max(groupEnd, o.end);
  }
  if (group.length) flush();
  return out;
}

export function Calendar() {
  const { toast, route } = useStore();
  const [view, setView] = useState<View>(() => (localStorage.getItem('cal.view') as View) || 'week');
  const [cursor, setCursor] = useState(Date.now());
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [occ, setOcc] = useState<Occurrence[]>([]);
  const [ws, setWs] = useState(1);
  const [weekNums, setWeekNums] = useState(false);
  const [editing, setEditing] = useState<{ event: CalEvent; instance?: number } | null>(null);
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [access, setAccess] = useSystemAccess();
  const [now, setNow] = useState(Date.now());
  const [from, to] = range(view, cursor, ws);

  const load = useCallback(() => {
    void api.pim.calendars().then(setCals);
    void api.pim.occurrences(from, to).then(setOcc);
  }, [from, to]);
  useEffect(load, [load]);
  usePimChanges(['calendar', 'accounts'], load);
  useEffect(() => { void api.pim.prefs().then((p) => { setWs(p.weekStart); setWeekNums(p.showWeekNumbers); }); }, []);
  useEffect(() => { localStorage.setItem('cal.view', view); }, [view]);
  // "New Event…" from the command palette; "calendar:event:<start>:<id>" from the Island.
  useEffect(() => {
    if (route.arg === 'new') newEvent(Date.now() + 3_600_000);
    // "Connect Google / Outlook calendar" from the Island and the Planner.
    if (route.arg === 'sources') setAdding(true);
    const m = route.arg?.match(/^event:(\d+):(.+)$/);
    if (m) {
      const at = Number(m[1]);
      setCursor(at);
      setView((v) => (v === 'year' ? 'week' : v));
      void api.pim.occurrences(at - DAY, at + DAY).then((list) => {
        const o = list.find((x) => x.event.id === m[2] && x.instance === at) ?? list.find((x) => x.event.id === m[2]);
        if (o) setEditing({ event: o.event, instance: o.instance });
      });
    }
  }, [route.arg]);
  // While the page is open, calendars are checked every minute.
  useEffect(() => {
    void api.pim.watchCalendar?.(true);
    const h = setInterval(() => void api.pim.watchCalendar?.(true), 60_000);
    return () => { clearInterval(h); void api.pim.watchCalendar?.(false); };
  }, []);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    let n = 0;
    for (const f of Array.from(e.dataTransfer.files)) {
      const p = api.files.pathOf?.(f);
      if (p && /\.(ics|ical|ifb|icalendar)$/i.test(p)) n += await api.pim.importIcs(p).catch((err) => { toast(clean(err)); return 0; });
    }
    toast(n ? `Imported ${n} event${n === 1 ? '' : 's'}` : 'Drop a calendar file (.ics) to import it');
  };
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(h); }, []);

  const colorOf = (o: Occurrence) => cals.find((c) => c.id === o.event.calendar)?.color ?? 'var(--accent)';
  const preview = useMemo(() => (quick.trim() ? parseQuickAdd(quick) : null), [quick]);

  const step = (n: number) => {
    const d = new Date(cursor);
    if (view === 'day') d.setDate(d.getDate() + n);
    else if (view === 'week') d.setDate(d.getDate() + 7 * n);
    else if (view === 'month') d.setMonth(d.getMonth() + n);
    else if (view === 'agenda') d.setDate(d.getDate() + 30 * n);
    else d.setFullYear(d.getFullYear() + n);
    setCursor(d.getTime());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || editing) return;
      if (e.key === 't') setCursor(Date.now());
      else if (e.key === 'ArrowLeft' || e.key === 'j') step(-1);
      else if (e.key === 'ArrowRight' || e.key === 'k') step(1);
      else if (e.key === 'd') setView('day');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else if (e.key === 'a') setView('agenda');
      else if (e.key === 'y') setView('year');
      else if (e.key === 'n') newEvent(Date.now());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const writable = cals.filter((c) => !c.readOnly && !c.tasks);
  const newEvent = (start: number, allDay = false) => {
    const s = allDay ? startOfDay(start) : Math.round(start / (15 * 60_000)) * 15 * 60_000;
    setEditing({ event: { id: '', uid: '', calendar: writable[0]?.id ?? 'local:calendar', title: '', start: s, end: allDay ? addDays(s, 1) : s + 3_600_000, allDay, alarms: allDay ? undefined : [{ minutesBefore: 10 }] } });
  };

  const addQuick = async () => {
    if (!quick.trim()) return;
    try {
      const e = await api.pim.quickAdd(quick, writable[0]?.id);
      if (e) {
        toast(`Added “${e.title}” · ${new Date(e.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: e.allDay ? undefined : 'numeric', minute: e.allDay ? undefined : '2-digit' })}`);
        setCursor(e.start);
      }
      setQuick('');
    } catch (err) {
      toast(clean(err));
    }
  };

  const move = async (o: Occurrence, start: number, end: number) => {
    const repeating = !!o.event.rrule || o.event.recurrenceId !== undefined;
    const scope = repeating ? (window.confirm('Change only this event?\n\nOK: only this one · Cancel: every event in the series') ? 'this' : 'all') : 'all';
    try {
      if (scope === 'all' && o.event.rrule) await api.pim.saveEvent({ ...o.event, start: o.event.start + (start - o.start), end: o.event.start + (start - o.start) + (end - start) });
      else await api.pim.saveEvent({ ...o.event, start, end }, { scope: repeating ? 'this' : undefined, instance: o.instance });
    } catch (e) {
      toast(clean(e));
      load();
    }
  };

  const title = view === 'year' ? String(new Date(cursor).getFullYear())
    : view === 'day' ? new Date(cursor).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week' ? `${new Date(from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(to - 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : new Date(cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className={`calendar${dropping ? ' dropping' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }} onDrop={(e) => void onDrop(e)}>
      <aside className="cal-side">
        <MiniMonth cursor={cursor} ws={ws} onPick={(t) => { setCursor(t); if (view === 'year' || view === 'month') setView('day'); }} marks={occ} />
        <div className="cal-list">
          <div className="small muted" style={{ fontWeight: 600, margin: '10px 4px 4px' }}>Calendars</div>
          <CalendarAccessCard access={access} compact onChange={(a) => { setAccess(a); load(); }} />
          {cals.map((c, i, list) => (
            <div key={c.id}>
            {c.group && c.group !== list[i - 1]?.group ? <div className="cal-group">{c.group}</div> : null}
            <label key={c.id} className="cal-item" title={c.readOnly ? 'Read only' : ''}>
              <input type="checkbox" checked={c.visible} onChange={(e) => void api.pim.setCalendar(c.id, { visible: e.target.checked })} style={{ accentColor: c.color }} />
              <i style={{ background: c.color }} />
              <span className="grow ellipsis">{c.name}</span>
              {c.readOnly ? <Icon name="lock" size={11} className="muted" /> : null}
            </label>
            </div>
          ))}
          <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add or connect calendars</button>
          <button className="btn ghost sm" onClick={async () => { const n = await api.pim.importIcs(); if (n) toast(`Imported ${n} event${n === 1 ? '' : 's'}`); }}><Icon name="down" size={13} /> Import .ics</button>
        </div>
      </aside>

      <section className="cal-main">
        <div className="cal-head">
          <div className="btn-row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => setCursor(Date.now())}>Today</button>
            <button className="btn sm ghost icon" aria-label="Previous" onClick={() => step(-1)}><Icon name="chevronLeft" size={14} /></button>
            <button className="btn sm ghost icon" aria-label="Next" onClick={() => step(1)}><Icon name="chevronRight" size={14} /></button>
          </div>
          <h2 className="cal-title">{title}{view === 'week' && weekNums ? <span className="small muted"> · week {isoWeek(from + 3 * DAY)}</span> : null}</h2>
          <div className="quick-add">
            <Icon name="plus" size={14} />
            <input value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addQuick()} placeholder="Quick add: “Lunch with Ana Friday 1pm”" aria-label="Quick add an event" />
            {preview ? <span className="quick-preview small">{preview.title} · {new Date(preview.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: preview.allDay ? undefined : 'numeric', minute: preview.allDay ? undefined : '2-digit' })}{preview.rrule ? ' · repeats' : ''}</span> : null}
          </div>
          <div className="seg">
            {(['day', 'week', 'month', 'agenda', 'year'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
        </div>

        {view === 'day' || view === 'week' ? (
          <TimeGrid days={view === 'day' ? [startOfDay(cursor)] : Array.from({ length: 7 }, (_, i) => addDays(from, i))} occ={occ} colorOf={colorOf} now={now}
            onNew={newEvent} onOpen={(o) => setEditing({ event: o.event, instance: o.instance })} onMove={move} />
        ) : view === 'month' ? (
          <MonthGrid from={from} cursor={cursor} occ={occ} colorOf={colorOf} weekNums={weekNums} onNew={(t) => newEvent(t + 9 * 3_600_000)} onOpen={(o) => setEditing({ event: o.event, instance: o.instance })} onDay={(t) => { setCursor(t); setView('day'); }} />
        ) : view === 'agenda' ? (
          <Agenda occ={occ} colorOf={colorOf} onOpen={(o) => setEditing({ event: o.event, instance: o.instance })} />
        ) : (
          <div className="year-grid">
            {Array.from({ length: 12 }, (_, m) => new Date(new Date(cursor).getFullYear(), m, 1).getTime()).map((t) => (
              <div key={t} className="year-month"><div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{new Date(t).toLocaleDateString(undefined, { month: 'long' })}</div><MiniMonth cursor={t} ws={ws} compact marks={occ} onPick={(d) => { setCursor(d); setView('day'); }} /></div>
            ))}
          </div>
        )}
      </section>

      {editing ? <EventEditor event={editing.event} instance={editing.instance} calendars={cals} onClose={() => setEditing(null)} /> : null}
      {adding ? <Modal title="Calendars" onClose={() => setAdding(false)} width={620}><CalendarSources /></Modal> : null}
    </div>
  );
}

function MiniMonth({ cursor, ws, onPick, marks, compact }: { cursor: number; ws: number; onPick: (t: number) => void; marks: Occurrence[]; compact?: boolean }) {
  const first = startOfMonth(cursor);
  const start = startOfWeek(first, ws);
  const month = new Date(cursor).getMonth();
  const busy = new Set(marks.map((o) => new Date(o.start).toDateString()));
  const names = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + ((ws + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));
  return (
    <div className={`mini-month ${compact ? 'compact' : ''}`}>
      {!compact ? <div className="mini-title">{new Date(cursor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div> : null}
      <div className="mini-grid">
        {names.map((n, i) => <span key={i} className="mini-dow">{n}</span>)}
        {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => (
          <button key={d} className={`mini-day ${new Date(d).getMonth() !== month ? 'out' : ''} ${sameDay(d, Date.now()) ? 'today' : ''} ${sameDay(d, cursor) && !compact ? 'sel' : ''}`} onClick={() => onPick(d)}>
            {new Date(d).getDate()}{busy.has(new Date(d).toDateString()) && new Date(d).getMonth() === month ? <i /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeGrid({ days, occ, colorOf, now, onNew, onOpen, onMove }: {
  days: number[]; occ: Occurrence[]; colorOf: (o: Occurrence) => string; now: number;
  onNew: (t: number, allDay?: boolean) => void; onOpen: (o: Occurrence) => void; onMove: (o: Occurrence, start: number, end: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ o: Occurrence; mode: 'move' | 'resize'; y0: number; x0: number; dy: number; dday: number } | null>(null);
  const colW = useRef(0);
  // The latest drag, read when the pointer is released (outside React's state updates).
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => { scroller.current?.scrollTo({ top: HOUR_PX * 7.5 }); }, []);
  const allDay = occ.filter((o) => o.event.allDay || o.end - o.start >= DAY);
  const timed = occ.filter((o) => !o.event.allDay && o.end - o.start < DAY);
  const snap = (px: number) => Math.round((px / HOUR_PX) * 4) * 15 * 60_000;

  useEffect(() => {
    if (!drag) return;
    const mm = (e: PointerEvent) => setDrag((d) => d && { ...d, dy: e.clientY - d.y0, dday: colW.current ? Math.round((e.clientX - d.x0) / colW.current) : 0 });
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const shift = snap(d.dy);
      if (d.mode === 'move' && (shift || d.dday)) onMove(d.o, d.o.start + shift + d.dday * DAY, d.o.end + shift + d.dday * DAY);
      else if (d.mode === 'resize' && shift) onMove(d.o, d.o.start, Math.max(d.o.start + 15 * 60_000, d.o.end + shift));
      else if (Math.abs(d.dy) < 3) onOpen(d.o);
    };
    window.addEventListener('pointermove', mm);
    window.addEventListener('pointerup', up, { once: true });
    return () => window.removeEventListener('pointermove', mm);
  }, [drag !== null]);

  return (
    <div className="time-grid">
      <div className="tg-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((d) => (
          <div key={d} className={`tg-day ${sameDay(d, now) ? 'today' : ''}`}>
            <span className="small muted">{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span> <b>{new Date(d).getDate()}</b>
          </div>
        ))}
      </div>
      <div className="tg-allday" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <span className="small muted">all-day</span>
        {days.map((d) => (
          <div key={d} className="tg-allday-cell" onDoubleClick={() => onNew(d, true)}>
            {allDay.filter((o) => o.start < addDays(d, 1) && o.end > d).map((o) => (
              <button key={o.event.id + o.start} className="ev-chip" style={{ ['--ev' as string]: colorOf(o) }} onClick={() => onOpen(o)}>{o.event.title}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="tg-body" ref={scroller}>
        <div className="tg-inner" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: HOUR_PX * 24 }}>
          <div className="tg-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR_PX }}>{h ? new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }) : ''}</span>)}</div>
          {days.map((d, di) => {
            const today = timed.filter((o) => o.start < addDays(d, 1) && o.end > d);
            const lay = layout(today);
            return (
              <div key={d} className="tg-col" ref={(el) => { if (el && di === 0) colW.current = el.getBoundingClientRect().width; }}
                onDoubleClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onNew(d + snap(e.clientY - r.top)); }}>
                {Array.from({ length: 24 }, (_, h) => <i key={h} className="tg-line" style={{ top: h * HOUR_PX }} />)}
                {sameDay(d, now) ? <i className="tg-now" style={{ top: ((now - d) / 3_600_000) * HOUR_PX }} /> : null}
                {today.map((o) => {
                  const p = lay.get(o)!;
                  const s = Math.max(o.start, d);
                  const e = Math.min(o.end, addDays(d, 1));
                  const dragging = drag?.o === o;
                  const top = ((s - d) / 3_600_000) * HOUR_PX + (dragging && drag.mode === 'move' ? drag.dy : 0);
                  const height = Math.max(18, ((e - s) / 3_600_000) * HOUR_PX + (dragging && drag.mode === 'resize' ? drag.dy : 0));
                  const link = meetingLink(o.event);
                  return (
                    <div key={o.event.id + o.start} className={`ev-block ${dragging ? 'dragging' : ''} ${o.event.status === 'tentative' ? 'tentative' : ''}`}
                      style={{ top, height, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)`, ['--ev' as string]: colorOf(o), transform: dragging && drag.mode === 'move' ? `translateX(${drag.dday * colW.current}px)` : undefined }}
                      onPointerDown={(ev) => { if (ev.button !== 0) return; ev.stopPropagation(); setDrag({ o, mode: 'move', y0: ev.clientY, x0: ev.clientX, dy: 0, dday: 0 }); }}
                      title={`${o.event.title}\n${hm(o.start)} – ${hm(o.end)}${o.event.location ? `\n${o.event.location}` : ''}`}>
                      <b className="ellipsis">{o.event.title}</b>
                      {height > 34 ? <span className="small ellipsis">{hm(o.start)}{o.event.location && !link ? ` · ${o.event.location}` : ''}</span> : null}
                      {link && height > 50 ? <a className="ev-join" href={link} target="_blank" rel="noreferrer" onPointerDown={(x) => x.stopPropagation()}>Join</a> : null}
                      <span className="ev-resize" onPointerDown={(ev) => { ev.stopPropagation(); setDrag({ o, mode: 'resize', y0: ev.clientY, x0: ev.clientX, dy: 0, dday: 0 }); }} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ from, cursor, occ, colorOf, weekNums, onNew, onOpen, onDay }: { from: number; cursor: number; occ: Occurrence[]; colorOf: (o: Occurrence) => string; weekNums: boolean; onNew: (t: number) => void; onOpen: (o: Occurrence) => void; onDay: (t: number) => void }) {
  const month = new Date(cursor).getMonth();
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className={`month-grid ${weekNums ? 'weeknums' : ''}`}>
      {days.slice(0, 7).map((d) => <div key={d} className="month-dow small muted">{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</div>)}
      {days.map((d, i) => {
        const list = occ.filter((o) => o.start < addDays(d, 1) && o.end > d);
        return (
          <div key={d} className={`month-cell ${new Date(d).getMonth() !== month ? 'out' : ''} ${sameDay(d, Date.now()) ? 'today' : ''}`} onDoubleClick={() => onNew(d)}>
            <button className="month-num" onClick={() => onDay(d)}>{new Date(d).getDate()}{weekNums && i % 7 === 0 ? <span className="muted"> · W{isoWeek(d + 3 * DAY)}</span> : null}</button>
            {list.slice(0, 3).map((o) => (
              <button key={o.event.id + o.start} className={`ev-line ${o.event.allDay ? 'allday' : ''}`} style={{ ['--ev' as string]: colorOf(o) }} onClick={() => onOpen(o)}>
                {!o.event.allDay ? <i /> : null}<span className="ellipsis">{!o.event.allDay ? `${hm(o.start)} ` : ''}{o.event.title}</span>
              </button>
            ))}
            {list.length > 3 ? <button className="small muted link-like" onClick={() => onDay(d)}>{list.length - 3} more</button> : null}
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ occ, colorOf, onOpen }: { occ: Occurrence[]; colorOf: (o: Occurrence) => string; onOpen: (o: Occurrence) => void }) {
  const days = new Map<string, Occurrence[]>();
  for (const o of occ) {
    const k = new Date(o.start).toDateString();
    days.set(k, [...(days.get(k) ?? []), o]);
  }
  if (!days.size) return <div className="empty muted" style={{ padding: 40 }}>Nothing in the next two months.</div>;
  return (
    <div className="agenda">
      {[...days.entries()].map(([k, list]) => (
        <div key={k} className="agenda-day">
          <div className={`agenda-date ${k === new Date().toDateString() ? 'today' : ''}`}><b>{new Date(k).getDate()}</b><span className="small muted">{new Date(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short' })}</span></div>
          <div className="grow">
            {list.map((o) => (
              <button key={o.event.id + o.start} className="agenda-item" onClick={() => onOpen(o)}>
                <i style={{ background: colorOf(o) }} />
                <span className="agenda-time small muted">{o.event.allDay ? 'all day' : `${hm(o.start)} – ${hm(o.end)}`}</span>
                <span className="grow ellipsis"><b>{o.event.title}</b>{o.event.location ? <span className="muted"> · {o.event.location}</span> : null}</span>
                {o.event.rrule ? <Icon name="repeat" size={12} className="muted" /> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const REPEATS: { label: string; rule?: string }[] = [
  { label: 'Does not repeat' },
  { label: 'Every day', rule: 'FREQ=DAILY' },
  { label: 'Every weekday (Mon–Fri)', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every week', rule: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rule: 'FREQ=MONTHLY' },
  { label: 'Every year', rule: 'FREQ=YEARLY' },
];
const ALERTS = [{ l: 'None', m: -1 }, { l: 'At the start', m: 0 }, { l: '5 minutes before', m: 5 }, { l: '10 minutes before', m: 10 }, { l: '15 minutes before', m: 15 }, { l: '30 minutes before', m: 30 }, { l: '1 hour before', m: 60 }, { l: '1 day before', m: 1440 }];

const toLocalInput = (t: number, allDay: boolean) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return allDay ? date : `${date}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EventEditor({ event, instance, calendars, onClose }: { event: CalEvent; instance?: number; calendars: CalendarInfo[]; onClose: () => void }) {
  const { toast } = useStore();
  const [e, setE] = useState<CalEvent>({ ...event, start: instance !== undefined && event.rrule ? instance : event.start, end: instance !== undefined && event.rrule ? instance + (event.end - event.start) : event.end });
  const [people, setPeople] = useState((event.attendees ?? []).map((a) => a.email).join(', '));
  const [scope, setScope] = useState<'this' | 'all'>('this');
  const cal = calendars.find((c) => c.id === e.calendar);
  const readOnly = !!cal?.readOnly;
  const repeating = !!event.rrule || event.recurrenceId !== undefined;
  const link = meetingLink(e);
  const writable = calendars.filter((c) => !c.readOnly && !c.tasks);
  const rule = e.rrule ? parseRRule(e.rrule) : null;
  const presetIndex = REPEATS.findIndex((r) => r.rule === e.rrule || (!r.rule && !e.rrule));

  const save = async () => {
    if (!e.title.trim()) { toast('Give the event a name'); return; }
    if (e.end < e.start) { toast('The event ends before it starts'); return; }
    const attendees = people.split(/[,;\s]+/).filter((x) => x.includes('@')).map((email) => event.attendees?.find((a) => a.email === email) ?? { email, status: 'needs-action' as const, role: 'required' as const });
    try {
      const out = { ...e, attendees: attendees.length ? attendees : undefined };
      if (repeating && scope === 'this' && instance !== undefined) await api.pim.saveEvent(out, { scope: 'this', instance });
      else if (repeating && scope === 'all' && instance !== undefined && event.rrule) await api.pim.saveEvent({ ...out, start: event.start + (e.start - instance), end: event.start + (e.start - instance) + (e.end - e.start) });
      else await api.pim.saveEvent(out);
      onClose();
    } catch (err) {
      toast(clean(err));
    }
  };

  const remove = async () => {
    try {
      await api.pim.deleteEvent(event.id, { scope: repeating ? scope : 'all', instance });
      onClose();
    } catch (err) {
      toast(clean(err));
    }
  };

  return (
    <Modal title={event.id ? (readOnly ? e.title : 'Edit event') : 'New event'} onClose={onClose} width={560}>
      <div className="col event-editor" style={{ gap: 10 }} onKeyDown={(x) => { if ((x.metaKey || x.ctrlKey) && x.key === 'Enter') void save(); }}>
        <input className="input big" autoFocus={!event.id} placeholder="Event name" value={e.title} disabled={readOnly} onChange={(x) => setE({ ...e, title: x.target.value })} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={e.allDay} disabled={readOnly} onChange={(x) => { const ad = x.target.checked; setE({ ...e, allDay: ad, start: ad ? startOfDay(e.start) : startOfDay(e.start) + 9 * 3_600_000, end: ad ? addDays(startOfDay(e.start), 1) : startOfDay(e.start) + 10 * 3_600_000 }); }} /> All day</label>
          <input className="input" type={e.allDay ? 'date' : 'datetime-local'} value={toLocalInput(e.start, e.allDay)} disabled={readOnly} aria-label="Starts" onChange={(x) => { const s = new Date(x.target.value).getTime(); if (!Number.isNaN(s)) setE({ ...e, start: s, end: s + (e.end - e.start) }); }} />
          <span className="muted">to</span>
          <input className="input" type={e.allDay ? 'date' : 'datetime-local'} value={toLocalInput(e.allDay ? e.end - DAY : e.end, e.allDay)} disabled={readOnly} aria-label="Ends" onChange={(x) => { const t = new Date(x.target.value).getTime(); if (!Number.isNaN(t)) setE({ ...e, end: e.allDay ? addDays(t, 1) : t }); }} />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="input" value={presetIndex < 0 ? 'custom' : String(presetIndex)} disabled={readOnly || (repeating && scope === 'this' && instance !== undefined)} aria-label="Repeat" onChange={(x) => setE({ ...e, rrule: x.target.value === 'custom' ? e.rrule : REPEATS[Number(x.target.value)].rule })}>
            {REPEATS.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
            {presetIndex < 0 && rule ? <option value="custom">{describeRRule(rule)}</option> : null}
          </select>
          <select className="input" value={String(e.alarms?.[0]?.minutesBefore ?? -1)} disabled={readOnly} aria-label="Alert" onChange={(x) => { const m = Number(x.target.value); setE({ ...e, alarms: m < 0 ? undefined : [{ minutesBefore: m }] }); }}>
            {ALERTS.map((a) => <option key={a.m} value={a.m}>{a.l}</option>)}
          </select>
          <select className="input" value={e.calendar} disabled={readOnly || !!event.href} aria-label="Calendar" onChange={(x) => setE({ ...e, calendar: x.target.value })}>
            {(readOnly ? calendars.filter((c) => c.id === e.calendar) : writable).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <input className="input" placeholder="Place or video link" value={e.location ?? ''} disabled={readOnly} onChange={(x) => setE({ ...e, location: x.target.value || undefined })} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {link ? <a className="btn sm" href={link} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Join the meeting</a> : null}
          {e.location && !link ? <MapButtons place={{ address: e.location }} /> : null}
          {mailIdIn(e.url ?? e.description) ? <button className="btn sm" data-testid="event-open-mail" onClick={() => void api.search.open(`mail:${mailIdIn(e.url ?? e.description)}`)}><Icon name="mail" size={12} /> Open the email</button> : null}
          {event.id ? <button className="btn sm" onClick={() => void openNative('calendar', { eventUrl: event.openUrl, date: instance ?? e.start }, toast)}><Icon name="calendar" size={12} /> Open in Calendar</button> : null}
        </div>
        <input className="input" placeholder="People (email addresses; they get an invitation from your calendar server)" value={people} disabled={readOnly} onChange={(x) => setPeople(x.target.value)} />
        <textarea className="input" rows={3} placeholder="Notes" value={e.description ?? ''} disabled={readOnly} onChange={(x) => setE({ ...e, description: x.target.value || undefined })} />
        {/* What the knowledge graph links to this event: its people's mail, the meeting recording, notes written during it. */}
        {event.id ? <RelatedPanel target={{ event: event.id }} testid="event-related" /> : null}
        {repeating && event.id && !readOnly ? (
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button className={scope === 'this' ? 'on' : ''} onClick={() => setScope('this')}>This event</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All events in the series</button>
          </div>
        ) : null}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          {event.id && !readOnly ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => void remove()}><Icon name="trash" size={13} /> Delete</button> : null}
          <button className="btn" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly ? <button className="btn primary" onClick={() => void save()}>{event.id ? 'Save' : 'Add'}</button> : null}
        </div>
      </div>
    </Modal>
  );
}
