#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writes THIRD-PARTY-NOTICES.md: who made the parts Keeper ships, and the terms
// each part comes with.
//
//   node scripts/third-party-notices.mjs            (or: npm run notices)
//
// It walks the installed production dependency tree (package.json "dependencies")
// plus every devDependency the app's own code imports (those are bundled into the
// interface or the main process by Vite and esbuild), reads each package's
// "license" field and licence files, and adds hand-written sections for parts
// with extra terms (LGPL, GPL, EPL, CC BY, fonts, Chromium) and for the tools and
// models Keeper downloads only when a feature needs them. Re-run it after
// changing dependencies and commit the result.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
const pkg = readJson(path.join(ROOT, 'package.json'));

// Folders whose code ends up in the app (relay/ and server/ are separate programs; scripts/ and test/ are tooling).
const APP_DIRS = ['src', 'electron', 'core', 'cli', 'companion'];
// Never shipped: build tools, test tools and type packages. Electron has its own section below.
const NOT_SHIPPED = new Set(['electron', 'electron-builder', 'esbuild', 'vite', 'vitest', 'typescript', 'concurrently', 'cross-env', 'wait-on', '@vitejs/plugin-react']);
// Left out of the packaged app by electron-builder.yml's `files` ('!node_modules/@napi-rs/**').
const EXCLUDED = [/^@napi-rs\//];
// One licence text longer than this is linked rather than copied in full.
const MAX_TEXT = 64 * 1024;

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function read(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

// ---- 1. Which devDependencies does the app's own code import?

function walkSource(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walkSource(p, out);
    else if (/\.(tsx?|mjs|cjs|js)$/.test(n)) out.push(p);
  }
  return out;
}

function importedPackages() {
  const names = new Set();
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"./][^'"]*)['"]/gm;
  for (const dir of APP_DIRS) {
    for (const f of walkSource(path.join(ROOT, dir))) {
      // Type-only imports leave nothing in the build.
      const text = read(f).replace(/^\s*import\s+type\b[^;]*;/gm, '');
      for (const m of text.matchAll(re)) {
        const spec = m[1];
        if (spec.startsWith('node:')) continue;
        names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
  }
  return names;
}

// ---- 2. Walk the installed tree from those roots.

/** Finds `name` the way Node does: in node_modules next to `fromDir`, then in each parent up to the root. */
function locate(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return path.dirname(candidate);
    if (path.relative(ROOT, dir) === '' || dir === path.dirname(dir)) return null;
    dir = path.dirname(dir);
    // Step out of a nested node_modules folder to the package that owns it.
    if (path.basename(dir) === 'node_modules') dir = path.dirname(dir);
    else if (path.basename(path.dirname(dir)) === 'node_modules' && path.basename(dir).startsWith('@')) dir = path.dirname(path.dirname(dir));
  }
}

const found = new Map(); // "name@version" -> { name, version, dir, via: Set }

function visit(name, fromDir, via) {
  const dir = locate(name, fromDir);
  if (!dir) return; // optional or platform-specific package not installed here
  const p = readJson(path.join(dir, 'package.json'));
  if (EXCLUDED.some((re) => re.test(p.name))) return;
  const key = `${p.name}@${p.version}`;
  if (found.has(key)) { found.get(key).via.add(via); return; }
  found.set(key, { name: p.name, version: p.version, dir, pkg: p, via: new Set([via]) });
  const deps = { ...(p.peerDependencies || {}), ...(p.optionalDependencies || {}), ...(p.dependencies || {}) };
  for (const d of Object.keys(deps)) visit(d, dir, via);
}

const imported = importedPackages();
const bundledDev = Object.keys(pkg.devDependencies || {}).filter((d) => imported.has(d) && !NOT_SHIPPED.has(d) && !d.startsWith('@types/'));
for (const d of Object.keys(pkg.dependencies || {})) visit(d, ROOT, 'app');
for (const d of bundledDev) visit(d, ROOT, 'interface');

// ---- 3. Licence field, licence files and copyright lines.

/** The package's own "license" field, or a best guess from its licence file when the field is missing. */
function licenseOf(p, fileText = '') {
  if (typeof p.license === 'string') return p.license;
  if (p.license && typeof p.license === 'object' && p.license.type) return p.license.type;
  if (Array.isArray(p.licenses)) return p.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  const t = fileText.replace(/\s+/g, ' ');
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT (from licence file)';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(t)) return 'ISC (from licence file)';
  if (/Apache License,? Version 2\.0/i.test(t)) return 'Apache-2.0 (from licence file)';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /endorse or promote/i.test(t) ? 'BSD-3-Clause (from licence file)' : 'BSD-2-Clause (from licence file)';
  return 'see licence file';
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense|ofl|third[-_]?party[-_]?notices)([._-].*)?$/i;

/** Licence-like files at the top of the package and one folder down (some ship extra ones next to bundled code or fonts). */
function licenseFiles(dir) {
  const out = [];
  const scan = (d, depth) => {
    let names = [];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (depth === 0 && n !== 'node_modules' && !n.startsWith('.')) scan(p, 1);
      } else if (LICENSE_FILE.test(n) && !/\.(js|ts|json|html?)$/i.test(n)) out.push(p);
    }
  };
  scan(dir, 0);
  return out;
}

const COPYRIGHT = /^\s*(?:[-*#>]\s*)?(?:copyright\b(?!\s+(?:notice|holder|owner|law|license|and\b|or\b|statement))|\(c\)\s*\d{4}|©\s*\d{4})/i;

function copyrightLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!COPYRIGHT.test(line) || line.length > 200) continue;
    if (/^copyright\s*(\(c\)|©)?\s*(<?year>?|\[yyyy\]|\[year\]|yyyy|\{yyyy\})/i.test(line)) continue; // template placeholders
    if (!out.includes(line)) out.push(line);
    if (out.length === 3) break;
  }
  return out;
}

function authorOf(p) {
  const a = p.author;
  if (!a) return '';
  return typeof a === 'string' ? a.replace(/\s*[<(].*$/, '') : a.name || '';
}

function normalise(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !COPYRIGHT.test(l.trim()) && !/^\s*all rights reserved\.?\s*$/i.test(l))
    .join('\n')
    .replace(/^\s*\n+/, '')
    .replace(/\s+$/, '');
}

const texts = new Map(); // hash -> { text, file, users: [] }
const rows = [];
for (const e of [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }))) {
  const files = licenseFiles(e.dir);
  const copyrights = [];
  let firstText = '';
  for (const f of files) {
    const t = read(f);
    firstText ||= t;
    for (const c of copyrightLines(t)) if (!copyrights.includes(c) && copyrights.length < 3) copyrights.push(c);
    const body = normalise(t);
    if (!body) continue;
    const hash = createHash('sha256').update(body.replace(/\s+/g, ' ').toLowerCase()).digest('hex').slice(0, 12);
    if (!texts.has(hash)) texts.set(hash, { text: body, file: `${e.name}/${path.relative(e.dir, f).split(path.sep).join('/')}`, users: [] });
    const users = texts.get(hash).users;
    if (!users.includes(`${e.name}@${e.version}`)) users.push(`${e.name}@${e.version}`);
  }
  const author = authorOf(e.pkg);
  rows.push({
    name: e.name,
    version: e.version,
    license: licenseOf(e.pkg, firstText),
    copyright: copyrights.length ? copyrights.join('; ') : author ? `${author} (package author)` : '—',
    url: typeof e.pkg.repository === 'string' ? e.pkg.repository : e.pkg.repository?.url || e.pkg.homepage || '',
  });
}

// ---- 4. Facts read from the tree and the source, so the hand-written sections stay current.

const ver = (name) => { const d = locate(name, ROOT); return d ? readJson(path.join(d, 'package.json')).version : '(not installed)'; };
const grab = (file, re, fallback = '(see source)') => (read(path.join(ROOT, file)).match(re) || [])[1] || fallback;

const ffDir = locate('ffmpeg-static', ROOT);
const ffPkg = ffDir ? readJson(path.join(ffDir, 'package.json')) : {};
const ffTag = ffPkg['ffmpeg-static']?.['binary-release-tag'] || '(unknown)';
const ffReadme = ffDir ? read(path.join(ffDir, 'ffmpeg.README')) : '';
const ffBuildVersion = (ffReadme.match(/^\s*version:\s*(\S+)/m) || [])[1];
const ffBuildName = (ffReadme.match(/^\s*build:\s*(\S+)/m) || [])[1];
const ffSources = ((ffDir ? read(path.join(ffDir, 'README.md')) : '').match(/## Sources of the binaries\s*\n([\s\S]*?)(?:\n## |$)/) || [])[1]?.trim();

const libvipsDir = locate('@img/sharp-libvips-linux-x64', path.join(ROOT, 'node_modules', 'sharp')) || locate('@img/sharp-libvips-linux-x64', ROOT);
const libvipsVersion = libvipsDir ? read(path.join(libvipsDir, 'versions.json')).match(/"vips":\s*"([^"]+)"/)?.[1] : null;

const ofl = (() => {
  const d = locate('pdfjs-dist', ROOT);
  const t = d ? read(path.join(d, 'standard_fonts', 'LICENSE_LIBERATION')) : '';
  const i = t.indexOf('SIL OPEN FONT LICENSE Version 1.1');
  return i >= 0 ? t.slice(i).trim() : '';
})();

const versions = {
  cloudflared: grab('core/link/cloudflared.ts', /CLOUDFLARED_VERSION\s*=\s*'([^']+)'/),
  scrcpy: grab('core/screen/mirror.ts', /SCRCPY_VERSION\s*=\s*'([^']+)'/),
  rclone: grab('scripts/fetch-rclone.mjs', /RCLONE_VERSION\s*=\s*'([^']+)'/),
  agentDesktop: grab('scripts/fetch-agent-desktop.mjs', /AGENT_DESKTOP_VERSION\s*=\s*'([^']+)'/),
  ytdlp: grab('electron/services/video-download.ts', /YTDLP\s*=\s*\{\s*version:\s*'([^']+)'/),
  e5: grab('core/brain/e5.ts', /huggingface\.co\/([^/]+\/[^/]+)\/resolve/, 'Xenova/multilingual-e5-small'),
  whisper: [...read(path.join(ROOT, 'core/whisper.ts')).matchAll(/repo:\s*'([^']+)'/g)].map((m) => m[1]),
};

// Keeper Mesh's WireGuard parts: the MESH_NOTICES table in core/mesh/binaries.ts.
const meshNotices = (() => {
  const src = read(path.join(ROOT, 'core/mesh/binaries.ts'));
  const consts = Object.fromEntries([...src.matchAll(/export const (\w+)\s*=\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  const body = (src.match(/MESH_NOTICES[^=]*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
  const field = (block, key) => {
    const m = block.match(new RegExp(`\\b${key}:\\s*(?:'([^']*)'|(\\w+))`));
    return m ? (m[1] ?? consts[m[2]] ?? '') : '';
  };
  return body.split(/\n\s*\},?\s*\n/).filter((b) => /name:/.test(b)).map((b) => ({
    name: field(b, 'name'), version: field(b, 'version'), licence: field(b, 'licence'), source: field(b, 'source'), shipped: field(b, 'shipped'), note: field(b, 'note'),
  }));
})();
const wireguardGoMit = `Copyright (C) 2017-2025 WireGuard LLC. All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// ---- 5. Write the file.

const md = [];
const p = (s = '') => md.push(s);
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');

p('# Third-party notices');
p();
p('Keeper by Ashforde® is built with the work of many other people. This file lists the parts that come with Keeper, who made them and the licence each one is used under. Keeper\'s own code is under the [PolyForm Shield License 1.0.0](LICENSE.md); none of the terms below change that, and none of Keeper\'s terms limit your rights under these licences.');
p();
p('Questions, or want the source code for any part listed here? Write to **contact@ashforde.org**.');
p();
p('<!-- Generated by scripts/third-party-notices.mjs (npm run notices). Edit that script, not this file. -->');
p();
p('## Contents');
p();
p('- [Parts with extra terms](#parts-with-extra-terms)');
p('- [Downloaded only when you use a feature](#downloaded-only-when-you-use-a-feature)');
p('- [Keeper Mesh and WireGuard](#keeper-mesh-and-wireguard)');
p('- [Packages included in Keeper](#packages-included-in-keeper)');
p('- [Licence texts](#licence-texts)');
p();
p('## Parts with extra terms');
p();

p(`### libheif and libheif-js (LGPL-3.0)`);
p();
p(`Keeper opens HEIC and HEIF photos with [libheif](https://github.com/strukturag/libheif) (© struktur AG and contributors), compiled to WebAssembly by [libheif-js](https://github.com/catdad-experiments/libheif-js) ${ver('libheif-js')} (© Kiril Vatev). Both are licensed under the GNU Lesser General Public License, version 3. The licence text is in \`node_modules/libheif-js/LICENSE\` inside the app and in [Licence texts](#licence-texts) below.`);
p();
p('- **Source:** <https://github.com/catdad-experiments/libheif-js> (the exact release: `https://github.com/catdad-experiments/libheif-js/tree/v' + ver('libheif-js') + '`) and <https://github.com/strukturag/libheif>.');
p('- **It is not merged into Keeper\'s code.** libheif-js ships as its own module, as plain files outside the app archive:');
p('  - Windows and Linux: `resources/app.asar.unpacked/node_modules/libheif-js/` in the Keeper folder;');
p('  - macOS: `Keeper.app/Contents/Resources/app.asar.unpacked/node_modules/libheif-js/`.');
p('- **To use your own build**, replace that folder with your modified libheif-js (it must keep the same `wasm-bundle.js` entry point), then restart Keeper. Keeper loads it with `require(\'libheif-js/wasm-bundle\')`.');
p();

p(`### sharp and libvips (Apache-2.0, LGPL-3.0-or-later)`);
p();
p(`Image conversion uses [sharp](https://sharp.pixelplumbing.com) ${ver('sharp')} (Apache-2.0, © Lovell Fuller and contributors). sharp loads [libvips](https://github.com/libvips/libvips)${libvipsVersion ? ` ${libvipsVersion}` : ''} (LGPL-3.0-or-later, © John Cupitt and others) from the separate \`@img/sharp-libvips-*\` package for your system. libvips is a shared library that is dynamically linked, so you can replace it: put your own build in \`app.asar.unpacked/node_modules/@img/sharp-libvips-<platform>/lib/\`.`);
p();
p('- **Source:** <https://github.com/libvips/libvips> and the build scripts at <https://github.com/lovell/sharp-libvips> (each release is tagged with its version).');
p('- The libvips package also contains other libraries (among them glib, pango, librsvg, libexif and fribidi under LGPL-3.0, and cairo under MPL-2.0); their licences are listed in the package\'s README and in the `@img/sharp-libvips-*` rows below.');
p();

p(`### FFmpeg (GPL-3.0-or-later), a separate program`);
p();
p(`Video features run [FFmpeg](https://ffmpeg.org) as a separate program; Keeper starts it and talks to it, but is not linked with it. The program comes from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) ${ffPkg.version || ''} (the npm wrapper is GPL-3.0-or-later, © Eugene Ware and contributors), release \`${ffTag}\`${ffBuildVersion ? `; the build this list was made from reports FFmpeg ${ffBuildVersion}${ffBuildName ? ` (\`${ffBuildName}\`)` : ''}` : ''}. The static builds are licensed under the GNU General Public License, version 3. Its licence and build notes ship next to it as \`ffmpeg.LICENSE\` and \`ffmpeg.README\` in \`app.asar.unpacked/node_modules/ffmpeg-static/\`.`);
p();
p(`- **This exact build:** <https://github.com/eugeneware/ffmpeg-static/releases/tag/${ffTag}> (each file there, with its README and LICENSE).`);
p(`- **FFmpeg source code:** ${ffBuildVersion ? `<https://ffmpeg.org/releases/ffmpeg-${ffBuildVersion}.tar.xz> and ` : ''}<https://git.ffmpeg.org/ffmpeg.git>.`);
if (ffSources) {
  p('- **Who builds the binaries** (from the ffmpeg-static README), where the build scripts and the sources of the bundled libraries are published:');
  for (const line of ffSources.split('\n').filter((l) => l.trim().startsWith('-'))) p(`  ${line.trim()}`);
}
p('- You can replace the `ffmpeg` (or `ffmpeg.exe`) file in that folder with any FFmpeg build you like.');
p('- If you would rather get the complete corresponding source from us, write to contact@ashforde.org. We will send it for as long as we offer this version of Keeper, and for at least three years after.');
p();

p(`### agent-desktop (Apache-2.0), a separate program`);
p();
p(`The computer-use tools read and press the controls in other apps with [agent-desktop](https://github.com/vercel-labs/agent-desktop) ${versions.agentDesktop} (Apache License 2.0, by Vercel Labs and the agent-desktop contributors). Keeper runs it as a separate program and ships the release's binaries unchanged, checked against pinned SHA-256 fingerprints (\`scripts/fetch-agent-desktop.mjs\`); on macOS it is re-signed with Keeper's own signature. Its licence and a NOTICE ship next to it as \`LICENSE.txt\` and \`NOTICE.txt\` in the \`agent-desktop\` folder of Keeper's resources.`);
p();
p(`- **Source:** <https://github.com/vercel-labs/agent-desktop/tree/${versions.agentDesktop}>; binaries from <https://github.com/vercel-labs/agent-desktop/releases/tag/${versions.agentDesktop}>.`);
p(`- The programs are built from Rust crates under Apache-2.0, MIT, MPL-2.0, Unicode-3.0 and Unlicense terms, listed in <https://github.com/vercel-labs/agent-desktop/blob/${versions.agentDesktop}/Cargo.lock>.`);
p();

p(`### elkjs (EPL-2.0)`);
p();
p(`Some diagram layouts are drawn with [elkjs](https://github.com/kieler/elkjs) ${ver('elkjs')} (Eclipse Public License 2.0, © Kiel University and others), which comes with Mermaid. It is used unchanged, and its source is available from the links below.`);
p();
p(`- **Source:** <https://github.com/kieler/elkjs/tree/${ver('elkjs')}> and <https://github.com/eclipse/elk>.`);
p();

p('### DB-IP Lite (CC BY 4.0)');
p();
p('When you turn on countries in Network Activity, Keeper downloads the free [IP Geolocation by DB-IP](https://db-ip.com) "IP to Country Lite" and "IP to ASN Lite" databases from <https://db-ip.com/db/lite.php>. They are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Keeper converts them into a compact lookup table on your computer; no other changes are made.');
p();

p('### OpenStreetMap map tiles and Nominatim (ODbL)');
p();
p('Places & Tracks can show an online map and look up place names; both are off until you turn them on. The map loads raster tiles from an OpenStreetMap tile server (by default <https://tile.openstreetmap.org>, or a server you choose) and names come from a Nominatim server (by default <https://nominatim.openstreetmap.org>). Map data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/); the credit is shown on the map. Keeper follows the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): requests carry a User-Agent that names Keeper, tiles are cached on your computer for a week and only fetched for what you look at, and names are asked for at most once a second. Nothing from these servers ships with Keeper.');
p();

p('### Natural Earth (public domain)');
p();
p('The offline world outline used by Network Activity and Places & Tracks comes from [Natural Earth](https://www.naturalearthdata.com) (public domain), simplified and rounded to 0.1°.');
p();

p(`### KaTeX and its fonts (MIT, SIL OFL 1.1)`);
p();
p(`Maths in notes is drawn with [KaTeX](https://katex.org) ${ver('katex')} (MIT, © Khan Academy and other contributors). The KaTeX fonts (\`KaTeX_*.woff2\`, \`.woff\`, \`.ttf\`) come from <https://github.com/KaTeX/katex-fonts>, are © 2009-2010 Design Science, Inc. and © 2014-2018 Khan Academy, and are licensed under the SIL Open Font License, Version 1.1. They are used unchanged.`);
p();
if (ofl) {
  p('<details><summary>SIL Open Font License, Version 1.1</summary>');
  p();
  p('````text');
  p(ofl);
  p('````');
  p();
  p('</details>');
  p();
}

p(`### Electron and Chromium`);
p();
p(`Keeper runs on [Electron](https://www.electronjs.org) ${ver('electron')} (MIT, © Electron contributors and GitHub Inc.), which includes [Chromium](https://www.chromium.org), Node.js, V8 and many other libraries under their own licences (BSD, MIT, LGPL, MPL and others). The full list and every licence text ship with the app:`);
p();
p('- Windows and Linux: `LICENSE.electron.txt` and `LICENSES.chromium.html` in the Keeper folder;');
p('- macOS: inside Keeper.app (right-click it and choose Show Package Contents).');
p();
p(`Source: <https://github.com/electron/electron/tree/v${ver('electron')}> and <https://source.chromium.org/chromium>.`);
p();

p('## Downloaded only when you use a feature');
p();
p('These are not part of the Keeper download. Keeper fetches them from their makers the first time you use a feature that needs them, checks each file against a pinned SHA-256 fingerprint, and keeps them on your computer.');
p();
p('| Part | Used for | Version | Licence | Made by | Comes from |');
p('|---|---|---|---|---|---|');
const dl = [
  ['cloudflared', 'Keeper Link over the internet', versions.cloudflared, 'Apache-2.0', 'Cloudflare, Inc.', 'https://github.com/cloudflare/cloudflared'],
  ['scrcpy (with adb)', 'Mirroring an Android phone', versions.scrcpy, 'Apache-2.0', 'Genymobile and contributors; adb by The Android Open Source Project', 'https://github.com/Genymobile/scrcpy'],
  ['rclone', 'Cloud storage', versions.rclone, 'MIT', 'Nick Craig-Wood and contributors', 'https://rclone.org (also packaged with some builds)'],
  ['yt-dlp', 'Saving videos from web pages', versions.ytdlp, 'Unlicense (the standalone programs also contain Python and other parts under their own licences)', 'yt-dlp contributors', 'https://github.com/yt-dlp/yt-dlp'],
  ['Whisper speech models (ONNX)', 'Speech to text on this computer', versions.whisper.join(', ') || 'see core/whisper.ts', 'MIT (Whisper, including large-v3-turbo, by OpenAI); see each model card for the ONNX conversion', 'OpenAI; converted by the ONNX Community', 'https://huggingface.co/onnx-community'],
  ['multilingual-e5-small', 'Search by meaning', versions.e5, 'MIT', 'Liang Wang et al., Microsoft; converted by Xenova', `https://huggingface.co/${versions.e5}`],
  ['u2netp', 'Removing image backgrounds', 'u2netp.onnx', 'Apache-2.0 (U²-Net)', 'Xuebin Qin et al.; packaged by rembg', 'https://github.com/xuebinqin/U-2-Net'],
  ['RFB-320 face detector', 'Finding faces to blur', 'version-RFB-320.onnx', 'MIT', 'Linzaer', 'https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB'],
  ['Tesseract language data (tessdata)', 'Reading text in images', '4.0.0', 'Apache-2.0', 'Google and the Tesseract contributors; packaged by tesseract.js', 'https://github.com/tesseract-ocr/tessdata'],
];
for (const r of dl) p(`| ${r.map(cell).join(' | ')} |`);
p();

p('## Keeper Mesh and WireGuard');
p();
p('Keeper Mesh uses WireGuard. None of these parts is inside the Keeper download; Keeper fetches the one your system needs the first time you turn Mesh on, checks it against a pinned SHA-256 fingerprint, or uses a copy your system already has.');
p();
p('| Part | Version | Licence | Source | How Keeper gets it | Notes |');
p('|---|---|---|---|---|---|');
for (const n of meshNotices) p(`| ${[n.name, n.version || '-', n.licence, n.source ? `<${n.source}>` : '-', n.shipped || '-', n.note].map(cell).join(' | ')} |`);
p();
p('<details><summary>wireguard-go licence (MIT)</summary>');
p();
p('````text');
p(wireguardGoMit);
p('````');
p();
p('</details>');
p();

p('## Packages included in Keeper');
p();
p(`${rows.length} packages, from the production dependencies and the libraries bundled into the app's interface and main process. Packages built for one kind of computer (for example \`@img/sharp-*\`) differ per platform; the list below was made from one build. Licence texts follow in the next section.`);
p();
p('| Package | Version | Licence | Copyright |');
p('|---|---|---|---|');
for (const r of rows) p(`| ${r.url ? `[${cell(r.name)}](${cell(r.url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/'))})` : cell(r.name)} | ${cell(r.version)} | ${cell(r.license)} | ${cell(r.copyright)} |`);
p();

p('## Licence texts');
p();
p('Each different licence text appears once, with the packages that use it. Copyright lines are in the table above.');
p();
for (const t of [...texts.values()].sort((a, b) => a.file.localeCompare(b.file))) {
  p(`### ${t.file}`);
  p();
  p(`Used by: ${t.users.join(', ')}`);
  p();
  if (t.text.length > MAX_TEXT) {
    p(`This text is ${Math.round(t.text.length / 1024)} KB, so it is not copied here. It ships with the package as \`node_modules/${t.file}\`.`);
  } else {
    p('````text');
    p(t.text);
    p('````');
  }
  p();
}

writeFileSync(OUT, md.join('\n').replace(/\n{3,}/g, '\n\n'));
console.log(`THIRD-PARTY-NOTICES.md: ${rows.length} packages, ${texts.size} licence texts, ${Math.round(md.join('\n').length / 1024)} KB`);
