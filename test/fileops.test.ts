// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clashes, planTransfer, transferError, within } from '../core/fileops';

const D = path.resolve('/tmp/k');
const j = (...p: string[]) => path.join(D, ...p);

describe('copy and move planning', () => {
  const there = new Set([j('dest', 'a.txt'), j('dest', 'Photos')]);
  const exists = (p: string) => there.has(p);

  it('finds names already in the folder', () => {
    const steps = planTransfer('move', [j('src', 'a.txt'), j('src', 'b.txt'), j('src', 'Photos')], j('dest'), exists);
    expect(clashes(steps)).toEqual(['a.txt', 'Photos']);
  });

  it('refuses a folder into itself or its own subfolder', () => {
    const [s1] = planTransfer('move', [j('src')], j('src', 'inner'), exists);
    expect(s1.refuse).toMatch(/inside itself/);
    const [s2] = planTransfer('copy', [j('src')], j('src'), exists);
    expect(s2.refuse).toBeTruthy();
    expect(within(j('src'), j('src2'))).toBe(false);
  });

  it('a move into the same folder does nothing; a copy there keeps both without asking', () => {
    const [m] = planTransfer('move', [j('dest', 'a.txt')], j('dest'), exists);
    expect(m.same).toBe(true);
    const [c] = planTransfer('copy', [j('dest', 'a.txt')], j('dest'), exists);
    expect(c.clash).toBe(false);
    expect(clashes([c])).toEqual([]);
  });

  it('says why the system refused', () => {
    expect(transferError(Object.assign(new Error('x'), { code: 'EACCES' }), 'copy', '/x/Shared')).toMatch(/no permission .*Shared/);
    expect(transferError(Object.assign(new Error('x'), { code: 'ENOSPC' }), 'move', '/Volumes/USB')).toMatch(/free space in “USB”/);
    expect(transferError(Object.assign(new Error('x'), { code: 'EROFS' }), 'move', '/ro')).toMatch(/read-only/);
  });
});
