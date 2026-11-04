// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Bringing tasks in from other apps and taking them out again: plain CSV (any
// app's columns), Todoist's CSV and JSON, Google Tasks, Microsoft To Do,
// Apple Reminders (as read on a Mac) and iCalendar VTODO; out as CSV or .ics.
// Each importer turns the app's own shape into Keeper's task (core/pim/types.ts).
// Lists become the task's project tag, sub-tasks become steps.

import { dayKey, parseTodos, serializeTodo } from './ical';
import type { Reminder, TaskStep } from './types';

// ---------------------------------------------------------------- CSV

/** RFC 4180 CSV (quotes, doubled quotes, new lines inside quotes; commas, semicolons or tabs). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length;
  const sep = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | undefined)[][]): string {
  const cell = (v: string | number | undefined) => {
    const s = v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Rows as objects keyed by their lower-case header. */
export function csvRecords(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const pick = (r: Record<string, string>, names: string[]) => {
  for (const n of names) if (r[n]) return r[n];
  return undefined;
};

/** A date written by another app: ISO, "2026-03-04 14:30", "03/04/2026", "4 Mar 2026"; all-day dates at 09:00 local. */
export function parseLooseDate(s: string | undefined, opts: { dayFirst?: boolean } = {}): { t: number; allDay: boolean } | undefined {
  if (!s) return undefined;
  const v = s.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { t: new Date(+m[1], +m[2] - 1, +m[3], 9).getTime(), allDay: true };
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return { t: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime(), allDay: false };
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    const dayFirst = opts.dayFirst ?? (a > 12 || v.includes('.'));
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return { t: new Date(+m[3], mo - 1, d, m[4] ? +m[4] : 9, m[5] ? +m[5] : 0).getTime(), allDay: !m[4] };
  }
  const t = Date.parse(v);
  if (Number.isFinite(t)) return { t, allDay: !/\d:\d/.test(v) };
  return undefined;
}

const truthy = (v?: string) => !!v && /^(1|true|yes|y|x|done|completed|complete|checked)$/i.test(v.trim());

function priorityOf(v?: string): Reminder['priority'] {
  if (!v) return 0;
  const s = v.trim().toLowerCase();
  if (/^(high|urgent|!!!|important|p1)$/.test(s)) return 3;
  if (/^(medium|normal|!!|p2)$/.test(s)) return 2;
  if (/^(low|!|p3)$/.test(s)) return 1;
  return 0;
}

let seq = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

/** A task as Keeper keeps it, from the pieces an importer found. */
export function makeTask(p: { title: string; notes?: string; due?: { t: number; allDay: boolean }; done?: boolean; doneAt?: number; priority?: Reminder['priority']; project?: string; rrule?: string; steps?: TaskStep[]; created?: number; source?: string; uid?: string }): Reminder {
  const id = `local:${newId('imp')}`;
  const t: Reminder = { id, list: 'local', title: p.title.trim() || '(no title)', done: !!p.done };
  if (p.notes?.trim()) t.notes = p.notes.trim();
  if (p.due) {
    if (p.due.allDay) t.plannedFor = dayKey(p.due.t);
    else t.due = p.due.t;
  }
  if (p.done) t.doneAt = p.doneAt ?? Date.now();
  if (p.priority) t.priority = p.priority;
  if (p.project?.trim()) t.project = p.project.trim();
  if (p.rrule) t.rrule = p.rrule;
  if (p.steps?.length) t.steps = p.steps;
  t.created = p.created ?? Date.now();
  t.uid = p.uid ?? id.slice(6);
  return t;
}

/**
 * Tasks from any app's CSV: the columns are found by their names (Title,
 * Task, Name, Subject, Content; Notes, Description; Due, Due date, Date;
 * Priority; List, Project, Folder; Done, Completed, Status; Steps).
 */
export function tasksFromCsv(text: string): Reminder[] {
  const recs = csvRecords(text);
  if (recs.length && 'type' in recs[0] && 'content' in recs[0]) return tasksFromTodoistCsv(text);
  return recs.flatMap((r) => {
    const title = pick(r, ['title', 'task', 'name', 'subject', 'content', 'task name', 'todo', 'to do', 'summary']);
    if (!title) return [];
    const status = pick(r, ['status', 'state']);
    const done = truthy(pick(r, ['done', 'completed', 'complete', 'is completed', 'checked'])) || /^(done|completed|complete|closed)$/i.test(status ?? '');
    const steps = pick(r, ['steps', 'subtasks', 'checklist'])?.split(/\s*[|;\n]\s*/).filter(Boolean).map((s, i) => ({ id: `s${i}`, title: s.replace(/^\[[ x]\]\s*/i, ''), done: /^\[x\]/i.test(s) }));
    return [makeTask({
      title, notes: pick(r, ['notes', 'note', 'description', 'details', 'body']), done,
      due: parseLooseDate(pick(r, ['due', 'due date', 'due_date', 'duedate', 'date', 'deadline', 'when'])),
      priority: priorityOf(pick(r, ['priority', 'importance'])), project: pick(r, ['list', 'project', 'folder', 'category', 'tags', 'area']),
      steps,
    })];
  });
}

/**
 * Todoist's CSV export (TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, DATE…):
 * tasks one level in are steps of the task above; priority 4 is the highest.
 */
export function tasksFromTodoistCsv(text: string, project?: string): Reminder[] {
  const out: Reminder[] = [];
  let section: string | undefined;
  for (const r of csvRecords(text)) {
    const type = (r.type ?? '').toLowerCase();
    if (type === 'section') { section = r.content; continue; }
    if (type !== 'task') continue;
    const indent = Number(r.indent || 1);
    const title = cleanTodoist(r.content ?? '');
    if (indent > 1 && out.length) {
      const parent = out[out.length - 1];
      parent.steps = [...(parent.steps ?? []), { id: `s${parent.steps?.length ?? 0}`, title, done: false }];
      continue;
    }
    const p = Number(r.priority || 1);
    out.push(makeTask({ title, notes: r.description, due: parseLooseDate(r.date), priority: p >= 4 ? 3 : p === 3 ? 2 : p === 2 ? 1 : 0, project: project ?? section, rrule: repeatFromWords(r.date) }));
  }
  return out;
}

/** Todoist's markdown links and labels ("Call [Ana](tel:..) @phone") as plain words. */
function cleanTodoist(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s@[\w-]+/g, '').trim();
}

/** "every day", "every week", "every monday", "every month", "every year" → a repeat rule. */
export function repeatFromWords(s?: string): string | undefined {
  if (!s) return undefined;
  const v = s.toLowerCase();
  if (!/\bevery\b/.test(v)) return undefined;
  const days: Record<string, string> = { monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA', sunday: 'SU' };
  const named = Object.entries(days).filter(([d]) => v.includes(d)).map(([, c]) => c);
  if (named.length) return `FREQ=WEEKLY;BYDAY=${named.join(',')}`;
  if (/every (work|week)day/.test(v)) return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (/every day|daily/.test(v)) return 'FREQ=DAILY';
  if (/every (other|2) weeks?/.test(v)) return 'FREQ=WEEKLY;INTERVAL=2';
  if (/every week|weekly/.test(v)) return 'FREQ=WEEKLY';
  if (/every month|monthly/.test(v)) return 'FREQ=MONTHLY';
  if (/every year|yearly|annually/.test(v)) return 'FREQ=YEARLY';
  return undefined;
}

// ---------------------------------------------------------------- Todoist (API and JSON backup)

interface TodoistTask { id: string | number; content: string; description?: string; priority?: number; project_id?: string | number; parent_id?: string | number | null; checked?: boolean; is_completed?: boolean; completed_at?: string; due?: { date?: string; datetime?: string; string?: string; is_recurring?: boolean } | null; added_at?: string; created_at?: string }

/** Tasks from Todoist's API (or a JSON backup of it): projects become tags, sub-tasks become steps. */
export function tasksFromTodoist(tasks: TodoistTask[], projects: { id: string | number; name: string }[] = []): Reminder[] {
  const pname = new Map(projects.map((p) => [String(p.id), p.name]));
  const byId = new Map<string, Reminder>();
  const out: Reminder[] = [];
  const kids = tasks.filter((t) => t.parent_id);
  for (const t of tasks.filter((x) => !x.parent_id)) {
    const p = t.priority ?? 1;
    const dueRaw = t.due?.datetime ?? t.due?.date;
    const r = makeTask({
      title: cleanTodoist(t.content), notes: t.description, done: !!(t.checked ?? t.is_completed), doneAt: t.completed_at ? Date.parse(t.completed_at) : undefined,
      due: dueRaw ? (/T\d/.test(dueRaw) ? { t: Date.parse(dueRaw), allDay: false } : parseLooseDate(dueRaw)) : undefined,
      priority: p >= 4 ? 3 : p === 3 ? 2 : p === 2 ? 1 : 0, project: pname.get(String(t.project_id)),
      rrule: t.due?.is_recurring ? repeatFromWords(t.due.string) : undefined, created: Date.parse(t.added_at ?? t.created_at ?? '') || undefined, uid: `todoist-${t.id}`,
    });
    byId.set(String(t.id), r);
    out.push(r);
  }
  for (const k of kids) {
    const parent = byId.get(String(k.parent_id));
    if (parent) parent.steps = [...(parent.steps ?? []), { id: `t${k.id}`, title: cleanTodoist(k.content), done: !!(k.checked ?? k.is_completed) }];
  }
  return out;
}

// ---------------------------------------------------------------- Google Tasks

interface GoogleTask { id: string; title?: string; notes?: string; status?: 'needsAction' | 'completed'; due?: string; completed?: string; parent?: string; deleted?: boolean; hidden?: boolean; updated?: string }

/**
 * Tasks from Google Tasks (tasks.list for each list). Google keeps only the
 * date of "due" (midnight UTC), so it becomes the day it is planned for.
 */
export function tasksFromGoogle(lists: { title: string; items: GoogleTask[] }[]): Reminder[] {
  const out: Reminder[] = [];
  for (const l of lists) {
    const byId = new Map<string, Reminder>();
    const items = l.items.filter((t) => !t.deleted && (t.title ?? '').trim());
    for (const t of items.filter((x) => !x.parent)) {
      const d = t.due?.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const r = makeTask({ title: t.title!, notes: t.notes, done: t.status === 'completed', doneAt: t.completed ? Date.parse(t.completed) : undefined, due: d ? { t: new Date(+d[1], +d[2] - 1, +d[3], 9).getTime(), allDay: true } : undefined, project: l.title, uid: `gtask-${t.id}` });
      byId.set(t.id, r);
      out.push(r);
    }
    for (const t of items.filter((x) => x.parent)) {
      const p = byId.get(t.parent!);
      if (p) p.steps = [...(p.steps ?? []), { id: `g${t.id.slice(0, 12)}`, title: t.title!, done: t.status === 'completed' }];
    }
  }
  return out;
}

// ---------------------------------------------------------------- Microsoft To Do

interface GraphDate { dateTime: string; timeZone?: string }
interface TodoTask { id: string; title: string; body?: { content?: string; contentType?: string }; importance?: 'low' | 'normal' | 'high'; status?: string; dueDateTime?: GraphDate; completedDateTime?: GraphDate; reminderDateTime?: GraphDate; isReminderOn?: boolean; recurrence?: { pattern?: { type?: string; interval?: number; daysOfWeek?: string[] } }; checklistItems?: { id: string; displayName: string; isChecked?: boolean }[]; createdDateTime?: string }

const graphTime = (d?: GraphDate) => (d?.dateTime ? Date.parse(/Z|[+-]\d{2}:?\d{2}$/.test(d.dateTime) || (d.timeZone && d.timeZone !== 'UTC') ? d.dateTime : `${d.dateTime.replace(/\.\d+$/, '')}Z`) : undefined);

/** A To Do repeat pattern as a repeat rule. */
export function rruleFromGraph(p?: { type?: string; interval?: number; daysOfWeek?: string[] }): string | undefined {
  if (!p?.type) return undefined;
  const freq: Record<string, string> = { daily: 'DAILY', weekly: 'WEEKLY', absoluteMonthly: 'MONTHLY', relativeMonthly: 'MONTHLY', absoluteYearly: 'YEARLY', relativeYearly: 'YEARLY' };
  const f = freq[p.type];
  if (!f) return undefined;
  const parts = [`FREQ=${f}`];
  if (p.interval && p.interval > 1) parts.push(`INTERVAL=${p.interval}`);
  if (f === 'WEEKLY' && p.daysOfWeek?.length) parts.push(`BYDAY=${p.daysOfWeek.map((d) => d.slice(0, 2).toUpperCase()).join(',')}`);
  return parts.join(';');
}

/** Tasks from Microsoft To Do (Graph todo lists and tasks with their checklist items). */
export function tasksFromMsTodo(lists: { displayName: string; tasks: TodoTask[] }[]): Reminder[] {
  return lists.flatMap((l) => l.tasks.map((t) => {
    const due = graphTime(t.dueDateTime);
    const r = makeTask({
      title: t.title, notes: t.body?.contentType === 'html' ? (t.body.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : t.body?.content,
      done: t.status === 'completed', doneAt: graphTime(t.completedDateTime),
      // To Do's due is a day (midnight in the list's zone).
      due: due !== undefined ? { t: new Date(new Date(due).getUTCFullYear(), new Date(due).getUTCMonth(), new Date(due).getUTCDate(), 9).getTime(), allDay: true } : undefined,
      priority: t.importance === 'high' ? 3 : t.importance === 'low' ? 1 : 0, project: l.displayName === 'Tasks' ? undefined : l.displayName,
      rrule: rruleFromGraph(t.recurrence?.pattern), steps: t.checklistItems?.map((c) => ({ id: `c${c.id.slice(0, 12)}`, title: c.displayName, done: !!c.isChecked })),
      created: t.createdDateTime ? Date.parse(t.createdDateTime) : undefined, uid: `mstodo-${t.id.slice(0, 40)}`,
    });
    if (t.isReminderOn && t.reminderDateTime) r.remindAt = graphTime(t.reminderDateTime);
    return r;
  }));
}

// ---------------------------------------------------------------- Apple Reminders

/** One reminder as the Mac helper reads it (EventKit or the Reminders app's scripting). */
export interface AppleReminder { title: string; notes?: string; list?: string; due?: number; dueAllDay?: boolean; completed?: boolean; completedAt?: number; priority?: number; rrule?: string; id?: string; created?: number }

/** Apple's priority: 1–4 high, 5 medium, 6–9 low, 0 none. */
export function tasksFromApple(items: AppleReminder[]): Reminder[] {
  return items.filter((x) => (x.title ?? '').trim()).map((x) => makeTask({
    title: x.title, notes: x.notes, done: !!x.completed, doneAt: x.completedAt, project: x.list === 'Reminders' ? undefined : x.list,
    due: x.due !== undefined ? { t: x.due, allDay: !!x.dueAllDay } : undefined,
    priority: !x.priority ? 0 : x.priority <= 4 ? 3 : x.priority === 5 ? 2 : 1, rrule: x.rrule, created: x.created, uid: x.id ? `apple-${x.id}` : undefined,
  }));
}

// ---------------------------------------------------------------- iCalendar VTODO

/** Tasks in an .ics file (any app's VTODO), as local tasks. */
export function tasksFromIcs(text: string): Reminder[] {
  return parseTodos(text, 'local').map((t) => ({ ...t, id: `local:${newId('ics')}`, list: 'local', href: undefined, etag: undefined }));
}

// ---------------------------------------------------------------- export

/** Tasks as CSV with the columns most apps read back. */
export function tasksToCsv(tasks: Reminder[]): string {
  const day = (t?: number) => (t === undefined ? '' : new Date(t).toISOString().slice(0, 16).replace('T', ' '));
  return toCsv([
    ['Title', 'Notes', 'Due', 'Planned for', 'Priority', 'List', 'Repeats', 'Steps', 'Done', 'Completed'],
    ...tasks.map((t) => [t.title, t.notes ?? '', day(t.due), t.plannedFor ?? '', t.priority === 3 ? 'High' : t.priority === 2 ? 'Medium' : t.priority === 1 ? 'Low' : '', t.project ?? '', t.rrule ?? '', (t.steps ?? []).map((s) => `[${s.done ? 'x' : ' '}] ${s.title}`).join(' | '), t.done ? 'Yes' : 'No', day(t.doneAt)]),
  ]);
}

/** Tasks as one .ics file of VTODOs. */
export function tasksToIcs(tasks: Reminder[], now = Date.now()): string {
  const inner = tasks.map((t) => {
    const lines = serializeTodo(t, now).split('\r\n');
    const a = lines.indexOf('BEGIN:VTODO');
    const b = lines.lastIndexOf('END:VTODO');
    return lines.slice(a, b + 1).join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ashforde//Keeper//EN', ...inner, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/** The same task already there (same title and day, or the same id from the same app): skipped on import. */
export function taskKey(t: Pick<Reminder, 'title' | 'due' | 'plannedFor' | 'uid'>): string {
  return t.uid && /^(todoist|gtask|mstodo|apple)-/.test(t.uid) ? t.uid : `${t.title.trim().toLowerCase()}|${t.plannedFor ?? (t.due !== undefined ? dayKey(t.due) : '')}`;
}

