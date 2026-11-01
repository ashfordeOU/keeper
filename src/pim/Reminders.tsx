// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reminders and to-dos: a local list and the task lists of your calendar
// accounts, with due dates, priorities and a nudge when they are due.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseQuickAdd } from '../../core/pim/quickadd';
import type { CalendarInfo, Reminder } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';
import { useStore } from '../state';
import { usePimChanges } from './Mail';
import '../styles/pim.css';

const PRIORITY = ['', '!', '!!', '!!!'];
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function Reminders() {
  const { toast } = useStore();
  const [items, setItems] = useState<Reminder[]>([]);
  const [lists, setLists] = useState<CalendarInfo[]>([]);
  const [list, setList] = useState<string>('all');
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.pim.reminders().then(setItems);
    void api.pim.calendars().then((c) => setLists(c.filter((x) => x.tasks || x.id === 'local:calendar')));
  }, []);
  useEffect(load, [load]);
  usePimChanges(['reminders', 'calendar'], load);

  const listName = (id: string) => (id === 'local' ? 'Reminders' : lists.find((l) => l.id === id)?.name ?? 'Tasks');
  const shown = useMemo(() => items
    .filter((r) => (list === 'all' ? true : list === 'today' ? !r.done && r.due !== undefined && r.due < new Date().setHours(24, 0, 0, 0) : list === 'flagged' ? (r.priority ?? 0) >= 3 : r.list === list))
    .filter((r) => showDone || !r.done)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? Infinity) - (b.due ?? Infinity) || (b.priority ?? 0) - (a.priority ?? 0)), [items, list, showDone]);

  const save = async (r: Reminder) => {
    try {
      await api.pim.saveReminder(r);
    } catch (e) {
      toast(clean(e));
    }
  };

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    // "Call the bank tomorrow 10am" sets the due time too.
    const q = parseQuickAdd(t);
    const hasDate = !!q && q.title !== t;
    await save({ id: '', list: list === 'all' || list === 'today' || list === 'flagged' ? 'local' : list, title: hasDate ? q!.title : t, due: hasDate ? q!.start : undefined, done: false, priority: list === 'flagged' ? 3 : 0 });
    setText('');
  };

  const overdue = (r: Reminder) => !r.done && r.due !== undefined && r.due < Date.now();
  const counts = { all: items.filter((r) => !r.done).length, today: items.filter((r) => !r.done && r.due !== undefined && r.due < new Date().setHours(24, 0, 0, 0)).length, flagged: items.filter((r) => !r.done && (r.priority ?? 0) >= 3).length };

  return (
    <div className="reminders">
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
        <PageHead title={list === 'all' ? 'All reminders' : list === 'today' ? 'Today' : list === 'flagged' ? 'Important' : listName(list)} sub={`${shown.filter((r) => !r.done).length} to do`}>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
        </PageHead>
        <div className="rem-add">
          <Icon name="plus" size={15} />
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Add a reminder — “Call the bank tomorrow 10am”" aria-label="New reminder" />
        </div>
        <div className="rem-items">
          {shown.map((r) => (
            <div key={r.id} className={`rem-item ${r.done ? 'done' : ''}`}>
              <button className={`rem-check ${r.done ? 'on' : ''}`} aria-label={r.done ? 'Mark as not done' : 'Mark as done'} onClick={() => void save({ ...r, done: !r.done, doneAt: r.done ? undefined : Date.now() })}>{r.done ? <Icon name="check" size={12} /> : null}</button>
              <div className="grow" style={{ minWidth: 0 }}>
                {editing === r.id ? (
                  <input className="input" autoFocus defaultValue={r.title} onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== r.title) void save({ ...r, title: e.target.value.trim() }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                ) : <div className="rem-title" onClick={() => setEditing(r.id)}>{r.priority ? <span className="rem-prio">{PRIORITY[r.priority]}</span> : null}{r.title}</div>}
                <div className="small muted">
                  {r.due !== undefined ? <span className={overdue(r) ? 'overdue' : ''}>{new Date(r.due).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span> : null}
                  {list === 'all' || list === 'today' || list === 'flagged' ? <span> · {listName(r.list)}</span> : null}
                  {r.notes ? <span> · {r.notes}</span> : null}
                </div>
              </div>
              <input type="datetime-local" className="input rem-date" aria-label="Due" value={r.due !== undefined ? new Date(r.due - new Date(r.due).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''} onChange={(e) => void save({ ...r, due: e.target.value ? new Date(e.target.value).getTime() : undefined, remindAt: undefined })} />
              <button className="btn sm ghost icon" title="Priority" onClick={() => void save({ ...r, priority: (((r.priority ?? 0) + 1) % 4) as Reminder['priority'] })}><Icon name="flag" size={13} style={r.priority ? { color: 'var(--warn)' } : undefined} /></button>
              <button className="btn sm ghost icon" title="Delete" onClick={() => void api.pim.deleteReminder(r.id)}><Icon name="trash" size={13} /></button>
            </div>
          ))}
          {!shown.length ? <div className="empty small muted" style={{ padding: 30 }}>{showDone ? 'Nothing here.' : 'All done.'}</div> : null}
        </div>
      </section>
    </div>
  );
}
