#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plain-text copies of LICENSE.md for the installers' licence pages (they show
// Markdown as raw text). Both outputs are committed too, so packaging works
// without running this first.
//
//   build/installer-license.txt  Windows installer (NSIS): UTF-8 with a byte
//                                order mark and CRLF, so "Ü" and "®" show.
//   build/dmg-license.txt        the Mac disk image's licence window: the disk
//                                image tool reads it as UTF-8 and stores it in
//                                Mac Roman, which has no byte order mark and no
//                                characters outside its 256, so neither is used.
//
// Neither name starts with "license_": the packager would otherwise pick such
// files up by itself (for the disk image too) instead of the ones named in
// electron-builder.yml.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The characters Mac Roman has above ASCII, in byte order 0x80–0xFF. */
export const MAC_ROMAN_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

/** Can Python's "mac_roman" codec encode this text? (tab, newlines and printable ASCII, plus the table above) */
export function macRomanEncodable(text) {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) continue;
    if (!MAC_ROMAN_HIGH.includes(ch)) return false;
  }
  return true;
}

const SWAPS = [
  [/[\u2018\u2019\u201a\u201b\u2032]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/g, '"'],
  [/[\u2010\u2011\u2012\u2015\u2212]/g, '-'],
  [/\u2192/g, '->'],
  [/\u2190/g, '<-'],
  [/[\u2022\u2023\u25cf]/g, '*'],
  [/[\u2002-\u200a\u202f\u205f\u3000]/g, ' '],
  [/[\u200b-\u200d\u2060\ufeff]/g, ''],
  [/\u0141/g, 'L'], [/\u0142/g, 'l'], [/\u0110/g, 'D'], [/\u0111/g, 'd'],
];

/**
 * Text the disk image tool can store: no byte order mark, LF line ends, and
 * every character Mac Roman lacks swapped for a plain one (or decomposed to
 * its base letter, or dropped).
 */
export function toMacRomanText(text) {
  let t = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  let out = '';
  for (const ch of t) {
    if (macRomanEncodable(ch)) { out += ch; continue; }
    const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    out += macRomanEncodable(base) ? base : '?';
  }
  return out;
}

/** LICENSE.md as plain text: no Markdown marks, links written out. */
export function markdownToText(md) {
  return md
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line
      .replace(/^#{1,6}\s+/, '')                       // headings
      .replace(/^---+\s*$/, '')                        // rules
      .replace(/^(\s*)[*-]\s+/, '$1- ')                // list markers
      .replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => (url.startsWith('#') || label === url ? label : `${label} (${url})`))
      .replace(/<(https?:\/\/[^>]+)>/g, '$1')          // autolinks
      .replace(/(\*\*|__)(.+?)\1/g, '$2')              // bold
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2') // italics
      .replace(/`([^`]+)`/g, '$1')                     // code
      .replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('..', import.meta.url);
  const text = markdownToText(readFileSync(new URL('LICENSE.md', root), 'utf8'));
  writeFileSync(new URL('build/installer-license.txt', root), '\ufeff' + text.replace(/\n/g, '\r\n') + '\r\n');
  writeFileSync(new URL('build/dmg-license.txt', root), toMacRomanText(text) + '\n');
  // Older checkouts wrote build/license_en.txt (with a byte order mark), and the
  // disk image tool picks any license_*.txt up by itself: a leftover breaks it.
  rmSync(new URL('build/license_en.txt', root), { force: true });
  console.log('build/installer-license.txt and build/dmg-license.txt written from LICENSE.md');
}
