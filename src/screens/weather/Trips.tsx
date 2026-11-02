// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Trips from your calendar: events in the next two weeks that have a real
// place in their location, from Keeper's own calendar service (this
// computer's calendars, connected accounts and subscribed links), each with
// that day's forecast and a packing hint. Locations are looked up with the
// same place search as "Add a place", once per location.

import { useCallback, useEffect, useState } from 'react';
import { dayForecast, geocodeQuery, tripStops, type TripStop } from '../../../core/forecast';
import type { CalendarEvent } from '../../../core/island';
import type { SystemAccess } from '../../../core/pim/syscal';
import type { CalendarInfo, Occurrence } from '../../../core/pim/types';
import type { Place, Weather } from '../../../core/weather';
import { condition, packingHint } from '../../../core/weather-view';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Loading, Modal } from '../../components/ui';
import { CalendarSources } from '../../pim/CalendarSources';
import { WxGlyph } from './WxGlyph';

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

/** Calendar occurrences as the simple events the trip finder reads. */
export function asEvents(occ: Occurrence[]): CalendarEvent[] {
  return occ.map((o) => ({ uid: `${o.event.id}@${o.instance}`, title: o.event.title || 'Untitled event', start: o.start, end: o.end, allDay: o.event.allDay, location: o.event.location, url: o.event.url }));
}

interface Trip { stop: TripStop; place?: Place; day?: Weather['daily'][number] }

type State =
  | { kind: 'loading' }
  | { kind: 'no-calendars'; access: SystemAccess | null }
  | { kind: 'ready'; trips: Trip[]; access: SystemAccess | null };

const needsAsk = (a: SystemAccess | null) => !!a && (a.state === 'notDetermined' || a.state === 'denied' || a.state === 'restricted');

export function Trips({ units }: { units: 'metric' | 'imperial' }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [connect, setConnect] = useState(false);
  const load = useCallback(async () => {
    const now = Date.now();
    const [cals, access] = await Promise.all([
      api.pim.calendars().catch(() => [] as CalendarInfo[]),
      api.pim.systemAccess().catch(() => null),
    ]);
    // Holidays, birthdays and task lists have no trips in them.
    const real = cals.filter((c) => !c.tasks && c.source !== 'holidays' && c.source !== 'birthdays');
    const usable = real.filter((c) => c.source !== 'system' || !access || access.state === 'granted' || access.state === 'unavailable');
    if (!usable.length) { setState({ kind: 'no-calendars', access }); return; }
    const occ = await api.pim.occurrences(now, now + DAYS * 86_400_000).catch(() => [] as Occurrence[]);
    const stops = tripStops(asEvents(occ), now, DAYS).slice(0, 10);
    const trips = await Promise.all(stops.map(async (stop): Promise<Trip> => {
      const place = await geocode(stop.location);
      if (!place) return { stop };
      const w = await api.forecast.get(place, units).catch(() => undefined);
      return { stop, place, day: w ? dayForecast(w, stop.day) : undefined };
    }));
    setState({ kind: 'ready', trips, access });
  }, [units]);
  useEffect(() => { void load(); }, [load]);

  const cta = (access: SystemAccess | null) => (
    <div className="wx-cta" role="note">
      <Icon name="calendar" size={20} />
      <div className="grow">
        <b>Keeper can’t see your calendars yet</b>
        <div className="small muted">Events with an address show that day’s forecast here, with what to pack.</div>
      </div>
      {needsAsk(access) && access?.canRequest ? <button className="btn sm primary" onClick={() => void api.pim.systemAccess(true).then(() => load())}>Allow</button> : null}
      <button className={`btn sm ${needsAsk(access) && access?.canRequest ? '' : 'primary'}`} onClick={() => setConnect(true)}>Connect a calendar</button>
    </div>
  );

  return (
    <>
      {state.kind === 'loading' ? <Loading label="Looking at your calendar…" />
        : state.kind === 'no-calendars' ? cta(state.access)
        : !state.trips.length ? (
          <>
            {needsAsk(state.access) ? cta(state.access) : null}
            <div className="wx-empty-note"><Icon name="calendar" size={18} /><div><b>No trips in the next two weeks</b><div className="small muted">Events whose location is a real place (not a meeting link or a room) show their forecast here.</div></div></div>
          </>
        ) : (
          <>
            {needsAsk(state.access) ? cta(state.access) : null}
            <ul className="wx-trips">
              {state.trips.map(({ stop, place, day }) => (
                <li key={`${stop.event.uid}-${stop.day}`} className="wx-trip-card">
                  <div className="wx-trip-when">
                    <span className="wx-trip-dow">{new Date(stop.event.start).toLocaleDateString([], { weekday: 'short' })}</span>
                    <span className="wx-trip-dom num">{new Date(stop.event.start).getDate()}</span>
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3 className="wx-trip-title">{stop.event.title}</h3>
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
          </>
        )}
      {connect ? <Modal title="Calendars" onClose={() => { setConnect(false); void load(); }} width={620}><CalendarSources /></Modal> : null}
    </>
  );
}
