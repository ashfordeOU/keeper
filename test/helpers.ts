import { extOf, kindOf, looksLikeScreenshot } from '../core/classify';
import type { FileEntry } from '../core/types';

export const NOW = new Date(2026, 9, 30, 15, 0, 0).getTime();
export const DAY = 86_400_000;

export function file(p: string, over: Partial<FileEntry> = {}): FileEntry {
  const name = p.split('/').pop()!;
  return {
    path: p,
    name,
    ext: extOf(name),
    kind: kindOf(name),
    size: 1000,
    mtime: NOW - DAY,
    btime: NOW - DAY,
    atime: 0,
    root: p.split('/')[3] ?? 'Home',
    screenshot: looksLikeScreenshot(name) || undefined,
    ...over,
  };
}
