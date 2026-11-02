// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The open Island's deck: up to four pinned tools, a live slot that an activity
// borrows while it runs (music, an agent at work, a timer, a recording), and More.
// Only the open view shows its name. The bar measures itself and never scrolls or
// clips: when it runs out of room the live slot goes into More first, then the name.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DECK_MAX, type IslandToolId, type LiveSlot } from '../../core/island-tools/tools';
import { Icon } from '../components/Icon';

export type DeckView = IslandToolId | 'more';

export interface DeckItem {
  id: IslandToolId;
  icon: string;
  label: string;
  badge?: number;
}

/** How much the bar shows: everything, no live slot, then no names either. */
type Fit = 0 | 1 | 2;

export function Deck(props: {
  items: DeckItem[];
  view: DeckView;
  live: (LiveSlot & { label: string }) | null;
  /** the open view is a tool from More (not pinned): the bar offers the way back to More */
  fromMore?: DeckItem;
  onSelect: (id: IslandToolId) => void;
  onMore: () => void;
  onLive: (slot: LiveSlot) => void;
  onMove: (id: IslandToolId, by: -1 | 1) => void;
  onUnpin: (id: IslandToolId) => void;
  /** shown before the pinned tools (the owl, while the deck has room) */
  lead?: ReactNode;
  /** shown at the end (the size button) */
  trail?: ReactNode;
}) {
  const { items, view, live, fromMore } = props;
  const bar = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(0);
  const [menu, setMenu] = useState<{ id: IslandToolId; x: number } | null>(null);
  const key = `${items.map((i) => i.id).join()}|${view}|${live?.activity ?? ''}|${fromMore?.id ?? ''}`;
  const width = useWidth(bar);
  // Measured again whenever what it shows or its width changes: start from everything, give up what does not fit.
  useLayoutEffect(() => { setFit(0); }, [key, width]);
  useLayoutEffect(() => {
    const el = bar.current;
    if (el && fit < 2 && el.scrollWidth > el.clientWidth + 1) setFit((f) => (f + 1) as Fit);
  });

  const showLive = live && fit < 1;
  const index = items.findIndex((i) => i.id === view);
  const tab = (it: DeckItem, i: number) => {
    const on = view === it.id;
    return (
      <button
        key={it.id} role="tab" aria-selected={on} className={`deck-tab ${on ? 'on' : ''}`} data-testid={`island-tab-${it.id}`}
        title={it.label} aria-label={it.badge ? `${it.label} (${it.badge})` : it.label}
        onClick={() => props.onSelect(it.id)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ id: it.id, x: (e.currentTarget as HTMLElement).offsetLeft }); }}
        onKeyDown={(e) => {
          // Left and right move between views (the deck is a tab list); with Alt they move the tool itself.
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const by = e.key === 'ArrowLeft' ? -1 : 1;
          if (e.altKey) { props.onMove(it.id, by); return; }
          const next = items[i + by];
          if (next) props.onSelect(next.id); else if (by === 1) props.onMore();
        }}
      >
        <Icon name={it.icon} size={18} stroke={1.6} />
        {on && fit < 2 ? <span className="deck-label">{it.label}</span> : null}
        {it.badge ? <span className="deck-badge" aria-hidden>{it.badge}</span> : null}
      </button>
    );
  };

  return (
    <>
      <div className="tabs deck" role="tablist" aria-label="Island views" ref={bar} data-fit={fit} data-testid="island-deck">
        {props.lead}
        {fromMore ? (
          <button className="deck-back" data-testid="island-back-more" title="Back to More" aria-label={`Back to More (now: ${fromMore.label})`} onClick={props.onMore}>
            <Icon name="chevronLeft" size={14} stroke={1.6} /><span className="deck-label">{fit < 2 ? fromMore.label : 'More'}</span>
          </button>
        ) : null}
        {items.map(tab)}
        {showLive ? (
          <button
            className={`deck-tab deck-live ${live.kind === 'tool' && view === live.tool ? 'on' : ''}`} role="tab" aria-selected={live.kind === 'tool' && view === live.tool}
            data-testid="island-live-slot" title={`${live.label}: ${live.title}`} aria-label={`${live.label}: ${live.title}`}
            style={{ color: live.color }} onClick={() => props.onLive(live)}
          >
            <Icon name={live.icon} size={18} stroke={1.6} />
            {live.kind === 'tool' && view === live.tool && fit < 2 ? <span className="deck-label">{live.label}</span> : null}
          </button>
        ) : null}
        <button role="tab" aria-selected={view === 'more'} className={`deck-tab deck-more ${view === 'more' ? 'on' : ''}`} data-testid="island-more" title="More tools" aria-label="More tools" onClick={props.onMore}>
          <Icon name="grid" size={18} stroke={1.6} />
          {view === 'more' && fit < 2 ? <span className="deck-label">More</span> : null}
        </button>
        <span className="deck-gap" />
        {props.trail}
      </div>
      {menu ? (
        <div className="shelf-pop tab-menu" role="menu" style={{ left: menu.x + 8, top: 40 }} onMouseLeave={() => setMenu(null)}>
          {index >= 0 || items.some((i) => i.id === menu.id) ? (
            <>
              <button role="menuitem" disabled={items[0]?.id === menu.id} onClick={() => { props.onMove(menu.id, -1); setMenu(null); }}><Icon name="chevronLeft" size={11} /> Move left</button>
              <button role="menuitem" disabled={items[items.length - 1]?.id === menu.id} onClick={() => { props.onMove(menu.id, 1); setMenu(null); }}><Icon name="chevronRight" size={11} /> Move right</button>
            </>
          ) : null}
          <button role="menuitem" onClick={() => { props.onUnpin(menu.id); setMenu(null); }}><Icon name="close" size={11} /> Unpin (keep in More)</button>
          <div className="muted small" style={{ padding: '4px 8px' }}>{items.length}/{DECK_MAX} pinned · pin more from More</div>
        </div>
      ) : null}
    </>
  );
}

/** An element's width, followed as it changes (the panel's size, a bigger text size). */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
