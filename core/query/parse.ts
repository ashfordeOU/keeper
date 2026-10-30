// SPDX-License-Identifier: AGPL-3.0-or-later
// Plain-English search: "pdfs from last week over 5 MB" -> a structured Query
// plus the chips the interface shows, so the user can see and edit how Keeper
// read their words. Runs entirely on-device; no language model involved.

import { extensionsFor, isKnownExt } from '../classify';
import { DAY, GB, KB, MB, formatBytes, parseBytes } from '../format';
import { sourceFromWord, sourceName } from '../sources';
import type { Chip, DateField, DateRange, FileKind, ParsedQuery, Query, SizeRange, SortKey } from '../types';

export function emptyQuery(): Query {
  return { kinds: [], exts: [], sources: [], cameras: [], locations: [], tags: [], terms: [], phrases: [], exclude: [] };
}

// ------------------------------------------------------------------ vocabulary

/** Words that name a kind of file. Plurals and common misspellings included. */
const KIND_WORDS: Record<string, { kinds?: FileKind[]; exts?: string[]; screenshot?: boolean }> = {
  file: {}, files: {}, thing: {}, things: {}, stuff: {}, item: {}, items: {},
  image: { kinds: ['image'] }, images: { kinds: ['image'] }, img: { kinds: ['image'] }, imgs: { kinds: ['image'] },
  photo: { kinds: ['image'] }, photos: { kinds: ['image'] }, picture: { kinds: ['image'] }, pictures: { kinds: ['image'] },
  pic: { kinds: ['image'] }, pics: { kinds: ['image'] }, selfie: { kinds: ['image'] }, selfies: { kinds: ['image'] },
  graphic: { kinds: ['image'] }, graphics: { kinds: ['image'] }, wallpaper: { kinds: ['image'] }, wallpapers: { kinds: ['image'] },
  screenshot: { kinds: ['image'], screenshot: true }, screenshots: { kinds: ['image'], screenshot: true },
  screengrab: { kinds: ['image'], screenshot: true }, screengrabs: { kinds: ['image'], screenshot: true },
  video: { kinds: ['video'] }, videos: { kinds: ['video'] }, movie: { kinds: ['video'] }, movies: { kinds: ['video'] },
  clip: { kinds: ['video'] }, clips: { kinds: ['video'] }, recording: { kinds: ['video', 'audio'] }, recordings: { kinds: ['video', 'audio'] },
  film: { kinds: ['video'] }, films: { kinds: ['video'] },
  music: { kinds: ['audio'] }, song: { kinds: ['audio'] }, songs: { kinds: ['audio'] }, audio: { kinds: ['audio'] },
  track: { kinds: ['audio'] }, tracks: { kinds: ['audio'] }, podcast: { kinds: ['audio'] }, podcasts: { kinds: ['audio'] },
  voice: { kinds: ['audio'] }, memo: { kinds: ['audio'] }, memos: { kinds: ['audio'] },
  document: { kinds: ['document'] }, documents: { kinds: ['document'] }, doc: { kinds: ['document'] }, docs: { kinds: ['document'] },
  paper: { kinds: ['document'] }, papers: { kinds: ['document'] }, report: { kinds: ['document'] }, reports: { kinds: ['document'] },
  ebook: { exts: ['epub', 'mobi', 'azw3', 'pdf'] }, ebooks: { exts: ['epub', 'mobi', 'azw3', 'pdf'] },
  book: { exts: ['epub', 'mobi', 'azw3', 'pdf'] }, books: { exts: ['epub', 'mobi', 'azw3', 'pdf'] },
  spreadsheet: { exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'] }, spreadsheets: { exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'] },
  sheet: { exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'] }, sheets: { exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'] },
  excel: { exts: ['xls', 'xlsx'] }, word: { exts: ['doc', 'docx'] }, powerpoint: { exts: ['ppt', 'pptx'] },
  presentation: { exts: ['ppt', 'pptx', 'key', 'odp'] }, presentations: { exts: ['ppt', 'pptx', 'key', 'odp'] },
  slide: { exts: ['ppt', 'pptx', 'key', 'odp'] }, slides: { exts: ['ppt', 'pptx', 'key', 'odp'] }, deck: { exts: ['ppt', 'pptx', 'key', 'odp', 'pdf'] }, decks: { exts: ['ppt', 'pptx', 'key', 'odp', 'pdf'] },
  invoice: {}, // a real word people search for; left as a term below
  archive: { kinds: ['archive'] }, archives: { kinds: ['archive'] }, compressed: { kinds: ['archive'] },
  zip: { exts: ['zip'] }, zips: { exts: ['zip'] }, zipped: { kinds: ['archive'] }, rars: { exts: ['rar'] },
  installer: { kinds: ['installer'] }, installers: { kinds: ['installer'] }, setup: { kinds: ['installer'] }, setups: { kinds: ['installer'] },
  dmgs: { exts: ['dmg'] }, pkgs: { exts: ['pkg'] }, exes: { exts: ['exe'] }, msis: { exts: ['msi'] }, debs: { exts: ['deb'] }, apks: { exts: ['apk'] },
  app: { kinds: ['app'] }, apps: { kinds: ['app'] }, application: { kinds: ['app'] }, applications: { kinds: ['app'] }, program: { kinds: ['app'] }, programs: { kinds: ['app'] },
  code: { kinds: ['code'] }, script: { kinds: ['code'] }, scripts: { kinds: ['code'] }, source: {},
  pdfs: { exts: ['pdf'] }, pngs: { exts: ['png'] }, jpgs: { exts: ['jpg', 'jpeg'] }, jpegs: { exts: ['jpg', 'jpeg'] }, gifs: { exts: ['gif'] },
  heics: { exts: ['heic', 'heif'] }, mp4s: { exts: ['mp4'] }, movs: { exts: ['mov'] }, mp3s: { exts: ['mp3'] }, svgs: { exts: ['svg'] },
  raw: { exts: ['raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf'] }, raws: { exts: ['raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf'] },
  gif: { exts: ['gif'] }, meme: { kinds: ['image'] }, memes: { kinds: ['image'] },
  font: { exts: ['ttf', 'otf', 'woff', 'woff2'] }, fonts: { exts: ['ttf', 'otf', 'woff', 'woff2'] },
  torrent: { exts: ['torrent'] }, torrents: { exts: ['torrent'] },
};

const CAMERA_WORDS: Record<string, string> = {
  iphone: 'iphone', ipad: 'iphone', ios: 'iphone',
  android: 'android', pixel: 'android', samsung: 'android', galaxy: 'android', oneplus: 'android', xiaomi: 'android',
  phone: 'phone', camera: 'camera', gopro: 'gopro', drone: 'drone', dji: 'drone',
};

const LOCATION_WORDS: Record<string, string> = {
  desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', download: 'Downloads', downloaded: 'Downloads',
  pictures: 'Pictures', movies: 'Movies', videos: 'Videos', music: 'Music', home: 'Home',
};

const STOP = new Set([
  'a', 'an', 'the', 'my', 'me', 'i', 'of', 'all', 'any', 'some', 'show', 'find', 'get', 'give', 'list', 'search', 'for', 'with',
  'that', 'which', 'who', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'and', 'or', 'to', 'it', 'its',
  'in', 'on', 'at', 'from', 'by', 'about', 'containing', 'contain', 'contains', 'mentioning', 'say', 'says', 'saying', 'where',
  'whats', "what's", 'what', 'where', 'can', 'you', 'please', 'those', 'these', 'this', 'there', 'mine', 'made', 'got',
  'received', 'sent', 'saved', 'stored', 'kept', 'put', 'text', 'inside', 'within', 'one', 'ones', 'called', 'named', 'titled',
  'like', 'look', 'looks', 'some', 'had', 'did', 'do', 'does', 'into', 'than', 'then', 'was', 'were', 'ive', "i've",
]);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, couple: 2, few: 3, several: 5,
};
const NUM = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|couple|few|several)';
const UNIT = '(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)';

const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));
const weekdayIndex = (s: string) => WEEKDAYS.findIndex((d) => d.startsWith(s.slice(0, 3)));
const num = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : (NUM_WORDS[s] ?? 1));

function unitMs(unit: string): number {
  if (unit.startsWith('min')) return 60_000;
  if (unit.startsWith('h')) return 3_600_000;
  if (unit.startsWith('d')) return DAY;
  if (unit.startsWith('w')) return 7 * DAY;
  if (unit.startsWith('mo')) return 30 * DAY;
  return 365 * DAY;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the week containing t. */
function startOfWeek(t: number): number {
  const d = new Date(startOfDay(t));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function monthRange(year: number, month: number): [number, number] {
  return [new Date(year, month, 1).getTime(), new Date(year, month + 1, 1).getTime()];
}

function shiftMonths(t: number, n: number): number {
  const d = new Date(t);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

function parseExplicitDate(s: string, now: number): number | undefined {
  // 2026-08-01, 2026/08/01
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  // 01/08/2026 is ambiguous; follow the ISO-like order day/month/year only when day > 12
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const [month, day] = a > 12 ? [b, a] : [a, b];
    return new Date(+m[3], month - 1, day).getTime();
  }
  // "march 5", "5 march", "march 5 2025", "mar 2025"
  m = s.match(new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`));
  if (m) {
    const mi = monthIndex(m[1]);
    const year = m[3] ? +m[3] : latestYearFor(mi, now);
    return new Date(year, mi, +m[2]).getTime();
  }
  m = s.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?$`));
  if (m) {
    const mi = monthIndex(m[2]);
    const year = m[3] ? +m[3] : latestYearFor(mi, now);
    return new Date(year, mi, +m[1]).getTime();
  }
  m = s.match(new RegExp(`^${MONTH_RE}(?:\\s+(\\d{4}))?$`));
  if (m) {
    const mi = monthIndex(m[1]);
    return new Date(m[2] ? +m[2] : latestYearFor(mi, now), mi, 1).getTime();
  }
  m = s.match(/^(\d{4})$/);
  if (m) return new Date(+m[1], 0, 1).getTime();
  if (s === 'today') return startOfDay(now);
  if (s === 'yesterday') return startOfDay(now) - DAY;
  m = s.match(new RegExp(`^(?:last\\s+)?${WEEKDAY_RE}$`));
  if (m) return lastWeekday(weekdayIndex(m[1]), now);
  return undefined;
}

/** "in august" means the most recent August that has started. */
function latestYearFor(month: number, now: number): number {
  const d = new Date(now);
  return month <= d.getMonth() ? d.getFullYear() : d.getFullYear() - 1;
}

function lastWeekday(dow: number, now: number): number {
  const today = startOfDay(now);
  const cur = new Date(today).getDay();
  let back = (cur - dow + 7) % 7;
  if (back === 0) back = 0; // "since monday" on a Monday means today
  return today - back * DAY;
}

// ------------------------------------------------------------------ extractors

interface Ctx {
  q: Query;
  now: number;
  field: DateField;
}

type Extractor = { re: RegExp; run: (m: RegExpMatchArray, ctx: Ctx) => void };

function setDate(ctx: Ctx, from: number | undefined, to: number | undefined, label: string) {
  ctx.q.date = { field: ctx.field, from, to, label };
}

function setSize(ctx: Ctx, min: number | undefined, max: number | undefined, label: string) {
  ctx.q.size = { min, max, label };
}

const SIZE_UNIT = '(b|bytes?|kb|kib|k|kilobytes?|mb|mib|m|megs?|megabytes?|gb|gib|g|gigs?|gigabytes?|tb|tib|t|terabytes?)';
const SIZE = `(\\d+(?:[.,]\\d+)?)\\s*${SIZE_UNIT}\\b`;
const bytes = (n: string, u: string) => parseBytes(`${n}${u}`) ?? 0;

const EXTRACTORS: Extractor[] = [
  // ---- which date the user means
  { re: /\b(?:created|made|taken|shot|added)\b/, run: (_m, ctx) => { ctx.field = 'created'; } },
  { re: /\b(?:opened|used|viewed|accessed|played|read)\b/, run: (_m, ctx) => { ctx.field = 'opened'; } },

  // ---- size
  {
    re: new RegExp(`\\bbetween\\s+(\\d+(?:[.,]\\d+)?)\\s*${SIZE_UNIT}?\\s*(?:and|to|-)\\s*${SIZE}`),
    run: (m, ctx) => {
      const unit = m[2] ?? m[4];
      const lo = bytes(m[1], unit);
      const hi = bytes(m[3], m[4]);
      setSize(ctx, Math.min(lo, hi), Math.max(lo, hi), `${formatBytes(Math.min(lo, hi))} – ${formatBytes(Math.max(lo, hi))}`);
    },
  },
  {
    re: new RegExp(`(?:\\b(?:over|above|more than|larger than|bigger than|greater than|at least|heavier than|exceeding|min(?:imum)?)\\s*|>=?\\s*)${SIZE}`),
    run: (m, ctx) => {
      const b = bytes(m[1], m[2]);
      setSize(ctx, b, ctx.q.size?.max, `Larger than ${formatBytes(b)}`);
    },
  },
  {
    re: new RegExp(`(?:\\b(?:under|below|less than|smaller than|lighter than|at most|up to|max(?:imum)?)\\s*|<=?\\s*)${SIZE}`),
    run: (m, ctx) => {
      const b = bytes(m[1], m[2]);
      setSize(ctx, ctx.q.size?.min, b, `Smaller than ${formatBytes(b)}`);
    },
  },
  { re: new RegExp(`\\b(?:about|around|roughly|~)\\s*${SIZE}`), run: (m, ctx) => {
      const b = bytes(m[1], m[2]);
      setSize(ctx, Math.round(b * 0.8), Math.round(b * 1.2), `About ${formatBytes(b)}`);
    } },
  { re: /\b(?:huge|massive|enormous|giant|gigantic)\b/, run: (_m, ctx) => setSize(ctx, GB, undefined, 'Larger than 1 GB') },
  { re: /\b(?:big|large|heavy|bulky|fat)\b(?!\s*(?:first|est))/, run: (_m, ctx) => setSize(ctx, 100 * MB, undefined, 'Larger than 100 MB') },
  { re: /\b(?:tiny|small|little|light)\b(?!\s*(?:first|est))/, run: (_m, ctx) => setSize(ctx, undefined, 100 * KB, 'Smaller than 100 KB') },
  { re: /\bempty\b/, run: (_m, ctx) => setSize(ctx, undefined, 1, 'Empty') },

  // ---- sorting and limits
  { re: /\b(?:top|first)\s+(\d+)\b/, run: (m, ctx) => { ctx.q.limit = +m[1]; } },
  { re: /\b(?:biggest|largest|heaviest)(?:\s+first)?\b|\b(?:big|large)\w*\s+first\b|\bby size\b/, run: (_m, ctx) => { ctx.q.sort = { key: 'size', desc: true }; } },
  { re: /\b(?:smallest|lightest)(?:\s+first)?\b|\bsmall\w*\s+first\b/, run: (_m, ctx) => { ctx.q.sort = { key: 'size', desc: false }; } },
  { re: /\b(?:latest|newest|most recent|recent(?:ly)?|new)(?:\s+first)?\b/, run: (_m, ctx) => { ctx.q.sort = { key: 'date', desc: true }; } },
  { re: /\boldest(?:\s+first)?\b/, run: (_m, ctx) => { ctx.q.sort = { key: 'date', desc: false }; } },
  { re: /\b(?:by name|alphabetical(?:ly)?|a-z)\b/, run: (_m, ctx) => { ctx.q.sort = { key: 'name', desc: false }; } },

  // ---- dates: relative ranges ("older than 6 months" must run before "6 months")
  {
    re: new RegExp(`\\b(?:older than|over|more than|at least|before)\\s+${NUM}\\s+${UNIT}(?:\\s+(?:old|ago))?\\b`),
    run: (m, ctx) => setDate(ctx, undefined, ctx.now - num(m[1]) * unitMs(m[2]), `Older than ${num(m[1])} ${plural(m[2], num(m[1]))}`),
  },
  {
    re: new RegExp(`\\b${NUM}\\s+${UNIT}\\s+old\\b`),
    run: (m, ctx) => setDate(ctx, undefined, ctx.now - num(m[1]) * unitMs(m[2]), `Older than ${num(m[1])} ${plural(m[2], num(m[1]))}`),
  },
  {
    re: new RegExp(`\\b(?:newer than|less than|under|within(?: the)?(?: last| past)?|in the (?:last|past)|(?:last|past)|from the (?:last|past))\\s+${NUM}\\s+${UNIT}\\b`),
    run: (m, ctx) => setDate(ctx, ctx.now - num(m[1]) * unitMs(m[2]), undefined, `In the last ${num(m[1])} ${plural(m[2], num(m[1]))}`),
  },
  {
    re: new RegExp(`\\b${NUM}\\s+${UNIT}\\s+ago\\b`),
    run: (m, ctx) => {
      const ms = unitMs(m[2]);
      const center = ctx.now - num(m[1]) * ms;
      const span = Math.max(DAY, ms / 2);
      setDate(ctx, center - span, center + span, `About ${num(m[1])} ${plural(m[2], num(m[1]))} ago`);
    },
  },
  { re: /\btoday\b/, run: (_m, ctx) => setDate(ctx, startOfDay(ctx.now), undefined, 'Today') },
  { re: /\byesterday\b/, run: (_m, ctx) => setDate(ctx, startOfDay(ctx.now) - DAY, startOfDay(ctx.now), 'Yesterday') },
  { re: /\bthis week\b/, run: (_m, ctx) => setDate(ctx, startOfWeek(ctx.now), undefined, 'This week') },
  { re: /\b(?:last|past|previous) week\b/, run: (_m, ctx) => setDate(ctx, startOfDay(ctx.now) - 7 * DAY, undefined, 'In the last 7 days') },
  { re: /\bthis month\b/, run: (_m, ctx) => { const d = new Date(ctx.now); setDate(ctx, new Date(d.getFullYear(), d.getMonth(), 1).getTime(), undefined, 'This month'); } },
  { re: /\b(?:last|past|previous) month\b/, run: (_m, ctx) => setDate(ctx, shiftMonths(startOfDay(ctx.now), -1), undefined, 'In the last month') },
  { re: /\bthis year\b/, run: (_m, ctx) => setDate(ctx, new Date(new Date(ctx.now).getFullYear(), 0, 1).getTime(), undefined, 'This year') },
  { re: /\b(?:last|past|previous) year\b/, run: (_m, ctx) => { const y = new Date(ctx.now).getFullYear() - 1; setDate(ctx, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), String(y)); } },
  { re: /\bthis weekend\b|\blast weekend\b/, run: (_m, ctx) => { const sat = lastWeekday(6, ctx.now); setDate(ctx, sat, sat + 2 * DAY, 'Last weekend'); } },
  { re: /\b(?:old|stale|forgotten|ancient|untouched|unused)\b/, run: (_m, ctx) => { if (!ctx.q.date) setDate(ctx, undefined, ctx.now - 180 * DAY, 'Older than 6 months'); } },

  // ---- dates: explicit ("between march and may", "since 2025-01-01", "before june", "in august", "in 2024")
  {
    re: new RegExp(`\\bbetween\\s+([\\w\\s/.-]+?)\\s+and\\s+([\\w\\s/.-]+?)(?=$|\\s+(?:over|under|from|in|on|with|that|larger|smaller|bigger)\\b)`),
    run: (m, ctx) => {
      const a = parseExplicitDate(m[1].trim(), ctx.now);
      const b = parseExplicitDate(m[2].trim(), ctx.now);
      if (a === undefined || b === undefined) return;
      setDate(ctx, Math.min(a, b), endOf(m[2].trim(), Math.max(a, b)), `${cap(m[1].trim())} – ${cap(m[2].trim())}`);
    },
  },
  {
    re: new RegExp(`\\b(?:since|after)\\s+((?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})|(?:\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})|(?:${MONTH_RE}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?)|\\d{4}|(?:last\\s+)?${WEEKDAY_RE})\\b`),
    run: (m, ctx) => {
      const t = parseExplicitDate(m[1].trim(), ctx.now);
      if (t !== undefined) setDate(ctx, /^\d{4}$/.test(m[1]) && /after/.test(m[0]) ? new Date(+m[1] + 1, 0, 1).getTime() : t, undefined, `Since ${cap(m[1].trim())}`);
    },
  },
  {
    re: new RegExp(`\\bbefore\\s+((?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2})|(?:\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})|(?:${MONTH_RE}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?)|\\d{4}|(?:last\\s+)?${WEEKDAY_RE})\\b`),
    run: (m, ctx) => {
      const t = parseExplicitDate(m[1].trim(), ctx.now);
      if (t !== undefined) setDate(ctx, undefined, t, `Before ${cap(m[1].trim())}`);
    },
  },
  {
    re: new RegExp(`\\b(?:in|during|from|of|on)?\\s*(?:last\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?\\b(?!\\s*\\d{1,2}\\b)`),
    run: (m, ctx) => {
      const mi = monthIndex(m[1]);
      const year = m[2] ? +m[2] : latestYearFor(mi, ctx.now);
      const [from, to] = monthRange(year, mi);
      setDate(ctx, from, to, `${cap(MONTHS[mi])} ${year}`);
    },
  },
  {
    re: new RegExp(`\\bon\\s+(\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)\\b`),
    run: (m, ctx) => {
      const t = parseExplicitDate(m[1].trim(), ctx.now);
      if (t !== undefined) setDate(ctx, t, t + DAY, cap(m[1].trim()));
    },
  },
  {
    re: new RegExp(`\\b(?:on|last)\\s+${WEEKDAY_RE}\\b`),
    run: (m, ctx) => {
      const t = lastWeekday(weekdayIndex(m[1]), ctx.now);
      setDate(ctx, t, t + DAY, cap(WEEKDAYS[weekdayIndex(m[1])]));
    },
  },
  {
    re: /\b(?:in|during|from|of)\s+((?:19|20)\d{2})\b/,
    run: (m, ctx) => setDate(ctx, new Date(+m[1], 0, 1).getTime(), new Date(+m[1] + 1, 0, 1).getTime(), m[1]),
  },
  { re: /\b(\d{4}-\d{2}-\d{2})\b/, run: (m, ctx) => { const t = parseExplicitDate(m[1], ctx.now); if (t !== undefined) setDate(ctx, t, t + DAY, m[1]); } },

  // ---- phrases that name a type but use stop words
  { re: /\b(?:plain )?text files?\b|\btxt files?\b/, run: (_m, ctx) => { ctx.q.exts.push('txt', 'md', 'rtf'); } },
  { re: /\b(?:word|excel|powerpoint) (?:docs?|documents?|files?|sheets?)\b/, run: (m, ctx) => {
      const w = m[0].split(' ')[0];
      ctx.q.exts.push(...(w === 'word' ? ['doc', 'docx'] : w === 'excel' ? ['xls', 'xlsx'] : ['ppt', 'pptx']));
    } },

  // ---- duplicates
  { re: /\b(?:duplicates?|dupes?|copies|duplicated)\b/, run: (_m, ctx) => { ctx.q.duplicatesOnly = true; } },
];

function endOf(text: string, t: number): number {
  if (/^\d{4}$/.test(text)) return new Date(new Date(t).getFullYear() + 1, 0, 1).getTime();
  if (new RegExp(`^${MONTH_RE}(?:\\s+\\d{4})?$`).test(text)) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }
  return t + DAY;
}

function plural(unit: string, n: number): string {
  const base = unit.startsWith('min') ? 'minute' : unit.startsWith('h') ? 'hour' : unit.startsWith('d') ? 'day' : unit.startsWith('w') ? 'week' : unit.startsWith('mo') ? 'month' : 'year';
  return n === 1 ? base : base + 's';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ main

export function parseQuery(input: string, now = Date.now()): ParsedQuery {
  const q = emptyQuery();
  const ctx: Ctx = { q, now, field: 'modified' };

  // 1. Quoted phrases are taken literally.
  let text = ` ${input} `.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  text = text.replace(/"([^"]+)"/g, (_m, p: string) => {
    q.phrases.push(p.trim().toLowerCase());
    return ' ';
  });

  // 2. Explicit syntax: #tag, -exclude, ext:pdf, .pdf, kind:image, from:gmail, in:downloads, size>5mb
  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, s: string, t: string) => { q.tags.push(t.toLowerCase()); return s; });
  text = text.replace(/(^|\s)-([\p{L}\p{N}_.]+)/gu, (_m, s: string, t: string) => { q.exclude.push(t.toLowerCase()); return s; });
  text = text.replace(/(^|\s)(?:not|without|except|excluding|but not)\s+([\p{L}\p{N}_.]+)/giu, (_m, s: string, t: string) => {
    q.exclude.push(t.toLowerCase());
    return s;
  });
  text = text.replace(/(^|\s)(?:ext|type):\.?([a-z0-9]+)/gi, (_m, s: string, e: string) => { q.exts.push(e.toLowerCase()); return s; });
  text = text.replace(/(^|\s)kind:([a-z]+)/gi, (_m, s: string, k: string) => { applyKindWord(q, k.toLowerCase()); return s; });
  text = text.replace(/(^|\s)(?:from|source):([\w.-]+)/gi, (_m, s: string, w: string) => { const id = sourceFromWord(w); if (id) pushUnique(q.sources, id); return s; });
  text = text.replace(/(^|\s)(?:in|folder):([^\s]+)/gi, (_m, s: string, f: string) => { pushUnique(q.locations, LOCATION_WORDS[f.toLowerCase()] ?? f); return s; });
  text = text.replace(/(^|\s)tag:([^\s]+)/gi, (_m, s: string, t: string) => { q.tags.push(t.toLowerCase()); return s; });
  text = text.replace(/(^|\s)\.([a-z0-9]{1,8})(?=\s)/gi, (_m, s: string, e: string) => { q.exts.push(e.toLowerCase()); return s; });

  // 3. Everything else is natural language.
  text = text.toLowerCase().replace(/[!?,;]+/g, ' ').replace(/\s+/g, ' ');

  // Sources: "from gmail", "via slack", "downloaded from github.com", "gmail attachments"
  text = text.replace(/\b(?:downloaded |saved |got |received |sent )?(?:from|via|off|out of|on|through)\s+(?:my\s+|the\s+)?([a-z0-9.-]+(?:\s+(?:drive|gpt|docs))?)\b/g, (m, w: string) => {
    const cam = CAMERA_WORDS[w];
    if (cam) { pushUnique(q.cameras, cam); return ' '; }
    const id = sourceFromWord(w);
    if (id && !LOCATION_WORDS[w]) { pushUnique(q.sources, id); return ' '; }
    return m;
  });
  text = text.replace(/\b(gmail|slack|whatsapp|telegram|discord|chatgpt|canva|figma|notion|dropbox|wetransfer|github)\s+(?:attachments?|downloads?|files?|exports?)\b/g, (_m, w: string) => {
    const id = sourceFromWord(w);
    if (id) pushUnique(q.sources, id);
    return ' downloads ';
  });
  // Cameras: "iphone photos", "taken with my pixel"
  text = text.replace(/\b(?:taken |shot |recorded )?(?:with|on|by|using)\s+(?:my\s+|a\s+|the\s+)?(iphone|ipad|android|pixel|samsung|galaxy|phone|camera|gopro|drone|dji)\b/g, (_m, w: string) => {
    pushUnique(q.cameras, CAMERA_WORDS[w]);
    return ' ';
  });
  // Locations: "in downloads", "on my desktop", "in the documents folder", "in folder taxes"
  text = text.replace(/\b(?:in|on|inside|under|from)\s+(?:my\s+|the\s+)?(desktop|documents|downloads|pictures|movies|music|home)(?:\s+folder)?\b/g, (_m, w: string) => {
    pushUnique(q.locations, LOCATION_WORDS[w]);
    return ' ';
  });
  text = text.replace(/\b(?:in|inside|under)\s+(?:the\s+|my\s+)?(?:folder|directory)\s+(?:called\s+|named\s+)?([\w.-]+)\b|\b(?:in|inside)\s+(?:the\s+|my\s+)?([\w.-]+)\s+(?:folder|directory)\b/g, (_m, a?: string, b?: string) => {
    pushUnique(q.locations, (a ?? b)!);
    return ' ';
  });

  for (const ex of EXTRACTORS) {
    const re = new RegExp(ex.re.source, ex.re.flags.includes('g') ? ex.re.flags : ex.re.flags + 'g');
    text = text.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      ex.run(m, ctx);
      // Field-only words ("created", "opened") stay out of the terms.
      return ' ';
    });
  }
  if (q.date) q.date.field = ctx.field;

  // 4. Remaining words: kinds, extensions, locations, sources, then search terms.
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!w) continue;
    if (applyKindWord(q, w)) continue;
    if (CAMERA_WORDS[w] && w !== 'camera' && w !== 'phone') { pushUnique(q.cameras, CAMERA_WORDS[w]); continue; }
    if (STOP.has(w)) continue;
    q.terms.push(w);
  }

  // A bare "downloads" with nothing else means the Downloads folder; with a kind it also does.
  q.exts = [...new Set(q.exts)];
  // "heic photos", "pdf documents": the extension is the precise part, the kind adds nothing.
  q.kinds = [...new Set(q.kinds)].filter((k) => !q.exts.some((e) => extensionsFor(k).includes(e)));
  q.terms = [...new Set(q.terms)].filter((t) => !q.exclude.includes(t));
  // Words like "invoice" in KIND_WORDS without a mapping are real terms.

  const chips = chipsFor(q);
  return { query: q, chips, explanation: explain(q) };
}

function pushUnique<T>(arr: T[], v: T) {
  if (!arr.includes(v)) arr.push(v);
}

function applyKindWord(q: Query, w: string): boolean {
  const k = KIND_WORDS[w];
  if (k) {
    if (!k.kinds && !k.exts && !k.screenshot) {
      // "files", "stuff": nothing to filter on; "invoice", "source", "disk" are real search words
      return !['invoice', 'source'].includes(w);
    }
    if (k.screenshot) q.screenshot = true;
    // An extension list is more precise than a kind; keep only one of them per word.
    if (k.exts) q.exts.push(...k.exts);
    else if (k.kinds) q.kinds.push(...k.kinds);
    return true;
  }
  // "pdf", "png", "heic", "mp4", "dmg" ...
  if (isKnownExt(w)) { q.exts.push(w); return true; }
  // "pdfs", "zips"
  if (w.endsWith('s') && isKnownExt(w.slice(0, -1))) { q.exts.push(w.slice(0, -1)); return true; }
  if (w === 'downloads' || w === 'downloaded' || w === 'download') { pushUnique(q.locations, 'Downloads'); return true; }
  if (w === 'desktop') { pushUnique(q.locations, 'Desktop'); return true; }
  return false;
}

// ------------------------------------------------------------------ chips

const KIND_CHIP: Record<FileKind, string> = {
  image: 'Images', video: 'Videos', audio: 'Music', document: 'Documents', archive: 'Archives',
  installer: 'Installers', app: 'Apps', code: 'Code', other: 'Other',
};

export function chipsFor(q: Query): Chip[] {
  const chips: Chip[] = [];
  if (q.screenshot) chips.push({ field: 'screenshot', label: 'Screenshots', value: 'true' });
  for (const k of q.kinds) if (!(k === 'image' && q.screenshot)) chips.push({ field: 'kind', label: KIND_CHIP[k], value: k });
  const extLabel = extGroupLabel(q.exts);
  if (extLabel) chips.push({ field: 'ext', label: extLabel, value: q.exts.join(',') });
  else for (const e of q.exts) chips.push({ field: 'ext', label: e.toUpperCase(), value: e });
  if (q.date) chips.push({ field: 'date', label: dateLabel(q.date), value: JSON.stringify(q.date) });
  if (q.size) chips.push({ field: 'size', label: q.size.label, value: JSON.stringify(q.size) });
  for (const s of q.sources) chips.push({ field: 'source', label: `From ${sourceName(s.startsWith('web:') ? s.slice(4) : s)}`, value: s });
  for (const c of q.cameras) chips.push({ field: 'camera', label: `Shot on ${c === 'iphone' ? 'iPhone' : cap(c)}`, value: c });
  for (const l of q.locations) chips.push({ field: 'location', label: `In ${l}`, value: l });
  for (const t of q.tags) chips.push({ field: 'tag', label: `#${t}`, value: t });
  for (const p of q.phrases) chips.push({ field: 'phrase', label: `“${p}”`, value: p });
  for (const t of q.terms) chips.push({ field: 'term', label: t, value: t });
  for (const t of q.exclude) chips.push({ field: 'exclude', label: `Not “${t}”`, value: t });
  if (q.duplicatesOnly) chips.push({ field: 'duplicates', label: 'Duplicates', value: 'true' });
  if (q.sort) chips.push({ field: 'sort', label: sortLabel(q.sort.key, q.sort.desc), value: `${q.sort.key}:${q.sort.desc ? 'desc' : 'asc'}` });
  if (q.limit) chips.push({ field: 'limit', label: `Top ${q.limit}`, value: String(q.limit) });
  return chips;
}

function extGroupLabel(exts: string[]): string | undefined {
  const set = new Set(exts);
  const same = (list: string[]) => list.length === set.size && list.every((e) => set.has(e));
  if (same(['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'])) return 'Spreadsheets';
  if (same(['ppt', 'pptx', 'key', 'odp'])) return 'Presentations';
  if (same(['epub', 'mobi', 'azw3', 'pdf'])) return 'E-books';
  if (same(['jpg', 'jpeg'])) return 'JPEG';
  if (same(['heic', 'heif'])) return 'HEIC';
  if (same(['raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf'])) return 'RAW photos';
  if (same(['ttf', 'otf', 'woff', 'woff2'])) return 'Fonts';
  if (same(['txt', 'md', 'rtf'])) return 'Text files';
  if (set.size === 1 && exts[0] === 'pdf') return 'PDFs';
  return undefined;
}

function dateLabel(d: DateRange): string {
  const prefix = d.field === 'created' ? 'Created ' : d.field === 'opened' ? 'Opened ' : '';
  return prefix ? prefix + d.label.charAt(0).toLowerCase() + d.label.slice(1) : d.label;
}

function sortLabel(key: SortKey, desc: boolean): string {
  if (key === 'size') return desc ? 'Biggest first' : 'Smallest first';
  if (key === 'date') return desc ? 'Newest first' : 'Oldest first';
  if (key === 'name') return 'A–Z';
  return 'Best match';
}

export function explain(q: Query): string {
  const parts: string[] = [];
  const what: string[] = [];
  if (q.screenshot) what.push('screenshots');
  for (const k of q.kinds) if (!(k === 'image' && q.screenshot)) what.push(KIND_CHIP[k].toLowerCase());
  const extLabel = extGroupLabel(q.exts);
  if (extLabel) what.push(extLabel === 'PDFs' ? 'PDFs' : extLabel.toLowerCase());
  else if (q.exts.length) what.push(q.exts.map((e) => '.' + e).join(', ') + ' files');
  parts.push(`Showing ${what.length ? joinOr(what) : 'all files'}`);
  if (q.duplicatesOnly) parts.push('that have duplicates');
  if (q.sources.length) parts.push(`downloaded from ${joinOr(q.sources.map((s) => sourceName(s.startsWith('web:') ? s.slice(4) : s)))}`);
  if (q.cameras.length) parts.push(`shot on ${joinOr(q.cameras.map((c) => (c === 'iphone' ? 'an iPhone' : `a ${c}`)))}`);
  if (q.locations.length) parts.push(`in ${joinOr(q.locations)}`);
  if (q.date) parts.push(`${q.date.field === 'created' ? 'created' : q.date.field === 'opened' ? 'opened' : 'modified'} ${dateWords(q.date.label)}`);
  if (q.size) parts.push(q.size.label.charAt(0).toLowerCase() + q.size.label.slice(1));
  const words = [...q.phrases.map((p) => `“${p}”`), ...q.terms.map((t) => `“${t}”`)];
  if (words.length) parts.push(`matching ${words.join(' and ')} in the name, tags or text inside`);
  if (q.tags.length) parts.push(`tagged ${q.tags.map((t) => '#' + t).join(', ')}`);
  if (q.exclude.length) parts.push(`without ${joinOr(q.exclude.map((t) => `“${t}”`))}`);
  if (q.sort) parts.push(sortLabel(q.sort.key, q.sort.desc).toLowerCase());
  if (q.limit) parts.push(`top ${q.limit}`);
  return parts.join(', ');
}

function dateWords(label: string): string {
  if (/^(In the|Older|Newer|Since|Before|About|This|Today|Yesterday|Last)\b/.test(label)) return label.charAt(0).toLowerCase() + label.slice(1);
  if (label.includes(' – ')) return 'between ' + label.replace(' – ', ' and ');
  return 'in ' + label;
}

function joinOr(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1];
}

/** Rebuilds the query text from chips, so edited chips can be saved as a search. */
export function queryToText(q: Query): string {
  const out: string[] = [];
  if (q.screenshot) out.push('screenshots');
  for (const k of q.kinds) if (!(k === 'image' && q.screenshot)) out.push(`kind:${k}`);
  for (const e of q.exts) out.push(`ext:${e}`);
  for (const s of q.sources) out.push(`from:${s.startsWith('web:') ? s.slice(4) : s}`);
  for (const c of q.cameras) out.push(`from my ${c}`);
  for (const l of q.locations) out.push(`in:${l.toLowerCase()}`);
  for (const t of q.tags) out.push(`#${t}`);
  for (const p of q.phrases) out.push(`"${p}"`);
  out.push(...q.terms);
  for (const t of q.exclude) out.push(`-${t}`);
  if (q.size?.min !== undefined) out.push(`over ${formatBytes(q.size.min).replace(' ', '')}`);
  if (q.size?.max !== undefined && q.size.max > 1) out.push(`under ${formatBytes(q.size.max).replace(' ', '')}`);
  if (q.size?.max === 1) out.push('empty');
  if (q.date) {
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    if (q.date.field !== 'modified') out.push(q.date.field);
    if (q.date.from !== undefined && q.date.to !== undefined) out.push(`between ${iso(q.date.from)} and ${iso(q.date.to - DAY)}`);
    else if (q.date.from !== undefined) out.push(`since ${iso(q.date.from)}`);
    else if (q.date.to !== undefined) out.push(`before ${iso(q.date.to)}`);
  }
  if (q.duplicatesOnly) out.push('duplicates');
  if (q.sort) out.push(sortLabel(q.sort.key, q.sort.desc).toLowerCase());
  if (q.limit) out.push(`top ${q.limit}`);
  return out.join(' ');
}

/** Removes one chip and returns the updated query. */
export function removeChip(q: Query, chip: Chip): Query {
  const n: Query = structuredClone(q);
  const drop = <T>(arr: T[], v: T) => arr.filter((x) => x !== v);
  switch (chip.field) {
    case 'kind': n.kinds = drop(n.kinds, chip.value as FileKind); break;
    case 'ext': n.exts = n.exts.filter((e) => !chip.value.split(',').includes(e)); break;
    case 'screenshot': n.screenshot = undefined; n.kinds = drop(n.kinds, 'image'); break;
    case 'date': n.date = undefined; break;
    case 'size': n.size = undefined; break;
    case 'source': n.sources = drop(n.sources, chip.value); break;
    case 'camera': n.cameras = drop(n.cameras, chip.value); break;
    case 'location': n.locations = drop(n.locations, chip.value); break;
    case 'tag': n.tags = drop(n.tags, chip.value); break;
    case 'term': n.terms = drop(n.terms, chip.value); break;
    case 'phrase': n.phrases = drop(n.phrases, chip.value); break;
    case 'exclude': n.exclude = drop(n.exclude, chip.value); break;
    case 'duplicates': n.duplicatesOnly = undefined; break;
    case 'sort': n.sort = undefined; break;
    case 'limit': n.limit = undefined; break;
  }
  return n;
}

export { extensionsFor };
export type { SizeRange };
