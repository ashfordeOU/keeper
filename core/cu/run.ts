// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeping a computer-use task on track: a visible plan the person can edit,
// time and step budgets, noticing when the AI is going round in circles,
// checking that each action changed something, and a checkpoint so a task
// can carry on after Keeper restarts.

export type StepStatus = 'todo' | 'doing' | 'done' | 'skipped' | 'failed';

export interface PlanStep {
  id: number;
  text: string;
  status: StepStatus;
  note?: string;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
}

/** "1. Open the shop\n2. Sign in…" → steps. Accepts numbered or bulleted lines. */
export function parsePlan(goal: string, text: string): TaskPlan {
  const steps = text.split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter((l) => l.length > 1).slice(0, 40);
  return { goal, steps: steps.map((t, i) => ({ id: i + 1, text: t, status: i === 0 ? 'doing' : 'todo' })) };
}

export function advance(plan: TaskPlan, id: number, status: StepStatus, note?: string): TaskPlan {
  const steps = plan.steps.map((s) => (s.id === id ? { ...s, status, note } : s));
  if (status === 'done' || status === 'skipped') {
    const next = steps.find((s) => s.status === 'todo');
    if (next) next.status = 'doing';
  }
  return { ...plan, steps };
}

export function planText(plan: TaskPlan): string {
  const mark: Record<StepStatus, string> = { todo: '[ ]', doing: '[>]', done: '[x]', skipped: '[-]', failed: '[!]' };
  return `Goal: ${plan.goal}\n` + plan.steps.map((s) => `${mark[s.status]} ${s.id}. ${s.text}${s.note ? ` — ${s.note}` : ''}`).join('\n');
}

export interface Budget {
  maxSteps: number;
  maxMs: number;
}

export const DEFAULT_BUDGET: Budget = { maxSteps: 120, maxMs: 20 * 60_000 };

export function overBudget(b: Budget, steps: number, started: number, now = Date.now()): string | undefined {
  if (steps >= b.maxSteps) return `used all ${b.maxSteps} steps`;
  if (now - started >= b.maxMs) return `ran for ${Math.round(b.maxMs / 60_000)} minutes`;
  return undefined;
}

/**
 * Going round in circles: the same action on an unchanged screen three times,
 * or bouncing between two screens with no progress.
 */
export class StuckDetector {
  private history: { action: string; before: string; after: string }[] = [];
  constructor(private repeat = 3, private window = 10) {}

  note(action: string, before: string, after: string): string | undefined {
    this.history.push({ action, before, after });
    if (this.history.length > this.window) this.history.shift();
    const same = this.history.filter((h) => h.action === action && h.before === before && h.after === before);
    if (same.length >= this.repeat) return `"${action}" did nothing ${same.length} times in a row`;
    const screens = new Set(this.history.slice(-8).flatMap((h) => [h.before, h.after]));
    if (this.history.length >= 8 && screens.size <= 2 && new Set(this.history.slice(-8).map((h) => h.action)).size <= 2) return 'went back and forth between the same two screens';
    return undefined;
  }

  reset() {
    this.history = [];
  }
}

export type Expect = 'change' | 'navigate' | 'value' | 'none';

/** Which actions should visibly change something, so a silent no-op is caught. */
export function expectFor(action: string): Expect {
  if (action === 'navigate' || action === 'back' || action === 'forward') return 'navigate';
  if (action === 'type' || action === 'select' || action === 'check') return 'value';
  if (action === 'click' || action === 'press' || action === 'scroll') return 'change';
  return 'none';
}

export interface Observed {
  url?: string;
  fingerprint: string;
  value?: string;
}

/** Did the action do what it should? Returns a short note for the AI when it did not. */
export function verify(expect: Expect, before: Observed, after: Observed, typed?: string): string | undefined {
  if (expect === 'navigate' && before.url === after.url && before.fingerprint === after.fingerprint) return 'The page did not change. The link may need a different element, or the page is still loading.';
  if (expect === 'value' && typed !== undefined && after.value !== undefined && !after.value.includes(typed.slice(0, 12))) return 'The field does not show what was typed. Click the field first, or clear it and try again.';
  if (expect === 'change' && before.url === after.url && before.fingerprint === after.fingerprint) return 'Nothing visible changed. Check the element number, wait for the page, or try another way.';
  return undefined;
}

/** Waits before retrying: 0.4 s, 0.8 s, 1.6 s… capped. */
export function backoff(attempt: number, base = 400, max = 5000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt));
}

/** What is saved so a task can continue after a restart. */
export interface Checkpoint {
  id: string;
  goal: string;
  client: string;
  plan?: TaskPlan;
  steps: number;
  started: number;
  updated: number;
  /** the browser tabs it had open */
  urls: string[];
  state: 'running' | 'paused' | 'waiting-for-person' | 'done' | 'stopped' | 'failed';
  note?: string;
}

export function resumable(c: Checkpoint, now = Date.now(), maxAgeMs = 24 * 3600_000): boolean {
  return (c.state === 'running' || c.state === 'paused' || c.state === 'waiting-for-person') && now - c.updated < maxAgeMs;
}
