// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Island → Tools: the deck (up to four tools pinned at the top of the
// open Island, dragged into order), which tools More offers, and how it opens.

import type { IslandSettings as IS } from '../../../core/api';
import { useState } from 'react';
import { DECK_MAX, ISLAND_TOOLS, migrateDeck, moveInDeck, orderedTools, pinTool, toggleTool, unpinTool, type IslandToolId } from '../../../core/island-tools/tools';
import { Icon } from '../../components/Icon';
import { Toggle } from '../../components/ui';
import { PANEL_PX, PANEL_SIZES, PANEL_SIZE_LABEL, isPanelSize, tabPanel, withTabSize, type PanelSize } from '../../../core/island-size';

const DRAG = 'text/x-island-tool';

export function IslandToolsSettings({ isl, set }: { isl: IS; set: (p: Partial<IS>) => void }) {
  const deck = (isl.deck ?? migrateDeck(isl.toolOrder, isl.toolsOff)) as IslandToolId[];
  const shown = new Set(orderedTools(undefined, isl.toolsOff));
  const label = (id: string) => ISLAND_TOOLS.find((x) => x.id === id)?.label ?? id;
  // Pinned first (in the deck's order), then the rest by name.
  const all = [...deck, ...ISLAND_TOOLS.map((t) => t.id).filter((id) => !deck.includes(id)).sort((a, b) => label(a).localeCompare(label(b)))];
  const setDeck = (next: IslandToolId[]) => set({ deck: next, toolsOff: (isl.toolsOff ?? []).filter((x) => !next.includes(x as IslandToolId)) });
  const [over, setOver] = useState<number | null>(null);
  const drop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG) as IslandToolId;
    if (!id) return;
    if (deck.includes(id)) setDeck(moveInDeck(deck, id, Math.min(i, deck.length - 1)));
    else if (deck.length < DECK_MAX) setDeck(pinTool(deck, id, { at: i }));
    else if (deck[i]) setDeck(pinTool(deck, id, { replace: deck[i] }));
  };
  return (
    <div className="card settings-section">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Open when the pointer rests on it</div>
          <div className="small muted">Clicking, tapping or swiping down always opens it.</div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="small muted">after</span>
          <input type="range" min={0} max={1000} step={10} value={isl.hoverDelayMs ?? 250} disabled={isl.hoverOpen === false} aria-label="Hover delay" onChange={(e) => set({ hoverDelayMs: Number(e.target.value) })} />
          <span className="small num" style={{ width: 52 }}>{isl.hoverDelayMs ?? 250} ms</span>
          <Toggle on={isl.hoverOpen !== false} onChange={(v) => set({ hoverOpen: v })} />
        </div>
      </div>
      <div style={{ fontWeight: 600, margin: '14px 0 2px' }}>Deck</div>
      <div className="small muted" style={{ marginBottom: 8 }}>Up to {DECK_MAX} tools sit at the top of the open Island; every other tool is in More. Drag to reorder, or drop a tool from the list on a place. You can also pin from More in the Island.</div>
      <div className="deck-slots" data-testid="island-deck-settings" role="list" aria-label={`Pinned tools (${deck.length} of ${DECK_MAX})`}>
        {Array.from({ length: DECK_MAX }, (_, i) => {
          const id = deck[i];
          const t = id ? ISLAND_TOOLS.find((x) => x.id === id) : undefined;
          return (
            <div key={id ?? `free-${i}`} role="listitem" className={`deck-slot ${t ? '' : 'free'} ${over === i ? 'over' : ''}`} draggable={!!t}
              onDragStart={(e) => { if (id) e.dataTransfer.setData(DRAG, id); }} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, i)}>
              {t ? <><Icon name="drag" size={12} /><Icon name={t.icon} size={14} /><span className="grow">{t.label}</span><button className="btn sm icon" title={`Unpin ${t.label}`} aria-label={`Unpin ${t.label}`} onClick={() => setDeck(unpinTool(deck, t.id))}><Icon name="close" size={11} /></button></> : <span className="small muted">Free</span>}
            </div>
          );
        })}
      </div>
      <div className="small muted" style={{ margin: '12px 0 6px' }}>All tools: pin one to the deck, choose which More offers, and how big the Island opens on each.</div>
      <div className="tool-order" data-testid="tool-order">
        {all.map((id) => {
          const t = ISLAND_TOOLS.find((x) => x.id === id)!;
          const pinned = deck.includes(id);
          return (
            <div key={id} className={`tool-row ${shown.has(id) || pinned ? '' : 'off'}`} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG, id)}>
              <Icon name="drag" size={12} />
              <Icon name={t.icon} size={14} />
              <span className="grow">{t.label}</span>
              <select className="input sm" aria-label={`Size of the open Island for ${t.label}`} title="How big the Island opens on this tool" value={isPanelSize(isl.panelSizes?.[id]) ? isl.panelSizes![id] : ''} onChange={(e) => set({ panelSizes: withTabSize(isl, id, (e.target.value || null) as PanelSize | null) as IS['panelSizes'] })} style={{ width: 150 }}>
                <option value="">Default ({((d) => (d.px === PANEL_PX[d.size] ? PANEL_SIZE_LABEL[d.size] : `${d.px.w}×${d.px.h}`))(tabPanel(id, { ...isl, panelSizes: {} }))})</option>
                {PANEL_SIZES.map((z) => <option key={z} value={z}>{PANEL_SIZE_LABEL[z]}</option>)}
              </select>
              <button className={`btn sm ${pinned ? 'primary' : ''}`} data-testid={`settings-pin-${id}`} aria-pressed={pinned} disabled={!pinned && deck.length >= DECK_MAX} title={pinned ? 'Unpin from the deck (it stays in More)' : deck.length >= DECK_MAX ? `The deck holds ${DECK_MAX}: unpin one first` : 'Pin to the deck'} onClick={() => setDeck(pinned ? unpinTool(deck, id) : pinTool(deck, id))}><Icon name="pin" size={11} /> {pinned ? 'Pinned' : 'Pin'}</button>
              {id === 'home' || pinned ? <span className="small muted" style={{ width: 40 }} title={pinned ? 'Pinned tools are always offered' : undefined}>{pinned ? 'shown' : 'always'}</span> : <Toggle on={shown.has(id)} onChange={(v) => set({ toolsOff: toggleTool(isl.toolsOff, id, v) })} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
