// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which calendars the Island shows: every calendar under where it comes from,
// with its colour and a tick, and Show all / Hide all for each source. The tick
// is the calendar's own "Island" switch (also in Settings → Mail & Calendar), so
// the Calendar and Week tabs and the countdown in the pill all follow it.
// Used in the Island's Calendar tab (a menu) and in Settings → Island.

import { useCallback, useEffect, useState } from 'react';
import { islandCalendarGroups, setAllInIsland, shownInIsland } from '../../core/island-calendars';
import type { CalendarInfo } from '../../core/pim/types';
import { api } from '../api';
import '../styles/island-calendars.css';

/** The calendars and their sources' names, kept up to date. */
export function useIslandCalendars(): [CalendarInfo[], { id: string; label: string }[], () => void] {
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);
  const load = useCallback(() => {
    if (!api.pim) return;
    void api.pim.calendars().then(setCals).catch(() => setCals([]));
    void api.pim.accounts?.().then((a) => setAccounts(a.map((x) => ({ id: x.id, label: x.label })))).catch(() => setAccounts([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never), [load]);
  return [cals, accounts, load];
}

export function CalendarPicker({ cals, accounts, onChanged, variant = 'island' }: {
  cals: CalendarInfo[];
  accounts: { id: string; label: string }[];
  onChanged?: () => void;
  variant?: 'island' | 'settings';
}) {
  // Ticks answer at once; Keeper's calendar list catches up a moment later.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  useEffect(() => setLocal({}), [cals]);
  const groups = islandCalendarGroups(cals, accounts);
  const on = (c: CalendarInfo) => local[c.id] ?? shownInIsland(c);
  const apply = async (changes: { id: string; island: boolean }[]) => {
    if (!changes.length) return;
    setLocal((l) => ({ ...l, ...Object.fromEntries(changes.map((x) => [x.id, x.island])) }));
    for (const x of changes) await api.pim.setCalendar(x.id, { island: x.island }).catch(() => undefined);
    onChanged?.();
  };
  if (!groups.length) return <div className="muted small" data-testid="island-cal-picker">No calendars yet. Add them in Settings → Mail &amp; Calendar.</div>;
  return (
    <div className={`cal-pick cal-pick-${variant}`} data-testid="island-cal-picker">
      {groups.map((g) => {
        const shown = g.calendars.filter((c) => c.visible);
        const all = shown.length > 0 && shown.every(on);
        const none = shown.every((c) => !on(c));
        return (
          <div key={g.key} className="cal-pick-group" role="group" aria-label={g.label}>
            <div className="cal-pick-head">
              <b className="grow ellipsis small">{g.label}</b>
              <button className="btn sm ghost" disabled={all} onClick={() => void apply(setAllInIsland(g.calendars.map((c) => ({ ...c, island: on(c) })), true))}>Show all</button>
              <button className="btn sm ghost" disabled={none} onClick={() => void apply(setAllInIsland(g.calendars.map((c) => ({ ...c, island: on(c) })), false))}>Hide all</button>
            </div>
            {g.calendars.map((c) => (
              <label key={c.id} className={`cal-pick-row${c.visible ? '' : ' off'}`} title={c.visible ? undefined : 'Hidden everywhere in Keeper; show it in Settings → Mail & Calendar first'}>
                <input type="checkbox" checked={c.visible && on(c)} disabled={!c.visible} aria-label={`Show ${c.name} in the Island`} onChange={(e) => void apply([{ id: c.id, island: e.target.checked }])} style={{ accentColor: c.color }} />
                <i className="cal-dot" style={{ background: c.color }} aria-hidden />
                <span className="grow ellipsis">{c.name}</span>
                {c.visible ? null : <span className="muted small">hidden in Keeper</span>}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
