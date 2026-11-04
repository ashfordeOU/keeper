// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { phoneFileHit, phoneToday, uploadedName } from '../core/phone-today';

const at = (h: number, m = 0, day = 4) => new Date(2026, 10, day, h, m).getTime();
const NOW = at(10, 30);

describe('the phone’s Today', () => {
  it('lists today’s events in order, all-day first, and marks the one on now', () => {
    const t = phoneToday(NOW, [
      { id: 'b', title: 'Lunch with Ana', start: at(13), end: at(14) },
      { id: 'a', title: 'Stand-up', start: at(10), end: at(11) },
      { id: 'x', title: 'Yesterday', start: at(9, 0, 3), end: at(10, 0, 3) },
      { id: 'd', title: 'Holiday', start: at(0), end: at(0, 0, 5), allDay: true },
      { id: 'e', title: 'Done already', start: at(8), end: at(9) },
    ], [], 0);
    expect(t.day).toBe('Wednesday 4 November');
    expect(t.events.map((e) => [e.title, e.when, !!e.now])).toEqual([['Holiday', 'All day', false], ['Stand-up', '10:00–11:00', true], ['Lunch with Ana', '13:00–14:00', false]]);
  });

  it('shows open tasks due today, overdue first, and says how many more', () => {
    const tasks = [
      { id: '1', title: 'Pay the plumber', due: at(17) },
      { id: '2', title: 'Send the invoice', due: at(9, 0, 2) },
      { id: '3', title: 'Next week', due: at(9, 0, 11) },
      { id: '4', title: 'Done', due: at(9), done: true },
      { id: '5', title: 'Planned', plannedFor: '2026-11-04' },
    ];
    const t = phoneToday(NOW, [], tasks, 3, { events: 6, tasks: 2 });
    expect(t.tasks.map((x) => [x.title, x.note])).toEqual([['Send the invoice', 'Overdue'], ['Pay the plumber', '17:00']]);
    expect(t.moreTasks).toBe(1);
    expect(t.inbox).toBe(3);
  });

  it('describes a found file by its folder in words', () => {
    expect(phoneFileHit({ path: '/home/ana/Documents/Taxes/2025.pdf', name: '2025.pdf', size: 10, kind: 'document' }, '/home/ana')).toMatchObject({ where: '~/Documents/Taxes', name: '2025.pdf' });
    expect(phoneFileHit({ path: '/home/ana/a.txt', name: 'a.txt', size: 1, kind: 'text' }, '/home/ana/').where).toBe('~');
    expect(phoneFileHit({ path: 'D:\\Photos\\x.jpg', name: 'x.jpg', size: 1, kind: 'image' }, 'C:\\Users\\ana').where).toBe('D:\\Photos');
  });

  it('accepts only a plain file name for something the phone uploaded', () => {
    expect(uploadedName('IMG_1.jpg')).toBe('IMG_1.jpg');
    for (const bad of ['../x', 'a/b', '.hidden', '', 'x\0y', '..']) expect(uploadedName(bad)).toBeNull();
  });
});
