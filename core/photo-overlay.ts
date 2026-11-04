// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Draws what is added on top of a photo (text, shapes, stickers, a watermark,
// a frame) on a 2D canvas. The editor draws it live over the preview; saving
// draws the same function at full size in a hidden window (so system fonts and
// colour emoji look the same on screen and in the file). It must stay
// self-contained (no outside names), because it is sent to that window as text.

import type { Overlay } from './photo-edit';

/** Minimal 2D context: what drawOverlays uses. */
export type Ctx2D = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'translate' | 'rotate' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'stroke' | 'fill' | 'fillRect' | 'strokeRect' | 'ellipse' | 'fillText' | 'measureText'
  | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'font' | 'textAlign' | 'textBaseline' | 'globalAlpha' | 'shadowColor' | 'shadowBlur' | 'shadowOffsetY'>;

export function drawOverlays(ctx: Ctx2D, overlays: Overlay[], W: number, H: number): void {
  const short = Math.min(W, H);
  const FONTS: Record<string, string> = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
    mono: 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace',
    round: '"Arial Rounded MT Bold", "Nunito", "Varela Round", system-ui, sans-serif',
  };
  const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  const lines = (ctx2: Ctx2D, text: string, x: number, y: number, size: number) => {
    const ls = text.split('\n');
    const lh = size * 1.18;
    const top = y - ((ls.length - 1) * lh) / 2;
    ls.forEach((l, i) => ctx2.fillText(l, x, top + i * lh));
  };
  // Frames go last, so they sit on top of everything at the edge.
  const ordered = [...overlays.filter((o) => o.kind !== 'frame'), ...overlays.filter((o) => o.kind === 'frame')];
  for (const o of ordered) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (o.kind === 'text') {
      const size = Math.max(4, o.size * short);
      ctx.font = `${o.bold ? '700' : '500'} ${size}px ${FONTS[o.font] ?? FONTS.sans}`;
      ctx.fillStyle = o.colour;
      if (o.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.04; }
      lines(ctx, o.text, o.x * W, o.y * H, size);
    } else if (o.kind === 'sticker') {
      const size = Math.max(6, o.size * short);
      ctx.font = `${size}px ${EMOJI}`;
      ctx.fillText(o.emoji, o.x * W, o.y * H);
    } else if (o.kind === 'shape') {
      const lw = Math.max(1, o.width * short);
      ctx.lineWidth = lw;
      ctx.strokeStyle = o.colour;
      ctx.fillStyle = o.colour;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H;
      if (o.shape === 'rect') { if (o.fill) ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h); }
      else if (o.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (o.fill) ctx.fill(); else ctx.stroke();
      } else {
        const x2 = x + w, y2 = y + h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        if (o.shape === 'arrow') {
          const a = Math.atan2(y2 - y, x2 - x);
          const head = Math.max(lw * 3.2, short * 0.02);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
          ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (o.kind === 'watermark') {
      const size = Math.max(6, o.size * short);
      ctx.globalAlpha = o.opacity;
      ctx.fillStyle = o.colour;
      ctx.font = `600 ${size}px ${FONTS.sans}`;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = size * 0.2;
      if (o.place === 'tile') {
        const tw = ctx.measureText(o.text).width + size * 3;
        const th = size * 4;
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-Math.PI / 6);
        const span = Math.hypot(W, H);
        for (let yy = -span / 2; yy < span / 2; yy += th) for (let xx = -span / 2 + ((Math.round(yy / th) % 2) * tw) / 2; xx < span / 2; xx += tw) ctx.fillText(o.text, xx, yy);
      } else {
        const m = short * 0.035;
        const tw = ctx.measureText(o.text).width;
        const x = o.place === 'c' ? W / 2 : o.place.endsWith('l') ? m + tw / 2 : W - m - tw / 2;
        const y = o.place === 'c' ? H / 2 : o.place.startsWith('t') ? m + size / 2 : H - m - size / 2;
        ctx.fillText(o.text, x, y);
      }
    } else if (o.kind === 'frame') {
      const s = Math.max(1, Math.round(o.size * short));
      ctx.fillStyle = o.colour;
      const bottom = o.style === 'print' ? s * 3.2 : s;
      ctx.fillRect(0, 0, W, s);
      ctx.fillRect(0, H - bottom, W, bottom);
      ctx.fillRect(0, 0, s, H);
      ctx.fillRect(W - s, 0, s, H);
      if (o.style === 'double') {
        ctx.strokeStyle = o.colour;
        ctx.lineWidth = Math.max(1, s * 0.18);
        const g = s * 1.6;
        ctx.strokeRect(g, g, W - 2 * g, H - 2 * g);
      }
    }
    ctx.restore();
  }
}

/** Roughly where an added thing sits, as fractions of the picture (for choosing it on the picture). */
export function overlayBounds(o: Overlay, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  const short = Math.min(W, H);
  if (o.kind === 'text') { const lines = o.text.split('\n'); const longest = Math.max(...lines.map((l) => l.length)); const w = (longest * o.size * short * 0.55) / W; const h = (lines.length * o.size * short * 1.2) / H; return { x: o.x - w / 2, y: o.y - h / 2, w, h }; }
  if (o.kind === 'sticker') { const w = (o.size * short) / W, h = (o.size * short) / H; return { x: o.x - w / 2, y: o.y - h / 2, w, h }; }
  if (o.kind === 'shape') return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
  return null;
}
