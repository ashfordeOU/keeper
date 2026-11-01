// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Space Map bubbles: every folder is a bubble sized by the space it uses.
// Grab one and throw it — they bounce off each other and the walls.

import { useEffect, useRef } from 'react';
import { bubbleAt, packBubbles, stepBubbles, type Bubble } from '../../core/bubbles';
import { formatBytes } from '../../core/format';
import type { SpaceNode } from '../../core/types';
import '../styles/screens-x.css';

export function BubbleView({ items, width, height, palette, onOpen, onMenu }: { items: SpaceNode[]; width: number; height: number; palette: string[]; onOpen: (n: SpaceNode) => void; onMenu: (e: { clientX: number; clientY: number }, n: SpaceNode) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bubbles = useRef<Bubble<{ node: SpaceNode; color: string }>[]>([]);
  const drag = useRef<{ b: Bubble<{ node: SpaceNode; color: string }>; dx: number; dy: number; moved: number; last: { x: number; y: number; t: number }[] } | null>(null);
  const raf = useRef(0);
  const hover = useRef<Bubble<{ node: SpaceNode; color: string }> | undefined>(undefined);

  useEffect(() => {
    bubbles.current = packBubbles(items.map((n, i) => ({ size: n.size, item: { node: n, color: n.path ? palette[i % palette.length] : '#8a8a93' } })), width, height);
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, width, height, palette.join()]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function draw() {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== width * dpr || c.height !== height * dpr) {
      c.width = width * dpr;
      c.height = height * dpr;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    for (const b of bubbles.current) {
      const grad = g.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.35, b.item.color);
      grad.addColorStop(1, b.item.color);
      g.globalAlpha = hover.current === b || drag.current?.b === b ? 1 : 0.9;
      g.beginPath();
      g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      g.fillStyle = grad;
      g.fill();
      g.globalAlpha = 1;
      if (b.item.node.cleanable) {
        g.lineWidth = 2;
        g.setLineDash([5, 4]);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.stroke();
        g.setLineDash([]);
      }
      if (b.r > 26) {
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.font = `600 ${Math.min(15, Math.max(10, b.r / 5))}px system-ui, sans-serif`;
        const name = b.item.node.name.length > 18 ? b.item.node.name.slice(0, 17) + '…' : b.item.node.name;
        g.fillText(name, b.x, b.y - 2, b.r * 1.8);
        g.font = `${Math.min(13, Math.max(9, b.r / 6))}px system-ui, sans-serif`;
        g.globalAlpha = 0.85;
        g.fillText(formatBytes(b.item.node.size), b.x, b.y + Math.min(15, b.r / 4.5), b.r * 1.8);
        g.globalAlpha = 1;
      }
    }
  }

  function kick() {
    cancelAnimationFrame(raf.current);
    const loop = () => {
      const moving = stepBubbles(bubbles.current, width, height);
      draw();
      if (moving || drag.current) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }

  const pos = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="bubbles" style={{ height }}>
      <canvas
        ref={canvas}
        style={{ width, height, cursor: hover.current ? 'grab' : 'default' }}
        onPointerDown={(e) => {
          const p = pos(e);
          const b = bubbleAt(bubbles.current, p.x, p.y);
          if (!b || e.button !== 0) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          b.held = true;
          b.vx = b.vy = 0;
          drag.current = { b, dx: p.x - b.x, dy: p.y - b.y, moved: 0, last: [{ ...p, t: performance.now() }] };
          kick();
        }}
        onPointerMove={(e) => {
          const p = pos(e);
          const d = drag.current;
          if (d) {
            d.moved += Math.abs(p.x - d.dx - d.b.x) + Math.abs(p.y - d.dy - d.b.y);
            d.b.x = Math.max(d.b.r, Math.min(width - d.b.r, p.x - d.dx));
            d.b.y = Math.max(d.b.r, Math.min(height - d.b.r, p.y - d.dy));
            d.last = [...d.last.slice(-4), { ...p, t: performance.now() }];
            return;
          }
          const h = bubbleAt(bubbles.current, p.x, p.y);
          if (h !== hover.current) {
            hover.current = h;
            canvas.current!.title = h ? `${h.item.node.name} — ${formatBytes(h.item.node.size)}${h.item.node.cleanable ? ' · cleanable' : ''}` : '';
            draw();
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          d.b.held = false;
          if (d.moved < 6) {
            onOpen(d.b.item.node);
            return;
          }
          // Throw: velocity from the last few pointer positions.
          const a = d.last[0];
          const z = d.last[d.last.length - 1];
          const dt = Math.max(16, z.t - a.t) / 16;
          d.b.vx = Math.max(-40, Math.min(40, (z.x - a.x) / dt));
          d.b.vy = Math.max(-40, Math.min(40, (z.y - a.y) / dt));
          kick();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = pos(e);
          const b = bubbleAt(bubbles.current, p.x, p.y);
          if (b && b.item.node.path) onMenu(e, b.item.node);
        }}
      />
    </div>
  );
}
