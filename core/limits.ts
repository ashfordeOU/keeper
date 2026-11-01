// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's own ceilings: how much processor time and memory it lets itself
// use before it steps back. Pure decisions, so they can be tested; the main
// process samples and acts (electron/svc/limits.ts).
//
//   • processor: if all of Keeper together stays above the ceiling for a few
//     minutes while nobody is using Keeper, background work is held for a while
//     and the person is told what was paused;
//   • memory: a service process that grows past its ceiling is restarted (it
//     hands over its settings again on start); a hidden window that grows past
//     its ceiling is reloaded; a helper program past its ceiling is stopped.

export interface Limits {
  /** percent of one core, all of Keeper together */
  cpuCeiling: number;
  /** how long it must stay above before Keeper steps back */
  cpuSustainMs: number;
  /** how long background work is held afterwards */
  cpuHoldMs: number;
  /** bytes */
  hostMemory: number;
  hiddenWindowMemory: number;
  helperMemory: number;
  /** most helper programs running at once before new background ones wait */
  maxHelpers: number;
}

export const DEFAULT_LIMITS: Limits = {
  cpuCeiling: 25,
  cpuSustainMs: 2 * 60_000,
  cpuHoldMs: 15 * 60_000,
  hostMemory: 256 * 1048576,
  hiddenWindowMemory: 600 * 1048576,
  helperMemory: 1536 * 1048576,
  maxHelpers: 4,
};

/** Tighter ceilings in the Minimal resource mode, looser in Performance. */
export function limitsFor(mode: string | undefined): Limits {
  if (mode === 'minimal') return { ...DEFAULT_LIMITS, cpuCeiling: 15, cpuSustainMs: 60_000, hostMemory: 160 * 1048576, hiddenWindowMemory: 400 * 1048576 };
  if (mode === 'performance') return { ...DEFAULT_LIMITS, cpuCeiling: 60, cpuSustainMs: 5 * 60_000 };
  return DEFAULT_LIMITS;
}

export interface CpuState {
  /** when Keeper first went above the ceiling (0: it is below) */
  overSince: number;
  /** last time Keeper stepped back (so it does not do so again at once) */
  lastAction: number;
}

export const CPU_START: CpuState = { overSince: 0, lastAction: 0 };

/**
 * One processor sample. `inUse` is true while the person is working in a
 * Keeper window: what they asked for is never held back.
 */
export function cpuStep(s: CpuState, cpu: number, inUse: boolean, now: number, l: Limits): { state: CpuState; act: boolean } {
  if (inUse || cpu <= l.cpuCeiling) return { state: { ...s, overSince: 0 }, act: false };
  const overSince = s.overSince || now;
  const act = now - overSince >= l.cpuSustainMs && (!s.lastAction || now - s.lastAction >= l.cpuHoldMs);
  return { state: { overSince: act ? 0 : overSince, lastAction: act ? now : s.lastAction }, act };
}

export interface MemSample {
  id: string;
  kind: 'service' | 'window' | 'helper';
  memory: number;
  /** windows only */
  visible?: boolean;
}

export interface MemAction {
  id: string;
  kind: MemSample['kind'];
  memory: number;
  ceiling: number;
  action: 'restart' | 'reload' | 'stop';
}

/** What to do about processes past their memory ceiling. A visible window is never touched. */
export function memoryActions(samples: MemSample[], l: Limits): MemAction[] {
  const out: MemAction[] = [];
  for (const s of samples) {
    if (s.kind === 'service' && s.memory > l.hostMemory) out.push({ id: s.id, kind: s.kind, memory: s.memory, ceiling: l.hostMemory, action: 'restart' });
    else if (s.kind === 'window' && !s.visible && s.memory > l.hiddenWindowMemory) out.push({ id: s.id, kind: s.kind, memory: s.memory, ceiling: l.hiddenWindowMemory, action: 'reload' });
    else if (s.kind === 'helper' && s.memory > l.helperMemory) out.push({ id: s.id, kind: s.kind, memory: s.memory, ceiling: l.helperMemory, action: 'stop' });
  }
  return out;
}

export interface LimitEvent {
  at: number;
  what: string;
}
