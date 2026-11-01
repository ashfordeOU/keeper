// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Deciding what a Quick Controls change does before it runs: which changes
// make the system less protected (and must be confirmed), what a preset will
// change against how things are now, and how to undo a logged change.

import { CONTROL_BY_ID } from './catalog';
import type { Change, ControlDef, ControlState, ControlValue, LogEntry, Preset } from './types';

/** true when going from `from` to `to` leaves the computer less protected */
export function isWeakening(def: ControlDef | undefined, from: ControlValue | null, to: ControlValue): boolean {
  if (!def || def.weaker === undefined || from === to) return false;
  return to === def.weaker;
}

/** the sentence shown before a weakening change */
export function weakeningWarning(def: ControlDef, to: ControlValue): string {
  const what = def.kind === 'choice' ? `${def.label}: ${def.choices?.find((c) => c.value === to)?.label ?? String(to)}` : `${def.label} ${to ? 'on' : 'off'}`;
  return `${what} makes this computer less protected.${def.risk ? ` ${def.risk}` : ''}`;
}

export interface PlanItem extends Change {
  label: string;
  weakening: boolean;
  /** how it can be done here; guide = Keeper will open Settings, none = skipped */
  how: ControlState['how'];
}

export interface Plan {
  /** what will change */
  items: PlanItem[];
  /** already as asked */
  same: string[];
  /** not possible on this system */
  skipped: { id: string; label: string; reason: string }[];
}

/** What applying these values changes, given the current states. */
export function planValues(values: Record<string, ControlValue>, states: Map<string, ControlState>): Plan {
  const plan: Plan = { items: [], same: [], skipped: [] };
  for (const [id, to] of Object.entries(values)) {
    const def = CONTROL_BY_ID.get(id);
    const st = states.get(id);
    if (!def || !st) continue;
    if (st.how === 'none') { plan.skipped.push({ id, label: def.label, reason: st.note ?? 'Not on this system' }); continue; }
    if (st.value === to) { plan.same.push(id); continue; }
    plan.items.push({ id, from: st.value, to, label: def.label, weakening: isWeakening(def, st.value, to), how: st.how });
  }
  return plan;
}

export const planPreset = (p: Preset, states: Map<string, ControlState>) => planValues(p.values, states);

/** Only the changes that Keeper can make itself (direct or with the administrator). */
export const doable = (items: PlanItem[]) => items.filter((i) => i.how === 'direct' || i.how === 'admin');

/** The changes that undo a logged entry (only those whose earlier value is known). */
export function undoChanges(entry: LogEntry): Change[] {
  return entry.changes.filter((c) => c.from !== null).map((c) => ({ id: c.id, from: c.to, to: c.from as ControlValue }));
}

/** The changes to apply automatically when a firewall profile turns on a preset: never weakening ones. */
export function autoPlan(p: Preset, states: Map<string, ControlState>): { apply: PlanItem[]; held: PlanItem[] } {
  const items = doable(planPreset(p, states).items);
  return { apply: items.filter((i) => !i.weakening), held: items.filter((i) => i.weakening) };
}

/** Search across labels, descriptions and groups. */
export function matches(def: ControlDef, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return `${def.label} ${def.desc} ${def.group} ${def.id}`.toLowerCase().includes(t);
}
