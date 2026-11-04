// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Fix-it List shows similar findings together ("4 browser extensions with
// broad access") when there are several, in the place of the first of them.

import { CALM_WORD, calmOf } from '../attention';
import type { Finding, Severity } from './types';

export type Row<T extends Finding> =
  | { kind: 'one'; finding: T }
  | { kind: 'group'; key: string; title: string; severity: Severity; items: T[] };

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** "{n}" in a group's label is the count. */
export function groupTitle(g: { one: string; many: string }, n: number): string {
  return (n === 1 ? g.one : g.many).replace('{n}', String(n));
}

/** Groups findings that share a group key when there are at least `min` of them; the order is kept. */
export function groupRows<T extends Finding>(list: T[], min = 3): Row<T>[] {
  const counts = new Map<string, number>();
  for (const f of list) if (f.group) counts.set(f.group.key, (counts.get(f.group.key) ?? 0) + 1);
  const out: Row<T>[] = [];
  const open = new Map<string, Extract<Row<T>, { kind: 'group' }>>();
  for (const f of list) {
    const key = f.group?.key;
    if (!key || (counts.get(key) ?? 0) < min) {
      out.push({ kind: 'one', finding: f });
      continue;
    }
    let g = open.get(key);
    if (!g) {
      g = { kind: 'group', key, title: '', severity: f.severity, items: [] };
      open.set(key, g);
      out.push(g);
    }
    g.items.push(f);
    if (RANK[f.severity] < RANK[g.severity]) g.severity = f.severity;
  }
  for (const g of open.values()) g.title = groupTitle(g.items[0].group!, g.items.length);
  return out;
}

/** Calm words for how important something is: the same three everywhere (core/attention.ts). */
export function severityWord(s: Severity): string {
  return CALM_WORD[calmOf(s)];
}
