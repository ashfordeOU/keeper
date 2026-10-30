// SPDX-License-Identifier: AGPL-3.0-or-later
// Documents: PDF (pages, thumbnails, search, selectable text), Word, every
// spreadsheet format, PowerPoint slides laid out as designed, OpenDocument,
// RTF, Apple iWork and legacy Office files.

import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rtfToText } from '../../../core/docparse';
import { api, isDemo } from '../../api';
import { Bar, BarButton, Loaded, PreviewMessage, useLoad, type ViewerProps } from '../Preview';
import { openPdf, pdfjs, renderPage, type PdfDoc } from '../pdf';
import { fetchBytes, fileUrl, onLinkClick, sanitize } from '../util';
import { ImageStage } from './images';

// ------------------------------------------------------------------ PDF

export function PdfViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => openPdf(await fetchBytes(info.path, 1024 * 1024 * 1024)), [info.path]);
  useEffect(() => () => { void state.data?.destroy(); }, [state.data]);
  return <Loaded state={state} label="Opening PDF…">{(doc) => <PdfDocument doc={doc} mode={mode} name={info.name} />}</Loaded>;
}

export function PdfDocument({ doc, mode, name }: { doc: PdfDoc; mode: ViewerProps['mode']; name: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [thumbs, setThumbs] = useState(mode === 'full' && doc.numPages > 1);
  const [current, setCurrent] = useState(1);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ page: number; snippet: string }[] | null>(null);
  const texts = useRef(new Map<number, string>());
  const [ratio, setRatio] = useState(1.294);
  const full = mode === 'full';

  useEffect(() => {
    void doc.getPage(1).then((p) => { const v = p.getViewport({ scale: 1 }); setRatio(v.height / v.width); });
  }, [doc]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageWidth = zoom === 'fit' ? Math.max(200, Math.min(width - 32, full ? 1100 : width - 16)) : Math.round(612 * zoom);
  const pages = full ? doc.numPages : Math.min(doc.numPages, 1);

  const go = (n: number) => {
    scroller.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const search = async () => {
    const q = query.trim().toLowerCase();
    if (!q) return setResults(null);
    const out: { page: number; snippet: string }[] = [];
    for (let i = 1; i <= doc.numPages && out.length < 200; i++) {
      let t = texts.current.get(i);
      if (t === undefined) {
        const tc = await (await doc.getPage(i)).getTextContent();
        t = tc.items.map((x) => ('str' in x ? x.str : '')).join(' ');
        texts.current.set(i, t);
      }
      const at = t.toLowerCase().indexOf(q);
      if (at >= 0) out.push({ page: i, snippet: t.slice(Math.max(0, at - 40), at + q.length + 60) });
    }
    setResults(out);
    if (out[0]) go(out[0].page);
  };

  return (
    <div className="pv-col">
      {full ? (
        <Bar>
          <BarButton icon="grid" label="Page thumbnails" on={thumbs} onClick={() => setThumbs((t) => !t)} />
          <span className="small num">Page {current} of {doc.numPages}</span>
          <span className="pv-sep" />
          <BarButton icon="minus" label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, (z === 'fit' ? pageWidth / 612 : z) / 1.2))} />
          <button className={`pv-btn ${zoom === 'fit' ? 'on' : ''}`} onClick={() => setZoom('fit')}>Fit width</button>
          <BarButton icon="plus" label="Zoom in" onClick={() => setZoom((z) => Math.min(5, (z === 'fit' ? pageWidth / 612 : z) * 1.2))} />
          <span className="pv-sep" />
          <form className="pv-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input className="input pv-filter" placeholder="Find in document" value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
          {results ? <span className="small muted">{results.length ? `Found on ${results.length} page${results.length === 1 ? '' : 's'}` : 'Not found'}</span> : null}
        </Bar>
      ) : null}
      <div className="pv-split">
        {thumbs ? (
          <aside className="pv-side pv-pdf-thumbs">
            {Array.from({ length: Math.min(doc.numPages, 500) }, (_, i) => (
              <button key={i} className={current === i + 1 ? 'on' : ''} onClick={() => go(i + 1)}>
                <LazyPage doc={doc} n={i + 1} width={110} ratio={ratio} textLayer={false} />
                <span className="small num">{i + 1}</span>
              </button>
            ))}
          </aside>
        ) : null}
        {results && results.length && full ? (
          <aside className="pv-side pv-results">
            {results.map((r) => (
              <button key={r.page} onClick={() => go(r.page)}>
                <span className="small muted">Page {r.page}</span>
                <span className="small">{r.snippet}</span>
              </button>
            ))}
          </aside>
        ) : null}
        <div
          ref={scroller}
          className="pv-pdf"
          onScroll={(e) => {
            const el = e.currentTarget;
            const kids = el.querySelectorAll<HTMLElement>('[data-page]');
            for (const k of kids) if (k.offsetTop + k.offsetHeight / 2 > el.scrollTop) { setCurrent(Number(k.dataset.page)); break; }
          }}
        >
          {width ? Array.from({ length: pages }, (_, i) => (
            <div key={i} data-page={i + 1} className="pv-pdf-page">
              <LazyPage doc={doc} n={i + 1} width={pageWidth} ratio={ratio} textLayer={full} highlight={query.trim()} />
            </div>
          )) : null}
          {!full && doc.numPages > 1 ? <div className="small muted pv-pdf-more">{doc.numPages} pages · press Space to read</div> : null}
        </div>
      </div>
      <span hidden>{name}</span>
    </div>
  );
}

function LazyPage({ doc, n, width, ratio, textLayer, highlight }: { doc: PdfDoc; n: number; width: number; ratio: number; textLayer: boolean; highlight?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(Math.round(width * ratio));
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setVisible(true)), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(n);
      if (cancelled || !box.current) return;
      const canvas = await renderPage(page, width);
      if (cancelled || !box.current) return;
      setHeight(parseFloat(canvas.style.height));
      box.current.replaceChildren(canvas);
      if (textLayer) {
        const div = document.createElement('div');
        div.className = 'textLayer';
        const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        div.style.setProperty('--scale-factor', String(vp.scale));
        box.current.appendChild(div);
        await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: div, viewport: vp }).render();
        if (highlight) div.querySelectorAll('span').forEach((s) => s.textContent?.toLowerCase().includes(highlight.toLowerCase()) && s.classList.add('hit'));
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [visible, doc, n, width, textLayer, highlight]);
  return <div ref={box} className="pv-pdf-canvas" style={{ width, height }} />;
}

// ------------------------------------------------------------------ Word

export function DocxViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => {
    const mammoth = (await import('mammoth')).default;
    const r = await mammoth.convertToHtml({ arrayBuffer: await fetchBytes(info.path, 200 * 1024 * 1024) });
    return sanitize(r.value);
  }, [info.path]);
  return (
    <Loaded state={state} label="Reading document…">
      {(d) => (
        <div className="pv-col">
          {mode === 'full' && d.blockedRemote ? <Bar><span className="small muted">{d.blockedRemote} linked image(s) hidden</span></Bar> : null}
          <div className="pv-paper-wrap"><article className="pv-doc pv-paper" onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: d.html || '<p class="muted">This document has no text.</p>' }} /></div>
        </div>
      )}
    </Loaded>
  );
}

// ------------------------------------------------------------------ spreadsheets

interface Sheet {
  name: string;
  rows: string[][];
  cols: number;
}

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function SheetViewer({ info, mode }: ViewerProps) {
  const [active, setActive] = useState(0);
  const state = useLoad(async (): Promise<Sheet[]> => {
    if (info.ext === 'csv' || info.ext === 'tsv' || isDemo) {
      const t = await api.preview.text(info.path, 30 * 1024 * 1024);
      const sep = info.ext === 'tsv' ? '\t' : (t.text.split('\n')[0].match(/;/g)?.length ?? 0) > (t.text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
      const rows = parseDelimited(t.text, sep);
      return [{ name: info.name, rows, cols: Math.max(0, ...rows.slice(0, 2000).map((r) => r.length)) }];
    }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(await fetchBytes(info.path, 200 * 1024 * 1024)), { type: 'array', cellDates: true, dense: true });
    return wb.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true }) as string[][];
      return { name, rows, cols: Math.min(500, Math.max(0, ...rows.slice(0, 5000).map((r) => r.length))) };
    });
  }, [info.path]);
  return (
    <Loaded state={state} label="Reading spreadsheet…">
      {(sheets) => {
        const sheet = sheets[Math.min(active, sheets.length - 1)];
        return (
          <div className="pv-col">
            {mode === 'full' ? <Bar><span className="small muted num">{sheet.rows.length.toLocaleString()} rows × {sheet.cols} columns</span></Bar> : null}
            <Grid sheet={sheet} inline={mode === 'inline'} />
            {sheets.length > 1 ? (
              <div className="pv-tabs">
                {sheets.map((s, i) => <button key={s.name + i} className={i === active ? 'on' : ''} onClick={() => setActive(i)}>{s.name}</button>)}
              </div>
            ) : null}
          </div>
        );
      }}
    </Loaded>
  );
}

const ROW_H = 26;

/** A virtualised grid with frozen column letters and row numbers. */
function Grid({ sheet, inline }: { sheet: Sheet; inline: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setH(el.clientHeight);
    el.scrollTop = 0;
    setTop(0);
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);
  const rows = inline ? sheet.rows.slice(0, 40) : sheet.rows;
  const first = Math.max(0, Math.floor(top / ROW_H) - 10);
  const last = Math.min(rows.length, first + Math.ceil(h / ROW_H) + 30);
  const widths = useMemo(() => Array.from({ length: sheet.cols }, (_, c) => {
    let w = 4;
    for (let r = 0; r < Math.min(rows.length, 200); r++) w = Math.max(w, String(rows[r][c] ?? '').length);
    return Math.min(320, Math.max(64, w * 7.5 + 18));
  }), [sheet, rows]);
  const total = widths.reduce((a, b) => a + b, 0) + 52;
  return (
    <div ref={ref} className="pv-grid" onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ width: total, height: (rows.length + 1) * ROW_H, position: 'relative' }}>
        <div className="g-head" style={{ width: total }}>
          <span className="g-corner" />
          {widths.map((w, c) => <span key={c} style={{ width: w }}>{colName(c)}</span>)}
        </div>
        {rows.slice(first, last).map((r, i) => (
          <div key={first + i} className="g-row" style={{ top: (first + i + 1) * ROW_H, width: total }}>
            <span className="g-num">{first + i + 1}</span>
            {widths.map((w, c) => {
              const v = r[c] ?? '';
              return <span key={c} style={{ width: w }} className={/^-?[\d.,]+%?$/.test(v) ? 'n' : ''} title={v.length > 30 ? v : undefined}>{v}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ PowerPoint

interface SlideItem {
  kind: 'text' | 'image';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  paragraphs?: { text: string; size?: number; bold?: boolean; level: number; align?: string; color?: string }[];
  src?: string;
  title?: boolean;
}

const EMU = 914400;

function byLocal(el: Element | Document, name: string): Element[] {
  return [...el.getElementsByTagName('*')].filter((e) => e.localName === name);
}

function childByLocal(el: Element, name: string): Element | undefined {
  return [...el.children].find((e) => e.localName === name);
}

export function PptxViewer({ info, mode }: ViewerProps) {
  const [index, setIndex] = useState(0);
  const state = useLoad(async () => {
    const zip = await JSZip.loadAsync(await fetchBytes(info.path, 400 * 1024 * 1024));
    const pres = new DOMParser().parseFromString((await zip.file('ppt/presentation.xml')?.async('string')) ?? '<p/>', 'application/xml');
    const sz = byLocal(pres, 'sldSz')[0];
    const cx = Number(sz?.getAttribute('cx') ?? 12192000);
    const cy = Number(sz?.getAttribute('cy') ?? 6858000);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
    const slides: { items: SlideItem[]; notes?: string }[] = [];
    for (const n of names.slice(0, mode === 'full' ? 500 : 1)) {
      const xml = new DOMParser().parseFromString(await zip.file(n)!.async('string'), 'application/xml');
      const relsXml = await zip.file(n.replace('slides/', 'slides/_rels/') + '.rels')?.async('string');
      const rels = new Map<string, string>();
      if (relsXml) for (const r of byLocal(new DOMParser().parseFromString(relsXml, 'application/xml'), 'Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
      const items: SlideItem[] = [];
      const pos = (el: Element) => {
        const xfrm = byLocal(el, 'xfrm')[0];
        const off = xfrm && childByLocal(xfrm, 'off');
        const ext = xfrm && childByLocal(xfrm, 'ext');
        return off && ext ? { x: +off.getAttribute('x')! / cx, y: +off.getAttribute('y')! / cy, w: +ext.getAttribute('cx')! / cx, h: +ext.getAttribute('cy')! / cy } : {};
      };
      for (const sp of byLocal(xml, 'sp')) {
        const ph = byLocal(sp, 'ph')[0]?.getAttribute('type') ?? '';
        const paragraphs = byLocal(sp, 'p').map((p) => {
          const runs = byLocal(p, 'r');
          const rPr = runs[0] && byLocal(runs[0], 'rPr')[0];
          const pPr = childByLocal(p, 'pPr');
          const color = runs[0] && byLocal(runs[0], 'srgbClr')[0]?.getAttribute('val');
          return { text: byLocal(p, 't').map((t) => t.textContent).join(''), size: rPr?.getAttribute('sz') ? +rPr.getAttribute('sz')! / 100 : undefined, bold: rPr?.getAttribute('b') === '1', level: +(pPr?.getAttribute('lvl') ?? 0), align: pPr?.getAttribute('algn') ?? undefined, color: color ? `#${color}` : undefined };
        }).filter((p) => p.text.trim());
        if (paragraphs.length) items.push({ kind: 'text', paragraphs, title: /title/i.test(ph), ...pos(sp) });
      }
      for (const pic of byLocal(xml, 'pic')) {
        const id = byLocal(pic, 'blip')[0]?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ?? byLocal(pic, 'blip')[0]?.getAttribute('r:embed');
        const target = id && rels.get(id);
        if (!target) continue;
        const path = new URL(target, `https://x/${n}`).pathname.slice(1);
        const f = zip.file(path);
        if (!f || /\.(emf|wmf|tiff?)$/i.test(path)) continue;
        const blob = await f.async('blob');
        items.push({ kind: 'image', src: URL.createObjectURL(new Blob([blob], { type: /\.png$/i.test(path) ? 'image/png' : /\.svg$/i.test(path) ? 'image/svg+xml' : /\.gif$/i.test(path) ? 'image/gif' : 'image/jpeg' })), ...pos(pic) });
      }
      const notesName = [...rels.values()].find((t) => /notesSlide/.test(t));
      let notes: string | undefined;
      if (notesName) {
        const nx = await zip.file(new URL(notesName, `https://x/${n}`).pathname.slice(1))?.async('string');
        if (nx) notes = byLocal(new DOMParser().parseFromString(nx, 'application/xml'), 'p').map((p) => byLocal(p, 't').map((t) => t.textContent).join('')).filter((t) => t.trim() && !/^\d+$/.test(t.trim())).join('\n');
      }
      slides.push({ items, notes });
    }
    return { slides, ratio: cy / cx, total: names.length };
  }, [info.path, mode]);
  return (
    <Loaded state={state} label="Reading slides…">
      {(d) => {
        if (!d.slides.length) return <PreviewMessage icon="document" title="No slides found" />;
        if (mode === 'inline') return <div className="pv-slides inline"><Slide slide={d.slides[0]} ratio={d.ratio} /><div className="small muted">{d.total} slide{d.total === 1 ? '' : 's'}</div></div>;
        const s = d.slides[Math.min(index, d.slides.length - 1)];
        return (
          <div className="pv-col">
            <Bar>
              <BarButton icon="chevronLeft" label="Previous slide" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} />
              <span className="small num">Slide {index + 1} of {d.slides.length}</span>
              <BarButton icon="chevronRight" label="Next slide" onClick={() => setIndex((i) => Math.min(d.slides.length - 1, i + 1))} disabled={index >= d.slides.length - 1} />
            </Bar>
            <div className="pv-split">
              <aside className="pv-side pv-slide-list">
                {d.slides.map((sl, i) => <button key={i} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}><Slide slide={sl} ratio={d.ratio} small /><span className="small num">{i + 1}</span></button>)}
              </aside>
              <div className="pv-slides">
                <Slide slide={s} ratio={d.ratio} />
                {s.notes ? <div className="pv-notes"><div className="small muted">Speaker notes</div>{s.notes}</div> : null}
              </div>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

function Slide({ slide, ratio, small }: { slide: { items: SlideItem[] }; ratio: number; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Points to pixels: a 10-inch-wide slide is 720pt.
  const pt = w / 720 / (ratio > 0.7 ? 1 : 1.333);
  const flow = slide.items.filter((it) => it.x === undefined);
  return (
    <div ref={ref} className={`pv-slide ${small ? 'small' : ''}`} style={{ aspectRatio: `${1 / ratio}` }}>
      {slide.items.filter((it) => it.x !== undefined).map((it, i) => (
        <div key={i} className={`sl-item ${it.kind}`} style={{ left: `${it.x! * 100}%`, top: `${it.y! * 100}%`, width: `${it.w! * 100}%`, height: `${it.h! * 100}%` }}>
          {it.kind === 'image' ? <img src={it.src} alt="" /> : it.paragraphs!.map((p, j) => (
            <p key={j} style={{ fontSize: Math.max(4, (p.size ?? (it.title ? 36 : 18)) * pt), fontWeight: p.bold || it.title ? 700 : 400, paddingLeft: p.level * 18 * pt, textAlign: p.align === 'ctr' ? 'center' : p.align === 'r' ? 'right' : 'left', color: p.color }}>{p.text}</p>
          ))}
        </div>
      ))}
      {flow.length ? (
        <div className="sl-flow" style={{ fontSize: 16 * pt * 1.3 }}>
          {flow.map((it, i) => it.kind === 'image' ? <img key={i} src={it.src} alt="" /> : it.paragraphs!.map((p, j) => <p key={`${i}-${j}`} className={it.title ? 'sl-title' : ''} style={{ paddingLeft: p.level * 18 * pt }}>{p.text}</p>))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ OpenDocument

export function OdfViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => {
    const zip = await JSZip.loadAsync(await fetchBytes(info.path, 200 * 1024 * 1024));
    const xml = new DOMParser().parseFromString((await zip.file('content.xml')?.async('string')) ?? '<x/>', 'application/xml');
    const images = new Map<string, string>();
    for (const n of Object.keys(zip.files).filter((n) => /^Pictures\/.+\.(png|jpe?g|gif|svg)$/i.test(n))) {
      images.set(n, URL.createObjectURL(await zip.file(n)!.async('blob')));
    }
    const out: string[] = [];
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const walk = (el: Element) => {
      for (const c of [...el.children]) {
        if (c.localName === 'h') out.push(`<h${Math.min(6, +(c.getAttribute('text:outline-level') ?? 2))}>${esc(c.textContent ?? '')}</h${Math.min(6, +(c.getAttribute('text:outline-level') ?? 2))}>`);
        else if (c.localName === 'p') out.push(`<p>${esc(c.textContent ?? '') || '&nbsp;'}</p>`);
        else if (c.localName === 'page') { out.push(`<hr><div class="odp-page">`); walk(c); out.push('</div>'); }
        else if (c.localName === 'image') { const src = images.get(c.getAttribute('xlink:href') ?? ''); if (src) out.push(`<img src="${src}">`); }
        else if (c.localName === 'table') {
          out.push('<table>');
          for (const row of byLocal(c, 'table-row').slice(0, 2000)) out.push(`<tr>${byLocal(row, 'table-cell').map((cell) => `<td>${esc(cell.textContent ?? '')}</td>`).join('')}</tr>`);
          out.push('</table>');
        } else walk(c);
      }
    };
    walk(xml.documentElement);
    return out.join('');
  }, [info.path]);
  return <Loaded state={state} label="Reading document…">{(html) => <div className="pv-paper-wrap"><article className={`pv-doc pv-paper ${mode}`} dangerouslySetInnerHTML={{ __html: sanitize(html).html }} /></div>}</Loaded>;
}

// ------------------------------------------------------------------ RTF, iWork, legacy Office

export function RtfViewer({ info }: ViewerProps) {
  const state = useLoad(async () => rtfToText((await api.preview.text(info.path, 20 * 1024 * 1024)).text), [info.path]);
  return <Loaded state={state}>{(t) => <div className="pv-paper-wrap"><article className="pv-doc pv-paper pre">{t}</article></div>}</Loaded>;
}

/** Pages, Keynote and Numbers files keep a preview picture or PDF inside. */
export function IWorkViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async (): Promise<{ pdf?: PdfDoc; image?: string }> => {
    if (isDemo) throw new Error('Available in the desktop app.');
    if (info.isDir) {
      const base = info.path;
      for (const rel of ['QuickLook/Preview.pdf', 'QuickLook/Thumbnail.jpg', 'preview.jpg', 'QuickLook/Thumbnail.png']) {
        const p = `${base}/${rel}`;
        const res = await fetch(fileUrl(p)).catch(() => null);
        if (res?.ok) return rel.endsWith('.pdf') ? { pdf: await openPdf(await res.arrayBuffer()) } : { image: fileUrl(p) };
      }
      throw new Error('This document has no preview inside.');
    }
    const zip = await JSZip.loadAsync(await fetchBytes(info.path, 500 * 1024 * 1024));
    const pdf = zip.file(/^QuickLook\/Preview\.pdf$/i)[0];
    if (pdf) return { pdf: await openPdf(await pdf.async('uint8array')) };
    const img = zip.file(/^(preview\.jpg|QuickLook\/Preview\.(jpe?g|png)|preview-web\.jpg|QuickLook\/Thumbnail\.(jpe?g|png))$/i).sort((a, b) => (/^preview\.jpg$/i.test(a.name) ? -1 : 1) - (/^preview\.jpg$/i.test(b.name) ? -1 : 1))[0];
    if (img) return { image: URL.createObjectURL(await img.async('blob')) };
    throw new Error('This document has no preview inside.');
  }, [info.path]);
  return (
    <Loaded state={state} label="Opening…">
      {(d) => (d.pdf ? <PdfDocument doc={d.pdf} mode={mode} name={info.name} /> : <ImageStage src={d.image!} mode={mode} note={mode === 'full' ? 'The first page, as saved inside the document.' : undefined} />)}
    </Loaded>
  );
}

/** Old .doc/.ppt: the text inside, plus the system's own rendering where available. */
export function LegacyOfficeViewer({ info, mode }: ViewerProps) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => void api.files.thumbnail(info.path, 1200).then(setThumb).catch(() => undefined), [info.path]);
  const state = useLoad(async () => {
    const b = new Uint8Array(await fetchBytes(info.path, 100 * 1024 * 1024));
    const pieces: string[] = [];
    // UTF-16 runs
    let run = '';
    for (let i = 0; i + 1 < b.length; i += 2) {
      const c = b[i] | (b[i + 1] << 8);
      if ((c >= 32 && c < 0xd800 && c !== 0xfffd) || c === 13 || c === 10 || c === 9) run += String.fromCharCode(c === 13 ? 10 : c);
      else { if (run.replace(/\s/g, '').length >= 6) pieces.push(run); run = ''; }
    }
    if (run.replace(/\s/g, '').length >= 6) pieces.push(run);
    let text = pieces.filter((p) => /[a-z]{3}/i.test(p)).join('\n');
    if (text.length < 40) {
      // Older files store 8-bit text.
      text = (new TextDecoder('windows-1252').decode(b).match(/[\x20-\x7e -ÿ\r\n\t]{6,}/g) ?? []).filter((s) => /[a-z]{3}/i.test(s) && !/^[\w.]+$/.test(s)).join('\n');
    }
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }, [info.path]);
  return (
    <Loaded state={state} label="Reading…">
      {(t) => (
        <div className="pv-col">
          {mode === 'full' ? <Bar><span className="small muted">Older Office format — showing the text it contains{thumb ? ' and the first page' : ''}.</span></Bar> : null}
          {thumb ? <div className="pv-legacy-thumb"><img src={thumb} alt="" /></div> : null}
          <div className="pv-paper-wrap"><article className="pv-doc pv-paper pre">{t || 'No readable text found.'}</article></div>
        </div>
      )}
    </Loaded>
  );
}

