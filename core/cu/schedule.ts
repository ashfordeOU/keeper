// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Recorded workflows that run by themselves: on a schedule ("every monday at
// 9", "on the 1st of every month" as a cron line), when Keeper starts, or when
// the computer wakes. A run is the same as pressing Run: the same checks, the
// same "always ask me before" steps (approvable on the computer or the phone),
// and the same log.

import { nextRun, parseSchedule } from '../abilities/schedule';

export type WorkflowTrigger = 'schedule' | 'launch' | 'wake';

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  trigger: WorkflowTrigger;
  /** for 'schedule': plain words or a cron line */
  when?: string;
  /** what fills the workflow's blanks; password blanks name a saved sign-in */
  values: Record<string, string>;
  /** show the browser while it runs */
  visible: boolean;
  enabled: boolean;
  created: number;
  lastRun?: number;
  lastResult?: { ok: boolean; note: string };
}

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
  schedule: 'On a schedule',
  launch: 'When Keeper starts',
  wake: 'When the computer wakes',
};

/** Checks a new schedule; throws a message the person can act on. Returns its label. */
export function describeSchedule(s: Pick<WorkflowSchedule, 'trigger' | 'when'>, now = Date.now()): string {
  if (s.trigger !== 'schedule') return TRIGGER_LABEL[s.trigger];
  if (!s.when?.trim()) throw new Error('Say when, e.g. “every monday at 9” or “0 9 1 * *”');
  return parseSchedule(s.when, now).label;
}

/** The next time a timed schedule runs, or undefined (triggers and finished one-offs). */
export function nextScheduled(s: WorkflowSchedule): number | undefined {
  if (!s.enabled || s.trigger !== 'schedule' || !s.when) return undefined;
  try {
    const from = s.lastRun ?? s.created;
    return nextRun(parseSchedule(s.when, s.created), from, s.lastRun);
  } catch {
    return undefined;
  }
}

/** Timed schedules due now. A missed run (the computer was off) runs once, not once per miss. */
export function dueSchedules(list: WorkflowSchedule[], now: number): WorkflowSchedule[] {
  return list.filter((s) => {
    const n = nextScheduled(s);
    return n !== undefined && n <= now;
  });
}

/** Schedules for an event. */
export function triggeredBy(list: WorkflowSchedule[], event: 'launch' | 'wake'): WorkflowSchedule[] {
  return list.filter((s) => s.enabled && s.trigger === event);
}

/** When to look again: the soonest next run, at most an hour away (sleep and clock changes are caught). */
export function wakeIn(list: WorkflowSchedule[], now: number): number {
  let soonest = now + 3_600_000;
  for (const s of list) {
    const n = nextScheduled(s);
    if (n !== undefined) soonest = Math.min(soonest, n);
  }
  return Math.max(1000, soonest - now);
}
