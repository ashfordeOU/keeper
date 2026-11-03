// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Focus blocking: the same pure logic as the app, kept in memory.

import type { FocusBlockApi, FocusBlockStatus } from '../core/api-focus';
import {
  activeBlock, cleanFocusBlockData, defaultFocusBlockOptions, emptyFocusBlockData, livePasses, stopEarly, takePass, withPasses, type FocusBlockData,
} from '../core/focus-block';

export function mockFocusBlock(emit: (channel: string) => void): { focusBlock: FocusBlockApi } {
  let data: FocusBlockData = { ...emptyFocusBlockData(), schedules: [{ id: 's1', listId: 'news', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60, on: true }], blockedToday: { day: new Date().toDateString(), count: 4 } };
  const options = defaultFocusBlockOptions();
  const status = async (): Promise<FocusBlockStatus> => {
    const now = Date.now();
    const block = withPasses(activeBlock(data, options, { now, focusOn: false }), data.passes, now);
    return { data, options, block, passes: livePasses(data, now), blockedToday: data.blockedToday?.count ?? 0, dnsFilter: false, browsers: ['Chrome 131'], appsSupported: true, focusOn: false };
  };
  const change = async (fn: (d: FocusBlockData) => FocusBlockData) => {
    data = cleanFocusBlockData(fn(data));
    emit('focusblock-changed');
    return status();
  };
  const id = () => Math.random().toString(36).slice(2, 8);
  return {
    focusBlock: {
      status,
      saveList: (l) => change((d) => ({ ...d, lists: d.lists.some((x) => x.id === l.id) ? d.lists.map((x) => (x.id === l.id ? l : x)) : [...d.lists, { ...l, id: l.id || id() }] })),
      removeList: (lid) => change((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== lid), schedules: d.schedules.filter((s) => s.listId !== lid) })),
      saveSchedule: (s) => change((d) => ({ ...d, schedules: d.schedules.some((x) => x.id === s.id) ? d.schedules.map((x) => (x.id === s.id ? s : x)) : [...d.schedules, { ...s, id: s.id || id() }] })),
      removeSchedule: (sid) => change((d) => ({ ...d, schedules: d.schedules.filter((s) => s.id !== sid) })),
      setFocusList: (lid) => change((d) => ({ ...d, focusList: lid })),
      start: (listId, minutes, strict) => change((d) => ({ ...d, manual: { listId, until: Date.now() + minutes * 60_000, strict: !!strict } })),
      async stop() {
        const r = stopEarly(data, activeBlock(data, options, { now: Date.now(), focusOn: false }), Date.now());
        if ('error' in r) throw new Error(r.error);
        return change(() => r.data);
      },
      async pass(target) {
        const r = takePass(data, activeBlock(data, options, { now: Date.now(), focusOn: false }), options, target, Date.now());
        if ('error' in r) return { ok: false, message: r.error };
        data = r.data;
        emit('focusblock-changed');
        return { ok: true, until: r.until };
      },
      runningApps: async () => ['Calendar', 'Discord', 'Mail', 'Music', 'Slack', 'Steam'],
      blockedApp: async () => ({ app: 'Steam', line: 'Blocked until 11:30 · Focus session', until: Date.now() + 40 * 60_000, strict: false, passMinutes: 5, waitSeconds: 10 }),
      closeApp: async () => undefined,
      dismiss: async () => undefined,
      testFront: async () => undefined,
    },
  };
}
