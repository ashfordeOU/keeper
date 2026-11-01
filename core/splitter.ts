// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The draggable edge between a side panel and the page (the sidebar's right
// edge, the Inspector's left edge): sizes from a drag or from the keyboard.

export interface SplitterRange {
  min: number;
  max: number;
  /** what Enter and a double-click go back to */
  def: number;
  /** the side the handle moves toward to make the panel wider */
  grow: 'left' | 'right';
}

export function clampSize(v: number, r: Pick<SplitterRange, 'min' | 'max'>): number {
  const n = Number.isFinite(v) ? Math.round(v) : r.min;
  return Math.max(r.min, Math.min(Math.max(r.min, r.max), n));
}

/** The panel's width while dragging, from where the drag started (unclamped, so a caller can see a drag past the minimum). */
export function dragSize(startWidth: number, startX: number, x: number, grow: SplitterRange['grow']): number {
  return grow === 'right' ? startWidth + (x - startX) : startWidth - (x - startX);
}

/** Arrow keys move the edge 16 px (64 with Shift); Home and End go to the narrowest and widest; Enter resets. */
export function splitterKey(width: number, key: string, shift: boolean, r: SplitterRange): number | null {
  const step = shift ? 64 : 16;
  const wider = r.grow === 'left' ? 'ArrowLeft' : 'ArrowRight';
  const narrower = r.grow === 'left' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case wider: return clampSize(width + step, r);
    case narrower: return clampSize(width - step, r);
    case 'Home': return clampSize(r.min, r);
    case 'End': return clampSize(r.max, r);
    case 'Enter': return clampSize(r.def, r);
    default: return null;
  }
}
