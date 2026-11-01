// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// DXF drawings: every line, arc, circle, polyline and text drawn as SVG, with
// layers you can hide and zoom by scrolling.

import { useMemo, useState } from 'react';
import { dxfToSvg, parseDxf } from '../../../core/filekit/dxf';
import { Bar, BarButton, Loaded, useLoad, type ViewerProps } from '../Preview';
import { fetchBytes } from '../util';

export function CadViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => parseDxf(new TextDecoder('latin1').decode(await fetchBytes(info.path, 60 * 1024 * 1024))), [info.path]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  return (
    <Loaded state={state} label="Reading the drawing">
      {(d) => <Drawing d={d} hidden={hidden} setHidden={setHidden} zoom={zoom} setZoom={setZoom} inline={mode === 'inline'} />}
    </Loaded>
  );
}

function Drawing({ d, hidden, setHidden, zoom, setZoom, inline }: { d: ReturnType<typeof parseDxf>; hidden: string[]; setHidden: (h: string[]) => void; zoom: number; setZoom: (z: number) => void; inline: boolean }) {
  const svg = useMemo(() => dxfToSvg(d, { hidden }), [d, hidden]);
  const layers = [...new Set(d.shapes.map((s) => s.layer))].sort();
  const skipped = Object.entries(d.skipped).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ');
  return (
    <div className="pv-fill" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!inline ? (
        <Bar>
          <BarButton icon="minus" label="Smaller" onClick={() => setZoom(Math.max(0.2, zoom / 1.25))} />
          <BarButton icon="plus" label="Larger" onClick={() => setZoom(Math.min(20, zoom * 1.25))} />
          <span className="small muted">{d.shapes.length.toLocaleString()} shapes · {layers.length} layer{layers.length === 1 ? '' : 's'}{d.units ? ` · ${d.units}` : ''}{skipped ? ` · not drawn: ${skipped}` : ''}</span>
        </Bar>
      ) : null}
      <div
        className="cad-canvas"
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg)', color: 'var(--text)' }}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(Math.max(0.2, Math.min(20, zoom * (e.deltaY < 0 ? 1.1 : 0.9)))); } }}
      >
        {/* At 100% the whole drawing fits the window; zooming makes it larger than the window. */}
        <div aria-label="Drawing" role="img" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, padding: 12, boxSizing: 'border-box' }} dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ') }} />
      </div>
      {!inline && layers.length > 1 ? (
        <div className="row small" style={{ flexWrap: 'wrap', gap: 10, padding: '6px 10px', borderTop: '1px solid var(--line)' }}>
          {layers.map((l) => (
            <label key={l} className="row"><input type="checkbox" checked={!hidden.includes(l)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== l) : [...hidden, l])} /> {l}</label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
