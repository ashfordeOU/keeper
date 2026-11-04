// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The PDF reader: a calm reading view (pages, thumbnails, find, zoom, dark
// pages) with highlight, underline, notes, freehand drawing, text boxes and
// signatures, form filling, and pages turned, removed, reordered or added from
// other PDFs. Save writes it all into the PDF itself as standard annotations
// (core/pdf-annotate.ts); the version before is kept to restore.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MARK_COLOURS, type Annot, type Rect } from '../../core/pdf-annotate';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Modal, PageHead } from '../components/ui';
import { openPdf, pdfjs, type PdfDoc, type PdfPage } from '../preview/pdf';
import { useStore } from '../state';
import '../styles/pdf-reader.css';

type Tool = 'read' | 'highlight' | 'underline' | 'note' | 'draw' | 'text' | 'sign';
type PageViewport = ReturnType<PdfPage['getViewport']>;
/** A page of the document being made: where it comes from, its own key (annotations follow it when pages move), and a turn. */
interface PageItem { key: string; src: number; index: number; rotate: number }
/** An annotation on a page item (its position is worked out when saving). */
type Mark = Annot & { pageKey: string };
interface Snapshot { pages: PageItem[]; marks: Mark[]; fields: Record<string, string | boolean> }
interface Widget { name: string; type: 'text' | 'check' | 'radio' | 'choice'; rect: number[]; value: string | boolean; options?: { value: string; label: string }[]; on?: string; multiline?: boolean; readOnly?: boolean }

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'read', label: 'Read', key: 'V' },
  { id: 'highlight', label: 'Highlight', key: 'H' },
  { id: 'underline', label: 'Underline', key: 'U' },
  { id: 'note', label: 'Note', key: 'N' },
  { id: 'draw', label: 'Draw', key: 'D' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'sign', label: 'Sign', key: 'S' },
];

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const pxRectToPdf = (vp: PageViewport, x0: number, y0: number, x1: number, y1: number): Rect => {
  const [a, b] = vp.convertToPdfPoint(x0, y0);
  const [c, d] = vp.convertToPdfPoint(x1, y1);
  return [Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)];
};
const pdfRectToPx = (vp: PageViewport, r: Rect | number[]) => {
  const [x0, y0, x1, y1] = vp.convertToViewportRectangle([r[0], r[1], r[0] + r[2], r[1] + r[3]]);
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
};
/** Rectangles on one line become one. */
function mergeLines(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of [...rects].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < Math.max(2, r[3] * 0.4) && r[0] <= last[0] + last[2] + 4) {
      const x0 = Math.min(last[0], r[0]);
      const x1 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y0 = Math.min(last[1], r[1]);
      const y1 = Math.max(last[1] + last[3], r[1] + r[3]);
      out[out.length - 1] = [x0, y0, x1 - x0, y1 - y0];
    } else out.push(r);
  }
  return out;
}

export function PdfReader({ initial }: { initial?: string }) {
  const { toast, settings, updateSettings } = useStore();
  const [path, setPath] = useState<string | null>(null);
  const [srcs, setSrcs] = useState<{ path: string; doc: PdfDoc }[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [tool, setTool] = useState<Tool>('read');
  const [colour, setColour] = useState(MARK_COLOURS[0].hex);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [width, setWidth] = useState(0);
  const [thumbs, setThumbs] = useState(false);
  const [current, setCurrent] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);
  const [hitAt, setHitAt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<{ png: string; ratio: number } | null>(null);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backup, setBackup] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const texts = useRef(new Map<string, string>());
  const boxes = useRef(new Map<string, { el: HTMLDivElement; vp: PageViewport }>());
  const dark = !!settings?.pdfReader?.darkPages;
  const dirty = history.length > 0;

  const load = async (p: string) => {
    setBusy('Opening…');
    try {
      const bytes = await api.pdfReader.read(p);
      const doc = await openPdf(bytes);
      for (const s of srcs) void s.doc.destroy();
      setPath(p); setSrcs([{ path: p, doc }]);
      setPages(Array.from({ length: doc.numPages }, (_, i) => ({ key: `0:${i}:${uid('')}`, src: 0, index: i, rotate: 0 })));
      setMarks([]); setFields({}); setHistory([]); setSelected(null); setEditing(null); setHits(null); setQuery('');
      texts.current.clear();
      void api.pdfReader.hasBackup(p).then(setBackup);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => { if (initial) void load(initial); }, [initial]);
  useEffect(() => () => { for (const s of srcs) void s.doc.destroy(); }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [path, thumbs]);

  const change = (next: Partial<Snapshot>) => {
    setHistory((h) => [...h.slice(-99), { pages, marks, fields }]);
    if (next.pages) setPages(next.pages);
    if (next.marks) setMarks(next.marks);
    if (next.fields) setFields(next.fields);
  };
  const undo = () => setHistory((h) => {
    const last = h[h.length - 1];
    if (!last) return h;
    setPages(last.pages); setMarks(last.marks); setFields(last.fields);
    return h.slice(0, -1);
  });
  const addMark = (m: Mark) => change({ marks: [...marks, m] });
  const removeMark = (id: string) => { change({ marks: marks.filter((m) => m.id !== id) }); setSelected(null); setEditing(null); };
  const updateMark = (id: string, patch: Partial<Mark>, record = true) => {
    const next = marks.map((m) => (m.id === id ? ({ ...m, ...patch } as Mark) : m));
    if (record) change({ marks: next }); else setMarks(next);
  };

  const pageWidth = zoom === 'fit' ? Math.max(240, Math.min(width - 48, 980)) : Math.round(612 * zoom);
  const go = (i: number) => scroller.current?.querySelector(`[data-pos="${i}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  // ---------------------------------------------------------------- find
  const textOf = async (p: PageItem) => {
    const k = `${p.src}:${p.index}`;
    let t = texts.current.get(k);
    if (t === undefined) {
      const tc = await (await srcs[p.src].doc.getPage(p.index + 1)).getTextContent();
      t = tc.items.map((x) => ('str' in x ? x.str : '')).join(' ');
      texts.current.set(k, t);
    }
    return t;
  };
  const find = async (next = false) => {
    const q = query.trim().toLowerCase();
    if (!q) { setHits(null); return; }
    if (next && hits?.length) { const n = (hitAt + 1) % hits.length; setHitAt(n); go(hits[n]); return; }
    const out: number[] = [];
    for (let i = 0; i < pages.length; i++) if ((await textOf(pages[i])).toLowerCase().includes(q)) out.push(i);
    setHits(out); setHitAt(0);
    if (out[0] !== undefined) go(out[0]);
  };

  // ---------------------------------------------------------------- pages
  const turnPage = (key: string, by = 90) => change({ pages: pages.map((p) => (p.key === key ? { ...p, rotate: (p.rotate + by) % 360 } : p)) });
  const removePage = (key: string) => {
    if (pages.length <= 1) { toast('A PDF needs at least one page'); return; }
    change({ pages: pages.filter((p) => p.key !== key), marks: marks.filter((m) => m.pageKey !== key) });
  };
  const movePage = (from: number, to: number) => {
    if (from === to) return;
    const next = [...pages];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    change({ pages: next });
  };
  const addPdfs = async () => {
    const more = await api.pdfReader.pickMore();
    if (!more.length) return;
    const added: PageItem[] = [];
    const nextSrcs = [...srcs];
    for (const p of more) {
      try {
        const doc = await openPdf(await api.pdfReader.read(p));
        nextSrcs.push({ path: p, doc });
        for (let i = 0; i < doc.numPages; i++) added.push({ key: `${nextSrcs.length - 1}:${i}:${uid('')}`, src: nextSrcs.length - 1, index: i, rotate: 0 });
      } catch (e) { toast(`${p.split(/[\\/]/).pop()}: ${errText(e)}`); }
    }
    setSrcs(nextSrcs);
    change({ pages: [...pages, ...added] });
    toast(`Added ${added.length} page${added.length === 1 ? '' : 's'}`);
  };

  // ---------------------------------------------------------------- save
  const save = async (copy = false) => {
    if (!path) return;
    setBusy(copy ? 'Saving a copy…' : 'Saving…');
    try {
      const pos = new Map(pages.map((p, i) => [p.key, i]));
      const annots: Annot[] = marks.filter((m) => pos.has(m.pageKey) && !(m.kind === 'note' && !m.text.trim()) && !(m.kind === 'text' && !m.text.trim())).map(({ pageKey, ...m }) => ({ ...m, page: pos.get(pageKey)! }) as Annot);
      const r = await api.pdfReader.save(path, { pages: pages.map(({ src, index, rotate }) => ({ src, index, rotate })), annots, fields }, srcs.slice(1).map((s) => s.path), copy);
      if (!r) return;
      toast(copy ? `Saved a copy: ${r.path.split(/[\\/]/).pop()}` : 'Saved into the PDF');
      await load(r.path);
    } catch (e) {
      toast(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- keys
  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(e.shiftKey); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); findBox.current?.focus(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'Escape') { setTool('read'); setSelected(null); setSignature(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeMark(selected); return; }
      if (mod || e.altKey) return;
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, (z === 'fit' ? pageWidth / 612 : z) * 1.2));
      else if (e.key === '-') setZoom((z) => Math.max(0.3, (z === 'fit' ? pageWidth / 612 : z) / 1.2));
      else { const t = TOOLS.find((x) => x.key === e.key.toUpperCase()); if (t) { if (t.id === 'sign') setSigning(true); else setTool(t.id); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const p = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).find((x) => x && /\.pdf$/i.test(x));
    if (p) void load(p);
  };

  if (!path || !srcs.length) {
    return (
      <div className="page pdr-page" data-testid="pdf-page" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <PageHead title="PDF Reader" sub="Read, mark up, fill in and sign PDFs. Saved as a real PDF." />
        <div className="card pdr-empty">
          <Empty icon="document" title="Open a PDF" action={<button className="btn primary" data-testid="pdf-open" onClick={() => void api.pdfReader.pick().then((p) => { if (p) void load(p); })}>{busy ?? 'Open PDF…'}</button>} hint="Or drop a PDF here · in Files, right-click a PDF → Open in PDF Reader">
            Highlight, add notes, sign, fill forms and tidy the pages.
          </Empty>
        </div>
      </div>
    );
  }

  const name = path.split(/[\\/]/).pop() ?? '';
  const moreItems = [
    { label: 'Turn this page', icon: 'refresh', run: () => pages[current] && turnPage(pages[current].key) },
    { label: 'Remove this page', icon: 'trash', run: () => pages[current] && removePage(pages[current].key) },
    { label: 'Add pages from a PDF…', icon: 'plus', run: () => void addPdfs() },
    { sep: true, label: '' },
    { label: 'Undo', icon: 'undo', kbd: 'Ctrl Z', run: undo },
    { label: 'Save a copy…', icon: 'copy', run: () => void save(true) },
    ...(backup ? [{ label: 'Restore the last version', icon: 'history', run: () => { if (confirm('Put back the version from before the last save? Changes made since are lost.')) void api.pdfReader.restore(path).then(() => load(path)); } }] : []),
  ];
  return (
    <div className="page pdr-page pdr-open" data-testid="pdf-page" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="pdr-head">
        <div className="pdr-title">
          <span className="kicker">PDF Reader</span>
          <h1 data-user-text title={path}>{name}</h1>
        </div>
        <div className="pdr-status muted small" data-testid="pdf-status">{busy ?? (dirty ? `${history.length} change${history.length === 1 ? '' : 's'} · not saved yet` : 'Saved · on this computer')}</div>
      </div>
      <div className="pdr-toolbar" role="toolbar" aria-label="PDF tools">
        <button className={`pdr-icon${thumbs ? ' on' : ''}`} aria-label="Pages" title="Pages: turn, remove, reorder, add" aria-pressed={thumbs} data-testid="pdf-thumbs" onClick={() => setThumbs(!thumbs)}><Icon name="panelLeft" size={15} /></button>
        <form className="pdr-find" onSubmit={(e) => { e.preventDefault(); void find(!!hits && query.trim() !== '' ); }}>
          <Icon name="search" size={13} />
          <input ref={findBox} aria-label="Find in PDF" placeholder="Find" value={query} onChange={(e) => { setQuery(e.target.value); setHits(null); }} data-testid="pdf-find" />
          {hits ? <span className="small muted num" data-testid="pdf-hits">{hits.length ? `${hitAt + 1} of ${hits.length}` : 'None'}</span> : null}
        </form>
        <span className="pdr-sep" />
        <div className="seg pdr-tools" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => <button key={t.id} role="radio" aria-checked={tool === t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${t.key})`} data-testid={`pdf-tool-${t.id}`} onClick={() => { if (t.id === 'sign') setSigning(true); else { setTool(t.id); setSignature(null); } }}>{t.label}</button>)}
        </div>
        {tool !== 'read' && tool !== 'sign' ? (
          <div className="pdr-colours" role="radiogroup" aria-label="Colour">
            {MARK_COLOURS.slice(0, 5).map((c) => <button key={c.id} role="radio" aria-checked={colour === c.hex} aria-label={c.label} title={c.label} className={colour === c.hex ? 'on' : ''} style={{ background: c.hex }} onClick={() => setColour(c.hex)} />)}
          </div>
        ) : null}
        <span className="pdr-sep" />
        <button className="pdr-icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => setZoom((z) => Math.max(0.3, (z === 'fit' ? pageWidth / 612 : z) / 1.2))}><Icon name="minus" size={14} /></button>
        <button className="pdr-zoom small num" title="Fit the width" onClick={() => setZoom('fit')}>{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
        <button className="pdr-icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => setZoom((z) => Math.min(4, (z === 'fit' ? pageWidth / 612 : z) * 1.2))}><Icon name="plus" size={14} /></button>
        <button className={`pdr-icon${dark ? ' on' : ''}`} aria-label="Dark pages" title="Dark pages for reading" aria-pressed={dark} data-testid="pdf-dark" onClick={() => void updateSettings({ pdfReader: { ...(settings?.pdfReader ?? { keepPrevious: true }), darkPages: !dark } })}><Icon name="moon" size={14} /></button>
        <button className="pdr-icon" aria-label="More" title="More" data-testid="pdf-more" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.left, y: r.bottom + 4 }); }}><Icon name="more" size={15} /></button>
        <button className="btn primary sm" data-testid="pdf-save" disabled={!!busy} onClick={() => void save(false)}>Save</button>
      </div>
      {signature ? <div className="pdr-hint small" role="status">Click where the signature goes · Esc to stop</div> : tool === 'highlight' || tool === 'underline' ? <div className="pdr-hint small" role="status">Select text to {tool}, or drag a box on a scan</div> : tool === 'draw' ? <div className="pdr-hint small" role="status">Draw with the mouse or a pen</div> : tool === 'note' || tool === 'text' ? <div className="pdr-hint small" role="status">Click where the {tool === 'note' ? 'note' : 'text'} goes</div> : null}

      <div className="pdr-body">
        {thumbs ? <PagesPanel srcs={srcs} pages={pages} current={current} go={go} turn={turnPage} remove={removePage} move={movePage} add={() => void addPdfs()} /> : null}
        <div
          ref={scroller}
          className={`pdr-scroll${dark ? ' dark-pages' : ''} tool-${signature ? 'sign' : tool}`}
          data-testid="pdf-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            for (const k of el.querySelectorAll<HTMLElement>('[data-pos]')) if (k.offsetTop + k.offsetHeight / 2 > el.scrollTop) { setCurrent(Number(k.dataset.pos)); break; }
          }}
        >
          {width ? pages.map((p, i) => (
            <PageView
              key={p.key}
              item={p}
              pos={i}
              doc={srcs[p.src]?.doc}
              width={pageWidth}
              tool={signature ? 'sign' : tool}
              colour={colour}
              marks={marks.filter((m) => m.pageKey === p.key)}
              selected={selected}
              editing={editing}
              query={query.trim()}
              fields={p.src === 0 ? fields : null}
              boxes={boxes.current}
              onField={(name, v) => change({ fields: { ...fields, [name]: v } })}
              onAdd={(m) => { addMark(m); if (m.kind === 'note' || m.kind === 'text') setEditing(m.id); }}
              onSelect={(id) => { setSelected(id); }}
              onEdit={setEditing}
              onUpdate={updateMark}
              onRemove={removeMark}
              signature={signature}
              onSigned={() => setSignature(null)}
            />
          )) : null}
        </div>
      </div>
      {selected && !editing ? (
        <div className="pdr-selbar" role="toolbar" aria-label="Chosen mark">
          <span className="small muted">{marks.find((m) => m.id === selected)?.kind ?? ''}</span>
          <button className="btn sm" data-testid="pdf-remove-mark" onClick={() => removeMark(selected)}><Icon name="trash" size={12} /> Remove</button>
        </div>
      ) : null}
      {more ? <ContextMenu x={more.x} y={more.y} items={moreItems} onClose={() => setMore(null)} label="More" /> : null}
      {signing ? <SignatureSheet onClose={() => setSigning(false)} onDone={(s) => { setSigning(false); setSignature(s); setTool('read'); }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one page

function PageView(p: {
  item: PageItem; pos: number; doc?: PdfDoc; width: number; tool: Tool; colour: string; marks: Mark[]; selected: string | null; editing: string | null; query: string;
  fields: Record<string, string | boolean> | null; boxes: Map<string, { el: HTMLDivElement; vp: PageViewport }>;
  onField(name: string, v: string | boolean): void; onAdd(m: Mark): void; onSelect(id: string | null): void; onEdit(id: string | null): void; onUpdate(id: string, patch: Partial<Mark>, record?: boolean): void; onRemove(id: string): void;
  signature: { png: string; ratio: number } | null; onSigned(): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [vp, setVp] = useState<PageViewport | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setVisible(true)), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !p.doc) return;
    let cancelled = false;
    let task: { cancel(): void } | undefined;
    (async () => {
      const page = await p.doc!.getPage(p.item.index + 1);
      const rotation = (page.rotate + p.item.rotate) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const scale = p.width / base.width;
      const view = page.getViewport({ scale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = document.createElement('canvas');
      c.width = Math.floor(view.width * dpr);
      c.height = Math.floor(view.height * dpr);
      c.style.width = `${Math.floor(view.width)}px`;
      c.style.height = `${Math.floor(view.height)}px`;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      const r = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: scale * dpr, rotation }), annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS });
      task = r;
      await r.promise;
      if (cancelled || !canvasBox.current) return;
      canvasBox.current.replaceChildren(c);
      setVp(view);
      if (textBox.current) {
        textBox.current.replaceChildren();
        textBox.current.style.setProperty('--scale-factor', String(scale));
        await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: textBox.current, viewport: view }).render();
      }
      if (p.fields) {
        const anns = await page.getAnnotations({ intent: 'display' });
        if (cancelled) return;
        setWidgets(anns.filter((a) => a.subtype === 'Widget' && a.fieldName).map((a): Widget | null => {
          const type = a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Ch' ? 'choice' : a.checkBox ? 'check' : a.radioButton ? 'radio' : null;
          if (!type) return null;
          return {
            name: a.fieldName, type, rect: a.rect, readOnly: !!a.readOnly, multiline: !!a.multiLine,
            value: type === 'check' ? (a.fieldValue && a.fieldValue !== 'Off') : type === 'radio' ? String(a.fieldValue ?? '') : String(a.fieldValue ?? ''),
            on: a.buttonValue ?? a.exportValue, options: Array.isArray(a.options) ? a.options.map((o: { exportValue: string; displayValue: string }) => ({ value: o.exportValue, label: o.displayValue })) : undefined,
          };
        }).filter((w): w is Widget => !!w));
      }
    })().catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, p.doc, p.item.index, p.item.rotate, p.width]);

  useEffect(() => {
    if (vp && box.current) p.boxes.set(p.item.key, { el: box.current, vp });
    return () => { p.boxes.delete(p.item.key); };
  }, [vp]);

  // Words found are marked in the text layer.
  useEffect(() => {
    const q = p.query.toLowerCase();
    textBox.current?.querySelectorAll('span').forEach((s) => s.classList.toggle('hit', !!q && !!s.textContent?.toLowerCase().includes(q)));
  }, [p.query, vp]);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };
  const toPdf = (x: number, y: number) => vp!.convertToPdfPoint(x, y) as [number, number];
  const height = vp ? vp.height : Math.round(p.width * 1.294);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!vp || e.button !== 0) return;
    const [x, y] = local(e);
    if (p.tool === 'draw') { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrawing([[x, y]]); return; }
    if (p.tool === 'highlight' || p.tool === 'underline') { drag.current = { x, y }; return; }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing) { const pt = local(e); setDrawing((d) => (d ? [...d, pt] : d)); return; }
    if (drag.current && (e.buttons & 1) && !window.getSelection()?.toString()) {
      const [x, y] = local(e);
      setDragBox({ x: Math.min(x, drag.current.x), y: Math.min(y, drag.current.y), w: Math.abs(x - drag.current.x), h: Math.abs(y - drag.current.y) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!vp) return;
    if (drawing) {
      const path = drawing.length > 1 ? drawing : [...drawing, [drawing[0][0] + 0.5, drawing[0][1]] as [number, number]];
      p.onAdd({ id: uid('i'), pageKey: p.item.key, page: 0, kind: 'ink', paths: [path.map(([x, y]) => toPdf(x, y))], color: p.colour, width: 2 });
      setDrawing(null);
      return;
    }
    if (p.tool === 'highlight' || p.tool === 'underline') {
      const sel = window.getSelection();
      const start = drag.current;
      drag.current = null;
      setDragBox(null);
      if (sel && sel.rangeCount && sel.toString().trim()) {
        const r = box.current!.getBoundingClientRect();
        const rects: Rect[] = [];
        for (let i = 0; i < sel.rangeCount; i++) {
          for (const cr of sel.getRangeAt(i).getClientRects()) {
            if (cr.width < 1 || cr.height < 1) continue;
            const cx = cr.left + cr.width / 2;
            const cy = cr.top + cr.height / 2;
            if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
            rects.push(pxRectToPdf(vp, cr.left - r.left, cr.top - r.top, cr.right - r.left, cr.bottom - r.top));
          }
        }
        const text = sel.toString().trim().slice(0, 500);
        sel.removeAllRanges();
        if (rects.length) p.onAdd({ id: uid('h'), pageKey: p.item.key, page: 0, kind: p.tool, rects: mergeLines(rects), color: p.colour, text });
        return;
      }
      if (start) {
        const [x, y] = local(e);
        if (Math.abs(x - start.x) > 6 && Math.abs(y - start.y) > 6) p.onAdd({ id: uid('h'), pageKey: p.item.key, page: 0, kind: p.tool, rects: [pxRectToPdf(vp, start.x, start.y, x, y)], color: p.colour });
      }
    }
  };
  const onClick = (e: React.MouseEvent) => {
    if (!vp) return;
    const [x, y] = local(e);
    if (p.tool === 'note') p.onAdd({ id: uid('n'), pageKey: p.item.key, page: 0, kind: 'note', at: toPdf(x, y), text: '', color: p.colour });
    else if (p.tool === 'text') {
      const s = vp.scale;
      p.onAdd({ id: uid('t'), pageKey: p.item.key, page: 0, kind: 'text', rect: pxRectToPdf(vp, x, y, x + 220 * s, y + 44 * s), text: '', size: 12, color: p.colour === MARK_COLOURS[0].hex ? MARK_COLOURS[5].hex : p.colour });
    } else if (p.tool === 'sign' && p.signature) {
      const w = 160 * vp.scale;
      const h = w / p.signature.ratio;
      p.onAdd({ id: uid('s'), pageKey: p.item.key, page: 0, kind: 'signature', rect: pxRectToPdf(vp, x - w / 2, y - h / 2, x + w / 2, y + h / 2), png: p.signature.png });
      p.onSigned();
    } else if (p.tool === 'read' && e.target === e.currentTarget) p.onSelect(null);
  };

  return (
    <div className="pdr-pagewrap" data-pos={p.pos}>
      <div
        ref={box}
        className="pdr-pagebox"
        style={{ width: vp ? vp.width : p.width, height }}
        data-testid={`pdf-page-${p.pos}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
      >
        <div ref={canvasBox} className="pdr-canvas" />
        <div ref={textBox} className="textLayer" />
        {vp ? (
          <>
            <svg className="pdr-marks" width={vp.width} height={vp.height} aria-hidden={p.marks.length === 0}>
              {p.marks.map((m) => <MarkShape key={m.id} m={m} vp={vp} selected={p.selected === m.id} onSelect={() => p.onSelect(m.id)} canPick={p.tool === 'read'} />)}
              {drawing ? <polyline points={drawing.map((q) => q.join(',')).join(' ')} fill="none" stroke={p.colour} strokeWidth={2 * vp.scale} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {dragBox ? <rect x={dragBox.x} y={dragBox.y} width={dragBox.w} height={dragBox.h} fill={p.colour} opacity={0.35} /> : null}
            </svg>
            {p.marks.filter((m) => m.kind === 'note' || m.kind === 'text' || m.kind === 'signature').map((m) => <MarkBox key={m.id} m={m} vp={vp} p={p} />)}
            {p.fields ? widgets.map((w, i) => <FieldInput key={`${w.name}-${i}`} w={w} vp={vp} value={p.fields![w.name] ?? w.value} onChange={(v) => p.onField(w.name, v)} />) : null}
          </>
        ) : null}
      </div>
      <div className="pdr-pagenum small muted num">{p.pos + 1}</div>
    </div>
  );
}

function MarkShape({ m, vp, selected, onSelect, canPick }: { m: Mark; vp: PageViewport; selected: boolean; onSelect(): void; canPick: boolean }) {
  const pick = canPick ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(); }, style: { pointerEvents: 'auto' as const, cursor: 'default' } } : {};
  if (m.kind === 'highlight' || m.kind === 'underline') {
    return (
      <g className={`pdr-mark${selected ? ' sel' : ''}`} data-kind={m.kind} {...pick}>
        {m.rects.map((r, i) => {
          const b = pdfRectToPx(vp, r);
          return m.kind === 'highlight'
            ? <rect key={i} x={b.left} y={b.top} width={b.width} height={b.height} fill={m.color} opacity={0.4} style={{ mixBlendMode: 'multiply' }} />
            : <line key={i} x1={b.left} x2={b.left + b.width} y1={b.top + b.height - 1} y2={b.top + b.height - 1} stroke={m.color} strokeWidth={Math.max(1.2, vp.scale)} />;
        })}
      </g>
    );
  }
  if (m.kind === 'ink') {
    return <g className={`pdr-mark${selected ? ' sel' : ''}`} data-kind="ink" {...pick}>{m.paths.map((path, i) => <polyline key={i} points={path.map(([x, y]) => vp.convertToViewportPoint(x, y).join(',')).join(' ')} fill="none" stroke={m.color} strokeWidth={m.width * vp.scale} strokeLinecap="round" strokeLinejoin="round" />)}</g>;
  }
  return null;
}

function MarkBox({ m, vp, p }: { m: Mark; vp: PageViewport; p: Parameters<typeof PageView>[0] }) {
  const editing = p.editing === m.id;
  const sel = p.selected === m.id;
  if (m.kind === 'note') {
    const [x, y] = vp.convertToViewportPoint(m.at[0], m.at[1]);
    return (
      <div className={`pdr-note${sel ? ' sel' : ''}`} style={{ left: x, top: y }} data-kind="note" onClick={(e) => e.stopPropagation()}>
        <button className="pdr-note-pin" style={{ background: m.color }} aria-label={m.text ? `Note: ${m.text}` : 'Note'} title={m.text || 'Note'} onClick={() => { p.onSelect(m.id); p.onEdit(editing ? null : m.id); }}><Icon name="note" size={12} /></button>
        {editing ? (
          <div className="pdr-pop" role="dialog" aria-label="Note">
            <textarea autoFocus aria-label="Note text" placeholder="Write a note" defaultValue={m.text} onBlur={(e) => { if (e.target.value !== m.text) p.onUpdate(m.id, { text: e.target.value } as Partial<Mark>); }} />
            <div className="btn-row"><button className="btn ghost sm" onClick={() => p.onRemove(m.id)}>Remove</button><button className="btn sm" onClick={() => p.onEdit(null)}>Done</button></div>
          </div>
        ) : null}
      </div>
    );
  }
  if (m.kind === 'text') {
    const b = pdfRectToPx(vp, m.rect);
    return (
      <div className={`pdr-textbox${sel ? ' sel' : ''}${editing ? ' editing' : ''}`} style={{ left: b.left, top: b.top, width: b.width, minHeight: b.height, fontSize: m.size * vp.scale, color: m.color }} data-kind="text" onClick={(e) => { e.stopPropagation(); p.onSelect(m.id); }} onDoubleClick={() => p.onEdit(m.id)}>
        {editing ? <textarea autoFocus aria-label="Text box" defaultValue={m.text} style={{ fontSize: m.size * vp.scale, color: m.color }} onBlur={(e) => { const t = e.target.value; p.onEdit(null); if (!t.trim()) p.onRemove(m.id); else if (t !== m.text) p.onUpdate(m.id, { text: t } as Partial<Mark>); }} /> : <span>{m.text}</span>}
      </div>
    );
  }
  if (m.kind === 'signature') {
    const b = pdfRectToPx(vp, m.rect);
    return <img className={`pdr-sig${sel ? ' sel' : ''}`} alt="Signature" src={m.png} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} data-kind="signature" onClick={(e) => { e.stopPropagation(); p.onSelect(m.id); }} />;
  }
  return null;
}

function FieldInput({ w, vp, value, onChange }: { w: Widget; vp: PageViewport; value: string | boolean; onChange(v: string | boolean): void }) {
  const b = pdfRectToPx(vp, [w.rect[0], w.rect[1], w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]]);
  const style = { left: b.left, top: b.top, width: b.width, height: b.height, fontSize: Math.max(9, Math.min(b.height * 0.62, 16)) };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (w.type === 'check') return <input type="checkbox" className="pdr-field check" style={style} aria-label={w.name} checked={!!value} disabled={w.readOnly} onChange={(e) => onChange(e.target.checked)} onClick={stop} onPointerDown={stop} data-field={w.name} />;
  if (w.type === 'radio') return <input type="radio" className="pdr-field check" style={style} aria-label={`${w.name}: ${w.on}`} name={w.name} checked={value === w.on} disabled={w.readOnly} onChange={() => onChange(w.on ?? '')} onClick={stop} onPointerDown={stop} data-field={w.name} />;
  if (w.type === 'choice') return <select className="pdr-field" style={style} aria-label={w.name} value={String(value)} disabled={w.readOnly} onChange={(e) => onChange(e.target.value)} onClick={stop} onPointerDown={stop} data-field={w.name}>{(w.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return w.multiline
    ? <textarea className="pdr-field" style={style} aria-label={w.name} defaultValue={String(value)} disabled={w.readOnly} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} onClick={stop} onPointerDown={stop} data-field={w.name} />
    : <input className="pdr-field" style={style} aria-label={w.name} defaultValue={String(value)} disabled={w.readOnly} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} onClick={stop} onPointerDown={stop} data-field={w.name} />;
}

// ---------------------------------------------------------------- pages panel

function PagesPanel({ srcs, pages, current, go, turn, remove, move, add }: { srcs: { doc: PdfDoc }[]; pages: PageItem[]; current: number; go(i: number): void; turn(k: string): void; remove(k: string): void; move(from: number, to: number): void; add(): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <aside className="pdr-pages" aria-label="Pages" data-testid="pdf-pages">
      <div className="pdr-pages-head"><b>Pages</b><span className="muted small">{pages.length}</span><button className="btn ghost sm" onClick={add} data-testid="pdf-add-pages"><Icon name="plus" size={12} /> Add</button></div>
      <div className="pdr-pages-list">
        {pages.map((p, i) => (
          <div
            key={p.key}
            className={`pdr-thumb${current === i ? ' on' : ''}${drag === i ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag !== null) move(drag, i); setDrag(null); }}
            onDragEnd={() => setDrag(null)}
            data-testid={`pdf-thumb-${i}`}
          >
            <button className="pdr-thumb-img" onClick={() => go(i)} aria-label={`Page ${i + 1}`}><Thumb doc={srcs[p.src]?.doc} index={p.index} rotate={p.rotate} /></button>
            <div className="pdr-thumb-bar">
              <span className="small num">{i + 1}</span>
              <button className="pdr-mini" aria-label={`Turn page ${i + 1}`} title="Turn" onClick={() => turn(p.key)}><Icon name="refresh" size={11} /></button>
              <button className="pdr-mini" aria-label={`Remove page ${i + 1}`} title="Remove" onClick={() => remove(p.key)}><Icon name="trash" size={11} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="muted small pdr-pages-foot">Drag to reorder</div>
    </aside>
  );
}

function Thumb({ doc, index, rotate }: { doc?: PdfDoc; index: number; rotate: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(index + 1);
      const rotation = (page.rotate + rotate) % 360;
      const base = page.getViewport({ scale: 1, rotation });
      const scale = 96 / Math.max(base.width, base.height);
      const vp = page.getViewport({ scale: scale * 2, rotation });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      c.style.width = `${vp.width / 2}px`; c.style.height = `${vp.height / 2}px`;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!cancelled) ref.current?.replaceChildren(c);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [doc, index, rotate]);
  return <div ref={ref} className="pdr-thumb-canvas" />;
}

// ---------------------------------------------------------------- signature

/** Draw a signature, or type it; it is placed where you click next. Nothing is kept after. */
function SignatureSheet({ onClose, onDone }: { onClose(): void; onDone(s: { png: string; ratio: number }): void }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const W = 480;
  const H = 160;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (mode === 'type' && typed.trim()) {
      ctx.fillStyle = '#1a1a2e';
      ctx.font = `italic 64px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
      ctx.textBaseline = 'middle';
      ctx.fillText(typed.trim(), 20, H);
    }
    setHasInk(mode === 'type' && !!typed.trim());
  }, [mode, typed]);
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W * 2, ((e.clientY - r.top) / r.height) * H * 2] as [number, number]; };
  const done = useCallback(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return;
    const pad = 8;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
    out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    onDone({ png: out.toDataURL('image/png'), ratio: out.width / out.height });
  }, [onDone]);
  return (
    <Modal title="Your signature" onClose={onClose} width={560} testId="pdf-sign">
      <div className="pdr-signform">
        <div className="seg" role="radiogroup" aria-label="How to sign">
          <button role="radio" aria-checked={mode === 'draw'} className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}>Draw</button>
          <button role="radio" aria-checked={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => setMode('type')}>Type</button>
        </div>
        {mode === 'type' ? <input className="input" autoFocus aria-label="Your name" placeholder="Your name" value={typed} onChange={(e) => setTyped(e.target.value)} /> : null}
        <canvas
          ref={canvas}
          className="pdr-sigpad"
          width={W * 2}
          height={H * 2}
          aria-label="Signature pad"
          data-testid="pdf-sigpad"
          onPointerDown={(e) => { if (mode !== 'draw') return; e.currentTarget.setPointerCapture(e.pointerId); last.current = pos(e); }}
          onPointerMove={(e) => {
            if (!last.current || mode !== 'draw') return;
            const ctx = canvas.current!.getContext('2d')!;
            const pt = pos(e);
            ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(...last.current); ctx.lineTo(...pt); ctx.stroke();
            last.current = pt;
            setHasInk(true);
          }}
          onPointerUp={() => { last.current = null; }}
        />
        <div className="btn-row pdr-sign-actions">
          <span className="muted small">Placed where you click next · not kept by Keeper</span>
          <button className="btn ghost" onClick={() => { const c = canvas.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setHasInk(false); setTyped(''); }}>Clear</button>
          <button className="btn primary" data-testid="pdf-sign-use" disabled={!hasInk} onClick={done}>Use signature</button>
        </div>
      </div>
    </Modal>
  );
}

