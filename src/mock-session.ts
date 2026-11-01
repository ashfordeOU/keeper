// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browser demo: tabs kept in localStorage, and a sample list of Keeper's processes.

import { DEFAULT_LIMITS } from '../core/limits';
import type { KeeperProcess, SessionApi, SvcApi } from '../core/api-session';
import type { WindowState } from '../core/session';

const KEY = 'demo.session';
let held = 0;

export function mockSession(): { session: SessionApi; svc: SvcApi } {
  const procs = (): KeeperProcess[] => [
    { id: 'main', label: 'Keeper (main process)', kind: 'main', pid: 4120, state: 'running', cpu: 0.4, memory: 168e6, startedAt: Date.now() - 3 * 3600e3, canStop: false, canRestart: true, detail: 'Coordinates everything else; Restart quits and opens Keeper again, with your tabs.' },
    { id: 'window:1', label: 'Main window', kind: 'window', pid: 4133, state: 'running', cpu: 0.6, memory: 212e6, startedAt: Date.now() - 3 * 3600e3, canStop: false, canRestart: true, detail: 'Restart reloads it with its tabs' },
    { id: 'window:2', label: 'Island', kind: 'window', pid: 4140, state: 'running', cpu: 0.1, memory: 74e6, startedAt: Date.now() - 3 * 3600e3, canStop: false, canRestart: true, detail: 'Restart reloads it with its tabs' },
    { id: 'gpu', label: 'Graphics', kind: 'gpu', pid: 4125, state: 'running', cpu: 0.2, memory: 96e6, canStop: false, canRestart: false, detail: 'Draws Keeper’s windows; the system restarts it if it fails.' },
    { id: 'svc:net', label: 'Network Activity', kind: 'service', pid: 4201, state: 'running', cpu: 0.3, memory: 61e6, startedAt: Date.now() - 4 * 60e3, restarts: 1, lastCrash: { at: Date.now() - 50 * 60e3, reason: 'stopped unexpectedly (exit code 1)' }, feature: 'netwatch', canStop: true, canRestart: true, detail: 'Runs on its own: if it stops, the rest of Keeper carries on and it starts again.' },
    { id: 'terminal-host', label: 'Terminal sessions', kind: 'service', pid: 4188, state: 'running', cpu: 0, memory: 38e6, feature: 'terminal', canStop: false, canRestart: false, detail: 'Keeps your terminals running when Keeper’s windows close, and after a crash.' },
  ];
  const session: SessionApi = {
    initial: () => {
      try {
        const state = JSON.parse(localStorage.getItem(KEY) ?? 'null') as WindowState | null;
        return { key: 'main', state, crashed: false, safeMode: false };
      } catch {
        return { key: 'main', state: null, crashed: false, safeMode: false };
      }
    },
    save: (w) => { try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* demo */ } },
    openWindow: async () => 'w1',
    lastSession: async () => Date.now() - 3600e3,
    log: async () => ({ log: [{ at: Date.now() - 50 * 60e3, kind: 'service-restarted', detail: 'Network Activity: stopped unexpectedly (exit code 1)' }, { at: Date.now() - 26 * 3600e3, kind: 'page-crashed', detail: 'main: crashed (exit code 133)' }], dumps: [], crashedLastTime: false, safeMode: false }),
    openDumps: async () => undefined,
    report: async () => 'Keeper 0.1.0 (demo)\nNo problems recorded.',
    relaunch: async () => undefined,
  };
  const svc: SvcApi = {
    list: async () => procs(),
    stop: async () => procs(),
    restart: async () => procs(),
    stopAllWork: async (resume) => { held = resume ? 0 : Date.now() + 3600e3; return { stopped: resume ? [] : ['indexing and reading text', 'meaning search', 'sync and backups', 'regular checks'], heldUntil: held }; },
    held: async () => held,
    limits: async () => ({ limits: DEFAULT_LIMITS, events: [], cpu: 0.4, overSince: 0, helpers: 0 }),
  };
  return { session, svc };
}
