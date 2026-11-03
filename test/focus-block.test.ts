// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  activeBlock, appFor, blockLine, browserBlock, cleanFocusBlockData, countBlocked, blockedTodayCount, defaultFocusBlockOptions, emptyFocusBlockData, nextChange,
  normalizeFocusBlockOptions, normalizeSite, parseClock, scheduleEnd, scheduleOn, siteFor, stopEarly, takePass, withPasses, type FocusBlockData,
} from '../core/focus-block';

// Monday 2 November 2026, local time (day 1 is a Sunday).
const at = (h: number, m = 0, day = 2) => new Date(2026, 10, day, h, m, 0, 0).getTime();
const opts = defaultFocusBlockOptions();
const data = (patch: Partial<FocusBlockData> = {}): FocusBlockData => ({ ...emptyFocusBlockData(), ...patch });

describe('sites and apps', () => {
  it('reads a site from what people type', () => {
    expect(normalizeSite('https://www.Reddit.com/r/all?x=1')).toBe('reddit.com');
    expect(normalizeSite('*.news.example.com')).toBe('news.example.com');
    expect(normalizeSite('example.com/page')).toBe('example.com');
    expect(normalizeSite('not a site')).toBeUndefined();
    expect(normalizeSite('localhost')).toBeUndefined();
    expect(normalizeSite('-bad.com')).toBeUndefined();
  });
  it('a site covers its subdomains, not look-alikes', () => {
    expect(siteFor('old.reddit.com', ['reddit.com'])).toBe('reddit.com');
    expect(siteFor('www.reddit.com.', ['reddit.com'])).toBe('reddit.com');
    expect(siteFor('notreddit.com', ['reddit.com'])).toBeUndefined();
  });
  it('matches apps by name, bundle id or program', () => {
    expect(appFor({ app: 'Steam', appId: 'com.valvesoftware.steam' }, ['steam'])).toBe('steam');
    expect(appFor({ app: 'Discord', appId: 'C:\\Users\\a\\Discord.exe' }, ['discord.exe'])).toBe('discord.exe');
    expect(appFor({ app: 'Safari', appId: 'com.apple.Safari' }, ['com.apple.safari'])).toBe('com.apple.safari');
    expect(appFor({ app: 'Mail' }, ['Steam'])).toBeUndefined();
  });
});

describe('schedules', () => {
  const s = { id: 's', listId: 'news', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60, on: true };
  it('is on during its hours on its days', () => {
    expect(scheduleOn(s, at(10))).toBe(true);
    expect(scheduleOn(s, at(12))).toBe(false);
    expect(scheduleOn(s, at(10, 0, 1))).toBe(false); // Sunday
    expect(scheduleOn({ ...s, on: false }, at(10))).toBe(false);
    expect(scheduleEnd(s, at(10))).toBe(at(12));
  });
  it('runs past midnight when the end is before the start', () => {
    const night = { ...s, days: [1], start: 22 * 60, end: 2 * 60 };
    expect(scheduleOn(night, at(23))).toBe(true);
    expect(scheduleOn(night, at(1, 0, 3))).toBe(true); // Tuesday morning belongs to Monday
    expect(scheduleOn(night, at(1, 0, 2))).toBe(false); // Monday morning belongs to Sunday
    expect(scheduleEnd(night, at(23))).toBe(at(2, 0, 3));
  });
  it('reads clock times', () => {
    expect(parseClock('9:30')).toBe(570);
    expect(parseClock('24:00')).toBeUndefined();
  });
});

describe('the active block', () => {
  it('Focus sessions block the Focus list, until the session ends', () => {
    const b = activeBlock(data(), opts, { now: at(10), focusOn: true, focusEndsAt: at(10, 25) });
    expect(b.on).toBe(true);
    expect(b.sites).toContain('reddit.com');
    expect(b.until).toBe(at(10, 25));
    expect(blockLine(b)).toMatch(/^Blocked until .* · Focus session$/);
    expect(activeBlock(data(), { ...opts, withFocus: false }, { now: at(10), focusOn: true }).on).toBe(false);
    expect(activeBlock(data({ focusList: null }), opts, { now: at(10), focusOn: true }).on).toBe(false);
  });
  it('joins schedules and a block started by hand', () => {
    const d = data({ schedules: [{ id: 's', listId: 'news', days: [1], start: 9 * 60, end: 12 * 60, on: true }], manual: { listId: 'video', until: at(13), strict: false } });
    const b = activeBlock(d, opts, { now: at(10), focusOn: false });
    expect(b.lists.sort()).toEqual(['News', 'Video and games']);
    expect(b.apps).toEqual(['Discord', 'Steam']);
    expect(b.until).toBe(at(13));
    expect(b.strict).toBe(false);
  });
  it('a stopwatch Focus session has no end time', () => {
    expect(activeBlock(data(), opts, { now: at(10), focusOn: true, focusEndsAt: 0 }).until).toBeUndefined();
  });
  it('a strict block started by hand is strict', () => {
    expect(activeBlock(data({ manual: { listId: 'news', until: at(11), strict: true } }), opts, { now: at(10), focusOn: false }).strict).toBe(true);
  });
});

describe('passes and stopping early', () => {
  const d = data({ manual: { listId: 'social', until: at(11), strict: false } });
  const ctx = { now: at(10), focusOn: false };
  it('lets one site through for a few minutes', () => {
    const b = activeBlock(d, opts, ctx);
    const r = takePass(d, b, opts, 'old.reddit.com', at(10));
    if ('error' in r) throw new Error(r.error);
    expect(r.until).toBe(at(10, 5));
    const after = withPasses(b, r.data.passes, at(10, 1));
    expect(after.sites).not.toContain('reddit.com');
    expect(withPasses(b, r.data.passes, at(10, 6)).sites).toContain('reddit.com');
    expect(nextChange(r.data, ctx)).toBe(at(10, 5));
  });
  it('says no in strict mode, and for what is not blocked', () => {
    const strict = activeBlock(d, { ...opts, strict: true }, ctx);
    expect(takePass(d, strict, opts, 'reddit.com', at(10))).toMatchObject({ error: expect.stringMatching(/Strict mode/) });
    expect(takePass(d, activeBlock(d, opts, ctx), opts, 'example.org', at(10))).toEqual({ error: 'That is not blocked.' });
    expect(stopEarly(d, strict, at(10))).toMatchObject({ error: expect.stringMatching(/Strict mode/) });
  });
  it('stopping skips the schedule until it would have ended, and the Focus session until it ends', () => {
    const sd = data({ schedules: [{ id: 's', listId: 'news', days: [1], start: 9 * 60, end: 12 * 60, on: true }] });
    const b = activeBlock(sd, opts, { now: at(10), focusOn: true, focusEndsAt: at(10, 30) });
    const r = stopEarly(sd, b, at(10));
    if ('error' in r) throw new Error(r.error);
    expect(r.data.skipUntil).toBe(at(12));
    expect(r.data.skipFocus).toBe(true);
    expect(activeBlock(r.data, opts, { now: at(10, 1), focusOn: true }).on).toBe(false);
    expect(activeBlock(r.data, opts, { now: at(12, 1), focusOn: false }).on).toBe(false);
  });
  it('wakes at the next schedule edge', () => {
    const sd = data({ schedules: [{ id: 's', listId: 'news', days: [1], start: 9 * 60, end: 12 * 60, on: true }] });
    expect(nextChange(sd, { now: at(8, 30), focusOn: false })).toBe(at(9));
    expect(nextChange(data(), { now: at(8, 30), focusOn: false })).toBeUndefined();
  });
});

describe('stored data and options', () => {
  it('drops what is broken and keeps what is good', () => {
    const d = cleanFocusBlockData({ lists: [{ id: 'a', name: 'A', sites: ['https://x.com/a', 'nope'], apps: ['  Steam '] }, { id: 3 }], schedules: [{ id: 's', listId: 'gone', days: [1] }, { id: 't', listId: 'a', days: [9, 1, 1], start: 2000, end: -5 }], focusList: 'gone', passes: [{ target: 'X.com', until: 5 }] });
    expect(d.lists).toEqual([{ id: 'a', name: 'A', sites: ['x.com'], apps: ['Steam'] }]);
    expect(d.schedules).toEqual([{ id: 't', listId: 'a', days: [1], start: 1439, end: 0, on: true }]);
    expect(d.focusList).toBeNull();
    expect(d.passes).toEqual([{ target: 'x.com', until: 5 }]);
  });
  it('keeps options within sensible limits', () => {
    expect(normalizeFocusBlockOptions({ passMinutes: 500, waitSeconds: -3, strict: 'yes' as never })).toEqual({ withFocus: true, strict: false, passMinutes: 30, waitSeconds: 0, closeApps: false });
  });
  it('counts blocked moments for today only', () => {
    let d = countBlocked(data(), at(10));
    d = countBlocked(d, at(11));
    expect(blockedTodayCount(d, at(12))).toBe(2);
    expect(blockedTodayCount(d, at(12, 0, 3))).toBe(0);
  });
  it('tells the browser only what it needs', () => {
    const b = activeBlock(data(), opts, { now: at(10), focusOn: true, focusEndsAt: at(10, 25) });
    expect(browserBlock(b, opts)).toMatchObject({ strict: false, waitSeconds: 10, passMinutes: 5, why: 'Focus session', until: at(10, 25) });
    expect(browserBlock(activeBlock(data(), opts, { now: at(10), focusOn: false }), opts).sites).toEqual([]);
  });
});
