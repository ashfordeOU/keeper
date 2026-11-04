// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { readExifDetails } from '../core/exifDetails';
import {
  canSave, cleanExif, crc32, exifTiff, extensionFor, hasLocation, isEditablePicture, isRaw, openedNote, openRoutes, orientationTurns, pngWithExif, readBmp, sameFormatAs, SAVE_FORMATS, writeBmp,
} from '../core/photo-formats';
import { largestJpeg } from '../core/raw';

/** A little-endian TIFF/EXIF block: IFD0 with Make, Orientation and a GPS pointer; a GPS IFD with a latitude. */
function makeExif(orientation = 6): Uint8Array {
  const b = new Uint8Array(200);
  const dv = new DataView(b.buffer);
  b.set([0x49, 0x49, 0x2a, 0x00]);
  dv.setUint32(4, 8, true);
  // IFD0: 3 entries
  dv.setUint16(8, 3, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => { dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true); dv.setUint32(at + 4, count, true); dv.setUint32(at + 8, value, true); };
  entry(10, 0x010f, 2, 4, 0x6f6d6544); // Make "Demo" inline
  entry(22, 0x0112, 3, 1, orientation);
  entry(34, 0x8825, 4, 1, 60);
  dv.setUint32(46, 0, true); // next IFD
  // GPS IFD at 60: GPSLatitudeRef 'N', GPSLatitude 3 rationals at 100
  dv.setUint16(60, 2, true);
  entry(62, 0x0001, 2, 2, 0x4e);
  entry(74, 0x0002, 5, 3, 100);
  dv.setUint32(86, 0, true);
  for (let i = 0; i < 3; i++) { dv.setUint32(100 + i * 8, [51, 30, 12][i], true); dv.setUint32(104 + i * 8, 1, true); }
  return b;
}

describe('what the editor opens', () => {
  it('every common format, camera RAW, Photoshop, icons and drawings', () => {
    for (const n of ['a.jpg', 'b.JPEG', 'c.png', 'd.webp', 'e.avif', 'f.heic', 'g.heif', 'h.tiff', 'i.gif', 'j.bmp', 'k.ico', 'l.svg', 'm.psd', 'n.cr2', 'o.cr3', 'p.nef', 'q.arw', 'r.raf', 's.orf', 't.rw2', 'u.dng', 'v.jxl']) expect(isEditablePicture(n), n).toBe(true);
    expect(isEditablePicture('notes.txt')).toBe(false);
    expect(isRaw('X.NEF')).toBe(true);
    expect(isRaw('x.jpg')).toBe(false);
  });
  it('RAW: the system decoder where there is one, else the camera’s own preview', () => {
    expect(openRoutes('a.cr3', 'darwin')).toEqual(['system', 'embedded']);
    expect(openRoutes('a.cr3', 'win32')).toEqual(['system', 'embedded']);
    expect(openRoutes('a.cr3', 'linux')).toEqual(['embedded']);
    expect(openRoutes('a.heic', 'linux')).toEqual(['sharp', 'heif']);
    expect(openRoutes('a.heic', 'darwin')).toEqual(['sharp', 'system', 'heif']);
    expect(openRoutes('a.psd', 'linux')).toEqual(['psd']);
    expect(openRoutes('a.bmp', 'linux')).toEqual(['bmp']);
    expect(openRoutes('a.jpg', 'linux')).toEqual(['sharp']);
    expect(openedNote('embedded')).toMatch(/preview the camera saved/);
    expect(openedNote('psd')).toMatch(/flattened/i);
    expect(openedNote('sharp')).toBeUndefined();
  });
  it('the largest embedded JPEG is the RAW file’s full-size preview', () => {
    const jpeg = (n: number) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0, 0]); for (let i = 8; i < n - 2; i++) b[i] = i % 200; b[n - 2] = 0xff; b[n - 1] = 0xd9; return b; };
    const small = jpeg(3000);
    const big = jpeg(9000);
    const raw = new Uint8Array(20000);
    raw.set([0x49, 0x49, 0x2a, 0x00]);
    raw.set(small, 100);
    raw.set(big, 5000);
    const got = largestJpeg(raw)!;
    expect(got.length).toBe(9000);
    expect(got[got.length - 1]).toBe(0xd9);
  });
  it('turns a RAW preview the way the camera was held', () => {
    expect(orientationTurns(6)).toEqual({ turns: 1, flip: false });
    expect(orientationTurns(8)).toEqual({ turns: 3, flip: false });
    expect(orientationTurns(3)).toEqual({ turns: 2, flip: false });
    expect(orientationTurns(2)).toEqual({ turns: 0, flip: true });
    expect(orientationTurns(undefined)).toEqual({ turns: 0, flip: false });
  });
});

describe('what it saves', () => {
  it('every format, with HEIC only on a Mac (and saying why)', () => {
    expect(SAVE_FORMATS.map((f) => f.id)).toEqual(['jpeg', 'png', 'webp', 'avif', 'heic', 'tiff', 'gif', 'bmp', 'ico', 'pdf']);
    expect(canSave('heic', 'darwin').ok).toBe(true);
    expect(canSave('heic', 'linux')).toMatchObject({ ok: false, why: expect.stringMatching(/Mac/) });
    expect(canSave('heic', 'win32').ok).toBe(false);
    expect(canSave('avif', 'linux').ok).toBe(true);
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(extensionFor('ico')).toBe('ico');
  });
  it('saves back in the same format when it can', () => {
    expect(sameFormatAs('a.JPG')).toBe('jpeg');
    expect(sameFormatAs('a.tif')).toBe('tiff');
    expect(sameFormatAs('a.heif')).toBe('heic');
    expect(sameFormatAs('a.gif')).toBe('gif');
    expect(sameFormatAs('a.nef')).toBe('jpeg');
    expect(sameFormatAs('a.psd')).toBe('jpeg');
  });
});

describe('the photo’s details', () => {
  it('reads EXIF with or without its "Exif" prefix', () => {
    const t = makeExif();
    expect(exifTiff(t)).toBe(t);
    const pre = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...t]);
    expect(exifTiff(pre)?.[0]).toBe(0x49);
    expect(exifTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeUndefined();
  });
  it('keeps the details with the turn baked in (upright)', () => {
    const t = cleanExif(makeExif(6));
    expect(readExifDetails(t)?.orientation).toBe(1);
    expect(hasLocation(t)).toBe(true);
  });
  it('removes where it was taken, leaving no trace of it in the bytes', () => {
    const t = cleanExif(makeExif(6), { noLocation: true });
    expect(hasLocation(t)).toBe(false);
    // The latitude's numbers are gone from the bytes.
    const dv = new DataView(t.buffer);
    expect(dv.getUint32(100, true)).toBe(0);
    expect(dv.getUint32(108, true)).toBe(0);
    // The rest is still there and readable.
    expect(readExifDetails(t)?.orientation).toBe(1);
    expect(dv.getUint16(8, true)).toBe(2);
    expect(hasLocation(makeExif())).toBe(true);
  });
  it('puts EXIF into a PNG as an eXIf chunk with a correct checksum', () => {
    const png = new Uint8Array(45);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const out = pngWithExif(png, new Uint8Array([1, 2, 3]));
    expect(out.length).toBe(45 + 15);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('eXIf');
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(33)).toBe(3);
    expect(dv.getUint32(44)).toBe(crc32(out.subarray(37, 44)));
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('BMP', () => {
  it('writes and reads back 24-bit and 32-bit pictures exactly', () => {
    const w = 5, h = 3;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i * 10, 255 - i * 10, i * 3, i % 2 ? 128 : 255], i * 4);
    const clear = readBmp(writeBmp(rgba, w, h, true));
    expect(clear.width).toBe(5);
    expect(Array.from(clear.data)).toEqual(Array.from(rgba));
    const solid = readBmp(writeBmp(rgba, w, h, false));
    for (let i = 0; i < w * h; i++) expect(Array.from(solid.data.subarray(i * 4, i * 4 + 4))).toEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], 255]);
  });
  it('reads 8-bit palette pictures', () => {
    const w = 2, h = 2;
    const b = new Uint8Array(14 + 40 + 256 * 4 + 8);
    const dv = new DataView(b.buffer);
    b[0] = 0x42; b[1] = 0x4d;
    dv.setUint32(10, 14 + 40 + 1024, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 8, true);
    b.set([0, 0, 255, 0], 54 + 4); // colour 1: red (stored BGR0)
    b[54 + 1024] = 1; // bottom-left pixel is colour 1
    const r = readBmp(b);
    expect(Array.from(r.data.subarray(8, 12))).toEqual([255, 0, 0, 255]);
    expect(Array.from(r.data.subarray(0, 4))).toEqual([0, 0, 0, 255]);
  });
  it('refuses what is not a BMP', () => {
    expect(() => readBmp(new Uint8Array(60))).toThrow(/Not a BMP/);
  });
});
