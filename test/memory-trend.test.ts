// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Main-process memory once a minute, kept for crash breadcrumbs.
import { describe, expect, it } from 'vitest';
import { MemoryTrend } from '../core/memory-trend';

describe('MemoryTrend', () => {
  const m = (heapMB: number) => ({ rss: heapMB * 2 * 1048576, heapUsed: heapMB * 1048576, heapTotal: heapMB * 1048576, external: 0, arrayBuffers: 0 });
  it('keeps the last readings and warns once as the heap nears its limit', () => {
    const t = new MemoryTrend(3, 0.7);
    const limit = 1000 * 1048576;
    expect(t.add(0, m(100), limit)).toBeUndefined();
    expect(t.add(60_000, m(500), limit)).toBeUndefined();
    expect(t.add(120_000, m(750), limit)).toMatch(/750 MB of 1000 MB/);
    expect(t.add(180_000, m(800), limit)).toBeUndefined();
    expect(t.rows().map((r) => [r.t, r.heapUsed, r.rss])).toEqual([[60, 500, 1000], [120, 750, 1500], [180, 800, 1600]]);
    expect(t.add(240_000, m(300), limit)).toBeUndefined();
    expect(t.add(300_000, m(900), limit)).toMatch(/900 MB/);
  });
});
