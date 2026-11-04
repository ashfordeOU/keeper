// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the phone companion's Today shows: the day's events, the tasks worth
// doing today (overdue first), how much waits in the Inbox, and file search
// results in plain words. Read when the page opens (no push, so no server).

export interface PhoneEvent { id: string; title: string; start: number; end: number; allDay?: boolean; location?: string }
export interface PhoneTask { id: string; title: string; due?: number; plannedFor?: string; done?: boolean; priority?: number }

export interface PhoneToday {
  /** "Wednesday 4 November" */
  day: string;
  events: { id: string; title: string; when: string; now?: boolean; location?: string }[];
  tasks: { id: string; title: string; note?: string; overdue?: boolean }[];
  /** more open tasks than shown */
  moreTasks: number;
  inbox: number;
}

const two = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };

export function phoneToday(now: number, events: PhoneEvent[], tasks: PhoneTask[], inbox: number, max = { events: 6, tasks: 8 }): PhoneToday {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 86_400_000;
  const today = dayKey(now);
  const evs = events
    .filter((e) => e.end > now && e.start < end)
    .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.start - b.start)
    .slice(0, max.events)
    .map((e) => ({ id: e.id, title: e.title || 'Untitled', when: e.allDay ? 'All day' : `${hm(Math.max(e.start, start.getTime()))}–${hm(Math.min(e.end, end))}`, ...(e.start <= now && e.end > now && !e.allDay ? { now: true } : {}), ...(e.location ? { location: e.location } : {}) }));
  const open = tasks.filter((t) => !t.done);
  const due = (t: PhoneTask) => (t.due !== undefined && t.due < end) || t.plannedFor === today;
  const ranked = open
    .filter(due)
    .sort((a, b) => Number(!((a.due ?? Infinity) < start.getTime())) - Number(!((b.due ?? Infinity) < start.getTime())) || (b.priority ?? 0) - (a.priority ?? 0) || (a.due ?? end) - (b.due ?? end));
  const shown = ranked.slice(0, max.tasks).map((t) => {
    const overdue = t.due !== undefined && t.due < start.getTime();
    return { id: t.id, title: t.title, ...(overdue ? { overdue: true, note: 'Overdue' } : t.due !== undefined && t.due >= start.getTime() && new Date(t.due).getHours() + new Date(t.due).getMinutes() > 0 ? { note: hm(t.due) } : {}) };
  });
  return {
    day: new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    events: evs,
    tasks: shown,
    moreTasks: Math.max(0, ranked.length - shown.length),
    inbox,
  };
}

export interface PhoneFileHit { path: string; name: string; where: string; size: number; kind: string }

/** A found file for the phone: its name, the folder in words ("~/Documents/Taxes"), size and kind. */
export function phoneFileHit(f: { path: string; name: string; size: number; kind: string }, home: string): PhoneFileHit {
  const dir = f.path.slice(0, f.path.length - f.name.length).replace(/[\\/]+$/, '');
  const h = home.replace(/[\\/]+$/, '');
  const where = dir === h ? '~' : dir.startsWith(h + '/') || dir.startsWith(h + '\\') ? `~/${dir.slice(h.length + 1).replace(/\\/g, '/')}` : dir;
  return { path: f.path, name: f.name, where, size: f.size, kind: f.kind };
}

/** A name the phone sent for a file it just uploaded: only a plain file name. */
export function uploadedName(n: unknown): string | null {
  const s = String(n ?? '');
  if (!s || s.length > 255 || /[\\/\0]/.test(s) || s === '.' || s === '..' || s.startsWith('.')) return null;
  return s;
}
