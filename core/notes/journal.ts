// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Journal mode for Notes: one Markdown file per day in a notes vault
// (<folder>/<year>/<YYYY-MM-DD>.md), with the day's mood, weather, place and
// photos as properties and embeds, so any Markdown app can read it. Pure
// logic: paths, writing and reading an entry, streaks and "On this day".

import { readProps, splitFrontmatter, writeProps } from './parse';
import type { YamlValue } from './yaml';

export type Mood = 'great' | 'good' | 'okay' | 'low' | 'rough';

export const MOODS: { id: Mood; label: string }[] = [
  { id: 'great', label: 'Great' },
  { id: 'good', label: 'Good' },
  { id: 'okay', label: 'Okay' },
  { id: 'low', label: 'Low' },
  { id: 'rough', label: 'Rough' },
];

export interface JournalEntry {
  /** "YYYY-MM-DD" */
  date: string;
  mood?: Mood;
  /** "Partly cloudy" */
  weather?: string;
  /** "12 °C" */
  temperature?: string;
  place?: string;
  /** vault paths of the day's photos */
  photos: string[];
  /** what was written (without the heading and the photos) */
  body: string;
}

export interface JournalSettings {
  /** the notes vault the journal lives in ('' until one is chosen or made) */
  vault: string;
  /** the folder inside the vault ('' for the vault itself) */
  folder: string;
  /** add the weather to today's entry (from Keeper's Weather) */
  weather: boolean;
  /** add where you were that day (from Places & Tracks) */
  place: boolean;
  /** suggest photos taken that day (from your library) */
  photos: boolean;
}

export const defaultJournalSettings = (): JournalSettings => ({ vault: '', folder: 'Journal', weather: false, place: false, photos: true });

export function normalizeJournalSettings(o: Partial<JournalSettings> | undefined): JournalSettings {
  const d = defaultJournalSettings();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  const folder = String(v.folder ?? '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/').slice(0, 120);
  // An empty folder is the vault itself (a vault made for the journal).
  return { vault: typeof v.vault === 'string' ? v.vault : '', folder: typeof v.folder === 'string' ? folder : d.folder, weather: v.weather === true, place: v.place === true, photos: v.photos !== false };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isDay = (s: string) => DAY_RE.test(s);

/** Where a day's entry lives in the vault. */
export function entryPath(folder: string, date: string): string {
  if (!isDay(date)) throw new Error('Not a day');
  return `${folder ? `${folder}/` : ''}${date.slice(0, 4)}/${date}.md`;
}

/** The days that have an entry, from the vault's file list. */
export function entryDates(paths: string[], folder: string): string[] {
  const pre = folder ? `${folder}/` : '';
  const out = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(pre)) continue;
    const m = /^(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(p.slice(pre.length));
    if (m && m[2].startsWith(m[1])) out.add(m[2]);
  }
  return [...out].sort();
}

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Days in a row with an entry, up to today (a streak still counts until the end of today), and the longest ever. */
export function streak(dates: string[], today: string): { current: number; longest: number } {
  const set = new Set(dates);
  let current = 0;
  let d = set.has(today) ? today : shift(today, -1);
  while (set.has(d)) { current++; d = shift(d, -1); }
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const x of [...set].sort()) {
    run = prev && shift(prev, 1) === x ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = x;
  }
  return { current, longest };
}

/** Earlier years' entries on this month and day, newest first (29 February shows on 28 February in other years). */
export function onThisDay(dates: string[], today: string): string[] {
  const md = today.slice(5);
  const y = Number(today.slice(0, 4));
  const leapless = md === '02-28' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  return dates.filter((d) => d < today && d.slice(0, 4) !== today.slice(0, 4) && (d.slice(5) === md || (leapless && d.slice(5) === '02-29'))).sort().reverse();
}

const PHOTO_LINE = /^!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;

/** Writes an entry: properties, the day as a heading, the photos, then the text. Other properties already in the file are kept. */
export function writeEntry(e: JournalEntry, heading: string, previous = ''): string {
  const { props } = readProps(previous);
  const next: Record<string, YamlValue> = { ...props, journal: e.date };
  const set = (k: string, v: string | undefined) => { if (v) next[k] = v; else delete next[k]; };
  set('mood', e.mood);
  set('weather', e.weather);
  set('temperature', e.temperature);
  set('place', e.place);
  const photos = e.photos.map((p) => `![[${p}]]`).join('\n');
  const body = `# ${heading}\n\n${photos ? `${photos}\n\n` : ''}${e.body.replace(/^\s+/, '').replace(/\s+$/, '')}\n`;
  return writeProps(body, next);
}

/** Reads an entry back; text written in another app (no heading, other properties) is kept as the body. */
export function readEntry(text: string, date: string): JournalEntry {
  const { props } = readProps(text);
  const str = (k: string) => (typeof props[k] === 'string' || typeof props[k] === 'number' ? String(props[k]) : undefined);
  const mood = MOODS.find((m) => m.id === str('mood'))?.id;
  let body = splitFrontmatter(text).body.replace(/^\s+/, '');
  if (/^# [^\n]*\n/.test(body)) body = body.replace(/^# [^\n]*\n/, '');
  const photos: string[] = [];
  const lines = body.replace(/^\s+/, '').split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const m = PHOTO_LINE.exec(lines[i]);
    if (m) photos.push(m[1]);
    else if (lines[i].trim() !== '' || !photos.length) break;
  }
  if (photos.length) body = lines.slice(i).join('\n');
  return { date, mood, weather: str('weather'), temperature: str('temperature'), place: str('place'), photos, body: body.replace(/^\s+/, '').replace(/\s+$/, '') };
}

/** The first words of an entry, for lists. */
export function excerpt(body: string, max = 140): string {
  const t = body.replace(/!\[\[[^\]]*\]\]/g, '').replace(/[#>*_`~[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
}

/** Is this a photo the journal can show? */
export const isPhoto = (name: string) => /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(name);
