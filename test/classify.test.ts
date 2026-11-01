// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { extOf, kindOf, looksLikeScreenshot } from '../core/classify';
import { formatBytes, parseBytes, relativeTime, tildify } from '../core/format';

describe('classify', () => {
  it('kinds', () => {
    expect(kindOf('a.HEIC')).toBe('image');
    expect(kindOf('setup.exe')).toBe('installer');
    expect(kindOf('x.tar.gz')).toBe('archive');
    expect(kindOf('Notes.app', true)).toBe('app');
    expect(kindOf('README')).toBe('other');
    expect(extOf('.bashrc')).toBe('');
    expect(extOf('a.tar.gz')).toBe('tar.gz');
  });
  it('screenshots in many languages and tools', () => {
    for (const n of ['Screenshot 2026-08-01 at 10.12.33.png', 'Screen Shot 2020-01-01 at 1.00.00 PM.png', 'Screenshot from 2026-08-01 10-12-33.png', 'Screenshot_20260801_101233.png', 'Bildschirmfoto 2026-08-01 um 10.12.33.png', 'Capture d’écran 2026-08-01 à 10.12.33.png', 'CleanShot 2026-08-01 at 10.12.33@2x.png']) {
      expect(looksLikeScreenshot(n), n).toBe(true);
    }
    expect(looksLikeScreenshot('IMG_1234.png')).toBe(false);
    expect(looksLikeScreenshot('Screenshot notes.txt')).toBe(false);
  });
});

describe('format', () => {
  it('bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(parseBytes('5 MB')).toBe(5 * 1024 ** 2);
    expect(parseBytes('1.5gb')).toBe(1.5 * 1024 ** 3);
    expect(parseBytes('nope')).toBeUndefined();
  });
  it('time and paths', () => {
    expect(relativeTime(Date.now() - 3 * 86_400_000)).toBe('3 days ago');
    expect(tildify('/Users/ana/Downloads/x', '/Users/ana')).toBe('~/Downloads/x');
    expect(tildify('/Users/anna/x', '/Users/ana')).toBe('/Users/anna/x');
  });
});
