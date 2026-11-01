// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A .canvas board: cards with text, notes, files, web links and groups on an
// endless surface, joined by arrows. Drag to move, drag the corner to resize,
// drag from a card's edge dot to another card to join them, double-click the
// empty board for a new card. Saved as JSON Canvas, readable by other apps.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { addEdge, addNode, anchor, colorOf, parseCanvas, removeNodes, serializeCanvas, validateCanvas, type CanvasData, type CanvasNode, type Side } from '../../core/notes/canvas';
import { kindOf, useNotes } from './ctx';
import { sanitize } from './Reading';

function NodeBody({ node, editing, onText }: { node: CanvasNode; editing: boolean; onText: (t: string) => void }) {
  const n = useNotes();
  const [html, setHtml] = useState('');
  const text = node.type === 'text' ? node.text : '';
  const file = node.type === 'file' ? node.file : '';
  useEffect(() => {
    let alive = true;
    if (node.type === 'text' && !editing) void api.notes.render(n.vault.id, '', { text }).then((h) => alive && setHtml(sanitize(h)));
    if (node.type === 'file' && kindOf(file) === 'note') void api.notes.render(n.vault.id, file).then((h) => alive && setHtml(sanitize(h)));
    return () => { alive = false; };
  }, [node.type, text, file, editing, n.vault.id, n.rev]);
  const [src, setSrc] = useState('');
  useEffect(() => { if (node.type === 'file' && kindOf(file) === 'image') void api.notes.fileUrl(n.vault.id, file).then(setSrc); }, [node.type, file, n.vault.id]);
  if (node.type === 'text') {
    return editing
      ? <textarea className="nt-cv-edit" autoFocus defaultValue={node.text} onBlur={(e) => onText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); e.stopPropagation(); }} />
      : <div className="markdown-rendered nt-cv-md" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (node.type === 'file') {
    if (kindOf(node.file) === 'image') return <img src={src} alt={node.file} className="nt-cv-img" />;
    return (
      <div className="nt-cv-file">
        <div className="nt-cv-file-title" onDoubleClick={() => n.open(node.file)}>{node.file.split('/').pop()?.replace(/\.md$/, '')}</div>
        {kindOf(node.file) === 'note' ? <div className="markdown-rendered nt-cv-md" dangerouslySetInnerHTML={{ __html: html }} /> : null}
      </div>
    );
  }
  if (node.type === 'link') return <div className="nt-cv-link"><Icon name="globe" size={14} /> <a href={node.url} onClick={(e) => { e.preventDefault(); void api.system.openExternal(node.url); }}>{node.url}</a></div>;
  return <div className="nt-cv-group-label">{node.label}</div>;
}

export function CanvasView({ path }: { path: string }) {
  const n = useNotes();
  const [data, setData] = useState<CanvasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [link, setLink] = useState<{ from: string; side: Side; x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const saveTimer = useRef(0);
  const lastSaved = useRef('');

  useEffect(() => {
    let alive = true;
    void api.notes.read(n.vault.id, path).then((t) => {
      if (!alive) return;
      if (t === lastSaved.current) return;
      try { setData(parseCanvas(t)); lastSaved.current = t; setError(null); } catch (e) { setError((e as Error).message); }
    });
    return () => { alive = false; };
  }, [n.vault.id, path, n.rev]);

  const save = (next: CanvasData) => {
    setData(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const problems = validateCanvas(next);
      if (problems.length) { n.toast(`Not saved: ${problems[0]}`); return; }
      const t = serializeCanvas(next);
      lastSaved.current = t;
      void api.notes.write(n.vault.id, path, t);
    }, 300);
  };

  const toBoard = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (cx - r.left - r.width / 2 - view.x) / view.k, y: (cy - r.top - r.height / 2 - view.y) / view.k };
  };

  const drag = (e: React.PointerEvent, node: CanvasNode, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (editing === node.id) return;
    setSel(node.id);
    const start = { x: e.clientX, y: e.clientY };
    const orig = { x: node.x, y: node.y, w: node.width, h: node.height };
    // Moving a group moves what is inside it.
    const inside = node.type === 'group' && mode === 'move' && data ? data.nodes.filter((m) => m.id !== node.id && m.x >= node.x && m.y >= node.y && m.x + m.width <= node.x + node.width && m.y + m.height <= node.y + node.height).map((m) => ({ id: m.id, x: m.x, y: m.y })) : [];
    let latest = data!;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / view.k, dy = (ev.clientY - start.y) / view.k;
      latest = {
        ...latest,
        nodes: latest.nodes.map((m) => {
          if (m.id === node.id) return mode === 'move' ? { ...m, x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) } : { ...m, width: Math.max(80, Math.round(orig.w + dx)), height: Math.max(50, Math.round(orig.h + dy)) };
          const c = inside.find((i) => i.id === m.id);
          return c ? { ...m, x: Math.round(c.x + dx), y: Math.round(c.y + dy) } : m;
        }),
      };
      setData(latest);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); save(latest); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const pan = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.nt-cv-node')) return;
    // Finish the card being typed in first (its text is saved on blur).
    if (editing) (document.activeElement as HTMLElement | null)?.blur();
    setSel(null);
    setEditing(null);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const startLink = (e: React.PointerEvent, node: CanvasNode, side: Side) => {
    e.stopPropagation();
    const p = toBoard(e.clientX, e.clientY);
    setLink({ from: node.id, side, ...p });
    const move = (ev: PointerEvent) => setLink((l) => (l ? { ...l, ...toBoard(ev.clientX, ev.clientY) } : l));
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      setLink(null);
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.nt-cv-node') as HTMLElement | null;
      const to = target?.dataset.id;
      if (to && to !== node.id && data) save(addEdge(data, node.id, to, { toEnd: 'arrow' }));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  const newCard = (x: number, y: number) => {
    if (!data) return;
    const next = addNode(data, { type: 'text', text: '', x: Math.round(x - 125), y: Math.round(y - 40), width: 250, height: 80 } as never);
    save(next);
    const id = next.nodes[next.nodes.length - 1].id;
    setSel(id);
    setEditing(id);
  };

  const addFile = (file: string) => {
    if (!data) return;
    const c = toBoard((box.current?.getBoundingClientRect().left ?? 0) + (box.current?.clientWidth ?? 0) / 2, (box.current?.getBoundingClientRect().top ?? 0) + (box.current?.clientHeight ?? 0) / 2);
    save(addNode(data, { type: 'file', file, x: Math.round(c.x - 200), y: Math.round(c.y - 150), width: 400, height: 300 } as never));
    setAdding(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || editing || !data) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('input,textarea,[contenteditable]')) { save(removeNodes(data, [sel])); setSel(null); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const nodes = useMemo(() => (data ? [...data.nodes].sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1)) : []), [data]);
  if (error) return <div className="nt-empty"><Icon name="warning" /> This canvas could not be read: {error}</div>;
  if (!data) return <div className="nt-loading">Opening…</div>;
  const byId = new Map(data.nodes.map((m) => [m.id, m]));
  const selNode = sel ? byId.get(sel) : undefined;

  return (
    <div className="nt-canvas" ref={box} data-testid="canvas-board"
      onPointerDown={pan}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('.nt-cv-node')) { const p = toBoard(e.clientX, e.clientY); newCard(p.x, p.y); } }}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) { const k = Math.min(3, Math.max(0.15, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); setView((v) => ({ ...v, k })); }
        else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }}>
      <div className="nt-cv-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="nt-cv-edges" style={{ overflow: 'visible' }}>
          <defs><marker id="nt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker></defs>
          {data.edges.map((e) => {
            const a = byId.get(e.fromNode), b = byId.get(e.toNode);
            if (!a || !b) return null;
            const p = anchor(a, e.fromSide ?? 'right'), q = anchor(b, e.toSide ?? 'left');
            const bend = (s: Side | undefined, pt: { x: number; y: number }) => ({ top: { x: pt.x, y: pt.y - 60 }, bottom: { x: pt.x, y: pt.y + 60 }, left: { x: pt.x - 60, y: pt.y }, right: { x: pt.x + 60, y: pt.y } }[s ?? 'right']);
            const c1 = bend(e.fromSide, p), c2 = bend(e.toSide ?? 'left', q);
            return (
              <g key={e.id} style={{ color: colorOf(e.color) ?? 'var(--text-3)' }}>
                <path d={`M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`} fill="none" stroke="currentColor" strokeWidth={2} markerEnd={e.toEnd !== 'none' ? 'url(#nt-arrow)' : undefined} markerStart={e.fromEnd === 'arrow' ? 'url(#nt-arrow)' : undefined} />
                {e.label ? <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 6} className="nt-cv-elabel">{e.label}</text> : null}
              </g>
            );
          })}
          {link ? (() => { const a = byId.get(link.from); if (!a) return null; const p = anchor(a, link.side); return <path d={`M${p.x},${p.y} L${link.x},${link.y}`} stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 4" />; })() : null}
        </svg>
        {nodes.map((m) => (
          <div key={m.id} data-id={m.id} className={`nt-cv-node type-${m.type} ${sel === m.id ? 'is-sel' : ''}`}
            style={{ left: m.x, top: m.y, width: m.width, height: m.height, ['--cv' as string]: colorOf(m.color) ?? 'var(--line)' }}
            onPointerDown={(e) => drag(e, m, 'move')}
            onDoubleClick={(e) => { e.stopPropagation(); if (m.type === 'text') setEditing(m.id); else if (m.type === 'file') n.open(m.file); }}>
            <NodeBody node={m} editing={editing === m.id} onText={(t) => { setEditing(null); save({ ...data, nodes: data.nodes.map((x) => (x.id === m.id ? { ...x, text: t } as CanvasNode : x)) }); }} />
            {(['top', 'right', 'bottom', 'left'] as Side[]).map((s) => <span key={s} className={`nt-cv-dot side-${s}`} onPointerDown={(e) => startLink(e, m, s)} title="Drag to another card to join them" />)}
            <span className="nt-cv-resize" onPointerDown={(e) => drag(e, m, 'resize')} />
          </div>
        ))}
      </div>
      <div className="nt-cv-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="nt-icon-btn" title="Add a card" aria-label="Add card" onClick={() => { const r = box.current!.getBoundingClientRect(); const p = toBoard(r.left + r.width / 2, r.top + r.height / 2); newCard(p.x, p.y); }}><Icon name="plus" size={15} /></button>
        <button className="nt-icon-btn" title="Add a note or file from the vault" onClick={() => setAdding((a) => !a)}><Icon name="document" size={15} /></button>
        <button className="nt-icon-btn" title="Add a group" onClick={() => { const r = box.current!.getBoundingClientRect(); const p = toBoard(r.left + r.width / 2, r.top + r.height / 2); save(addNode(data, { type: 'group', label: 'Group', x: Math.round(p.x - 250), y: Math.round(p.y - 200), width: 500, height: 400 } as never)); }}><Icon name="grid" size={15} /></button>
        {selNode ? (
          <>
            {['1', '2', '3', '4', '5', '6'].map((c) => <button key={c} className="nt-cv-swatch" style={{ background: colorOf(c) }} title={`Colour ${c}`} onClick={() => save({ ...data, nodes: data.nodes.map((x) => (x.id === selNode.id ? { ...x, color: c } : x)) })} />)}
            <button className="nt-icon-btn" title="Remove card" onClick={() => { save(removeNodes(data, [selNode.id])); setSel(null); }}><Icon name="trash" size={14} /></button>
          </>
        ) : null}
        <span className="nt-cv-zoom">{Math.round(view.k * 100)}%</span>
        <button className="nt-icon-btn" title="Reset zoom" onClick={() => setView({ x: 0, y: 0, k: 1 })}><Icon name="refresh" size={14} /></button>
      </div>
      {adding ? (
        <div className="nt-cv-picker" onPointerDown={(e) => e.stopPropagation()}>
          {n.files.filter((f) => f.path !== path).slice(0, 300).map((f) => <button key={f.path} onClick={() => addFile(f.path)}>{f.path}</button>)}
        </div>
      ) : null}
    </div>
  );
}
