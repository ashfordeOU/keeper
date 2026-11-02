// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calendar events beside the planner's days (the Island's Week tab and the
// Planner page) and the "Keeper can't see your calendars yet" row shared by
// every view that shows events. Read when shown and when the calendar service
// says something changed; never on a timer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Occurrence, CalendarInfo } from '../../core/pim/types';
import { eventsByDay, weekEventTime, type CalendarStatus, type WeekEvent } from '../../core/pim/week-events';
import { dayStart, addDays } from '../../core/pim/tasks';
import { api } from '../api';
import { openNative } from '../lib/native';
import { Icon } from '../components/Icon';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** pim.calendarStatus, read again whenever calendars or accounts change. */
export function useCalendarStatus(): [CalendarStatus | null, () => void] {
  const [s, setS] = useState<CalendarStatus | null>(null);
  const load = useCallback(() => { void api.pim?.calendarStatus?.().then(setS).catch(() => undefined); }, []);
  useEffect(() => {
    load();
    return api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never);
  }, [load]);
  return [s, load];
}

/** The inline row: why no events show, with the one button that fixes it. */
export function CalendarAccessRow({ status, onChange, toast }: { status: CalendarStatus | null; onChange: () => void; toast?: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const row = status?.row;
  if (!row) return null;
  const act = async () => {
    setBusy(true);
    try {
      if (row.action === 'allow') {
        const a = await api.pim.systemAccess(true);
        if (a.state !== 'granted') toast?.(a.message);
      } else if (row.action === 'settings' && row.settingsUrl) {
        await openNative('settings', { page: { darwin: row.settingsUrl } }, toast);
      } else if (row.action === 'turnOn') {
        await api.pim.setPrefs({ systemCalendars: true });
      } else if (row.action === 'enableFeature') {
        await api.features.set('calendars', true);
      }
    } catch (e) {
      toast?.(clean(e));
    } finally {
      setBusy(false);
      onChange();
    }
  };
  const label = row.action === 'allow' ? 'Allow' : row.action === 'settings' ? 'Open Privacy Settings' : row.action === 'turnOn' ? 'Turn on' : row.action === 'enableFeature' ? 'Turn on Calendars' : '';
  return (
    <div className="cal-access-row" role="note" data-testid="calendar-access-row">
      <Icon name="calendar" size={14} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="cal-access-title">{row.title}</div>
        <div className="small muted">{row.detail}</div>
      </div>
      <div className="cal-access-btns">
        {label ? <button className="btn sm primary" disabled={busy} onClick={() => void act()}>{label}</button> : null}
        {row.connect ? <button className="btn sm" onClick={() => void api.pim.openCalendarSources().catch(() => undefined)} title="Connect a Google, Microsoft 365 / Outlook or CalDAV calendar in Keeper">Connect Google / Outlook calendar</button> : null}
      </div>
    </div>
  );
}

/**
 * Events for a run of days (yyyy-mm-dd) from every calendar Keeper reads,
 * read when the days change and when the calendar service reports a change.
 */
export function useWeekEvents(days: string[], o: { island?: boolean; watch?: boolean } = {}): Map<string, WeekEvent[]> {
  const [occ, setOcc] = useState<Occurrence[]>([]);
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const from = days.length ? dayStart(days[0]) : 0;
  const to = days.length ? dayStart(addDays(days[days.length - 1], 1)) : 0;
  const load = useCallback(() => {
    if (!api.pim || !days.length) return;
    void api.pim.occurrences(from, to).then(setOcc).catch(() => setOcc([]));
    void api.pim.calendars().then(setCals).catch(() => setCals([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const ref = useRef(load);
  ref.current = load;
  useEffect(load, [load]);
  useEffect(() => api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') ref.current(); }) as never), []);
  // Shown now: the calendar service looks for changes sooner for a few minutes (its own schedule, no timer here).
  // A desktop widget is always shown, so it leaves the service to its usual pace (watch: false).
  const watch = o.watch !== false;
  useEffect(() => {
    if (!watch) return undefined;
    void api.pim?.watchCalendar?.(true).catch(() => undefined);
    return () => { void api.pim?.watchCalendar?.(false).catch(() => undefined); };
  }, [watch]);
  const key = days.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => eventsByDay(occ, cals, days, { island: o.island }), [occ, cals, key, o.island]);
}

/** A day's events: colour, time and title, read only; a click opens it in the calendar app. */
export function DayEvents({ events, toast }: { events: WeekEvent[]; toast?: (t: string) => void }) {
  if (!events.length) return null;
  return (
    <div className="wk-events" data-testid="week-day-events">
      {events.map((e) => (
        <button key={e.key} className={`wk-ev${e.allDay || e.part !== 'single' ? ' wide' : ''}`} style={{ ['--ev' as string]: e.color }} title={`${e.title}${e.location ? ` · ${e.location}` : ''} · ${e.calendarName} — Open in Calendar`}
          onClick={() => void openNative('calendar', { eventUrl: e.openUrl, date: e.start }, toast)} data-testid="week-event">
          <i className="wk-dot" aria-hidden />
          <span className="wk-time">{weekEventTime(e, timeOf)}</span>
          <span className="wk-title">{e.title}</span>
        </button>
      ))}
    </div>
  );
}
