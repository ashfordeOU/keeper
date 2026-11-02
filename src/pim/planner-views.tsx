// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The planner's bigger views, shared by the Island and the Planner page: the
// week (seven days and the Inbox, tasks dragged between them) and Insights.

import { useCallback, useEffect, useState } from 'react';
import { hourLabel, type Insights } from '../../core/pim/insights';
import { addDays, inboxTasks, tasksByDay, weekDays, type Task } from '../../core/pim/tasks';
import { api } from '../api';
import { Icon } from '../components/Icon';
import type { WeekEvent } from '../../core/pim/week-events';
import { addTaskFromText, TASK_MIME, TaskRow } from './tasks-ui';
import { CalendarAccessRow, DayEvents, useCalendarStatus, useWeekEvents } from './week-events-ui';

/** A drop target that moves dragged tasks to a day (or to the Inbox with null). */
function useDayDrop(day: string | null) {
  const [over, setOver] = useState(false);
  return {
    over,
    bind: {
      onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(TASK_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        const id = e.dataTransfer.getData(TASK_MIME);
        if (!id) return;
        e.preventDefault();
        void api.pim.moveTasks([id], day);
      },
    },
  };
}

function DayColumn({ day, label, sub, tasks, events, today, onOpen, selected, toast }: { day: string | null; label: string; sub?: string; tasks: Task[]; events?: WeekEvent[]; today: string; onOpen?: (t: Task) => void; selected?: string | null; toast?: (t: string) => void }) {
  const drop = useDayDrop(day);
  const [text, setText] = useState('');
  return (
    <div className={`tk-day ${day === today ? 'today' : ''} ${drop.over ? 'over' : ''}`} {...drop.bind} data-day={day ?? 'inbox'}>
      <div className="tk-day-head"><span>{label}</span>{sub ? <span className="muted">{sub}</span> : null}</div>
      {events?.length ? <DayEvents events={events} toast={toast} /> : null}
      {tasks.map((t) => <TaskRow key={t.id} t={t} today={today} showDay={false} onOpen={onOpen} selected={selected === t.id} />)}
      <input className="tk-day-add" placeholder="+ Add" value={text} aria-label={`Add a task to ${label}`} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !text.trim()) return;
          // Words can still name another day; otherwise it goes on this one.
          void addTaskFromText(text.trim(), day ? { plannedFor: day } : {});
          setText('');
        }} />
    </div>
  );
}

/**
 * Seven days from the week's first day, and the Inbox; drag tasks between them.
 * Each day also lists its calendar events (read only); `island` keeps to the
 * calendars shown in the Island.
 */
export function WeekBoard({ tasks, today, weekStart = 1, onOpen, selected, showDone, island, toast }: { tasks: Task[]; today: string; weekStart?: number; onOpen?: (t: Task) => void; selected?: string | null; showDone?: boolean; island?: boolean; toast?: (t: string) => void }) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(today, weekStart, offset);
  const by = tasksByDay(tasks, days, today, { withDone: showDone });
  const evs = useWeekEvents(days, { island });
  const [status, reloadStatus] = useCalendarStatus();
  const fmt = (d: string) => new Date(`${d}T00:00`);
  return (
    <div className="tk-scope" style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
      <div className="row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn sm icon" title="Previous week" aria-label="Previous week" onClick={() => setOffset(offset - 1)}><Icon name="chevronLeft" size={11} /></button>
        <button className="btn sm" onClick={() => setOffset(0)} disabled={offset === 0}>This week</button>
        <button className="btn sm icon" title="Next week" aria-label="Next week" onClick={() => setOffset(offset + 1)}><Icon name="chevronRight" size={11} /></button>
        <span className="muted small">{fmt(days[0]).toLocaleDateString([], { day: 'numeric', month: 'short' })} – {fmt(days[6]).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
      </div>
      <CalendarAccessRow status={status} onChange={reloadStatus} toast={toast} />
      <div className="tk-week" data-testid="week-board">
        {days.map((d) => <DayColumn key={d} day={d} label={fmt(d).toLocaleDateString([], { weekday: 'short' })} sub={String(fmt(d).getDate())} tasks={by.get(d) ?? []} events={evs.get(d)} today={today} onOpen={onOpen} selected={selected} toast={toast} />)}
        <DayColumn day={null} label="Inbox" sub={String(inboxTasks(tasks).length || '')} tasks={inboxTasks(tasks)} today={today} onOpen={onOpen} selected={selected} />
      </div>
    </div>
  );
}

/** Insights, reloaded when a task is done or a focus session ends. */
export function useInsights(): Insights | null {
  const [i, setI] = useState<Insights | null>(null);
  const load = useCallback(() => void api.pim?.insights?.().then(setI).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('pim-changed', (k: string) => { if (k === 'reminders') load(); });
  }, [load]);
  return i;
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim() : `${min} min`);

/** Done today and this week, focus minutes, the last seven days and the busiest hours. */
export function InsightsView({ compact }: { compact?: boolean }) {
  const i = useInsights();
  if (!i) return <div className="muted small">Loading…</div>;
  const maxDay = Math.max(1, ...i.days.map((d) => d.tasks * 10 + d.focusMin));
  const maxHour = Math.max(1, ...i.hours);
  const empty = !i.days.some((d) => d.tasks || d.focusMin) && !i.week.tasks;
  return (
    <div className="tk-insights" data-testid="insights">
      <div className="tk-stats">
        <div className="tk-stat"><b>{i.today.tasks}</b><span>done today</span></div>
        <div className="tk-stat"><b>{i.week.tasks}</b><span>done this week</span></div>
        <div className="tk-stat"><b>{hm(Math.round(i.today.focusMin))}</b><span>focus today</span></div>
        <div className="tk-stat"><b>{hm(i.week.focusMin)}</b><span>focus this week</span></div>
      </div>
      {empty ? <div className="muted small">Check off tasks and run focus sessions; what you get done shows here. Nothing leaves this computer.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : '1fr 2fr', gap: 14 }}>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>Last 7 days{i.streak > 1 ? ` · ${i.streak}-day streak` : ''}</div>
            <div className="tk-week-bars">
              {i.days.map((d) => <div key={d.day} title={`${d.tasks} done · ${Math.round(d.focusMin)} min focus`}><i style={{ height: `${((d.tasks * 10 + d.focusMin) / maxDay) * 100}%` }} />{new Date(`${d.day}T00:00`).toLocaleDateString([], { weekday: 'narrow' })}</div>)}
            </div>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{i.peak.length ? `You get most done ${i.peak.slice(0, 2).map(hourLabel).join(' and ')}` : 'Busiest hours'}</div>
            <div className="tk-bars" aria-label="Activity by hour of day">
              {i.hours.map((v, h) => <i key={h} className={i.peak.includes(h) ? 'peak' : ''} style={{ height: `${(v / maxHour) * 100}%` }} title={`${hourLabel(h)}: ${v}`} />)}
            </div>
            <div className="tk-bars-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export const tomorrowOf = (today: string) => addDays(today, 1);
