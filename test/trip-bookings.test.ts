// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { bookingStops, mergeStops, tripStops } from '../core/forecast';

const now = new Date(2026, 10, 2, 9).getTime();
const day = 86_400_000;

describe('bookings from mail in Weather → Trips', () => {
  it('a stay where it is, a flight where it lands, nothing past two weeks or already over', () => {
    const s = bookingStops([
      { id: 'h', kind: 'lodging', name: 'Hotel Avenida', start: now + 3 * day, end: now + 5 * day, address: 'Av. da Liberdade 1, Lisbon' },
      { id: 'f', kind: 'flight', name: 'TP 1351', start: now + 3 * day - 6 * 3600_000, to: 'LIS', from: 'LHR' } as never,
      { id: 'late', kind: 'lodging', name: 'Later', start: now + 30 * day, address: 'Porto' },
      { id: 'past', kind: 'event', name: 'Done', start: now - 3 * day, end: now - 2 * day, address: 'Madrid' },
    ], now);
    expect(s.map((x) => x.location)).toEqual(['LIS airport', 'Av. da Liberdade 1, Lisbon']);
    expect(s[0].event.title).toBe('Flight to LIS · TP 1351');
    expect(s[1].event.allDay).toBe(true);
  });

  it('merges with calendar trips, one per place and day, the calendar first', () => {
    const cal = tripStops([{ uid: 'c', title: 'Web Summit', start: now + 3 * day, end: now + 3 * day + 3600_000, allDay: false, location: 'Av. da Liberdade 1, Lisbon' }], now);
    const books = bookingStops([{ id: 'h', kind: 'lodging', name: 'Hotel', start: now + 3 * day, address: 'Av. da Liberdade 1, Lisbon' }, { id: 'e', kind: 'event', name: 'Concert', start: now + 4 * day, address: 'Altice Arena, Lisbon' }], now);
    const m = mergeStops(cal, books);
    expect(m.map((x) => x.event.title)).toEqual(['Web Summit', 'Event · Concert']);
  });
});
