// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { defaultA11y, normalizeA11y, READING_FONTS, readingFontUrl, TEXT_SCALES } from '../core/a11y';
import { noVoiceHint, speakable, speakCommand, wordsPerMinute } from '../core/read-aloud';

describe('reading comfort settings', () => {
  it('goes up to 200% and keeps only known values', () => {
    expect(TEXT_SCALES).toContain(2);
    expect(normalizeA11y({ textScale: 3, readingFont: 'comic', lineSpacing: 1.6, letterSpacing: 0.5, reflow: 'yes', bigTargets: true })).toEqual({ ...defaultA11y(), textScale: 2, lineSpacing: 1.6, bigTargets: true });
    expect(normalizeA11y({ readingFont: 'dyslexic', letterSpacing: 0.04, reflow: true })).toMatchObject({ readingFont: 'dyslexic', letterSpacing: 0.04, reflow: true });
    expect(normalizeA11y(undefined)).toEqual(defaultA11y());
  });

  it('pins each reading font to a package version and a fingerprint', () => {
    for (const f of Object.values(READING_FONTS)) for (const x of f.files) {
      expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(readingFontUrl(x.file)).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/[a-z-]+@\d+\.\d+\.\d+\/files\//);
    }
    expect(readingFontUrl('opendyslexic-latin-400-normal.woff2', 'http://127.0.0.1:9')).toBe('http://127.0.0.1:9/@fontsource/opendyslexic@5.0.0/files/opendyslexic-latin-400-normal.woff2');
  });
});

describe('read aloud', () => {
  it('reads words, not Markdown marks or link targets', () => {
    expect(speakable('# Garden plan\n\n- **Plant** tomatoes in [May](https://x.org/may)\n- see [[Compost|the heap]]\n\n```js\ncode()\n```\nDone.')).toBe('Garden plan Plant tomatoes in May see Compost Done.');
    expect(speakable('Visit https://example.com today')).toBe('Visit link today');
    expect(speakable('a'.repeat(30), 10)).toHaveLength(10);
  });

  it('uses the system’s own voice and never puts the text in a script', () => {
    expect(speakCommand('darwin', 'Hello', 1)).toEqual({ cmd: 'say', args: ['-r', '180', '-f', '-'], stdin: 'Hello' });
    const win = speakCommand('win32', 'Hi $(rm -rf) "quote"', 1.5)!;
    expect(win.cmd).toBe('powershell.exe');
    expect(win.args.join(' ')).not.toContain('rm -rf');
    expect(win.args.join(' ')).toContain('$s.Rate = 5');
    expect(win.stdin).toBe('Hi $(rm -rf) "quote"');
    expect(speakCommand('linux', 'Hello', 1, (c) => c === 'spd-say')).toEqual({ cmd: 'spd-say', args: ['-w', '-r', '0', '--', 'Hello'] });
    expect(speakCommand('linux', 'Hello', 2, (c) => c === 'espeak-ng')).toEqual({ cmd: 'espeak-ng', args: ['-s', '360', '--stdin'], stdin: 'Hello' });
    expect(speakCommand('linux', 'Hello', 1, () => false)).toBeNull();
    expect(speakCommand('darwin', '   ', 1)).toBeNull();
    expect(wordsPerMinute(9)).toBe(360);
    expect(noVoiceHint('linux')).toMatch(/speech-dispatcher/);
  });
});
