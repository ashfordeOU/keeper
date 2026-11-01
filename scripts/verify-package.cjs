// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checks a packaged Keeper (before its .dmg, .exe or .AppImage is made) holds
// every piece it needs to run on the person's computer, so nothing has to be
// installed afterwards. build/after-pack.cjs runs it for every package.
//
//   required always      the app, ffmpeg, the image library, background removal,
//                        the terminal, and on a Mac keeper-helper
//   required for releases rclone (cloud storage) and, on a Mac, Keeper Intents
//   (KEEPER_REQUIRE_ALL=1, set by the release workflow; elsewhere they are listed
//   as missing with how to add them, and the package is still made)

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {{ appDir: string, resources: string, platform: string, arch: string, strict?: boolean }} o
 *   appDir: the .app (macOS) or the folder holding the executable
 * @returns {{ ok: string[], missing: { name: string, fix: string, required: boolean }[] }}
 */
function checkPackage(o) {
  const { appDir, resources, platform, arch } = o;
  const strict = !!o.strict;
  const mods = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const exe = platform === 'win32' ? '.exe' : '';
  const anyFile = (dir, re) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => re.test(f));
  const pieces = [
    { name: 'Keeper itself (app.asar)', have: fs.existsSync(path.join(resources, 'app.asar')), fix: 'npm run build failed or was skipped', required: true },
    { name: 'ffmpeg (audio and video)', have: fs.existsSync(path.join(mods, 'ffmpeg-static', `ffmpeg${exe}`)), fix: `node scripts/prepare-arch.mjs ${platform} ${arch}`, required: true },
    { name: `image library (sharp for ${platform}-${arch})`, have: anyFile(path.join(mods, '@img', `sharp-${platform}-${arch}`, 'lib'), /\.node$/), fix: `node scripts/prepare-arch.mjs ${platform} ${arch}`, required: true },
    { name: 'background removal (onnxruntime)', have: fs.existsSync(path.join(mods, 'onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node')), fix: 'npm ci', required: true },
    { name: 'terminal (node-pty)', have: fs.existsSync(path.join(mods, 'node-pty', 'prebuilds', `${platform}-${arch}`, 'pty.node')) || fs.existsSync(path.join(mods, 'node-pty', 'build', 'Release', 'pty.node')), fix: 'npm ci', required: true },
    { name: 'rclone (cloud storage)', have: fs.existsSync(path.join(resources, 'rclone', `rclone${exe}`)), fix: `node scripts/fetch-rclone.mjs ${platform} ${arch}`, required: strict },
  ];
  if (platform === 'darwin') {
    pieces.push(
      { name: 'keeper-helper (Apple Intelligence, Live Text, Spotlight, the Island’s Mac abilities)', have: fs.existsSync(path.join(appDir, 'Contents', 'MacOS', 'keeper-helper')), fix: 'node scripts/build-mac-native.mjs (needs Swift: xcode-select --install)', required: true },
      { name: 'Keeper Intents (Siri, Spotlight and Shortcuts actions)', have: fs.existsSync(path.join(appDir, 'Contents', 'Library', 'Helpers', 'Keeper Intents.app')), fix: 'install Xcode and XcodeGen (brew install xcodegen), then npm run dist:mac again', required: strict },
    );
  }
  return {
    ok: pieces.filter((p) => p.have).map((p) => p.name),
    missing: pieces.filter((p) => !p.have).map(({ name, fix, required }) => ({ name, fix, required })),
  };
}

/** Prints what is in the package; throws when a required piece is missing. */
function verifyPackage(o) {
  const r = checkPackage(o);
  for (const n of r.ok) console.log(`  • package has ${n}`);
  for (const m of r.missing) console.log(`  ${m.required ? '⨯' : '•'} package is MISSING ${m.name}: ${m.fix}`);
  const fatal = r.missing.filter((m) => m.required);
  if (fatal.length) throw new Error(`Keeper's package is missing ${fatal.map((m) => m.name).join(', ')}; it would not work on people's computers. ${fatal.map((m) => m.fix).join('; ')}`);
  return r;
}

module.exports = { checkPackage, verifyPackage };
