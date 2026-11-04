// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Planner: the task list as days. Today (with unfinished tasks carried
// forward), the week, the Inbox of undated tasks, Upcoming, Overdue (moved
// to today or tomorrow in one go), projects and Insights, with a detail pane
// for the task you pick. The same tasks as the Reminders page and the Island.

import { useEffect, useMemo, useState } from 'react';
import { addDays, inboxTasks, overdueTasks, sortTasks, taskDay, todayTasks, upcomingTasks, type Task } from '../../core/pim/tasks';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';
import { useHubTitle } from '../components/page-context';
import { useFeature } from '../features';
import { useStore } from '../state';
import { InsightsView, WeekBoard } from './planner-views';
import { dayLabel, projectsOf, TaskComposer, TaskDetail, TaskList, UndoBar, useTasks, useToday } from './tasks-ui';
import '../styles/pim.css';

type View = 'today' | 'week' | 'inbox' | 'upcoming' | 'overdue' | 'insights' | `project:${string}`;

export function Planner({ initial }: { initial?: string }) {
  const { tasks, loaded } = useTasks();
  const today = useToday();
  const insightsOn = useFeature('insights');
  // A tab of Tasks: the page's title is Tasks, so the view's own name leads the line under it.
  const hub = useHubTitle();
  const { toast } = useStore();
  const [view, setView] = useState<View>(initial && !initial.startsWith('task:') && initial !== 'new' ? (initial as View) : 'today');
  const [sel, setSel] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(1);
  const [composeKey, setComposeKey] = useState(0);
  useEffect(() => { void api.pim.prefs().then((p) => setWeekStart(p.weekStart)).catch(() => undefined); }, []);
  // "task:<id>" opens one task (from Home's Today) on the Today view.
  useEffect(() => { if (initial === 'new') { setView('today'); setComposeKey(Date.now()); } else if (initial?.startsWith('task:')) { setView('today'); setSel(initial.slice(5)); } else if (initial) setView(initial as View); }, [initial]);

  const projects = projectsOf(tasks);
  const overdue = useMemo(() => overdueTasks(tasks), [tasks]);
  const counts = {
    today: todayTasks(tasks, today).length,
    inbox: inboxTasks(tasks).length,
    upcoming: upcomingTasks(tasks, today).length,
    overdue: overdue.length,
  };
  const selected = sel ? tasks.find((t) => t.id === sel) : undefined;
  const open = (t: Task) => setSel(t.id === sel ? null : t.id);

  const nav = (id: View, label: string, icon: string, count?: number) => (
    <button key={id} className={`mail-folder ${view === id ? 'on' : ''}`} onClick={() => setView(id)}><Icon name={icon} size={15} /><span className="grow ellipsis">{label}</span>{count ? <span className="count">{count}</span> : null}</button>
  );

  let body: React.ReactNode;
  let title = 'Today';
  let sub: React.ReactNode = null;
  if (view === 'today') {
    const list = todayTasks(tasks, today, { withDone: true });
    sub = `${list.filter((t) => !t.done).length} to do${list.some((t) => t.done) ? ` · ${list.filter((t) => t.done).length} done` : ''}`;
    body = <><TaskComposer defaults={{ plannedFor: today }} focusKey={composeKey} /><TaskList tasks={list} today={today} selected={sel} onOpen={open} showDay={false} empty="Nothing left for today. Plan something, or enjoy it." /></>;
  } else if (view === 'week') {
    title = 'Week';
    body = <WeekBoard tasks={tasks} today={today} weekStart={weekStart} onOpen={open} selected={sel} showDone toast={toast} />;
  } else if (view === 'inbox') {
    title = 'Inbox';
    sub = 'Tasks without a day. Drag them onto a day in the week, or give them one.';
    body = <><TaskComposer placeholder="Capture anything — “ideas for the trip #travel”" /><TaskList tasks={inboxTasks(tasks)} today={today} selected={sel} onOpen={open} empty="The Inbox is empty." /></>;
  } else if (view === 'upcoming') {
    title = 'Upcoming';
    sub = 'The next two weeks';
    const list = upcomingTasks(tasks, today);
    const days = [...new Set(list.map((t) => taskDay(t)!))];
    body = days.length ? days.map((d) => (
      <div key={d} style={{ marginBottom: 12 }}>
        <div className="small muted" style={{ fontWeight: 600, margin: '8px 0 2px' }}>{dayLabel(d, today)}</div>
        <TaskList tasks={list.filter((t) => taskDay(t) === d)} today={today} selected={sel} onOpen={open} showDay={false} />
      </div>
    )) : <div className="tk-empty muted small">Nothing planned for the next two weeks.</div>;
  } else if (view === 'overdue') {
    title = 'Overdue';
    sub = overdue.length ? `${overdue.length} left from earlier` : undefined;
    body = (
      <>
        {overdue.length ? (
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <button className="btn sm primary" data-testid="overdue-today" onClick={() => void api.pim.moveTasks(overdue.map((t) => t.id), today)}>Reschedule all to today</button>
            <button className="btn sm" onClick={() => void api.pim.moveTasks(overdue.map((t) => t.id), addDays(today, 1))}>Reschedule all to tomorrow</button>
          </div>
        ) : null}
        <TaskList tasks={overdue} today={today} selected={sel} onOpen={open} empty="Nothing overdue." />
      </>
    );
  } else if (view === 'insights') {
    title = 'Insights';
    sub = 'Kept on this computer only';
    body = insightsOn ? <InsightsView /> : <div className="muted">Insights are switched off in Settings → Features.</div>;
  } else {
    const p = view.slice(8);
    title = `#${p}`;
    const list = sortTasks(tasks.filter((t) => t.project === p && !t.done));
    sub = `${list.length} to do`;
    body = <><TaskComposer defaults={{ project: p }} /><TaskList tasks={list} today={today} selected={sel} onOpen={open} empty="Nothing open in this project." /></>;
  }

  return (
    <div className="reminders planner" style={{ gridTemplateColumns: selected ? '220px 1fr 340px' : undefined }} data-testid="planner">
      <aside className="rem-lists">
        {nav('today', 'Today', 'sun', counts.today)}
        {nav('week', 'Week', 'columns')}
        {nav('inbox', 'Inbox', 'inbox', counts.inbox)}
        {nav('upcoming', 'Upcoming', 'calendar', counts.upcoming)}
        {nav('overdue', 'Overdue', 'warning', counts.overdue)}
        {insightsOn ? nav('insights', 'Insights', 'chart') : null}
        {projects.length ? <div className="small muted" style={{ fontWeight: 600, margin: '12px 8px 4px' }}>Projects</div> : null}
        {projects.map((p) => nav(`project:${p}`, `#${p}`, 'tag', tasks.filter((t) => t.project === p && !t.done).length))}
      </aside>
      <section className="rem-main tk-scope">
        <PageHead title={title} sub={hub ? <>{title}{sub ? <> · {sub}</> : null}</> : sub} />
        {loaded ? body : null}
      </section>
      {selected ? <aside className="planner-detail"><TaskDetail key={selected.id} task={selected} today={today} projects={projects} onClose={() => setSel(null)} /></aside> : null}
      <UndoBar />
    </div>
  );
}
