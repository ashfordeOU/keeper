// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { actionForKey, addToInbox, cleanInbox, eventText, INBOX_MAX, itemTitle, newInboxItem, noteLine, snippetAbbr, SORT_ACTIONS, sortNudge, taskFrom } from '../core/inbox';

const T = new Date(2026, 10, 4, 14, 5).getTime();
const hm = (t: number) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

describe('catching', () => {
  it('keeps words as they were said or typed', () => {
    expect(newInboxItem({ text: '  Call the bank  ', source: 'card' }, T, '1')).toEqual({ id: '1', at: T, kind: 'text', text: 'Call the bank', source: 'card' });
    expect(newInboxItem({ text: 'renew insurance', kind: 'voice' }, T, '2')?.kind).toBe('voice');
    expect(newInboxItem({ text: '   ' }, T, '3')).toBeNull();
    expect(newInboxItem({}, T, '3')).toBeNull();
  });
  it('notices a link, alone or in words', () => {
    expect(newInboxItem({ text: 'https://example.org/a?b=1' }, T, '1')).toMatchObject({ kind: 'link', text: '', url: 'https://example.org/a?b=1' });
    expect(newInboxItem({ text: 'read later https://example.org/x tonight' }, T, '2')).toMatchObject({ kind: 'link', text: 'read later tonight', url: 'https://example.org/x' });
  });
  it('tells screenshots from other files', () => {
    expect(newInboxItem({ path: '/u/Desktop/Shot 1.png' }, T, '1')?.kind).toBe('shot');
    expect(newInboxItem({ path: '/u/report.pdf', text: 'for Monday' }, T, '2')).toMatchObject({ kind: 'file', text: 'for Monday', path: '/u/report.pdf' });
    expect(newInboxItem({ path: '/u/photo.jpg', kind: 'file' }, T, '3')?.kind).toBe('file');
  });
  it('reads back only good items, newest first, and keeps at most the limit', () => {
    const raw = [{ id: 'a', kind: 'text', text: 'x', at: 1 }, { id: 'b', kind: 'link', text: '', url: 'https://e.org', at: 3 }, { id: 'a', kind: 'text', text: 'dup', at: 2 }, { id: 'c', kind: 'odd', text: 'x', at: 2 }, { id: 'd', kind: 'text', text: '', at: 4 }, null, 'x'];
    expect(cleanInbox(raw).map((i) => i.id)).toEqual(['b', 'a']);
    expect(cleanInbox('nope')).toEqual([]);
    let list = cleanInbox([]);
    for (let i = 0; i < INBOX_MAX + 5; i++) list = addToInbox(list, newInboxItem({ text: `n${i}` }, i, `id${i}`)!);
    expect(list).toHaveLength(INBOX_MAX);
    expect(list[0].id).toBe(`id${INBOX_MAX + 4}`);
  });
});

describe('sorting', () => {
  it('has five choices on the keys 1 to 5', () => {
    expect(SORT_ACTIONS.map((a) => a.id)).toEqual(['task', 'note', 'event', 'snippet', 'delete']);
    expect(actionForKey('1')).toBe('task');
    expect(actionForKey('5')).toBe('delete');
    expect(actionForKey('6')).toBeUndefined();
  });
  it('says how long sorting takes, about fifteen seconds each', () => {
    expect(sortNudge(0)).toBe('Nothing to sort');
    expect(sortNudge(1)).toBe('1 thing to sort, about 1 min');
    expect(sortNudge(7)).toBe('7 things to sort, about 2 min');
  });
  it('makes a task, a note line, an event and a snippet from an item', () => {
    const it2 = newInboxItem({ text: 'Plan the trip\nbook the train\nfind a hotel' }, T, '1')!;
    expect(taskFrom(it2)).toEqual({ title: 'Plan the trip', notes: 'book the train\nfind a hotel' });
    const link = newInboxItem({ text: 'https://www.example.org/guides/trains/' }, T, '2')!;
    expect(itemTitle(link)).toBe('example.org/guides/trains');
    expect(taskFrom(link)).toEqual({ title: 'example.org/guides/trains', url: 'https://www.example.org/guides/trains/' });
    expect(noteLine(it2, hm)).toBe('- 14:05 Plan the trip book the train find a hotel');
    expect(noteLine(newInboxItem({ text: 'read this https://e.org/a' }, T, '3')!, hm)).toBe('- 14:05 read this · [e.org/a](https://e.org/a)');
    expect(noteLine(newInboxItem({ path: '/u/My shot.png' }, T, '4')!, hm)).toBe('- 14:05 [My shot.png](<file:///u/My shot.png>)');
    expect(noteLine(newInboxItem({ path: 'C:\\Users\\ana\\a.png' }, T, '5')!, hm)).toBe('- 14:05 [a.png](<file:///C:/Users/ana/a.png>)');
    expect(eventText(newInboxItem({ text: 'Lunch with Ana\nfriday 1pm' }, T, '6')!)).toBe('Lunch with Ana friday 1pm');
    expect(itemTitle(newInboxItem({ text: 'x'.repeat(100) }, T, '7')!)).toHaveLength(80);
  });
  it('suggests a free abbreviation for a snippet', () => {
    expect(snippetAbbr('My address is 1 High Street', [])).toBe(';my');
    expect(snippetAbbr('Address: 1 High Street', [';addres'])).toBe(';addres2');
    expect(snippetAbbr('Address', [';addres', ';addres2'])).toBe(';addres3');
    expect(snippetAbbr('!!', [])).toBe(';note');
  });
});
