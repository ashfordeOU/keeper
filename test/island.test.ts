// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { ClipHistory, agentStateFromTail, currentLine, focusLeft, looksSecret, newFocus, nextEvent, parseIcs, parseLrc, pauseFocus, resumeFocus, startFocus, tickFocus } from '../core/island';

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:1
DTSTART:20261030T160000Z
DTEND:20261030T163000Z
SUMMARY:Design review\\, round 2
LOCATION:Room 4
END:VEVENT
BEGIN:VEVENT
UID:2
DTSTART;VALUE=DATE:20261031
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:3
DTSTART:20261026T090000
DTEND:20261026T091500
RRULE:FREQ=DAILY;COUNT=10
EXDATE:20261031T090000
SUMMARY:Stand-
 up
END:VEVENT
BEGIN:VEVENT
UID:4
STATUS:CANCELLED
DTSTART:20261030T170000Z
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR`;

describe('calendar', () => {
  it('parses events, folding, escapes and recurrence', () => {
    const from = new Date(2026, 9, 30).getTime();
    const ev = parseIcs(ICS, from, from + 2 * 86_400_000);
    const titles = ev.map((e) => e.title);
    expect(titles).toContain('Design review, round 2');
    expect(titles).toContain('Holiday');
    expect(titles.filter((t) => t === 'Stand-up')).toHaveLength(1); // 30th only; 31st is excluded
    expect(titles).not.toContain('Cancelled');
    const next = nextEvent(ev, Date.UTC(2026, 9, 30, 15));
    expect(next?.title).toBe('Design review, round 2');
  });
});

describe('lyrics', () => {
  it('parses LRC and finds the current line', () => {
    const lines = parseLrc('[ti:Song]\n[00:01.50]Hello\n[00:05.00][00:20.00]Chorus\n[00:10.25]Verse');
    expect(lines.map((l) => l.text)).toEqual(['Hello', 'Chorus', 'Verse', 'Chorus']);
    expect(currentLine(lines, 0)).toBe(-1);
    expect(lines[currentLine(lines, 11)].text).toBe('Verse');
    expect(lines[currentLine(lines, 25)].text).toBe('Chorus');
  });
});

describe('agents', () => {
  const now = 1_000_000_000;
  const toolUse = JSON.stringify({ type: 'assistant', cwd: '/p/app', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } });
  const reply = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] } });
  it('waiting / working / done', () => {
    expect(agentStateFromTail([toolUse], now - 20_000, now)).toMatchObject({ state: 'waiting', summary: 'Wants to use Bash', cwd: '/p/app' });
    expect(agentStateFromTail([toolUse], now - 2_000, now).state).toBe('working');
    expect(agentStateFromTail([reply], now - 60_000, now)).toMatchObject({ state: 'done', summary: 'All done.' });
    expect(agentStateFromTail([reply], now - 2 * 3600_000, now).state).toBe('idle');
    expect(agentStateFromTail(['{"type":"error","error":{"type":"api_error"}}'], now - 60_000, now).state).toBe('stuck');
  });
});

describe('clipboard', () => {
  it('dedupes, moves re-copied items up, keeps pinned items', () => {
    const h = new ClipHistory(3);
    h.add({ kind: 'text', text: 'a' }, 1);
    h.add({ kind: 'text', text: 'a' }, 2);
    h.add({ kind: 'text', text: 'b' }, 3);
    h.togglePin(h.items[1].id); // pin 'a'
    h.add({ kind: 'text', text: 'c' }, 4);
    h.add({ kind: 'text', text: 'd' }, 5);
    expect(h.items.map((i) => i.text)).toEqual(['d', 'c', 'a']);
    h.add({ kind: 'text', text: 'a' }, 6);
    expect(h.items[0]).toMatchObject({ text: 'a', pinned: true });
  });
  it('spots secrets', () => {
    expect(looksSecret('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksSecret('Tr0ub4dor&3x!')).toBe(true);
    expect(looksSecret('hello world')).toBe(false);
    expect(looksSecret('https://Example.com/A1?x=y')).toBe(false);
  });
});

describe('focus timer', () => {
  it('runs focus, break, pause', () => {
    let s = startFocus(newFocus(25, 5), 25, 0);
    expect(focusLeft(s, 60_000)).toBe(24 * 60_000);
    s = pauseFocus(s, 60_000);
    expect(focusLeft(s, 999_999)).toBe(24 * 60_000);
    s = resumeFocus(s, 100_000);
    let r = tickFocus(s, 100_000 + 24 * 60_000);
    expect(r.event).toBe('focus-done');
    expect(r.state.mode).toBe('break');
    r = tickFocus(r.state, 100_000 + 30 * 60_000);
    expect(r.event).toBe('break-done');
    expect(r.state.mode).toBe('idle');
  });
});
