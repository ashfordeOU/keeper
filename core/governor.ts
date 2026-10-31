// SPDX-License-Identifier: AGPL-3.0-or-later
// When Keeper may do background work, and how often it may look at things.
// Pure decisions, so they can be tested; electron/services/governor.ts feeds
// them the computer's state (battery, idle time, locked screen, heat, Keeper's
// own processor use) and the person's choice of mode.

export type ResourceMode = 'minimal' | 'balanced' | 'performance';

/** Kinds of background work, lightest first. */
export type WorkKind = 'scan' | 'sources' | 'text' | 'thumbs' | 'ocr' | 'hash' | 'embed';

export interface Conditions {
  mode: ResourceMode;
  onBattery: boolean;
  /** the system asks apps to save energy (low power mode, power saver profile) */
  lowPower: boolean;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  /** seconds since the last keyboard or mouse input */
  idleSec: number;
  locked: boolean;
  suspended: boolean;
  /** Keeper's main window is on screen */
  windowVisible: boolean;
  /** Keeper's own processor use over the last few seconds, percent of one core */
  keeperCpu: number;
  /** the computer is short of memory */
  memoryLow: boolean;
}

export const DEFAULT_CONDITIONS: Conditions = {
  mode: 'balanced', onBattery: false, lowPower: false, thermal: 'nominal', idleSec: 0, locked: false, suspended: false, windowVisible: true, keeperCpu: 0, memoryLow: false,
};

/** Work that keeps the processor busy for a long time, as opposed to quick reads. */
const HEAVY: ReadonlySet<WorkKind> = new Set<WorkKind>(['ocr', 'hash', 'embed']);

/** How much of one processor core background work may use, on average. */
export function cpuBudget(c: Conditions): number {
  if (c.mode === 'performance') return 400;
  if (c.mode === 'minimal' || c.lowPower) return 10;
  if (c.onBattery) return 15;
  // Nobody is using the computer: let work finish sooner.
  if (c.locked || c.idleSec >= 120) return 100;
  return 30;
}

export interface Decision {
  ok: boolean;
  /** plain-English reason when work waits */
  reason?: string;
}

const wait = (reason: string): Decision => ({ ok: false, reason });

/** May this kind of work run right now? */
export function decide(kind: WorkKind, c: Conditions): Decision {
  if (c.suspended) return wait('The computer is asleep');
  if (c.thermal === 'critical') return wait('The computer is very hot');
  if (c.mode === 'performance') return { ok: true };
  const heavy = HEAVY.has(kind);
  if (heavy && c.thermal === 'serious') return wait('The computer is running hot');
  if (heavy && c.memoryLow) return wait('The computer is short of memory');
  if (c.mode === 'minimal' || c.lowPower) {
    // Only what keeps the library correct; the rest waits for a break on mains power.
    if (kind === 'scan' || kind === 'sources') return { ok: true };
    if (c.onBattery) return wait(c.lowPower ? 'Low power mode is on' : 'On battery');
    if (!(c.locked || c.idleSec >= 120)) return wait('Waiting until you take a break');
    return { ok: true };
  }
  // Balanced.
  if (heavy && c.onBattery) return wait('On battery: continues when plugged in');
  if (c.keeperCpu > cpuBudget(c) * 1.5) return wait('Keeping Keeper light while you work');
  return { ok: true };
}

/** A pause between two items of background work, so it never hogs a core. */
export function paceMs(kind: WorkKind, c: Conditions): number {
  if (c.mode === 'performance') return 0;
  const away = c.locked || c.idleSec >= 120;
  const base = HEAVY.has(kind) ? 60 : 15;
  let ms = away ? base / 3 : base;
  if (c.onBattery || c.mode === 'minimal' || c.lowPower) ms *= 3;
  // Over budget: slow down in proportion.
  const budget = cpuBudget(c);
  if (c.keeperCpu > budget) ms *= Math.min(8, c.keeperCpu / budget);
  return Math.round(ms);
}

export interface PollRule {
  /** how often to look while the person is at the computer */
  baseMs: number;
  /** stop entirely while the screen is locked (nobody can see the result) */
  pauseWhenLocked?: boolean;
  /** multiply the interval by this when nobody has touched the computer for a minute */
  idleFactor?: number;
  /** never look less often than this */
  maxMs?: number;
}

/**
 * How long until a regular check runs again, or null to pause it. Checks slow
 * down when the person is away, on battery or in minimal mode, and speed back
 * up the moment they return.
 */
export function pollDelay(rule: PollRule, c: Conditions): number | null {
  if (c.suspended) return null;
  if (c.locked && rule.pauseWhenLocked) return null;
  let ms = rule.baseMs;
  if (c.mode === 'performance') return ms;
  if (c.idleSec >= 60 || c.locked) ms *= rule.idleFactor ?? 4;
  if (c.onBattery || c.lowPower) ms *= 1.5;
  if (c.mode === 'minimal') ms *= 2;
  return Math.round(Math.min(ms, rule.maxMs ?? Math.max(rule.baseMs, 15 * 60_000)));
}
