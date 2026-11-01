// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The tracker's menu-bar / tray label: an icon only, the most urgent one to
// three limits ("CC 69%"), reset countdowns ("Reset 1d 6h"), "+N" for the
// rest, a busy-day mode that always shows the lowest, and nothing at all when
// all is clear (if chosen). Also draws the tray picture: a ring with the
// share left, for systems that show pictures only. Pure.

import { drawText, textWidth, type Bitmap, type Rgba } from '../monitor-tray';
import { countdown, type MenuBarSettings } from './model';
import type { PriorityItem } from './priority';

export interface LabelPart {
  accountId: string;
  limitKey: string;
  glyph: string;
  text: string;
  color: string;
  urgency: PriorityItem['urgency'];
}

export interface MenuBarLabel {
  /** show an item at all */
  visible: boolean;
  /** the text beside the icon (macOS shows it; elsewhere it goes in the tooltip and picture) */
  text: string;
  parts: LabelPart[];
  overflow: number;
  tooltip: string;
  /** 0–100 left of the first part, for the ring in the picture */
  ring?: number;
  tone: 'ok' | 'low' | 'out';
}

const short = (i: PriorityItem) => `${i.accountName} ${i.limit.label}`;

function partText(i: PriorityItem, mode: MenuBarSettings['mode'], now: number): string {
  const reset = i.limit.resetsAt ? countdown(i.limit.resetsAt - now) : '';
  if (mode === 'countdown') return reset ? `Reset ${reset}` : `${Math.round(i.left ?? 0)}%`;
  if (i.urgency === 'used-up') return reset ? `0% · ${reset}` : '0%';
  return `${Math.round(i.left ?? 0)}%`;
}

/** The label for the menu bar from prioritized items (most urgent first). */
export function renderLabel(items: PriorityItem[], s: MenuBarSettings, now: number): MenuBarLabel {
  const shown = items.filter((i) => !i.hideInMenuBar && i.left !== undefined);
  const urgent = shown.filter((i) => i.urgency === 'running-out' || i.urgency === 'used-up');
  const expiring = shown.filter((i) => i.urgency === 'expiring');
  const tone: MenuBarLabel['tone'] = urgent.some((i) => i.urgency === 'used-up') ? 'out' : urgent.length ? 'low' : 'ok';
  const tipLines = [...urgent, ...expiring].slice(0, 8).map((i) => `${short(i)}: ${i.urgency === 'used-up' ? 'used up' : `${Math.round(i.left ?? 0)}% left`}${i.limit.resetsAt ? `, resets in ${countdown(i.limit.resetsAt - now)}` : ''}`);
  const tooltip = tipLines.length ? `AI usage\n${tipLines.join('\n')}` : 'AI usage: nothing is running out';
  if (!urgent.length && s.hideWhenClear && s.mode !== 'busy') return { visible: false, text: '', parts: [], overflow: 0, tooltip, tone };
  let pool: PriorityItem[];
  if (s.mode === 'icon') pool = [];
  else if (s.mode === 'busy') {
    // Busy day: always the lowest limits, urgent or not (one per account first).
    const seen = new Set<string>();
    const lowest = [...shown].sort((a, b) => (a.left ?? 100) - (b.left ?? 100));
    const firsts = lowest.filter((i) => (seen.has(i.accountId) ? false : (seen.add(i.accountId), true)));
    pool = [...firsts, ...lowest.filter((i) => !firsts.includes(i))];
  } else if (s.mode === 'countdown') pool = urgent.length ? urgent : [];
  else pool = urgent;
  const take = pool.slice(0, s.count);
  const parts: LabelPart[] = take.map((i) => ({ accountId: i.accountId, limitKey: i.limit.key, glyph: i.glyph, text: partText(i, s.mode, now), color: i.color, urgency: i.urgency }));
  // "+N": urgent limits the label could not fit.
  const overflow = s.overflow && s.mode !== 'icon' ? urgent.filter((i) => !take.includes(i)).length : 0;
  const text = [...parts.map((p) => (s.glyph ? `${p.glyph} ${p.text}` : p.text)), ...(overflow ? [`+${overflow}`] : [])].join('  ');
  return { visible: true, text, parts, overflow, tooltip, ring: take[0]?.left ?? (urgent[0]?.left), tone };
}

// ---------------------------------------------------------------- the tray picture

function put(b: Bitmap, x: number, y: number, c: Rgba, a = 1) {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return;
  const i = (y * b.width + x) * 4;
  const alpha = Math.round(c[3] * a);
  if (alpha <= b.data[i + 3]) return;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = alpha;
}

/**
 * A ring for the tray: full circle faint, the share left drawn strong from the top,
 * with the number inside when it fits. `left` undefined draws a plain gauge mark.
 */
export function renderRing(size: number, left: number | undefined, ink: Rgba, accent?: Rgba): Bitmap {
  const b: Bitmap = { width: size, height: size, data: new Uint8Array(size * size * 4) };
  const c = (size - 1) / 2;
  const outer = size / 2 - 0.5;
  const inner = outer - Math.max(2, size / 9);
  const frac = left === undefined ? 0.75 : Math.max(0, Math.min(1, left / 100));
  const strong = accent ?? ink;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      // Soft edges: coverage over half a pixel.
      const cover = Math.max(0, Math.min(1, outer + 0.5 - r)) * Math.max(0, Math.min(1, r - inner + 0.5));
      if (cover <= 0) continue;
      // Angle clockwise from the top, 0..1.
      const ang = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
      if (ang <= frac) put(b, x, y, strong, cover);
      else put(b, x, y, ink, cover * 0.28);
    }
  }
  if (left !== undefined) {
    const t = String(Math.round(left));
    const scale = size >= 30 && t.length <= 2 ? 2 : 1;
    const w = textWidth(t, scale);
    if (w <= inner * 2 - 1) drawText(b, t, Math.round(c - w / 2 + 0.5), Math.round(c - (5 * scale) / 2 + 0.5), ink, scale);
  }
  return b;
}

export function toneColor(tone: MenuBarLabel['tone']): Rgba | undefined {
  return tone === 'out' ? [235, 64, 52, 255] : tone === 'low' ? [230, 150, 20, 255] : undefined;
}
