// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Draws one frame onto a 2D canvas: the background, the picture with its
// rounded corners and shadow, blur boxes, the pointer, ripples, the camera
// bubble, captions and shortcut badges. Used by the editor's preview and by
// the export, so both look the same.

import { fieldBlobs, presetById, rng } from './backgrounds';
import type { FrameState } from './frame';
import type { Rect } from './layout';
import type { Background, StudioStyle } from './types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = CanvasImageSource & { width?: number; height?: number; displayWidth?: number; displayHeight?: number; videoWidth?: number; videoHeight?: number };

function roundRect(ctx: Ctx2D, r: Rect, rad: number) {
  const k = Math.max(0, Math.min(rad, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

/** Paints a background over the whole canvas. */
export function drawBackground(ctx: Ctx2D, bg: Background, w: number, h: number) {
  ctx.save();
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.kind === 'gradient') {
    const a = ((bg.angle - 90) * Math.PI) / 180;
    const r = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2;
    const g = ctx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const p = presetById(bg.id);
    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    if (p.kind === 'linear') {
      const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
      g.addColorStop(0, p.colors[0]);
      g.addColorStop(1, p.colors[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (p.kind === 'field') {
      for (const b of fieldBlobs(p)) {
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * m);
        g.addColorStop(0, b.color + 'cc');
        g.addColorStop(0.55, b.color + '40');
        g.addColorStop(1, b.color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      const r = rng(p.seed);
      const layers = p.colors.length;
      for (let i = 0; i < layers; i++) {
        const base = h * (0.35 + (i / layers) * 0.6);
        const amp = h * (0.05 + r() * 0.06), freq = 1 + r() * 1.6, phase = r() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(4, w / 160)) ctx.lineTo(x, base + Math.sin((x / w) * Math.PI * 2 * freq + phase) * amp + Math.sin((x / w) * Math.PI * 5.3 + phase * 2) * amp * 0.25);
        ctx.lineTo(w, h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, base - amp, 0, h);
        g.addColorStop(0, p.colors[i]);
        g.addColorStop(1, p.base);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (p.grain) {
      // fine grain from a fixed seed, in small tiles
      const r = rng(p.seed * 7 + 1);
      const step = Math.max(2, Math.round(m / 540));
      ctx.globalAlpha = p.grain;
      for (let y = 0; y < h; y += step * 3) for (let x = (y / step) % 2 ? step : 0; x < w; x += step * 3) {
        ctx.fillStyle = r() > 0.5 ? '#fff' : '#000';
        ctx.fillRect(x + r() * step * 2, y + r() * step * 2, step, step);
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** The classic arrow, in screen points, tip at 0,0. */
const ARROW: [number, number][] = [[0, 0], [0, 17.5], [4.2, 13.6], [7, 20], [9.8, 18.8], [7.1, 12.6], [12.6, 12.6]];

function arrow(ctx: Ctx2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ARROW.forEach(([ax, ay], i) => (i ? ctx.lineTo(x + ax * s, y + ay * s) : ctx.moveTo(x + ax * s, y + ay * s)));
  ctx.closePath();
}

function drawPointer(ctx: Ctx2D, look: StudioStyle['cursor']['look'], x: number, y: number, s: number, alpha: number) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (look === 'dot') {
    ctx.beginPath();
    ctx.arc(x, y, 9 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,20,0.55)';
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4 * s;
    ctx.shadowOffsetY = 1.5 * s;
    arrow(ctx, x, y, s);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  ctx.restore();
}

/** Draws a picture into a box, covering it (cropping the overflow), optionally mirrored. */
function cover(ctx: Ctx2D, img: Img, r: Rect, mirror: boolean) {
  const iw = img.displayWidth ?? img.videoWidth ?? img.width ?? 1;
  const ih = img.displayHeight ?? img.videoHeight ?? img.height ?? 1;
  const k = Math.max(r.w / iw, r.h / ih);
  const sw = r.w / k, sh = r.h / k;
  ctx.save();
  if (mirror) { ctx.translate(r.x * 2 + r.w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function wrap(ctx: Ctx2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(-2);
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif';

export interface Frames {
  screen: Img | null;
  webcam?: Img | null;
  /** a ready-made background canvas of the frame's size (drawn once) */
  background?: CanvasImageSource | null;
}

/** Draws a whole frame. */
export function drawFrame(ctx: Ctx2D, st: FrameState, style: StudioStyle, f: Frames) {
  const { out, box, radius, unit } = st.layout;
  if (f.background) ctx.drawImage(f.background, 0, 0, out.width, out.height);
  else drawBackground(ctx, style.frame.background, out.width, out.height);

  // shadow under the picture
  if (style.frame.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.55 * style.frame.shadow})`;
    ctx.shadowBlur = 70 * unit * style.frame.shadow;
    ctx.shadowOffsetY = 24 * unit * style.frame.shadow;
    roundRect(ctx, box, radius);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRect(ctx, box, radius);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (f.screen) {
    const views = [...st.viewTrail, st.view];
    views.forEach((v, i) => {
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(f.screen!, v.x, v.y, v.w, v.h, box.x, box.y, box.w, box.h);
    });
    ctx.globalAlpha = 1;
    // privacy blur: the same picture again, blurred, inside each box
    for (const b of st.blurs) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(6, 18 * unit)}px)`;
      const v = st.view;
      ctx.drawImage(f.screen, v.x, v.y, v.w, v.h, box.x, box.y, box.w, box.h);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(128,128,128,0.25)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }

  // ripples and the pointer stay inside the picture
  for (const r of st.ripples) {
    const s = st.cursor?.scale ?? unit;
    ctx.beginPath();
    ctx.arc(r.fx, r.fy, (8 + 26 * r.k) * s, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * s * (1 - r.k * 0.5);
    ctx.strokeStyle = r.right ? `rgba(255,170,60,${0.85 * (1 - r.k)})` : `rgba(255,255,255,${0.9 * (1 - r.k)})`;
    ctx.stroke();
    ctx.fillStyle = r.right ? `rgba(255,170,60,${0.18 * (1 - r.k)})` : `rgba(80,140,255,${0.22 * (1 - r.k)})`;
    ctx.fill();
  }
  if (st.cursor) {
    const c = st.cursor;
    c.trail.forEach((p, i) => drawPointer(ctx, style.cursor.look, p.x, p.y, c.scale, c.opacity * 0.18 * (i + 1) / c.trail.length));
    drawPointer(ctx, style.cursor.look, c.x, c.y, c.scale, c.opacity);
  }
  ctx.restore();

  if (style.frame.inset && radius >= 0) {
    ctx.save();
    roundRect(ctx, { x: box.x + 0.5, y: box.y + 0.5, w: box.w - 1, h: box.h - 1 }, radius);
    ctx.lineWidth = Math.max(1, 1.5 * unit);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();
    ctx.restore();
  }

  // the camera bubble
  if (st.bubble && f.webcam) {
    const b = st.bubble;
    const rad = style.camera.shape === 'circle' ? b.w / 2 : style.camera.shape === 'rounded' ? b.w * 0.18 : 6 * unit;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 30 * unit;
    ctx.shadowOffsetY = 10 * unit;
    roundRect(ctx, b, rad);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, b, rad);
    ctx.clip();
    cover(ctx, f.webcam, b, style.camera.mirror);
    ctx.restore();
    ctx.save();
    roundRect(ctx, b, rad);
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.restore();
  }

  // captions, then the shortcut badge above them
  let bottom = out.height - Math.max(box.y < out.height * 0.02 ? 40 : 28, 46) * unit;
  if (st.caption) {
    const size = Math.round(38 * unit);
    ctx.save();
    ctx.font = `600 ${size}px ${FONT}`;
    const lines = wrap(ctx, st.caption, out.width * 0.8);
    const lh = size * 1.3;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2;
    const h = lines.length * lh + size * 0.6;
    const r: Rect = { x: (out.width - w) / 2, y: bottom - h, w, h };
    roundRect(ctx, r, size * 0.45);
    ctx.fillStyle = 'rgba(10,10,12,0.78)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, out.width / 2, r.y + size * 0.3 + lh * (i + 0.5)));
    ctx.restore();
    bottom = r.y - 14 * unit;
  }
  if (st.badge) {
    const size = Math.round(34 * unit);
    const k = st.badge.k;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, k));
    ctx.font = `600 ${size}px ${FONT}`;
    const label = st.badge.count > 1 ? `${st.badge.label}  ×${st.badge.count}` : st.badge.label;
    const w = ctx.measureText(label).width + size * 1.3;
    const h = size * 1.9;
    const sc = 0.92 + 0.08 * Math.min(1, k);
    const r: Rect = { x: (out.width - w * sc) / 2, y: bottom - h * sc, w: w * sc, h: h * sc };
    roundRect(ctx, r, h * 0.3 * sc);
    ctx.fillStyle = 'rgba(18,18,22,0.82)';
    ctx.fill();
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(size * sc)}px ${FONT}`;
    ctx.fillText(label, out.width / 2, r.y + r.h / 2);
    ctx.restore();
  }
}
