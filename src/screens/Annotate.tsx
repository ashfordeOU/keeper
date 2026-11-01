// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Annotate and beautify an image: arrows, shapes, pen, highlighter, text,
// numbered steps, pixelate, crop — then padding, background, rounded corners,
// shadow and a window frame. Saves next to the original, never over it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { arrowHead, BACKGROUNDS, beautifyLayout, normRect, pixelate, type BeautifyOptions, type Pt } from '../../core/capture';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/capture.css';

type Tool = 'arrow' | 'rect' | 'ellipse' | 'line' | 'pen' | 'marker' | 'text' | 'step' | 'blur' | 'smooth' | 'redact' | 'crop';

type Shape =
  | { t: 'arrow' | 'rect' | 'ellipse' | 'line'; a: Pt; b: Pt; color: string; width: number }
  | { t: 'pen' | 'marker'; pts: Pt[]; color: string; width: number }
  | { t: 'text'; at: Pt; text: string; color: string; size: number }
  | { t: 'step'; at: Pt; n: number; color: string; size: number }
  | { t: 'blur' | 'smooth' | 'redact'; a: Pt; b: Pt }
  | { t: 'crop'; a: Pt; b: Pt };

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'arrow', icon: 'arrowUp', label: 'Arrow', key: 'a' },
  { id: 'rect', icon: 'grid', label: 'Rectangle', key: 'r' },
  { id: 'ellipse', icon: 'drop', label: 'Ellipse', key: 'o' },
  { id: 'line', icon: 'minus', label: 'Line', key: 'l' },
  { id: 'pen', icon: 'rename', label: 'Pen', key: 'p' },
  { id: 'marker', icon: 'sparkle', label: 'Highlighter', key: 'h' },
  { id: 'text', icon: 'text', label: 'Text', key: 't' },
  { id: 'step', icon: 'plus', label: 'Numbered step', key: 'n' },
  { id: 'blur', icon: 'eye', label: 'Pixelate', key: 'b' },
  { id: 'smooth', icon: 'drop', label: 'Blur', key: 'u' },
  { id: 'redact', icon: 'lock', label: 'Black out', key: 'k' },
  { id: 'crop', icon: 'screenshot', label: 'Crop', key: 'c' },
];

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#5e5ce6', '#ff2d92', '#ffffff', '#000000'];

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not open the image'));
    img.src = src;
  });
}

/** The visible part of the image after the latest crop. */
function cropOf(shapes: Shape[], w: number, h: number) {
  const c = [...shapes].reverse().find((s) => s.t === 'crop') as Extract<Shape, { t: 'crop' }> | undefined;
  if (!c) return { x: 0, y: 0, w, h };
  const r = normRect(c.a, c.b, w, h);
  return r.w > 4 && r.h > 4 ? r : { x: 0, y: 0, w, h };
}

/** Draws the annotated image (no beautify) onto ctx at 0,0, in image pixels. */
function drawAnnotated(ctx: CanvasRenderingContext2D, img: HTMLImageElement, shapes: Shape[], draft: Shape | null) {
  const crop = cropOf(shapes, img.naturalWidth, img.naturalHeight);
  ctx.save();
  ctx.translate(-crop.x, -crop.y);
  ctx.drawImage(img, 0, 0);
  for (const s of draft && draft.t !== 'crop' ? [...shapes, draft] : shapes) drawShape(ctx, s, img);
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, img: HTMLImageElement) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (s.t) {
    case 'arrow': {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      const head = Math.max(12, s.width * 4);
      const [l, r] = arrowHead(s.a, s.b, head);
      const back = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(back.x, back.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.b.x, s.b.y); ctx.lineTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.closePath(); ctx.fill();
      break;
    }
    case 'line':
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
      break;
    case 'rect': {
      const r = normRect(s.a, s.b);
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(8, r.w / 4, r.h / 4)); ctx.stroke();
      break;
    }
    case 'ellipse': {
      const r = normRect(s.a, s.b);
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width;
      ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'pen':
    case 'marker':
      if (s.pts.length < 2) break;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.t === 'marker' ? s.width * 4 : s.width;
      if (s.t === 'marker') { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
      ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (const p of s.pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    case 'text':
      ctx.font = `600 ${s.size}px -apple-system, 'Segoe UI', system-ui, sans-serif`;
      ctx.lineWidth = Math.max(3, s.size / 6);
      ctx.strokeStyle = s.color === '#ffffff' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.9)';
      ctx.fillStyle = s.color;
      ctx.textBaseline = 'top';
      s.text.split('\n').forEach((line, i) => { ctx.strokeText(line, s.at.x, s.at.y + i * s.size * 1.2); ctx.fillText(line, s.at.x, s.at.y + i * s.size * 1.2); });
      break;
    case 'step': {
      const r = s.size;
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.at.x, s.at.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(2, r / 8); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = s.color === '#ffffff' || s.color === '#ffcc00' ? '#000' : '#fff';
      ctx.font = `700 ${Math.round(r * 1.1)}px -apple-system, 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.at.x, s.at.y + 1);
      break;
    }
    case 'redact': {
      // A solid box: nothing of what was under it survives in the saved picture.
      const r = normRect(s.a, s.b, img.naturalWidth, img.naturalHeight);
      ctx.fillStyle = '#000';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'smooth': {
      const r = normRect(s.a, s.b, img.naturalWidth, img.naturalHeight);
      if (r.w < 2 || r.h < 2) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(6, Math.round(Math.min(r.w, r.h) / 10))}px)`;
      ctx.drawImage(img, r.x - 20, r.y - 20, r.w + 40, r.h + 40, r.x - 20, r.y - 20, r.w + 40, r.h + 40);
      ctx.restore();
      break;
    }
    case 'blur': {
      const r = normRect(s.a, s.b, img.naturalWidth, img.naturalHeight);
      if (r.w < 2 || r.h < 2) break;
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(r.w); tmp.height = Math.round(r.h);
      const t = tmp.getContext('2d')!;
      t.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
      const data = t.getImageData(0, 0, tmp.width, tmp.height);
      pixelate(data.data, tmp.width, tmp.height, Math.max(8, Math.round(Math.min(r.w, r.h) / 8)));
      t.putImageData(data, 0, 0);
      ctx.drawImage(tmp, r.x, r.y);
      break;
    }
  }
  ctx.restore();
}

function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: string) {
  // Any colour, picked by the person.
  if (/^#[0-9a-f]{3,8}$/i.test(bg)) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const def = BACKGROUNDS.find((b) => b.id === bg);
  if (!def || def.id === 'none') return;
  if (def.stops) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, def.stops[0]);
    g.addColorStop(1, def.stops[1]);
    ctx.fillStyle = g;
  } else ctx.fillStyle = def.css;
  ctx.fillRect(0, 0, w, h);
}

/** Composes the final picture: background, shadow, rounded window, optional title bar, the annotated image. */
function compose(img: HTMLImageElement, shapes: Shape[], draft: Shape | null, o: BeautifyOptions): HTMLCanvasElement {
  const crop = cropOf(shapes, img.naturalWidth, img.naturalHeight);
  const L = beautifyLayout(crop.w, crop.h, o);
  const c = document.createElement('canvas');
  c.width = L.width;
  c.height = L.height;
  const ctx = c.getContext('2d')!;
  paintBackground(ctx, L.width, L.height, o.background);
  const win = L.window;
  const radius = Math.min(o.radius, win.w / 4, win.h / 4);
  if (o.shadow > 0 && o.padding > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = o.shadow;
    ctx.shadowOffsetY = o.shadow / 3;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, radius); ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, radius); ctx.clip();
  if (o.frame) {
    ctx.fillStyle = '#e9e9ee';
    ctx.fillRect(win.x, win.y, win.w, L.image.y - win.y);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(win.x + 18 + i * 20, win.y + 17, 6, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.translate(L.image.x, L.image.y);
  drawAnnotated(ctx, img, shapes, draft);
  ctx.restore();
  return c;
}

export function Annotate() {
  const { route, go, toast, refresh } = useStore();
  const src = route.arg;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(5);
  const [beauty, setBeauty] = useState<BeautifyOptions>({ padding: 0, radius: 0, shadow: 0, frame: false, background: 'none' });
  const [typing, setTyping] = useState<{ at: Pt; screen: Pt; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  useEffect(() => {
    setImg(null);
    setShapes([]);
    setRedo([]);
    setError(null);
    if (!src) return;
    void api.files.readImage(src).then(loadImg).then(setImg).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [src]);

  const composed = useMemo(() => (img ? compose(img, shapes, draft, beauty) : null), [img, shapes, draft, beauty]);

  // Show the composed picture scaled to fit the editor.
  useEffect(() => {
    if (!composed || !canvas.current || !box.current) return;
    const c = canvas.current;
    const scale = Math.min(1, (box.current.clientWidth - 2) / composed.width, (Math.max(320, window.innerHeight - 260)) / composed.height);
    setFit(scale);
    c.width = composed.width;
    c.height = composed.height;
    c.style.width = `${composed.width * scale}px`;
    c.style.height = `${composed.height * scale}px`;
    c.getContext('2d')!.drawImage(composed, 0, 0);
    // While cropping, show the crop frame on top.
    if (draft?.t === 'crop' && img) {
      const L = beautifyLayout(cropOf(shapes, img.naturalWidth, img.naturalHeight).w, cropOf(shapes, img.naturalWidth, img.naturalHeight).h, beauty);
      const crop = cropOf(shapes, img.naturalWidth, img.naturalHeight);
      const r = normRect(draft.a, draft.b);
      const ctx = c.getContext('2d')!;
      ctx.save();
      ctx.translate(L.image.x - crop.x, L.image.y - crop.y);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(crop.x, crop.y, crop.w, crop.h);
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.drawImage(img, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      ctx.setLineDash([8, 6]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / fit; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }, [composed, draft, img, shapes, beauty, fit]);

  /** Mouse position in original image pixels. */
  const toImage = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const crop = cropOf(shapes, img!.naturalWidth, img!.naturalHeight);
    const L = beautifyLayout(crop.w, crop.h, beauty);
    const x = ((e.clientX - rect.left) / rect.width) * c.width - L.image.x + crop.x;
    const y = ((e.clientY - rect.top) / rect.height) * c.height - L.image.y + crop.y;
    return { x, y };
  }, [img, shapes, beauty]);

  const push = (s: Shape) => {
    setShapes((list) => [...list, s]);
    setRedo([]);
  };
  const undo = () => setShapes((list) => { if (!list.length) return list; setRedo((r) => [list[list.length - 1], ...r]); return list.slice(0, -1); });
  const redoOne = () => setRedo((r) => { if (!r.length) return r; setShapes((list) => [...list, r[0]]); return r.slice(1); });

  const onDown = (e: React.MouseEvent) => {
    if (!img || typing) return;
    const p = toImage(e);
    if (tool === 'text') {
      // Keep the mouse-down from taking focus away from the text box that is about to appear.
      e.preventDefault();
      setTyping({ at: p, screen: { x: e.clientX, y: e.clientY }, text: '' });
      return;
    }
    if (tool === 'step') {
      const n = shapes.filter((s) => s.t === 'step').length + 1;
      push({ t: 'step', at: p, n, color, size: Math.max(14, width * 3.5) });
      return;
    }
    if (tool === 'pen' || tool === 'marker') setDraft({ t: tool, pts: [p], color, width });
    else if (tool === 'blur' || tool === 'smooth' || tool === 'redact' || tool === 'crop') setDraft({ t: tool, a: p, b: p });
    else setDraft({ t: tool, a: p, b: p, color, width });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!draft) return;
    const p = toImage(e);
    if (draft.t === 'pen' || draft.t === 'marker') setDraft({ ...draft, pts: [...draft.pts, p] });
    else if ('a' in draft) setDraft({ ...draft, b: e.shiftKey && (draft.t === 'rect' || draft.t === 'ellipse') ? { x: p.x, y: draft.a.y + Math.sign(p.y - draft.a.y) * Math.abs(p.x - draft.a.x) } : p });
  };
  const onUp = () => {
    if (!draft) return;
    const big = 'a' in draft ? Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > 4 : draft.t === 'pen' || draft.t === 'marker' ? draft.pts.length > 1 : true;
    if (big) push(draft);
    setDraft(null);
  };

  const commitText = () => {
    if (typing?.text.trim()) push({ t: 'text', at: typing.at, text: typing.text, color, size: Math.max(16, width * 5) });
    setTyping(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoOne(); else undo(); return; }
      if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); return; }
      if (cmd || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportUrl = () => composed!.toDataURL('image/png');
  const save = async () => {
    if (!composed) return;
    setSaving(true);
    try {
      const p = await api.files.writeImage(src ?? '', exportUrl());
      refresh();
      toast(`Saved ${p.split(/[\\/]/).pop()}`, { label: 'Show', run: () => void api.files.reveal(p) });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    if (!composed) return;
    await api.files.copyImage(exportUrl());
    toast('Copied the image');
  };

  if (!src) {
    return (
      <div>
        <PageHead title="Annotate" sub="Mark up a screenshot or picture, then make it look good." />
        <Empty icon="screenshot" title="Choose an image to annotate">
          Right-click any image and choose <b>Annotate</b>, or take a screenshot now.
          <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => void api.capture.screenshot('area').then((p) => p && go({ name: 'annotate', arg: p }))}><Icon name="screenshot" size={14} /> Take a screenshot</button></div>
        </Empty>
      </div>
    );
  }
  if (error) return <Empty icon="warning" title="Could not open this image">{error}</Empty>;
  if (!img) return <Loading label="Opening image…" />;

  const crop = cropOf(shapes, img.naturalWidth, img.naturalHeight);
  return (
    <div className="annotate">
      <PageHead title="Annotate" sub={<span className="ellipsis" title={src}>{src.split(/[\\/]/).pop()} · {Math.round(crop.w)} × {Math.round(crop.h)}</span>}>
        <button className="btn" onClick={() => void copy()}><Icon name="copy" size={14} /> Copy</button>
        <button className="btn primary" disabled={saving} onClick={() => void save()}><Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save copy'}</button>
      </PageHead>

      <div className="annotate-bar card">
        <div className="seg">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${t.key.toUpperCase()})`} aria-label={t.label} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} size={14} />
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {COLORS.map((c) => <button key={c} className={`color-dot ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />)}
        </div>
        <label className="row small" style={{ gap: 6 }}>Size <input type="range" min={2} max={16} value={width} onChange={(e) => setWidth(+e.target.value)} /></label>
        <div className="grow" />
        <button className="btn sm icon" title="Undo" disabled={!shapes.length} onClick={undo}><Icon name="undo" size={13} /></button>
        <button className="btn sm icon" title="Redo" disabled={!redo.length} onClick={redoOne}><Icon name="refresh" size={13} /></button>
        <button className="btn sm" disabled={!shapes.length} onClick={() => { setRedo([]); setShapes([]); }}>Clear</button>
      </div>

      <div className="annotate-stage" ref={box}>
        <canvas
          ref={canvas}
          className={`annotate-canvas tool-${tool}`}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
        {typing ? (
          <textarea
            className="annotate-text"
            ref={(el) => { if (el && document.activeElement !== el) el.focus(); }}
            style={{ left: typing.screen.x, top: typing.screen.y, color, fontSize: Math.max(16, width * 5) * fit }}
            value={typing.text}
            placeholder="Type, then click away"
            onChange={(e) => setTyping({ ...typing, text: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => { if (e.key === 'Escape') setTyping(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } }}
          />
        ) : null}
      </div>

      <div className="annotate-bar card">
        <b className="small">Beautify</b>
        <label className="row small" style={{ gap: 6 }}>Padding <input type="range" min={0} max={200} value={beauty.padding} onChange={(e) => setBeauty({ ...beauty, padding: +e.target.value, background: beauty.background === 'none' && +e.target.value > 0 ? 'dusk' : beauty.background })} /></label>
        <label className="row small" style={{ gap: 6 }}>Corners <input type="range" min={0} max={40} value={beauty.radius} onChange={(e) => setBeauty({ ...beauty, radius: +e.target.value })} /></label>
        <label className="row small" style={{ gap: 6 }}>Shadow <input type="range" min={0} max={80} value={beauty.shadow} onChange={(e) => setBeauty({ ...beauty, shadow: +e.target.value })} /></label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={beauty.frame} onChange={(e) => setBeauty({ ...beauty, frame: e.target.checked })} /> Window frame</label>
        <div className="row" style={{ gap: 4 }}>
          {BACKGROUNDS.map((b) => (
            <button key={b.id} title={b.label} aria-label={`Background ${b.label}`} className={`bg-dot ${beauty.background === b.id ? 'on' : ''}`} style={{ background: b.id === 'none' ? 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/8px 8px' : b.css }} onClick={() => setBeauty({ ...beauty, background: b.id, padding: b.id !== 'none' && beauty.padding === 0 ? 48 : beauty.padding })} />
          ))}
          <input type="color" title="Any colour" aria-label="Background colour" value={/^#/.test(beauty.background) ? beauty.background : '#6d6dff'} onChange={(e) => setBeauty({ ...beauty, background: e.target.value, padding: beauty.padding || 48 })} style={{ width: 26, height: 22, padding: 0, border: 0, background: 'none' }} />
        </div>
        <div className="seg" title="Shape of the finished picture">
          {(['free', '16:9', '4:5', '1:1'] as const).map((a) => <button key={a} className={(beauty.aspect ?? 'free') === a ? 'on' : ''} onClick={() => setBeauty({ ...beauty, aspect: a, padding: beauty.padding || 48, background: beauty.background === 'none' ? 'dusk' : beauty.background })}>{a === 'free' ? 'Any shape' : a}</button>)}
        </div>
        <button className="btn sm" onClick={() => setBeauty({ padding: 64, radius: 14, shadow: 40, frame: true, background: 'dusk' })}>One-click polish</button>
        <button className="btn ghost sm" onClick={() => setBeauty({ padding: 0, radius: 0, shadow: 0, frame: false, background: 'none' })}>Reset</button>
      </div>
    </div>
  );
}
