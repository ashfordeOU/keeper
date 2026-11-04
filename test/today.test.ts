// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import type { AgendaItem } from '../core/pim/agenda';
import type { Task } from '../core/pim/tasks';
import { defaultSettings, mergeSettings } from '../core/settings';
import { backupLateAfter, backupNote, cardSpan, daysAgo, defaultTodaySettings, followUpLine, mailStripCompact, normalizeToday, nowNext, onThisDayFiles, QUIET_CARDS, recapLine, replyLine, setCardShown, sizeForPreset, startsIn, TODAY_CARDS, TODAY_SIZES, timeLeft, todayCards, topTasks, visibleCards, yearsAgo } from '../core/today';

const MIN = 60_000;
const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const ev = (key: string, start: number, end: number, o: Partial<AgendaItem> = {}): AgendaItem => ({ key, eventId: key, instance: start, title: key, start, end, allDay: false, color: '#06f', calendar: 'c', calendarName: 'Work', past: false, now: false, ...o });
const task = (id: string, o: Partial<Task> = {}): Task => ({ id, list: 'local', title: id, done: false, ...o });

describe('Today cards', () => {
  it('follow the preset: a calm three, the usual five (plus quiet ones that show only when needed), or all', () => {
    expect(sizeForPreset('light')).toBe('simple');
    expect(sizeForPreset('files')).toBe('simple');
    expect(sizeForPreset('everything')).toBe('full');
    expect(sizeForPreset('recommended')).toBe('standard');
    expect(sizeForPreset(undefined)).toBe('standard');
    expect(TODAY_SIZES.simple).toHaveLength(3);
    expect(visibleCards(TODAY_SIZES.standard, {})).toHaveLength(5);
    expect(TODAY_SIZES.full).toEqual(TODAY_CARDS.map((c) => c.id));
    expect(todayCards({ cards: null }, 'everything', () => true)).toHaveLength(TODAY_CARDS.length);
  });
  it('leave out cards whose part is off, and keep the person’s own choice', () => {
    expect(visibleCards(todayCards({ cards: null }, 'recommended', (f) => f !== 'mail'), {})).toEqual(['now', 'tasks', 'inbox', 'fixit']);
    expect(todayCards({ cards: ['focus', 'now'] }, 'everything', () => true)).toEqual(['focus', 'now']);
  });
  it('show and hide one card, coming back in its usual place', () => {
    expect(setCardShown(['now', 'tasks', 'fixit'], 'tasks', false)).toEqual(['now', 'fixit']);
    expect(setCardShown(['now', 'fixit'], 'reply', true)).toEqual(['now', 'reply', 'fixit']);
    expect(setCardShown(['now'], 'now', true)).toEqual(['now']);
  });
  it('share a 12-column row: three in one row, otherwise Now and tasks on top', () => {
    expect(cardSpan(['now', 'tasks', 'focus'], 'focus')).toBe(4);
    const five = visibleCards(TODAY_SIZES.standard, {});
    expect(cardSpan(five, 'now')).toBe(6);
    expect(cardSpan(five, 'reply')).toBe(4);
    expect(cardSpan(TODAY_SIZES.full, 'focus')).toBe(3);
    expect(cardSpan(['reply'], 'reply')).toBe(12);
  });
});

describe('the quiet cards', () => {
  const now = new Date(2026, 10, 4, 10).getTime();
  const DAY = 86_400_000;
  it('take no room until they have something to say', () => {
    expect(QUIET_CARDS).toEqual(['followup', 'backup', 'onthisday']);
    expect(visibleCards(['now', 'backup', 'followup', 'recap'], { backup: true })).toEqual(['now', 'backup', 'recap']);
  });
  it('a backup is worth a word when it went wrong or is late for its schedule', () => {
    const job = (o: object) => ({ id: 'b', name: 'Photos', schedule: { kind: 'daily' }, created: now - 30 * DAY, ...o });
    expect(backupNote([job({ lastRun: now - DAY / 2, lastOk: true })], now)).toBeUndefined();
    expect(backupNote([job({ lastRun: now - 3 * DAY, lastOk: true })], now)).toMatchObject({ line: 'Last backup 3 days ago', late: true });
    expect(backupNote([job({ lastRun: now - 3 * DAY, lastOk: true }), job({ id: 'c', name: 'Work', lastRun: now - DAY / 4, lastOk: false })], now)).toMatchObject({ id: 'c', line: 'Last backup went wrong today' });
    expect(backupNote([job({ paused: true, lastRun: now - 30 * DAY })], now)).toBeUndefined();
    expect(backupNote([job({ created: now - 3 * DAY })], now)?.line).toBe('Not backed up yet');
    expect(backupLateAfter({ kind: 'weekly' })).toBe(9 * DAY);
    expect(daysAgo(now - DAY - 1000, now)).toBe('yesterday');
  });
  it('On this day finds files from this day in earlier years, never screenshots, newest first', () => {
    const f = (y: number, m: number, d: number, o: object = {}) => ({ btime: new Date(y, m, d, 12).getTime(), mtime: 0, ...o });
    const out = onThisDayFiles([f(2025, 10, 4), f(2024, 10, 4), f(2026, 10, 4), f(2025, 10, 5), f(2023, 10, 4, { screenshot: true })], now);
    expect(out.map((x) => new Date(x.btime).getFullYear())).toEqual([2025, 2024]);
    expect(yearsAgo(out[1].btime, now)).toBe('2 years ago');
    expect(yearsAgo(out[0].btime, now)).toBe('A year ago');
  });
  it('the week and follow-ups in plain words', () => {
    expect(recapLine({ tasks: 6, focusMin: 150 }, 4)).toBe('6 tasks done · 2 h 30 min focused · 4 days in a row');
    expect(recapLine({ tasks: 1, focusMin: 0 }, 1)).toBe('1 task done · no focus time yet');
    expect(followUpLine(1)).toBe('1 message you sent waits for an answer');
    expect(followUpLine(3)).toBe('3 messages you sent wait for an answer');
  });
});

describe('Today settings', () => {
  it('fall back to the defaults and keep a working day of at least an hour', () => {
    expect(normalizeToday(undefined)).toEqual(defaultTodaySettings());
    const t = normalizeToday({ cards: ['now', 'bogus', 'now', 'tasks'], seen: '2026-11-04', dayStart: 600, dayEnd: 630, captureShortcut: 'Alt+Space' });
    expect(t.cards).toEqual(['now', 'tasks']);
    expect(t.seen).toBe('2026-11-04');
    expect([t.dayStart, t.dayEnd]).toEqual([540, 1050]);
    expect(t.captureShortcut).toBe('Alt+Space');
    expect(normalizeToday({ seen: 'yesterday', dayStart: -5, dayEnd: 99_999 })).toMatchObject({ seen: '', dayStart: 0, dayEnd: 1440 });
  });
  it('are read with the rest of the settings', () => {
    expect(defaultSettings([], []).today).toEqual(defaultTodaySettings());
    expect(mergeSettings(defaultSettings([], []), { today: { cards: ['focus'] } }).today.cards).toEqual(['focus']);
    expect(mergeSettings(defaultSettings([], []), { today: 'nonsense' }).today).toEqual(defaultTodaySettings());
  });
  it('make Mail’s strip one line once Today was seen today', () => {
    expect(mailStripCompact('2026-11-04', '2026-11-04')).toBe(true);
    expect(mailStripCompact('2026-11-03', '2026-11-04')).toBe(false);
    expect(mailStripCompact('', '2026-11-04')).toBe(false);
    expect(mailStripCompact(undefined, '2026-11-04')).toBe(false);
  });
});

describe('now and next', () => {
  it('picks what is on now (a call first), the next one, and counts the rest', () => {
    const now = at(10, 10);
    const items = [
      ev('All hands', at(0), at(23, 59), { allDay: true }),
      ev('Earlier', at(8), at(9)),
      ev('Focus', at(10), at(11)),
      ev('Call', at(10), at(10, 30), { join: 'https://meet.example/x' }),
      ev('Lunch', at(12), at(13)),
      ev('Review', at(15), at(16)),
    ];
    const n = nowNext(items, now);
    expect(n.now?.title).toBe('Call');
    expect(n.next?.title).toBe('Lunch');
    expect(n.later).toBe(1);
    expect(n.allDay.map((a) => a.title)).toEqual(['All hands']);
    expect(nowNext([], now)).toEqual({ now: undefined, next: undefined, allDay: [], later: 0 });
  });
  it('says how long is left and how long until', () => {
    expect(timeLeft(at(10, 30), at(10, 10))).toBe('20 min left');
    expect(timeLeft(at(11, 15), at(10, 10))).toBe('1 h 5 min left');
    expect(timeLeft(at(12, 10), at(10, 10))).toBe('2 h left');
    expect(startsIn(at(10, 35), at(10, 10))).toBe('in 25 min');
    expect(startsIn(at(12, 10), at(10, 10))).toBe('in 2 h');
    expect(startsIn(at(11, 20), at(10, 10) + 30_000)).toBe('in 1 h 10 min');
    expect(timeLeft(at(10, 10), at(10, 10) + MIN)).toBe('1 min left');
  });
});

describe('the top three tasks', () => {
  it('are today’s, important ones first, then the person’s order; done and other days are left out', () => {
    const list = [
      task('a', { plannedFor: '2026-11-04', order: 1 }),
      task('b', { plannedFor: '2026-11-04', order: 2, priority: 3 }),
      task('c', { plannedFor: '2026-11-02', order: 3 }), // carried over
      task('d', { plannedFor: '2026-11-04', order: 0, done: true, doneAt: at(9) }),
      task('e', { plannedFor: '2026-11-05' }),
      task('f', { plannedFor: '2026-11-04', order: 4 }),
    ];
    expect(topTasks(list, '2026-11-04').map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(topTasks([], '2026-11-04')).toEqual([]);
  });
  it('words for mail waiting', () => {
    expect(replyLine(1)).toBe('1 message waits for your reply');
    expect(replyLine(4)).toBe('4 messages wait for your reply');
  });
});
