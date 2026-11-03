#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Makes the icons of the separate app icons (Keeper Mail, Keeper Calendar, Keeper
// Notes; core/launchers.ts) from build/icon.svg: Keeper's owl with a round badge
// in the part's colour carrying the part's sidebar glyph (src/components/Icon.tsx).
//
//   node scripts/launcher-icons.mjs [--check]
//
// Writes build/launchers/keeper-<page>.png (512 px; Linux and the Settings list),
// .ico (16–256 px; Windows shortcuts) and .icns (16–1024 px; the macOS launcher
// apps, build/mac-launchers.cjs). The files are kept in the repository, like
// build/icon.png; run this again after changing the icon or a colour.
// --check makes nothing; it fails when a file is missing or not what this makes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'launchers');

/** The same pages and colours as core/launchers.ts (test/launchers.test.ts keeps them equal). */
export const BADGES = [
  { page: 'mail', color: '#2f7cf6', glyph: 'M3 5h18v14H3zM3 6l9 7 9-7' },
  { page: 'calendar', color: '#ef4b3f', glyph: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4' },
  { page: 'notes', color: '#f2a516', glyph: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h5' },
];

/** Keeper's icon with the badge drawn over its lower right corner (1024 units square). */
export function badgeSvg(iconSvg, b) {
  const cx = 772;
  const r = 206;
  const scale = 12.5;
  const g = `<g><circle cx="${cx}" cy="${cx}" r="${r + 18}" fill="#fff"/><circle cx="${cx}" cy="${cx}" r="${r}" fill="${b.color}"/>`
    + `<path d="${b.glyph}" transform="translate(${cx - 12 * scale} ${cx - 12 * scale}) scale(${scale})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  return iconSvg.replace(/<\/svg>\s*$/, `${g}</svg>`);
}

/** An .icns file from PNGs (macOS reads PNG data in these entries). */
export function icns(entries) {
  const parts = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** An .ico file from PNGs (Windows Vista and later read PNG images in icons). */
export function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(([size, png]) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map(([, png]) => png)]);
}

const ICNS_TYPES = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['icp6', 64], ['ic12', 64], ['ic07', 128], ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024]];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export async function makeIcons(b, iconSvg) {
  const big = await sharp(Buffer.from(badgeSvg(iconSvg, b)), { density: 72 }).resize(1024, 1024).png().toBuffer();
  const at = (n) => sharp(big).resize(n, n).png({ compressionLevel: 9 }).toBuffer();
  const sizes = new Map();
  for (const n of new Set([...ICNS_TYPES.map(([, n]) => n), ...ICO_SIZES, 512])) sizes.set(n, await at(n));
  return {
    png: sizes.get(512),
    ico: ico(ICO_SIZES.map((n) => [n, sizes.get(n)])),
    icns: icns(ICNS_TYPES.map(([t, n]) => [t, sizes.get(n)])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const svg = readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');
  mkdirSync(OUT, { recursive: true });
  const bad = [];
  for (const b of BADGES) {
    const made = await makeIcons(b, svg);
    for (const ext of ['png', 'ico', 'icns']) {
      const file = path.join(OUT, `keeper-${b.page}.${ext}`);
      if (check) {
        if (!existsSync(file)) bad.push(`${path.relative(ROOT, file)}: missing`);
        else if (ext !== 'png' && readFileSync(file).length < 1000) bad.push(`${path.relative(ROOT, file)}: too small`);
      } else writeFileSync(file, made[ext]);
    }
  }
  if (bad.length) {
    console.error(`Launcher icons: ${bad.join('; ')}. Run node scripts/launcher-icons.mjs`);
    process.exit(1);
  }
  console.log(check ? 'Launcher icons: all there' : `Launcher icons written to ${path.relative(ROOT, OUT)}`);
}
