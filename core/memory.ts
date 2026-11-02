// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How much memory is really in use, the way each system's own monitor counts
// it. macOS: total − free counts the file cache and purgeable memory as used
// (a 36 GB Mac reads "35.6 GB used" while Activity Monitor says 32), so used is
// App Memory + Wired + Compressed and the colour comes from memory pressure.
// Linux: MemTotal − MemAvailable. No I/O here, so every piece is tested.

export type MemoryPressure = 'normal' | 'warning' | 'critical';

export interface MemoryStats {
  total: number;
  used: number;
  /** macOS: App Memory (anonymous pages that are not purgeable) */
  app?: number;
  wired?: number;
  /** macOS: memory the compressor holds */
  compressed?: number;
  /** file cache the system gives back when asked (macOS: Cached Files) */
  cached?: number;
  /** what can be handed out without swapping */
  available?: number;
  swapTotal?: number;
  swapUsed?: number;
  /** macOS memory pressure, as Activity Monitor's graph shows it */
  pressure?: MemoryPressure;
}

/** The raw macOS figures, in bytes, from keeper-helper (memory.stats) or `vm_stat`. */
export interface MacVmBytes {
  total: number;
  free?: number;
  /** anonymous pages (internal_page_count) */
  internal?: number;
  /** file-backed pages (external_page_count) */
  external?: number;
  purgeable?: number;
  wired?: number;
  /** pages occupied by the compressor (compressor_page_count) */
  compressed?: number;
  swapTotal?: number;
  swapUsed?: number;
  /** kern.memorystatus_vm_pressure_level */
  pressureLevel?: number;
}

/** kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical. */
export function pressureFromLevel(level: number | undefined): MemoryPressure | undefined {
  if (level === 1) return 'normal';
  if (level === 2) return 'warning';
  if (level === 4) return 'critical';
  return undefined;
}

/**
 * `vm_stat` → bytes. Its first line names the page size ("page size of 16384 bytes");
 * every other line is "Name of the counter:   12345." in pages.
 */
export function parseVmStat(text: string): Omit<MacVmBytes, 'total' | 'swapTotal' | 'swapUsed' | 'pressureLevel'> & { pageSize?: number } {
  const ps = text.match(/page size of (\d+) bytes/);
  const pageSize = ps ? Number(ps[1]) : undefined;
  if (!pageSize) return {};
  const pages = (name: string): number | undefined => {
    const m = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) * pageSize : undefined;
  };
  return {
    pageSize,
    free: pages('Pages free'),
    internal: pages('Anonymous pages'),
    external: pages('File-backed pages'),
    purgeable: pages('Pages purgeable'),
    wired: pages('Pages wired down'),
    compressed: pages('Pages occupied by compressor'),
  };
}

/**
 * Activity Monitor's figures: App Memory = anonymous − purgeable, Cached Files =
 * file-backed + purgeable, Memory Used = App Memory + Wired + Compressed.
 * Undefined when the page counts are missing (an unexpected `vm_stat`).
 */
export function macMemory(v: MacVmBytes): MemoryStats | undefined {
  if (!(v.total > 0) || v.internal === undefined || v.wired === undefined || v.compressed === undefined) return undefined;
  const purgeable = v.purgeable ?? 0;
  const app = Math.max(0, v.internal - purgeable);
  const used = Math.min(v.total, app + v.wired + v.compressed);
  return {
    total: v.total,
    used,
    app,
    wired: v.wired,
    compressed: v.compressed,
    cached: v.external !== undefined ? v.external + purgeable : undefined,
    available: v.total - used,
    swapTotal: v.swapTotal,
    swapUsed: v.swapUsed,
    pressure: pressureFromLevel(v.pressureLevel),
  };
}

/** /proc/meminfo: used = MemTotal − MemAvailable, plus the page cache and swap. */
export function linuxMemory(text: string): MemoryStats | undefined {
  const kb = (k: string) => {
    const m = text.match(new RegExp(`^${k}:\\s*(\\d+)`, 'm'));
    return m ? Number(m[1]) * 1024 : undefined;
  };
  const total = kb('MemTotal');
  if (!total) return undefined;
  // Kernels before 3.14 have no MemAvailable; free + buffers + cache is the old estimate.
  const available = kb('MemAvailable') ?? (kb('MemFree') ?? 0) + (kb('Buffers') ?? 0) + (kb('Cached') ?? 0);
  const swapTotal = kb('SwapTotal');
  const swapFree = kb('SwapFree');
  const cached = kb('Cached');
  return {
    total,
    used: Math.max(0, total - available),
    available,
    cached: cached !== undefined ? cached + (kb('Buffers') ?? 0) : undefined,
    swapTotal: swapTotal || undefined,
    swapUsed: swapTotal && swapFree !== undefined ? swapTotal - swapFree : undefined,
  };
}

/** The plain reading (Windows, or when nothing better answered): total − free. */
export function basicMemory(total: number, free: number): MemoryStats {
  return { total, used: Math.max(0, total - free), available: free };
}

/**
 * How worried to look. macOS: by memory pressure, as Activity Monitor colours its
 * graph (a Mac that fills its memory with cache is fine). Elsewhere: by how full it is.
 */
export function memoryTone(m: { used: number; total: number; pressure?: MemoryPressure }): 'ok' | 'warn' | 'bad' {
  if (m.pressure) return m.pressure === 'critical' ? 'bad' : m.pressure === 'warning' ? 'warn' : 'ok';
  const f = m.total ? m.used / m.total : 0;
  return f >= 0.9 ? 'bad' : f >= 0.75 ? 'warn' : 'ok';
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/** "Cached 3.8 GB · Swap 24.6 GB · Compressed 16.4 GB": the parts that explain the number. */
export function memoryDetail(m: Pick<MemoryStats, 'cached' | 'swapUsed' | 'compressed' | 'pressure'>, withPressure = false): string {
  const parts: string[] = [];
  if (m.cached) parts.push(`Cached ${gb(m.cached)}`);
  if (m.swapUsed) parts.push(`Swap ${gb(m.swapUsed)}`);
  if (m.compressed) parts.push(`Compressed ${gb(m.compressed)}`);
  if (withPressure && m.pressure) parts.push(`pressure ${m.pressure}`);
  return parts.join(' · ');
}
