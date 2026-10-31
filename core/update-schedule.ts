// SPDX-License-Identifier: AGPL-3.0-or-later
// When a downloaded update goes in. The person picks: now, when they quit
// Keeper, in an hour, tonight, tomorrow morning or at a time of their own.
// Nothing installs while Keeper is busy with something they would lose, and
// they always get a warning with a countdown first.

export type UpdateWhen = 'now' | 'quit' | 'hour' | 'tonight' | 'morning' | { at: number };

export interface UpdatePlan {
  /** 'quit' = when Keeper quits; a number = that moment (ms since epoch) */
  at: 'quit' | number;
  /** how it was chosen, for the wording */
  label: string;
}

/** Minutes of warning before a timed install. */
export const WARN_MINUTES = 5;
/** When an automatic update has waited this long for a quit, it asks to go in at the next quiet moment. */
export const AUTO_WAIT_MS = 24 * 3600_000;
/** A quiet moment: nobody has touched the computer for this long. */
export const IDLE_SECONDS = 10 * 60;

function atHour(now: number, hour: number, minute = 0): number {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now + 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function planFor(when: UpdateWhen, now = Date.now()): UpdatePlan {
  if (when === 'quit') return { at: 'quit', label: 'when you quit Keeper' };
  if (when === 'now') return { at: now, label: 'now' };
  if (when === 'hour') return { at: now + 3600_000, label: 'in an hour' };
  if (when === 'tonight') return { at: atHour(now, 23), label: 'tonight' };
  if (when === 'morning') return { at: atHour(now, 8, 30), label: 'tomorrow morning' };
  return { at: Math.max(now, when.at), label: 'at the time you picked' };
}

export type ScheduleStep =
  | { do: 'wait' }
  /** show the countdown; seconds until it goes in */
  | { do: 'warn'; seconds: number }
  | { do: 'install' }
  /** time is up but Keeper is busy: try again in a few minutes */
  | { do: 'postpone'; minutes: number; reason: string };

/**
 * What to do right now. `busy` names the work that would be lost by restarting
 * (a recording, a folder being locked, a conversion); `readySince` is when the
 * download finished; `auto` is the "install automatically" setting.
 */
export function nextStep(
  plan: UpdatePlan | null,
  ctx: { now: number; busy: string[]; idleSeconds: number; readySince: number; auto: boolean },
): ScheduleStep {
  let at: number | null = plan && plan.at !== 'quit' ? plan.at : null;
  // Automatic mode with no time picked: after a day of waiting for a quit, use the next quiet moment.
  if (at === null && ctx.auto && ctx.now - ctx.readySince >= AUTO_WAIT_MS && ctx.idleSeconds >= IDLE_SECONDS) at = ctx.now + WARN_MINUTES * 60_000;
  if (at === null) return { do: 'wait' };
  const left = Math.round((at - ctx.now) / 1000);
  if (left > WARN_MINUTES * 60) return { do: 'wait' };
  if (left > 0) return { do: 'warn', seconds: left };
  if (ctx.busy.length) return { do: 'postpone', minutes: 10, reason: ctx.busy[0] };
  return { do: 'install' };
}

/** "4:05", "59 s" */
export function countdown(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds)} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function describePlan(plan: UpdatePlan | null, now = Date.now()): string {
  if (!plan || plan.at === 'quit') return 'Installs when you quit Keeper';
  const d = new Date(plan.at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Installs ${sameDay ? 'today' : d.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
}
