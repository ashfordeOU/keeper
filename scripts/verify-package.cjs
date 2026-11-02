// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checks a packaged Keeper (before its .dmg, .exe or .AppImage is made) holds
// every piece it needs to run on the person's computer, so nothing has to be
// installed afterwards. build/after-pack.cjs runs it for every package.
//
//   required always      the app, ffmpeg, the image library, background removal,
//                        the terminal, and on a Mac keeper-helper
//   required for releases rclone (cloud storage), agent-desktop (reading other apps'
//                        controls, with its Apache-2.0 LICENSE and NOTICE) and, on a Mac, Keeper Intents
//   (KEEPER_REQUIRE_ALL=1, set by the release workflow; elsewhere they are listed
//   as missing with how to add them, and the package is still made)
//
// The core installer (edition "core", docs/COMPONENTS.md) holds ffmpeg, background removal
// (ONNX Runtime) and rclone as downloadable components instead: they must be in the staging
// folder (to be packed as release assets) and must NOT be left inside the app.

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {{ appDir: string, resources: string, platform: string, arch: string, strict?: boolean, edition?: 'core' | 'full', staging?: string }} o
 *   appDir: the .app (macOS) or the folder holding the executable
 * @returns {{ ok: string[], missing: { name: string, fix: string, required: boolean }[] }}
 */
function checkPackage(o) {
  const { appDir, resources, platform, arch } = o;
  const strict = !!o.strict;
  const core = o.edition === 'core';
  const staged = (id, rel) => !!o.staging && fs.existsSync(path.join(o.staging, id, rel));
  const mods = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const exe = platform === 'win32' ? '.exe' : '';
  const anyFile = (dir, re) => fs.existsSync(dir) && fs.readdirSync(dir).some((f) => re.test(f));
  const pieces = [
    { name: 'Keeper itself (app.asar)', have: fs.existsSync(path.join(resources, 'app.asar')), fix: 'npm run build failed or was skipped', required: true },
    { name: `ffmpeg (audio and video)${core ? ', as a component' : ''}`, have: core ? staged('ffmpeg', `ffmpeg${exe}`) : fs.existsSync(path.join(mods, 'ffmpeg-static', `ffmpeg${exe}`)), fix: `node scripts/prepare-arch.mjs ${platform} ${arch}`, required: true },
    { name: `image library (sharp for ${platform}-${arch})`, have: anyFile(path.join(mods, '@img', `sharp-${platform}-${arch}`, 'lib'), /\.node$/), fix: `node scripts/prepare-arch.mjs ${platform} ${arch}`, required: true },
    { name: `background removal (onnxruntime)${core ? ', as a component' : ''}`, have: core ? staged('onnxruntime', path.join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node')) : fs.existsSync(path.join(mods, 'onnxruntime-node', 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node')), fix: 'npm ci', required: !(platform === 'darwin' && arch === 'x64') /* onnxruntime has no Intel Mac build */ },
    { name: 'terminal (node-pty)', have: fs.existsSync(path.join(mods, 'node-pty', 'prebuilds', `${platform}-${arch}`, 'pty.node')) || fs.existsSync(path.join(mods, 'node-pty', 'build', 'Release', 'pty.node')), fix: 'npm ci', required: true },
    { name: `rclone (cloud storage)${core ? ', as a component' : ''}`, have: core ? staged('rclone', `rclone${exe}`) : fs.existsSync(path.join(resources, 'rclone', `rclone${exe}`)), fix: `node scripts/fetch-rclone.mjs ${platform} ${arch}`, required: strict },
    // The program and its licence travel together: without LICENSE.txt and NOTICE.txt it may not ship at all.
    ...(() => {
      const dir = path.join(resources, 'agent-desktop');
      const bin = fs.existsSync(path.join(dir, `agent-desktop${exe}`));
      const terms = fs.existsSync(path.join(dir, 'LICENSE.txt')) && fs.existsSync(path.join(dir, 'NOTICE.txt'));
      const fix = `node scripts/fetch-agent-desktop.mjs ${platform} ${arch}`;
      return [
        { name: 'agent-desktop (reading and pressing other apps’ controls)', have: bin, fix, required: strict },
        ...(bin ? [{ name: 'agent-desktop’s LICENSE.txt and NOTICE.txt', have: terms, fix, required: true }] : []),
      ];
    })(),
  ];
  if (platform === 'darwin') {
    pieces.push(
      { name: 'keeper-helper (Apple Intelligence, Live Text, Spotlight, the Island’s Mac abilities)', have: fs.existsSync(path.join(appDir, 'Contents', 'MacOS', 'keeper-helper')), fix: 'node scripts/build-mac-native.mjs (needs Swift: xcode-select --install)', required: true },
      { name: 'Keeper Intents (Siri, Spotlight and Shortcuts actions)', have: fs.existsSync(path.join(appDir, 'Contents', 'Library', 'Helpers', 'Keeper Intents.app')), fix: 'install Xcode and XcodeGen (brew install xcodegen), then npm run dist:mac again', required: strict },
    );
  }
  if (core) {
    // The core installer is the small one: what became a component must really be gone from it.
    const left = [
      fs.existsSync(path.join(mods, 'ffmpeg-static', `ffmpeg${exe}`)) && 'ffmpeg',
      fs.existsSync(path.join(mods, 'onnxruntime-node', 'bin')) && 'onnxruntime',
      fs.existsSync(path.join(resources, 'rclone')) && 'rclone',
    ].filter(Boolean);
    pieces.push({ name: 'core installer without its downloadable components', have: !left.length, fix: `build/after-pack.cjs left ${left.join(', ')} inside; check scripts/components.mjs stage`, required: true });
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
