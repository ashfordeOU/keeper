#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Fills the package-manager manifests in packaging/ with a release's version and
// checksums, so Homebrew, Scoop, winget, Chocolatey, AUR, Flatpak and npm all
// describe exactly the files that were published.
//
//   node scripts/render-packaging.mjs --version 0.2.0 [--assets release] [--sums release/SHA256SUMS.txt]
//        [--out dist-packaging] [--only npm,homebrew] [--cli dist-cli/keeper.cjs] [--date 2026-10-30] [--allow-missing]
//
// Templates are the *.tmpl files under packaging/ (other files there are copied as they are):
//   {{version}}           0.2.0
//   {{tag}}               v0.2.0
//   {{date}}              the release date, YYYY-MM-DD
//   {{sha256:NAME}}       the SHA-256 of the release file NAME (NAME may itself contain {{version}})

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** "abc…  Keeper-mac-arm64.dmg" lines (sha256sum format, with or without the binary-mode star) -> { name: sum } */
export function parseSums(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
    if (m) out[path.basename(m[2])] = m[1].toLowerCase();
  }
  return out;
}

/** Fills one template. Throws with every missing checksum listed, unless allowMissing. */
export function renderTemplate(text, { version, sums, date, allowMissing = false }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`not a version: ${version}`);
  const missing = [];
  const out = text
    .replaceAll('{{version}}', version)
    .replaceAll('{{tag}}', `v${version}`)
    .replaceAll('{{date}}', date)
    .replace(/\{\{sha256:([^}]+)\}\}/g, (_, name) => {
      const sum = sums[name.trim()];
      if (sum) return sum;
      missing.push(name.trim());
      return 'MISSING-SHA256';
    });
  if (missing.length && !allowMissing) throw new Error(`no checksum for ${[...new Set(missing)].join(', ')}`);
  const left = out.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`unknown placeholder ${left[0]}`);
  return out;
}

/** Every file under dir, as paths relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p)];
  });
}

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** Checksums from a SHA256SUMS file, else computed from the files in the assets folder. */
export function loadSums({ sumsFile, assetsDir }) {
  if (sumsFile && existsSync(sumsFile)) return parseSums(readFileSync(sumsFile, 'utf8'));
  const sums = {};
  if (assetsDir && existsSync(assetsDir)) {
    for (const n of readdirSync(assetsDir)) {
      const p = path.join(assetsDir, n);
      if (statSync(p).isFile() && !/\.(yml|blockmap)$/.test(n)) sums[n] = sha256File(p);
    }
  }
  return sums;
}

/** Renders packaging/<channel>/** into out/<channel>/**. Returns the files written. */
export function renderAll({ version, sums, date, out, only, cli, allowMissing = false, source = path.join(ROOT, 'packaging') }) {
  const written = [];
  const channels = readdirSync(source).filter((c) => statSync(path.join(source, c)).isDirectory() && (!only || only.includes(c)));
  for (const channel of channels) {
    for (const rel of walk(path.join(source, channel))) {
      const from = path.join(source, channel, rel);
      const to = path.join(out, channel, rel.replace(/\.tmpl$/, ''));
      mkdirSync(path.dirname(to), { recursive: true });
      if (rel.endsWith('.tmpl')) writeFileSync(to, renderTemplate(readFileSync(from, 'utf8'), { version, sums, date, allowMissing }));
      else copyFileSync(from, to);
      written.push(to);
    }
    // The npm package carries the bundled command and the licence next to its manifest.
    if (channel === 'npm') {
      if (!cli || !existsSync(cli)) throw new Error('the npm package needs --cli <path to dist-cli/keeper.cjs>');
      copyFileSync(cli, path.join(out, 'npm', 'keeper.cjs'));
      copyFileSync(path.join(ROOT, 'LICENSE.md'), path.join(out, 'npm', 'LICENSE.md'));
      written.push(path.join(out, 'npm', 'keeper.cjs'), path.join(out, 'npm', 'LICENSE.md'));
    }
  }
  return written;
}

function parseArgs(argv) {
  const a = { assets: 'release', out: 'dist-packaging', date: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i] ?? '';
    if (k === '--version') a.version = val().replace(/^v/, '');
    else if (k === '--assets') a.assets = val();
    else if (k === '--sums') a.sums = val();
    else if (k === '--out') a.out = val();
    else if (k === '--only') a.only = val().split(',').filter(Boolean);
    else if (k === '--cli') a.cli = val();
    else if (k === '--date') a.date = val();
    else if (k === '--allow-missing') a.allowMissing = true;
    else throw new Error(`unknown option ${k}`);
  }
  if (!a.version) a.version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const sums = loadSums({ sumsFile: a.sums ?? path.join(a.assets, 'SHA256SUMS.txt'), assetsDir: a.assets });
    const files = renderAll({ version: a.version, sums, date: a.date, out: a.out, only: a.only, cli: a.cli, allowMissing: a.allowMissing });
    for (const f of files) console.log(path.relative(process.cwd(), f));
  } catch (e) {
    console.error(`render-packaging: ${e.message}`);
    process.exit(1);
  }
}
