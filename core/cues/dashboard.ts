// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Cues dashboard: filters, sort, search, Due today / Upcoming, and
// typing suggestions learnt from the person's own cues (on this computer).

import { describeAnchor, statusOf, type Cue, type CueStatus, type CueType } from './model';

export type CueFilter = 'all' | 'waiting' | 'later' | 'overdue' | 'done' | 'deleted' | CueType;
export type CueSort = 'updated' | 'due' | 'created' | 'title';

export const FILTERS: { id: CueFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'waiting', label: 'Waiting' }, { id: 'later', label: 'Later' }, { id: 'overdue', label: 'Overdue' }, { id: 'done', label: 'Done' },
  { id: 'note', label: 'Notes' }, { id: 'checklist', label: 'Checklists' }, { id: 'link', label: 'Links' }, { id: 'file', label: 'Files' }, { id: 'deleted', label: 'Recently deleted' },
];

function matchesFilter(c: Cue, f: CueFilter, now: number): boolean {
  const st = statusOf(c, now);
  if (f === 'deleted') return st === 'deleted';
  if (st === 'deleted') return false;
  if (f === 'all') return st !== 'done';
  if (f === 'waiting' || f === 'later' || f === 'overdue' || f === 'done') return st === f;
  return c.type === f && st !== 'done';
}

/** How well a cue matches typed words (0 = not at all). Title beats places beats body. */
export function scoreCue(c: Cue, q: string): number {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = c.title.toLowerCase();
  const places = c.anchors.map((a) => `${a.value} ${a.label ?? ''} ${describeAnchor(a)}`).join(' ').toLowerCase();
  const rest = [c.body, c.url ?? '', ...(c.items ?? []).map((i) => i.text), ...(c.tags ?? []), ...(c.files ?? [])].join(' ').toLowerCase();
  let score = 0;
  for (const w of words) {
    const s = title.startsWith(w) ? 6 : title.includes(w) ? 4 : places.includes(w) ? 3 : rest.includes(w) ? 1 : 0;
    if (!s) return 0;
    score += s;
  }
  return score;
}

export function searchCues(cues: Cue[], q: string, limit = 50): Cue[] {
  return cues.filter((c) => !c.deletedAt).map((c) => ({ c, s: scoreCue(c, q) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.updatedAt - a.c.updatedAt).slice(0, limit).map((x) => x.c);
}

export function filterCues(cues: Cue[], o: { filter?: CueFilter; q?: string; sort?: CueSort; now?: number } = {}): Cue[] {
  const now = o.now ?? Date.now();
  const list = cues.filter((c) => matchesFilter(c, o.filter ?? 'all', now) && (!o.q?.trim() || scoreCue(c, o.q) > 0));
  const sort = o.sort ?? 'updated';
  const by: Record<CueSort, (a: Cue, b: Cue) => number> = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.title.localeCompare(b.title),
    due: (a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || b.updatedAt - a.updatedAt,
  };
  return list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by[sort](a, b));
}

export function counts(cues: Cue[], now = Date.now()): Record<CueFilter, number> {
  const out = Object.fromEntries(FILTERS.map((f) => [f.id, 0])) as Record<CueFilter, number>;
  for (const c of cues) for (const f of FILTERS) if (matchesFilter(c, f.id, now)) out[f.id]++;
  return out;
}

/** Due today (including overdue) and the next two weeks. */
export function sections(cues: Cue[], now = Date.now()): { today: Cue[]; upcoming: Cue[] } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const live = cues.filter((c) => !c.deletedAt && !c.done && c.due !== undefined);
  return {
    today: live.filter((c) => c.due! <= end.getTime()).sort((a, b) => a.due! - b.due!),
    upcoming: live.filter((c) => c.due! > end.getTime() && c.due! <= end.getTime() + 14 * 86_400_000).sort((a, b) => a.due! - b.due!),
  };
}

export function statusLabel(s: CueStatus): string {
  return { waiting: 'Waiting', later: 'Later', overdue: 'Overdue', done: 'Done', deleted: 'Deleted' }[s];
}

/** "in 2 h", "tomorrow 09:00", "3 days ago". */
export function whenText(t: number, now = Date.now()): string {
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day0 = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((new Date(t).setHours(0, 0, 0, 0) - day0) / 86_400_000);
  const diff = t - now;
  if (Math.abs(diff) < 60 * 60_000) return diff >= 0 ? `in ${Math.max(1, Math.round(diff / 60_000))} min` : `${Math.max(1, Math.round(-diff / 60_000))} min ago`;
  if (days === 0) return `today ${hm}`;
  if (days === 1) return `tomorrow ${hm}`;
  if (days === -1) return `yesterday ${hm}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} ${hm}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`;
}

// ---------------------------------------------------------------- typing suggestions

export interface PhraseModel {
  /** "w1 w2" → next word counts */
  next: Map<string, Map<string, number>>;
}

const tokens = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}'’.-]+/gu) ?? [];

/** Learns which word tends to follow which, from the person's own cues. */
export function buildPhraseModel(cues: Cue[]): PhraseModel {
  const next = new Map<string, Map<string, number>>();
  const add = (k: string, w: string) => {
    let m = next.get(k);
    if (!m) next.set(k, (m = new Map()));
    m.set(w, (m.get(w) ?? 0) + 1);
  };
  for (const c of cues) {
    if (c.deletedAt) continue;
    for (const line of [c.title, ...c.body.split('\n'), ...(c.items ?? []).map((i) => i.text)]) {
      const t = tokens(line);
      for (let i = 1; i < t.length; i++) {
        add(t[i - 1], t[i]);
        if (i >= 2) add(`${t[i - 2]} ${t[i - 1]}`, t[i]);
      }
    }
  }
  return { next };
}

/**
 * The rest of the phrase to offer after what has been typed (Tab accepts):
 * finishes the current word, then adds up to three likely words.
 */
export function suggest(model: PhraseModel, typed: string): string {
  if (!typed.trim() || /\s{2,}$/.test(typed)) return '';
  const t = tokens(typed);
  const endsWord = !/\s$/.test(typed);
  let out = '';
  let prev = t.slice(-2);
  if (endsWord && t.length) {
    const part = t[t.length - 1];
    const ctx = t.slice(-3, -1);
    const cands = new Map<string, number>();
    for (const k of [ctx.join(' '), ctx[ctx.length - 1] ?? '']) for (const [w, n] of model.next.get(k) ?? []) if (w.startsWith(part) && w !== part) cands.set(w, (cands.get(w) ?? 0) + n);
    if (!cands.size) for (const m of model.next.values()) for (const [w, n] of m) if (w.startsWith(part) && w !== part && part.length >= 2) cands.set(w, (cands.get(w) ?? 0) + n);
    const best = [...cands].sort((a, b) => b[1] - a[1])[0];
    if (!best) return '';
    out = best[0].slice(part.length);
    prev = [...ctx.slice(-1), best[0]];
  }
  for (let i = 0; i < 3; i++) {
    const m = model.next.get(prev.join(' ')) ?? model.next.get(prev[prev.length - 1] ?? '');
    if (!m) break;
    const [w, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    // Only phrases seen more than once are worth offering.
    if (n < 2) break;
    out += `${out || endsWord ? ' ' : ''}${w}`;
    prev = [prev[prev.length - 1], w];
  }
  return out;
}
