// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which calendars the Island shows: the calendars picker (the Island's Calendar
// tab and Settings → Island) lists every calendar under where it comes from, with
// its colour and a tick. The tick is the calendar's own "Island" switch
// (CalendarInfo.island, also in Settings → Mail & Calendar), which the Calendar
// and Week tabs and the countdown in the pill already follow (core/pim/agenda.ts
// inIsland, core/pim/week-events.ts). Pure.

import type { CalendarInfo } from './pim/types';

export interface CalendarGroup {
  key: string;
  label: string;
  calendars: CalendarInfo[];
}

/** Has events to show: not a task list (Keeper's own calendar holds both). */
export const holdsEvents = (c: Pick<CalendarInfo, 'tasks' | 'account'>) => !c.tasks || c.account === 'local';

/** Shown in the Island: shown in Keeper at all, and not switched off for the Island. */
export const shownInIsland = (c: Pick<CalendarInfo, 'visible' | 'island'>) => c.visible && c.island !== false;

/** Calendars with events (not task lists), grouped by where they come from, in a steady order. */
export function islandCalendarGroups(cals: CalendarInfo[], accounts: { id: string; label: string }[] = []): CalendarGroup[] {
  const groups = new Map<string, CalendarGroup>();
  const label = new Map(accounts.map((a) => [a.id, a.label]));
  for (const c of cals) {
    if (!holdsEvents(c)) continue;
    const [key, name] = c.source === 'system' ? [`system:${c.group ?? ''}`, `This computer${c.group ? ` · ${c.group}` : ''}`]
      : c.source === 'holidays' || c.source === 'birthdays' ? ['extras', 'Holidays and birthdays']
        : c.account === 'local' ? ['local', 'Keeper']
          : [`account:${c.account}`, label.get(c.account) ?? 'Connected'];
    const g = groups.get(key) ?? { key, label: name, calendars: [] };
    g.calendars.push(c);
    groups.set(key, g);
  }
  const rank = (k: string) => (k.startsWith('system:') ? 0 : k.startsWith('account:') ? 1 : k === 'local' ? 2 : 3);
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
}

/**
 * The changes "Show all" / "Hide all" make in one group: only calendars whose Island switch
 * differs (a calendar hidden in Keeper itself stays as it is; it is switched on in Mail & Calendar).
 */
export function setAllInIsland(group: CalendarInfo[], on: boolean): { id: string; island: boolean }[] {
  return group.filter((c) => c.visible && holdsEvents(c) && (c.island !== false) !== on).map((c) => ({ id: c.id, island: on }));
}

/** "3 of 5" for the picker's button; empty when every calendar shows. */
export function hiddenSummary(cals: CalendarInfo[]): string {
  const list = cals.filter((c) => holdsEvents(c) && c.visible);
  const on = list.filter(shownInIsland).length;
  return on === list.length ? '' : `${on} of ${list.length}`;
}
