// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The draggable edge of a side panel (the sidebar, the Inspector): drag it,
// use the arrow keys when it has focus, double-click or press Enter to go back
// to the usual width. While dragging only the live width changes; the width is
// kept when the drag ends.

import { useRef } from 'react';
import { clampSize, dragSize, splitterKey, type SplitterRange } from '../../core/splitter';

export function Splitter({ width, range, label, controls, onLive, onCommit, onBelowMin, className, testId }: {
  width: number;
  range: SplitterRange;
  label: string;
  /** the id of the panel it sizes */
  controls?: string;
  /** the width while dragging (null when the drag ends) */
  onLive(px: number | null): void;
  onCommit(px: number): void;
  /** the drag ended well below the narrowest width (the sidebar snaps to its rail) */
  onBelowMin?: () => void;
  className?: string;
  testId?: string;
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuetext={`${width} pixels wide`}
      tabIndex={0}
      title={`${label}: drag, or use the arrow keys. Double-click for the usual width.`}
      data-testid={testId}
      className={`splitter ${className ?? ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, last: width };
        document.documentElement.dataset.resizing = '1';
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.last = dragSize(d.w, d.x, e.clientX, range.grow);
        onLive(clampSize(d.last, range));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        delete document.documentElement.dataset.resizing;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
        if (!d) return;
        onLive(null);
        if (onBelowMin && d.last < range.min - 48) onBelowMin();
        else if (d.last !== d.w) onCommit(clampSize(d.last, range));
      }}
      onPointerCancel={() => { drag.current = null; delete document.documentElement.dataset.resizing; onLive(null); }}
      onDoubleClick={() => onCommit(clampSize(range.def, range))}
      onKeyDown={(e) => {
        const next = splitterKey(width, e.key, e.shiftKey, range);
        if (next === null) return;
        e.preventDefault();
        onCommit(next);
      }}
    />
  );
}
