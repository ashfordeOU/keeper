// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's spring driver: the motions' feel (overshoot, settle), interruption keeping speed, and no frame left waiting at rest.
import { describe, expect, it } from 'vitest';
import { SPRINGS, SpringSet, overshoot, settleMs, stepSpring, type SpringValue } from '../src/island/spring';

/** A frame clock the test advances by hand. */
function clock() {
  let t = 0;
  let next = 1;
  const queue = new Map<number, (t: number) => void>();
  return {
    frame: (cb: (t: number) => void) => { const id = next++; queue.set(id, cb); return id; },
    cancel: (id: number) => { queue.delete(id); },
    get waiting() { return queue.size; },
    tick(ms = 1000 / 120) {
      t += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(t);
    },
  };
}

describe('spring motions', () => {
  it('open overshoots a little, close never does', () => {
    expect(overshoot(SPRINGS.open)).toBeGreaterThan(0.01);
    expect(overshoot(SPRINGS.open)).toBeLessThan(0.06);
    expect(overshoot(SPRINGS.close)).toBeLessThan(0.002);
    expect(overshoot(SPRINGS.close, 100, 0)).toBeLessThan(0.002);
    expect(overshoot(SPRINGS.view)).toBeLessThan(overshoot(SPRINGS.open));
  });

  it('settles in about the times of the motion table', () => {
    expect(settleMs(SPRINGS.open, 0, 300)).toBeGreaterThan(200);
    expect(settleMs(SPRINGS.open, 0, 300)).toBeLessThan(700);
    expect(settleMs(SPRINGS.close, 300, 0)).toBeLessThan(500);
    expect(settleMs(SPRINGS.breath, 0, 12)).toBeLessThan(400);
  });

  it('ends exactly on the target', () => {
    const s: SpringValue = { x: 0, v: 0, target: 77.5, p: SPRINGS.view };
    let n = 0;
    while (!stepSpring(s, 1 / 60) && n++ < 1000);
    expect(s.x).toBe(77.5);
    expect(s.v).toBe(0);
  });

  it('a long stall does not fling the value', () => {
    const s: SpringValue = { x: 0, v: 0, target: 100, p: SPRINGS.open };
    stepSpring(s, 5);
    expect(s.x).toBeLessThan(120);
  });
});

describe('SpringSet', () => {
  it('runs frames only while something moves, then stops and says so', () => {
    const c = clock();
    const drawn: number[] = [];
    const set = new SpringSet<'h'>((v) => drawn.push(v.h), c.frame, c.cancel);
    set.jump({ h: 32 });
    expect(set.running).toBe(false);
    expect(c.waiting).toBe(0);
    let rested = false;
    set.to({ h: 300 }, SPRINGS.open);
    set.whenAtRest(() => { rested = true; });
    expect(set.running).toBe(true);
    for (let i = 0; i < 400 && set.running; i++) c.tick();
    expect(set.running).toBe(false);
    expect(rested).toBe(true);
    expect(c.waiting).toBe(0);
    expect(drawn[drawn.length - 1]).toBe(300);
    // A target it already has starts nothing.
    set.to({ h: 300 }, SPRINGS.view);
    expect(set.running).toBe(false);
  });

  it('a new target keeps the speed it has (breath into open is one motion)', () => {
    const c = clock();
    const set = new SpringSet<'h'>(() => undefined, c.frame, c.cancel);
    set.jump({ h: 32 });
    set.to({ h: 38 }, SPRINGS.breath);
    for (let i = 0; i < 6; i++) c.tick();
    const mid = set.get().h;
    expect(mid).toBeGreaterThan(32);
    set.to({ h: 300 }, SPRINGS.open);
    c.tick();
    // Still moving up from where it was, with no jump back or stop.
    expect(set.get().h).toBeGreaterThan(mid);
    expect(set.get().h).toBeLessThan(mid + 20);
  });

  it('a close interrupted by an open turns around smoothly', () => {
    const c = clock();
    const set = new SpringSet<'h'>(() => undefined, c.frame, c.cancel);
    set.jump({ h: 300 });
    set.to({ h: 32 }, SPRINGS.close);
    for (let i = 0; i < 8; i++) c.tick();
    const a = set.get().h;
    set.to({ h: 300 }, SPRINGS.open);
    c.tick();
    const b = set.get().h;
    // It was falling fast: one frame later it is still near where it was, not snapped anywhere.
    expect(Math.abs(b - a)).toBeLessThan(25);
    for (let i = 0; i < 400 && set.running; i++) c.tick();
    expect(set.get().h).toBe(300);
  });

  it('jump stops a running motion and calls those waiting for rest', () => {
    const c = clock();
    const set = new SpringSet<'w'>(() => undefined, c.frame, c.cancel);
    set.jump({ w: 0 });
    set.to({ w: 100 }, SPRINGS.open);
    let rested = false;
    set.whenAtRest(() => { rested = true; });
    set.jump({ w: 100 });
    expect(set.running).toBe(false);
    expect(rested).toBe(true);
    expect(c.waiting).toBe(0);
  });
});
