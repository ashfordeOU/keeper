// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What opens from an event: Join, its own link, links in its notes, its place
// and its attached files; attachments read and written in .ics.

import { describe, expect, it } from 'vitest';
import { eventOpenables, linkLabel, safeLink } from '../core/pim/event-links';
import { parseEvents, serializeEvents } from '../core/pim/ical';

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
