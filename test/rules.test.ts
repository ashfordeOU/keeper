import { describe, expect, it } from 'vitest';
import { defaultRules, globToRegExp, planRule, resolveDestination, uniqueName } from '../core/rules';
import { previewRename } from '../core/rename';
import { squarify } from '../core/treemap';
import { DAY, NOW, file } from './helpers';

const home = '/Users/ana';

describe('rules', () => {
  it('sends old installers in Downloads to the Trash, not new ones or ones elsewhere', () => {
    const rule = { ...defaultRules(home)[0], enabled: true };
    const plan = planRule([
      file(`${home}/Downloads/Zoom.pkg`, { mtime: NOW - 30 * DAY }),
      file(`${home}/Downloads/new.dmg`, { mtime: NOW - DAY }),
      file(`${home}/Downloads/sub/old.dmg`, { mtime: NOW - 30 * DAY }),
      file(`${home}/Downloads/notes.txt`, { mtime: NOW - 30 * DAY }),
    ], rule, NOW);
    expect(plan.map((p) => p.file.name)).toEqual(['Zoom.pkg']);
  });

  it('files screenshots by month', () => {
    const rule = defaultRules(home)[1];
    const f = file(`${home}/Desktop/Screenshot 2026-08-01 at 10.12.33.png`, { mtime: new Date(2026, 7, 1).getTime() });
    const plan = planRule([f], rule, NOW);
    expect(plan[0].to).toBe(`${home}/Pictures/Screenshots/2026-08/${f.name}`);
  });

  it('placeholders and globs', () => {
    expect(resolveDestination('/x/{source}/{yyyy}', file('/d/a.pdf', { source: { id: 'gmail', name: 'Gmail', host: 'mail.google.com' }, mtime: new Date(2025, 0, 2).getTime() }))).toBe('/x/Gmail/2025');
    expect(globToRegExp('*.part|report-?.txt').test('movie.mkv.part')).toBe(true);
    expect(globToRegExp('*.part|report-?.txt').test('report-1.txt')).toBe(true);
    expect(globToRegExp('*.part').test('part.txt')).toBe(false);
  });

  it('uniqueName adds a number', () => {
    const taken = new Set(['/a/b.txt', '/a/b 2.txt']);
    expect(uniqueName('/a/b.txt', (p) => taken.has(p))).toBe('/a/b 3.txt');
  });
});

describe('batch rename', () => {
  const files = [file('/d/IMG_0001.jpg'), file('/d/IMG_0002.jpg'), file('/d/notes (1).txt')];
  it('templates with counters', () => {
    const out = previewRename(files.slice(0, 2), [{ type: 'template', pattern: 'Trip {n:3}', start: 1 }]);
    expect(out.map((o) => o.newName)).toEqual(['Trip 001.jpg', 'Trip 002.jpg']);
  });
  it('detects conflicts', () => {
    const out = previewRename(files.slice(0, 2), [{ type: 'template', pattern: 'same' }]);
    expect(out.every((o) => o.conflict === 'Two files would get this name')).toBe(true);
    const exists = previewRename([files[0]], [{ type: 'replace', find: 'IMG_0001', with: 'taken' }], (p) => p === '/d/taken.jpg');
    expect(exists[0].conflict).toMatch(/already exists/);
  });
  it('cleanup, case, replace', () => {
    expect(previewRename([files[2]], [{ type: 'cleanup' }])[0].newName).toBe('notes.txt');
    expect(previewRename([files[0]], [{ type: 'replace', find: 'img_', with: 'Photo ' }, { type: 'case', to: 'upper' }])[0].newName).toBe('PHOTO 0001.jpg');
    expect(previewRename([files[0]], [{ type: 'replace', find: '\\d+', with: 'x', regex: true }])[0].newName).toBe('IMG_x.jpg');
  });
});

describe('treemap', () => {
  it('fills the rectangle exactly, areas proportional to size', () => {
    const items = [{ size: 6 }, { size: 6 }, { size: 4 }, { size: 3 }, { size: 2 }, { size: 2 }, { size: 1 }];
    const out = squarify(items, { x: 0, y: 0, w: 600, h: 400 });
    expect(out).toHaveLength(7);
    const area = out.reduce((n, r) => n + r.w * r.h, 0);
    expect(area).toBeCloseTo(600 * 400, 3);
    for (const r of out) {
      expect(r.w * r.h).toBeCloseTo((r.item.size / 24) * 240000, 3);
      expect(r.x + r.w).toBeLessThanOrEqual(600.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(400.0001);
    }
  });
});
