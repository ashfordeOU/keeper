// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Trips from your calendar and your bookings: events in the next two weeks
// that have a real place in their location, from Keeper's calendar service
// (pim.upcomingEvents: this computer's calendars, connected accounts and
// subscribed links), and flights, stays and other bookings found in mail by
// Places & Tracks (tracks.reservations), each with that day's forecast and a
// packing hint. A booking and an event at the same place on the same day show once. Locations are looked up with
// the same place search as "Add a place", once per location. When no calendar
// can be read, the calendar service's own access row says why (pim.calendarStatus).

import { useCallback, useEffect, useState } from 'react';
import { bookingStops, dayForecast, geocodeQuery, mergeStops, tripStops, type TripStop } from '../../../core/forecast';
import type { CalendarEvent } from '../../../core/island';
import type { UpcomingEvent } from '../../../core/pim/week-events';
import type { Place, Weather } from '../../../core/weather';
import { condition, packingHint } from '../../../core/weather-view';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/ui';
import { CalendarAccessRow, useCalendarStatus } from '../../pim/week-events-ui';
import { useStore } from '../../state';
import { useFeature } from '../../features';
import { WxGlyph } from './WxGlyph';
import '../../styles/tasks.css';

const DAYS = 14;
const geoCache = new Map<string, Promise<Place | undefined>>();

/** The first place the search finds for a calendar location (cached per location). */
function geocode(location: string): Promise<Place | undefined> {
  const key = location.toLowerCase();
  let hit = geoCache.get(key);
  if (!hit) {
    hit = (async () => {
      for (const q of geocodeQuery(location)) {
        const found = (await api.weather.search(q).catch(() => []))[0];
        if (found) return found;
      }
      return undefined;
    })();
    geoCache.set(key, hit);
  }
  return hit;
}

/** Upcoming events as the simple events the trip finder reads; video meetings are not trips. */
export function asEvents(list: UpcomingEvent[]): CalendarEvent[] {
  return list.filter((e) => e.location && !e.join).map((e) => ({ uid: e.key, title: e.title || 'Untitled event', start: e.start, end: e.end, allDay: e.allDay, location: e.location, color: e.color }));
}

type Stop = TripStop & { lat?: number; lon?: number; booking?: true };
interface Trip { stop: Stop; place?: Place; day?: Weather['daily'][number] }

export function Trips({ units }: { units: 'metric' | 'imperial' }) {
  const { toast } = useStore();
  const [status, reloadStatus] = useCalendarStatus();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const readable = status?.anyReadable ?? false;
  // Bookings found in mail by Places & Tracks.
  const tracksOn = useFeature('tracks');
  const load = useCallback(async () => {
    const now = Date.now();
    const [list, bookings] = await Promise.all([
      readable ? api.pim.upcomingEvents(now, now + DAYS * 86_400_000, { withLocation: true }).catch(() => [] as UpcomingEvent[]) : Promise.resolve([] as UpcomingEvent[]),
      tracksOn ? api.tracks.reservations().catch(() => []) : Promise.resolve([]),
    ]);
    const stops: Stop[] = mergeStops<Stop>(tripStops(asEvents(list), now, DAYS), bookingStops(bookings, now, DAYS)).slice(0, 10);
    setTrips(await Promise.all(stops.map(async (stop): Promise<Trip> => {
      // A booking that came with coordinates needs no place search.
      const place = stop.lat !== undefined && stop.lon !== undefined ? { name: stop.location, lat: stop.lat, lon: stop.lon } : await geocode(stop.location);
      if (!place) return { stop };
      const w = await api.forecast.get(place, units).catch(() => undefined);
      return { stop, place, day: w ? dayForecast(w, stop.day) : undefined };
    })));
  }, [units, readable, tracksOn]);
  useEffect(() => { if (readable || tracksOn) void load(); }, [readable, tracksOn, load]);

  const row = <CalendarAccessRow status={status} onChange={() => { reloadStatus(); if (readable) void load(); }} toast={toast} />;
  if (!status) return <Loading label="Looking at your calendar…" />;
  if (!readable && !trips?.length) {
    return status.row ? row : (
      <div className="wx-cta" role="note">
        <Icon name="calendar" size={20} />
        <div className="grow">
          <b>Keeper can’t see your calendars yet</b>
          <div className="small muted">Events with an address show that day’s forecast here, with what to pack.</div>
        </div>
        <button className="btn sm primary" onClick={() => void api.pim.openCalendarSources().catch(() => undefined)}>Connect a calendar</button>
      </div>
    );
  }
  return (
    <>
      {row}
      {!trips ? <Loading label="Looking at your calendar…" /> : !trips.length ? (
        <div className="wx-empty-note"><Icon name="calendar" size={18} /><div><b>No trips in the next two weeks</b><div className="small muted">Events whose location is a real place (not a meeting link or a room), and flights and stays booked by email{tracksOn ? '' : ' (with Places & Tracks on)'}, show their forecast here.</div></div></div>
      ) : (
        <ul className="wx-trips">
          {trips.map(({ stop, place, day }) => (
            <li key={`${stop.event.uid}-${stop.day}`} className="wx-trip-card">
              <div className="wx-trip-when">
                <span className="wx-trip-dow">{new Date(stop.event.start).toLocaleDateString([], { weekday: 'short' })}</span>
                <span className="wx-trip-dom num">{new Date(stop.event.start).getDate()}</span>
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <h3 className="wx-trip-title">{stop.event.title}{stop.booking ? <span className="pill" style={{ marginLeft: 6 }} title="Found in your mail by Places & Tracks">Booking</span> : null}</h3>
                <div className="small muted">{stop.event.allDay ? 'All day' : new Date(stop.event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {place ? place.name : stop.location}</div>
                {day ? <div className="wx-trip-hint">{packingHint(day, units)}</div> : <div className="small muted">{place ? 'Too far ahead for a forecast' : `Couldn’t find “${stop.location}”`}</div>}
              </div>
              {day ? (
                <div className="wx-trip-w" aria-label={`${condition(day.code).label}, high ${Math.round(day.max)}°, low ${Math.round(day.min)}°, ${day.rainChance}% chance of rain`}>
                  <WxGlyph code={day.code} size={36} label={false} />
                  <div>
                    <div className="num"><b>{Math.round(day.max)}°</b> <span className="muted">{Math.round(day.min)}°</span></div>
                    <div className="small muted num"><Icon name="drop" size={10} /> {day.rainChance}%</div>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
