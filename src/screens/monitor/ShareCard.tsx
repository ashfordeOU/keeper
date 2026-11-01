// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The share card: a picture of the current readings to save as PNG or copy.

import { useEffect, useRef, useState } from 'react';
import { shareCardLayout, sparkPoints, type CardTheme } from '../../../core/monitor-share';
import type { TrayMetric } from '../../../core/monitor-tray';
import { api } from '../../api';
import { Modal } from '../../components/ui';
import { useStore } from '../../state';
import { useLive } from './common';

const COLOR: Record<TrayMetric, string> = { cpu: '#5b5bf0', mem: '#8b5cf6', net: '#2f9e62', disk: '#3b82f6', gpu: '#14b8a6', temp: '#e5484d', power: '#f59e0b', battery: '#2f9e62' };

function draw(canvas: HTMLCanvasElement, layout: ReturnType<typeof shareCardLayout>) {
  const c = canvas.getContext('2d');
  if (!c) return;
  canvas.width = layout.width;
  canvas.height = layout.height;
  const { colors } = layout;
  c.clearRect(0, 0, layout.width, layout.height);
  c.fillStyle = colors.bg;
  c.fillRect(0, 0, layout.width, layout.height);
  const font = (w: number, px: number) => `${w} ${px}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
  c.fillStyle = colors.text;
  c.font = font(700, 52);
  c.fillText(layout.title, 48, 96);
  c.fillStyle = colors.muted;
  c.font = font(400, 24);
  c.fillText(layout.subtitle, 48, 136);
  for (const t of layout.tiles) {
    c.fillStyle = colors.card;
    c.beginPath();
    c.roundRect(t.x, t.y, t.w, t.h, 22);
    c.fill();
    c.strokeStyle = colors.line;
    c.stroke();
    c.fillStyle = colors.muted;
    c.font = font(600, 20);
    c.fillText(t.label.toUpperCase(), t.x + 24, t.y + 40);
    c.fillStyle = colors.text;
    c.font = font(700, 44);
    c.fillText(t.value, t.x + 24, t.y + 94, t.w - 48);
    const pts = sparkPoints(t.values, t.max, { x: t.x + 24, y: t.y + 112, w: t.w - 48, h: t.h - 132 });
    if (pts.length > 1) {
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.strokeStyle = COLOR[t.metric];
      c.lineWidth = 3;
      c.lineJoin = 'round';
      c.stroke();
      c.lineTo(pts[pts.length - 1][0], t.y + t.h - 20);
      c.lineTo(pts[0][0], t.y + t.h - 20);
      c.closePath();
      c.globalAlpha = 0.16;
      c.fillStyle = COLOR[t.metric];
      c.fill();
      c.globalAlpha = 1;
    }
  }
}

export function ShareCardDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const { latest, recent } = useLive(1000);
  const [theme, setTheme] = useState<CardTheme>(() => (document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [frozen, setFrozen] = useState<{ latest: NonNullable<typeof latest>; recent: typeof recent } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Freeze the first full reading so the picture does not change while you look at it.
  useEffect(() => { if (!frozen && latest && recent.length > 2) setFrozen({ latest, recent }); }, [latest, recent, frozen]);
  useEffect(() => { if (frozen && canvas.current) draw(canvas.current, shareCardLayout(frozen.latest, frozen.recent, { theme })); }, [frozen, theme]);
  const url = () => canvas.current?.toDataURL('image/png') ?? '';
  return (
    <Modal title="Share card" onClose={onClose} width={720}>
      <canvas ref={canvas} className="mon-share-preview" aria-label="Share card preview" />
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <div className="seg">{(['light', 'dark', 'transparent'] as const).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        <button className="btn ghost sm" onClick={() => setFrozen(latest ? { latest, recent } : frozen)}>Refresh</button>
        <span className="grow" />
        <button className="btn" disabled={!frozen} onClick={async () => {
          try {
            const blob = await (await fetch(url())).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast('Copied the picture');
          } catch {
            toast('Could not copy; save it instead');
          }
        }}>Copy</button>
        <button className="btn primary" disabled={!frozen} onClick={async () => { const p = await api.tools.saveAs(`Keeper readings ${new Date().toISOString().slice(0, 16).replace(':', '.')}.png`, url()); if (p) { toast(`Saved ${p.split(/[\\/]/).pop()}`); onClose(); } }}>Save PNG…</button>
      </div>
    </Modal>
  );
}
