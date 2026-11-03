// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { clock, defaultExpiry, expiresAt, expiryChoices, safeUploadName, scriptJson, signedSeconds, sizeText, toVtt, transcriptParagraphs, viewerHtml } from '../core/share-page';

const base = { title: 'Demo', videoUrl: './Demo.mp4', downloadUrl: './Demo.mp4', type: 'video/mp4', fileName: 'Demo.mp4', captions: [], chapters: [], madeAt: Date.UTC(2026, 10, 3) };

describe('share page', () => {
  it('writes captions as WebVTT in order, leaving out empty ones', () => {
    const v = toVtt([{ start: 61_500, end: 63_000, text: 'second' }, { start: 0, end: 1250, text: 'first' }, { start: 5, end: 5, text: 'zero' }, { start: 7000, end: 8000, text: '  ' }]);
    expect(v.startsWith('WEBVTT\n\n')).toBe(true);
    expect(v).toContain('00:00:00.000 --> 00:00:01.250\nfirst');
    expect(v.indexOf('first')).toBeLessThan(v.indexOf('second'));
    expect(v).toContain('00:01:01.500 --> 00:01:03.000');
    expect(v).not.toContain('zero');
  });
  it('keeps "-->" out of cue text', () => {
    expect(toVtt([{ start: 0, end: 1000, text: 'a --> b' }])).toContain('a → b');
  });
  it('joins captions into paragraphs at pauses', () => {
    const p = transcriptParagraphs([{ start: 0, end: 1000, text: 'Hello' }, { start: 1200, end: 2000, text: 'there.' }, { start: 6000, end: 7000, text: 'Next part' }]);
    expect(p).toEqual([{ start: 0, text: 'Hello there.' }, { start: 6000, text: 'Next part' }]);
  });
  it('formats times and sizes', () => {
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(sizeText(2048)).toBe('2 KB');
    expect(sizeText(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
  it('offers link lifetimes the storage can keep', () => {
    expect(expiryChoices('s3').map((c) => c.hours)).toEqual([24, 72, 168]);
    expect(expiryChoices('webdav')[0]).toEqual({ hours: 0, label: 'No end' });
    expect(defaultExpiry('s3', 72)).toBe(72);
    expect(defaultExpiry('s3', 500)).toBe(168);
    expect(defaultExpiry('webdav', 72)).toBe(0);
    expect(signedSeconds(1000)).toBe(604_800);
    expect(signedSeconds(0.1)).toBe(3600);
    expect(expiresAt('webdav', 0, 1000)).toBeUndefined();
    expect(expiresAt('webdav', 24, 1000)).toBe(1000 + 86_400_000);
    expect(expiresAt('s3', 0, 1000)).toBe(1000 + 72 * 3_600_000);
  });
  it('makes safe upload names', () => {
    expect(safeUploadName('../../etc/passwd')).toBe('etc passwd');
    expect(safeUploadName('Café demo: take 2!')).toBe('Café demo take 2');
    expect(safeUploadName('???')).toBe('video');
  });
  it('keeps data from closing the script', () => {
    expect(scriptJson({ t: '</script><!--' })).not.toMatch(/<\/script|<!--/);
    expect(JSON.parse(scriptJson({ t: '</script>' }))).toEqual({ t: '</script>' });
  });
  it('builds a page with the player, chapters, transcript and download, and nothing from elsewhere', () => {
    const html = viewerHtml({ ...base, size: 3_000_000, captions: [{ start: 0, end: 1000, text: 'Hi <b>there</b>' }], chapters: [{ t: 0, title: 'Intro' }, { t: 30_000, title: 'Setup' }], expiresAt: Date.UTC(2026, 10, 10) });
    expect(html).toContain('<video id="v" controls');
    expect(html).toContain('src="./Demo.mp4"');
    expect(html).toContain('download="Demo.mp4"');
    expect(html).toContain('Download (2.9 MB)');
    expect(html).toContain('"title":"Setup"');
    expect(html).toContain('Hi \\u003cb\\u003ethere');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(html).toContain('This link has ended');
  });
  it('escapes the title and links', () => {
    const html = viewerHtml({ ...base, title: '<img onerror=x>', videoUrl: 'https://s.example/v.mp4?a=1&b="2"' });
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('a=1&amp;b=&quot;2&quot;');
  });
  it('shows a GIF as a picture, without captions', () => {
    const html = viewerHtml({ ...base, type: 'image/gif', videoUrl: './a.gif' });
    expect(html).toContain('<img id="v" src="./a.gif"');
    expect(html).not.toContain('id="cc"');
  });
});
