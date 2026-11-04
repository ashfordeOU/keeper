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

/**
 * A folder or file as a person names it, never a raw path (the full path belongs in a tooltip):
 * "/Users/ana/Documents/Work" -> "Documents › Work", the home folder -> "Home",
 * "~/Pictures/Screenshots/" -> "Pictures › Screenshots", "/Volumes/USB/Photos" -> "USB › Photos",
 * anything else -> its last two names ("share › ca-certificates"). Temporary folders become "a temporary folder".
 */
export function friendlyPath(p: string, home = ''): string {
  const raw = p.trim();
  if (!raw) return '';
  const sep = /\\/.test(raw) && !raw.startsWith('/') ? '\\' : '/';
  const clean = (x: string) => x.replace(/[\\/]+$/, '');
  const parts = (x: string) => x.split(/[\\/]+/).filter(Boolean);
  const h = clean(home);
  let rest: string[] | null = null;
  if (raw === '~' || (h && clean(raw) === h)) return 'Home';
  if (raw.startsWith('~/') || raw.startsWith('~\\')) rest = parts(raw.slice(2));
  else if (h && clean(raw).toLowerCase().startsWith((h + sep).toLowerCase())) rest = parts(clean(raw).slice(h.length));
  if (rest) return rest.length ? rest.join(' › ') : 'Home';
  if (/^(\/private)?\/(tmp|var\/folders)\//.test(raw) || /\\AppData\\Local\\Temp\\/i.test(raw)) return 'a temporary folder';
  const all = parts(raw);
  // A disk: /Volumes/USB, /media/ana/USB, /run/media/ana/USB, /mnt/USB; on Windows a drive letter.
  const vol = clean(raw).match(/^\/(?:Volumes|mnt)\/([^/]+)(.*)$/) ?? clean(raw).match(/^\/(?:run\/)?media\/[^/]+\/([^/]+)(.*)$/);
  if (vol) return [vol[1], ...parts(vol[2])].join(' › ');
  if (/^[A-Za-z]:\\?$/.test(raw)) return `Drive ${raw[0].toUpperCase()}:`;
  if (!all.length) return raw;
  return all.slice(-2).join(' › ');
}

/** The program a command line runs, by name ("\"/opt/Keeper/keeper\" --hidden" -> "keeper", "C:\\…\\Teams.exe" -> "Teams"). */
export function programName(command: string): string {
  const c = command.trim();
  // Quoted, or up to ".exe" (Windows paths have spaces), or up to the first space.
  const first = c.startsWith('"') ? c.slice(1, c.indexOf('"', 1) > 0 ? c.indexOf('"', 1) : undefined) : (c.match(/^(.*?\.(?:exe|app|AppImage))(?:\s|$)/i)?.[1] ?? c.split(/\s+/)[0]);
  const base = first.split(/[\\/]/).filter(Boolean).pop() ?? first;
  return base.replace(/\.(exe|app|desktop|sh|cmd|bat|AppImage)$/i, '') || c;
}

/** Every path in a sentence, named as a person names it ("Move to ~/Pictures/Shots" -> "Move to Pictures › Shots"). */
export function friendlyPathsIn(text: string, home = ''): string {
  return text.replace(/(^|[\s(“"'])((?:~|\/)[^\s,;)”"']*\/[^\s,;)”"']*|[A-Za-z]:\\[^\s,;)”"']+)/g, (_all, pre: string, p: string) => {
    const end = /[.:]$/.test(p) ? p.slice(-1) : '';
    return pre + friendlyPath(end ? p.slice(0, -1) : p, home) + end;
  });
}

/** "/Users/ana/Downloads/x.pdf" -> "~/Downloads/x.pdf" */
export function tildify(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return '~';
  const sep = home.includes('\\') ? '\\' : '/';
  return p.startsWith(home + sep) ? '~' + p.slice(home.length) : p;
}
