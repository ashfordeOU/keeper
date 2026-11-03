// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's time tracking: a made-up day and week, the same pure logic as the app.

import type { TimeStatus, TimeTrackApi } from '../core/api-time';
import { cleanRules, dayKey, defaultTimeTrackOptions, summarizeDay, summarizeWeek, type TimeRule, type TimeSpan } from '../core/time-track';

export function mockTimeTrack(): { timeTrack: TimeTrackApi } {
  let rules: TimeRule[] = [
    { id: 'r1', project: 'Website redesign', field: 'title', contains: 'redesign' },
    { id: 'r2', project: 'Website redesign', field: 'site', contains: 'figma.com' },
    { id: 'r3', project: 'Email and chat', field: 'app', contains: 'mail' },
    { id: 'r4', project: 'Email and chat', field: 'app', contains: 'slack' },
  ];
  let paused = false;
  const make = (t: number): TimeSpan[] => {
    const d = new Date(t);
    const at = (h: number, m: number) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };
    const seq: [number, number, number, number, string, string?, string?][] = [
      [9, 0, 9, 25, 'Mail', 'Inbox'], [9, 25, 10, 40, 'Code', 'redesign — header.tsx'], [10, 40, 10, 55, 'Slack', 'design-team'],
      [10, 55, 12, 10, 'Firefox', 'Homepage redesign', 'figma.com'], [13, 0, 13, 20, 'Firefox', 'News', 'news.example.com'], [13, 20, 15, 5, 'Code', 'redesign — styles.css'],
      [15, 5, 15, 30, 'Mail', 'Re: launch date'], [15, 30, 16, 45, 'Writer', 'Quarterly report.docx'],
    ];
    return seq.map(([h1, m1, h2, m2, app, title, site]) => ({ start: at(h1, m1), end: at(h2, m2), app, title, site }));
  };
  const status = async (): Promise<TimeStatus> => ({ recording: !paused, paused, away: false, supported: true, now: paused ? undefined : { app: 'Code', title: 'redesign — header.tsx', since: Date.now() - 23 * 60_000 }, options: defaultTimeTrackOptions(), rules, encrypted: true, days: [dayKey(Date.now())] });
  return {
    timeTrack: {
      status,
      day: async (day) => { const spans = make(new Date(`${day}T12:00:00`).getTime()); return { spans, summary: summarizeDay(spans, rules, day) }; },
      week: async (monday) => {
        const start = new Date(`${monday}T12:00:00`).getTime();
        return summarizeWeek(Array.from({ length: 7 }, (_, i) => { const t = start + i * 86_400_000; return { day: dayKey(t), spans: i < 5 ? make(t) : [] }; }), rules);
      },
      setPaused: async (p) => { paused = p; return status(); },
      saveRules: async (r) => { rules = cleanRules(r); return status(); },
      exportCsv: async () => ({ saved: false }),
      removeDay: async () => status(),
      wipe: async () => status(),
      testFront: async () => undefined,
    },
  };
}
