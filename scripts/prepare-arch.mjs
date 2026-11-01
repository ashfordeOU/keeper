// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Makes node_modules ready to package Keeper for another processor.
//
//   node scripts/prepare-arch.mjs <platform> <arch>     e.g. darwin x64
//
// npm only installs the native pieces for the machine it runs on. Building the
// Intel Mac app on an Apple-silicon runner (or similar) needs the matching
// image library and ffmpeg binary, or the packaged app would fail to start them.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const [platform, arch] = process.argv.slice(2);
if (!platform || !arch) {
  console.error('usage: node scripts/prepare-arch.mjs <platform> <arch>');
  process.exit(1);
}

// 1. The image library: sharp ships one prebuilt package per platform and processor.
const optional = JSON.parse(readFileSync(require.resolve('sharp/package.json'), 'utf8')).optionalDependencies ?? {};
const wanted = Object.entries(optional)
  .filter(([name]) => name === `@img/sharp-${platform}-${arch}` || name === `@img/sharp-libvips-${platform}-${arch}`)
  .map(([name, version]) => `${name}@${version}`);
if (!wanted.length) throw new Error(`No prebuilt image library for ${platform}-${arch}`);
console.log(`Installing ${wanted.join(', ')}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--no-save', '--force', `--os=${platform}`, `--cpu=${arch}`, ...wanted], { stdio: 'inherit', shell: process.platform === 'win32' });

// 2. ffmpeg: replace the binary with the one for the target.
const ffDir = path.dirname(require.resolve('ffmpeg-static/package.json'));
for (const f of ['ffmpeg', 'ffmpeg.exe', 'ffmpeg.README', 'ffmpeg.LICENSE']) rmSync(path.join(ffDir, f), { force: true });
execFileSync(process.execPath, [path.join(ffDir, 'install.js')], {
  stdio: 'inherit',
  cwd: ffDir,
  env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch },
});
const bin = path.join(ffDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!existsSync(bin)) throw new Error('ffmpeg for the target was not downloaded');

// 3. Background removal ships every platform's binary already; just check it is there.
const ort = path.join(path.dirname(require.resolve('onnxruntime-node/package.json')), 'bin', 'napi-v6', platform, arch);
if (!existsSync(ort)) throw new Error(`Background removal has no build for ${platform}-${arch}`);

// 4. rclone for cloud storage, checked against its pinned checksum.
const { fetchRclone } = await import('./fetch-rclone.mjs');
await fetchRclone(platform, arch);

console.log(`Ready to package for ${platform}-${arch}.`);
