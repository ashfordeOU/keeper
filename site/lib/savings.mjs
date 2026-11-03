// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "What you'd otherwise pay for" on the home page: kinds of paid apps Keeper covers,
// each with a rough yearly price range in US dollars (list prices of popular paid apps
// in that kind, 2026, rounded; one-time purchases counted as a yearly upgrade). No
// product is named. Pure: used by site.js in the browser and by test/site.test.ts.

export const CATEGORIES = [
  { id: 'recorder', name: 'A screen recorder that makes polished videos', low: 90, high: 230, on: true },
  { id: 'notch', name: 'A notch app', low: 10, high: 30, on: true },
  { id: 'space', name: 'A disk space map', low: 10, high: 20, on: true },
  { id: 'cleaner', name: 'A cleanup app', low: 40, high: 90, on: true },
  { id: 'dupes', name: 'A duplicate photo finder', low: 20, high: 40, on: false },
  { id: 'mail', name: 'A smart mail app', low: 50, high: 150, on: false },
  { id: 'planner', name: 'A calendar and planner', low: 40, high: 100, on: false },
  { id: 'notes', name: 'A notes app', low: 30, high: 100, on: false },
  { id: 'meetings', name: 'Meeting notes and transcripts', low: 100, high: 240, on: false },
  { id: 'dictation', name: 'Dictation', low: 100, high: 180, on: false },
  { id: 'firewall', name: 'An app firewall', low: 20, high: 60, on: false },
  { id: 'remote', name: 'Remote desktop', low: 100, high: 300, on: false },
  { id: 'monitor', name: 'A system monitor', low: 10, high: 20, on: false },
  { id: 'clipboard', name: 'Clipboard history', low: 10, high: 30, on: false },
  { id: 'backup', name: 'Backup and folder sync', low: 50, high: 120, on: false },
];

/** The yearly range for the ticked kinds. */
export function totals(ids) {
  const picked = CATEGORIES.filter((c) => ids.includes(c.id));
  return {
    count: picked.length,
    low: picked.reduce((n, c) => n + c.low, 0),
    high: picked.reduce((n, c) => n + c.high, 0),
  };
}

/** "$0", "$150–$410 a year". */
export function money(t) {
  if (!t.count) return '$0';
  const f = (n) => `$${n.toLocaleString('en-US')}`;
  return t.low === t.high ? `${f(t.low)} a year` : `${f(t.low)}–${f(t.high)} a year`;
}
