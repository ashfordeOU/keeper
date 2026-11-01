// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Look: press Space on any file for a full-window preview. Arrow keys
// move through the list, files inside archives open in place, two files can
// be compared side by side, and images can play as a slideshow.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes, formatDate } from '../../core/format';
import type { PreviewInfo } from '../../core/previewTypes';
import { api, isDemo } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';
import { FilePreview, usePreviewInfo } from './Preview';
import { getThumb } from './thumbs';
import { fileUrl } from './util';
import { Histogram } from './viewers/images';
import { MapButtons } from '../components/NativeOpen';

export interface QuickLookItem {
  path: string;
  name: string;
}

type Listener = (s: { items: QuickLookItem[]; index: number } | null) => void;
const listeners = new Set<Listener>();
let current: { items: QuickLookItem[]; index: number } | null = null;

/** Opens the full-window viewer on `items[index]`. */
export function openQuickLook(items: QuickLookItem[], index = 0) {
  if (!items.length) return;
  current = { items, index: Math.max(0, Math.min(index, items.length - 1)) };
  listeners.forEach((l) => l(current));
}

export function closeQuickLook() {
  current = null;
  listeners.forEach((l) => l(null));
}

export function isQuickLookOpen() {
  return current !== null;
}

export function QuickLookHost() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, []);
  if (!state) return null;
  return createPortal(<QuickLook items={state.items} start={state.index} />, document.body);
}

const SLIDE_MS = 4000;

function QuickLook({ items: initial, start }: { items: QuickLookItem[]; start: number }) {
  const store = useStore();
  const [items, setItems] = useState(initial);
  const [index, setIndex] = useState(start);
  const [nested, setNested] = useState<string[]>([]);
  const [panel, setPanel] = useState(false);
  const [compare, setCompare] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setItems(initial), [initial]);
  useEffect(() => { setIndex(start); setNested([]); }, [start, initial]);

  const item = items[index];
  const path = nested.length ? nested[nested.length - 1] : item?.path;
  const { info } = usePreviewInfo(path ?? null);

  const go = useCallback((d: number) => {
    setNested([]);
    setIndex((i) => (items.length ? (i + d + items.length) % items.length : 0));
  }, [items.length]);

  useEffect(() => {
    if (!slideshow) return;
    const t = setInterval(() => go(1), SLIDE_MS);
    return () => clearInterval(t);
  }, [slideshow, go]);

  const flash = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(null), 1800);
  };

  const copyText = async () => {
    if (!path) return;
    const known = await api.library.inspect(path).catch(() => null);
    let text = known?.text ?? '';
    if (!text && info && ['code', 'text', 'markdown', 'json', 'xml', 'html', 'log', 'subtitle'].includes(info.kind)) text = (await api.preview.text(path)).text;
    if (!text && info && ['image', 'heic', 'raw', 'tiff'].includes(info.kind)) text = (await api.library.readText([path]))[0]?.text ?? '';
    if (text) {
      await api.files.copyText(text);
      flash('Text copied');
    } else flash('No text found');
  };

  const trash = async () => {
    if (!item || nested.length) return;
    const r = await store.trash([item.path]);
    if (r.removed) {
      const next = items.filter((_, i) => i !== index);
      if (!next.length) return closeQuickLook();
      setItems(next);
      setIndex((i) => Math.min(i, next.length - 1));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      const cmd = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' || (e.key === ' ' && !cmd && !(t.tagName === 'VIDEO' || t.tagName === 'AUDIO'))) {
        e.preventDefault();
        if (nested.length && e.key === 'Escape') setNested((n) => n.slice(0, -1));
        else if (document.fullscreenElement) void document.exitFullscreen();
        else closeQuickLook();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && !cmd) {
        if (items.length > 1 && !['video', 'audio', 'pdf', 'sheet'].includes(info?.kind ?? '')) { e.preventDefault(); go(1); }
        else if (e.key === 'ArrowRight' && e.altKey) go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' && !cmd) {
        if (items.length > 1 && !['video', 'audio', 'pdf', 'sheet'].includes(info?.kind ?? '')) { e.preventDefault(); go(-1); }
      } else if (e.key === ']' || (e.key === 'ArrowRight' && cmd)) go(1);
      else if (e.key === '[' || (e.key === 'ArrowLeft' && cmd)) go(-1);
      else if (e.key.toLowerCase() === 'i' && !cmd) setPanel((p) => !p);
      else if (e.key.toLowerCase() === 'f' && !cmd) void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen());
      else if (cmd && e.key === 'Backspace') void trash();
      else if (cmd && e.shiftKey && e.key.toLowerCase() === 'c') void copyText();
      else if (cmd && e.key === 'Enter') void api.files.open(path!);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!item) return null;
  const other = compare && items.length > 1 ? items[(index + 1) % items.length] : null;
  return (
    <div className="ql" ref={root} role="dialog" aria-label={`Quick Look: ${item.name}`} onMouseDown={(e) => { if (e.target === e.currentTarget) closeQuickLook(); }}>
      <div className="ql-window">
        <header className="ql-head">
          <button className="pv-btn" onClick={closeQuickLook} title="Close (Esc)"><Icon name="close" size={15} /></button>
          {nested.length ? <button className="pv-btn" onClick={() => setNested((n) => n.slice(0, -1))} title="Back to the archive"><Icon name="chevronLeft" size={14} /> Back</button> : null}
          <div className="ql-title">
            <span className="ellipsis">{info?.name ?? item.name}</span>
            <span className="small muted">{info ? `${info.format}${info.size && !info.isDir ? ` · ${formatBytes(info.size)}` : ''}` : ''}{items.length > 1 ? ` · ${index + 1} of ${items.length}` : ''}</span>
          </div>
          <div className="ql-actions">
            {items.length > 1 ? (
              <>
                <button className="pv-btn" onClick={() => go(-1)} title="Previous ([)"><Icon name="chevronLeft" size={15} /></button>
                <button className="pv-btn" onClick={() => go(1)} title="Next (])"><Icon name="chevronRight" size={15} /></button>
                <button className={`pv-btn ${slideshow ? 'on' : ''}`} onClick={() => setSlideshow((s) => !s)} title="Slideshow"><Icon name={slideshow ? 'pause' : 'play'} size={14} /></button>
                <button className={`pv-btn ${compare ? 'on' : ''}`} onClick={() => setCompare((c) => !c)} title="Compare with the next file"><Icon name="dupes" size={14} /></button>
              </>
            ) : null}
            <span className="pv-sep" />
            <button className="pv-btn" onClick={() => void copyText()} title="Copy text (Ctrl/⌘ Shift C)"><Icon name="text" size={14} /></button>
            <button className="pv-btn" onClick={() => path && void api.files.open(path)} title="Open"><Icon name="external" size={14} /></button>
            <button className="pv-btn" onClick={() => path && void api.files.reveal(path)} title="Show in folder"><Icon name="reveal" size={14} /></button>
            {!nested.length ? <button className="pv-btn danger" onClick={() => void trash()} title="Move to Trash (Ctrl/⌘ ⌫)"><Icon name="trash" size={14} /></button> : null}
            <span className="pv-sep" />
            <button className={`pv-btn ${panel ? 'on' : ''}`} onClick={() => setPanel((p) => !p)} title="Details (I)"><Icon name="info" size={14} /></button>
            <button className="pv-btn" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())} title="Full screen (F)"><Icon name="arrowUp" size={14} /></button>
          </div>
        </header>
        <div className="ql-body">
          <div className={`ql-stage ${other ? 'compare' : ''}`}>
            <div className="ql-pane"><FilePreview key={path} path={path!} mode="full" openNested={(p) => setNested((n) => [...n, p])} /></div>
            {other ? <div className="ql-pane"><div className="ql-pane-name small muted">{other.name}</div><FilePreview key={other.path} path={other.path} mode="full" /></div> : null}
          </div>
          {panel && info ? <InfoPanel info={info} /> : null}
        </div>
        {items.length > 1 && items.length <= 400 ? <Filmstrip items={items} index={index} onPick={(i) => { setNested([]); setIndex(i); }} /> : null}
        {toast ? <div className="ql-toast">{toast}</div> : null}
      </div>
    </div>
  );
}

function Filmstrip({ items, index, onPick }: { items: QuickLookItem[]; index: number; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [index]);
  return (
    <div className="ql-strip" ref={ref}>
      {items.map((it, i) => <StripThumb key={it.path} item={it} on={i === index} onClick={() => onPick(i)} />)}
    </div>
  );
}

function StripThumb({ item, on, onClick }: { item: QuickLookItem; on: boolean; onClick: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        void getThumb(item.path, 96).then(setSrc).catch(() => undefined);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [item.path]);
  return (
    <button ref={ref} className={on ? 'on' : ''} onClick={onClick} title={item.name}>
      {src ? <img src={src} alt="" /> : <span>{(item.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>}
    </button>
  );
}

function InfoPanel({ info }: { info: PreviewInfo }) {
  const ex = info.exif;
  const rows: [string, string | undefined][] = [
    ['Kind', info.format],
    ['Size', info.isDir ? undefined : `${formatBytes(info.size)} (${info.size.toLocaleString()} bytes)`],
    ['Created', formatDate(info.btime)],
    ['Modified', `${formatDate(info.mtime)} ${new Date(info.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`],
    ['Where', info.path.slice(0, info.path.length - info.name.length - 1)],
  ];
  const photo: [string, string | undefined][] = ex ? [
    ['Camera', [ex.make, ex.model].filter(Boolean).join(' ').replace(/^(\w+) \1/i, '$1') || undefined],
    ['Lens', ex.lens],
    ['Exposure', [ex.exposure, ex.fNumber ? `f/${ex.fNumber}` : '', ex.iso ? `ISO ${ex.iso}` : ''].filter(Boolean).join(' · ') || undefined],
    ['Focal length', ex.focalLength ? `${ex.focalLength} mm${ex.focal35 ? ` (${ex.focal35} mm equiv.)` : ''}` : undefined],
    ['Taken', ex.taken?.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')],
    ['Pixels', ex.width && ex.height ? `${ex.width} × ${ex.height}` : undefined],
    ['Flash', ex.flash === undefined ? undefined : ex.flash ? 'Fired' : 'Off'],
    ['Software', ex.software],
  ] : [];
  const audio: [string, string | undefined][] = info.audio ? [['Title', info.audio.title], ['Artist', info.audio.artist], ['Album', info.audio.album], ['Year', info.audio.year], ['Genre', info.audio.genre], ['Track', info.audio.track]] : [];
  const app = Object.entries(info.app ?? {});
  const showHistogram = !isDemo && ['image'].includes(info.kind);
  return (
    <aside className="ql-panel">
      <Section rows={rows} />
      {photo.some(([, v]) => v) ? <><div className="ql-panel-title">Photo</div><Section rows={photo} /></> : null}
      {ex?.gps ? (
        <div className="ql-gps">
          <div className="ql-panel-title">Location</div>
          <div className="small mono">{ex.gps.lat.toFixed(5)}, {ex.gps.lon.toFixed(5)}{ex.gps.alt ? ` · ${Math.round(ex.gps.alt)} m` : ''}</div>
          <MapButtons place={{ lat: ex.gps.lat, lon: ex.gps.lon }} />
        </div>
      ) : null}
      {showHistogram ? <><div className="ql-panel-title">Histogram</div><Histogram src={fileUrl(info.path)} /></> : null}
      {audio.some(([, v]) => v) ? <><div className="ql-panel-title">Song</div><Section rows={audio} /></> : null}
      {app.length ? <><div className="ql-panel-title">Application</div><Section rows={app} /></> : null}
    </aside>
  );
}

function Section({ rows }: { rows: [string, string | undefined][] }) {
  return (
    <dl className="kv">
      {rows.filter(([, v]) => v).map(([k, v]) => <FragmentKV key={k} k={k} v={v!} />)}
    </dl>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
