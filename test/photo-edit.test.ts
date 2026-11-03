// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  aspectCrop, contrastLinear, copyName, defaultRecipe, describeRecipe, EDITABLE, exposureFactor, fitSide, isUnchanged, normalizeRecipe, outputFormat, replaceKeepsName, saturationFactor,
  straightenBox, temperatureMatrix, toPixels, turnedSize,
} from '../core/photo-edit';

describe('the recipe', () => {
  it('starts with nothing changed', () => {
    expect(isUnchanged(defaultRecipe())).toBe(true);
    expect(describeRecipe(defaultRecipe())).toBe('No changes');
  });
  it('keeps values in range and drops what does not belong', () => {
    const r = normalizeRecipe({ turns: 5, flip: 'yes', straighten: 90, exposure: 500, contrast: -500, crop: { x: 0.9, y: 0.1, w: 0.5, h: 0.5 }, redact: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, kind: 'laser' }, { x: 0, y: 0, w: 0, h: 0, kind: 'box' }], maxSide: 1234, format: 'gif' });
    expect(r).toMatchObject({ turns: 0, flip: false, straighten: 45, exposure: 100, contrast: -100, maxSide: 0, format: 'same' });
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
    expect(outputFormat(defaultRecipe(), '.heic')).toBe('jpeg');
    expect(outputFormat(normalizeRecipe({ cutout: true }), '.jpg')).toBe('png');
    expect(outputFormat(normalizeRecipe({ cutout: true, format: 'jpeg' }), '.jpg')).toBe('png');
    expect(outputFormat(normalizeRecipe({ format: 'webp' }), '.png')).toBe('webp');
  });
  it('saving over the original keeps its name only in the same format', () => {
    expect(replaceKeepsName(defaultRecipe(), '.jpeg')).toBe(true);
    expect(replaceKeepsName(defaultRecipe(), '.jpg')).toBe(true);
    expect(replaceKeepsName(normalizeRecipe({ format: 'png' }), '.jpg')).toBe(false);
    expect(replaceKeepsName(defaultRecipe(), '.heic')).toBe(false);
  });
  it('names a copy beside the original', () => {
    expect(copyName('Holiday.jpg', 'jpeg')).toBe('Holiday (edited).jpg');
    expect(copyName('Holiday (edited).jpg', 'png')).toBe('Holiday (edited).png');
    expect(EDITABLE.test('a.HEIC')).toBe(true);
    expect(EDITABLE.test('a.pdf')).toBe(false);
  });
});
