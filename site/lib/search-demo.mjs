// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The search demo on the home page: a few files from Keeper's own demo library
// (src/mock.ts) and a small reader for plain-English searches like "pdfs from
// mail last month". It only shows the idea: the app's real search does far more.
// Pure: used by site.js in the browser and by test/site.test.ts.


/** [name, folder, kind, days ago, size in MB, where it came from, text inside] */
export const FILES = [
  ['Q3 Invoice - Acme.pdf', 'Downloads', 'pdf', 2, 0.4, 'gmail', 'Invoice #4471 Acme Corp. Amount due $4,200.00'],
  ['Boarding pass LIS.pdf', 'Downloads', 'pdf', 6, 0.2, 'gmail', ''],
  ['brand-kit-final.zip', 'Downloads', 'archive', 40, 184, 'drive', ''],
  ['report-draft.docx', 'Downloads', 'document', 10, 1.2, 'chat', ''],
  ['chart-export.png', 'Downloads', 'image', 1, 0.8, 'ai chat', ''],
  ['Screenshot 2026-10-28 at 09.14.02.png', 'Desktop', 'screenshot', 2, 1.1, '', 'Network: Studio-5G Wi-Fi password: blue-otter-42'],
  ['Screenshot 2026-10-21 at 16.40.11.png', 'Desktop', 'screenshot', 9, 0.9, '', 'Tracking number 1Z 999 AA1 Estimated delivery Friday'],
  ['Screenshot 2026-07-02 at 11.02.45.png', 'Desktop', 'screenshot', 120, 1.4, '', 'Meeting notes: launch on the 14th, budget approved'],
  ['2025 Tax Return.pdf', 'Documents/Taxes', 'pdf', 190, 2.8, '', ''],
  ['Lease agreement.pdf', 'Documents', 'pdf', 400, 5.6, '', ''],
  ['Budget 2026.xlsx', 'Documents', 'spreadsheet', 12, 0.4, '', ''],
  ['Pitch deck v7.key', 'Documents', 'presentation', 20, 48, '', ''],
  ['IMG_4102.HEIC', 'Pictures', 'image', 75, 3.2, '', ''],
  ['PXL_20260812_101500.jpg', 'Pictures/Lisbon', 'image', 79, 4.1, '', ''],
  ['Lisbon trip.mov', 'Movies', 'video', 79, 2400, '', ''],
  ['Screen Recording 2025-11-02.mov', 'Movies', 'video', 362, 880, '', ''],
  ['birthday.mp4', 'Movies', 'video', 500, 310, '', ''],
  ['Morning Light.mp3', 'Music', 'audio', 210, 8.4, '', ''],
  ['old-photos.zip', 'Documents/Archive', 'archive', 700, 1900, '', ''],
].map(([name, folder, kind, days, mb, from, text]) => ({ name, folder, kind, days, mb, from, text }));

/** Ready-made searches shown as chips. */
export const PRESETS = [
  'screenshots with wifi password',
  'pdfs from gmail last week',
  'videos over 500 MB',
  'pictures from Lisbon',
  'invoice',
];

const KINDS = {
  pdf: ['pdf', 'pdfs'],
  screenshot: ['screenshot', 'screenshots'],
  image: ['picture', 'pictures', 'photo', 'photos', 'image', 'images'],
  video: ['video', 'videos', 'movie', 'movies'],
  audio: ['song', 'songs', 'music', 'audio'],
  archive: ['zip', 'zips', 'archive', 'archives'],
  document: ['doc', 'docs', 'document', 'documents'],
};
const WHEN = { today: 1, yesterday: 2, 'this week': 7, 'last week': 14, 'this month': 31, 'last month': 62, 'this year': 366 };

/** Reads a plain-English search into parts: kind, source, age in days, size, and the remaining words. */
export function parseQuery(q) {
  let s = ` ${String(q).toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const out = { kind: null, from: null, maxDays: null, minMb: null, words: [] };
  for (const [kind, words] of Object.entries(KINDS)) {
    for (const w of words) if (s.includes(` ${w} `)) { out.kind = out.kind ?? kind; s = s.replace(` ${w} `, ' '); }
  }
  for (const [phrase, days] of Object.entries(WHEN)) if (s.includes(` ${phrase} `)) { out.maxDays = days; s = s.replace(` ${phrase} `, ' '); }
  const size = s.match(/ (?:over|bigger than|larger than) (\d+(?:\.\d+)?) ?(mb|gb) /);
  if (size) { out.minMb = Number(size[1]) * (size[2] === 'gb' ? 1024 : 1); s = s.replace(size[0], ' '); }
  const from = s.match(/ from (\w+) /);
  if (from) {
    const known = FILES.some((f) => f.from === from[1]);
    if (known) out.from = from[1];
    else out.words.push(from[1]);
    s = s.replace(from[0], ' ');
  }
  const stop = new Set(['with', 'the', 'a', 'an', 'my', 'of', 'in', 'and', 'all', 'files', 'file', 'for', 'show', 'me', 'find']);
  out.words.push(...s.trim().split(' ').filter((w) => w && !stop.has(w)));
  return out;
}

/** True when a file matches the parsed search. */
export function matches(f, p) {
  if (p.kind) {
    const ok = p.kind === f.kind || (p.kind === 'image' && f.kind === 'screenshot') || (p.kind === 'document' && ['pdf', 'spreadsheet', 'presentation', 'document'].includes(f.kind));
    if (!ok) return false;
  }
  if (p.from && f.from !== p.from) return false;
  if (p.maxDays != null && f.days > p.maxDays) return false;
  if (p.minMb != null && f.mb < p.minMb) return false;
  const hay = `${f.name} ${f.folder} ${f.text}`.toLowerCase().replace(/wi-fi/g, 'wifi');
  return p.words.every((w) => hay.includes(w.replace(/wi-fi/g, 'wifi')));
}

/** Files matching a search, newest first, with why each one matched. */
export function search(q, limit = 5) {
  const p = parseQuery(q);
  if (!p.kind && !p.from && p.maxDays == null && p.minMb == null && !p.words.length) return [];
  return FILES.filter((f) => matches(f, p))
    .sort((a, b) => a.days - b.days)
    .slice(0, limit)
    .map((f) => ({ ...f, why: reason(f, p) }));
}

function reason(f, p) {
  const inName = p.words.length && p.words.every((x) => f.name.toLowerCase().includes(x));
  const inText = !inName && p.words.some((x) => f.text.toLowerCase().replace(/wi-fi/g, 'wifi').includes(x));
  if (inText) return f.kind === 'screenshot' || f.kind === 'image' ? 'Text in the picture' : 'Text in the file';
  if (p.from) return `Came from ${f.from}`;
  if (p.minMb != null) return size(f.mb);
  return f.folder;
}

/** "2.3 GB", "184 MB", "400 KB". */
export function size(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.round(mb * 1024)} KB`;
}

/** "today", "yesterday", "6 days ago", "3 months ago". */
export function ago(days) {
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y === 1 ? 'a year ago' : `${y} years ago`;
}

