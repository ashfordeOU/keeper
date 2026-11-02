// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More: every Island tool that is not pinned to the deck, in a grid (recent
// ones first, then by name), with a filter. The deck's four places are at the
// top: drag a tool onto one (or use its pin) to pin it, drag pinned tools to
// reorder them. Pinning with the deck full asks which tool to replace; it never
// grows past four. The tool launcher is at the bottom.

import { useEffect, useRef, useState } from 'react';
import { DECK_MAX, type IslandToolId } from '../../core/island-tools/tools';
import { Icon } from '../components/Icon';

const DRAG = 'text/x-island-tool';
const RECENT_KEY = 'keeper.island.recentTools';

/** Recently opened tools (this window only; a convenience, so storage may be missing). */
export function readRecentTools(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export function writeRecentTools(v: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(v)); } catch { /* private window or no storage */ }
}

export interface MoreTool { id: IslandToolId; icon: string; label: string; badge?: number }

export function MoreGrid(props: {
  deck: MoreTool[];
  recent: MoreTool[];
  rest: MoreTool[];
  onOpen: (id: IslandToolId) => void;
  /** pin a tool (at a place, or in place of a pinned one) */
  onPin: (id: IslandToolId, o?: { at?: number; replace?: IslandToolId }) => void;
  onUnpin: (id: IslandToolId) => void;
  onMove: (id: IslandToolId, to: number) => void;
  /** the separate tool launcher, when it is on */
  onLauncher?: () => void;
  onSettings?: () => void;
}) {
  const { deck } = props;
  const [q, setQ] = useState('');
  const [choose, setChoose] = useState<IslandToolId | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const pinned = new Set(deck.map((d) => d.id));
  const match = (t: MoreTool) => !q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase()) || t.id.includes(q.trim().toLowerCase());

  // Any key while More is open starts filtering (when the Island has the keyboard).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || document.activeElement === field.current) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      setQ((x) => x + e.key);
      field.current?.focus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const pin = (id: IslandToolId, at?: number) => {
    if (pinned.has(id)) { if (at !== undefined) props.onMove(id, at); return; }
    if (deck.length < DECK_MAX) { props.onPin(id, { at }); return; }
    // Full: dropped on a place replaces that tool; the pin button asks which.
    if (at !== undefined && deck[at]) props.onPin(id, { replace: deck[at].id });
    else setChoose(id);
  };

  const cell = (t: MoreTool) => (
    <div key={t.id} className={`more-cell ${pinned.has(t.id) ? 'pinned' : ''}`} role="gridcell">
      <button
        className="more-open" data-testid={`island-more-${t.id}`} title={t.label} draggable
        onDragStart={(e) => { e.dataTransfer.setData(DRAG, t.id); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => props.onOpen(t.id)}
        onContextMenu={(e) => { e.preventDefault(); if (pinned.has(t.id)) props.onUnpin(t.id); else pin(t.id); }}
      >
        <Icon name={t.icon} size={18} stroke={1.6} />
        <span className="more-label">{t.label}</span>
        {t.badge ? <span className="deck-badge" aria-hidden>{t.badge}</span> : null}
      </button>
      <button
        className="more-pin" data-testid={`island-pin-${t.id}`} aria-pressed={pinned.has(t.id)}
        title={pinned.has(t.id) ? `Unpin ${t.label}` : `Pin ${t.label} to the deck`} aria-label={pinned.has(t.id) ? `Unpin ${t.label}` : `Pin ${t.label} to the deck`}
        onClick={() => (pinned.has(t.id) ? props.onUnpin(t.id) : pin(t.id))}
      ><Icon name="pin" size={11} stroke={1.8} /></button>
    </div>
  );

  const recent = props.recent.filter(match);
  const rest = props.rest.filter(match);
  return (
    <div className="more" data-testid="island-more-grid">
      <div className="more-head">
        <div className="more-deck" role="list" aria-label={`Pinned to the deck (${deck.length} of ${DECK_MAX})`} data-testid="island-deck-slots">
          {Array.from({ length: DECK_MAX }, (_, i) => {
            const d = deck[i];
            return (
              <div
                key={d?.id ?? `free-${i}`} role="listitem" className={`more-slot ${d ? '' : 'free'} ${over === i ? 'over' : ''}`}
                draggable={!!d} onDragStart={(e) => { if (d) { e.dataTransfer.setData(DRAG, d.id); e.dataTransfer.effectAllowed = 'move'; } }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(i); } }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData(DRAG) as IslandToolId; if (id) pin(id, Math.min(i, deck.length - (pinned.has(id) ? 1 : 0))); }}
                title={d ? `${d.label}: drag to reorder` : 'Drop a tool here to pin it'}
              >
                {d ? <><Icon name={d.icon} size={14} stroke={1.6} /><span>{d.label}</span><button className="more-unpin" aria-label={`Unpin ${d.label}`} title={`Unpin ${d.label}`} onClick={() => props.onUnpin(d.id)}><Icon name="close" size={9} /></button></> : <span className="muted">Free</span>}
              </div>
            );
          })}
        </div>
        <input ref={field} className="input sm more-filter" placeholder="Filter" aria-label="Filter tools" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } if (e.key === 'Enter') { const first = [...recent, ...rest][0]; if (first) props.onOpen(first.id); } }} />
      </div>
      {choose ? (
        <div className="more-choose" role="group" aria-label="The deck is full: choose a tool to replace" data-testid="island-replace">
          <span>The deck holds {DECK_MAX}. Replace</span>
          {deck.map((d) => <button key={d.id} className="chip" onClick={() => { props.onPin(choose, { replace: d.id }); setChoose(null); }}><Icon name={d.icon} size={11} /> {d.label}</button>)}
          <span>with {props.rest.concat(props.recent).find((t) => t.id === choose)?.label}?</span>
          <button className="chip" onClick={() => setChoose(null)}>Cancel</button>
        </div>
      ) : null}
      {recent.length ? <><div className="more-caption">Recent</div><div className="more-grid" role="grid" aria-label="Recent tools"><div role="row" className="more-row">{recent.map(cell)}</div></div></> : null}
      {rest.length ? <><div className="more-caption">{recent.length ? 'All tools' : 'Tools'}</div><div className="more-grid" role="grid" aria-label="Tools"><div role="row" className="more-row">{rest.map(cell)}</div></div></> : null}
      {!recent.length && !rest.length ? <div className="muted" style={{ padding: 12 }}>No tool called “{q}”.</div> : null}
      <div className="more-foot">
        {props.onLauncher ? <button className="chip" data-testid="island-launcher-btn" onClick={props.onLauncher}><Icon name="grid" size={11} /> Tool launcher</button> : null}
        {props.onSettings ? <button className="chip" onClick={props.onSettings}><Icon name="settings" size={11} /> Choose tools…</button> : null}
      </div>
    </div>
  );
}
