// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reminders and to-dos: a local list and the task lists of your calendar
// accounts, with due dates, priorities and a nudge when they are due.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayKey, effectiveDay, repeatLabel, stepProgress, todayTasks } from '../../core/pim/tasks';
import type { CalendarInfo, Reminder } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, PageHead, type MenuItem } from '../components/ui';
import { useHubTitle } from '../components/page-context';
import { ImportDialog } from './ImportDialog';
import { RemindersWelcome } from './PimWelcome';
import { useStore } from '../state';
import { usePimChanges } from './Mail';
import { deleteTask, projectsOf, setDone, TaskComposer, TaskDetail, UndoBar } from './tasks-ui';
import '../styles/pim.css';

const PRIORITY = ['', '!', '!!', '!!!'];
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function Reminders() {
  const { toast } = useStore();
  const hub = useHubTitle();
  const [items, setItems] = useState<Reminder[]>([]);
  const [lists, setLists] = useState<CalendarInfo[]>([]);
  const [list, setList] = useState<string>('all');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const today = dayKey(Date.now());
  // Today: planned or due today, and what was left from earlier days (carried forward).
  const todayIds = useMemo(() => new Set(todayTasks(items, today).map((r) => r.id)), [items, today]);

  const load = useCallback(() => {
    void api.pim.reminders().then((r) => { setItems(r.filter((x) => !x.id.startsWith('local:snooze-'))); setLoaded(true); });
    void api.pim.calendars().then((c) => setLists(c.filter((x) => x.tasks || x.id === 'local:calendar')));
  }, []);
  useEffect(load, [load]);
  usePimChanges(['reminders', 'calendar'], load);

  const listName = (id: string) => (id === 'local' ? 'Reminders' : lists.find((l) => l.id === id)?.name ?? 'Tasks');
  const shown = useMemo(() => items
    .filter((r) => (list === 'all' ? true : list === 'today' ? todayIds.has(r.id) : list === 'flagged' ? (r.priority ?? 0) >= 3 : r.list === list))
    .filter((r) => showDone || !r.done)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? Infinity) - (b.due ?? Infinity) || (b.priority ?? 0) - (a.priority ?? 0)), [items, list, showDone, todayIds]);

  const save = async (r: Reminder) => {
    try {
      await api.pim.saveReminder(r);
    } catch (e) {
      toast(clean(e));
    }
  };

  const listTitle = list === 'all' ? 'All reminders' : list === 'today' ? 'Today' : list === 'flagged' ? 'Important' : listName(list);
  const overdue = (r: Reminder) => !r.done && r.due !== undefined && r.due < Date.now();
  const counts = { all: items.filter((r) => !r.done).length, today: todayIds.size, flagged: items.filter((r) => !r.done && (r.priority ?? 0) >= 3).length };

  return (
    <div className="reminders" style={sel && items.some((r) => r.id === sel) ? { gridTemplateColumns: '220px 1fr 340px' } : undefined}>
      <aside className="rem-lists">
        {([['all', 'All', 'listCheck'], ['today', 'Today', 'calendar'], ['flagged', 'Important', 'flag']] as const).map(([id, label, icon]) => (
          <button key={id} className={`mail-folder ${list === id ? 'on' : ''}`} onClick={() => setList(id)}><Icon name={icon} size={15} /><span className="grow">{label}</span><span className="count">{counts[id]}</span></button>
        ))}
        <div className="small muted" style={{ fontWeight: 600, margin: '12px 8px 4px' }}>Lists</div>
        <button className={`mail-folder ${list === 'local' ? 'on' : ''}`} onClick={() => setList('local')}><i className="dot" style={{ background: '#bf5af2' }} /><span className="grow">Reminders</span><span className="count">{items.filter((r) => r.list === 'local' && !r.done).length}</span></button>
        {lists.filter((l) => l.tasks && l.id !== 'local:calendar').map((l) => (
          <button key={l.id} className={`mail-folder ${list === l.id ? 'on' : ''}`} onClick={() => setList(l.id)}><i className="dot" style={{ background: l.color }} /><span className="grow ellipsis">{l.name}</span><span className="count">{items.filter((r) => r.list === l.id && !r.done).length}</span></button>
        ))}
      </aside>
      <section className="rem-main">
        <PageHead title={listTitle} sub={hub ? `${listTitle} · ${shown.filter((r) => !r.done).length} to do` : `${shown.filter((r) => !r.done).length} to do`}>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
          <button className="btn sm ghost" title="Import and export" aria-label="Import and export" data-testid="reminders-more" onClick={(e) => setMenu({ x: e.clientX - 200, y: e.clientY + 12, items: [
            { label: 'Import tasks…', icon: 'down', run: () => setImporting(true) },
            { sep: true, label: '' },
            { label: 'Export as spreadsheet (.csv)…', icon: 'table', run: () => void api.pim.exportTasks('csv').then((r) => r && toast(`Saved ${r.count} task${r.count === 1 ? '' : 's'}`), (x) => toast(clean(x))) },
            { label: 'Export as calendar file (.ics)…', icon: 'calendar', run: () => void api.pim.exportTasks('ics').then((r) => r && toast(`Saved ${r.count} task${r.count === 1 ? '' : 's'}`), (x) => toast(clean(x))) },
          ] })}><Icon name="down" size={14} /> Import</button>
        </PageHead>
        <TaskComposer placeholder="Add a reminder — “Call the bank tomorrow 10am !! #home”" defaults={{ list: list === 'all' || list === 'today' || list === 'flagged' ? 'local' : list, priority: list === 'flagged' ? 3 : 0, plannedFor: list === 'today' ? today : undefined }} />
        <div className="rem-items">
          {shown.map((r) => (
            <div key={r.id} className={`rem-item ${r.done ? 'done' : ''}`}>
              <button className={`rem-check ${r.done ? 'on' : ''}`} aria-label={r.done ? 'Mark as not done' : 'Mark as done'} onClick={() => void setDone(r)}>{r.done ? <Icon name="check" size={12} /> : null}</button>
              <div className="grow" style={{ minWidth: 0 }}>
                {editing === r.id ? (
                  <input className="input" autoFocus defaultValue={r.title} onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== r.title) void save({ ...r, title: e.target.value.trim() }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                ) : <div className="rem-title" onClick={() => setSel(sel === r.id ? null : r.id)} onDoubleClick={() => setEditing(r.id)}>{r.priority ? <span className="rem-prio">{PRIORITY[r.priority]}</span> : null}{r.title}</div>}
                <div className="small muted">
                  {r.due !== undefined ? <span className={overdue(r) ? 'overdue' : ''}>{new Date(r.due).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span> : null}
                  {list === 'all' || list === 'today' || list === 'flagged' ? <span> · {listName(r.list)}</span> : null}
                  {effectiveDay(r, today).carriedFrom ? <span className="overdue"> · carried from {new Date(`${effectiveDay(r, today).carriedFrom}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span> : null}
                  {r.rrule ? <span> · {repeatLabel(r.rrule)}</span> : null}
                  {stepProgress(r) ? <span> · {stepProgress(r)!.done}/{stepProgress(r)!.total} steps</span> : null}
                  {r.project ? <span> · #{r.project}</span> : null}
                  {r.notes ? <span> · {r.notes}</span> : null}
                </div>
              </div>
              <input type="datetime-local" className="input rem-date" aria-label="Due" value={r.due !== undefined ? new Date(r.due - new Date(r.due).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''} onChange={(e) => void save({ ...r, due: e.target.value ? new Date(e.target.value).getTime() : undefined, remindAt: undefined })} />
              <button className="btn sm ghost icon" title="Priority" aria-label="Priority" onClick={() => void save({ ...r, priority: (((r.priority ?? 0) + 1) % 4) as Reminder['priority'] })}><Icon name="flag" size={13} style={r.priority ? { color: 'var(--warn)' } : undefined} /></button>
              <button className="btn sm ghost icon" title="Delete (Undo for a few seconds)" aria-label="Delete" onClick={() => void deleteTask(r)}><Icon name="trash" size={13} /></button>
            </div>
          ))}
          {!shown.length && loaded && !items.length ? <RemindersWelcome onNew={() => (document.querySelector('.rem-main input') as HTMLInputElement | null)?.focus()} onImport={() => setImporting(true)} /> : null}
          {!shown.length && items.length ? <div className="empty small muted" style={{ padding: 30 }}>{showDone ? 'Nothing here.' : 'All done.'}</div> : null}
        </div>
      </section>
      {sel && items.some((r) => r.id === sel) ? <aside className="planner-detail"><TaskDetail key={sel} task={items.find((r) => r.id === sel)!} today={today} projects={projectsOf(items)} onClose={() => setSel(null)} /></aside> : null}
      <UndoBar />
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} label="Import and export" /> : null}
      {importing ? <ImportDialog area="reminders" onClose={() => { setImporting(false); load(); }} /> : null}
    </div>
  );
}
