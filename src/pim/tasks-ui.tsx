// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pieces every task view shares (the Island's Tasks, Week and Insights,
// the Reminders page and the Planner): the task list itself, kept fresh by
// change events (never by polling), a composer that reads plain words, a mic
// button for dictation, rows you can drag, swipe or delete (with Undo), and
// the detail pane.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseTask } from '../../core/pim/quickadd';
import { dayKey, effectiveDay, newStep, REPEATS, repeatLabel, reorder, stepProgress, taskDay, type Task } from '../../core/pim/tasks';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useFeature } from '../features';
import { onNewDay } from '../theme';
import '../styles/tasks.css';

export const TASK_MIME = 'application/x-keeper-task';
const PRIORITY = ['', '!', '!!', '!!!'];
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Says something in whichever window this is (the Island shows its own toast). */
export function sayTask(text: string) {
  window.dispatchEvent(new CustomEvent('island-toast', { detail: text }));
  window.dispatchEvent(new CustomEvent('tasks-toast', { detail: text }));
}

// ---------------------------------------------------------------- data

/** Every task, reloaded when the task list changes (an event from the main process). */
export function useTasks(): { tasks: Task[]; loaded: boolean; reload: () => void } {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    void api.pim?.reminders?.().then((r) => { setTasks(r.filter((x) => !x.id.startsWith('local:snooze-'))); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(() => {
    reload();
    return api.on('pim-changed', (k: string) => { if (k === 'reminders' || k === 'calendar') reload(); });
  }, [reload]);
  return { tasks, loaded, reload };
}

/** Today's date as yyyy-mm-dd, turning over at midnight (one timer, not a loop). */
export function useToday(): string {
  const [d, setD] = useState(() => dayKey(Date.now()));
  useEffect(() => onNewDay(() => setD(dayKey(Date.now()))), []);
  return d;
}

export async function saveTask(t: Task): Promise<Task | null> {
  try {
    return await api.pim.saveReminder(t);
  } catch (e) {
    sayTask(clean(e));
    return null;
  }
}

export async function setDone(t: Task, done = !t.done) {
  try {
    const r = await api.pim.completeReminder(t.id, done);
    if (done && r && !r.done && t.rrule) sayTask(`Next: ${taskDay(r) ? new Date(`${taskDay(r)}T00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : 'soon'}`);
  } catch (e) {
    sayTask(clean(e));
  }
}

/** Adds a task from plain words ("call Ana tomorrow 3pm !! #work"); defaults fill what the words leave out. */
export async function addTaskFromText(text: string, defaults: Partial<Task> = {}): Promise<Task | null> {
  const q = parseTask(text);
  if (!q) return null;
  const t: Task = { id: '', list: 'local', done: false, ...defaults, title: q.title, created: Date.now() };
  if (q.priority) t.priority = q.priority;
  if (q.project) t.project = q.project;
  if (q.rrule) t.rrule = q.rrule;
  if (q.plannedFor) t.plannedFor = q.plannedFor;
  if (q.due !== undefined) t.due = q.due;
  return saveTask(t);
}

// ---------------------------------------------------------------- deleting, with Undo

const UNDO_EVENT = 'tasks-deleted';

/** Deletes a task and offers Undo for a few seconds. */
export async function deleteTask(t: Task) {
  try {
    await api.pim.deleteReminder(t.id);
    window.dispatchEvent(new CustomEvent(UNDO_EVENT, { detail: t }));
  } catch (e) {
    sayTask(clean(e));
  }
}

/** The "Deleted … Undo" bar; put one in each window that shows tasks. */
export function UndoBar() {
  const [last, setLast] = useState<Task | null>(null);
  useEffect(() => {
    let t: number | undefined;
    const on = (e: Event) => {
      setLast((e as CustomEvent<Task>).detail);
      window.clearTimeout(t);
      t = window.setTimeout(() => setLast(null), 6000);
    };
    window.addEventListener(UNDO_EVENT, on);
    return () => { window.removeEventListener(UNDO_EVENT, on); window.clearTimeout(t); };
  }, []);
  if (!last) return null;
  return (
    <div className="tk-undo" role="status">
      <span className="ellipsis">Deleted “{last.title}”</span>
      {/* Put back as a new copy on the server (the old one is gone there), with the same id here. */}
      <button className="btn sm" onClick={() => { const t = last; setLast(null); void saveTask({ ...t, href: undefined, etag: undefined }); }}>Undo</button>
    </div>
  );
}

// ---------------------------------------------------------------- composer

/** Starts dictation (Settings → Dictation) into the field: the words land where the cursor is. */
export function MicButton({ target }: { target: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null> }) {
  const on = useFeature('dictation');
  const [live, setLive] = useState(false);
  useEffect(() => (on ? api.on('voice-state', (s: { phase: string }) => setLive(s.phase !== 'idle')) : undefined), [on]);
  if (!on || !api.voice) return null;
  return (
    <button type="button" className={`btn sm icon tk-mic ${live ? 'on' : ''}`} title={live ? 'Stop dictating' : 'Dictate'} aria-label={live ? 'Stop dictating' : 'Dictate'} aria-pressed={live}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { target.current?.focus(); void (live ? api.voice.stop() : api.voice.start('toggle')).catch((e: unknown) => sayTask(clean(e))); }}>
      <Icon name="mic" size={12} />
    </button>
  );
}

/** What the words will set, shown under the composer as you type. */
function Preview({ text }: { text: string }) {
  const q = useMemo(() => (text.trim() ? parseTask(text) : null), [text]);
  if (!q || (!q.plannedFor && !q.priority && !q.project && !q.rrule)) return null;
  return (
    <div className="tk-preview small">
      {q.plannedFor ? <span className="tk-chip"><Icon name="calendar" size={10} /> {dayLabel(q.plannedFor, dayKey(Date.now()))}{q.due !== undefined ? ` ${new Date(q.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span> : null}
      {q.rrule ? <span className="tk-chip"><Icon name="repeat" size={10} /> {repeatLabel(q.rrule)}</span> : null}
      {q.priority ? <span className="tk-chip prio">{PRIORITY[q.priority]}</span> : null}
      {q.project ? <span className="tk-chip">#{q.project}</span> : null}
    </div>
  );
}

/**
 * The new-task field: plain words ("pay rent friday !! #home", "stretch every
 * day 9am"), a preview of what they set, and a mic. `focusKey` changing
 * focuses it (the "New task" shortcut).
 */
export function TaskComposer({ defaults, placeholder, focusKey, onAdded, autoFocus }: { defaults?: Partial<Task>; placeholder?: string; focusKey?: unknown; onAdded?: (t: Task) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusKey) ref.current?.focus(); }, [focusKey]);
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const r = await addTaskFromText(t, defaults);
    if (r) onAdded?.(r);
  };
  return (
    <div className="tk-composer">
      <div className="tk-add">
        <Icon name="plus" size={13} />
        <input ref={ref} value={text} autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } if (e.key === 'Escape') setText(''); }}
          placeholder={placeholder ?? 'Add a task — “call Ana tomorrow 3pm !! #work”'} aria-label="New task" data-testid="task-composer" />
        <MicButton target={ref} />
      </div>
      <Preview text={text} />
    </div>
  );
}

// ---------------------------------------------------------------- rows

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const d = new Date(`${day}T00:00`);
  const t = new Date(`${today}T00:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

/** A row: check, title and what matters about it; drag to reorder or to a day, swipe or press Delete to remove. */
export function TaskRow({ t, today, selected, onOpen, onDropBefore, showDay = true, extra }: {
  t: Task; today: string; selected?: boolean; onOpen?: (t: Task) => void; onDropBefore?: (id: string, beforeId: string) => void; showDay?: boolean; extra?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [dx, setDx] = useState(0);
  const swipe = useRef<{ x: number; id: number } | null>(null);
  const wheel = useRef({ sum: 0, at: 0 });
  const eff = effectiveDay(t, today);
  const day = taskDay(t);
  const steps = stepProgress(t);
  const overdue = !t.done && ((t.due !== undefined && t.due < Date.now()) || !!eff.carriedFrom);
  const remove = () => { setDx(0); void deleteTask(t); };
  return (
    <div
      className={`tk-row ${t.done ? 'done' : ''} ${selected ? 'sel' : ''} ${over ? 'over' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      tabIndex={0}
      draggable
      data-task={t.id}
      onDragStart={(e) => { e.dataTransfer.setData(TASK_MIME, t.id); e.dataTransfer.setData('text/plain', t.title); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (onDropBefore && e.dataTransfer.types.includes(TASK_MIME)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { const id = e.dataTransfer.getData(TASK_MIME); setOver(false); if (onDropBefore && id && id !== t.id) { e.preventDefault(); e.stopPropagation(); onDropBefore(id, t.id); } }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
        else if (e.key === ' ') { e.preventDefault(); void setDone(t); }
        else if (e.key === 'Enter') onOpen?.(t);
      }}
      // A two-finger swipe to the left on a trackpad deletes (with Undo).
      onWheel={(e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        const w = wheel.current;
        if (e.timeStamp - w.at > 300) w.sum = 0;
        w.at = e.timeStamp;
        w.sum += e.deltaX;
        setDx(Math.max(-90, Math.min(0, -w.sum)));
        if (w.sum > 160) { w.sum = 0; remove(); }
        else window.setTimeout(() => { if (e.timeStamp === wheel.current.at) setDx(0); }, 350);
      }}
      // A finger swipe on a touch screen does the same.
      onPointerDown={(e) => { if (e.pointerType === 'touch') swipe.current = { x: e.clientX, id: e.pointerId }; }}
      onPointerMove={(e) => { if (swipe.current?.id === e.pointerId) setDx(Math.min(0, e.clientX - swipe.current.x)); }}
      onPointerUp={() => { if (swipe.current) { swipe.current = null; if (dx < -90) remove(); else setDx(0); } }}
    >
      <button className={`tk-check ${t.done ? 'on' : ''}`} aria-label={t.done ? 'Mark as not done' : 'Mark as done'} onClick={(e) => { e.stopPropagation(); void setDone(t); }}>{t.done ? <Icon name="check" size={10} /> : null}</button>
      <div className="tk-main" onClick={() => onOpen?.(t)}>
        <div className="tk-title">{t.priority ? <span className="tk-prio">{PRIORITY[t.priority]}</span> : null}{t.title}</div>
        <div className="tk-meta small">
          {showDay && day ? <span className={overdue ? 'tk-late' : ''}>{eff.carriedFrom ? `from ${dayLabel(eff.carriedFrom, today)}` : dayLabel(day, today)}{t.due !== undefined ? ` ${new Date(t.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
            : !showDay && t.due !== undefined ? <span className={overdue ? 'tk-late' : ''}>{new Date(t.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              : !showDay && eff.carriedFrom ? <span className="tk-late">from {dayLabel(eff.carriedFrom, today)}</span> : null}
          {t.rrule ? <span title={repeatLabel(t.rrule)}><Icon name="repeat" size={10} /></span> : null}
          {steps ? <span>{steps.done}/{steps.total}</span> : null}
          {t.project ? <span className="tk-proj">#{t.project}</span> : null}
          {t.notes ? <span title={t.notes}><Icon name="note" size={10} /></span> : null}
          {extra}
        </div>
      </div>
      <button className="btn sm icon tk-del" title="Delete (Undo for a few seconds)" aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(); }}><Icon name="close" size={10} /></button>
    </div>
  );
}

/** A list of rows that can be put in order by dragging. */
export function TaskList({ tasks, today, selected, onOpen, showDay, empty }: { tasks: Task[]; today: string; selected?: string | null; onOpen?: (t: Task) => void; showDay?: boolean; empty?: React.ReactNode }) {
  const dropBefore = (id: string, beforeId: string) => {
    const moving = tasks.find((x) => x.id === id);
    if (!moving) return;
    void api.pim.reorderTasks(reorder(tasks, id, beforeId).map((x) => ({ id: x.id, order: x.order! })));
  };
  if (!tasks.length) return <div className="tk-empty muted small">{empty ?? 'Nothing here.'}</div>;
  return <div className="tk-list">{tasks.map((t) => <TaskRow key={t.id} t={t} today={today} selected={selected === t.id} onOpen={onOpen} onDropBefore={dropBefore} showDay={showDay} />)}</div>;
}

// ---------------------------------------------------------------- detail

const toLocalInput = (t?: number) => (t === undefined ? '' : new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16));

/** Everything about one task: notes, steps, project, repeat, planned day, due time, importance. */
export function TaskDetail({ task, today, projects = [], onClose, compact }: { task: Task; today: string; projects?: string[]; onClose?: () => void; compact?: boolean }) {
  const [t, setT] = useState(task);
  const [step, setStep] = useState('');
  useEffect(() => setT(task), [task]);
  const put = (patch: Partial<Task>) => {
    const next = { ...t, ...patch };
    setT(next);
    void saveTask(next);
  };
  const steps = t.steps ?? [];
  const repeatKnown = REPEATS.some((r) => r.rrule === (t.rrule ?? ''));
  const focusMin = (t.focus ?? []).reduce((n, f) => n + f.minutes, 0);
  const focusOn = useFeature('focus');
  return (
    <div className={`tk-detail ${compact ? 'compact' : ''}`} data-testid="task-detail">
      <div className="tk-detail-head">
        <button className={`tk-check ${t.done ? 'on' : ''}`} aria-label={t.done ? 'Mark as not done' : 'Mark as done'} onClick={() => void setDone(t)}>{t.done ? <Icon name="check" size={10} /> : null}</button>
        <input className="input tk-detail-title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} onBlur={() => t.title.trim() && t.title !== task.title && put({ title: t.title.trim() })} aria-label="Title" />
        {onClose ? <button className="btn sm icon" title="Close" aria-label="Close" onClick={onClose}><Icon name="close" size={11} /></button> : null}
      </div>

      <div className="tk-field">
        <span className="tk-label">Day</span>
        <div className="tk-days">
          <button className={`chip ${t.plannedFor === today ? 'on' : ''}`} onClick={() => put({ plannedFor: today })}>Today</button>
          <button className={`chip ${t.plannedFor === nextDay(today) ? 'on' : ''}`} onClick={() => put({ plannedFor: nextDay(today) })}>Tomorrow</button>
          <button className={`chip ${!t.plannedFor ? 'on' : ''}`} onClick={() => { const { plannedFor: _p, ...rest } = t; setT(rest); void saveTask(rest); }}>None</button>
          <input type="date" className="input sm" aria-label="Planned day" value={t.plannedFor ?? ''} onChange={(e) => (e.target.value ? put({ plannedFor: e.target.value }) : undefined)} />
        </div>
      </div>
      <div className="tk-field">
        <span className="tk-label">Due</span>
        <input type="datetime-local" className="input sm" aria-label="Due" value={toLocalInput(t.due)} onChange={(e) => put({ due: e.target.value ? new Date(e.target.value).getTime() : undefined, remindAt: undefined })} />
      </div>
      <div className="tk-field">
        <span className="tk-label">Repeat</span>
        <select className="input sm" aria-label="Repeat" value={repeatKnown ? t.rrule ?? '' : t.rrule} onChange={(e) => {
          const rrule = e.target.value || undefined;
          // A repeat counts from a day: today when the task has none.
          put({ rrule, plannedFor: rrule && !t.plannedFor && t.due === undefined ? today : t.plannedFor });
        }}>
          {REPEATS.map((r) => <option key={r.label} value={r.rrule}>{r.label}</option>)}
          {!repeatKnown ? <option value={t.rrule}>{repeatLabel(t.rrule)}</option> : null}
        </select>
      </div>
      <div className="tk-field">
        <span className="tk-label">Project</span>
        <input className="input sm" list="tk-projects" placeholder="none" value={t.project ?? ''} onChange={(e) => setT({ ...t, project: e.target.value.replace(/^#/, '') || undefined })} onBlur={() => t.project !== task.project && put({ project: t.project?.trim() || undefined })} aria-label="Project" />
        <datalist id="tk-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <div className="tk-field">
        <span className="tk-label">Importance</span>
        <div className="tk-days">{[0, 1, 2, 3].map((p) => <button key={p} className={`chip ${(t.priority ?? 0) === p ? 'on' : ''}`} onClick={() => put({ priority: p as Task['priority'] })}>{p ? PRIORITY[p] : 'None'}</button>)}</div>
      </div>

      <div className="tk-steps">
        <span className="tk-label">Steps{steps.length ? ` · ${steps.filter((s) => s.done).length}/${steps.length}` : ''}</span>
        {steps.map((s, i) => (
          <div key={s.id} className={`tk-step ${s.done ? 'done' : ''}`}>
            <input type="checkbox" checked={s.done} onChange={(e) => put({ steps: steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)) })} aria-label={`Step ${i + 1} done`} />
            <input className="tk-step-title" defaultValue={s.title} onBlur={(e) => e.target.value.trim() !== s.title && put({ steps: e.target.value.trim() ? steps.map((x) => (x.id === s.id ? { ...x, title: e.target.value.trim() } : x)) : steps.filter((x) => x.id !== s.id) })} aria-label={`Step ${i + 1}`} />
            <button className="btn sm icon" title="Remove step" aria-label="Remove step" onClick={() => put({ steps: steps.filter((x) => x.id !== s.id) })}><Icon name="close" size={9} /></button>
          </div>
        ))}
        <input className="input sm" placeholder="Add a step and press Return" value={step} onChange={(e) => setStep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && step.trim()) { put({ steps: [...steps, newStep(step.trim())] }); setStep(''); } }} aria-label="New step" />
      </div>

      <textarea className="input tk-notes" placeholder="Notes" value={t.notes ?? ''} onChange={(e) => setT({ ...t, notes: e.target.value })} onBlur={() => (t.notes ?? '') !== (task.notes ?? '') && put({ notes: t.notes || undefined })} aria-label="Notes" />

      <div className="tk-detail-foot small muted">
        {focusMin ? <span><Icon name="timer" size={10} /> {focusMin} min of focus</span> : null}
        {t.created ? <span>Added {new Date(t.created).toLocaleDateString()}</span> : null}
        <span className="grow" />
        {focusOn && !t.done ? <button className="btn sm" title="A 25-minute focus session for this task; the time is logged on it" onClick={() => void api.island.focus('start', 25, { taskId: t.id, taskTitle: t.title }).then(() => sayTask('Focusing for 25 minutes'))}><Icon name="timer" size={11} /> Focus</button> : null}
        <button className="btn sm" onClick={() => { void deleteTask(t); onClose?.(); }}><Icon name="trash" size={11} /> Delete</button>
      </div>
    </div>
  );
}

const nextDay = (d: string) => { const x = new Date(`${d}T00:00`); x.setDate(x.getDate() + 1); return dayKey(x); };

/** Projects in use, for suggestions. */
export function projectsOf(tasks: Task[]): string[] {
  return [...new Set(tasks.map((t) => t.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b));
}
