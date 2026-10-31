// SPDX-License-Identifier: AGPL-3.0-or-later
// Learning from how the person uses Keeper — off until they turn it on, kept
// only on this computer, and easy to forget. Keeper notes coarse events it
// already sees (a file opened, a search, a move, a rule run, a clean-up choice)
// and spots repeats worth turning into an automation, a pin, a saved search or
// a skill. Nothing here is sent anywhere unless the person asks an AI with it.

export type UsageEvent =
  | { t: number; type: 'open'; path: string }
  | { t: number; type: 'search'; q: string }
  | { t: number; type: 'move'; from: string; to: string }
  | { t: number; type: 'trash'; path: string }
  | { t: number; type: 'rule'; id: string }
  | { t: number; type: 'app'; name: string }
  | { t: number; type: 'page'; name: string };

/** An event before it has its time. */
export type UsageInput = UsageEvent extends infer E ? (E extends UsageEvent ? Omit<E, 't'> & { t?: number } : never) : never;

export interface Suggestion {
  id: string;
  kind: 'rule' | 'pin' | 'saved-search' | 'skill';
  title: string;
  detail: string;
  /** how many times it was seen */
  count: number;
  /** what creating it would make */
  make:
    | { type: 'rule'; name: string; ext?: string; nameContains?: string; scope: string; to?: string; trash?: boolean }
    | { type: 'pin'; folder: string }
    | { type: 'saved-search'; name: string; text: string };
}

export const DAY = 86_400_000;

export function prune(events: UsageEvent[], now: number, retentionDays: number, max = 20_000): UsageEvent[] {
  const cutoff = now - retentionDays * DAY;
  const kept = events.filter((e) => e.t >= cutoff);
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf(sep(p)))) || sep(p);
const baseOf = (p: string) => p.slice(p.lastIndexOf(sep(p)) + 1);
const extOf = (p: string) => {
  const b = baseOf(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
/** A word the moved files share in their names (invoice, receipt, statement…). */
function sharedWord(names: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const n of names) {
    for (const w of new Set(n.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-zÀ-ɏ]+/).filter((w) => w.length >= 4))) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.max(3, Math.ceil(names.length * 0.6)) ? best[0] : undefined;
}

/** Repeats worth automating, most useful first. `dismissed` hides ones the person said no to. */
export function suggest(events: UsageEvent[], now: number, opts: { pinned?: string[]; saved?: string[]; dismissed?: string[] } = {}): Suggestion[] {
  const out: Suggestion[] = [];
  const recent = events.filter((e) => e.t >= now - 60 * DAY);

  // Moves: the same kind of file from the same folder into the same place, again and again.
  const moves = recent.filter((e): e is Extract<UsageEvent, { type: 'move' }> => e.type === 'move');
  const byRoute = new Map<string, typeof moves>();
  for (const m of moves) {
    const key = `${dirOf(m.from)}→${dirOf(m.to)}|${extOf(m.from)}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), m]);
  }
  for (const [key, list] of byRoute) {
    if (list.length < 3) continue;
    const days = new Set(list.map((m) => Math.floor(m.t / DAY))).size;
    if (days < 2) continue;
    const [route, ext] = key.split('|');
    const [fromDir, toDir] = route.split('→');
    const word = sharedWord(list.map((m) => baseOf(m.from)));
    const what = `${word ? `“${word}” ` : ''}${ext ? `.${ext} files` : 'files'}`;
    out.push({
      id: `rule:${key}`,
      kind: 'rule',
      title: `Move ${what} from ${baseOf(fromDir) || fromDir} to ${baseOf(toDir) || toDir} automatically?`,
      detail: `You did this ${list.length} times on ${days} different days.`,
      count: list.length,
      make: { type: 'rule', name: `Move ${what} to ${baseOf(toDir) || toDir}`, ext: ext || undefined, nameContains: word, scope: fromDir, to: toDir },
    });
  }

  // Trash: the same kind of file from one folder, always thrown away.
  const trashes = recent.filter((e): e is Extract<UsageEvent, { type: 'trash' }> => e.type === 'trash');
  const byTrash = new Map<string, typeof trashes>();
  for (const t of trashes) {
    const ext = extOf(t.path);
    if (!ext) continue;
    const key = `${dirOf(t.path)}|${ext}`;
    byTrash.set(key, [...(byTrash.get(key) ?? []), t]);
  }
  for (const [key, list] of byTrash) {
    if (list.length < 4) continue;
    const [dir, ext] = key.split('|');
    out.push({
      id: `trash:${key}`, kind: 'rule',
      title: `Send old .${ext} files in ${baseOf(dir) || dir} to the Trash automatically?`,
      detail: `You trashed ${list.length} of them. The rule would only take ones older than two weeks, and you can preview it first.`,
      count: list.length,
      make: { type: 'rule', name: `Trash old .${ext} files in ${baseOf(dir) || dir}`, ext, scope: dir, trash: true },
    });
  }

  // Folders opened most mornings (or most days): pin them.
  const opens = recent.filter((e): e is Extract<UsageEvent, { type: 'open' }> => e.type === 'open');
  const byFolder = new Map<string, Set<number>>();
  for (const o of opens) {
    const d = dirOf(o.path);
    byFolder.set(d, (byFolder.get(d) ?? new Set()).add(Math.floor(o.t / DAY)));
  }
  for (const [folder, days] of byFolder) {
    if (days.size < 4 || opts.pinned?.includes(folder)) continue;
    const hours = opens.filter((o) => dirOf(o.path) === folder).map((o) => new Date(o.t).getHours());
    const morning = hours.filter((h) => h >= 6 && h < 11).length >= hours.length * 0.6;
    out.push({
      id: `pin:${folder}`, kind: 'pin',
      title: `Pin ${baseOf(folder) || folder} to the sidebar?`,
      detail: `You opened files there on ${days.size} days${morning ? ', mostly in the morning' : ''}.`,
      count: days.size,
      make: { type: 'pin', folder },
    });
  }

  // The same search, typed again and again.
  const searches = recent.filter((e): e is Extract<UsageEvent, { type: 'search' }> => e.type === 'search');
  const byQ = new Map<string, number>();
  for (const s of searches) {
    const q = s.q.trim().toLowerCase().replace(/\s+/g, ' ');
    if (q.length >= 3) byQ.set(q, (byQ.get(q) ?? 0) + 1);
  }
  for (const [q, n] of byQ) {
    if (n < 3 || opts.saved?.some((x) => x.toLowerCase() === q)) continue;
    out.push({ id: `search:${q}`, kind: 'saved-search', title: `Save the search “${q}”?`, detail: `You searched for it ${n} times.`, count: n, make: { type: 'saved-search', name: q.replace(/^\w/, (c) => c.toUpperCase()), text: q } });
  }

  const dismissed = new Set(opts.dismissed ?? []);
  return out.filter((s) => !dismissed.has(s.id)).sort((a, b) => b.count - a.count).slice(0, 20);
}

/** A short, private summary of habits, for when the person asks an AI about them. */
export function habitsSummary(events: UsageEvent[], now: number): string {
  const recent = events.filter((e) => e.t >= now - 30 * DAY);
  if (!recent.length) return 'No activity recorded yet.';
  const count = (type: UsageEvent['type']) => recent.filter((e) => e.type === type).length;
  const hours = new Array(24).fill(0) as number[];
  for (const e of recent) hours[new Date(e.t).getHours()]++;
  const peak = hours.indexOf(Math.max(...hours));
  return `Last 30 days: ${count('open')} files opened, ${count('search')} searches, ${count('move')} moves, ${count('trash')} items trashed, ${count('rule')} automation runs. Busiest hour: ${peak}:00.`;
}
