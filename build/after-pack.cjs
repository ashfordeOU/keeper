// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs after electron-builder copies the app, before the installer is made.
// Several native packages ship binaries for every system (and GPU builds Keeper
// never uses); keeping only this platform's makes downloads several times smaller.

const fs = require('node:fs');
const path = require('node:path');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // darwin | win32 | linux
  const arch = ARCH[context.arch] ?? 'x64';
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const mods = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
  let freed = 0;
  const size = (p) => {
    let n = 0;
    const walk = (q) => {
      const st = fs.lstatSync(q);
      if (st.isDirectory()) for (const c of fs.readdirSync(q)) walk(path.join(q, c));
      else n += st.size;
    };
    if (fs.existsSync(p)) walk(p);
    return n;
  };
  const drop = (p) => {
    freed += size(p);
    rm(p);
  };

  // Background removal: only this system's library, and no GPU (CUDA/TensorRT) providers.
  const ort = path.join(mods, 'onnxruntime-node', 'bin', 'napi-v6');
  if (fs.existsSync(ort)) {
    for (const os of fs.readdirSync(ort)) {
      if (os !== platform) {
        drop(path.join(ort, os));
        continue;
      }
      for (const a of fs.readdirSync(path.join(ort, os))) {
        if (a !== arch) drop(path.join(ort, os, a));
        else for (const f of fs.readdirSync(path.join(ort, os, a))) if (/cuda|tensorrt|dml/i.test(f) && !/onnxruntime_binding/.test(f)) drop(path.join(ort, os, a, f));
      }
    }
  }

  // Image library: prebuilt packages for other systems or processors.
  const img = path.join(mods, '@img');
  if (fs.existsSync(img)) {
    const keep = new RegExp(`-(${platform})-(${arch})$`);
    for (const d of fs.readdirSync(img)) if (/^sharp-(libvips-)?/.test(d) && !keep.test(d) && d !== 'colour') drop(path.join(img, d));
    // musl builds are for Alpine Linux; Keeper ships for glibc desktops.
    for (const d of fs.readdirSync(img)) if (/linuxmusl/.test(d)) drop(path.join(img, d));
  }

  // The PDF library's optional canvas is only used for drawing pages in Node; Keeper draws them in a window.
  drop(path.join(mods, '@napi-rs'));

  // Terminal: only this system's pseudo-terminal binaries; sources and debug symbols are not needed to run.
  const pty = path.join(mods, 'node-pty');
  if (fs.existsSync(pty)) {
    const pre = path.join(pty, 'prebuilds');
    if (fs.existsSync(pre)) for (const d of fs.readdirSync(pre)) if (d !== `${platform}-${arch}`) drop(path.join(pre, d));
    for (const d of ['src', 'deps', 'third_party', 'scripts', 'typings', 'node-addon-api', path.join('build', 'Release', 'obj.target'), path.join('build', 'Release', '.deps')]) drop(path.join(pty, d));
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(pdb|map|cc|h|gyp|mk|o|d)$/.test(f) || /\.test\.js$/.test(f)) drop(p);
      }
    };
    walk(pty);
    // macOS packages ship spawn-helper without its execute bit.
    require('../scripts/fix-node-pty.cjs').fixNodePty(pty);
  }

  console.log(`  • after-pack: removed ${(freed / 1024 / 1024).toFixed(0)} MB of files for other systems`);
};
