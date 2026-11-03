// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { findScroll, normalizeTimer, opacityForKey, pinOpacity, pinSize, previewBounds, previewStack, shadowFor, stitch, wheelSteps, withShadow, type Bitmap } from '../core/capture-extras';
import { mergeCaptureOptions } from '../core/capture';

/** A tall "page" of varied rows (text-like stripes), and windows onto it. */
function page(w: number, h: number): Bitmap {
  const data = new Uint8Array(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    const line = y % 18 < 12;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = line && rnd() < 0.35 ? 30 : 245;
      data[i] = ink; data[i + 1] = ink; data[i + 2] = (ink + y) & 255; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}
function view(p: Bitmap, top: number, h: number, header = 0, footer = 0): Bitmap {
  const out = new Uint8Array(p.width * h * 4);
  const row = p.width * 4;
  for (let y = 0; y < h; y++) {
    let src = top + y;
    if (y < header) src = y; // a fixed header: always the page's first rows
    if (y >= h - footer) src = p.height - (h - y); // a fixed footer: the page's last rows
    out.set(p.data.subarray(src * row, (src + 1) * row), y * row);
  }
  return { data: out, width: p.width, height: h };
}

describe('scrolling capture', () => {
  const P = page(120, 900);
  it('finds how far the page moved', () => {
    const m = findScroll(view(P, 0, 200), view(P, 70, 200));
    expect(m.shift).toBe(70);
    expect(m.error).toBeLessThan(1);
  });
  it('sees when nothing moved (the end of the page)', () => {
    expect(findScroll(view(P, 100, 200), view(P, 100, 200)).shift).toBe(0);
  });
  it('says so when the frames do not overlap', () => {
    expect(findScroll(view(P, 0, 200), view(P, 400, 200)).shift).toBe(-1);
  });
  it('leaves a fixed header and footer out of the match', () => {
    const m = findScroll(view(P, 0, 240, 30, 20), view(P, 90, 240, 30, 20));
    expect(m.shift).toBe(90);
    expect(m.top).toBeGreaterThanOrEqual(30);
    expect(m.bottom).toBeGreaterThanOrEqual(20);
  });
  it('stitches frames back into the page', () => {
    const frames = [view(P, 0, 200), view(P, 120, 200), view(P, 250, 200)];
    const ms = [findScroll(frames[0], frames[1]), findScroll(frames[1], frames[2])];
    const out = stitch(frames, ms);
    expect(out.height).toBe(450);
    expect(Buffer.from(out.data).equals(Buffer.from(view(P, 0, 450).data))).toBe(true);
  });
  it('stitches with a fixed footer kept once at the bottom', () => {
    const frames = [view(P, 0, 200, 0, 25), view(P, 100, 200, 0, 25)];
    const out = stitch(frames, [findScroll(frames[0], frames[1])]);
    expect(out.height).toBe(300);
    const row = P.width * 4;
    // the last rows are the footer, once
    expect(Buffer.from(out.data.subarray((300 - 25) * row)).equals(Buffer.from(frames[1].data.subarray((200 - 25) * row)))).toBe(true);
  });
  it('picks a wheel step for the area', () => {
    expect(wheelSteps(400)).toBe(3);
    expect(wheelSteps(20)).toBe(1);
    expect(wheelSteps(10_000)).toBe(15);
  });
});

describe('window shadow', () => {
  it('puts the window on a see-through background with a soft shadow below', () => {
    const w = 40, h = 30;
    const data = new Uint8Array(w * h * 4).fill(200);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const out = withShadow({ data, width: w, height: h }, { blur: 9, offsetY: 4, opacity: 0.5, corner: 0 });
    const pad = Math.ceil(9 * 1.5) + 4;
    expect(out.width).toBe(w + pad * 2);
    expect(out.data[3]).toBe(0); // the far corner is clear
    const centre = ((pad + 15) * out.width + pad + 20) * 4;
    expect(out.data[centre + 3]).toBe(255);
    expect(out.data[centre]).toBe(200);
    // below the window: shadow, fading out
    const under = ((pad + h + 2) * out.width + pad + 20) * 4 + 3;
    const further = ((pad + h + 10) * out.width + pad + 20) * 4 + 3;
    expect(out.data[under]).toBeGreaterThan(0);
    expect(out.data[under]).toBeGreaterThan(out.data[further]);
    expect(out.data[under]).toBeLessThanOrEqual(128);
  });
  it('rounds the corners when asked', () => {
    const w = 40, h = 30;
    const out = withShadow({ data: new Uint8Array(w * h * 4).fill(255), width: w, height: h }, { blur: 3, offsetY: 0, opacity: 0, corner: 8 });
    const pad = Math.ceil(3 * 1.5);
    const corner = (pad * out.width + pad) * 4 + 3;
    expect(out.data[corner]).toBe(0);
  });
  it('scales with the screen', () => {
    expect(shadowFor(2, true)).toEqual({ blur: 56, offsetY: 24, opacity: 0.45, corner: 20 });
    expect(shadowFor(1, false).corner).toBe(0);
  });
});

describe('small choices', () => {
  it('self-timer and options', () => {
    expect(normalizeTimer(5)).toBe(5);
    expect(normalizeTimer(7)).toBe(0);
    const o = mergeCaptureOptions({ timer: 7, quickSeconds: 900, quickPreview: false });
    expect(o.timer).toBe(0);
    expect(o.quickSeconds).toBe(60);
    expect(o.quickPreview).toBe(false);
    expect(mergeCaptureOptions(null).windowShadow).toBe(true);
  });
  it('pin opacity and size', () => {
    expect(pinOpacity(0.01)).toBe(0.2);
    expect(pinOpacity(1.4)).toBe(1);
    expect(opacityForKey('5')).toBe(0.5);
    expect(opacityForKey('0')).toBe(1);
    expect(opacityForKey('1')).toBe(0.2);
    expect(opacityForKey('x')).toBeNull();
    expect(pinSize({ width: 800, height: 600 }, 2, { width: 1440, height: 900 })).toEqual({ width: 400, height: 300 });
    expect(pinSize({ width: 4000, height: 1000 }, 1, { width: 1000, height: 800 })).toEqual({ width: 600, height: 150 });
  });
  it('previews stack in the corner', () => {
    expect(previewStack([1, 2, 3, 4, 5, 6], 4)).toEqual({ shown: [3, 4, 5, 6], more: 2 });
    const b = previewBounds({ x: 0, y: 25, width: 1440, height: 875 }, 2);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
    expect(b.y + b.height).toBeLessThanOrEqual(900);
    expect(b.height).toBeGreaterThan(2 * 158);
  });
});
