import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dHash, findExactDuplicates, findFormatPairs, findSimilarImages, hamming, pickKeeper, toGray9x8 } from '../core/duplicates';
import { file } from './helpers';

describe('exact duplicates', () => {
  it('groups identical bytes and ignores same-size different files', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'keeper-dupes-'));
    const big = Buffer.alloc(300 * 1024, 7);
    const other = Buffer.alloc(300 * 1024, 7);
    other[200 * 1024] = 1; // differs only in the middle: partial hash matches, full hash does not
    const a = path.join(dir, 'photo.jpg');
    const b = path.join(dir, 'photo (1).jpg');
    const c = path.join(dir, 'different.jpg');
    writeFileSync(a, big);
    writeFileSync(b, big);
    writeFileSync(c, other);
    const entries = [a, b, c].map((p) => file(p, { size: 300 * 1024 }));
    const groups = await findExactDuplicates(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.name).sort()).toEqual(['photo (1).jpg', 'photo.jpg']);
    expect(groups[0].keep).toBe(a);
    expect(groups[0].reclaimable).toBe(300 * 1024);
  });

  it('skips cloud-only files', async () => {
    const groups = await findExactDuplicates([file('/x/a.jpg', { cloudOnly: true }), file('/x/b.jpg', { cloudOnly: true })]);
    expect(groups).toEqual([]);
  });
});

describe('look-alike photos', () => {
  const gradient = (shift: number) => {
    const w = 64, h = 48, px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, ((x * 37 + y * 11) % 200) + shift));
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
    return dHash(toGray9x8(px, w, h));
  };

  it('near-identical images hash close together', () => {
    const a = gradient(0);
    const b = gradient(3);
    expect(a).toHaveLength(16);
    expect(hamming(a, b)).toBeLessThanOrEqual(6);
  });

  it('groups by hamming distance and leaves flat images alone', () => {
    const hashes = new Map([
      ['/p/a.jpg', 'f0f0f0f0f0f0f0f0'],
      ['/p/b.jpg', 'f0f0f0f0f0f0f0f1'],
      ['/p/c.jpg', '0f0f0f0f0f0f0f0f'],
      ['/p/flat1.jpg', '0000000000000000'],
      ['/p/flat2.jpg', '0000000000000000'],
    ]);
    const imgs = [...hashes.keys()].map((p) => file(p));
    const groups = findSimilarImages(imgs, hashes, 4);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.name).sort()).toEqual(['a.jpg', 'b.jpg']);
  });

  it('pairs HEIC with its JPEG copy and keeps the HEIC', () => {
    const g = findFormatPairs([file('/p/IMG_1.HEIC', { size: 2000 }), file('/p/IMG_1.JPG', { size: 3000 }), file('/p/IMG_2.JPG')]);
    expect(g).toHaveLength(1);
    expect(g[0].keep).toBe('/p/IMG_1.HEIC');
    expect(g[0].reclaimable).toBe(3000);
  });
});

describe('pickKeeper', () => {
  it('prefers the original name outside Downloads', () => {
    const k = pickKeeper([file('/u/Downloads/report.pdf'), file('/u/Documents/report (2).pdf'), file('/u/Documents/report.pdf')], 'exact');
    expect(k.file.path).toBe('/u/Documents/report.pdf');
    expect(k.reason).toMatch(/original name/);
  });
  it('prefers the most pixels for look-alikes', () => {
    const k = pickKeeper([file('/p/a.jpg', { meta: { width: 100, height: 100 } }), file('/p/b.jpg', { meta: { width: 4000, height: 3000 } })], 'similar');
    expect(k.file.path).toBe('/p/b.jpg');
  });
});
