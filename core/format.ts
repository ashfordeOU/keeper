// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Human-friendly numbers and dates, shared by the interface and the CLI.

export const KB = 1024;
export const MB = KB * 1024;
export const GB = MB * 1024;
export const TB = GB * 1024;
export const DAY = 24 * 60 * 60 * 1000;

export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const d = i === 0 || v >= 100 ? 0 : digits;
  return `${v.toFixed(d).replace(/\.0+$/, '')} ${units[i]}`;
}

/** "5 MB", "1.5gb", "300 k", "2 gigs" -> bytes. */
export function parseBytes(text: string): number | undefined {
  const m = text.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(b|bytes?|k|kb|kib|kilobytes?|m|mb|mib|megs?|megabytes?|g|gb|gib|gigs?|gigabytes?|t|tb|tib|terabytes?)?$/);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(',', '.'));
  const u = m[2] ?? 'mb';
  const mult = u.startsWith('t') ? TB : u.startsWith('g') ? GB : u.startsWith('m') ? MB : u.startsWith('k') ? KB : 1;
  return Math.round(v * mult);
}

export function formatCount(n: number, singular: string, plural = singular + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`;
}

export function relativeTime(t: number, now = Date.now()): string {
  if (!t) return 'unknown';
  const diff = now - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const fmt = (v: number, unit: string) => {
    const r = Math.round(v);
    const s = `${r} ${unit}${r === 1 ? '' : 's'}`;
    return future ? `in ${s}` : `${s} ago`;
  };
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return fmt(abs / 60_000, 'minute');
  if (abs < DAY) return fmt(abs / 3_600_000, 'hour');
  if (abs < 2 * DAY) return future ? 'tomorrow' : 'yesterday';
  if (abs < 30 * DAY) return fmt(abs / DAY, 'day');
  if (abs < 365 * DAY) return fmt(abs / (30 * DAY), 'month');
  return fmt(abs / (365 * DAY), 'year');
}

export function formatDate(t: number): string {
  if (!t) return '—';
  return new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "/Users/ana/Downloads/x.pdf" -> "~/Downloads/x.pdf" */
export function tildify(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return '~';
  const sep = home.includes('\\') ? '\\' : '/';
  return p.startsWith(home + sep) ? '~' + p.slice(home.length) : p;
}
