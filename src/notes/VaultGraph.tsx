// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The vault's graph (all notes, or the notes around one), drawn with the same
// force layout as Keeper's knowledge graph. Click a dot to open the note.

import { useEffect, useRef, useState } from 'react';
import { ForceLayout } from '../../core/graph/layout';
import { api } from '../api';
import { useNotes } from './ctx';

type G = Awaited<ReturnType<typeof api.notes.graph>>;

export function VaultGraph({ center, depth = 1, compact }: { center?: string; depth?: number; compact?: boolean }) {
  const n = useNotes();
  const [g, setG] = useState<G | null>(null);
  const [opts, setOpts] = useState({ unresolved: false, attachments: false, tagFilter: '' });
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });

  useEffect(() => {
    let alive = true;
    void api.notes.graph(n.vault.id, { center, depth, unresolved: opts.unresolved, attachments: opts.attachments }).then((x) => alive && setG(x));
    return () => { alive = false; };
  }, [n.vault.id, center, depth, opts.unresolved, opts.attachments, n.rev]);

  useEffect(() => {
    const c = canvas.current;
    if (!g || !c) return;
    const nodes = opts.tagFilter ? g.nodes.filter((x) => x.id === center || x.tags.some((t) => t.toLowerCase().startsWith(opts.tagFilter.toLowerCase().replace(/^#/, '')))) : g.nodes;
    const idx = new Map(nodes.map((x, i) => [x.id, i]));
    const edges = g.edges.filter((e) => idx.has(e.from) && idx.has(e.to)).map((e) => ({ a: idx.get(e.from)!, b: idx.get(e.to)!, w: 1 }));
    const layout = new ForceLayout(nodes.length, edges, { springLength: 40, repulsion: 80 });
    let raf = 0;
    const ctx = c.getContext('2d')!;
    const style = getComputedStyle(c);
    const fg = style.getPropertyValue('--text').trim() || '#888';
    const accent = style.getPropertyValue('--accent').trim() || '#7c3aed';
    let hover = -1;
    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const v = view.current;
      const tx = (x: number) => w / 2 + v.x + x * v.k, ty = (y: number) => h / 2 + v.y + y * v.k;
      ctx.strokeStyle = 'rgba(128,128,128,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const e of edges) { ctx.moveTo(tx(layout.x[e.a]), ty(layout.y[e.a])); ctx.lineTo(tx(layout.x[e.b]), ty(layout.y[e.b])); }
      ctx.stroke();
      nodes.forEach((x, i) => {
        const r = Math.min(10, 3 + Math.sqrt(x.degree) * 1.5);
        ctx.beginPath();
        ctx.arc(tx(layout.x[i]), ty(layout.y[i]), r, 0, Math.PI * 2);
        ctx.fillStyle = x.id === center || i === hover ? accent : x.kind === 'missing' ? 'rgba(128,128,128,.4)' : x.kind === 'file' ? '#14b8a6' : 'rgba(128,128,128,.85)';
        ctx.fill();
        if (v.k > 0.7 || nodes.length < 60 || i === hover) {
          ctx.fillStyle = fg;
          ctx.font = '11px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(x.label, tx(layout.x[i]), ty(layout.y[i]) + r + 12);
        }
      });
    };
    const tick = () => {
      const moving = layout.run(8);
      draw();
      if (moving) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const pick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const v = view.current;
      const x = (e.clientX - rect.left - rect.width / 2 - v.x) / v.k, y = (e.clientY - rect.top - rect.height / 2 - v.y) / v.k;
      let best = -1, bd = 144 / (v.k * v.k);
      nodes.forEach((_, i) => { const d = (layout.x[i] - x) ** 2 + (layout.y[i] - y) ** 2; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const onMove = (e: MouseEvent) => { const h = pick(e); if (h !== hover) { hover = h; c.style.cursor = h >= 0 ? 'pointer' : 'grab'; draw(); } };
    const onClick = (e: MouseEvent) => { const i = pick(e); if (i >= 0 && nodes[i].kind !== 'missing') n.open(nodes[i].id, { newTab: e.metaKey || e.ctrlKey }); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); view.current.k = Math.min(4, Math.max(0.1, view.current.k * (e.deltaY < 0 ? 1.1 : 0.9))); draw(); };
    let dragging: { x: number; y: number; vx: number; vy: number } | null = null;
    const onDown = (e: MouseEvent) => { dragging = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y }; };
    const onDrag = (e: MouseEvent) => { if (!dragging) return; view.current.x = dragging.vx + e.clientX - dragging.x; view.current.y = dragging.vy + e.clientY - dragging.y; draw(); };
    const onUp = () => { dragging = null; };
    c.addEventListener('mousemove', onMove);
    c.addEventListener('click', onClick);
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('mousedown', onDown);
    addEventListener('mousemove', onDrag);
    addEventListener('mouseup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener('mousemove', onMove);
      c.removeEventListener('click', onClick);
      c.removeEventListener('wheel', onWheel);
      c.removeEventListener('mousedown', onDown);
      removeEventListener('mousemove', onDrag);
      removeEventListener('mouseup', onUp);
    };
  }, [g, center, opts.tagFilter, n]);

  return (
    <div className={`nt-graph ${compact ? 'is-compact' : ''}`}>
      {!compact ? (
        <div className="nt-graph-bar">
          <label><input type="checkbox" checked={opts.unresolved} onChange={(e) => setOpts({ ...opts, unresolved: e.target.checked })} /> Missing notes</label>
          <label><input type="checkbox" checked={opts.attachments} onChange={(e) => setOpts({ ...opts, attachments: e.target.checked })} /> Attachments</label>
          <input placeholder="Only tag…" value={opts.tagFilter} onChange={(e) => setOpts({ ...opts, tagFilter: e.target.value })} />
          <span className="nt-dim">{g ? `${g.nodes.length} notes · ${g.edges.length} links` : ''}</span>
        </div>
      ) : null}
      <canvas ref={canvas} className="nt-graph-canvas" aria-label="Graph of notes" />
    </div>
  );
}
