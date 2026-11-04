// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { addNotice, batchSummary, decide, defaultNoticeSettings, deliveryOf, groupByPart, holdLine, holdReason, inQuietHours, markAllDone, markDone, nextBatchAt, normalizeNoticeSettings, NOTICE_PARTS, openNotices, quietEnds, releaseAt, SAME_WITHIN, type Notice, type NoticeSettings } from '../core/notices';
import { defaultSettings, mergeSettings } from '../core/settings';
import { FEATURES } from '../core/features';

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m, 0, 0);
const s = (patch: Partial<NoticeSettings> = {}): NoticeSettings => ({ ...defaultNoticeSettings(), ...patch });
const n = (id: string, part: string, t: number, extra: Partial<Notice> = {}): Notice => ({ id, part, title: `${part} ${id}`, at: t, ...extra });

describe('notification settings', () => {
  it('reads stored settings leniently', () => {
    expect(normalizeNoticeSettings(null)).toEqual(defaultNoticeSettings());
    const x = normalizeNoticeSettings({ delivery: { mail: 'silent', nope: 'now', monitors: 'loud' }, batch: 'hourly', quiet: { on: true, from: '23:30', to: '7:00' }, followFocus: false });
    expect(x.delivery).toEqual({ mail: 'silent' });
    expect(x.batch).toBe('hourly');
    expect(x.quiet).toEqual({ on: true, from: '23:30', to: '08:00' });
    expect(x.followFocus).toBe(false);
    expect(x.followSystem).toBe(true);
  });
  it('are part of Keeper’s settings, and every part with a feature names a real one', () => {
    expect(mergeSettings(defaultSettings([], []), { notices: { batch: 'hourly' } }).notices.batch).toBe('hourly');
    expect(defaultSettings([], []).notices).toEqual(defaultNoticeSettings());
    for (const p of NOTICE_PARTS) if (p.feature) expect(FEATURES.some((f) => f.id === p.feature), p.id).toBe(true);
    expect(FEATURES.find((f) => f.id === 'notices')?.defaultOn).toBe(true);
  });
  it('mail and monitors come now, the Fix-it List and updates are batched, until the person chooses', () => {
    expect(deliveryOf('mail', s())).toBe('now');
    expect(deliveryOf('fixit', s())).toBe('batched');
    expect(deliveryOf('updates', s())).toBe('batched');
    expect(deliveryOf('mail', s({ delivery: { mail: 'silent' } }))).toBe('silent');
    expect(deliveryOf('something-new', s())).toBe('batched');
  });
});

describe('quiet hours', () => {
  const q = { on: true, from: '22:00', to: '08:00' };
  it('go past midnight', () => {
    expect(inQuietHours(at(23), q)).toBe(true);
    expect(inQuietHours(at(3), q)).toBe(true);
    expect(inQuietHours(at(8), q), 'ends at 08:00').toBe(false);
    expect(inQuietHours(at(12), q)).toBe(false);
    expect(inQuietHours(at(23), { ...q, on: false })).toBe(false);
    expect(inQuietHours(at(13), { on: true, from: '12:00', to: '14:00' })).toBe(true);
  });
  it('end at the next "to" time', () => {
    expect(new Date(quietEnds(at(23), q)).getDate()).toBe(5);
    expect(new Date(quietEnds(at(3), q)).getHours()).toBe(8);
    expect(new Date(quietEnds(at(3), q)).getDate()).toBe(4);
  });
});

describe('what happens to a new notice', () => {
  it('is shown, held or only listed', () => {
    expect(decide({ part: 'mail' }, s(), { now: at(10) })).toBe('show');
    expect(decide({ part: 'fixit' }, s(), { now: at(10) })).toBe('hold');
    expect(decide({ part: 'mail' }, s({ delivery: { mail: 'silent' } }), { now: at(10) })).toBe('list');
  });
  it('is held in quiet hours, while focusing, while snoozed or in the system’s Do Not Disturb', () => {
    const quiet = s({ quiet: { on: true, from: '22:00', to: '08:00' } });
    expect(decide({ part: 'mail' }, quiet, { now: at(23) })).toBe('hold');
    expect(decide({ part: 'mail' }, s(), { now: at(10), focus: true })).toBe('hold');
    expect(decide({ part: 'mail' }, s({ followFocus: false }), { now: at(10), focus: true })).toBe('show');
    expect(decide({ part: 'mail' }, s(), { now: at(10), snoozedUntil: at(11).getTime() })).toBe('hold');
    expect(decide({ part: 'mail' }, s(), { now: at(10), systemQuiet: true })).toBe('hold');
    expect(holdReason(s(), { now: at(10), snoozedUntil: at(9).getTime() })).toBeNull();
  });
  it('urgent ones (alarms, a restart about to happen) always come through', () => {
    const quiet = s({ quiet: { on: true, from: '22:00', to: '08:00' }, delivery: { updates: 'silent' } });
    expect(decide({ part: 'updates', urgent: true }, quiet, { now: at(23), focus: true, snoozedUntil: at(23, 30).getTime() })).toBe('show');
  });
});

describe('batches', () => {
  it('go out at 9, 13 and 17, or every hour', () => {
    expect(new Date(nextBatchAt(at(10, 5), s())).getHours()).toBe(13);
    expect(new Date(nextBatchAt(at(8), s())).getHours()).toBe(9);
    const late = new Date(nextBatchAt(at(18), s()));
    expect([late.getDate(), late.getHours()]).toEqual([5, 9]);
    const h = new Date(nextBatchAt(at(10, 5), s({ batch: 'hourly' })));
    expect([h.getHours(), h.getMinutes()]).toEqual([11, 0]);
  });
  it('wait for quiet hours or a snooze to end; a part set to Now goes as soon as the hold ends', () => {
    const quiet = s({ quiet: { on: true, from: '12:00', to: '14:00' } });
    // A batched notice at 10:00 would go at 13:00, inside quiet hours: it waits until 14:00.
    expect(new Date(releaseAt([{ part: 'fixit' }], quiet, { now: at(10) })).getHours()).toBe(14);
    // Mail (Now) held by a snooze goes when the snooze ends.
    expect(releaseAt([{ part: 'mail' }], s(), { now: at(10), snoozedUntil: at(11).getTime() })).toBe(at(11).getTime());
    // Held while focusing: looked at again in a minute.
    expect(releaseAt([{ part: 'mail' }], s(), { now: at(10), focus: true })).toBe(at(10, 1).getTime());
  });
  it('become one calm summary', () => {
    expect(batchSummary([n('1', 'mail', 1, { title: 'Ana', detail: 'Lunch?' })])).toEqual({ title: 'Ana', detail: 'Lunch?' });
    const sum = batchSummary([n('1', 'mail', 1), n('2', 'mail', 2), n('3', 'monitors', 3)]);
    expect(sum.title).toBe('3 notices');
    expect(sum.detail).toBe('2 from Mail, 1 from Sites and servers');
  });
});

describe('the list', () => {
  it('keeps the newest first and counts the same notice again', () => {
    let list: Notice[] = [];
    list = addNotice(list, n('a', 'monitors', 1000, { title: 'Site down' }));
    list = addNotice(list, n('b', 'mail', 2000));
    list = addNotice(list, n('c', 'monitors', 3000, { title: 'Site down', detail: 'again' }));
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ count: 2, detail: 'again', at: 3000 });
    list = addNotice(list, n('d', 'monitors', 3000 + SAME_WITHIN + 1, { title: 'Site down' }));
    expect(list).toHaveLength(3);
  });
  it('keeps at most 200', () => {
    let list: Notice[] = [];
    for (let i = 0; i < 230; i++) list = addNotice(list, n(String(i), 'mail', i * SAME_WITHIN * 2));
    expect(list).toHaveLength(200);
    expect(list[0].id).toBe('229');
  });
  it('marks one or all done, and groups what is open by part in a fixed order', () => {
    const list = [n('1', 'monitors', 5), n('2', 'mail', 1), n('3', 'mail', 9), n('4', 'unknown-part', 2)];
    expect(openNotices(markDone(list, '1'))).toHaveLength(3);
    expect(openNotices(markAllDone(list))).toHaveLength(0);
    const g = groupByPart(list);
    expect(g.map((x) => x.part.id)).toEqual(['mail', 'monitors', 'keeper']);
    expect(g[0].items.map((x) => x.id)).toEqual(['3', '2']);
  });
  it('says why nothing is shown', () => {
    const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
    const quiet = s({ quiet: { on: true, from: '22:00', to: '08:00' } });
    expect(holdLine('quiet', quiet, { now: at(23) }, clock)).toBe('Quiet until 08:00');
    expect(holdLine('snoozed', s(), { now: at(10), snoozedUntil: at(11, 30).getTime() }, clock)).toBe('Snoozed until 11:30');
    expect(holdLine('focus', s(), { now: at(10) }, clock)).toBe('Held while you focus');
    expect(holdLine(null, s(), { now: at(10) }, clock)).toBeNull();
  });
});
