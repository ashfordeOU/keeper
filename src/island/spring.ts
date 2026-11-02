// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small spring driver for the Island's shape: each value (width, height,
// corner radius, the deck's highlight) is a damped spring (mass 1) that moves
// towards its target on animation frames. A new target keeps the speed it has,
// so a hover that turns into an open, or a close that turns back into an open,
// is one continuous motion. It runs only while something moves: once every
// value has settled there is no animation frame left waiting (nothing runs
// while the Island is idle). The frame step is pure and tested without a page.

export interface SpringParams {
  /** stiffness */
  k: number;
  /** damping (critical damping is 2 × √k) */
  c: number;
}

/** The Island's motions (stiffness, damping), from the redesign's motion table. */
export const SPRINGS = {
  /** the pointer arrives: a small grow */
  breath: { k: 520, c: 30 },
  /** closed or breathing → the open panel or a card (about 3 % past the target) */
  open: { k: 380, c: 28 },
  /** open → closed: critically damped, never bounces */
  close: { k: 600, c: 49 },
  /** one view's size to another's */
  view: { k: 450, c: 38 },
  /** the wings beside the notch change (another activity) */
  wing: { k: 500, c: 40 },
  /** a Live Activity card or an alert */
  live: { k: 420, c: 32 },
} as const satisfies Record<string, SpringParams>;

export interface SpringValue {
  x: number;
  v: number;
  target: number;
  p: SpringParams;
}

/** Close enough to stop: within a third of a pixel, and slower than 2 px a second. */
const REST_X = 0.33;
const REST_V = 2;
/** the largest step integrated at once (stays stable for these stiffnesses) */
const STEP = 1 / 240;

/** Advances one value by dt seconds. Returns true once it is at rest (then exactly on its target). */
export function stepSpring(s: SpringValue, dt: number): boolean {
  let left = Math.min(dt, 0.064); // a long stall (a hidden window) does not fling the shape
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    // Semi-implicit Euler: stable and cheap for a stiff, damped spring.
    const a = -s.p.k * (s.x - s.target) - s.p.c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x - s.target) < REST_X && Math.abs(s.v) < REST_V) {
    s.x = s.target;
    s.v = 0;
    return true;
  }
  return false;
}

/** How far past its target a spring goes from rest (0.03 = 3 %); for the tests and the settings. */
export function overshoot(p: SpringParams, from = 0, to = 100): number {
  const s: SpringValue = { x: from, v: 0, target: to, p };
  let peak = from;
  for (let i = 0; i < 2000 && !stepSpring(s, 1 / 120); i++) peak = to > from ? Math.max(peak, s.x) : Math.min(peak, s.x);
  return Math.abs(peak - to) / Math.abs(to - from);
}

/** About how long a spring takes to settle from rest, in ms. */
export function settleMs(p: SpringParams, from = 0, to = 100): number {
  const s: SpringValue = { x: from, v: 0, target: to, p };
  let t = 0;
  while (!stepSpring(s, 1 / 120) && t < 5000) t += 1000 / 120;
  return Math.round(t);
}

type Frame = (cb: (t: number) => void) => number;

/**
 * A set of named springs drawn together. `to` sets targets (keeping speed) and starts the frame loop
 * if it is not running; `jump` sets values at once (reduced motion, the first layout). Each frame calls
 * `draw` with the current values; when all are at rest the loop stops and `onRest` runs.
 */
export class SpringSet<K extends string> {
  private v = new Map<K, SpringValue>();
  private raf = 0;
  private last = 0;
  private restWaiters: (() => void)[] = [];
  constructor(
    private draw: (values: Record<K, number>) => void,
    private frame: Frame = (cb) => requestAnimationFrame(cb),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  get(): Record<K, number> {
    const out = {} as Record<K, number>;
    for (const [k, s] of this.v) out[k] = s.x;
    return out;
  }

  /** whether a frame is waiting (something is still moving) */
  get running(): boolean {
    return this.raf !== 0;
  }

  /** Values straight to these, no motion (reduced motion, or the first time). */
  jump(values: Partial<Record<K, number>>) {
    for (const [k, x] of Object.entries(values) as [K, number][]) {
      if (!Number.isFinite(x)) continue;
      const s = this.v.get(k);
      if (s) { s.x = x; s.v = 0; s.target = x; } else this.v.set(k, { x, v: 0, target: x, p: SPRINGS.open });
    }
    if (![...this.v.values()].some((s) => s.x !== s.target || s.v !== 0)) this.stop();
    this.draw(this.get());
  }

  /** Moves towards these targets with these spring settings, keeping the speed each value has. */
  to(values: Partial<Record<K, number>>, p: SpringParams) {
    let moved = false;
    for (const [k, x] of Object.entries(values) as [K, number][]) {
      if (!Number.isFinite(x)) continue;
      const s = this.v.get(k);
      if (!s) { this.v.set(k, { x, v: 0, target: x, p }); moved = true; continue; }
      if (s.target === x && s.x === x && s.v === 0) continue;
      s.target = x;
      s.p = p;
      moved = true;
    }
    if (!moved) return;
    this.draw(this.get());
    if (!this.raf) {
      this.last = 0;
      this.raf = this.frame(this.tick);
    }
  }

  /** Runs once everything has stopped moving (at once if nothing moves). */
  whenAtRest(cb: () => void) {
    if (!this.raf) cb();
    else this.restWaiters.push(cb);
  }

  stop() {
    if (this.raf) this.cancel(this.raf);
    this.raf = 0;
    const w = this.restWaiters.splice(0);
    for (const cb of w) cb();
  }

  private tick = (t: number) => {
    const dt = this.last ? (t - this.last) / 1000 : 1 / 60;
    this.last = t;
    let rest = true;
    for (const s of this.v.values()) if (!stepSpring(s, dt)) rest = false;
    this.draw(this.get());
    if (rest) { this.raf = 0; this.stop(); return; }
    this.raf = this.frame(this.tick);
  };
}
