// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph of everything: search a person or a topic and see what
// is linked to it — mail, meetings, events, tasks, notes, files — with the
// reason for every link. A map (force layout on a canvas; only the
// best-linked nodes are drawn, the rest summed up per kind, so a hundred
// thousand things stay smooth) or a timeline (lanes per kind along time).
// The inspector on the right shows the selected thing, what to do with it,
// its links and how it connects to anything else.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphStatus } from '../../core/api-agents';
import type { EverythingHit } from '../../core/brain/items';
import { ITEM_KINDS, KIND_LABEL, REASON_LABEL, type Explanation, type GraphView, type ItemKind, type ItemRef, type KNode, type RelatedItem } from '../../core/graph/everything';
import { ForceLayout } from '../../core/graph/layout';
import { api } from '../api';
import { FirstRun } from '../components/FirstRun';
import { Icon } from '../components/Icon';
import { Modal, PageHead, Toggle } from '../components/ui';
import { KIND_ICON, openCite, openNode, primaryAction, whenOf } from '../lib/graph-open';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/graph.css';

type Mode = 'map' | 'timeline';
type Span = 'any' | 'week' | 'month' | 'year';
const SPAN_DAYS: Record<Span, number> = { any: 0, week: 7, month: 31, year: 366 };
const DEFAULT_KINDS = ITEM_KINDS.filter((k) => k !== 'folder' && k !== 'source');
const TIMED_LANES: ItemKind[] = ['event', 'meeting', 'mail', 'task', 'note', 'file', 'bookmark'];
const fmt = (n: number) => n.toLocaleString('en-GB');

/** What a search hit inside mail, notes or files is in the graph. */
function refOfCite(h: EverythingHit): ItemRef | null {
  const m = h.cite.match(/^keeper:\/\/(mail|event|task|meeting|contact)\/([^?#]+)/);
  if (!m) return /^https?:/.test(h.cite) ? null : { path: h.cite };
  const id = decodeURIComponent(m[2]);
  return m[1] === 'mail' ? { mail: id } : m[1] === 'event' ? { event: id } : m[1] === 'task' ? { task: id } : m[1] === 'meeting' ? { meeting: id } : { email: id };
}

/** The theme's colours for the canvas (read again when the theme changes). */
function readColours(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of ITEM_KINDS) out[k] = cs.getPropertyValue(`--k-${k}`).trim() || '#888';
  out.text = cs.getPropertyValue('--text').trim() || '#222';
  out.text3 = cs.getPropertyValue('--text-3').trim() || '#777';
  out.line = cs.getPropertyValue('--line-strong').trim() || 'rgba(0,0,0,.15)';
  out.accent = cs.getPropertyValue('--accent').trim() || '#55f';
  out.bg = cs.getPropertyValue('--bg-elev').trim() || '#fff';
  return out;
}

export function Graph() {
  const { route, go, toast } = useStore();
  const arg = route.arg && route.arg !== 'privacy' ? route.arg : undefined;
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [data, setData] = useState<GraphView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('map');
  const [kinds, setKinds] = useState<ItemKind[]>(DEFAULT_KINDS);
  const [span, setSpan] = useState<Span>('any');
  const [showKinds, setShowKinds] = useState(false);
  const [privacy, setPrivacy] = useState(route.arg === 'privacy');
  const [sel, setSel] = useState<KNode | null>(null);
  const [startHidden, setStartHidden] = useState(false);
  const [reload, setReload] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api.agents.graphStatus().then((s) => alive && setStatus(s), (e) => alive && setError(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    let alive = true;
    setError(null);
    const from = SPAN_DAYS[span] ? Date.now() - SPAN_DAYS[span] * 86_400_000 : undefined;
    api.agents.graphView({ focus: arg, depth: arg ? 2 : undefined, kinds, from, max: 1500 }).then((v) => {
      if (!alive) return;
      setData(v);
      if (arg) setSel(v.nodes.find((n) => n.id === v.focus) ?? null);
    }, (e) => alive && setError(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [arg, kinds, span, reload]);

  // "/" finds, Escape lets go of the selection.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'Escape' && !typing && sel && !document.querySelector('.modal')) setSel(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sel]);

  const focusOn = useCallback((id: string) => { setStartHidden(true); go({ name: 'graph', arg: id }); }, [go]);
  const focusNode = arg ? data?.nodes.find((n) => n.id === data.focus) : undefined;
  const empty = status?.on && status.nodes === 0;

  const sub = !status ? 'Reading what Keeper knows…'
    : !status.on ? 'Switched off in Settings → Features.'
    : `${fmt(status.nodes)} things · ${fmt(status.links)} links · On this computer${status.updatedAt ? ` · Updated ${new Date(status.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`;

  return (
    <div className="page kg-page" data-testid="graph-page">
      <PageHead title={focusNode ? focusNode.label : 'Knowledge Graph'} sub={focusNode ? `${KIND_LABEL[focusNode.kind][0]} · Linked to ${fmt(new Set((data?.edges ?? []).flatMap((e) => (e.a === focusNode.id ? [e.b] : e.b === focusNode.id ? [e.a] : []))).size)} things · On this computer` : sub}>
        {arg ? <button className="btn ghost" onClick={() => { setSel(null); go({ name: 'graph' }); }} data-testid="kg-back"><Icon name="chevronLeft" size={14} /> Whole graph</button> : null}
        <button className="btn ghost" onClick={() => setPrivacy(true)} data-testid="kg-privacy-open" title="What the graph may include"><Icon name="shield" size={14} /> What it includes</button>
      </PageHead>

      {empty ? (
        <div className="kg-empty">
          <FirstRun testid="kg-first" kicker="Knowledge graph" title="See how your things connect" mark="connect"
            line="As Keeper reads your notes, files, mail and calendar, the people, projects and events in them link up here, each link with its reason."
            art={<GraphArt />}
            action={<button className="btn primary" onClick={() => go({ name: 'mail' })}><Icon name="mail" size={14} /> Add a mail account</button>}
            more={<button className="btn ghost" onClick={() => go({ name: 'notes' })}><Icon name="note" size={14} /> Open Notes</button>}
            trust={['Built on this computer', 'Nothing sent anywhere', 'Leave out anything']} />
        </div>
      ) : (
        <>
          <div className="kg-bar">
            <SearchBox inputRef={searchRef} onFocus={focusOn} onOpenCite={(c) => openCite(c, go)} />
            <div className="capsule" role="group" aria-label="View">
              <div className="seg">
                <button className={mode === 'map' ? 'on' : ''} aria-pressed={mode === 'map'} onClick={() => setMode('map')} data-testid="kg-mode-map"><Icon name="graph" size={13} /> Map</button>
                <button className={mode === 'timeline' ? 'on' : ''} aria-pressed={mode === 'timeline'} onClick={() => setMode('timeline')} data-testid="kg-mode-timeline"><Icon name="clock" size={13} /> Timeline</button>
              </div>
            </div>
            <div className="capsule" role="group" aria-label="Filters">
              <select className="input" aria-label="Time" value={span} onChange={(e) => setSpan(e.target.value as Span)} data-testid="kg-span">
                <option value="any">Any time</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
                <option value="year">Past year</option>
              </select>
              <button className="btn ghost" aria-expanded={showKinds} onClick={() => setShowKinds(!showKinds)} data-testid="kg-kinds"><Icon name="sliders" size={13} /> {kinds.length === DEFAULT_KINDS.length ? 'All kinds' : `${kinds.length} kinds`}</button>
              {showKinds ? <KindPicker kinds={kinds} counts={status?.counts ?? {}} onChange={setKinds} onClose={() => setShowKinds(false)} /> : null}
            </div>
            {data && Object.keys(data.hidden).length ? <p className="kg-hidden trust-line" data-testid="kg-lod">Showing the {fmt(data.nodes.filter((n) => !n.cluster).length)} best-linked of {fmt(data.total)} · Search to reach the rest</p> : null}
          </div>

          <div className={`kg-main${sel ? '' : ' no-side'}`}>
            <div className="kg-stage">
              {error ? (
                <div className="kg-error" role="alert">
                  <div>
                    <GraphArt small />
                    <h3>The graph could not be read</h3>
                    <p className="muted">{error}</p>
                    <button className="btn primary" onClick={() => setReload((x) => x + 1)}><Icon name="refresh" size={14} /> Try again</button>
                  </div>
                </div>
              ) : data ? (
                <Stage data={data} mode={mode} sel={sel} onSelect={setSel} onFocus={focusOn} />
              ) : <div className="kg-error"><div><div className="spinner" /><p className="muted">Linking your things…</p></div></div>}
              {data && !arg && !sel && !startHidden && data.nodes.length ? <StartCard nodes={data.nodes} onPick={focusOn} onClose={() => setStartHidden(true)} /> : null}
            </div>
            {sel ? <Inspector node={sel} onClose={() => setSel(null)} onSelect={setSel} onFocus={focusOn} toast={toast} /> : null}
          </div>
        </>
      )}
      {privacy && status ? <PrivacySheet status={status} onClose={() => { setPrivacy(false); setReload((x) => x + 1); }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- search (things, and inside mail, notes and files)

type Row = { t: 'node'; n: KNode } | { t: 'hit'; h: EverythingHit };

function SearchBox({ inputRef, onFocus, onOpenCite }: { inputRef: React.RefObject<HTMLInputElement | null>; onFocus: (id: string) => void; onOpenCite: (cite: string) => void }) {
  const [q, setQ] = useState('');
  const [nodes, setNodes] = useState<KNode[]>([]);
  const [hits, setHits] = useState<EverythingHit[]>([]);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setNodes([]); setHits([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      void api.agents.graphFind(t).then((n) => alive && setNodes(n.slice(0, 6)));
      void api.agents.searchEverything(t, { limit: 6 }).then((h) => alive && setHits(h), () => alive && setHits([]));
    }, 140);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);
  const rows: Row[] = [...nodes.map((n) => ({ t: 'node' as const, n })), ...hits.map((h) => ({ t: 'hit' as const, h }))];
  const pick = async (i: number) => {
    const r = rows[i];
    if (!r) return;
    setOpen(false);
    setQ('');
    if (r.t === 'node') return onFocus(r.n.id);
    const ref = refOfCite(r.h);
    const found = ref ? await api.agents.graphRelated(ref, { limit: 1 }).catch(() => null) : null;
    if (found?.node) onFocus(found.node.id);
    else onOpenCite(r.h.cite);
  };
  const shown = open && rows.length > 0;
  return (
    <div className="capsule kg-search">
      <Icon name="search" size={14} className="kg-search-icon" />
      <input ref={inputRef} className="input" placeholder="Search the graph" aria-label="Search the graph" value={q} data-testid="kg-search"
        role="combobox" aria-expanded={shown} aria-autocomplete="list" aria-controls={shown ? 'kg-suggest' : undefined} aria-activedescendant={shown ? `kg-opt-${at}` : undefined}
        onChange={(e) => { setQ(e.target.value); setAt(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(rows.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); void pick(at); }
          else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }} />
      {shown ? (
        <ul className="kg-suggest" id="kg-suggest" role="listbox" aria-label="Matches" data-testid="kg-suggest">
          {rows.map((r, i) => (
            <li key={r.t === 'node' ? r.n.id : r.h.cite} role="presentation">
              {i === 0 && nodes.length ? <div className="xkicker kg-group">In the graph</div> : null}
              {i === nodes.length && hits.length ? <div className="xkicker kg-group">Inside mail, notes and files</div> : null}
              <button id={`kg-opt-${i}`} role="option" aria-selected={i === at} onMouseDown={(e) => e.preventDefault()} onClick={() => void pick(i)} data-testid={r.t === 'node' ? 'kg-opt-node' : 'kg-opt-hit'}>
                {r.t === 'node' ? (
                  <><span className={`kg-ico k-${r.n.kind}`} aria-hidden><Icon name={KIND_ICON[r.n.kind]} size={12} /></span><span className="ellipsis">{r.n.label}</span><span className="kg-sub">{KIND_LABEL[r.n.kind][0]}{r.n.degree ? ` · ${r.n.degree} links` : ''}</span></>
                ) : (
                  <><span className={`kg-ico k-${r.h.kind === 'contact' ? 'person' : r.h.kind}`} aria-hidden><Icon name={r.h.kind === 'contact' ? 'smile' : KIND_ICON[r.h.kind as ItemKind] ?? 'document'} size={12} /></span><span className="ellipsis">{r.h.title}</span><span className="kg-sub">{r.h.why.includes('meaning') ? 'By meaning' : r.h.sub ?? ''}</span></>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function KindPicker({ kinds, counts, onChange, onClose }: { kinds: ItemKind[]; counts: Partial<Record<ItemKind, number>>; onChange: (k: ItemKind[]) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-testid="kg-kinds"]')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', out);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', out); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div className="kg-kinds" ref={box} role="group" aria-label="Kinds shown" data-testid="kg-kind-picker">
      {ITEM_KINDS.map((k) => (
        <label key={k} className={`k-${k}`}>
          <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => onChange(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
          <span className="kg-dot" aria-hidden />{KIND_LABEL[k][1]}{counts[k] ? <span className="muted"> {fmt(counts[k]!)}</span> : null}
        </label>
      ))}
      <div className="kg-kinds-foot">
        <button className="btn sm ghost" onClick={() => onChange(DEFAULT_KINDS)}>Usual</button>
        <button className="btn sm ghost" onClick={() => onChange(['person', 'org'])}>Only people</button>
      </div>
    </div>
  );
}

function StartCard({ nodes, onPick, onClose }: { nodes: KNode[]; onPick: (id: string) => void; onClose: () => void }) {
  const people = nodes.filter((n) => n.kind === 'person' && !n.cluster).sort((a, b) => b.degree - a.degree).slice(0, 5);
  const groups = nodes.filter((n) => (n.kind === 'project' || n.kind === 'org') && !n.cluster).sort((a, b) => b.degree - a.degree).slice(0, 4);
  if (!people.length && !groups.length) return null;
  return (
    <aside className="kg-start" aria-label="Start with" data-testid="kg-start">
      <div className="row"><div className="xkicker grow">Start with</div><button className="btn ghost sm icon" aria-label="Close" title="Close" onClick={onClose}><Icon name="close" size={12} /></button></div>
      <h3>Who and what links most</h3>
      <div className="kg-chips">
        {[...people, ...groups].map((n) => (
          <button key={n.id} className={`kg-chip k-${n.kind}`} onClick={() => onPick(n.id)} data-testid="kg-start-chip"><span className="kg-ico" aria-hidden><Icon name={KIND_ICON[n.kind]} size={11} /></span>{n.label}</button>
        ))}
      </div>
      <p className="trust-line">Press / to search · Click to see links</p>
    </aside>
  );
}

// ---------------------------------------------------------------- the canvas

function Stage({ data, mode, sel, onSelect, onFocus }: { data: GraphView; mode: Mode; sel: KNode | null; onSelect: (n: KNode | null) => void; onFocus: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const moved = useRef(false);
  const selRef = useRef(-1);
  const hover = useRef(-1);
  const g = useMemo(() => {
    const index = new Map(data.nodes.map((n, i) => [n.id, i]));
    const edges = data.edges.filter((e) => index.has(e.a) && index.has(e.b)).map((e) => ({ a: index.get(e.a)!, b: index.get(e.b)!, w: e.w, e }));
    return { nodes: data.nodes, edges, index };
  }, [data]);
  selRef.current = sel ? g.index.get(sel.id) ?? -1 : -1;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const n = g.nodes.length;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Positions: a force layout for the map; lanes along time for the timeline.
    let L: ForceLayout | null = null;
    let X: Float64Array = new Float64Array(n), Y: Float64Array = new Float64Array(n);
    const lanes: { kind: ItemKind | 'other'; y: number }[] = [];
    let ticks: { x: number; label: string }[] = [];
    if (mode === 'map') {
      // Small neighbourhoods get room for their labels; big maps stay compact.
      const small = n < 150;
      L = new ForceLayout(n, g.edges, { seed: 11, springLength: small ? 140 : 50, repulsion: small ? 1400 : 120, gravity: small ? 0.006 : 0.01 });
      // Reduced motion: settle first, then show it still.
      if (reduce) L.run(400);
      X = L.x; Y = L.y;
    } else {
      const timed = g.nodes.map((x) => x.time ?? 0).filter((t) => t > 0);
      const t0 = timed.length ? Math.min(...timed) : Date.now(), t1 = timed.length ? Math.max(...timed) : Date.now();
      // Laid out in screen units for the stage's size, so lanes keep their room.
      const W = Math.max(400, cv.clientWidth - 380), Hh = Math.max(280, cv.clientHeight - 130), span = Math.max(1, t1 - t0);
      const present = TIMED_LANES.filter((k) => g.nodes.some((x) => x.kind === k && x.time));
      const gap = Hh / (present.length + 1);
      lanes.push({ kind: 'other', y: -Hh / 2 + gap * 0.5 });
      present.forEach((k, i) => lanes.push({ kind: k, y: -Hh / 2 + gap * (i + 1.5) }));
      const untimed = g.nodes.map((x, i) => (!x.time || !present.includes(x.kind) ? i : -1)).filter((i) => i >= 0);
      untimed.forEach((i, j) => { X[i] = -W / 2 + ((j + 0.5) / untimed.length) * W; Y[i] = lanes[0].y + (j % 2 ? 0.18 : -0.18) * gap; });
      g.nodes.forEach((x, i) => {
        if (!x.time || !present.includes(x.kind)) return;
        X[i] = -W / 2 + ((x.time - t0) / span) * W;
        Y[i] = lanes.find((l) => l.kind === x.kind)!.y + ((((i * 37) % 5) - 2) / 2) * gap * 0.22;
      });
      const days = span / 86_400_000;
      const step = days > 400 ? 'year' : days > 60 ? 'month' : 'day';
      const d = new Date(t0);
      d.setHours(0, 0, 0, 0);
      if (step !== 'day') d.setDate(1);
      if (step === 'year') d.setMonth(0);
      for (let k = 0; k < 400 && d.getTime() <= t1; k++) {
        if (d.getTime() >= t0) ticks.push({ x: -W / 2 + ((d.getTime() - t0) / span) * W, label: d.toLocaleDateString('en-GB', step === 'year' ? { year: 'numeric' } : step === 'month' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }) });
        if (step === 'day') d.setDate(d.getDate() + Math.max(1, Math.ceil(days / 12)));
        else if (step === 'month') d.setMonth(d.getMonth() + Math.max(1, Math.ceil(days / 30 / 12)));
        else d.setFullYear(d.getFullYear() + 1);
      }
      if (ticks.length > 14) ticks = ticks.filter((_, i) => i % Math.ceil(ticks.length / 14) === 0);
    }
    moved.current = false;
    const fit = () => {
      if (moved.current || !n) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
      if (mode === 'timeline') { view.current = { x: 20, y: 0, k: 1 }; return; }
      const w = cv.clientWidth - 220, h = cv.clientHeight - 140;
      view.current = { x: -(x0 + x1) / 2, y: -(y0 + y1) / 2, k: Math.max(0.05, Math.min(n < 150 ? 2.4 : 1.6, w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0))) };
    };
    let pal = readColours();
    let theme = document.documentElement.dataset.theme;
    let settled = mode !== 'map' || reduce;
    let raf = 0;
    const draw = () => {
      if (!settled && L) settled = L.run(10);
      fit();
      if (document.documentElement.dataset.theme !== theme) { theme = document.documentElement.dataset.theme; pal = readColours(); }
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { x: ox, y: oy, k } = view.current;
      const sx = (i: number) => w / 2 + (X[i] + ox) * k;
      const sy = (i: number) => h / 2 + (Y[i] + oy) * k;
      const s = selRef.current;
      const near = new Set<number>();
      if (s >= 0) for (const e of g.edges) { if (e.a === s) near.add(e.b); else if (e.b === s) near.add(e.a); }
      // Timeline: lanes and dates first.
      if (mode === 'timeline') {
        for (const l of lanes) {
          const y = h / 2 + (l.y + oy) * k;
          ctx.strokeStyle = pal.line; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.fillStyle = pal.text3; ctx.font = '600 11px system-ui, sans-serif';
          ctx.fillText(l.kind === 'other' ? 'People and projects' : KIND_LABEL[l.kind][1], 16, y - 8);
        }
        ctx.font = '400 11px system-ui, sans-serif';
        for (const t of ticks) {
          const x = w / 2 + (t.x + ox) * k;
          if (x < 150 || x > w - 30) continue;
          ctx.fillStyle = pal.text3; ctx.fillText(t.label, x - 14, 22);
          ctx.strokeStyle = pal.line; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, h - 20); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
      // Links: quiet; the selected node's strong, with their reason when there is room.
      for (const e of g.edges) {
        const on = s >= 0 && (e.a === s || e.b === s);
        if (mode === 'timeline' && !on && !(hover.current >= 0 && (e.a === hover.current || e.b === hover.current))) continue;
        const x1 = sx(e.a), y1 = sy(e.a), x2 = sx(e.b), y2 = sy(e.b);
        if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
        ctx.strokeStyle = on ? pal.accent : pal.line;
        ctx.globalAlpha = s >= 0 && !on ? 0.2 : on ? 0.9 : 0.6;
        ctx.lineWidth = on ? 1.6 : Math.min(2, 0.6 + e.w * 0.25);
        ctx.beginPath();
        if (mode === 'timeline') { ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - 30, x2, y2); }
        else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (s >= 0 && mode === 'map' && near.size <= 16 && k > 0.8) {
        ctx.font = '500 10px system-ui, sans-serif';
        for (const e of g.edges) {
          if (e.a !== s && e.b !== s) continue;
          const mx = (sx(e.a) + sx(e.b)) / 2, my = (sy(e.a) + sy(e.b)) / 2;
          const t = REASON_LABEL[e.e.reason];
          const tw = ctx.measureText(t).width;
          ctx.fillStyle = pal.bg; ctx.globalAlpha = 0.9; ctx.fillRect(mx - tw / 2 - 4, my - 8, tw + 8, 14); ctx.globalAlpha = 1;
          ctx.fillStyle = pal.text3; ctx.fillText(t, mx - tw / 2, my + 3);
        }
      }
      const labels = k > 0.85 || n < 120;
      for (let i = 0; i < n; i++) {
        const x = sx(i), y = sy(i);
        if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
        const nd = g.nodes[i];
        const big = nd.kind === 'person' || nd.kind === 'org' || nd.kind === 'project';
        const base = nd.cluster ? 10 + Math.log10(nd.cluster + 1) * 6 : big ? 5 + Math.sqrt(nd.degree) * 1.4 : 3 + Math.sqrt(nd.degree) * 1.1;
        const r = Math.max(3, Math.min(nd.cluster ? 28 : 16, base)) * Math.min(1.5, Math.max(0.6, k));
        const dim = s >= 0 && i !== s && !near.has(i);
        ctx.fillStyle = pal[nd.kind] ?? '#888';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (nd.cluster) {
          ctx.globalAlpha = dim ? 0.08 : 0.2; ctx.fill();
          ctx.globalAlpha = dim ? 0.16 : 0.9; ctx.strokeStyle = pal[nd.kind]; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        } else { ctx.globalAlpha = dim ? 0.16 : 1; ctx.fill(); }
        if (i === s || i === hover.current) { ctx.globalAlpha = 1; ctx.strokeStyle = pal.text; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
        const showLabel = nd.cluster || i === s || i === hover.current || near.has(i) || (labels && (nd.degree > 1 || n < 60)) || (big && nd.degree > 6);
        if (showLabel && !dim) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.text;
          ctx.font = `${big || nd.cluster ? 600 : 400} 11.5px system-ui, sans-serif`;
          ctx.fillText(nd.label.length > 34 ? nd.label.slice(0, 33) + '…' : nd.label, x + r + 4, y + 4);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const at = (ev: MouseEvent) => {
      const rect = cv.getBoundingClientRect();
      const { x: ox, y: oy, k } = view.current;
      const px = (ev.clientX - rect.left - rect.width / 2) / k - ox, py = (ev.clientY - rect.top - rect.height / 2) / k - oy;
      let best = -1, bd = (14 / k) ** 2;
      for (let i = 0; i < n; i++) { const d = (X[i] - px) ** 2 + (Y[i] - py) ** 2; if (d < bd) { bd = d; best = i; } }
      return { best, px, py };
    };
    let drag: { node: number; pick: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
    const down = (ev: MouseEvent) => {
      const { best } = at(ev);
      drag = { node: mode === 'map' ? best : -1, pick: best, sx: ev.clientX, sy: ev.clientY, ox: view.current.x, oy: view.current.y, moved: false };
      if (L && best >= 0) L.pinned.add(best);
    };
    const move = (ev: MouseEvent) => {
      if (!drag) {
        hover.current = at(ev).best;
        cv.style.cursor = hover.current >= 0 ? 'pointer' : 'grab';
        cv.title = hover.current >= 0 ? `${g.nodes[hover.current].label} · ${KIND_LABEL[g.nodes[hover.current].kind][0]}` : '';
        return;
      }
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; moved.current = true; }
      if (drag.node >= 0 && L) { const { px, py } = at(ev); L.x[drag.node] = px; L.y[drag.node] = py; L.alpha = Math.max(L.alpha, 0.3); settled = reduce; }
      else { view.current.x = drag.ox + dx / view.current.k; view.current.y = drag.oy + dy / view.current.k; }
    };
    const up = () => {
      if (drag && !drag.moved) {
        const nd = drag.pick >= 0 ? g.nodes[drag.pick] : null;
        onSelect(nd && !nd.cluster ? nd : null);
      }
      if (L && drag && drag.node >= 0 && !drag.moved) L.pinned.delete(drag.node);
      drag = null;
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      moved.current = true;
      view.current.k = Math.max(0.05, Math.min(6, view.current.k * Math.exp(-ev.deltaY * 0.0015)));
    };
    const dbl = (ev: MouseEvent) => {
      const { best } = at(ev);
      const nd = best >= 0 ? g.nodes[best] : null;
      if (nd && !nd.cluster) onFocus(nd.id);
    };
    // Keyboard: arrows step through things by how linked they are, Enter focuses one, + and − zoom, 0 fits.
    const order = [...g.nodes.keys()].filter((i) => !g.nodes[i].cluster).sort((a, b) => g.nodes[b].degree - g.nodes[a].degree);
    const key = (ev: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(ev.key)) {
        ev.preventDefault();
        const cur = order.indexOf(selRef.current);
        const fwd = ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
        const next = order[cur < 0 ? 0 : (cur + (fwd ? 1 : order.length - 1)) % order.length];
        if (next !== undefined) onSelect(g.nodes[next]);
      } else if (ev.key === 'Enter' && selRef.current >= 0) onFocus(g.nodes[selRef.current].id);
      else if (ev.key === '+' || ev.key === '=') { moved.current = true; view.current.k = Math.min(6, view.current.k * 1.25); }
      else if (ev.key === '-') { moved.current = true; view.current.k = Math.max(0.05, view.current.k / 1.25); }
      else if (ev.key === '0') moved.current = false;
    };
    cv.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('dblclick', dbl);
    cv.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('mousedown', down);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('dblclick', dbl);
      cv.removeEventListener('keydown', key);
    };
  }, [g, mode, onSelect, onFocus]);

  const kindsShown = [...new Set(g.nodes.map((n) => n.kind))];
  const zoom = (f: number) => { moved.current = true; view.current.k = Math.max(0.05, Math.min(6, view.current.k * f)); };
  return (
    <>
      <canvas ref={canvas} className="kg-canvas" tabIndex={0} role="img" data-testid="kg-canvas"
        aria-label={`${mode === 'map' ? 'Map' : 'Timeline'} of ${g.nodes.length} things and ${g.edges.length} links. Arrow keys step through them, Enter focuses one.`} />
      {mode === 'map' ? <div className="kg-legend" aria-hidden>{kindsShown.slice(0, 10).map((k) => <span key={k} className={`k-${k}`}><span className="kg-dot" />{KIND_LABEL[k][1]}</span>)}</div> : null}
      <div className="capsule kg-zoom" role="group" aria-label="Zoom">
        <button className="btn ghost sm icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1.25)}><Icon name="plus" size={12} /></button>
        <button className="btn ghost sm icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom(0.8)}><Icon name="minus" size={12} /></button>
        <button className="btn ghost sm icon" aria-label="Fit to view" title="Fit to view (0)" onClick={() => { moved.current = false; }}><Icon name="grid" size={12} /></button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the inspector

function Inspector({ node, onClose, onSelect, onFocus, toast }: { node: KNode; onClose: () => void; onSelect: (n: KNode) => void; onFocus: (id: string) => void; toast: (t: string) => void }) {
  const { go } = useStore();
  const [rel, setRel] = useState<RelatedItem[] | null>(null);
  const [other, setOther] = useState('');
  const [otherHits, setOtherHits] = useState<KNode[]>([]);
  const [why, setWhy] = useState<Explanation | null | 'none'>(null);
  useEffect(() => {
    let alive = true;
    setRel(null); setWhy(null); setOther('');
    void api.agents.graphRelated({ id: node.id }, { limit: 30 }).then((r) => alive && setRel(r.items));
    return () => { alive = false; };
  }, [node.id]);
  useEffect(() => {
    if (!other.trim()) { setOtherHits([]); return; }
    let alive = true;
    const t = setTimeout(() => void api.agents.graphFind(other).then((n) => alive && setOtherHits(n.filter((x) => x.id !== node.id).slice(0, 5))), 120);
    return () => { alive = false; clearTimeout(t); };
  }, [other, node.id]);
  const prim = primaryAction(node);
  const explainWith = async (b: KNode) => {
    setOther(''); setOtherHits([]);
    const x = await api.agents.graphExplain(node.id, b.id);
    setWhy(x ?? 'none');
  };
  const groups = useMemo(() => {
    const m = new Map<string, RelatedItem[]>();
    for (const r of rel ?? []) { const k = r.via ? 'Through others' : REASON_LABEL[r.reason]; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [rel]);
  return (
    <aside className="kg-side" aria-label={`${KIND_LABEL[node.kind][0]}: ${node.label}`} data-testid="kg-side">
      <div className="kg-side-head">
        <span className={`kg-ico k-${node.kind}`} aria-hidden><Icon name={KIND_ICON[node.kind]} size={18} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="xkicker">{KIND_LABEL[node.kind][0]}{node.count && node.count > 1 ? ` · ${node.count} messages` : ''}</div>
          <h2 className="kg-side-title" data-testid="kg-side-title">{node.label}</h2>
          <p className="kg-side-sub">{[node.emails?.slice(0, 2).join(', ') || node.sub, whenOf(node), node.aliases?.length ? `Also ${node.aliases.slice(0, 2).join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <button className="btn ghost sm icon" aria-label="Close" title="Close (Esc)" onClick={onClose}><Icon name="close" size={12} /></button>
      </div>
      <div className="kg-actions">
        {prim ? <button className="btn primary sm" onClick={() => openNode(node, go)} data-testid="kg-open"><Icon name={prim.icon} size={13} /> {prim.label}</button> : null}
        <button className="btn sm ghost" onClick={() => onFocus(node.id)} data-testid="kg-focus"><Icon name="graph" size={13} /> Focus</button>
        {node.path ? <button className="btn sm ghost" onClick={() => void api.files.reveal(node.path!)}><Icon name="reveal" size={13} /> Show in folder</button> : null}
        <button className="btn sm ghost" data-testid="kg-add-note" onClick={() => void api.agents.graphAddToNote(node.id).then((r) => toast(r ? 'Added to today’s note' : 'Notes is switched off'))}><Icon name="note" size={13} /> Add to note</button>
      </div>

      <section className="insp-sec" aria-label="Links">
        <h3 className="insp-title">Linked {rel ? <span className="muted">· {rel.filter((r) => !r.via).length}</span> : null}</h3>
        {!rel ? <p className="muted small">Looking…</p> : !rel.length ? <p className="muted small">Nothing linked yet.</p> : groups.map(([name, list]) => (
          <div key={name}>
            <div className="xkicker kg-group">{name}</div>
            <ul className="kg-links">
              {list.slice(0, 8).map((r) => (
                <li key={r.node.id}>
                  <button className="kg-link" onClick={() => onSelect(r.node)} title={r.why.join('\n')} data-testid="kg-link">
                    <span className={`kg-ico k-${r.node.kind}`} aria-hidden><Icon name={KIND_ICON[r.node.kind]} size={12} /></span>
                    <span className="kg-link-text">
                      <span className="kg-link-name">{r.node.label}</span>
                      <span className="kg-link-why">{r.via ? `Through ${r.via.label} · ` : ''}{r.why[0]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="insp-sec" aria-label="Explain this connection">
        <h3 className="insp-title">Explain a connection</h3>
        <div className="kg-explain-pick">
          <input className="input" placeholder="With… a person, file or event" aria-label="Explain the connection with" value={other} onChange={(e) => setOther(e.target.value)} data-testid="kg-explain-input"
            onKeyDown={(e) => { if (e.key === 'Enter' && otherHits[0]) void explainWith(otherHits[0]); }} />
          {otherHits.length ? (
            <ul className="kg-suggest" role="listbox" aria-label="Pick one">
              {otherHits.map((n) => <li key={n.id} role="presentation"><button role="option" aria-selected={false} onClick={() => void explainWith(n)} data-testid="kg-explain-opt"><span className={`kg-ico k-${n.kind}`} aria-hidden><Icon name={KIND_ICON[n.kind]} size={12} /></span><span className="ellipsis">{n.label}</span><span className="kg-sub">{KIND_LABEL[n.kind][0]}</span></button></li>)}
            </ul>
          ) : null}
        </div>
        {why === 'none' ? <p className="muted small">No chain of four links or fewer joins them.</p> : why ? (
          <div className="kg-explain" data-testid="kg-explain">
            <ol>
              {why.steps.map((s, i) => (
                <li key={s.node.id + i}>
                  <span className={`kg-ico k-${s.node.kind}`} aria-hidden><Icon name={KIND_ICON[s.node.kind]} size={12} /></span>
                  <span>
                    {s.reason ? <span className="kg-step-why">{REASON_LABEL[s.reason]} — {s.why?.[0]}<br /></span> : null}
                    <b>{s.node.label}</b>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : <p className="muted small">Pick something else to see how the two are joined.</p>}
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------- what the graph includes

type PartKey = 'mail' | 'calendar' | 'tasks' | 'contacts' | 'meetings' | 'places' | 'reader';

function PrivacySheet({ status, onClose }: { status: GraphStatus; onClose: () => void }) {
  const { updateSettings, settings } = useStore();
  const p = settings?.graph ?? status.privacy;
  const set = (patch: Partial<typeof p>) => void updateSettings({ graph: { ...p, ...patch } });
  const parts: { key: PartKey; label: string; on: boolean }[] = [
    { key: 'mail', label: 'Mail', on: status.parts.mail },
    { key: 'calendar', label: 'Calendar events', on: status.parts.calendars },
    { key: 'tasks', label: 'Tasks', on: status.parts.calendars },
    { key: 'contacts', label: 'Contacts', on: status.parts.mail || status.parts.calendars },
    { key: 'meetings', label: 'Meetings', on: status.parts.meetings },
    { key: 'places', label: 'Places', on: status.parts.tracks },
    { key: 'reader', label: 'Saved pages', on: status.parts.reader },
  ];
  const addFolder = async () => {
    const d = await api.settings.pickFolder();
    if (d) set({ leaveOutFolders: [...new Set([...p.leaveOutFolders, d])] });
  };
  const accountLabel = (id: string) => status.accounts.find((a) => a.id === id)?.label ?? id;
  return (
    <Modal title="What the graph includes" onClose={onClose} sheet testId="kg-privacy">
      <div className="kg-priv">
        <p className="trust-line">Built on this computer · Nothing sent anywhere · Search by meaning follows the same choices</p>
        <section className="insp-sec">
          <h3 className="insp-title">Parts</h3>
          <div className="kg-priv-grid">
            {parts.map((x) => (
              <div key={x.key} className="kg-priv-row" data-testid={`kg-part-${x.key}`}>
                <span className={x.on ? '' : 'muted'}>{x.label}{x.on ? '' : ' (off)'}</span>
                <Toggle on={x.on && p[x.key]} disabled={!x.on} onChange={(v) => set({ [x.key]: v })} label={`Include ${x.label.toLowerCase()}`} />
              </div>
            ))}
          </div>
          <p className="muted small">Files and notes follow the folders Keeper reads.</p>
        </section>
        {status.accounts.length ? (
          <section className="insp-sec">
            <h3 className="insp-title">Mail accounts</h3>
            <ul className="kg-priv-list">
              {status.accounts.map((a) => (
                <li key={a.id} className="kg-priv-row">
                  <span>{a.label}</span>
                  <Toggle on={!p.leaveOutAccounts.includes(a.id)} onChange={(v) => set({ leaveOutAccounts: v ? p.leaveOutAccounts.filter((x) => x !== a.id) : [...p.leaveOutAccounts, a.id] })} label={`Include ${a.label}`} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="insp-sec">
          <h3 className="insp-title">Left out</h3>
          {p.leaveOutFolders.length ? (
            <ul className="kg-priv-list" data-testid="kg-left-out">
              {p.leaveOutFolders.map((f) => {
                const mf = status.folders.find((x) => `${x.account}:${x.path}` === f);
                return <li key={f}><Icon name={mf ? 'mail' : 'folder'} size={13} /><span className="grow ellipsis" title={f}>{mf ? `${accountLabel(mf.account)} · ${mf.name}` : f}</span><button className="btn sm ghost" onClick={() => set({ leaveOutFolders: p.leaveOutFolders.filter((x) => x !== f) })}>Include again</button></li>;
              })}
            </ul>
          ) : <p className="muted small">Nothing is left out.</p>}
          <div className="btn-row">
            <button className="btn sm" onClick={() => void addFolder()}><Icon name="folder" size={13} /> Leave out a folder</button>
            {status.folders.length ? (
              <select className="input" aria-label="Leave out a mail folder" value="" onChange={(e) => { if (e.target.value) set({ leaveOutFolders: [...new Set([...p.leaveOutFolders, e.target.value])] }); }}>
                <option value="">Leave out a mail folder…</option>
                {status.folders.map((f) => <option key={`${f.account}:${f.path}`} value={`${f.account}:${f.path}`}>{accountLabel(f.account)} · {f.name}</option>)}
              </select>
            ) : null}
          </div>
        </section>
        <section className="insp-sec">
          <h3 className="insp-title">Search by meaning</h3>
          <p className="small muted" data-testid="kg-meaning">{status.meaning.on ? `${fmt(status.meaning.embedded)} of ${fmt(status.meaning.items)} emails, events, tasks, contacts and notes understood${status.meaning.pending ? ' · the rest when you are not busy' : ''}.` : 'Off. Turn on Search by meaning in Settings → AI to find mail and events by what they are about.'}</p>
        </section>
      </div>
    </Modal>
  );
}

/** People, an email, an event and a note, linked up. */
function GraphArt({ small }: { small?: boolean }) {
  return (
    <svg viewBox="0 0 240 200" className={`art${small ? ' art-small' : ''}`} aria-hidden>
      <circle cx="120" cy="100" r="86" className="art-halo" />
      <path d="M120 96L64 58M120 96L182 64M120 96L70 148M120 96L176 146M64 58L182 64" className="art-edge" />
      <circle cx="120" cy="96" r="20" className="art-node art-shadow" />
      <circle cx="120" cy="96" r="10" className="art-k1" />
      <rect x="44" y="42" width="40" height="32" rx="8" className="art-node art-shadow" />
      <rect x="52" y="52" width="24" height="12" rx="3" className="art-k2" />
      <rect x="160" y="46" width="44" height="36" rx="8" className="art-node art-shadow" />
      <rect x="168" y="54" width="28" height="6" rx="3" className="art-k3" />
      <rect x="168" y="66" width="18" height="6" rx="3" className="art-line" />
      <rect x="50" y="130" width="40" height="36" rx="8" className="art-node art-shadow" />
      <rect x="58" y="140" width="24" height="5" rx="2.5" className="art-k4" />
      <rect x="58" y="150" width="18" height="5" rx="2.5" className="art-line" />
      <circle cx="176" cy="146" r="14" className="art-node art-shadow" />
      <circle cx="176" cy="146" r="6" className="art-k1" />
    </svg>
  );
}
