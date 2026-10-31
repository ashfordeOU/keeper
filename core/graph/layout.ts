// SPDX-License-Identifier: AGPL-3.0-or-later
// A force layout for the knowledge graph that stays quick with many thousands
// of nodes: Barnes–Hut repulsion (a quadtree, so each step is n·log n), springs
// along links, and a gentle pull to the middle. Deterministic for a given seed,
// and run a few steps at a time so the interface never freezes.

/** Small seeded random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Quad {
  x0: number; y0: number; size: number;
  mass: number; cx: number; cy: number;
  body: number;
  kids: (Quad | null)[] | null;
}

export interface LayoutOptions {
  seed?: number;
  repulsion?: number;
  spring?: number;
  springLength?: number;
  gravity?: number;
  theta?: number;
  damping?: number;
}

export class ForceLayout {
  readonly x: Float64Array;
  readonly y: Float64Array;
  private vx: Float64Array;
  private vy: Float64Array;
  /** nodes the person dragged and holds still */
  pinned = new Set<number>();
  alpha = 1;
  private o: Required<LayoutOptions>;

  constructor(readonly n: number, private edges: { a: number; b: number; w: number }[], opts: LayoutOptions = {}) {
    this.o = { seed: 1, repulsion: 60, spring: 0.04, springLength: 30, gravity: 0.01, theta: 0.9, damping: 0.85, ...opts };
    const r = rng(this.o.seed);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    // Start on a spiral so nothing sits on top of anything else.
    const spread = Math.sqrt(n) * 12 + 20;
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963 + r() * 0.3;
      const d = spread * Math.sqrt((i + 0.5) / Math.max(1, n));
      this.x[i] = Math.cos(a) * d;
      this.y[i] = Math.sin(a) * d;
    }
  }

  private build(): Quad | null {
    if (!this.n) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.x[i] < minX) minX = this.x[i];
      if (this.y[i] < minY) minY = this.y[i];
      if (this.x[i] > maxX) maxX = this.x[i];
      if (this.y[i] > maxY) maxY = this.y[i];
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
    const root: Quad = { x0: minX, y0: minY, size, mass: 0, cx: 0, cy: 0, body: -1, kids: null };
    for (let i = 0; i < this.n; i++) this.insert(root, i, 0);
    return root;
  }

  private insert(q: Quad, i: number, depth: number) {
    const px = this.x[i], py = this.y[i];
    q.cx = (q.cx * q.mass + px) / (q.mass + 1);
    q.cy = (q.cy * q.mass + py) / (q.mass + 1);
    q.mass++;
    if (q.mass === 1) { q.body = i; return; }
    // Too deep (points on top of each other): keep them together in this cell.
    if (depth > 40) return;
    if (!q.kids) {
      q.kids = [null, null, null, null];
      const old = q.body;
      q.body = -1;
      if (old >= 0) this.place(q, old, depth);
    }
    this.place(q, i, depth);
  }

  private place(q: Quad, i: number, depth: number) {
    const h = q.size / 2;
    const k = (this.x[i] >= q.x0 + h ? 1 : 0) + (this.y[i] >= q.y0 + h ? 2 : 0);
    let c = q.kids![k];
    if (!c) c = q.kids![k] = { x0: q.x0 + (k & 1 ? h : 0), y0: q.y0 + (k & 2 ? h : 0), size: h, mass: 0, cx: 0, cy: 0, body: -1, kids: null };
    this.insert(c, i, depth + 1);
  }

  private repel(q: Quad, i: number, out: [number, number]) {
    if (!q.mass || q.body === i) return;
    const dx = q.cx - this.x[i], dy = q.cy - this.y[i];
    let d2 = dx * dx + dy * dy;
    if (!q.kids || (q.size * q.size) / Math.max(d2, 1e-6) < this.o.theta * this.o.theta) {
      if (d2 < 1) d2 = 1;
      const f = (this.o.repulsion * q.mass) / d2;
      const d = Math.sqrt(d2);
      out[0] -= (dx / d) * f;
      out[1] -= (dy / d) * f;
      return;
    }
    for (const c of q.kids) if (c) this.repel(c, i, out);
  }

  /** One step; returns how much things moved (it shrinks as the layout settles). */
  step(): number {
    const root = this.build();
    const fx = new Float64Array(this.n), fy = new Float64Array(this.n);
    const tmp: [number, number] = [0, 0];
    for (let i = 0; i < this.n; i++) {
      tmp[0] = 0; tmp[1] = 0;
      if (root) this.repel(root, i, tmp);
      fx[i] = tmp[0] - this.x[i] * this.o.gravity;
      fy[i] = tmp[1] - this.y[i] * this.o.gravity;
    }
    for (const e of this.edges) {
      const dx = this.x[e.b] - this.x[e.a], dy = this.y[e.b] - this.y[e.a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = this.o.spring * Math.min(3, e.w) * (d - this.o.springLength);
      const ux = (dx / d) * f, uy = (dy / d) * f;
      fx[e.a] += ux; fy[e.a] += uy;
      fx[e.b] -= ux; fy[e.b] -= uy;
    }
    let moved = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.pinned.has(i)) { this.vx[i] = this.vy[i] = 0; continue; }
      this.vx[i] = (this.vx[i] + fx[i] * this.alpha) * this.o.damping;
      this.vy[i] = (this.vy[i] + fy[i] * this.alpha) * this.o.damping;
      // Cap the speed so a crowded start does not fling nodes away.
      const sp = Math.hypot(this.vx[i], this.vy[i]);
      if (sp > 40) { this.vx[i] *= 40 / sp; this.vy[i] *= 40 / sp; }
      this.x[i] += this.vx[i];
      this.y[i] += this.vy[i];
      moved += Math.abs(this.vx[i]) + Math.abs(this.vy[i]);
    }
    this.alpha = Math.max(0.02, this.alpha * 0.985);
    return this.n ? moved / this.n : 0;
  }

  /** Runs steps until the time budget is used up or it has settled. */
  run(budgetMs: number, now: () => number = () => Date.now()): boolean {
    const t0 = now();
    let m = Infinity;
    while (now() - t0 < budgetMs) {
      m = this.step();
      if (m < 0.05) return true;
    }
    return false;
  }
}
