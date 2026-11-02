// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of Keep Awake in the browser preview: sessions run on a timer, triggers
// are tested against a pretend computer.

import type { AwakeApi, AwakeStatus } from '../core/api-awake';
import { describeCondition, newSession, parseDuration, ruleMatches, summarize, triggerConditionHolds, type AwakeSettings, type Facts, type Session, type SessionRecord } from '../core/awake-engine';
import type { AllSettings } from '../core/settings';

export function mockAwake(get: () => AllSettings, apply: (patch: Partial<AllSettings>) => void, emit: (ch: string, ...a: unknown[]) => void): { awake: AwakeApi } {
  let session: Session | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = Date.now();
  let records: SessionRecord[] = [
    { start: now - 26 * 3600_000, end: now - 23 * 3600_000, source: 'manual', reason: 'For 3 h', why: 'Time is up' },
    { start: now - 50 * 3600_000, end: now - 49 * 3600_000, source: 'trigger', reason: 'Presenting on the projector', why: 'The trigger no longer applies', batteryUsed: 6 },
    { start: now - 4 * 3600_000, end: now - 3.2 * 3600_000, source: 'cli', reason: 'While “ffmpeg” is running', why: 'No longer “ffmpeg” is running' },
  ];
  const facts = (): Facts => ({
    now: Date.now(), onPower: true, battery: 82, charging: true, externalDisplays: 1, apps: ['Finder', 'Safari', 'Keynote', 'Terminal'], frontApp: 'Keynote', cpu: 23,
    usb: ['USB-C Hub', 'Keychron K2'], bluetooth: ['AirPods Pro'], volumes: ['/Volumes/Backup'], ssid: 'Studio-5G', interfaces: ['en0', 'utun3'], ips: ['192.168.1.24'], dns: ['1.1.1.1'],
    idleSec: 12, agentsRunning: 1, terminalSessions: 2, keeperJobs: [], downloadsActive: 0, audioPlaying: false, calendarBusy: false,
  });
  const status = (): AwakeStatus => {
    const cfg = get().awake;
    const f = facts();
    return {
      on: !!session,
      session: session && { id: session.id, startedAt: session.startedAt, endsAt: session.endsAt, reason: session.reason, source: session.source, while: session.while, options: session.options, triggerId: session.triggerId },
      matching: cfg.triggers.filter((t) => t.enabled && ruleMatches(t, f)).map((t) => t.name),
      holds: session ? ['powerSaveBlocker (prevent-display-sleep)', 'caffeinate'] : [],
      closedDisplay: !!session?.options.closedDisplay && cfg.closedDisplayAgreed,
      closedLidReady: cfg.closedDisplayAgreed,
      displayAllowed: !session || session.options.display === 'allow-sleep',
      checking: !!session || cfg.triggers.some((t) => t.enabled),
      platform: 'darwin',
      supports: { closedDisplay: true, focus: 'shortcuts', cursor: true, lock: true, thermal: true },
    };
  };
  const changed = () => {
    const st = status();
    emit('awake-changed', st);
    emit('island-changed');
    return st;
  };
  const stop = (why = 'Turned off') => {
    if (session) records = [...records, { start: session.startedAt, end: Date.now(), source: session.source, reason: session.reason, why }];
    session = undefined;
    clearTimeout(timer);
    return changed();
  };
  const begin: AwakeApi['start'] = async (spec = {}) => {
    session = newSession(spec, get().awake.defaults, Date.now(), `s${Date.now()}`);
    clearTimeout(timer);
    if (session.endsAt) timer = setTimeout(() => stop('Time is up'), Math.min(2 ** 31 - 1, session.endsAt - Date.now()));
    return changed();
  };
  const save = (patch: Partial<AwakeSettings>) => {
    apply({ awake: { ...get().awake, ...patch } });
    changed();
    return get().awake;
  };
  return {
    awake: {
      status: async () => status(),
      start: begin,
      stop: async () => stop(),
      toggle: async (spec) => (session ? stop() : begin(spec)),
      extend: async (m) => {
        if (!session) return begin({ minutes: m });
        session = { ...session, endsAt: Math.max(session.endsAt ?? Date.now(), Date.now()) + m * 60_000 };
        return changed();
      },
      parse: async (t) => parseDuration(t, Date.now()) ?? null,
      settings: async () => get().awake,
      setSettings: async (p) => save(p),
      saveTrigger: async (r) => {
        const list = get().awake.triggers;
        return save({ triggers: list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, { ...r, priority: list.length }] });
      },
      removeTrigger: async (id) => save({ triggers: get().awake.triggers.filter((r) => r.id !== id) }),
      reorderTriggers: async (ids) => save({ triggers: ids.map((id) => get().awake.triggers.find((r) => r.id === id)!).filter(Boolean).map((r, i) => ({ ...r, priority: i })) }),
      testTrigger: async (r) => ({ matches: ruleMatches(r, facts()), conditions: r.conditions.map((c) => ({ label: describeCondition(c), holds: triggerConditionHolds(c, facts()) })) }),
      blockers: async () => ({
        source: 'pmset -g assertions',
        list: [
          ...(session ? [{ who: 'Keeper', what: 'PreventUserIdleDisplaySleep', why: session.reason }, { who: 'caffeinate', what: 'PreventUserIdleSystemSleep', why: 'caffeinate command-line tool' }] : []),
          { who: 'coreaudiod', what: 'PreventUserIdleSystemSleep', why: 'com.apple.audio.context' },
          { who: 'sharingd', what: 'PreventUserIdleSystemSleep', why: 'Handoff' },
        ],
      }),
      stats: async () => ({ ...summarize(records, Date.now()), recent: [...records].reverse() }),
      resetStats: async () => { records = []; },
      apps: async () => facts().apps,
      setupClosedDisplay: async () => { save({ closedDisplayAgreed: true }); return { ok: true }; },
    },
  };
}
