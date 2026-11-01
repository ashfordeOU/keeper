// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Usage: …" commands for the command palette (hidden while the tracker is off).

import { api } from '../../api';
import type { Route } from '../../state';

export function usageCommands(toast: (t: string) => void, go: (r: Route) => void) {
  return [
    { id: 'usage-page', label: 'Usage: Show AI Usage', group: 'Go to' as const, icon: 'chart', route: 'aiusage', keywords: 'ai limits tokens credits quota left reset weekly 5-hour subscription', run: () => go({ name: 'aiusage' }) },
    { id: 'usage-glance', label: 'Usage: Show in the Glance', group: 'Actions' as const, icon: 'chart', keywords: 'ai limits tray menu bar owl', run: () => void api.glance.show() },
    { id: 'usage-refresh', label: 'Usage: Refresh Now', group: 'Actions' as const, icon: 'refresh', keywords: 'ai limits update', run: async () => { const o = await api.aiUsage.refresh(); toast(o.summary.allClear ? 'AI usage: nothing is running out' : `AI usage: ${o.summary.runningOut.length} running out, ${o.summary.usedUp.length} used up`); } },
    { id: 'usage-add', label: 'Usage: Add an Account…', group: 'Actions' as const, icon: 'plus', keywords: 'ai api key subscription codex', run: () => go({ name: 'aiusage', arg: 'accounts' }) },
    { id: 'usage-subscriptions', label: 'Usage: Subscriptions', group: 'Go to' as const, icon: 'coin', route: 'aiusage', keywords: 'renewal trial cost monthly', run: () => go({ name: 'aiusage', arg: 'subscriptions' }) },
    { id: 'usage-costs', label: 'Usage: Costs per Month', group: 'Go to' as const, icon: 'chart', route: 'aiusage', keywords: 'spend dollars budget', run: () => go({ name: 'aiusage', arg: 'costs' }) },
    { id: 'usage-export', label: 'Usage: Export CSV…', group: 'Actions' as const, icon: 'down', keywords: 'history download', run: async () => { const r = await api.aiUsage.exportCsv(); if (r.path) toast(`Saved to ${r.path}`); } },
    { id: 'usage-pause', label: 'Usage: Pause or Resume Tracking', group: 'Actions' as const, icon: 'pause', keywords: 'stop ai usage', run: async () => { const o = await api.aiUsage.overview(); await api.aiUsage.setSettings({ paused: !o.settings.paused }); toast(o.settings.paused ? 'AI usage tracking resumed' : 'AI usage tracking paused'); } },
    { id: 'usage-menubar', label: 'Usage: Glance and Warning Settings…', group: 'Actions' as const, icon: 'settings', keywords: 'tray label menu bar owl', run: () => go({ name: 'settings', arg: 'menubar' }) },
  ];
}
