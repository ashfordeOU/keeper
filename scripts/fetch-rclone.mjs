// SPDX-License-Identifier: AGPL-3.0-or-later
// Downloads the rclone program Keeper uses for cloud storage (Google Drive,
// OneDrive, Dropbox, S3 and about seventy more), checks it against a pinned
// SHA-256 and puts it in vendor/rclone/current, which the packaged app ships.
//
//   node scripts/fetch-rclone.mjs [platform] [arch]     defaults to this computer
//
// rclone is MIT-licensed: https://rclone.org/licence/

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const RCLONE_VERSION = 'v1.75.2';
const SUMS = {
  'linux-amd64': '349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702',
  'linux-arm64': '7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10',
  'osx-amd64': '574e1f31cf1c464e5fb0325cb66fcbdeaf1efa1802bd9b17f13c256fd74b6561',
  'osx-arm64': '610ab7d48615135dfc60b763858b11a426a0d3d1160c1bb76fb0ae6011b02edd',
  'windows-amd64': '8a9db2bad1dc79a65b3348fd857069598e2aab7cf4d118b77b1df23055aff818',
  'windows-arm64': '7eb9844c9e5b723b9ef28821891caa17f6d9d1a375c49365cbe04114cec8dcd9',
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads one file out of a zip held in memory (stored or deflated). */
function unzipOne(zip, wanted) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let o = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = zip.readUInt16LE(o + 10);
    const packed = zip.readUInt32LE(o + 20);
    const nameLen = zip.readUInt16LE(o + 28);
    const extraLen = zip.readUInt16LE(o + 30);
    const commentLen = zip.readUInt16LE(o + 32);
    const local = zip.readUInt32LE(o + 42);
    const name = zip.subarray(o + 46, o + 46 + nameLen).toString('utf8');
    o += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + packed);
    return method === 0 ? data : inflateRawSync(data);
  }
  throw new Error('rclone was not found inside the download');
}

export async function fetchRclone(platform = process.platform, arch = process.arch) {
  const os = { darwin: 'osx', win32: 'windows', linux: 'linux' }[platform];
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch];
  const key = `${os}-${cpu}`;
  if (!SUMS[key]) throw new Error(`No rclone build pinned for ${platform}-${arch}`);
  const exe = platform === 'win32' ? 'rclone.exe' : 'rclone';
  const out = path.join(root, 'vendor', 'rclone', 'current');
  const stamp = path.join(out, 'TARGET');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === `${RCLONE_VERSION} ${key}` && existsSync(path.join(out, exe))) {
    console.log(`rclone ${RCLONE_VERSION} for ${key} is already in place.`);
    return path.join(out, exe);
  }
  const url = `https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-${key}.zip`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rclone download failed: ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const sum = createHash('sha256').update(zip).digest('hex');
  if (sum !== SUMS[key]) throw new Error(`rclone checksum mismatch for ${key}: ${sum}`);
  const bin = unzipOne(zip, (n) => n.endsWith(`/${exe}`));
  const licence = (() => {
    try {
      return unzipOne(zip, (n) => /\/(README\.txt|COPYING)$/i.test(n));
    } catch {
      return null;
    }
  })();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, exe), bin);
  if (platform !== 'win32') chmodSync(path.join(out, exe), 0o755);
  if (licence) writeFileSync(path.join(out, 'README.txt'), licence);
  writeFileSync(path.join(out, 'LICENSE.txt'), 'rclone is licensed under the MIT licence: https://rclone.org/licence/\n');
  writeFileSync(stamp, `${RCLONE_VERSION} ${key}`);
  console.log(`rclone ${RCLONE_VERSION} for ${key} is in ${out}`);
  return path.join(out, exe);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, arch] = process.argv.slice(2);
  fetchRclone(platform, arch).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
