// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  aspectCrop, autoAdjust, contrastLinear, copyName, defaultRecipe, describeRecipe, describeStep, EDITABLE, exposureFactor, extendPixels, fitSide, isUnchanged, keystoneQuad, lockedSize, normalizeRecipe, outputFormat, outputSize,
  project, replaceKeepsName, saturationFactor, seeThrough, squareToQuad, straightenBox, temperatureMatrix, toPixels, turnedSize, whiteBalanceFor,
} from '../core/photo-edit';
import { applyLook, cleanLooks, isLookApplied, lookFrom, LOOKS } from '../core/photo-presets';
import { chooseModel, CUTOUT_MODELS } from '../core/cutout-models';

describe('the recipe', () => {
  it('starts with nothing changed', () => {
    expect(isUnchanged(defaultRecipe())).toBe(true);
    expect(describeRecipe(defaultRecipe())).toBe('No changes');
  });
  it('keeps values in range and drops what does not belong', () => {
    const r = normalizeRecipe({ turns: 5, flip: 'yes', straighten: 90, exposure: 500, contrast: -500, crop: { x: 0.9, y: 0.1, w: 0.5, h: 0.5 }, redact: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, kind: 'laser' }, { x: 0, y: 0, w: 0, h: 0, kind: 'box' }], maxSide: 1234.4, format: 'tga', sharpen: -40, hsl: { red: [500, 0, 0], blue: [0, 0, 0], nope: [1, 1, 1] }, curve: [[300, 10], [0, 0], [128, 140]] });
    expect(r).toMatchObject({ turns: 0, flip: false, straighten: 45, exposure: 100, contrast: -100, maxSide: 1234, format: 'same', sharpen: 0 });
    expect(r.hsl).toEqual({ red: [100, 0, 0] });
    expect(r.curve).toEqual([[0, 0], [128, 140], [255, 10]]);
    expect(r.crop!.x).toBe(0.9);
    expect(r.crop!.w).toBeCloseTo(0.1, 5);
    expect(r.redact).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, kind: 'blur' }]);
    expect(normalizeRecipe(null)).toEqual(defaultRecipe());
  });
  it('a crop of the whole picture is no crop', () => {
    expect(normalizeRecipe({ crop: { x: 0, y: 0, w: 1, h: 1 } }).crop).toBeUndefined();
    expect(isUnchanged(normalizeRecipe({ crop: { x: 0, y: 0, w: 1, h: 1 } }))).toBe(true);
  });
  it('describes the edits in short words', () => {
    expect(describeRecipe(normalizeRecipe({ turns: 1, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, exposure: 20, temperature: -10, redact: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, kind: 'box' }], cutout: true }))).toBe('Turned · Cropped · Brighter · Cooler · 1 area hidden · Background removed');
    expect(describeRecipe(normalizeRecipe({ saturation: -100, straighten: 2 }))).toBe('Straightened · Black and white');
  });
});

describe('geometry', () => {
  it('quarter turns swap the sides', () => {
    expect(turnedSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
    expect(turnedSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
  });
  it('straightening keeps the largest upright part of the same shape', () => {
    expect(straightenBox(400, 300, 0)).toEqual({ canvasW: 400, canvasH: 300, left: 0, top: 0, width: 400, height: 300 });
    const b = straightenBox(400, 300, 10);
    expect(b.width / b.height).toBeCloseTo(4 / 3, 1);
    expect(b.width).toBeLessThan(400);
    expect(b.left + b.width).toBeLessThanOrEqual(b.canvasW);
    // The kept rectangle's corners are inside the turned picture.
    const a = (10 * Math.PI) / 180;
    const cx = b.canvasW / 2;
    const cy = b.canvasH / 2;
    for (const [x, y] of [[b.left, b.top], [b.left + b.width, b.top], [b.left, b.top + b.height], [b.left + b.width, b.top + b.height]]) {
      const dx = x - cx; const dy = y - cy;
      const u = dx * Math.cos(a) + dy * Math.sin(a);
      const v = -dx * Math.sin(a) + dy * Math.cos(a);
      expect(Math.abs(u)).toBeLessThanOrEqual(200 + 1);
      expect(Math.abs(v)).toBeLessThanOrEqual(150 + 1);
    }
    expect(straightenBox(400, 300, -10).width).toBe(b.width);
  });
  it('fractions become pixels inside the picture', () => {
    expect(toPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 400, 300)).toEqual({ left: 100, top: 150, width: 200, height: 150 });
    expect(toPixels({ x: 0.999, y: 0.999, w: 0.5, h: 0.5 }, 100, 100)).toEqual({ left: 99, top: 99, width: 1, height: 1 });
  });
  it('fits a longest side without making pictures bigger', () => {
    expect(fitSide(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitSide(800, 600, 1600)).toEqual({ w: 800, h: 600 });
    expect(fitSide(800, 600, 0)).toEqual({ w: 800, h: 600 });
  });
  it('crop shapes are centred and as big as they can be', () => {
    expect(aspectCrop(400, 300, 1)).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1 });
    const c = aspectCrop(400, 300, 16 / 9);
    expect(c.w).toBe(1);
    expect(c.h * 300).toBeCloseTo(225, 5);
  });
});

describe('light and colour', () => {
  it('maps the sliders to sharp numbers', () => {
    expect(exposureFactor(0)).toBe(1);
    expect(exposureFactor(100)).toBeCloseTo(2.828, 3);
    expect(exposureFactor(-100)).toBeCloseTo(0.354, 3);
    expect(contrastLinear(0)).toEqual({ a: 1, b: 0 });
    expect(contrastLinear(50)).toEqual({ a: 1.4, b: -51.2 });
    expect(contrastLinear(-100).a).toBeCloseTo(0.4, 5);
    expect(saturationFactor(-100)).toBe(0);
    expect(temperatureMatrix(0)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const warm = temperatureMatrix(100);
    expect(warm[0][0]).toBeGreaterThan(1);
    expect(warm[2][2]).toBeLessThan(1);
  });
});

describe('saving', () => {
  it('writes the original’s format unless asked; cut-outs need PNG', () => {
    expect(outputFormat(defaultRecipe(), '.JPG')).toBe('jpeg');
    expect(outputFormat(defaultRecipe(), '.png')).toBe('png');
    expect(outputFormat(defaultRecipe(), '.heic')).toBe('heic');
    expect(outputFormat(defaultRecipe(), '.heic', false, 'linux')).toBe('jpeg');
    expect(outputFormat(defaultRecipe(), '.heic', false, 'darwin')).toBe('heic');
    expect(outputFormat(defaultRecipe(), '.cr2')).toBe('jpeg');
    expect(outputFormat(defaultRecipe(), '.gif')).toBe('gif');
    expect(outputFormat(defaultRecipe(), '.tif')).toBe('tiff');
    expect(outputFormat(normalizeRecipe({ cutout: true }), '.jpg')).toBe('png');
    expect(outputFormat(normalizeRecipe({ cutout: true, format: 'jpeg' }), '.jpg')).toBe('png');
    expect(outputFormat(normalizeRecipe({ cutout: true, format: 'webp' }), '.jpg')).toBe('webp');
    // A new background fills the see-through part: the original's format is fine again.
    expect(outputFormat(normalizeRecipe({ cutout: true, background: { kind: 'colour', colour: '#ff0000' } }), '.jpg')).toBe('jpeg');
    expect(outputFormat(normalizeRecipe({ format: 'webp' }), '.png')).toBe('webp');
    expect(outputFormat(normalizeRecipe({ extend: { t: 0.1, r: 0, b: 0, l: 0, colour: 'clear' } }), '.jpg')).toBe('png');
    expect(outputFormat(normalizeRecipe({ extend: { t: 0.1, r: 0, b: 0, l: 0, colour: '#ffffff' } }), '.jpg')).toBe('jpeg');
  });
  it('saving over the original keeps its name only in the same format', () => {
    expect(replaceKeepsName(defaultRecipe(), '.jpeg')).toBe(true);
    expect(replaceKeepsName(defaultRecipe(), '.jpg')).toBe(true);
    expect(replaceKeepsName(normalizeRecipe({ format: 'png' }), '.jpg')).toBe(false);
    expect(replaceKeepsName(defaultRecipe(), '.heic', false, 'linux')).toBe(false);
    expect(replaceKeepsName(defaultRecipe(), '.heic', false, 'darwin')).toBe(true);
    expect(replaceKeepsName(defaultRecipe(), '.tif')).toBe(true);
    expect(replaceKeepsName(defaultRecipe(), '.nef')).toBe(false);
  });
  it('names a copy beside the original', () => {
    expect(copyName('Holiday.jpg', 'jpeg')).toBe('Holiday (edited).jpg');
    expect(copyName('Holiday (edited).jpg', 'png')).toBe('Holiday (edited).png');
    expect(copyName('Shot.cr2', 'jpeg')).toBe('Shot (edited).jpg');
    for (const n of ['a.HEIC', 'a.cr3', 'b.NEF', 'c.arw', 'd.raf', 'e.orf', 'f.rw2', 'g.dng', 'h.psd', 'i.svg', 'j.ico', 'k.bmp', 'l.avif', 'm.gif', 'n.tif']) expect(EDITABLE.test(n), n).toBe(true);
    expect(EDITABLE.test('a.pdf')).toBe(false);
    expect(EDITABLE.test('a.docx')).toBe(false);
  });
});

describe('the fuller recipe', () => {
  it('cleans what is added on top, and drops empty text', () => {
    const r = normalizeRecipe({ overlays: [
      { kind: 'text', text: 'Hello\u0007', x: 2, y: 0.2, colour: 'red', font: 'comic' },
      { kind: 'text', text: '   ' },
      { kind: 'sticker', emoji: '✨', size: 9 },
      { kind: 'watermark', text: '© Me', place: 'nowhere' },
      { kind: 'frame', style: 'print', colour: '#ABCDEF' },
      { kind: 'laser' },
    ] });
    expect(r.overlays.map((o) => o.kind)).toEqual(['text', 'sticker', 'watermark', 'frame']);
    expect(r.overlays[0]).toMatchObject({ text: 'Hello', x: 1, colour: '#ffffff', font: 'sans' });
    expect(r.overlays[1]).toMatchObject({ size: 0.8 });
    expect(r.overlays[2]).toMatchObject({ place: 'br' });
    expect(r.overlays[3]).toMatchObject({ colour: '#abcdef' });
  });
  it('keeps retouched spots, brush strokes and a background in range', () => {
    const r = normalizeRecipe({
      retouch: [{ kind: 'clone', x: 0.5, y: 0.5, r: 2 }, { kind: 'zap', x: -1, y: 0.2 }],
      strokes: [{ keep: true, r: 0.05, pts: [0.1, 0.2, 0.3] }, { pts: [] }],
      background: { kind: 'picture' }, cutout: true, feather: 400, edge: -400,
    });
    expect(r.retouch).toEqual([{ kind: 'clone', x: 0.5, y: 0.5, r: 0.25, sx: 0.5, sy: 0.5 }, { kind: 'heal', x: 0, y: 0.2, r: 0.03 }]);
    expect(r.strokes).toEqual([{ keep: true, r: 0.05, pts: [0.1, 0.2] }]);
    expect(r.background.kind).toBe('clear');
    expect(r.feather).toBe(100);
    expect(r.edge).toBe(-100);
    expect(normalizeRecipe({ background: { kind: 'picture', picture: '/p/sea.jpg', shadow: 40 } }).background).toMatchObject({ kind: 'picture', picture: '/p/sea.jpg', shadow: 40 });
  });
  it('save options alone are not an edit, but a new format is', () => {
    expect(isUnchanged(normalizeRecipe({ quality: 50, metadata: 'strip', profile: 'srgb' }))).toBe(true);
    expect(isUnchanged(normalizeRecipe({ format: 'webp' }))).toBe(false);
  });
  it('knows when the result is see-through', () => {
    expect(seeThrough(normalizeRecipe({ cutout: true }), false)).toBe(true);
    expect(seeThrough(normalizeRecipe({ cutout: true, background: { kind: 'gradient' } }), true)).toBe(false);
    expect(seeThrough(defaultRecipe(), true)).toBe(true);
  });
  it('describes every step of the history in a few words', () => {
    const a = defaultRecipe();
    expect(describeStep(a, { ...a, exposure: 20 })).toBe('Light +20');
    expect(describeStep(a, { ...a, turns: 1 })).toBe('Turned right');
    expect(describeStep(a, { ...a, turns: 3 })).toBe('Turned left');
    expect(describeStep(a, { ...a, cutout: true })).toBe('Background removed');
    expect(describeStep(a, normalizeRecipe({ background: { kind: 'blur', shadow: 30 } }))).toBe('Background: blurred, shadow');
    expect(describeStep(a, normalizeRecipe({ overlays: [{ kind: 'sticker', emoji: '⭐' }] }))).toBe('Added a sticker');
    expect(describeStep(a, normalizeRecipe({ retouch: [{ kind: 'redeye', x: 0.1, y: 0.1, r: 0.01 }] }))).toBe('Red eye fixed');
    expect(describeStep(a, { ...a, exposure: 10, contrast: 5, vibrance: 3, blacks: -4 })).toBe('Auto enhance');
    expect(describeStep(a, applyLook(a, LOOKS[0]))).toBe(`Look: ${LOOKS[0].name}`);
    expect(describeStep(a, a)).toBe('No change');
  });
});

describe('size, canvas and perspective', () => {
  it('an exact size, one side with the shape kept, or a longest side', () => {
    expect(outputSize(4000, 3000, { width: 800, height: 800, maxSide: 0 })).toEqual({ w: 800, h: 800 });
    expect(outputSize(4000, 3000, { width: 800, height: 0, maxSide: 0 })).toEqual({ w: 800, h: 600 });
    expect(outputSize(4000, 3000, { width: 0, height: 300, maxSide: 0 })).toEqual({ w: 400, h: 300 });
    expect(outputSize(4000, 3000, { width: 0, height: 0, maxSide: 1000 })).toEqual({ w: 1000, h: 750 });
    expect(lockedSize(4000, 3000, 'w', 2000)).toEqual({ w: 2000, h: 1500 });
    expect(lockedSize(4000, 3000, 'h', 300)).toEqual({ w: 400, h: 300 });
  });
  it('more canvas in pixels', () => {
    expect(extendPixels(1000, 500, { t: 0.1, r: 0.2, b: 0, l: 0.05, colour: 'clear' })).toEqual({ top: 50, right: 200, bottom: 0, left: 50 });
  });
  it('keystone: the stretched part stays inside the picture and the corners land where asked', () => {
    const q = keystoneQuad(1000, 800, 50, 0);
    expect(q[0]).toEqual([150, 0]);
    expect(q[1]).toEqual([850, 0]);
    expect(q[2]).toEqual([1000, 800]);
    const m = squareToQuad(q);
    for (const [[u, v], [x, y]] of [[[0, 0], q[0]], [[1, 0], q[1]], [[1, 1], q[2]], [[0, 1], q[3]]] as [[number, number], [number, number]][]) {
      const [px, py] = project(m, u, v);
      expect(px).toBeCloseTo(x, 6);
      expect(py).toBeCloseTo(y, 6);
    }
    const side = keystoneQuad(1000, 800, 0, -100);
    expect(side[1][1]).toBeCloseTo(240, 6);
    expect(side[0][1]).toBe(0);
  });
});

describe('white balance and auto enhance', () => {
  it('makes a picked colour grey', () => {
    const wb = whiteBalanceFor([220, 200, 160], { temperature: 0, tint: 0 });
    expect(wb.temperature).toBeLessThan(0);
    const m = temperatureMatrix(wb.temperature, wb.tint);
    const [r, g, b] = [220 * m[0][0], 200 * m[1][1], 160 * m[2][2]];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    expect(whiteBalanceFor([128, 128, 128], { temperature: 0, tint: 0 })).toEqual({ temperature: 0, tint: 0 });
  });
  it('a dark, flat, blue picture gets lighter, more contrast and warmer', () => {
    const a = autoAdjust({ mean: [60, 70, 100], p1: 30, p50: 60, p99: 150, sat: 0.2 });
    expect(a.exposure).toBeGreaterThan(20);
    expect(a.contrast).toBeGreaterThan(0);
    expect(a.temperature).toBeGreaterThan(0);
    expect(a.vibrance).toBeGreaterThan(0);
    const fine = autoAdjust({ mean: [118, 118, 118], p1: 4, p50: 118, p99: 250, sat: 0.5 });
    expect(fine).toMatchObject({ exposure: 0, contrast: 0, temperature: 0, tint: 0, vibrance: 0 });
  });
});

describe('looks', () => {
  it('set only light and colour, and show as chosen', () => {
    const base = normalizeRecipe({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, cutout: true, exposure: 50 });
    const mono = LOOKS.find((l) => l.id === 'mono')!;
    const r = applyLook(base, mono);
    expect(r.saturation).toBe(-100);
    expect(r.exposure).toBe(0);
    expect(r.crop).toEqual(base.crop);
    expect(r.cutout).toBe(true);
    expect(r.look).toBe('Mono');
    expect(isLookApplied(r, mono)).toBe(true);
    expect(isLookApplied(r, LOOKS[0])).toBe(false);
  });
  it('own looks are saved from the sliders and read back cleanly', () => {
    const mine = lookFrom(normalizeRecipe({ exposure: 12, hsl: { blue: [0, 30, 0] } }), '  Seaside  ');
    expect(mine).toMatchObject({ id: 'own-seaside', name: 'Seaside', own: true, values: { exposure: 12, hsl: { blue: [0, 30, 0] } } });
    expect(cleanLooks([mine, { name: 7 }, null, mine])).toHaveLength(1);
    expect(LOOKS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
  });
});

describe('cut-out models', () => {
  it('are pinned, openly licensed, and the small one is used until the larger is downloaded', () => {
    for (const m of Object.values(CUTOUT_MODELS)) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.url).toMatch(/^https:\/\/github\.com\//);
      expect(m.licence).toBe('Apache-2.0');
    }
    expect(chooseModel('best', false)).toBe('fast');
    expect(chooseModel('best', true)).toBe('best');
    expect(chooseModel('fast', true)).toBe('fast');
  });
});
