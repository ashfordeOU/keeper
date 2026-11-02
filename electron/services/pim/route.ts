// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Who answers for mail and calendars in the app: this process (Keeper as one
// process, or while Mail and calendars is switched off), or the Mail and
// calendars part in a process of its own (electron/suite/mail.ts, docs/SUITE.md).
// The app's callers use `pimCalls` and `pimToolCalls` instead of the service's
// own objects, so they never need to know where it runs.

import type { PimApi } from '../../../core/api-pim';

/** Sends a call to the part, or returns null for "answer it here". */
export type PimRemote = (name: 'pim' | 'tool' | 'threadOf' | 'logFocus' | 'adoptIslandCalendarUrl', args: unknown[]) => Promise<unknown> | null;

let remote: PimRemote | null = null;
export function setPimRemote(r: PimRemote | null) {
  remote = r;
}
export const pimRemote = () => remote;

const local = () => import('./index');

async function run<T>(name: Parameters<PimRemote>[0], args: unknown[], here: (m: typeof import('./index')) => T | Promise<T>): Promise<T> {
  const r = remote?.(name, args);
  if (r) return r as Promise<T>;
  return here(await local());
}

/** `pim.<method>(…)`, wherever the service runs. */
export const pimCalls = new Proxy({} as PimApi, {
  get: (_t, method) => (typeof method !== 'string' ? undefined : (...args: unknown[]) =>
    run('pim', [method, args], (m) => (m.pim as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args))),
});

/** The questions agents and the `keeper` command ask (services/pim/brain-adapter.ts), wherever the service runs. */
export const pimToolCalls = new Proxy({} as typeof import('./brain-adapter').pimTools, {
  get: (_t, name) => (typeof name !== 'string' ? undefined : (...args: unknown[]) =>
    run('tool', [name, args], async () => ((await import('./brain-adapter')).pimTools as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args))),
});

export const threadOfCall = (id: string) => run('threadOf', [id], (m) => m.threadOf(id));
export const logFocusCall = (minutes: number, taskId?: string) => run('logFocus', [minutes, taskId], (m) => m.logFocus(minutes, taskId));
export const adoptIslandCalendarUrlCall = (url: string | undefined) => run('adoptIslandCalendarUrl', [url], (m) => m.adoptIslandCalendarUrl(url));
