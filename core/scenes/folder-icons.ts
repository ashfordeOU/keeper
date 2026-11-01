// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Custom folder icons: what an icon looks like (drawn here as SVG, made into
// a PNG by the interface), how each system is told about it, and the restore
// list that puts the originals back.
//
//   macOS    NSWorkspace setIcon(_:forFile:) in the helper (public API; nil removes it)
//   Windows  desktop.ini with IconResource= in the folder, and the folder marked System
//   Linux    the GIO attribute metadata::custom-icon (Files, Nemo, Caja, Thunar read it);
//            KDE Dolphin reads Icon= in the folder's .directory file

export type IconPattern = 'solid' | 'gradient' | 'stripes' | 'dots' | 'grid' | 'waves' | 'checks' | 'rings';

export interface FolderIconSpec {
  pattern: IconPattern;
  color: string;
  color2: string;
  /** a symbol on the front: an emoji or up to two letters */
  symbol: string;
  /** the person's own picture, as a data URL (filled into the folder shape) */
  image?: string;
}

export const ICON_PATTERNS: IconPattern[] = ['solid', 'gradient', 'stripes', 'dots', 'grid', 'waves', 'checks', 'rings'];

export const ICON_COLORS: [string, string][] = [
  ['#4f7cff', '#9db4ff'], ['#ff6b8b', '#ffc0cd'], ['#22b8a6', '#9ef0e2'], ['#f5a524', '#ffe0a3'], ['#8b5cf6', '#d4c1ff'],
  ['#ef4444', '#fecaca'], ['#10b981', '#bbf7d0'], ['#64748b', '#cbd5e1'], ['#0f172a', '#475569'], ['#ec4899', '#fbcfe8'],
];

export interface FolderIconRecord {
  folder: string;
  appliedAt: number;
  spec: Omit<FolderIconSpec, 'image'> & { hasImage?: boolean };
  /** where the icon picture Keeper made is kept */
  iconFile: string;
  platform: NodeJS.Platform;
  /** what was there before, to put back */
  previous: {
    desktopIni?: string | null;
    folderWasSystem?: boolean;
    directoryFile?: string | null;
    gioIcon?: string | null;
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeColor = (c: string, d: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : d);

/** A square folder icon as SVG (512 units). */
export function folderIconSvg(spec: FolderIconSpec, size = 512): string {
  const c1 = safeColor(spec.color, '#4f7cff');
  const c2 = safeColor(spec.color2, '#9db4ff');
  const body = 'M40 150 Q40 120 70 120 L200 120 Q220 120 232 136 L250 160 L442 160 Q472 160 472 190 L472 410 Q472 440 442 440 L70 440 Q40 440 40 410 Z';
  const tab = 'M40 140 Q40 96 84 96 L196 96 Q216 96 228 112 L246 136 L40 136 Z';
  const pats: Record<IconPattern, string> = {
    solid: '',
    gradient: '',
    stripes: `<pattern id="p" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="18" height="36" fill="${c2}" opacity=".45"/></pattern>`,
    dots: `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="6" fill="${c2}" opacity=".6"/></pattern>`,
    grid: `<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${c2}" stroke-width="4" opacity=".5"/></pattern>`,
    waves: `<pattern id="p" width="80" height="40" patternUnits="userSpaceOnUse"><path d="M0 20 Q20 0 40 20 T80 20" fill="none" stroke="${c2}" stroke-width="6" opacity=".55"/></pattern>`,
    checks: `<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${c2}" opacity=".4"/><rect x="24" y="24" width="24" height="24" fill="${c2}" opacity=".4"/></pattern>`,
    rings: `<pattern id="p" width="90" height="90" patternUnits="userSpaceOnUse"><circle cx="45" cy="45" r="30" fill="none" stroke="${c2}" stroke-width="6" opacity=".5"/></pattern>`,
  };
  const fill = spec.pattern === 'gradient' ? 'url(#g)' : c1;
  const symbol = [...(spec.symbol ?? '')].slice(0, 2).join('');
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>${pats[spec.pattern] ?? ''}`,
    `<clipPath id="c"><path d="${body}"/></clipPath><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>`,
    `<path d="${tab}" fill="${c1}" opacity=".75"/>`,
    `<path d="${body}" fill="${fill}"/>`,
    spec.image ? `<image href="${esc(spec.image)}" x="40" y="120" width="432" height="320" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>` : '',
    spec.pattern !== 'solid' && spec.pattern !== 'gradient' && !spec.image ? `<path d="${body}" fill="url(#p)"/>` : '',
    `<path d="${body}" fill="url(#s)"/>`,
    symbol ? `<text x="256" y="315" text-anchor="middle" dominant-baseline="middle" font-size="${/\p{Extended_Pictographic}/u.test(symbol) ? 150 : 132}" font-family="-apple-system, 'Segoe UI', system-ui, sans-serif" font-weight="700" fill="#fff" fill-opacity=".92">${esc(symbol)}</text>` : '',
    '</svg>',
  ];
  return parts.join('');
}

// ---------------------------------------------------------------- Windows: desktop.ini

/** desktop.ini with Keeper's icon, keeping every other line the folder already had. */
export function desktopIniWithIcon(existing: string | null | undefined, iconPath: string): string {
  const lines = (existing ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const out: string[] = [];
  let inShell = false;
  let sawShell = false;
  let wrote = false;
  const put = () => { if (!wrote) { out.push(`IconResource=${iconPath},0`); wrote = true; } };
  for (const line of lines) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line);
    if (sec) {
      if (inShell) put();
      inShell = sec[1].trim().toLowerCase() === '.shellclassinfo';
      if (inShell) sawShell = true;
      out.push(line);
      continue;
    }
    // Old-style icon keys would win over IconResource on some versions: drop them.
    if (inShell && /^\s*(IconResource|IconFile|IconIndex)\s*=/i.test(line)) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (inShell) put();
  if (!sawShell) { if (out.length) out.push(''); out.push('[.ShellClassInfo]', `IconResource=${iconPath},0`); }
  return out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- KDE: .directory

export function directoryFileWithIcon(existing: string | null | undefined, iconPath: string): string {
  const lines = (existing ?? '').split(/\r?\n/);
  const out: string[] = [];
  let inEntry = false;
  let saw = false;
  let wrote = false;
  for (const line of lines) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line);
    if (sec) {
      if (inEntry && !wrote) { out.push(`Icon=${iconPath}`); wrote = true; }
      inEntry = sec[1] === 'Desktop Entry';
      if (inEntry) saw = true;
      out.push(line);
      continue;
    }
    if (inEntry && /^Icon=/.test(line)) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (inEntry && !wrote) out.push(`Icon=${iconPath}`);
  if (!saw) { if (out.length) out.push(''); out.push('[Desktop Entry]', `Icon=${iconPath}`); }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- Linux: GIO

export function fileUri(p: string): string {
  return 'file://' + p.split('/').map((s) => encodeURIComponent(s)).join('/');
}

export function gioSetArgs(folder: string, iconFile: string): string[] {
  return ['set', folder, 'metadata::custom-icon', fileUri(iconFile)];
}

export function gioUnsetArgs(folder: string): string[] {
  return ['set', '-t', 'unset', folder, 'metadata::custom-icon'];
}

/** Reads `gio info -a metadata::custom-icon` output. */
export function parseGioIcon(out: string): string | null {
  const m = /metadata::custom-icon:\s*(\S.*)$/m.exec(out);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------- Windows icon file

/**
 * An .ico holding PNG images (Windows Vista and later read PNG inside ICO).
 * `images` are PNG bytes with their pixel sizes, largest first is fine.
 */
export function pngsToIco(images: { png: Uint8Array; size: number }[]): Uint8Array {
  const header = 6 + 16 * images.length;
  const total = header + images.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    v.setUint8(e, img.size >= 256 ? 0 : img.size);
    v.setUint8(e + 1, img.size >= 256 ? 0 : img.size);
    v.setUint8(e + 2, 0);
    v.setUint8(e + 3, 0);
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, img.png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

/** Repairs the restore list read from disk. */
export function normalizeIconRecords(raw: unknown): FolderIconRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((r): r is FolderIconRecord => !!r && typeof r.folder === 'string' && typeof r.iconFile === 'string' && !!r.spec)
    .filter((r) => (seen.has(r.folder) ? false : (seen.add(r.folder), true)))
    .map((r) => ({ ...r, previous: r.previous ?? {} }));
}

/** Adds or replaces the record for a folder, keeping the very first "previous" (the real original). */
export function upsertRecord(list: FolderIconRecord[], rec: FolderIconRecord): FolderIconRecord[] {
  const old = list.find((r) => r.folder === rec.folder);
  const merged = old ? { ...rec, previous: old.previous } : rec;
  return [...list.filter((r) => r.folder !== rec.folder), merged];
}
