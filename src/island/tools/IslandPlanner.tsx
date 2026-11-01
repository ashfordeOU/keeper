// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's planner: Tasks (Today, Inbox, Overdue, All), Week and Insights.
// The same task list as the Reminders and Planner pages; it changes by
// events from the main process, never by asking on a timer.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacReminder } from '../../../core/api-island-tools';
import { addDays, inboxTasks, overdueTasks, sortTasks, todayTasks, type Task } from '../../../core/pim/tasks';
import { api } from '../../api';
import { useFeature } from '../../features';
import { InsightsView, WeekBoard } from '../../pim/planner-views';
import { projectsOf, TaskComposer, TaskDetail, TaskList, UndoBar, useTasks, useToday } from '../../pim/tasks-ui';

type View = 'today' | 'inbox' | 'overdue' | 'all';

/** Tasks in the Island. `composeKey` changing focuses the composer (the "New task" shortcut). */
export function TasksTool({ composeKey }: { composeKey?: number }) {
  const { tasks } = useTasks();
  const today = useToday();
  const [view, setView] = useState<View>('today');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (composeKey) { setOpen(null); setView('today'); } }, [composeKey]);
  const overdue = overdueTasks(tasks);
  const lists: Record<View, Task[]> = {
    today: todayTasks(tasks, today, { withDone: true }),
    inbox: inboxTasks(tasks),
    overdue,
    all: sortTasks(tasks.filter((t) => !t.done)),
  };
  const shown = lists[view];
  const cur = open ? tasks.find((t) => t.id === open) : undefined;
  if (cur) {
    return (
      <div className="itool">
        <TaskDetail task={cur} today={today} projects={projectsOf(tasks)} onClose={() => setOpen(null)} compact />
        <UndoBar />
      </div>
    );
  }
  return (
    <div className="itool todos" data-testid="island-tasks">
      <div className="row-x" style={{ gap: 4 }}>
        {([['today', 'Today'], ['inbox', 'Inbox'], ['overdue', 'Overdue'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} className={`chip ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>{label}{lists[id].filter((t) => !t.done).length ? ` ${lists[id].filter((t) => !t.done).length}` : ''}</button>
        ))}
        <span style={{ flex: 1 }} />
        {view === 'overdue' && overdue.length ? (
          <>
            <button className="btn sm" onClick={() => void api.pim.moveTasks(overdue.map((t) => t.id), today)}>All to today</button>
            <button className="btn sm" onClick={() => void api.pim.moveTasks(overdue.map((t) => t.id), addDays(today, 1))}>To tomorrow</button>
          </>
        ) : null}
      </div>
      <TaskComposer focusKey={composeKey} defaults={view === 'today' ? { plannedFor: today } : {}} placeholder={view === 'inbox' ? 'Add to the Inbox — “ideas for the trip #travel”' : undefined} />
      <TaskList tasks={shown} today={today} onOpen={(t) => setOpen(t.id)} showDay={view !== 'today'} empty={view === 'today' ? 'Nothing left for today.' : view === 'inbox' ? 'The Inbox is empty.' : view === 'overdue' ? 'Nothing overdue.' : 'All done.'} />
      <MacReminders />
      <UndoBar />
    </div>
  );
}

/** The Mac's Reminders app, through EventKit (empty elsewhere); asked only while this is open. */
function MacReminders() {
  const [macRem, setMacRem] = useState<MacReminder[]>([]);
  const loadMac = useCallback(() => { void api.islandTools?.macReminders?.().then(setMacRem).catch(() => setMacRem([])); }, []);
  const ref = useRef(loadMac);
  ref.current = loadMac;
  useEffect(() => {
    ref.current();
    // Looked at again when the Island comes back into view, not on a timer.
    const on = () => { if (document.visibilityState === 'visible') ref.current(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!macRem.length) return null;
  return (
    <>
      <div className="muted small" style={{ marginTop: 6 }}>Reminders on this Mac</div>
      {macRem.map((r) => (
        <div key={`mac:${r.id}`} className={`todo ${r.done ? 'done' : ''}`}>
          <input type="checkbox" checked={r.done} onChange={(e) => { const done = e.target.checked; setMacRem((l) => l.map((x) => (x.id === r.id ? { ...x, done } : x))); void api.islandTools.setMacReminder(r.id, done).then((ok) => { if (!ok) loadMac(); }); }} />
          <span className="grow">{r.title}</span>
          {r.list ? <span className="muted small">{r.list}</span> : null}
          {r.due ? <span className="muted small">{new Date(r.due).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span> : null}
        </div>
      ))}
    </>
  );
}

/** The week ahead and the Inbox in the Island. */
export function WeekTool() {
  const { tasks } = useTasks();
  const today = useToday();
  const [open, setOpen] = useState<string | null>(null);
  const cur = open ? tasks.find((t) => t.id === open) : undefined;
  const [weekStart, setWeekStart] = useState(1);
  useEffect(() => { void api.pim?.prefs?.().then((p) => setWeekStart(p.weekStart)).catch(() => undefined); }, []);
  if (cur) return <div className="itool"><TaskDetail task={cur} today={today} projects={projectsOf(tasks)} onClose={() => setOpen(null)} compact /><UndoBar /></div>;
  return <div className="itool"><WeekBoard tasks={tasks} today={today} weekStart={weekStart} onOpen={(t) => setOpen(t.id)} /><UndoBar /></div>;
}

export function InsightsTool() {
  const on = useFeature('insights');
  return <div className="itool">{on ? <InsightsView compact /> : <div className="muted">Insights are switched off (Settings → Features).</div>}</div>;
}

/** Which task a focus session is for (today's open tasks); its minutes are logged on it. */
export function FocusTaskPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const on = useFeature('islandTodos');
  const { tasks } = useTasks();
  const today = useToday();
  if (!on) return null;
  const list = todayTasks(tasks, today).slice(0, 30);
  if (!list.length) return null;
  return (
    <select className="input sm" aria-label="Focus on a task" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }}>
      <option value="">No task</option>
      {list.map((t) => <option key={t.id} value={`${t.id}\t${t.title}`}>{t.title}</option>)}
    </select>
  );
}
