// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { defaultRecipe, keystoneQuad, normalizeRecipe, type Overlay } from '../core/photo-edit';
import { drawOverlays, overlayBounds, type Ctx2D } from '../core/photo-overlay';
import {
  alphaLevels, applyColour, bandWeights, blendByWeight, compose, copyDisc, coverBox, curveLut, gradient, grain, guidedFilter, healSpot, isIdentity, mixDetail, normaliseMask, paintStrokes, pictureStats, redEye,
  shadowFor, shiftMask, toneLut, vignette, warpQuad,
} from '../core/photo-pixels';

const solid = (w: number, h: number, rgb: [number, number, number], ch = 3) => { const d = new Uint8Array(w * h * ch); for (let i = 0; i < w * h; i++) { d.set(rgb, i * ch); if (ch === 4) d[i * ch + 3] = 255; } return d; };
const px = (d: Uint8Array, w: number, x: number, y: number, ch = 3) => Array.from(d.subarray((y * w + x) * ch, (y * w + x) * ch + 3));

describe('the default recipe', () => {
  it('reads the same as text after cleaning (so "nothing changed" is reliable)', () => {
    expect(JSON.stringify(normalizeRecipe(defaultRecipe()))).toBe(JSON.stringify(defaultRecipe()));
  });
});

describe('tones', () => {
  it('a straight curve changes nothing; a raised middle lifts mid-tones only', () => {
    expect(isIdentity(curveLut([[0, 0], [255, 255]]))).toBe(true);
    const lut = curveLut([[0, 0], [128, 170], [255, 255]]);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[128]).toBe(170);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });
  it('shadows lift the dark end, highlights pull the light end, blacks and whites move the ends', () => {
    const none = toneLut({ highlights: 0, shadows: 0, whites: 0, blacks: 0, curve: [] });
    expect(isIdentity(none)).toBe(true);
    const sh = toneLut({ highlights: 0, shadows: 100, whites: 0, blacks: 0, curve: [] });
    expect(sh[60]).toBeGreaterThan(70);
    expect(sh[240] - 240).toBeLessThan(4);
    const hi = toneLut({ highlights: -100, shadows: 0, whites: 0, blacks: 0, curve: [] });
    expect(hi[200]).toBeLessThan(190);
    expect(Math.abs(hi[30] - 30)).toBeLessThan(5);
    expect(toneLut({ highlights: 0, shadows: 0, whites: 0, blacks: 100, curve: [] })[0]).toBeGreaterThan(20);
    expect(toneLut({ highlights: 0, shadows: 0, whites: 0, blacks: -100, curve: [] })[20]).toBe(0);
    expect(toneLut({ highlights: 0, shadows: 0, whites: 100, blacks: 0, curve: [] })[230]).toBe(255);
  });
  it('vibrance lifts muted colour more than strong colour', () => {
    const d = new Uint8Array([140, 120, 110, 250, 30, 30]);
    applyColour(d, 3, { vibrance: 60 });
    expect(d[0] - d[2]).toBeGreaterThan(30);
    expect(d[3]).toBe(255);
  });
  it('colour mix moves only the chosen colour', () => {
    const d = new Uint8Array([40, 80, 220, 220, 60, 50]);
    applyColour(d, 3, { hsl: { blue: [0, -100, 0] } });
    expect(Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2])).toBeLessThan(20);
    expect([d[3], d[4], d[5]]).toEqual([220, 60, 50]);
    const w = bandWeights(45);
    expect(w[1] + w[2]).toBeCloseTo(1, 6);
    expect(bandWeights(350)[0]).toBeGreaterThan(0.5);
  });
  it('clarity adds the difference from a blur back', () => {
    const d = new Uint8Array([100, 100, 100]);
    mixDetail(d, new Uint8Array([90, 110, 100]), 3, 1);
    expect(Array.from(d)).toEqual([110, 90, 100]);
  });
});

describe('effects', () => {
  it('vignette darkens corners, not the middle', () => {
    const d = solid(40, 30, [200, 200, 200]);
    vignette(d, 3, 40, 30, -100);
    expect(px(d, 40, 20, 15)).toEqual([200, 200, 200]);
    expect(px(d, 40, 0, 0)[0]).toBeLessThan(120);
  });
  it('grain is the same for the same size (previews match the file)', () => {
    const a = solid(30, 20, [128, 128, 128]);
    const b = solid(30, 20, [128, 128, 128]);
    grain(a, 3, 30, 20, 60);
    grain(b, 3, 30, 20, 60);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(Array.from(a)).size).toBeGreaterThan(5);
  });
  it('statistics for auto enhance', () => {
    const s = pictureStats(solid(10, 10, [100, 120, 140], 4), 4);
    expect(s.mean.map(Math.round)).toEqual([100, 120, 140]);
    expect(s.p1).toBe(s.p99);
    expect(s.sat).toBeCloseTo(40 / 140, 3);
  });
});

describe('retouching', () => {
  it('heals a dark speck on an even surface', () => {
    const w = 80, h = 60;
    const d = solid(w, h, [180, 170, 160]);
    for (let y = 27; y < 33; y++) for (let x = 37; x < 43; x++) d.set([10, 10, 10], (y * w + x) * 3);
    healSpot(d, 3, w, h, 40, 30, 5);
    const c = px(d, w, 40, 30);
    expect(Math.abs(c[0] - 180)).toBeLessThan(10);
  });
  it('heals at the very edge too (filling from the rim)', () => {
    const w = 20, h = 20;
    const d = solid(w, h, [90, 90, 90]);
    d.set([250, 0, 0], 0);
    healSpot(d, 3, w, h, 0, 0, 6);
    expect(px(d, w, 0, 0)[1]).toBeGreaterThan(40);
  });
  it('clones a disc from one place to another', () => {
    const w = 60, h = 40;
    const d = solid(w, h, [0, 0, 0]);
    for (let y = 15; y < 25; y++) for (let x = 5; x < 15; x++) d.set([255, 255, 255], (y * w + x) * 3);
    copyDisc(d, 3, w, h, 45, 20, 10, 20, 4);
    expect(px(d, w, 45, 20)).toEqual([255, 255, 255]);
    expect(px(d, w, 30, 20)).toEqual([0, 0, 0]);
  });
  it('takes the red out of red eyes and leaves other colours', () => {
    const w = 20, h = 20;
    const d = solid(w, h, [200, 40, 40]);
    d.set([40, 120, 200], (10 * w + 12) * 3);
    expect(redEye(d, 3, w, h, 10, 10, 4)).toBeGreaterThan(10);
    expect(px(d, w, 10, 10)[0]).toBeLessThan(60);
    expect(px(d, w, 12, 10)).toEqual([40, 120, 200]);
    expect(px(d, w, 0, 0)[0]).toBe(200);
  });
});

describe('perspective', () => {
  it('stretches the top of the picture across the whole width', () => {
    const w = 40, h = 40;
    const d = new Uint8Array(w * h);
    // A dot at the top, a third of the way in from the left.
    d[2 * w + 13] = 255;
    const out = warpQuad(d, 1, w, h, keystoneQuad(w, h, 100, 0));
    let best = 0, at = -1;
    for (let x = 0; x < w; x++) if (out[2 * w + x] > best) { best = out[2 * w + x]; at = x; }
    // 13 is inside the pulled-in top (12 to 28); it moves outwards, towards the left edge.
    expect(at).toBeLessThan(6);
    expect(warpQuad(new Uint8Array([1, 2, 3, 4]), 1, 2, 2, keystoneQuad(2, 2, 0, 0))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe('the cut-out', () => {
  it('the model mask follows the picture’s own edge (guided filter)', () => {
    const w = 40, h = 20;
    const guide = new Float32Array(w * h);
    const rough = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { guide[y * w + x] = x < 20 ? 0.9 : 0.1; rough[y * w + x] = x < 15 ? 1 : x < 25 ? 0.5 : 0; }
    const out = guidedFilter(guide, rough, w, h, 4, 1e-3);
    // The rough mask was flat across the edge; the filtered one steps down where the picture does.
    expect(out[10 * w + 18] - out[10 * w + 21]).toBeGreaterThan(0.15);
    expect(out[10 * w + 5]).toBeGreaterThan(0.9);
    expect(out[10 * w + 35]).toBeLessThan(0.1);
  });
  it('model output becomes 0–255', () => {
    expect(Array.from(normaliseMask([-2, 0, 2], 3))).toEqual([0, 128, 255]);
  });
  it('the refine brush keeps and removes, softly', () => {
    const w = 50, h = 50;
    const a = new Uint8Array(w * h);
    paintStrokes(a, w, h, [{ keep: true, r: 0.1, pts: [0.2, 0.5, 0.8, 0.5] }]);
    expect(a[25 * w + 25]).toBe(255);
    expect(a[5 * w + 25]).toBe(0);
    paintStrokes(a, w, h, [{ keep: false, r: 0.1, pts: [0.5, 0.5] }]);
    expect(a[25 * w + 25]).toBe(0);
    expect(a[25 * w + 12]).toBe(255);
  });
  it('grow and shrink move the edge', () => {
    const grow = new Uint8Array([60, 128, 200]);
    alphaLevels(grow, 80);
    expect(grow[0]).toBeGreaterThan(150);
    const shrink = new Uint8Array([60, 128, 200]);
    alphaLevels(shrink, -80);
    expect(shrink[2]).toBeLessThan(100);
  });
});

describe('new backgrounds', () => {
  it('a gradient runs from one colour to the other', () => {
    const g = gradient(10, 10, '#000000', '#ffffff', 0);
    expect(px(g, 10, 5, 0)[0]).toBe(0);
    expect(px(g, 10, 5, 9)[0]).toBe(255);
    const side = gradient(10, 10, '#ff0000', '#0000ff', 90);
    expect(px(side, 10, 0, 5)).toEqual([255, 0, 0]);
    expect(px(side, 10, 9, 5)).toEqual([0, 0, 255]);
  });
  it('a picture fills the background without stretching', () => {
    expect(coverBox(4000, 3000, 1000, 1000)).toEqual({ left: 500, top: 0, width: 3000, height: 3000 });
    expect(coverBox(1000, 2000, 1600, 900)).toEqual({ left: 0, top: 718, width: 1000, height: 563 });
  });
  it('the subject sits over the background, with a shadow darkening it', () => {
    const fg = new Uint8Array([255, 0, 0, 255, 0, 0]);
    const bg = new Uint8Array([0, 0, 255, 0, 0, 255]);
    expect(Array.from(compose(fg, new Uint8Array([255, 0]), bg))).toEqual([255, 0, 0, 0, 0, 255]);
    expect(Array.from(compose(fg, new Uint8Array([0, 0]), bg, { mask: new Uint8Array([255, 0]), opacity: 0.5 }))).toEqual([0, 0, 128, 0, 0, 255]);
    const s = shadowFor(1000, 800, 100);
    expect(s.dy).toBeGreaterThan(s.dx);
    expect(s.opacity).toBeLessThanOrEqual(0.85);
    expect(Array.from(shiftMask(new Uint8Array([9, 0, 0, 0]), 2, 2, 1, 1))).toEqual([0, 0, 0, 9]);
  });
  it('the blurred background leaves the subject out', () => {
    expect(Array.from(blendByWeight(new Uint8Array([10, 20, 30, 255, 99, 99, 99, 0]), new Uint8Array([1, 2, 3, 4, 5, 6])))).toEqual([10, 20, 30, 4, 5, 6]);
  });
});

describe('things added on top', () => {
  const fake = () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 50 }) : typeof k === 'string' && /^(save|restore|translate|rotate|beginPath|moveTo|lineTo|closePath|stroke|fill|fillRect|strokeRect|ellipse|fillText)$/.test(k) ? (...a: unknown[]) => calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? Math.round(x) : x)).join(',')})`) : undefined), set: () => true }) as unknown as Ctx2D;
    return { ctx, calls };
  };
  it('draws text where asked, stickers, shapes, a watermark in its corner and the frame last', () => {
    const { ctx, calls } = fake();
    const items: Overlay[] = [
      { kind: 'frame', style: 'plain', size: 0.05, colour: '#ffffff' },
      { kind: 'text', text: 'Hi\nthere', x: 0.5, y: 0.5, size: 0.1, colour: '#ffffff', font: 'serif', bold: true, shadow: true },
      { kind: 'sticker', emoji: '✨', x: 0.25, y: 0.25, size: 0.2 },
      { kind: 'shape', shape: 'arrow', x: 0.1, y: 0.1, w: 0.2, h: 0, colour: '#ff0000', width: 0.01, fill: false },
      { kind: 'watermark', text: '© Me', place: 'br', size: 0.05, opacity: 0.5, colour: '#ffffff' },
    ];
    drawOverlays(ctx, items, 1000, 500);
    expect(calls).toContain('fillText(Hi,500,221)');
    expect(calls).toContain('fillText(there,500,280)');
    expect(calls).toContain('fillText(✨,250,125)');
    expect(calls.some((c) => c.startsWith('fillText(© Me,'))).toBe(true);
    expect(calls.filter((c) => c.startsWith('fillRect')).length).toBe(4);
    expect(calls.lastIndexOf('fillRect(0,0,1000,25)')).toBeGreaterThan(calls.indexOf('fillText(✨,250,125)'));
  });
  it('is self-contained, so it can be drawn in a separate window', () => {
    const src = drawOverlays.toString();
    expect(() => new Function(`return (${src})`)()).not.toThrow();
  });
  it('knows roughly where text and stickers sit (to choose them)', () => {
    const b = overlayBounds({ kind: 'sticker', emoji: '⭐', x: 0.5, y: 0.5, size: 0.2 }, 1000, 500)!;
    expect(b.w).toBeCloseTo(0.1, 6);
    expect(b.h).toBeCloseTo(0.2, 6);
    expect(overlayBounds({ kind: 'frame', style: 'plain', size: 0.02, colour: '#fff' }, 10, 10)).toBeNull();
  });
});
