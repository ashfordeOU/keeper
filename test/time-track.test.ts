// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  cleanRules, cleanSpans, dayKey, defaultTimeTrackOptions, duration, excluded, hostOf, isBrowser, keepOf, normalizeTimeTrackOptions, projectFor, splitByDay, step,
  summarizeDay, summarizeWeek, toCsv, weekOf, NO_PROJECT, type TimeRule, type TimeSpan,
} from '../core/time-track';

const at = (h: number, m = 0, day = 2) => new Date(2026, 10, day, h, m, 0, 0).getTime();
const o = defaultTimeTrackOptions();

describe('recording', () => {
  it('keeps what the options allow and leaves out excluded apps and sites', () => {
    expect(keepOf({ app: 'Code', title: 'main.ts', site: undefined }, o)).toEqual({ app: 'Code', title: 'main.ts', site: undefined });
    expect(keepOf({ app: 'Code', title: 'main.ts' }, { ...o, titles: false })).toEqual({ app: 'Code', title: undefined, site: undefined });
    expect(keepOf({ app: 'Firefox', title: 'Bank', site: 'Online.MyBank.example' }, { ...o, exclude: ['mybank.example'] })).toBeUndefined();
    expect(keepOf({ app: 'Firefox', site: 'news.example' }, { ...o, sites: false })?.site).toBeUndefined();
    expect(keepOf({ app: '1Password' }, o)).toBeUndefined();
    expect(keepOf({ app: '  ' }, o)).toBeUndefined();
    expect(excluded({ app: 'bitwarden' }, o.exclude)).toBe(true);
  });
  it('one span per stretch of the same app and window; short ones are dropped', () => {
    let r = step(undefined, { app: 'Code', title: 'a' }, at(9));
    expect(r.closed).toBeUndefined();
    r = step(r.open, { app: 'Code', title: 'a' }, at(9, 10));
    expect(r.open).toMatchObject({ start: at(9), end: at(9, 10) });
    r = step(r.open, { app: 'Mail' }, at(9, 20));
    expect(r.closed).toMatchObject({ app: 'Code', start: at(9), end: at(9, 20) });
    const blip = step(r.open, { app: 'Code' }, at(9, 20) + 500);
    expect(blip.closed).toBeUndefined();
    const away = step({ start: at(10), end: at(10), app: 'Code' }, undefined, at(10, 30));
    expect(away.open).toBeUndefined();
    expect(away.closed?.end).toBe(at(10, 30));
  });
  it('cuts spans at midnight', () => {
    const parts = splitByDay({ start: at(23, 30), end: at(0, 45, 3), app: 'Code' });
    expect(parts.map((p) => [dayKey(p.start), (p.end - p.start) / 60_000])).toEqual([['2026-11-02', 30], ['2026-11-03', 45]]);
  });
  it('knows browsers and page hosts', () => {
    expect(isBrowser('Google Chrome')).toBe(true);
    expect(isBrowser('firefox.exe')).toBe(true);
    expect(isBrowser('Code')).toBe(false);
    expect(hostOf('https://www.example.com/a')).toBe('example.com');
    expect(hostOf('chrome://settings')).toBeUndefined();
  });
});

describe('projects and totals', () => {
  const rules: TimeRule[] = [
    { id: '1', project: 'Client A', field: 'site', contains: 'client-a.example' },
    { id: '2', project: 'Client A', field: 'title', contains: 'proposal' },
    { id: '3', project: 'Writing', field: 'app', contains: 'writer' },
  ];
  const spans: TimeSpan[] = [
    { start: at(9), end: at(10), app: 'Writer', title: 'Proposal.docx' },
    { start: at(10), end: at(10, 30), app: 'Firefox', site: 'docs.client-a.example' },
    { start: at(10, 30), end: at(10, 45), app: 'Firefox', site: 'news.example' },
    { start: at(10, 46), end: at(11), app: 'Firefox', site: 'news.example' },
  ];
  it('the first matching rule wins', () => {
    expect(projectFor(spans[0], rules)).toBe('Client A');
    expect(projectFor(spans[1], rules)).toBe('Client A');
    expect(projectFor(spans[2], rules)).toBeUndefined();
  });
  it('sums a day by project, app and site, and joins neighbours for the timeline', () => {
    const s = summarizeDay(spans, rules, '2026-11-02');
    expect(s.total).toBe(119 * 60_000);
    expect(s.projects).toEqual([{ key: 'Client A', ms: 90 * 60_000 }, { key: NO_PROJECT, ms: 29 * 60_000 }]);
    expect(s.apps[0]).toEqual({ key: 'Writer', ms: 60 * 60_000 });
    expect(s.sites.map((x) => x.key)).toEqual(['docs.client-a.example', 'news.example']);
    expect(s.blocks).toHaveLength(3);
    expect(s.blocks[2]).toMatchObject({ start: at(10, 30), end: at(11) });
    expect(s.first).toBe(at(9));
  });
  it('a week has seven days with projects', () => {
    const w = summarizeWeek([{ day: '2026-11-02', spans }, { day: '2026-11-03', spans: [] }], rules);
    expect(w.total).toBe(119 * 60_000);
    expect(w.days[1].total).toBe(0);
    expect(dayKey(weekOf(at(12, 0, 5)))).toBe('2026-11-02');
    expect(dayKey(weekOf(at(12, 0, 1)))).toBe('2026-10-26');
  });
  it('CSV has a row per span and is safe to open in a spreadsheet', () => {
    const csv = toCsv([...spans, { start: at(12), end: at(12, 6), app: '=cmd', title: 'a, "b"' }], rules);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Start,End,Minutes,App,Title,Site,Project');
    expect(lines[1]).toBe('2026-11-02,09:00,10:00,60,Writer,Proposal.docx,,Client A');
    expect(lines[5]).toBe(`2026-11-02,12:00,12:06,6,'=cmd,"a, ""b""",,`);
  });
  it('says durations in plain words', () => {
    expect(duration(30_000)).toBe('under a minute');
    expect(duration(12 * 60_000)).toBe('12 min');
    expect(duration(125 * 60_000)).toBe('2 h 05 min');
  });
});

describe('stored data', () => {
  it('drops broken spans and rules', () => {
    expect(cleanSpans([{ start: 1, end: 2, app: 'A', title: '' }, { start: 5, end: 1, app: 'B' }, null])).toEqual([{ start: 1, end: 2, app: 'A' }]);
    expect(cleanRules([{ id: 'x', project: ' P ', field: 'nope', contains: 'k' }, { project: '', contains: 'a' }])).toEqual([{ id: 'x', project: 'P', field: 'any', contains: 'k' }]);
    expect(normalizeTimeTrackOptions({ idleMinutes: 0.2, keepDays: -4, exclude: 'x' as never })).toMatchObject({ idleMinutes: 1, keepDays: 1, exclude: o.exclude });
  });
});
