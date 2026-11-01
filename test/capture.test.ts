// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
  CaptureHistory, arrowHead, beautifyLayout, classifyText, describeColor, editedName, mergeCaptureOptions, normRect, pixelate,
  recordingName, screenshotName, tidyText, toHex, toHsl,
} from '../core/capture';
import { decodeCode } from '../core/codes';

/** Draws a 0/1 module grid as black-on-white RGBA pixels with a quiet zone. */
function render(modules: (x: number, y: number) => boolean, w: number, h: number, scale: number, quiet = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const width = (w + quiet * 2) * scale;
  const height = (h + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!modules(x, y)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width, height };
}

/** An EAN-13 barcode's bars (95 modules). */
function ean13(code: string): boolean[] {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  return bits.split('').map((b) => b === '1');
}

describe('capture history', () => {
  it('keeps the newest first, moves repeats to the top and caps the length', () => {
    const h = new CaptureHistory(3);
    h.add({ kind: 'text', value: 'a', at: 1 });
    h.add({ kind: 'text', value: 'b', at: 2 });
    h.add({ kind: 'text', value: 'a', at: 3 });
    expect(h.items.map((x) => x.value)).toEqual(['a', 'b']);
    h.add({ kind: 'qr', value: 'https://example.com', at: 4 });
    h.add({ kind: 'color', value: '#ffffff', at: 5 });
    expect(h.items).toHaveLength(3);
    expect(h.add({ kind: 'text', value: '   ' })).toBeUndefined();
    expect(h.filter('links').map((x) => x.value)).toEqual(['https://example.com']);
    expect(h.filter('codes')).toHaveLength(1);
    expect(h.filter('media').map((x) => x.kind)).toEqual(['color']);
    h.remove(h.items[0].id);
    expect(h.items).toHaveLength(2);
    h.clear();
    expect(h.items).toEqual([]);
  });

  it('options fall back to defaults for bad values', () => {
    const o = mergeCaptureOptions({ keepLineBreaks: false, accurate: 'yes', screenshotShortcut: 'Ctrl+P' });
    expect(o.keepLineBreaks).toBe(false);
    expect(o.accurate).toBe(true);
    expect(o.screenshotShortcut).toBe('Ctrl+P');
  });
});

describe('text clean-up', () => {
  const raw = 'The quick brown\nfox jumps over the\nlazy dog. Infor-\nmation here.\n\n- first item\n- second item';
  it('keeps line breaks when asked', () => {
    expect(tidyText(raw, true)).toBe(raw);
  });
  it('joins wrapped lines, re-joins hyphenated words and keeps lists', () => {
    expect(tidyText(raw, false)).toBe('The quick brown fox jumps over the lazy dog. Information here.\n\n- first item\n- second item');
  });
  it('classifies links', () => {
    expect(classifyText('https://example.com/a?b=c')).toBe('link');
    expect(classifyText('see https://example.com')).toBe('text');
  });
});

describe('colours', () => {
  it('converts to hex, rgb and hsl', () => {
    expect(toHex(255, 111, 163)).toBe('#ff6fa3');
    expect(toHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
    expect(toHsl(128, 128, 128)).toEqual({ h: 0, s: 0, l: 50 });
    expect(describeColor(0, 128, 255)).toEqual({ hex: '#0080ff', rgb: 'rgb(0, 128, 255)', hsl: 'hsl(210, 100%, 50%)' });
  });
});

describe('annotate geometry', () => {
  it('arrow heads sit behind the tip, symmetric around the shaft', () => {
    const [l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(l.x).toBeCloseTo(100 - 20 * Math.cos(Math.PI / 7));
    expect(r.x).toBeCloseTo(l.x);
    expect(l.y).toBeCloseTo(-r.y);
    expect(Math.hypot(l.x - 100, l.y)).toBeCloseTo(20);
  });
  it('normalises and clamps rectangles', () => {
    expect(normRect({ x: 50, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, w: 40, h: 35 });
    expect(normRect({ x: -10, y: -10 }, { x: 500, y: 500 }, 200, 100)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
  it('pixelates blocks to their average', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    pixelate(data, 2, 2, 2);
    expect([...data.slice(0, 4)]).toEqual([128, 128, 128, 255]);
    expect([...data.slice(12, 16)]).toEqual([128, 128, 128, 255]);
  });
  it('beautify layout adds padding and a title bar', () => {
    const l = beautifyLayout(800, 600, { padding: 40, radius: 10, shadow: 20, frame: true, background: 'dusk' });
    expect(l.width).toBe(880);
    expect(l.height).toBe(600 + 34 + 80);
    expect(l.image).toEqual({ x: 40, y: 74, w: 800, h: 600 });
    expect(beautifyLayout(10, 10, { padding: 0, radius: 0, shadow: 0, frame: false, background: 'none' })).toMatchObject({ width: 10, height: 10, image: { x: 0, y: 0 } });
  });
});

describe('file names', () => {
  it('screenshots, recordings and edited copies', () => {
    const d = new Date(2026, 9, 30, 9, 4, 5);
    expect(screenshotName(d)).toBe('Screenshot 2026-10-30 at 09.04.05.png');
    expect(recordingName(d, 'mp4')).toBe('Screen Recording 2026-10-30 at 09.04.05.mp4');
    expect(editedName('photo.jpg')).toBe('photo (edited).png');
    expect(editedName('photo (edited).png', (n) => n === 'photo (edited).png')).toBe('photo (edited 2).png');
  });
});

describe('codes', () => {
  it('decodes a QR code', () => {
    const qr = QRCode.create('https://github.com/ashfordeOU/keeper', { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const img = render((x, y) => !!qr.modules.get(y, x), n, n, 6);
    expect(decodeCode(img.data, img.width, img.height)).toEqual({ value: 'https://github.com/ashfordeOU/keeper', format: 'QR_CODE' });
  });
  it('decodes an EAN-13 barcode, in RGBA and BGRA', () => {
    const bars = ean13('4006381333931');
    const img = render((x) => bars[x], bars.length, 60, 3, 10);
    expect(decodeCode(img.data, img.width, img.height)).toEqual({ value: '4006381333931', format: 'EAN_13' });
    expect(decodeCode(img.data, img.width, img.height, true)?.value).toBe('4006381333931');
  });
  it('returns nothing for a blank image', () => {
    const blank = new Uint8ClampedArray(40 * 40 * 4).fill(255);
    expect(decodeCode(blank, 40, 40)).toBeUndefined();
  });
});
