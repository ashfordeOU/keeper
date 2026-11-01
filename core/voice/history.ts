// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dictation history: search, a size cap, and local statistics (words, time
// saved compared with typing). Pure; stored as a plain JSON file.

import type { DictationStats, Take } from './types';

export function searchTakes(takes: Take[], q: { query?: string; app?: string; limit?: number } = {}): Take[] {
  const terms = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const app = q.app?.toLowerCase();
  return takes
    .filter((t) => (!app || (t.app ?? '').toLowerCase() === app) && terms.every((w) => `${t.text} ${t.raw} ${t.app ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => b.at - a.at)
    .slice(0, q.limit ?? 200);
}

/** Newest first, at most `cap`; returns what was kept and the takes let go (their recordings are deleted). */
export function pruneTakes(takes: Take[], cap: number): { keep: Take[]; drop: Take[] } {
  const sorted = [...takes].sort((a, b) => b.at - a.at);
  return { keep: sorted.slice(0, cap), drop: sorted.slice(cap) };
}

const DAY = 86_400_000;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export function takeStats(takes: Take[], now: number, typingWpm = 40): DictationStats {
  const words = takes.reduce((n, t) => n + t.words, 0);
  const spokenMs = takes.reduce((n, t) => n + t.durationMs, 0);
  const minutesSaved = Math.max(0, words / Math.max(10, typingWpm) - spokenMs / 60_000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const spark = new Array<number>(28).fill(0);
  const days = new Set<string>();
  for (const t of takes) {
    const ago = Math.floor((start.getTime() + DAY - 1 - t.at) / DAY);
    if (ago >= 0 && ago < 28) { spark[27 - ago] += t.words; days.add(dayKey(t.at)); }
  }
  const byApp = new Map<string, number>();
  for (const t of takes) byApp.set(t.app || 'Unknown', (byApp.get(t.app || 'Unknown') ?? 0) + t.words);
  return {
    takes: takes.length,
    words,
    minutesSpoken: Math.round((spokenMs / 60_000) * 10) / 10,
    minutesSaved: Math.round(minutesSaved * 10) / 10,
    activeDays28: days.size,
    dailyAverage: days.size ? Math.round(spark.reduce((a, b) => a + b, 0) / days.size) : 0,
    spark,
    topApps: [...byApp].map(([app, w]) => ({ app, words: w })).sort((a, b) => b.words - a.words).slice(0, 6),
  };
}
