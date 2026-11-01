// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Decides which library shelf a file belongs on, from its name alone.

import type { FileKind } from './types';

const EXT: Record<Exclude<FileKind, 'other'>, string[]> = {
  image: [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'ico', 'icns',
    'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf', 'psd', 'xcf', 'jxl',
  ],
  video: ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts', 'ts', 'vob', 'ogv'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'wma', 'alac', 'mid', 'midi', 'amr'],
  document: [
    'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'markdown', 'pages', 'tex', 'epub', 'mobi', 'azw3',
    'xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers', 'ppt', 'pptx', 'odp', 'key', 'xps', 'oxps', 'vcf', 'ics',
  ],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'lz', 'lzma', 'cab', 'iso', 'img', 'sit', 'sitx'],
  installer: ['dmg', 'pkg', 'mpkg', 'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'deb', 'rpm', 'appimage', 'flatpakref', 'snap', 'apk', 'xapk', 'ipa'],
  app: ['app', 'lnk'],
  code: [
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc',
    'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'yaml', 'yml',
    'toml', 'ini', 'sql', 'ipynb', 'lua', 'r', 'dart', 'vue', 'svelte',
  ],
};

const BY_EXT = new Map<string, FileKind>();
for (const [kind, exts] of Object.entries(EXT) as [FileKind, string[]][]) {
  for (const e of exts) if (!BY_EXT.has(e)) BY_EXT.set(e, kind);
}

/** Compound extensions that would otherwise be read as their last part. */
const COMPOUND = ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'];

export function extOf(name: string): string {
  const lower = name.toLowerCase();
  for (const c of COMPOUND) if (lower.endsWith('.' + c)) return c;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return '';
  return lower.slice(dot + 1);
}

export function kindOf(name: string, isDirectory = false): FileKind {
  const ext = extOf(name);
  if (isDirectory) return ext === 'app' ? 'app' : 'other';
  if (ext.startsWith('tar.')) return 'archive';
  return BY_EXT.get(ext) ?? 'other';
}

export function extensionsFor(kind: FileKind): string[] {
  return kind === 'other' ? [] : EXT[kind];
}

export function isKnownExt(ext: string): boolean {
  return BY_EXT.has(ext);
}

// macOS:  "Screenshot 2026-08-01 at 10.12.33.png", older "Screen Shot ...".
// Windows: "Screenshot 2026-08-01 101233.png" (Snipping Tool), "Screenshot (12).png" (Win+PrtScn).
// GNOME:  "Screenshot from 2026-08-01 10-12-33.png"; KDE Spectacle: "Screenshot_20260801_101233.png".
// Android / iOS exports: "Screenshot_20260801-101233_Chrome.jpg", "IMG_1234.PNG" is not one.
const SCREENSHOT_RE = [
  /^screen ?shot(?![a-z])/i,
  /^capture d.écran\b/i,
  /^bildschirmfoto\b/i,
  /^captura de pantalla\b/i,
  /^schermafbeelding\b/i,
  /^istantanea schermo\b/i,
  /^снимок экрана\b/i,
  /^スクリーンショット/,
  /^截屏/,
  /^屏幕截图/,
  /^cleanshot\b/i,
  /^snip\b/i,
  /^scr-\d{8}/i,
];

export function looksLikeScreenshot(name: string): boolean {
  if (kindOf(name) !== 'image') return false;
  return SCREENSHOT_RE.some((re) => re.test(name));
}

export const KIND_LABEL: Record<FileKind, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Music',
  document: 'Documents',
  archive: 'Archives',
  installer: 'Installers',
  app: 'Apps',
  code: 'Code',
  other: 'Other',
};

export const KIND_SINGULAR: Record<FileKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'song',
  document: 'document',
  archive: 'archive',
  installer: 'installer',
  app: 'app',
  code: 'code file',
  other: 'file',
};
