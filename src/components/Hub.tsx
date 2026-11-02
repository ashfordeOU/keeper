// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A merged page (System Controls, Privacy & Security, Startup & Apps): one
// title and a row of tabs, each tab the old page under its old route, so links,
// the palette and the keeper command keep working.

import type { ReactNode } from 'react';
import { HUB_TABS, hubOf, navPage, type NavRoute } from '../../core/nav';
import { useHiddenRoutes } from '../features';
import { useStore, type Route } from '../state';
import { HubContext } from './page-context';
import { Tabs } from './Tabs';

const keyOf = (r: NavRoute) => `${r.name}${r.arg ? `:${r.arg}` : ''}`;

export function Hub({ id, children }: { id: string; children: ReactNode }) {
  const { route, go } = useStore();
  const hidden = useHiddenRoutes();
  const tabs = (HUB_TABS[id] ?? []).filter((t) => !hidden.has(t.route.name) || t.route.name === route.name);
  const cur = hubOf(route)?.tab;
  const title = navPage(id)?.label ?? '';
  const bar = tabs.length > 1 ? (
    <Tabs
      label={title}
      className="hub-tabs"
      items={tabs.map((t) => ({ id: keyOf(t.route), label: t.label, testId: `hub-tab-${t.route.name}` }))}
      value={cur ? keyOf(cur.route) : undefined}
      onChange={(k) => { const t = tabs.find((x) => keyOf(x.route) === k); if (t) go(t.route as Route); }}
    />
  ) : null;
  return <HubContext.Provider value={{ title, tabs: bar }}>{children}</HubContext.Provider>;
}
