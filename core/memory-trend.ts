// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small ring of memory readings (one a minute), kept for crash breadcrumbs:
// a fatal out-of-memory abort leaves no JavaScript trace, but the trend shows
// which kind of memory grew and how fast.

export interface MemoryRow {
  /** seconds since the first reading */
  t: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

const MB = 1048576;

export class MemoryTrend {
  private ring: MemoryRow[] = [];
  private t0: number | undefined;
  private warned = false;

  constructor(private max = 360, private warnShare = 0.7) {}

  /**
   * Adds one reading (bytes, from process.memoryUsage()). Returns a line to log
   * when the heap first passes `warnShare` of its limit (again after it falls back
   * below half of it), otherwise undefined.
   */
  add(at: number, m: { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number }, heapLimit = 0): string | undefined {
    this.t0 ??= at;
    this.ring.push({
      t: Math.round((at - this.t0) / 1000),
      rss: Math.round(m.rss / MB),
      heapUsed: Math.round(m.heapUsed / MB),
      heapTotal: Math.round(m.heapTotal / MB),
      external: Math.round(m.external / MB),
      arrayBuffers: Math.round(m.arrayBuffers / MB),
    });
    if (this.ring.length > this.max) this.ring.splice(0, this.ring.length - this.max);
    if (!heapLimit) return undefined;
    const share = m.heapUsed / heapLimit;
    if (share >= this.warnShare && !this.warned) {
      this.warned = true;
      return `main-process heap ${Math.round(m.heapUsed / MB)} MB of ${Math.round(heapLimit / MB)} MB (${Math.round(share * 100)} %)`;
    }
    if (share < this.warnShare / 2) this.warned = false;
    return undefined;
  }

  /** The readings, oldest first (MB). */
  rows(): MemoryRow[] {
    return this.ring.slice();
  }
}
