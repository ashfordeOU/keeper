// SPDX-License-Identifier: AGPL-3.0-or-later
// Recognises a file from its first bytes, the way the `file` command does, so
// previews work even when the extension is wrong or missing.

export interface Magic {
  /** short id used to pick a viewer: 'png', 'pdf', 'zip', ... */
  id: string;
  /** human description: "PNG image", "PDF document" */
  label: string;
  mime: string;
}

const ascii = (b: Uint8Array, at: number, s: string) => {
  if (b.length < at + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};
const bytes = (b: Uint8Array, at: number, arr: number[]) => b.length >= at + arr.length && arr.every((v, i) => b[at + i] === v);

/** Detects a format from up to the first 4 KB of a file. */
export function detectMagic(b: Uint8Array): Magic | undefined {
  if (bytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { id: 'png', label: 'PNG image', mime: 'image/png' };
  if (bytes(b, 0, [0xff, 0xd8, 0xff])) return { id: 'jpeg', label: 'JPEG image', mime: 'image/jpeg' };
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return { id: 'gif', label: 'GIF image', mime: 'image/gif' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { id: 'webp', label: 'WebP image', mime: 'image/webp' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { id: 'wav', label: 'WAV audio', mime: 'audio/wav' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'AVI ')) return { id: 'avi', label: 'AVI video', mime: 'video/x-msvideo' };
  if (ascii(b, 0, 'BM') && b.length > 14) return { id: 'bmp', label: 'BMP image', mime: 'image/bmp' };
  if (bytes(b, 0, [0, 0, 1, 0])) return { id: 'ico', label: 'Windows icon', mime: 'image/x-icon' };
  if (ascii(b, 0, 'icns')) return { id: 'icns', label: 'macOS icon', mime: 'image/icns' };
  if (ascii(b, 0, '8BPS')) return { id: 'psd', label: 'Photoshop document', mime: 'image/vnd.adobe.photoshop' };
  if (bytes(b, 0, [0xff, 0x0a]) || bytes(b, 4, [0x4a, 0x58, 0x4c, 0x20])) return { id: 'jxl', label: 'JPEG XL image', mime: 'image/jxl' };
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return { id: 'heic', label: 'HEIC image', mime: 'image/heic' };
    if (/^avi[fs]$/.test(brand)) return { id: 'avif', label: 'AVIF image', mime: 'image/avif' };
    if (/^crx /.test(brand)) return { id: 'cr3', label: 'Canon RAW photo', mime: 'image/x-canon-cr3' };
    if (/^qt  $/.test(brand)) return { id: 'mov', label: 'QuickTime video', mime: 'video/quicktime' };
    if (/^M4A |^M4B /.test(brand)) return { id: 'm4a', label: 'MPEG-4 audio', mime: 'audio/mp4' };
    return { id: 'mp4', label: 'MPEG-4 video', mime: 'video/mp4' };
  }
  if (ascii(b, 0, 'II*\0') || ascii(b, 0, 'MM\0*')) {
    // Many camera RAW formats are TIFF containers; the extension decides which.
    return { id: 'tiff', label: 'TIFF image', mime: 'image/tiff' };
  }
  if (ascii(b, 0, 'IIRO') || ascii(b, 0, 'IIU\0')) return { id: 'raw', label: 'Camera RAW photo', mime: 'image/x-raw' };
  if (ascii(b, 0, 'FUJIFILMCCD-RAW')) return { id: 'raf', label: 'Fujifilm RAW photo', mime: 'image/x-fuji-raf' };
  if (ascii(b, 0, '%PDF-')) return { id: 'pdf', label: 'PDF document', mime: 'application/pdf' };
  if (ascii(b, 0, 'PK\x03\x04') || ascii(b, 0, 'PK\x05\x06')) return { id: 'zip', label: 'ZIP archive', mime: 'application/zip' };
  if (bytes(b, 0, [0x1f, 0x8b])) return { id: 'gzip', label: 'Gzip archive', mime: 'application/gzip' };
  if (ascii(b, 0, 'BZh')) return { id: 'bzip2', label: 'Bzip2 archive', mime: 'application/x-bzip2' };
  if (bytes(b, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { id: 'xz', label: 'XZ archive', mime: 'application/x-xz' };
  if (bytes(b, 0, [0x28, 0xb5, 0x2f, 0xfd])) return { id: 'zstd', label: 'Zstandard archive', mime: 'application/zstd' };
  if (bytes(b, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { id: '7z', label: '7-Zip archive', mime: 'application/x-7z-compressed' };
  if (ascii(b, 0, 'Rar!\x1a\x07')) return { id: 'rar', label: 'RAR archive', mime: 'application/vnd.rar' };
  if (ascii(b, 257, 'ustar')) return { id: 'tar', label: 'Tar archive', mime: 'application/x-tar' };
  if (ascii(b, 0, '!<arch>\ndebian')) return { id: 'deb', label: 'Debian package', mime: 'application/vnd.debian.binary-package' };
  if (bytes(b, 0, [0xed, 0xab, 0xee, 0xdb])) return { id: 'rpm', label: 'RPM package', mime: 'application/x-rpm' };
  if (ascii(b, 0, 'koly') || ascii(b, b.length - 512, 'koly')) return { id: 'dmg', label: 'Disk image', mime: 'application/x-apple-diskimage' };
  if (ascii(b, 0, 'ID3') || bytes(b, 0, [0xff, 0xfb]) || bytes(b, 0, [0xff, 0xf3]) || bytes(b, 0, [0xff, 0xf2])) return { id: 'mp3', label: 'MP3 audio', mime: 'audio/mpeg' };
  if (ascii(b, 0, 'fLaC')) return { id: 'flac', label: 'FLAC audio', mime: 'audio/flac' };
  if (ascii(b, 0, 'OggS')) return { id: 'ogg', label: 'Ogg media', mime: 'audio/ogg' };
  if (ascii(b, 0, 'FORM') && (ascii(b, 8, 'AIFF') || ascii(b, 8, 'AIFC'))) return { id: 'aiff', label: 'AIFF audio', mime: 'audio/aiff' };
  if (bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { id: 'mkv', label: 'Matroska / WebM video', mime: 'video/x-matroska' };
  if (ascii(b, 0, 'FLV')) return { id: 'flv', label: 'Flash video', mime: 'video/x-flv' };
  if (bytes(b, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return { id: 'asf', label: 'Windows Media file', mime: 'video/x-ms-asf' };
  if (bytes(b, 0, [0x00, 0x00, 0x01, 0xba]) || bytes(b, 0, [0x00, 0x00, 0x01, 0xb3])) return { id: 'mpeg', label: 'MPEG video', mime: 'video/mpeg' };
  if (bytes(b, 0, [0x00, 0x01, 0x00, 0x00, 0x00]) || ascii(b, 0, 'true')) return { id: 'ttf', label: 'TrueType font', mime: 'font/ttf' };
  if (ascii(b, 0, 'OTTO')) return { id: 'otf', label: 'OpenType font', mime: 'font/otf' };
  if (ascii(b, 0, 'wOFF')) return { id: 'woff', label: 'Web font', mime: 'font/woff' };
  if (ascii(b, 0, 'wOF2')) return { id: 'woff2', label: 'Web font', mime: 'font/woff2' };
  if (ascii(b, 0, 'glTF')) return { id: 'glb', label: '3D model (glTF binary)', mime: 'model/gltf-binary' };
  if (ascii(b, 0, 'SQLite format 3\0')) return { id: 'sqlite', label: 'SQLite database', mime: 'application/vnd.sqlite3' };
  if (bytes(b, 0, [0x4d, 0x5a])) return { id: 'exe', label: 'Windows program', mime: 'application/vnd.microsoft.portable-executable' };
  if (bytes(b, 0, [0x7f, 0x45, 0x4c, 0x46])) return { id: 'elf', label: 'Linux program', mime: 'application/x-elf' };
  if (bytes(b, 0, [0xcf, 0xfa, 0xed, 0xfe]) || bytes(b, 0, [0xca, 0xfe, 0xba, 0xbe])) return { id: 'macho', label: 'macOS program', mime: 'application/x-mach-binary' };
  if (bytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { id: 'ole', label: 'Microsoft Office document (legacy)', mime: 'application/x-ole-storage' };
  if (ascii(b, 0, 'bplist00')) return { id: 'bplist', label: 'Binary property list', mime: 'application/x-bplist' };
  if (ascii(b, 0, 'BEGIN:VCARD')) return { id: 'vcf', label: 'Contact card', mime: 'text/vcard' };
  if (ascii(b, 0, 'BEGIN:VCALENDAR')) return { id: 'ics', label: 'Calendar', mime: 'text/calendar' };
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 512)).trimStart();
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(head))) return { id: 'svg', label: 'SVG image', mime: 'image/svg+xml' };
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return { id: 'html', label: 'HTML document', mime: 'text/html' };
  if (/^<\?xml/i.test(head)) return { id: 'xml', label: 'XML document', mime: 'application/xml' };
  if (/^\{\s*"cells"\s*:/.test(head)) return { id: 'ipynb', label: 'Notebook', mime: 'application/x-ipynb+json' };
  if (/^solid\s/i.test(head) && /facet normal/i.test(head)) return { id: 'stl', label: '3D model (STL)', mime: 'model/stl' };
  if (/^(Return-Path|Received|From|Delivered-To|MIME-Version|Message-ID):/m.test(head) && /\n(Subject|From|To):/i.test(head)) return { id: 'eml', label: 'E-mail message', mime: 'message/rfc822' };
  if (looksText(b)) return { id: 'text', label: 'Plain text', mime: 'text/plain' };
  return undefined;
}

/** True when the bytes decode as text (UTF-8 or UTF-16 with BOM) with few control characters. */
export function looksText(b: Uint8Array): boolean {
  if (b.length === 0) return true;
  if (bytes(b, 0, [0xff, 0xfe]) || bytes(b, 0, [0xfe, 0xff]) || bytes(b, 0, [0xef, 0xbb, 0xbf])) return true;
  const n = Math.min(b.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  if (bad / n > 0.02) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.slice(0, Math.max(0, n - 4)));
    return true;
  } catch {
    // Latin-1 text still reads fine.
    return bad === 0;
  }
}

/** Decodes text honouring a BOM; returns the encoding it used. */
export function decodeText(b: Uint8Array): { text: string; encoding: string } {
  if (bytes(b, 0, [0xef, 0xbb, 0xbf])) return { text: new TextDecoder('utf-8').decode(b.slice(3)), encoding: 'UTF-8 (BOM)' };
  if (bytes(b, 0, [0xff, 0xfe])) return { text: new TextDecoder('utf-16le').decode(b.slice(2)), encoding: 'UTF-16 LE' };
  if (bytes(b, 0, [0xfe, 0xff])) return { text: new TextDecoder('utf-16be').decode(b.slice(2)), encoding: 'UTF-16 BE' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' };
  } catch {
    // A file cut in the middle of a character, or a legacy encoding.
    const utf = new TextDecoder('utf-8').decode(b);
    if ((utf.match(/�/g) ?? []).length <= 2) return { text: utf, encoding: 'UTF-8' };
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' };
  }
}

/** Classic hex dump lines: offset, 16 hex bytes, ASCII. */
export function hexLines(b: Uint8Array, offset = 0): { offset: string; hex: string; ascii: string }[] {
  const out: { offset: string; hex: string; ascii: string }[] = [];
  for (let i = 0; i < b.length; i += 16) {
    const row = b.slice(i, i + 16);
    out.push({
      offset: (offset + i).toString(16).padStart(8, '0'),
      hex: [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' '),
      ascii: [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join(''),
    });
  }
  return out;
}
