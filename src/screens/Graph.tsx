// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph: files, notes, tags, people, organisations, sources and
// folders, linked by Markdown and wiki links, shared names, shared tags and
// similar meaning. Drawn on a canvas (thousands of nodes stay smooth: only what
// is on screen is drawn, labels only when zoomed in), laid out a few
// milliseconds per frame so the page never freezes. Click a node to see its
// links; double-click a file to open it.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph as G, GraphNode, NodeType } from '../../core/graph/build';
import { ForceLayout } from '../../core/graph/layout';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { KIND_COLOR, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/agents.css';

const TYPE_COLOR: Record<NodeType, string> = { file: '#64748b', folder: '#f59e0b', tag: '#8b5cf6', entity: '#ec4899', source: '#14b8a6' };
const EDGE_COLOR: Record<string, string> = { link: 'rgba(99,102,241,.55)', tag: 'rgba(139,92,246,.35)', entity: 'rgba(236,72,153,.35)', source: 'rgba(20,184,166,.3)', folder: 'rgba(148,163,184,.25)', similar: 'rgba(34,197,94,.45)' };

function colorOf(n: GraphNode): string {
  if (n.type !== 'file') return TYPE_COLOR[n.type];
  if (n.kind === 'note') return '#6366f1';
  return (KIND_COLOR as Record<string, string>)[n.kind ?? 'other'] ?? TYPE_COLOR.file;
}

export function Graph() {
  const { route, go } = useStore();
  const focus = route.arg;
  const [data, setData] = useState<G | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [show, setShow] = useState<Record<NodeType, boolean>>({ file: true, folder: false, tag: true, entity: true, source: false });
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<GraphNode | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const layoutRef = useRef<ForceLayout | null>(null);
  const hover = useRef<number>(-1);
  const userMoved = useRef(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    void api.agents.graph({ kinds: kinds.length ? kinds : undefined, focus: focus || undefined, depth: 2 }).then((g) => alive && setData(g));
    return () => { alive = false; };
  }, [kinds, focus]);

  // Nodes shown with the type filters; edges only between shown nodes.
  const g = useMemo(() => {
    if (!data) return null;
    const nodes = data.nodes.filter((n) => show[n.type] || n.id === focus || n.id === `f:${focus}`);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const edges = data.edges.filter((e) => index.has(e.a) && index.has(e.b)).map((e) => ({ a: index.get(e.a)!, b: index.get(e.b)!, w: e.w, type: e.type }));
    return { nodes, edges, index };
  }, [data, show, focus]);

  const match = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return g && words.length ? new Set(g.nodes.map((n, i) => (words.every((w) => n.label.toLowerCase().includes(w)) ? i : -1)).filter((i) => i >= 0)) : null;
  }, [q, g]);

  // The drawing loop reads the search result from here, so typing never restarts the layout.
  const matchRef = useRef<Set<number> | null>(null);
  matchRef.current = match;

  useEffect(() => {
    if (!g || !canvas.current) return;
    const cv = canvas.current;
    const L = new ForceLayout(g.nodes.length, g.edges, { seed: 7 });
    layoutRef.current = L;
    view.current = { x: 0, y: 0, k: Math.min(1.4, 900 / (Math.sqrt(g.nodes.length) * 24 + 200)) };
    let raf = 0;
    let settled = false;
    // Until the person pans or zooms, the view keeps the whole graph in frame.
    userMoved.current = false;
    const fit = () => {
      if (userMoved.current || !L.n) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < L.n; i++) { x0 = Math.min(x0, L.x[i]); x1 = Math.max(x1, L.x[i]); y0 = Math.min(y0, L.y[i]); y1 = Math.max(y1, L.y[i]); }
      const w = cv.clientWidth - 120, h = cv.clientHeight - 80;
      view.current = { x: -(x0 + x1) / 2, y: -(y0 + y1) / 2, k: Math.max(0.05, Math.min(4, w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))) };
    };
    // The theme's own mode (it may differ from the system's).
    const isDark = () => document.documentElement.dataset.theme === 'dark';
    const draw = () => {
      if (!settled) settled = L.run(10);
      fit();
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext('2d')!;
      const dark = isDark();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { x: ox, y: oy, k } = view.current;
      const sx = (i: number) => w / 2 + (L.x[i] + ox) * k;
      const sy = (i: number) => h / 2 + (L.y[i] + oy) * k;
      const sel = selRef.current;
      const near = sel >= 0 ? new Set(g.edges.flatMap((e) => (e.a === sel ? [e.b] : e.b === sel ? [e.a] : []))) : null;
      // Edges first, lightly; those of the selected node stronger.
      for (const e of g.edges) {
        const x1 = sx(e.a), y1 = sy(e.a), x2 = sx(e.b), y2 = sy(e.b);
        if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
        const on = sel >= 0 && (e.a === sel || e.b === sel);
        ctx.strokeStyle = on ? (dark ? 'rgba(255,255,255,.8)' : 'rgba(30,30,40,.7)') : EDGE_COLOR[e.type] ?? 'rgba(148,163,184,.3)';
        ctx.globalAlpha = sel >= 0 && !on ? 0.25 : 1;
        ctx.lineWidth = on ? 1.6 : 0.8;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const labels = k > 0.9 || g.nodes.length < 150;
      for (let i = 0; i < g.nodes.length; i++) {
        const x = sx(i), y = sy(i);
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        const n = g.nodes[i];
        const r = Math.max(2.5, Math.min(14, 2.5 + Math.sqrt(n.degree) * 1.6)) * Math.min(1.6, Math.max(0.6, k));
        const match = matchRef.current;
        const dim = (sel >= 0 && i !== sel && !near!.has(i)) || (match && !match.has(i));
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fillStyle = colorOf(n);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        if (i === sel || i === hover.current) { ctx.strokeStyle = dark ? '#fff' : '#111'; ctx.lineWidth = 2; ctx.stroke(); }
        if ((labels && n.degree > 1) || i === sel || i === hover.current || (near && near.has(i)) || (match && match.has(i))) {
          ctx.fillStyle = dark ? 'rgba(255,255,255,.88)' : 'rgba(20,20,28,.85)';
          ctx.font = `${n.type === 'file' ? 400 : 600} 11px system-ui, sans-serif`;
          ctx.fillText(n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label, x + r + 3, y + 4);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // Pan, zoom, hover, select and drag nodes.
    const at = (ev: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const { x: ox, y: oy, k } = view.current;
      const px = (ev.clientX - rect.left - rect.width / 2) / k - ox, py = (ev.clientY - rect.top - rect.height / 2) / k - oy;
      let best = -1, bd = (10 / k) ** 2;
      for (let i = 0; i < L.n; i++) { const d = (L.x[i] - px) ** 2 + (L.y[i] - py) ** 2; if (d < bd) { bd = d; best = i; } }
      return { best, px, py };
    };
    let drag: { node: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
    const down = (ev: MouseEvent) => {
      userMoved.current = true;
      const { best } = at(ev);
      drag = { node: best, sx: ev.clientX, sy: ev.clientY, ox: view.current.x, oy: view.current.y, moved: false };
      if (best >= 0) L.pinned.add(best);
    };
    const move = (ev: MouseEvent) => {
      if (!drag) { hover.current = at(ev).best; cv.style.cursor = hover.current >= 0 ? 'pointer' : 'grab'; return; }
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.node >= 0) { const { px, py } = at(ev); L.x[drag.node] = px; L.y[drag.node] = py; L.alpha = Math.max(L.alpha, 0.3); settled = false; }
      else { view.current.x = drag.ox + dx / view.current.k; view.current.y = drag.oy + dy / view.current.k; }
    };
    const up = () => {
      if (drag && !drag.moved) { selRef.current = drag.node; setSel(drag.node >= 0 ? g.nodes[drag.node] : null); }
      if (drag && drag.node >= 0 && !drag.moved) L.pinned.delete(drag.node);
      drag = null;
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      userMoved.current = true;
      view.current.k = Math.max(0.05, Math.min(6, view.current.k * Math.exp(-ev.deltaY * 0.0015)));
    };
    const dbl = (ev: MouseEvent) => {
      const { best } = at(ev);
      const n = best >= 0 ? g.nodes[best] : null;
      if (n?.type === 'file' && n.path) void api.files.open(n.path);
      else if (n?.type === 'folder' && n.path) go({ name: 'browse', arg: n.path });
    };
    cv.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('dblclick', dbl);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('dblclick', dbl);
    };
  }, [g, go]);

  const selRef = useRef(-1);
  useEffect(() => {
    selRef.current = sel && g ? g.index.get(sel.id) ?? -1 : -1;
  }, [sel, g]);

  const neighbours = useMemo(() => {
    if (!sel || !g) return [];
    const i = g.index.get(sel.id);
    return g.edges.filter((e) => e.a === i || e.b === i).map((e) => ({ n: g.nodes[e.a === i ? e.b : e.a], type: e.type })).slice(0, 40);
  }, [sel, g]);

  const KINDS = ['note', 'document', 'image', 'video', 'audio', 'code', 'archive'];
  return (
    <div className="graph-page">
      <PageHead title={focus ? `Connections of ${focus.split(/[\\/]/).pop()}` : 'Knowledge graph'} sub={data ? `${g?.nodes.length ?? 0} nodes · ${g?.edges.length ?? 0} links${data.truncated ? ` · ${data.truncated} files left out to stay fast` : ''}` : 'Reading your library…'}>
        {focus ? <button className="btn" onClick={() => go({ name: 'graph' })}>Whole library</button> : null}
        <input className="input" placeholder="Find in the graph" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }}
          onKeyDown={(e) => {
            // Enter jumps to the best match and shows its links.
            if (e.key !== 'Enter' || !g || !match?.size) return;
            const i = [...match].sort((a, b) => g.nodes[b].degree - g.nodes[a].degree)[0];
            const L = layoutRef.current;
            userMoved.current = true;
            if (L) { view.current.x = -L.x[i]; view.current.y = -L.y[i]; view.current.k = Math.max(view.current.k, 1.2); }
            selRef.current = i;
            setSel(g.nodes[i]);
          }} />
      </PageHead>
      <div className="row graph-filters">
        {(Object.keys(TYPE_COLOR) as NodeType[]).map((t) => (
          <label key={t} className="chip"><input type="checkbox" checked={show[t]} onChange={(e) => setShow({ ...show, [t]: e.target.checked })} /><span className="dot" style={{ background: TYPE_COLOR[t] }} />{t === 'entity' ? 'people & organisations' : t === 'file' ? 'files' : t === 'source' ? 'sources' : `${t}s`}</label>
        ))}
        <span className="grow" />
        <div className="seg sm">
          <button className={!kinds.length ? 'on' : ''} onClick={() => setKinds([])}>All</button>
          {KINDS.map((k) => <button key={k} className={kinds.includes(k) ? 'on' : ''} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>{k === 'note' ? 'Notes' : k[0].toUpperCase() + k.slice(1) + 's'}</button>)}
        </div>
      </div>
      <div className="graph-wrap">
        <canvas ref={canvas} className="graph-canvas" aria-label="Knowledge graph" />
        {sel ? (
          <div className="card graph-side">
            <div className="row" style={{ gap: 8 }}><span className="dot" style={{ background: colorOf(sel) }} /><b className="grow ellipsis">{sel.label}</b><button className="btn sm ghost icon" onClick={() => { setSel(null); selRef.current = -1; }}><Icon name="close" size={12} /></button></div>
            {sel.path ? <div className="small muted ellipsis" title={sel.path}>{sel.path}</div> : null}
            <div className="btn-row" style={{ margin: '8px 0' }}>
              {sel.type === 'file' && sel.path ? <button className="btn sm" onClick={() => void api.files.open(sel.path!)}>Open</button> : null}
              {sel.path ? <button className="btn sm" onClick={() => void api.files.reveal(sel.path!)}>Show</button> : null}
              {sel.type === 'file' && sel.path ? <button className="btn sm ghost" onClick={() => go({ name: 'graph', arg: sel.path })}>Focus</button> : null}
            </div>
            <div className="small muted">{neighbours.length} links</div>
            <div className="graph-links">
              {neighbours.map(({ n, type }) => (
                <button key={n.id + type} className="graph-link" onClick={() => setSel(n)}><span className="dot" style={{ background: colorOf(n) }} /><span className="grow ellipsis">{n.label}</span><span className="small muted">{type}</span></button>
              ))}
            </div>
          </div>
        ) : null}
        {data && !data.nodes.length ? <div className="graph-empty small muted">Nothing to show yet. Notes with [[links]], tags and documents Keeper has read appear here.</div> : null}
      </div>
    </div>
  );
}
