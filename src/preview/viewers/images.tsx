// SPDX-License-Identifier: AGPL-3.0-or-later
// Image viewers: zoom, pan, rotate, flip, a colour picker under the pointer and
// a histogram — for everyday images, SVG, TIFF (every page), Photoshop files,
// and anything the main process has to decode first (HEIC, RAW, JPEG XL, …).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isDemo } from '../../api';
import { Bar, BarButton, Loaded, PreviewMessage, useLoad, type ViewerProps } from '../Preview';
import { fetchBytes, fileUrl } from '../util';
import { CodeBlock } from './text';

// ------------------------------------------------------------------ stage

interface StageProps {
  src: string;
  alt?: string;
  mode: ViewerProps['mode'];
  /** extra controls on the bar */
  extra?: React.ReactNode;
  note?: string;
  pixelated?: boolean;
  /** show a checkerboard behind it (formats that can be see-through) */
  transparent?: boolean;
  onSize?: (w: number, h: number) => void;
}

/** The zoomable, pannable canvas every image viewer shares. */
export function ImageStage({ src, alt = '', mode, extra, note, pixelated, transparent = true, onSize }: StageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState({ h: false, v: false });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [pick, setPick] = useState<{ x: number; y: number; hex: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const sampler = useRef<CanvasRenderingContext2D | null>(null);
  const full = mode === 'full';

  useEffect(() => {
    setZoom('fit');
    setPan({ x: 0, y: 0 });
    setRot(0);
    setFlip({ h: false, v: false });
    setError(false);
    sampler.current = null;
  }, [src]);

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el || !nat.w) return;
    const sideways = rot % 180 !== 0;
    const w = sideways ? nat.h : nat.w;
    const h = sideways ? nat.w : nat.h;
    setFitScale(Math.min(1, (el.clientWidth - 16) / w, (el.clientHeight - 16) / h));
  }, [nat, rot]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  const setScale = (s: number, around?: { x: number; y: number }) => {
    const next = Math.max(0.02, Math.min(32, s));
    if (around && wrap.current) {
      const r = wrap.current.getBoundingClientRect();
      const cx = around.x - r.left - r.width / 2 - pan.x;
      const cy = around.y - r.top - r.height / 2 - pan.y;
      const k = next / scale;
      setPan({ x: pan.x - cx * (k - 1), y: pan.y - cy * (k - 1) });
    }
    setZoom(next);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!full && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setScale(scale * Math.exp(-e.deltaY * 0.0022), { x: e.clientX, y: e.clientY });
  };

  // Sampling pixels for the colour picker needs a same-origin canvas copy.
  const sample = (e: React.MouseEvent) => {
    if (!picker || !img.current || !nat.w) return;
    if (!sampler.current) {
      const c = document.createElement('canvas');
      c.width = Math.min(nat.w, 4096);
      c.height = Math.round((c.width / nat.w) * nat.h);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      try {
        ctx.drawImage(img.current, 0, 0, c.width, c.height);
        ctx.getImageData(0, 0, 1, 1);
        sampler.current = ctx;
      } catch {
        return;
      }
    }
    const r = img.current.getBoundingClientRect();
    let fx = (e.clientX - r.left) / r.width;
    let fy = (e.clientY - r.top) / r.height;
    if (rot % 360 !== 0 || flip.h || flip.v) return;
    fx = Math.max(0, Math.min(0.9999, fx));
    fy = Math.max(0, Math.min(0.9999, fy));
    const c = sampler.current.canvas;
    const d = sampler.current.getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    setPick({ x: e.clientX - wrap.current!.getBoundingClientRect().left, y: e.clientY - wrap.current!.getBoundingClientRect().top, hex });
  };

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '+' || e.key === '=') setScale(scale * 1.25);
      else if (e.key === '-') setScale(scale / 1.25);
      else if (e.key === '0') { setZoom('fit'); setPan({ x: 0, y: 0 }); }
      else if (e.key === '1') setZoom(1);
      else if (e.key.toLowerCase() === 'r') setRot((r) => r + (e.shiftKey ? -90 : 90));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <PreviewMessage icon="image" title="This image could not be shown">The file may be damaged or in a format this computer cannot decode.</PreviewMessage>;

  return (
    <div className="pv-image">
      {full ? (
        <Bar>
          <BarButton icon="minus" label="Zoom out (−)" onClick={() => setScale(scale / 1.25)} />
          <span className="pv-zoom num">{Math.round(scale * 100)}%</span>
          <BarButton icon="plus" label="Zoom in (+)" onClick={() => setScale(scale * 1.25)} />
          <button className={`pv-btn ${zoom === 'fit' ? 'on' : ''}`} onClick={() => { setZoom('fit'); setPan({ x: 0, y: 0 }); }} title="Fit (0)">Fit</button>
          <button className={`pv-btn ${zoom === 1 ? 'on' : ''}`} onClick={() => setZoom(1)} title="Actual size (1)">1:1</button>
          <span className="pv-sep" />
          <BarButton icon="undo" label="Rotate left" onClick={() => setRot((r) => r - 90)} />
          <BarButton icon="refresh" label="Rotate right (R)" onClick={() => setRot((r) => r + 90)} />
          <button className={`pv-btn ${flip.h ? 'on' : ''}`} onClick={() => setFlip((f) => ({ ...f, h: !f.h }))} title="Flip horizontally">⇋</button>
          <button className={`pv-btn ${flip.v ? 'on' : ''}`} onClick={() => setFlip((f) => ({ ...f, v: !f.v }))} title="Flip vertically">⇵</button>
          <span className="pv-sep" />
          <BarButton icon="drop" label="Colour under the pointer" on={picker} onClick={() => { setPicker((p) => !p); setPick(null); }} />
          {extra}
          <span className="grow" />
          {nat.w ? <span className="small muted num">{nat.w} × {nat.h}</span> : null}
        </Bar>
      ) : null}
      <div
        ref={wrap}
        className={`pv-stage ${transparent ? 'checker' : ''} ${picker ? 'picking' : ''} ${scale > fitScale + 0.001 ? 'can-pan' : ''}`}
        onWheel={onWheel}
        onMouseDown={(e) => { if (e.button === 0 && !picker) drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; }}
        onMouseMove={(e) => {
          if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          sample(e);
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => { drag.current = null; setPick(null); }}
        onDoubleClick={() => (zoom === 'fit' ? setZoom(1) : (setZoom('fit'), setPan({ x: 0, y: 0 })))}
        onClick={() => { if (picker && pick) void api.files.copyText(pick.hex); }}
      >
        <img
          ref={img}
          src={src}
          alt={alt}
          crossOrigin="anonymous"
          draggable={false}
          className={pixelated || scale > 3 ? 'pixelated' : ''}
          style={{
            width: nat.w ? nat.w * scale : undefined,
            height: nat.h ? nat.h * scale : undefined,
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rot}deg) scale(${flip.h ? -1 : 1}, ${flip.v ? -1 : 1})`,
            maxWidth: nat.w ? 'none' : '100%',
            maxHeight: nat.w ? 'none' : '100%',
          }}
          onLoad={(e) => {
            const t = e.currentTarget;
            setNat({ w: t.naturalWidth || 300, h: t.naturalHeight || 150 });
            onSize?.(t.naturalWidth, t.naturalHeight);
          }}
          onError={() => setError(true)}
        />
        {pick ? (
          <div className="pv-pick" style={{ left: pick.x + 16, top: pick.y + 16 }}>
            <i style={{ background: pick.hex }} />
            <span className="mono">{pick.hex}</span>
            <span className="small muted">click to copy</span>
          </div>
        ) : null}
      </div>
      {note ? <div className="pv-note small muted">{note}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ viewers

export function ImageViewer({ info, mode }: ViewerProps) {
  const [src, setSrc] = useState<string>(() => (isDemo ? '' : info.url));
  useEffect(() => {
    if (isDemo) void api.files.thumbnail(info.path, 1200).then((s) => setSrc(s ?? ''));
    else setSrc(info.url);
  }, [info]);
  if (!src) return <PreviewMessage icon="image" title={info.name} />;
  return <ImageStage src={src} alt={info.name} mode={mode} transparent={!/^(jpe?g|jfif|bmp)$/.test(info.ext)} pixelated={info.ext === 'ico' || info.ext === 'cur' || (info.size < 20_000 && info.ext === 'png')} />;
}

/** SVG shown as an image: scripts and outside links inside it never run. */
export function SvgViewer({ info, mode }: ViewerProps) {
  const [source, setSource] = useState(false);
  const state = useLoad(async () => {
    const t = await api.preview.text(info.path, 8 * 1024 * 1024);
    return t.text;
  }, [info.path]);
  return (
    <Loaded state={state}>
      {(svg) => {
        const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
        if (source) return (
          <div className="pv-col">
            <Bar><BarButton label="Picture" onClick={() => setSource(false)} /><button className="pv-btn on">Source</button></Bar>
            <CodeBlock code={svg} language="xml" />
          </div>
        );
        return <ImageStage src={src} alt={info.name} mode={mode} extra={<button className="pv-btn" onClick={() => setSource(true)}>Source</button>} />;
      }}
    </Loaded>
  );
}

/** HEIC, RAW, JPEG XL, ICNS, TGA, EXR…: decoded on this computer first. */
export function DecodedViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => {
    if (info.ext === 'jxl' && !isDemo) {
      // JPEG XL decodes right here in the viewer.
      try {
        const { default: decode } = await import('@jsquash/jxl/decode');
        const data = await decode(await fetchBytes(info.path));
        const c = document.createElement('canvas');
        c.width = data.width;
        c.height = data.height;
        c.getContext('2d')!.putImageData(data, 0, 0);
        return { url: c.toDataURL('image/png'), via: 'built-in JPEG XL decoder' };
      } catch {
        /* try the main process */
      }
    }
    if (isDemo) return { url: (await api.files.thumbnail(info.path, 1200)) ?? '', via: 'demo' };
    const d = await api.preview.image(info.path, mode === 'full' ? 4096 : 1200);
    if (!d) throw new Error('No decoder on this computer can open this image.');
    return d;
  }, [info.path, mode]);
  const note = (via: string) =>
    via === 'embedded preview' ? 'Showing the full-size preview the camera saved inside this RAW file.' : via === 'built-in HEIC decoder' ? 'Decoded on this computer by Keeper.' : undefined;
  return <Loaded state={state} label="Decoding…">{(d) => <ImageStage src={d.url} alt={info.name} mode={mode} transparent={/\.png$/.test(d.url) || info.kind === 'icns'} note={mode === 'full' ? note(d.via) : undefined} />}</Loaded>;
}

/** Every page of a TIFF, decoded in the viewer. */
export function TiffViewer({ info, mode }: ViewerProps) {
  const [page, setPage] = useState(0);
  const state = useLoad(async () => {
    if (isDemo) return [(await api.files.thumbnail(info.path, 1200)) ?? ''];
    const buf = await fetchBytes(info.path, 400 * 1024 * 1024);
    try {
      const UTIF = (await import('utif')).default;
      const ifds = UTIF.decode(buf).filter((d: { t256?: number[] }) => d.t256);
      const pages: string[] = [];
      for (const ifd of ifds.slice(0, 50)) {
        UTIF.decodeImage(buf, ifd);
        const rgba = UTIF.toRGBA8(ifd);
        const w = ifd.width as number;
        const h = ifd.height as number;
        if (!w || !h) continue;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const px = new Uint8ClampedArray(rgba.length);
        px.set(rgba);
        c.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
        pages.push(c.toDataURL('image/png'));
      }
      if (pages.length) return pages;
    } catch {
      /* fall back to the main process */
    }
    const d = await api.preview.image(info.path);
    if (!d) throw new Error('This TIFF could not be decoded.');
    return [d.url];
  }, [info.path]);
  return (
    <Loaded state={state} label="Decoding…">
      {(pages) => (
        <ImageStage
          src={pages[Math.min(page, pages.length - 1)]}
          alt={info.name}
          mode={mode}
          extra={pages.length > 1 ? (
            <span className="pv-pager">
              <BarButton icon="chevronLeft" label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
              <span className="small num">Page {page + 1} of {pages.length}</span>
              <BarButton icon="chevronRight" label="Next page" onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))} disabled={page >= pages.length - 1} />
            </span>
          ) : null}
        />
      )}
    </Loaded>
  );
}

interface PsdLayer {
  name?: string;
  hidden?: boolean;
  children?: PsdLayer[];
  canvas?: HTMLCanvasElement;
}

/** Photoshop: the flattened picture plus the layer list, read in the viewer. */
export function PsdViewer({ info, mode }: ViewerProps) {
  const [showLayers, setShowLayers] = useState(mode === 'full');
  const state = useLoad(async () => {
    if (isDemo) return { url: (await api.files.thumbnail(info.path, 1200)) ?? '', layers: [] as PsdLayer[], w: 0, h: 0 };
    const buf = await fetchBytes(info.path, 600 * 1024 * 1024);
    try {
      const { readPsd } = await import('ag-psd');
      const psd = readPsd(buf, { skipLayerImageData: mode !== 'full', skipThumbnail: true });
      if (psd.canvas) return { url: psd.canvas.toDataURL('image/png'), layers: (psd.children ?? []) as PsdLayer[], w: psd.width, h: psd.height };
    } catch {
      /* the main process can still try */
    }
    const d = await api.preview.image(info.path);
    if (!d) throw new Error('This Photoshop file could not be read.');
    return { url: d.url, layers: [] as PsdLayer[], w: d.width ?? 0, h: d.height ?? 0 };
  }, [info.path, mode]);
  return (
    <Loaded state={state} label="Reading layers…">
      {(d) => (
        <div className="pv-split">
          <ImageStage src={d.url} alt={info.name} mode={mode} extra={d.layers.length ? <BarButton icon="layers" label="Layers" on={showLayers} onClick={() => setShowLayers((v) => !v)} /> : null} />
          {showLayers && d.layers.length ? (
            <aside className="pv-side">
              <div className="pv-side-title">Layers</div>
              <LayerTree layers={d.layers} depth={0} />
            </aside>
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

function LayerTree({ layers, depth }: { layers: PsdLayer[]; depth: number }) {
  return (
    <>
      {[...layers].reverse().map((l, i) => (
        <div key={i}>
          <div className="pv-layer" style={{ paddingLeft: 10 + depth * 14, opacity: l.hidden ? 0.5 : 1 }}>
            {l.canvas ? <img src={l.canvas.toDataURL()} alt="" /> : <span className="pv-layer-icon">{l.children ? '▾' : '▫'}</span>}
            <span className="ellipsis">{l.name || 'Layer'}</span>
          </div>
          {l.children ? <LayerTree layers={l.children} depth={depth + 1} /> : null}
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ histogram

/** Brightness and RGB histogram of an image URL, drawn small. */
export function Histogram({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const url = useMemo(() => src, [src]);
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, c.width, c.height).data;
      } catch {
        return;
      }
      const bins = [new Array(64).fill(0), new Array(64).fill(0), new Array(64).fill(0)];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) continue;
        bins[0][data[i] >> 2]++;
        bins[1][data[i + 1] >> 2]++;
        bins[2][data[i + 2] >> 2]++;
      }
      const max = Math.max(...bins.flat());
      const out = ref.current;
      if (!out || !max) return;
      const g = out.getContext('2d')!;
      g.clearRect(0, 0, out.width, out.height);
      g.globalCompositeOperation = 'screen';
      ['#ff4d4d', '#3ddc84', '#4d8bff'].forEach((col, ch) => {
        g.fillStyle = col;
        g.globalAlpha = 0.75;
        bins[ch].forEach((v, i) => {
          const h = (v / max) * out.height;
          g.fillRect((i * out.width) / 64, out.height - h, out.width / 64 + 0.5, h);
        });
      });
    };
    img.src = url;
  }, [url]);
  return <canvas ref={ref} width={256} height={70} className="pv-histogram" />;
}

/** Any path as a displayable image URL (keeper-file, or decoded first). */
export async function displayUrl(path: string, ext: string): Promise<string | null> {
  if (isDemo) return api.files.thumbnail(path, 800);
  if (/^(jpe?g|png|gif|webp|avif|bmp|ico|svg)$/.test(ext)) return fileUrl(path);
  const d = await api.preview.image(path, 1600);
  return d?.url ?? null;
}
