// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Island → Tools: which tools the Island shows, in which order,
// and how it opens.

import type { IslandSettings as IS } from '../../../core/api';
import { ISLAND_TOOLS, moveTool, orderedTools, toggleTool } from '../../../core/island-tools/tools';
import { Icon } from '../../components/Icon';
import { Toggle } from '../../components/ui';
import { PANEL_PX, PANEL_SIZES, PANEL_SIZE_LABEL, isPanelSize, tabPanel, withTabSize, type PanelSize } from '../../../core/island-size';

export function IslandToolsSettings({ isl, set }: { isl: IS; set: (p: Partial<IS>) => void }) {
  const all = orderedTools(isl.toolOrder, []);
  const shown = new Set(orderedTools(isl.toolOrder, isl.toolsOff));
  return (
    <div className="card settings-section">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Open when the pointer rests on it</div>
          <div className="small muted">Clicking, tapping or swiping down always opens it.</div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="small muted">after</span>
          <input type="range" min={0} max={1000} step={50} value={isl.hoverDelayMs ?? 250} disabled={isl.hoverOpen === false} onChange={(e) => set({ hoverDelayMs: Number(e.target.value) })} />
          <span className="small num" style={{ width: 52 }}>{isl.hoverDelayMs ?? 250} ms</span>
          <Toggle on={isl.hoverOpen !== false} onChange={(v) => set({ hoverOpen: v })} />
        </div>
      </div>
      <div className="small muted" style={{ margin: '10px 0 6px' }}>Choose the tools and their order. You can also right-click a tab in the Island.</div>
      <div className="tool-order" data-testid="tool-order">
        {all.map((id, i) => {
          const t = ISLAND_TOOLS.find((x) => x.id === id)!;
          return (
            <div key={id} className={`tool-row ${shown.has(id) ? '' : 'off'}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/x-island-tool', id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const from = e.dataTransfer.getData('text/x-island-tool'); if (from) set({ toolOrder: moveTool(isl.toolOrder, from, i) }); }}>
              <Icon name="drag" size={12} />
              <Icon name={t.icon} size={14} />
              <span className="grow">{t.label}</span>
              <select className="input sm" aria-label={`Size of the open Island for ${t.label}`} title="How big the Island opens on this tab" value={isPanelSize(isl.panelSizes?.[id]) ? isl.panelSizes![id] : ''} onChange={(e) => set({ panelSizes: withTabSize(isl, id, (e.target.value || null) as PanelSize | null) as IS['panelSizes'] })} style={{ width: 150 }}>
                <option value="">Default ({((d) => (d.px === PANEL_PX[d.size] ? PANEL_SIZE_LABEL[d.size] : `${d.px.w}×${d.px.h}`))(tabPanel(id, { ...isl, panelSizes: {} }))})</option>
                {PANEL_SIZES.map((z) => <option key={z} value={z}>{PANEL_SIZE_LABEL[z]}</option>)}
              </select>
              <button className="btn sm icon" disabled={i === 0} title="Move up" aria-label="Move up" onClick={() => set({ toolOrder: moveTool(isl.toolOrder, id, i - 1) })}><Icon name="arrowUp" size={11} /></button>
              <button className="btn sm icon" disabled={i === all.length - 1} title="Move down" aria-label="Move down" onClick={() => set({ toolOrder: moveTool(isl.toolOrder, id, i + 1) })}><Icon name="chevronDown" size={11} /></button>
              {id === 'home' ? <span className="small muted" style={{ width: 40 }}>always</span> : <Toggle on={shown.has(id)} onChange={(v) => set({ toolsOff: toggleTool(isl.toolsOff, id, v) })} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
