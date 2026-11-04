// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inbox: one shortcut from any app catches a thought, a link, a voice
// note, a screenshot or a file, and it waits here with where and when it came
// from. Sorting shows one item at a time with five big choices (keys 1 to 5):
// make it a task, a note, an event or a typed snippet, or delete it. Kept on
// this computer only. Plain functions so they are easy to test.

export type InboxKind = 'text' | 'link' | 'voice' | 'shot' | 'file';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  /** what was typed or said (for a link: any words with it) */
  text: string;
  url?: string;
  /** a screenshot or a file */
  path?: string;
  /** where it was caught: 'card' (the shortcut), 'hello', 'island', 'palette' */
  source?: string;
  at: number;
}

export interface InboxInput { text?: string; path?: string; kind?: InboxKind; source?: string }

/** The Inbox keeps at most this many; the oldest go first past it. */
export const INBOX_MAX = 500;
const TEXT_MAX = 10_000;
const KINDS: InboxKind[] = ['text', 'link', 'voice', 'shot', 'file'];
const URL_ONLY = /^(https?:\/\/\S+)$/i;
const URL_IN = /(https?:\/\/[^\s<>"]+)/i;
const PICTURE = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

/** One new item from what was caught, or null when there is nothing in it. */
export function newInboxItem(input: InboxInput, now: number, id: string): InboxItem | null {
  const text = (input.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, TEXT_MAX);
  const path = (input.path ?? '').trim() || undefined;
  if (!text && !path) return null;
  const base = { id, at: now, ...(input.source ? { source: input.source } : {}) };
  if (path) return { ...base, kind: input.kind !== 'file' && (input.kind === 'shot' || PICTURE.test(path)) ? 'shot' : 'file', text, path };
  const only = text.match(URL_ONLY);
  if (only) return { ...base, kind: 'link', text: '', url: only[1] };
  const inText = input.kind !== 'voice' ? text.match(URL_IN) : null;
  if (inText) return { ...base, kind: 'link', text: text.replace(inText[1], '').replace(/\s{2,}/g, ' ').trim(), url: inText[1] };
  return { ...base, kind: input.kind === 'voice' ? 'voice' : 'text', text };
}

/** Items read back from disk: bad ones are dropped, newest first, at most INBOX_MAX. */
export function cleanInbox(raw: unknown): InboxItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InboxItem[] = [];
  const ids = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.at !== 'number' || !KINDS.includes(r.kind as InboxKind)) continue;
    const text = typeof r.text === 'string' ? r.text.slice(0, TEXT_MAX) : '';
    const url = typeof r.url === 'string' ? r.url : undefined;
    const path = typeof r.path === 'string' ? r.path : undefined;
    if (!text && !url && !path) continue;
    ids.add(r.id);
    out.push({ id: r.id, kind: r.kind as InboxKind, text, at: r.at, ...(url ? { url } : {}), ...(path ? { path } : {}), ...(typeof r.source === 'string' ? { source: r.source } : {}) });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, INBOX_MAX);
}

/** Adds an item at the top, keeping at most INBOX_MAX. */
export function addToInbox(list: InboxItem[], item: InboxItem): InboxItem[] {
  return [item, ...list.filter((i) => i.id !== item.id)].slice(0, INBOX_MAX);
}

// ---------------------------------------------------------------- sorting

export type SortAction = 'task' | 'note' | 'event' | 'snippet' | 'delete';

export const SORT_ACTIONS: { id: SortAction; label: string; key: string; icon: string; hint: string }[] = [
  { id: 'task', label: 'Task', key: '1', icon: 'listCheck', hint: 'Add it to your tasks' },
  { id: 'note', label: 'Note', key: '2', icon: 'document', hint: 'Add it to today’s daily note' },
  { id: 'event', label: 'Event', key: '3', icon: 'calendar', hint: 'Put it in your calendar' },
  { id: 'snippet', label: 'Snippet', key: '4', icon: 'text', hint: 'Save it as a typed snippet' },
  { id: 'delete', label: 'Delete', key: '5', icon: 'trash', hint: 'Let it go' },
];

export const actionForKey = (key: string): SortAction | undefined => SORT_ACTIONS.find((a) => a.key === key)?.id;

/** About fifteen seconds an item: "7 things to sort, about 2 min". */
export function sortNudge(n: number): string {
  if (n <= 0) return 'Nothing to sort';
  const min = Math.max(1, Math.round((n * 15) / 60));
  return `${n} ${n === 1 ? 'thing' : 'things'} to sort, about ${min} min`;
}

const fileName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function urlLabel(u: string): string {
  try {
    const x = new URL(u);
    const rest = (x.pathname + x.search).replace(/\/$/, '');
    return (x.hostname.replace(/^www\./, '') + rest).slice(0, 80);
  } catch {
    return u.slice(0, 80);
  }
}

/** A short title: the first line of the words, or the link, or the file's name. */
export function itemTitle(i: InboxItem): string {
  const first = i.text.split('\n')[0].trim();
  if (first) return first.length > 80 ? `${first.slice(0, 79)}…` : first;
  if (i.url) return urlLabel(i.url);
  if (i.path) return fileName(i.path);
  return 'Untitled';
}

/** What the task gets: the title, the rest of the words as notes, the link. */
export function taskFrom(i: InboxItem): { title: string; notes?: string; url?: string } {
  const lines = i.text.split('\n');
  const rest = lines.slice(1).join('\n').trim();
  const notes = [rest, i.path ?? ''].filter(Boolean).join('\n');
  return { title: itemTitle(i), ...(notes ? { notes } : {}), ...(i.url ? { url: i.url } : {}) };
}

/** One Markdown line for the daily note: "- 14:05 Call the bank about the card ([link](…))". */
export function noteLine(i: InboxItem, clock: (t: number) => string): string {
  const words = i.text.replace(/\s*\n\s*/g, ' ').trim();
  const link = i.url ? `[${words ? urlLabel(i.url) : itemTitle(i)}](${i.url})` : '';
  const file = i.path ? `[${fileName(i.path)}](<file://${i.path.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}>)` : '';
  return `- ${clock(i.at)} ${[words, link, file].filter(Boolean).join(' · ')}`;
}

/** The words for Calendar's quick add ("Lunch with Ana friday 1pm"). */
export const eventText = (i: InboxItem) => i.text.replace(/\s*\n\s*/g, ' ').trim() || itemTitle(i);

/** A short abbreviation for a typed snippet, not one already in use: ";addr", ";addr2". */
export function snippetAbbr(text: string, taken: string[]): string {
  const word = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).find((w) => w.length >= 2) ?? 'note';
  const base = `;${word.slice(0, 6)}`;
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/** "Typed", "Said", "Link", "Screenshot", "File": what kind of thing it is, in a word. */
export const KIND_LABEL: Record<InboxKind, string> = { text: 'Typed', voice: 'Said', link: 'Link', shot: 'Screenshot', file: 'File' };
