#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Makes the Microsoft Store (MSIX) tiles and logos from build/icon.svg, in every size
// Windows asks for, into build/appx (electron-builder's appx target picks them up from there
// and builds resources.pri from the scale-/targetsize- names).
//
//   node scripts/store-assets.mjs [--out build/appx] [--check]
//
// --check makes nothing; it fails when a file is missing or has the wrong size (for CI).
// See docs/STORES.md.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'build/appx');
const CHECK = args.includes('--check');
const SVG = readFileSync(path.join(ROOT, 'build', 'icon.svg'));

const SCALES = [100, 125, 150, 200, 400];
// Square44x44Logo target sizes: the taskbar, Start, the title bar and Explorer pick from these.
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

/**
 * Every asset: name, width and height at scale 100, and how much of the shorter side the
 * icon fills (tiles leave room; the small app-list logo is full size).
 */
const ASSETS = [
  { name: 'Square44x44Logo', w: 44, h: 44, fill: 1 },
  { name: 'Square150x150Logo', w: 150, h: 150, fill: 0.66 },
  { name: 'Wide310x150Logo', w: 310, h: 150, fill: 0.66 },
  { name: 'SmallTile', w: 71, h: 71, fill: 0.66 },
  { name: 'LargeTile', w: 310, h: 310, fill: 0.6 },
  { name: 'StoreLogo', w: 50, h: 50, fill: 1 },
  { name: 'SplashScreen', w: 620, h: 300, fill: 0.5 },
];

/** Every file to make: [file name, width, height, icon size]. */
export function plan() {
  const files = [];
  for (const a of ASSETS) {
    for (const scale of SCALES) {
      const w = Math.round((a.w * scale) / 100);
      const h = Math.round((a.h * scale) / 100);
      files.push([`${a.name}.scale-${scale}.png`, w, h, Math.round(Math.min(w, h) * a.fill)]);
    }
  }
  for (const t of TARGET_SIZES) {
    files.push([`Square44x44Logo.targetsize-${t}.png`, t, t, t]);
    // "Unplated": shown without a coloured plate behind it on the taskbar and in Start.
    files.push([`Square44x44Logo.targetsize-${t}_altform-unplated.png`, t, t, t]);
    files.push([`Square44x44Logo.targetsize-${t}_altform-lightunplated.png`, t, t, t]);
  }
  return files;
}

async function make([name, w, h, icon]) {
  // The SVG is 1024 units square: at 72 dpi it renders at 1024 px, larger than any icon here.
  const logo = await sharp(SVG, { density: 72 })
    .resize(icon, icon, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, left: Math.round((w - icon) / 2), top: Math.round((h - icon) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, name));
}

async function check(files) {
  const bad = [];
  for (const [name, w, h] of files) {
    const p = path.join(OUT, name);
    if (!existsSync(p)) { bad.push(`${name}: missing`); continue; }
    const m = await sharp(p).metadata();
    if (m.width !== w || m.height !== h) bad.push(`${name}: ${m.width}x${m.height}, expected ${w}x${h}`);
  }
  const extra = existsSync(OUT) ? readdirSync(OUT).filter((n) => n.endsWith('.png') && !files.some(([f]) => f === n)) : [];
  for (const n of extra) bad.push(`${n}: not a Store asset (electron-builder would package it anyway)`);
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = plan();
  if (CHECK) {
    const bad = await check(files);
    if (bad.length) {
      console.error(`store-assets: ${bad.length} problem(s) in ${path.relative(ROOT, OUT)}:\n  ${bad.join('\n  ')}\nRun node scripts/store-assets.mjs to make them again.`);
      process.exit(1);
    }
    console.log(`store-assets: all ${files.length} files in ${path.relative(ROOT, OUT)} are right`);
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const f of files) await make(f);
    console.log(`store-assets: wrote ${files.length} files to ${path.relative(ROOT, OUT)}`);
  }
}
