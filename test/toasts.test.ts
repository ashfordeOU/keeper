// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { expireToast, pushToast, type ToastItem } from '../src/lib/toasts';

describe('toasts', () => {
  it('collapses the same text within a few seconds into one with a count', () => {
    let list: ToastItem[] = [];
    list = pushToast(list, 'Linked', undefined, 1000, 1).list;
    const r = pushToast(list, 'Linked', undefined, 1500, 2);
    expect(r.id).toBe(1);
    list = pushToast(r.list, 'Linked', undefined, 2000, 3).list;
    expect(list).toEqual([expect.objectContaining({ id: 1, text: 'Linked', count: 3, at: 2000 })]);
  });

  it('shows it again as new once the window has passed, and keeps different texts apart', () => {
    let list: ToastItem[] = pushToast([], 'Saved', undefined, 0, 1).list;
    list = pushToast(list, 'Saved', undefined, 6000, 2).list;
    list = pushToast(list, 'Cleared', undefined, 6100, 3).list;
    expect(list.map((t) => [t.id, t.count])).toEqual([[1, 1], [2, 1], [3, 1]]);
  });

  it('a toast with a key replaces the one showing with that key instead of stacking (switching modes quickly)', () => {
    let list: ToastItem[] = pushToast([], 'Saved', undefined, 0, 1).list;
    list = pushToast(list, 'Focus is on.', undefined, 100, 2, 5000, 'mode').list;
    list = pushToast(list, 'Pro is on.', undefined, 200, 3, 5000, 'mode').list;
    const r = pushToast(list, 'Writer is on.', undefined, 300, 4, 5000, 'mode');
    expect(r.id).toBe(2);
    expect(r.list.map((t) => t.text)).toEqual(['Saved', 'Writer is on.']);
    expect(r.list[1]).toMatchObject({ count: 1, at: 300, key: 'mode' });
  });

  it('keeps at most three and moves a repeated one to the bottom', () => {
    let list: ToastItem[] = [];
    for (const [i, t] of ['a', 'b', 'c', 'd'].entries()) list = pushToast(list, t, undefined, i, i + 1).list;
    expect(list.map((t) => t.text)).toEqual(['b', 'c', 'd']);
    list = pushToast(list, 'b', undefined, 10, 9).list;
    expect(list.map((t) => `${t.text}${t.count}`)).toEqual(['c1', 'd1', 'b2']);
  });

  it('a refreshed toast outlives the first timer; it goes when its own time is up', () => {
    let list: ToastItem[] = pushToast([], 'x', undefined, 0, 1).list;
    list = pushToast(list, 'x', undefined, 3000, 2).list;
    expect(expireToast(list, 1, 4000)).toHaveLength(1);
    expect(expireToast(list, 1, 7000)).toHaveLength(0);
  });
});
