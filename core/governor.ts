// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When Keeper may do background work, and how often it may look at things.
// Pure decisions, so they can be tested; electron/services/governor.ts feeds
// them the computer's state (battery, idle time, locked screen, heat, Keeper's
// own processor use) and the person's choice of mode.

export type ResourceMode = 'minimal' | 'balanced' | 'performance';

/** Kinds of background work, lightest first. */
// 'details' is looking up where every file in the library came from after the first read:
// unlike 'sources' (one quick look at a new file), a long catch-up that can wait.
export type WorkKind = 'scan' | 'sources' | 'details' | 'text' | 'thumbs' | 'ocr' | 'hash' | 'embed';

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
  /** the person pressed "Speed up now": background work runs at full speed for a while */
  boost?: boolean;
}

export const DEFAULT_CONDITIONS: Conditions = {
  mode: 'balanced', onBattery: false, lowPower: false, thermal: 'nominal', idleSec: 0, locked: false, suspended: false, windowVisible: true, keeperCpu: 0, memoryLow: false,
};

/** Work that keeps the processor busy for a long time, as opposed to quick reads. */
const HEAVY: ReadonlySet<WorkKind> = new Set<WorkKind>(['ocr', 'hash', 'embed']);
/** Filling in details after the library is read (text, pictures, fingerprints, meaning): it can always wait. */
const ENRICH: ReadonlySet<WorkKind> = new Set<WorkKind>(['details', 'text', 'thumbs', 'ocr', 'hash', 'embed']);

/** Nobody has touched the computer for two minutes, or it is locked. */
const away = (c: Conditions) => c.locked || c.idleSec >= 120;

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
  if (c.mode === 'performance' || c.boost) return { ok: true };
  const heavy = HEAVY.has(kind);
  if (heavy && c.thermal === 'serious') return wait('The computer is running hot');
  if (heavy && c.memoryLow) return wait('The computer is short of memory');
  if (c.mode === 'minimal' || c.lowPower) {
    // Only what keeps the library correct; the rest waits for a break on mains power.
    if (kind === 'scan' || kind === 'sources') return { ok: true };
    if (c.onBattery) return wait(c.lowPower ? 'Low power mode is on' : 'Paused on battery');
    if (!away(c)) return wait('Waiting until you’re idle');
    return { ok: true };
  }
  // Balanced. On battery the library stays right (new and moved files), and everything that only
  // fills in details (text, pictures, fingerprints, meaning) waits for the charger.
  if (ENRICH.has(kind) && c.onBattery) return wait('Paused on battery: continues when plugged in');
  if (c.keeperCpu > cpuBudget(c) * 1.5) return wait('Keeping Keeper light while you work');
  return { ok: true };
}

/** A pause between two items of background work, so it never hogs a core. */
export function paceMs(kind: WorkKind, c: Conditions): number {
  if (c.mode === 'performance' || c.boost) return 0;
  const base = HEAVY.has(kind) ? 60 : 15;
  let ms = away(c) ? base / 3 : base;
  if (c.onBattery || c.mode === 'minimal' || c.lowPower) ms *= 3;
  // Over budget: slow down in proportion.
  const budget = cpuBudget(c);
  if (c.keeperCpu > budget) ms *= Math.min(8, c.keeperCpu / budget);
  return Math.round(ms);
}

/**
 * The share of time background work may keep a core busy: after an item that took
 * `workedMs`, it rests long enough to stay at this share. While the person works it is
 * a small fraction, so the computer stays cool and quiet; when they are away, more.
 */
export function dutyCycle(kind: WorkKind, c: Conditions): number {
  if (c.mode === 'performance' || c.boost) return 1;
  const heavy = HEAVY.has(kind);
  if (c.mode === 'minimal' || c.lowPower || c.onBattery) return heavy ? 0.05 : 0.1;
  // Away: half a core for quick reads, less for heavy work (fans stay quiet; on battery none of it runs).
  if (away(c)) return heavy ? 0.3 : 0.5;
  // At the computer: about a tenth of one core for heavy work, a fifth for quick reads.
  return heavy ? 0.1 : 0.2;
}

/** How long to rest after an item of background work that took `workedMs`. */
export function restMs(kind: WorkKind, c: Conditions, workedMs: number): number {
  const gap = paceMs(kind, c);
  const d = dutyCycle(kind, c);
  if (d >= 1) return gap;
  const fair = (Math.max(0, workedMs) * (1 - d)) / d;
  // A slow item (a big PDF) never makes the next one wait more than half a minute.
  return Math.round(Math.max(gap, Math.min(30_000, fair)));
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
