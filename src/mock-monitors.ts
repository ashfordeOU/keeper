// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's monitors: three sites, one of them down, in memory.

import type { MonitorsApi, MonitorsOverview, MonitorView } from '../core/api-monitors';
import { newMonitor, parseMonitorList, type SiteMonitor } from '../core/site-monitor';

export function mockMonitors(): { monitors: MonitorsApi } {
  const now = Date.now();
  let list: SiteMonitor[] = [newMonitor({ id: 'a', kind: 'http', target: 'https://shop.example.com', name: 'Shop' }), newMonitor({ id: 'b', kind: 'tcp', target: 'mail.example.com', port: 993 }), newMonitor({ id: 'c', kind: 'http', target: 'https://status.example.org' })];
  const view = (m: SiteMonitor): MonitorView => ({ ...m, rt: m.id === 'c' ? { state: 'down', fails: 3, since: now - 720_000, last: { at: now - 60_000, ok: false, message: 'The site answered 503 (unavailable)' } } : { state: 'up', fails: 0, since: now - 86_400_000 * 3, last: { at: now - 60_000, ok: true, ms: 120 + m.id.charCodeAt(0) } }, uptime24: m.id === 'c' ? 97.9 : 100, uptime7: 99.7, uptime30: 99.9, typicalMs: 140 });
  const overview = async (): Promise<MonitorsOverview> => ({ monitors: list.map(view), counts: { up: list.filter((m) => m.id !== 'c').length, down: list.some((m) => m.id === 'c') ? 1 : 0, pending: 0, paused: 0 } });
  return {
    monitors: {
      overview,
      detail: async (id) => ({ monitor: view(list.find((m) => m.id === id)!), series: Array.from({ length: 48 }, (_, i) => ({ t: now - (48 - i) * 1800_000, ms: 110 + Math.round(Math.sin(i / 4) * 30), ok: !(id === 'c' && i > 44) })), recent: [] }),
      save: async (p) => { const m = newMonitor(p); list = [...list.filter((x) => x.id !== m.id), m]; return view(m); },
      remove: async (id) => { list = list.filter((m) => m.id !== id); return overview(); },
      setOn: async (id, on) => { list = list.map((m) => (m.id === id ? { ...m, on } : m)); return overview(); },
      checkNow: async () => ({ at: Date.now(), ok: true, ms: 130 }),
      importList: async (text) => { const r = parseMonitorList(text); list = [...list, ...r.monitors]; return { added: r.monitors.length, skipped: r.skipped }; },
      exportList: async () => list.map((m) => m.target).join('\n'),
    },
  };
}
