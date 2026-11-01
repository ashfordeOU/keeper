// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Walking through a fix one step at a time: where the person is, which steps
// they did or skipped, and whether the check afterwards found it fixed.

import type { GuideStep } from './types';

export interface FlowState {
  index: number;
  steps: ('todo' | 'done' | 'skipped')[];
  /** set after "I did it — check" */
  verified?: 'done' | 'still-needed' | 'checking';
}

export type FlowEvent = { type: 'next' } | { type: 'back' } | { type: 'skip' } | { type: 'goto'; index: number } | { type: 'check' } | { type: 'checked'; result: 'done' | 'still-needed' } | { type: 'restart' };

export function startFlow(steps: GuideStep[]): FlowState {
  return { index: 0, steps: steps.map(() => 'todo') };
}

export function stepFlow(s: FlowState, e: FlowEvent): FlowState {
  const last = s.steps.length - 1;
  const mark = (i: number, v: 'done' | 'skipped') => s.steps.map((x, j) => (j === i ? v : x));
  switch (e.type) {
    case 'next':
      return { ...s, steps: s.index >= 0 && s.index <= last ? mark(s.index, 'done') : s.steps, index: Math.min(last, s.index + 1), verified: undefined };
    case 'skip':
      return { ...s, steps: s.index >= 0 && s.index <= last ? mark(s.index, 'skipped') : s.steps, index: Math.min(last, s.index + 1), verified: undefined };
    case 'back':
      return { ...s, index: Math.max(0, s.index - 1), verified: undefined };
    case 'goto':
      return { ...s, index: Math.max(0, Math.min(last, e.index)), verified: undefined };
    case 'check':
      return { ...s, steps: s.steps.map((x, j) => (j === s.index && x === 'todo' ? 'done' : x)), verified: 'checking' };
    case 'checked':
      return { ...s, verified: e.result };
    case 'restart':
      return { index: 0, steps: s.steps.map(() => 'todo') };
  }
}

/** How far along, 0..1 (skipped steps count as passed). */
export function progress(s: FlowState): number {
  if (!s.steps.length) return s.verified === 'done' ? 1 : 0;
  if (s.verified === 'done') return 1;
  return s.steps.filter((x) => x !== 'todo').length / s.steps.length;
}
