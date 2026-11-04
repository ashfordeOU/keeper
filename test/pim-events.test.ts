// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What opens from an event: Join, its own link, links in its notes, its place
// and its attached files; attachments read and written in .ics.

import { describe, expect, it } from 'vitest';
import { eventOpenables, linkLabel, safeLink } from '../core/pim/event-links';
import { occurrences, parseEvents, serializeEvents } from '../core/pim/ical';

describe('opening things from an event', () => {
  it('finds Join, the event’s link, links in the notes and the place', () => {
    const o = eventOpenables({
      location: '12 High Street, Leeds',
      url: 'https://docs.example.com/agenda',
      description: 'Join: https://meet.google.com/abc-defg-hij\nSlides at www.slides.example/deck. Old: https://docs.example.com/agenda\nNot this: file:///etc/passwd or javascript:alert(1)',
    });
    expect(o.join).toBe('https://meet.google.com/abc-defg-hij');
    expect(o.links.map((l) => l.url)).toEqual(['https://docs.example.com/agenda', 'https://www.slides.example/deck']);
    expect(o.place).toBe('12 High Street, Leeds');
  });
  it('leaves out a place that is a link or only says “online”', () => {
    expect(eventOpenables({ location: 'https://zoom.us/j/123' }).place).toBeUndefined();
    expect(eventOpenables({ location: 'Online' }).place).toBeUndefined();
  });
  it('opens only web and mail links', () => {
    expect(safeLink('mailto:ana@example.org')).toBe('mailto:ana@example.org');
    expect(safeLink('file:///x')).toBeUndefined();
    expect(safeLink('www.example.org')).toBe('https://www.example.org');
    expect(linkLabel('https://www.example.org/plan')).toBe('example.org/plan');
  });
  it('reads attachments from .ics and writes them back', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261102T100000Z', 'DTEND:20261102T110000Z', 'SUMMARY:Review',
      'ATTACH;FMTTYPE=application/pdf:https://files.example/brief.pdf',
      'ATTACH;FMTTYPE=text/plain;ENCODING=BASE64;VALUE=BINARY;X-FILENAME=notes.txt:aGVsbG8=',
      'ATTACH:file:///etc/hosts', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const [e] = parseEvents(ics, 'c');
    expect(e.attachments).toEqual([{ name: 'brief.pdf', type: 'application/pdf', url: 'https://files.example/brief.pdf' }, { name: 'notes.txt', type: 'text/plain', data: 'aGVsbG8=' }]);
    expect(eventOpenables(e).attachments).toEqual([{ index: 0, name: 'brief.pdf', url: 'https://files.example/brief.pdf' }, { index: 1, name: 'notes.txt', url: undefined }]);
    const [back] = parseEvents(serializeEvents([e]), 'c');
    expect(back.attachments).toEqual(e.attachments);
  });
});

describe('years of events', () => {
  it('reads and expands thousands of events and repeats across ten years quickly', () => {
    const lines = ['BEGIN:VCALENDAR'];
    const pad = (n: number) => String(n).padStart(2, '0');
    for (let i = 0; i < 4000; i++) {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000);
      lines.push('BEGIN:VEVENT', `UID:e${i}`, `DTSTART:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T090000Z`, `DTEND:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T100000Z`, `SUMMARY:Event ${i}`, 'END:VEVENT');
    }
    for (let i = 0; i < 200; i++) lines.push('BEGIN:VEVENT', `UID:r${i}`, 'DTSTART;TZID=Europe/London:20200106T091500', 'DTEND;TZID=Europe/London:20200106T093000', `RRULE:FREQ=WEEKLY;BYDAY=${['MO', 'TU', 'WE', 'TH', 'FR'][i % 5]}`, `SUMMARY:Standup ${i}`, 'END:VEVENT');
    lines.push('END:VCALENDAR');
    let t = performance.now();
    const evs = parseEvents(lines.join('\r\n'), 'c');
    const parseMs = performance.now() - t;
    t = performance.now();
    const year = occurrences(evs, Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    const yearMs = performance.now() - t;
    t = performance.now();
    const week = occurrences(evs, Date.UTC(2029, 5, 4), Date.UTC(2029, 5, 11));
    const weekMs = performance.now() - t;
    expect(evs).toHaveLength(4200);
    expect(year.filter((o) => o.event.uid === 'r0')).toHaveLength(52);
    // 9:15 in London stays 9:15 across the clock change.
    const summer = year.find((o) => o.event.uid === 'r0' && new Date(o.start).getUTCMonth() === 6)!;
    expect(new Date(summer.start).getUTCHours()).toBe(8);
    expect(week.filter((o) => o.event.uid.startsWith('r'))).toHaveLength(200);
    // Seconds, not minutes: shared Windows build machines run this two to three times slower than a laptop.
    expect(parseMs + yearMs + weekMs).toBeLessThan(15_000);
  }, 30_000);
});

