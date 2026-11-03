// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Site and server monitors as the window sees them (core/site-monitor.ts has the logic).

import type { CheckResult, MonitorRuntime, SiteMonitor } from './site-monitor';

export interface MonitorView extends SiteMonitor {
  rt: MonitorRuntime;
  /** percent of checks that were up */
  uptime24?: number;
  uptime7?: number;
  uptime30?: number;
  /** typical response time over the last day */
  typicalMs?: number;
  /** checking right now */
  checking?: boolean;
}

export interface MonitorsOverview {
  monitors: MonitorView[];
  counts: { up: number; down: number; pending: number; paused: number };
}

export interface MonitorDetail {
  monitor: MonitorView;
  /** the last day in half-hour steps */
  series: { t: number; ms: number | null; ok: boolean | null }[];
  /** the last checks, newest first */
  recent: CheckResult[];
}

export interface MonitorsApi {
  overview(): Promise<MonitorsOverview>;
  detail(id: string): Promise<MonitorDetail>;
  /** adds or changes a monitor (checked straight away) */
  save(m: Partial<SiteMonitor> & Pick<SiteMonitor, 'kind' | 'target'>): Promise<MonitorView>;
  remove(id: string): Promise<MonitorsOverview>;
  setOn(id: string, on: boolean): Promise<MonitorsOverview>;
  checkNow(id: string): Promise<CheckResult>;
  /** a plain list, one per line (see parseMonitorList) */
  importList(text: string): Promise<{ added: number; skipped: string[] }>;
  exportList(): Promise<string>;
}
