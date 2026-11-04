// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mail & Calendar part of the sidebar, with the unread count and the
// number of tasks due today (Tasks: the Planner and Reminders as one page). Hidden when all four parts are switched off.

import { useCallback, useEffect, useState } from 'react';
import type { Route } from '../state';
import { api } from '../api';
import { NavSection } from '../components/NavSection';
import { useHiddenRoutes } from '../features';
import { usePimChanges } from './Mail';
import { dayKey, todayTasks } from '../../core/pim/tasks';

type NavItemType = (p: { route: Route; also?: string[]; icon?: string; label: string; count?: number | string }) => React.ReactElement | null;

export function PimSidebar({ Item }: { Item: NavItemType }) {
  const hidden = useHiddenRoutes();
  const [unread, setUnread] = useState(0);
  const [due, setDue] = useState(0);
  const load = useCallback(() => {
    if (!hidden.has('mail')) void api.pim.folders().then((f) => setUnread(f.filter((x) => x.special === 'inbox').reduce((n, x) => n + x.unread, 0))).catch(() => undefined);
    if (!hidden.has('reminders')) void api.pim.reminders().then((r) => setDue(todayTasks(r, dayKey(Date.now())).length)).catch(() => undefined);
  }, [hidden]);
  useEffect(load, [load]);
  usePimChanges(['mail', 'reminders', 'accounts'], load);
  if (['mail', 'calendar', 'reminders', 'planner', 'alarms'].every((r) => hidden.has(r))) return null;
  return (
    <NavSection id="pim" title="Mail & Calendar">
      <Item route={{ name: 'mail' }} icon="mail" label="Mail" count={unread || undefined} />
      <Item route={{ name: 'calendar' }} icon="calendar" label="Calendar" />
      {/* One home for things to do: the Planner's days and the Reminders lists are Tasks' two tabs. */}
      <Item route={{ name: 'planner' }} also={['reminders']} icon="listCheck" label="Tasks" count={due || undefined} />
      <Item route={{ name: 'alarms' }} icon="alarm" label="Clock" />
    </NavSection>
  );
}

