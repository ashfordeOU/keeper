import { describe, expect, it } from 'vitest';
import { meetingNow } from '../core/island-activities';

const H = 3_600_000, M = 60_000, now = Date.UTC(2026, 10, 3, 12);
const ev = (o: Partial<Parameters<typeof meetingNow>[0][number]>) => ({ uid: 'e', title: 'x', start: now, end: now + H, allDay: false, ...o });

describe('meetingNow', () => {
  it('shows an event from 15 minutes before until 10 minutes after it starts', () => {
    expect(meetingNow([ev({ start: now + 14 * M })], now)).toBeTruthy();
    expect(meetingNow([ev({ start: now + 16 * M, end: now + 2 * H })], now)).toBeUndefined();
    expect(meetingNow([ev({ start: now - 9 * M })], now)).toBeTruthy();
    expect(meetingNow([ev({ start: now - 11 * M })], now)).toBeUndefined();
  });
  it('keeps a meeting with a link until it ends', () => {
    expect(meetingNow([ev({ start: now - 40 * M, location: 'https://zoom.us/j/123' })], now)).toBeTruthy();
  });
  it('never shows all-day or long events', () => {
    expect(meetingNow([ev({ allDay: true })], now)).toBeUndefined();
    expect(meetingNow([ev({ start: now - M, end: now + 5 * H })], now)).toBeUndefined();
  });
});
