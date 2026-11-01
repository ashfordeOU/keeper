// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inspector (the details panel on the right): when it shows, and how wide
// it may be. Plain functions so the rules are easy to test.

import type { SplitterRange } from './splitter';

/** Settings → Appearance → Inspector. */
export type InspectorMode = 'selection' | 'always' | 'never';

export const INSPECTOR_MODES: { id: InspectorMode; label: string }[] = [
  { id: 'selection', label: 'When something is selected' },
  { id: 'always', label: 'Always' },
  { id: 'never', label: 'Never' },
];

export const INSPECTOR_DEFAULT_WIDTH = 300;
export const INSPECTOR_MIN_WIDTH = 240;
export const INSPECTOR_MAX_WIDTH = 640;
/** the page beside it keeps at least this much room */
const MIN_PAGE = 420;

export function asInspectorMode(v: unknown): InspectorMode {
  return v === 'always' || v === 'never' ? v : 'selection';
}

/** The widest the Inspector may be in a window this wide (the sidebar and the page keep their room). */
export function maxInspectorWidth(windowWidth: number, sidebar = 228): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return INSPECTOR_MAX_WIDTH;
  return Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, Math.floor(windowWidth - sidebar - MIN_PAGE)));
}

export function clampInspectorWidth(w: unknown, windowWidth = Infinity, sidebar = 228): number {
  const n = typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : INSPECTOR_DEFAULT_WIDTH;
  const max = Number.isFinite(windowWidth) ? maxInspectorWidth(windowWidth, sidebar) : INSPECTOR_MAX_WIDTH;
  return Math.max(INSPECTOR_MIN_WIDTH, Math.min(max, n));
}

/**
 * Whether the Inspector shows. `forced` is the Show/Hide Inspector toggle
 * (⌘⌥I / Ctrl+Alt+I, the palette, the button in the top bar): null follows
 * the setting, true or false wins over it until the selection next starts or
 * ends (see nextForced).
 */
export function inspectorVisible(o: { mode: InspectorMode; hasSelection: boolean; filePage: boolean; forced: boolean | null }): boolean {
  if (!o.filePage) return false;
  if (o.forced !== null) return o.forced;
  if (o.mode === 'never') return false;
  if (o.mode === 'always') return true;
  return o.hasSelection;
}

/** The toggle's override after the selection changes: in "when selected" mode, starting or clearing a selection hands control back to the setting. */
export function nextForced(forced: boolean | null, mode: InspectorMode, hadSelection: boolean, hasSelection: boolean): boolean | null {
  if (forced === null) return null;
  if (mode === 'selection' && hadSelection !== hasSelection) return null;
  return forced;
}

/** The splitter's range in a window this wide (the Inspector is on the right, so dragging left makes it wider). */
export function inspectorRange(windowWidth = Infinity, sidebar = 228): SplitterRange {
  return { min: INSPECTOR_MIN_WIDTH, max: Number.isFinite(windowWidth) ? maxInspectorWidth(windowWidth, sidebar) : INSPECTOR_MAX_WIDTH, def: INSPECTOR_DEFAULT_WIDTH, grow: 'left' };
}
