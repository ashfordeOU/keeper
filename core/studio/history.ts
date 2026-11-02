// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Undo and redo for the editor: snapshots of what can be edited. Changes that
// arrive in quick succession under the same label (dragging a slider or a
// zoom) are one step.

export interface History<T> {
  past: { value: T; label: string }[];
  present: T;
  future: { value: T; label: string }[];
  /** label and time of the last change, for merging */
  last?: { label: string; at: number };
}

export const LIMIT = 200;

export function start<T>(value: T): History<T> {
  return { past: [], present: value, future: [] };
}

/** Records a change. The same label within `mergeMs` replaces the last step instead of adding one. */
export function push<T>(h: History<T>, value: T, label: string, now = Date.now(), mergeMs = 600): History<T> {
  if (value === h.present) return h;
  const merge = h.last && h.last.label === label && now - h.last.at < mergeMs && h.past.length > 0;
  const past = merge ? h.past : [...h.past, { value: h.present, label }].slice(-LIMIT);
  return { past, present: value, future: [], last: { label, at: now } };
}

export function undo<T>(h: History<T>): History<T> {
  const p = h.past[h.past.length - 1];
  if (!p) return h;
  return { past: h.past.slice(0, -1), present: p.value, future: [{ value: h.present, label: p.label }, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const f = h.future[0];
  if (!f) return h;
  return { past: [...h.past, { value: h.present, label: f.label }], present: f.value, future: h.future.slice(1) };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
/** What undo would take back ("Undo Cut"). */
export const undoLabel = <T>(h: History<T>) => h.past[h.past.length - 1]?.label;
export const redoLabel = <T>(h: History<T>) => h.future[0]?.label;
