import { describe, expect, it } from 'vitest';
import { cameraMatches, editDistance, search, words } from '../core/query/match';
import { parseQuery } from '../core/query/parse';
import { DAY, NOW, file } from './helpers';

const files = [
  file('/Users/ana/Downloads/Invoice-March.pdf', { size: 6 * 1024 * 1024, mtime: NOW - 2 * DAY, source: { id: 'gmail', name: 'Gmail', host: 'mail.google.com' } }),
  file('/Users/ana/Desktop/Screenshot 2026-10-01 at 10.12.33.png', { text: 'Network: HomeNet  WiFi password: hunter2', mtime: NOW - 29 * DAY }),
  file('/Users/ana/Pictures/IMG_1234.HEIC', { mtime: NOW - 80 * DAY, meta: { camera: 'Apple iPhone 15 Pro' } }),
  file('/Users/ana/Documents/resume.docx', { mtime: NOW - 400 * DAY }),
  file('/Users/ana/Downloads/big.zip', { size: 2 * 1024 ** 3, mtime: NOW - 300 * DAY }),
];

const run = (s: string) => search(files, parseQuery(s, NOW).query, { now: NOW }).map((h) => h.file.name);

describe('search', () => {
  it('filters by type, size, source and date', () => {
    expect(run('pdfs from gmail over 5mb this week')).toEqual(['Invoice-March.pdf']);
    expect(run('zips bigger than 1gb older than 6 months')).toEqual(['big.zip']);
  });

  it('finds text inside screenshots, with a snippet', () => {
    const hits = search(files, parseQuery('screenshots with wifi password', NOW).query, { now: NOW });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('password: hunter2');
  });

  it('matches accents and forgives one typo', () => {
    expect(run('résumé')).toEqual(['resume.docx']);
    expect(run('invoise')).toEqual(['Invoice-March.pdf']);
  });

  it('camera filter uses EXIF and file names', () => {
    expect(run('photos from my iphone')).toEqual(['IMG_1234.HEIC']);
    expect(cameraMatches(files[2], 'android')).toBe(false);
  });

  it('locations', () => {
    expect(run('in downloads').sort()).toEqual(['Invoice-March.pdf', 'big.zip']);
  });

  it('sorts by size when asked', () => {
    expect(run('biggest files in downloads')[0]).toBe('big.zip');
  });

  it('helpers', () => {
    expect(words('Tax_Return-2025 finalDraft.pdf')).toEqual(['tax', 'return', '2025', 'final', 'draft', 'pdf']);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('invoice', 'invoise', 1)).toBe(1);
  });
});
