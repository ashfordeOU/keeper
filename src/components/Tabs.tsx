// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one tab bar. Tabs that do not fit, and any past the visual budget's six
// (core/design-budget.ts), go into a "More" menu at the end of the row (the
// chosen tab always stays in view), so a page never gets a second row of tabs
// or a wall of them. Arrow keys move between tabs and choose them; Home and End jump.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BUDGET } from '../../core/design-budget';
import { Icon } from './Icon';
import { ContextMenu } from './ui';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** plain text for the More menu and the tooltip when the label is not a string */
  text?: string;
  /** a small count or badge after the label */
  badge?: ReactNode;
  testId?: string;
}

const MORE_W = 100;

export function Tabs<T extends string>({ items, value, onChange, label, className, max = BUDGET.tabs }: { items: TabItem<T>[]; value: T | undefined; onChange: (id: T) => void; /** for screen readers */ label: string; className?: string; /** tabs in view at most, the rest under More (in the order given, so put the most used first) */ max?: number }) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const key = items.map((t) => `${t.id}:${t.text ?? (typeof t.label === 'string' ? t.label : '')}`).join('|');

  // How many tabs fit: measured from a hidden copy of the row, again whenever the row changes size.
  useLayoutEffect(() => {
    const el = row.current;
    const m = measure.current;
    if (!el || !m) return;
    const calc = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth + 2);
      const avail = el.clientWidth;
      if (!avail) return;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail && items.length <= max) { setFit(items.length); return; }
      let used = MORE_W;
      let n = 0;
      for (const w of widths) { if (used + w > avail || n >= max) break; used += w; n++; }
      setFit(Math.max(1, n));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, max]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chosen tab always shows: it takes the last place that fits.
  const at = items.findIndex((t) => t.id === value);
  let shown = items.slice(0, fit);
  if (at >= fit && fit > 0) shown = [...items.slice(0, fit - 1), items[at]];
  const hidden = items.filter((t) => !shown.includes(t));
  const textOf = (t: TabItem<T>) => t.text ?? (typeof t.label === 'string' ? t.label : t.id);

  const onKey = (e: React.KeyboardEvent) => {
    const i = shown.findIndex((t) => t.id === value);
    const go = (j: number) => {
      e.preventDefault();
      const t = shown[(j + shown.length) % shown.length];
      onChange(t.id);
      requestAnimationFrame(() => row.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(t.id)}"]`)?.focus());
    };
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(shown.length - 1);
  };

  return (
    <div className={`tabs ${className ?? ''}`} ref={row}>
      <div className="tabs-row" role="tablist" aria-label={label} onKeyDown={onKey}>
        {shown.map((t) => (
          <button key={t.id} type="button" role="tab" data-tab-id={t.id} data-testid={t.testId} aria-selected={t.id === value} tabIndex={t.id === value || (at < 0 && t === shown[0]) ? 0 : -1} className={t.id === value ? 'on' : ''} title={textOf(t)} onClick={() => onChange(t.id)}>
            {t.label}{t.badge !== undefined ? <span className="tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {hidden.length ? (
        <button type="button" className="tabs-more" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>
          More <Icon name="chevronDown" size={12} />
        </button>
      ) : null}
      {/* A hidden copy of every tab, to know how wide each one is. */}
      <div className="tabs-measure" ref={measure} aria-hidden>
        {items.map((t) => <span key={t.id} className="tabs-measure-item">{t.label}{t.badge !== undefined ? <span className="tab-badge">{t.badge}</span> : null}</span>)}
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} label={`More ${label}`} onClose={() => setMenu(null)} items={hidden.map((t) => ({ label: textOf(t), run: () => onChange(t.id) }))} /> : null}
    </div>
  );
}
