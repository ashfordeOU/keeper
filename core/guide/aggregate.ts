// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The To do list: findings from every checker, with what the person decided
// (snoozed, ignored, done), the most important first.

import type { Area, Finding, FindingState, FindingView, GuideSummary, Severity } from './types';

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function statusOf(state: FindingState | undefined, now: number): FindingView['status'] {
  if (!state) return 'open';
  if (state.ignored) return 'ignored';
  if (state.doneAt) return 'done';
  if (state.snoozedUntil && state.snoozedUntil > now) return 'snoozed';
  return 'open';
}

/** Most severe first; among equals, what frees the most space, then by title. */
export function sortFindings<T extends Finding>(list: T[]): T[] {
  return [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.impactBytes ?? 0) - (a.impactBytes ?? 0) || a.title.localeCompare(b.title));
}

/**
 * Merges what each checker found with the saved decisions. A finding the
 * person marked done that a checker reports again is open again — the fix did
 * not hold — unless it was done in the last minute (the checker has not caught up).
 */
export function mergeFindings(found: Finding[], states: Record<string, FindingState>, now = Date.now()): FindingView[] {
  const seen = new Set<string>();
  const out: FindingView[] = [];
  for (const f of found) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    let state = states[f.id] ?? {};
    if (state.doneAt && now - state.doneAt > 60_000) state = { ...state, doneAt: undefined };
    out.push({ ...f, state, status: statusOf(state, now) });
  }
  return sortFindings(out);
}

export function summarize(list: FindingView[], checkedAt?: number): GuideSummary {
  const open = list.filter((f) => f.status === 'open');
  const byArea: Partial<Record<Area, number>> = {};
  for (const f of open) byArea[f.area] = (byArea[f.area] ?? 0) + 1;
  const top = open[0];
  return { open: open.length, byArea, top: top ? { id: top.id, title: top.title, severity: top.severity } : undefined, checkedAt };
}

/** After a fix: still reported → still needed; gone → done. */
export function verifyResult(id: string, found: Finding[]): 'done' | 'still-needed' {
  return found.some((f) => f.id === id) ? 'still-needed' : 'done';
}

export const WEEK = 7 * 24 * 3600_000;

export function snooze(state: FindingState | undefined, now = Date.now(), ms = WEEK): FindingState {
  return { ...state, snoozedUntil: now + ms };
}
