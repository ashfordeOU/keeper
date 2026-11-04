// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A note as a mind map: its title in the middle, headings and list items as
// branches. Add (Tab: a branch under, Enter: one beside), rename (F2, double
// click, or just type), drag onto a branch to move it there (or above or
// below it), fold with Space; every change is written into the Markdown.
// Saves as PNG or SVG.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { addChild, addSibling, findNode, layoutMindmap, moveNode, neighbour, parseMindmap, removeNode, renameNode, serializeMindmap, type MindDoc, type MindLayout, type MindNode, type Placed } from '../../core/notes/mindmap';

type Mode = 'balanced' | 'right';
const PREF = 'notes.mindmap.mode';

/** A branch's place in the map by its words (so folds survive the note being read again). */
function keyOf(doc: MindDoc, id: string): string | null {
  const walk = (n: MindNode, path: string): string | null => {
    const p = `${path}/${n.text}`;
    if (n.id === id) return p;
    for (const c of n.children) { const r = walk(c, p); if (r) return r; }
    return null;
  };
  return walk(doc.root, '');
}
function idOf(doc: MindDoc, key: string): string | null {
  const walk = (n: MindNode, path: string): string | null => {
    const p = `${path}/${n.text}`;
    if (p === key) return n.id;
    if (!key.startsWith(`${p}/`)) return null;
    for (const c of n.children) { const r = walk(c, p); if (r) return r; }
    return null;
  };
  return walk(doc.root, '');
}

export function MindMap({ path, text, onChange, toast }: { path: string; text: string; onChange: (t: string) => void; toast: (t: string) => void }) {
  const title = path.split('/').pop()!.replace(/\.md$/, '');
  const [doc, setDoc] = useState<MindDoc>(() => parseMindmap(text, title));
  const wrote = useRef(text);
  const [sel, setSel] = useState<string>(() => doc.root.id);
  const [editing, setEditing] = useState<{ id: string; draft: string; fresh: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setModeRaw] = useState<Mode>(() => { try { return (localStorage.getItem(PREF) as Mode) || 'balanced'; } catch { return 'balanced'; } });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target?: { id: string; where: 'before' | 'after' | 'child' } } | null>(null);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  // Changes made elsewhere (the editor, another app) are read again; folds and the selection are kept by their words.
  useEffect(() => {
    if (text === wrote.current) return;
    wrote.current = text;
    setDoc((old) => {
      const next = parseMindmap(text, title);
      setCollapsed((c) => new Set([...c].map((id) => keyOf(old, id)).map((k) => (k ? idOf(next, k) : null)).filter((x): x is string => !!x)));
      setSel((s) => { const k = keyOf(old, s); return (k && idOf(next, k)) || next.root.id; });
      return next;
    });
  }, [text, title]);

  const measure = useMemo(() => {
    const g = document.createElement('canvas').getContext('2d');
    const font = getComputedStyle(document.body).fontFamily;
    const cache = new Map<string, number>();
    return (t: string, size: number, bold: boolean) => {
      const k = `${size}${bold ? 'b' : ''}${t}`;
      let w = cache.get(k);
      if (w === undefined && g) { g.font = `${bold ? 650 : 400} ${size}px ${font}`; w = g.measureText(t).width; cache.set(k, w); }
      return w ?? t.length * size * 0.6;
    };
  }, []);
  const layout: MindLayout = useMemo(() => layoutMindmap(doc, { mode, collapsed, measure }), [doc, mode, collapsed, measure]);
  const byId = useMemo(() => new Map(layout.nodes.map((p) => [p.id, p])), [layout]);

  const commit = useCallback((d: MindDoc) => {
    const t = serializeMindmap(d);
    if (t === wrote.current) { setDoc({ ...d }); return; }
    undo.current.push(wrote.current);
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    wrote.current = t;
    setDoc({ ...d });
    onChange(t);
  }, [onChange]);

  const restore = (from: string[], to: string[]) => {
    const t = from.pop();
    if (t === undefined) return;
    to.push(wrote.current);
    wrote.current = t;
    const next = parseMindmap(t, title);
    setDoc(next);
    setSel((s) => { const k = keyOf(doc, s); return (k && idOf(next, k)) || next.root.id; });
    onChange(t);
  };

  // Fit the whole map in view the first time, and on request.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    // The whole map when it fits at a readable size; otherwise readable, with the middle in view.
    const whole = Math.min(1.1, (w - 96) / Math.max(1, layout.width), (h - 140) / Math.max(1, layout.height));
    const k = Math.max(0.6, whole);
    const cy = whole >= 0.6 ? layout.minY + layout.height / 2 : 0;
    const cx = (w - 96) / Math.max(1, layout.width) >= k ? layout.minX + layout.width / 2 : 0;
    setView({ k, x: w / 2 - cx * k, y: (h - 48) / 2 - cy * k });
  }, [layout]);
  useLayoutEffect(() => { if (!fitted.current && box.current?.clientWidth) { fitted.current = true; fit(); } }, [fit]);
  // Until the person moves the map themselves, it stays fitted when the panel changes size.
  const moved = useRef(false);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (!moved.current && el.clientWidth) fitRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the selected branch in view.
  useEffect(() => {
    const p = byId.get(sel);
    const el = box.current;
    if (!p || !el) return;
    const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
    const pad = 40;
    let dx = 0, dy = 0;
    if (sx < pad) dx = pad - sx; else if (sx + p.w * view.k > el.clientWidth - pad) dx = el.clientWidth - pad - (sx + p.w * view.k);
    if (sy < pad) dy = pad - sy; else if (sy + p.h * view.k > el.clientHeight - 80) dy = el.clientHeight - 80 - (sy + p.h * view.k);
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = (m: Mode) => { setModeRaw(m); try { localStorage.setItem(PREF, m); } catch { /* ignore */ } fitted.current = false; };
  const zoom = (f: number, cx?: number, cy?: number) => { moved.current = true; setView((v) => {
    const el = box.current;
    const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
    const k = Math.max(0.15, Math.min(3, v.k * f));
    return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
  }); };

  const startEdit = (id: string, draft?: string, fresh = false) => { const f = findNode(doc, id); if (f) setEditing({ id, draft: draft ?? f.node.text, fresh }); };
  const finishEdit = (keep: boolean, then?: 'child' | 'sibling') => {
    if (!editing) return;
    const d = doc;
    if (keep && editing.draft.trim()) renameNode(d, editing.id, editing.draft);
    else if (!keep && editing.fresh) { const next = removeNode(d, editing.id); if (next) setSel(next); }
    setEditing(null);
    let nid: string | null = null;
    if (then === 'child') nid = addChild(d, editing.id);
    if (then === 'sibling') nid = addSibling(d, editing.id);
    commit(d);
    if (nid) { setSel(nid); setEditing({ id: nid, draft: '', fresh: true }); } else box.current?.focus();
  };
  const add = (how: 'child' | 'sibling') => {
    const d = doc;
    const nid = how === 'child' ? addChild(d, sel) : addSibling(d, sel);
    if (!nid) return;
    if (how === 'child') setCollapsed((c) => { const x = new Set(c); x.delete(sel); return x; });
    commit(d);
    setSel(nid);
    setEditing({ id: nid, draft: '', fresh: true });
  };
  const toggle = (id: string) => setCollapsed((c) => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) restore(redo.current, undo.current); else restore(undo.current, redo.current); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); restore(redo.current, undo.current); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoom(1.2); return; }
    if (mod && k === '-') { e.preventDefault(); zoom(1 / 1.2); return; }
    if (mod && k === '0') { e.preventDefault(); fit(); return; }
    if (mod || e.altKey && !['ArrowUp', 'ArrowDown'].includes(k)) return;
    if (k === 'Tab') { e.preventDefault(); add('child'); }
    else if (k === 'Enter') { e.preventDefault(); add('sibling'); }
    else if (k === 'F2') { e.preventDefault(); startEdit(sel); }
    else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const d = doc;
      const next = removeNode(d, sel);
      if (next) { commit(d); setSel(next); toast('Branch removed. Ctrl+Z brings it back.'); }
    } else if (k === ' ') { e.preventDefault(); if (findNode(doc, sel)?.node.children.length) toggle(sel); }
    else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const f = findNode(doc, sel);
      if (!f?.parent) return;
      const to = f.index + (k === 'ArrowDown' ? 2 : -1);
      if (to < 0 || to > f.parent.children.length) return;
      const d = doc;
      if (moveNode(d, sel, f.parent.id, to)) commit(d);
    } else if (k.startsWith('Arrow')) {
      e.preventDefault();
      const n = neighbour(layout, doc, sel, k as 'ArrowLeft');
      if (n) setSel(n);
    } else if (k === 'Home') { e.preventDefault(); setSel(doc.root.id); }
    else if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel, k); }
  };

  // Pan by dragging the background; drag a branch to move it.
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const toWorld = (cx: number, cy: number) => { const r = box.current!.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; };
  const hitTest = (wx: number, wy: number, except: string): { id: string; where: 'before' | 'after' | 'child' } | undefined => {
    const p = layout.nodes.find((q) => q.id !== except && wx >= q.x - 6 && wx <= q.x + q.w + 6 && wy >= q.y - 4 && wy <= q.y + q.h + 4);
    if (!p) return undefined;
    const f = findNode(doc, except);
    if (!f || p.id === except || (f.node.children.length && findNode({ ...doc, root: f.node }, p.id))) return undefined;
    const rel = (wy - p.y) / p.h;
    return { id: p.id, where: p.depth > 0 && rel < 0.28 ? 'before' : p.depth > 0 && rel > 0.72 ? 'after' : 'child' };
  };
  const onNodeDown = (e: React.PointerEvent, p: Placed) => {
    if (e.button !== 0 || editing?.id === p.id) return;
    e.stopPropagation();
    setSel(p.id);
    box.current?.focus({ preventScroll: true });
    if (p.depth === 0) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      const w = toWorld(ev.clientX, ev.clientY);
      setDrag({ id: p.id, x: w.x, y: w.y, target: hitTest(w.x, w.y, p.id) });
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (!started) return;
      const w = toWorld(ev.clientX, ev.clientY);
      const t = hitTest(w.x, w.y, p.id);
      setDrag(null);
      if (!t) return;
      const d = doc;
      let ok = false;
      if (t.where === 'child') ok = moveNode(d, p.id, t.id);
      else { const f = findNode(d, t.id); if (f?.parent) ok = moveNode(d, p.id, f.parent.id, f.index + (t.where === 'after' ? 1 : 0)); }
      if (ok) { commit(d); toast('Moved. Ctrl+Z puts it back.'); }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const save = async (kind: 'png' | 'svg') => {
    const svg = mapSvg(layout, collapsed, box.current!);
    const name = `${title}.${kind}`;
    let data: Uint8Array;
    if (kind === 'svg') data = new TextEncoder().encode(svg);
    else {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width * 2; c.height = img.height * 2;
      const g = c.getContext('2d')!;
      g.scale(2, 2);
      g.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      data = new Uint8Array(await blob!.arrayBuffer());
    }
    const to = await api.notes.saveImage(name, data);
    if (to) toast(`Saved ${to.split(/[\\/]/).pop()}`);
  };

  const sp = byId.get(sel);
  const count = layout.nodes.length + layout.nodes.reduce((s, p) => s + p.hidden, 0);
  return (
    <div className="mm-root" data-testid="mind-map">
      <div
        ref={box}
        className={`mm-board ${drag ? 'is-dragging' : ''}`}
        tabIndex={0}
        role="tree"
        aria-label={`Mind map of ${title}. Tab adds a branch under, Enter one beside, F2 renames, Space folds.`}
        aria-activedescendant={sp ? `mm-${sp.id}` : undefined}
        onKeyDown={onKey}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) { const r = box.current!.getBoundingClientRect(); zoom(Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top); }
          else { moved.current = true; setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })); }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => { const p = pan.current; if (p) moved.current = true; if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y })); }}
        onPointerUp={() => { pan.current = null; }}
      >
        <div className="mm-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="mm-edges" style={{ left: layout.minX - 40, top: layout.minY - 40, width: layout.width + 80, height: layout.height + 80 }} viewBox={`${layout.minX - 40} ${layout.minY - 40} ${layout.width + 80} ${layout.height + 80}`} aria-hidden>
            {layout.edges.map((e) => <path key={e.to.id} d={edgePath(e.from, e.to)} className={`mm-edge depth-${Math.min(e.to.depth, 3)}`} />)}
          </svg>
          {layout.nodes.map((p) => {
            const isSel = p.id === sel;
            const kids = p.node.children.length;
            const t = drag?.target?.id === p.id ? ` drop-${drag.target.where}` : '';
            return (
              <div
                key={p.id}
                id={`mm-${p.id}`}
                role="treeitem"
                aria-level={p.depth + 1}
                aria-selected={isSel}
                aria-expanded={kids ? !collapsed.has(p.id) : undefined}
                className={`mm-node depth-${Math.min(p.depth, 2)} ${isSel ? 'is-sel' : ''} ${drag?.id === p.id ? 'is-ghost' : ''}${t}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                title={p.node.text}
                onPointerDown={(e) => onNodeDown(e, p)}
                onDoubleClick={(e) => { e.stopPropagation(); startEdit(p.id); }}
              >
                {editing?.id === p.id ? (
                  <input
                    className="mm-edit"
                    autoFocus
                    value={editing.draft}
                    placeholder="New idea"
                    aria-label="Branch text"
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                    onBlur={() => finishEdit(true)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
                      else if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, e.shiftKey ? undefined : editing.fresh ? 'sibling' : undefined); }
                      else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, 'child'); }
                    }}
                  />
                ) : <span className="mm-text">{p.node.task === 'x' ? '✓ ' : ''}{p.node.text}</span>}
                {kids && p.depth > 0 ? (
                  <button className={`mm-fold side-${p.side === 1 ? 'r' : 'l'} ${collapsed.has(p.id) ? 'is-folded' : ''}`} tabIndex={-1} aria-label={collapsed.has(p.id) ? `Show ${p.hidden} hidden` : 'Fold'} title={collapsed.has(p.id) ? `Show ${p.hidden} more` : 'Fold (Space)'} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
                    {collapsed.has(p.id) ? p.hidden : '−'}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mm-tools" role="toolbar" aria-label="Mind map">
        <div className="nt-seg" role="group" aria-label="Shape">
          <button className={mode === 'balanced' ? 'on' : ''} aria-pressed={mode === 'balanced'} onClick={() => setMode('balanced')} title="Branches on both sides">Both sides</button>
          <button className={mode === 'right' ? 'on' : ''} aria-pressed={mode === 'right'} onClick={() => setMode('right')} title="Branches to the right, like an outline">Right</button>
        </div>
        <span className="mm-sep" aria-hidden />
        <button className="mm-text-btn" title="Add a branch under the selected one (Tab)" onClick={() => add('child')}>Add branch</button>
        <span className="mm-sep" aria-hidden />
        <button className="nt-icon-btn" title="Zoom out (Ctrl −)" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}><Icon name="minus" size={15} /></button>
        <button className="mm-zoom" title="Fit the map (Ctrl 0)" aria-label="Fit the map" onClick={fit}>{Math.round(view.k * 100)}%</button>
        <button className="nt-icon-btn" title="Zoom in (Ctrl +)" aria-label="Zoom in" onClick={() => zoom(1.2)}><Icon name="plus" size={15} stroke={2.4} /></button>
        <span className="mm-sep" aria-hidden />
        <button className="mm-text-btn" onClick={() => void save('png')} title="Save the map as a picture">PNG</button>
        <button className="mm-text-btn" onClick={() => void save('svg')} title="Save the map as a drawing that stays sharp">SVG</button>
        <span className="mm-count" aria-live="polite">{count.toLocaleString()} ideas</span>
      </div>
      <div className="mm-hint" aria-hidden>Tab under · Enter beside · F2 rename · Space fold · drag to move</div>
    </div>
  );
}

function edgePath(a: Placed, b: Placed): string {
  const x1 = b.side === 1 ? a.x + a.w : a.x;
  const y1 = a.y + a.h / 2;
  const x2 = b.side === 1 ? b.x : b.x + b.w;
  const y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The map as a standalone SVG in the colours on screen now. */
function mapSvg(l: MindLayout, collapsed: Set<string>, el: HTMLElement): string {
  const cs = getComputedStyle(el);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  const bg = v('--bg', '#f6f5f2'), card = v('--bg-elev', '#fff'), sunk = v('--accent-soft', '#e8e8fd'), line = v('--line-strong', '#ccc'), text = v('--text', '#18181b'), accent = v('--accent', '#5b5bf0'), onAccent = v('--accent-text', '#fff');
  const pad = 32;
  const W = Math.ceil(l.width + pad * 2), H = Math.ceil(l.height + pad * 2);
  const ox = pad - l.minX, oy = pad - l.minY;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${bg}"/>`];
  for (const e of l.edges) parts.push(`<path d="${edgePath(e.from, e.to)}" transform="translate(${ox},${oy})" fill="none" stroke="${line}" stroke-width="${e.to.depth === 1 ? 2 : 1.5}"/>`);
  for (const p of l.nodes) {
    const fill = p.depth === 0 ? accent : p.depth === 1 ? sunk : card;
    const fg = p.depth === 0 ? onAccent : text;
    const fs = p.depth === 0 ? 17 : p.depth === 1 ? 14 : 13;
    const label = p.node.text + (collapsed.has(p.id) && p.hidden ? ` (+${p.hidden})` : '');
    parts.push(`<g transform="translate(${p.x + ox},${p.y + oy})"><rect width="${p.w}" height="${p.h}" rx="${p.h / 2}" fill="${fill}"${p.depth > 1 ? ` stroke="${line}"` : ''}/><text x="${p.w / 2}" y="${p.h / 2}" dy="0.35em" text-anchor="middle" font-family="-apple-system, 'Segoe UI', system-ui, sans-serif" font-size="${fs}" font-weight="${p.depth === 0 ? 700 : p.depth === 1 ? 600 : 400}" fill="${fg}">${escXml(label)}</text></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
