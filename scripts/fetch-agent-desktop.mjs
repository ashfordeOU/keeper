// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloads agent-desktop, the program Keeper's computer-use tools use first to
// read and press the controls in other apps (through the system's accessibility
// tree), checks it against a pinned SHA-256 and puts it in
// vendor/agent-desktop/current, which the packaged app ships.
//
//   node scripts/fetch-agent-desktop.mjs [platform] [arch] [--out <dir>]
//
// platform and arch default to this computer; --out (or KEEPER_AGENT_DESKTOP_OUT)
// writes somewhere else, e.g. a scratch folder to try the script.
//
// agent-desktop is Apache-2.0: https://github.com/vercel-labs/agent-desktop
// Its release archives hold only the programs, so the licence text is fetched
// from the same tag (also pinned) and kept beside them with a NOTICE.

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const AGENT_DESKTOP_VERSION = 'v1.0.2';
const REPO = 'https://github.com/vercel-labs/agent-desktop';
// From the release's checksums.txt, and checked against the downloads.
export const AGENT_DESKTOP_SUMS = {
  'darwin-arm64': ['aarch64-apple-darwin', '7bee385196d7b478de80cf05ca4304aaa38f0eba593b3406ad3c247c1773be19'],
  'darwin-x64': ['x86_64-apple-darwin', '8edda6df17eafc042395502a823dbb8415bc8ac14835a6731e4d8becc9cb4121'],
  'win32-x64': ['x86_64-pc-windows-msvc', '2186c76e7df197c0e67365e45d36d869f74714c56bb8a73817e2a66f3e18e222'],
  'win32-arm64': ['aarch64-pc-windows-msvc', 'a0ecd6e17e60a0bcfbb45533a72f2d3a7a73508769588273ef08b0477d2b9687'],
  'linux-x64': ['x86_64-unknown-linux-gnu', 'ad661b7a3fd8f990a769243f4889a240ca0e2c8dab3ef5bddd6019086c71e0b4'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', '864cb782e0afc8bf0df19622016b24bdbd1a83fc7749f784ee82aa49a7f845eb'],
};
const LICENSE_SUM = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

/** The programs each archive holds: the command and the helper that must sit beside it. */
export function agentDesktopFiles(platform) {
  if (platform === 'win32') return ['agent-desktop.exe'];
  if (platform === 'darwin') return ['agent-desktop', 'agent-desktop-macos-helper'];
  return ['agent-desktop', 'agent-desktop-linux-clipboard-owner'];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** The regular files in a .tar.gz held in memory, by name (ustar and GNU long names). */
export function untar(gz) {
  const tar = gunzipSync(gz);
  const out = new Map();
  let longName;
  for (let o = 0; o + 512 <= tar.length;) {
    const h = tar.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    let name = str(0, 100);
    const prefix = str(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const data = tar.subarray(o + 512, o + 512 + size);
    o += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (longName) { name = longName; longName = undefined; }
    if (type === '0' || type === '\0') out.set(name.replace(/^\.\//, ''), Buffer.from(data));
  }
  return out;
}

async function download(url) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent-desktop download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchAgentDesktop(platform = process.platform, arch = process.arch, o = {}) {
  const key = `${platform}-${arch}`;
  const pinned = AGENT_DESKTOP_SUMS[key];
  if (!pinned) throw new Error(`No agent-desktop build pinned for ${key}`);
  const [target, sum] = pinned;
  const files = agentDesktopFiles(platform);
  const out = o.out ?? process.env.KEEPER_AGENT_DESKTOP_OUT ?? path.join(root, 'vendor', 'agent-desktop', 'current');
  const stamp = path.join(out, 'TARGET');
  const want = `${AGENT_DESKTOP_VERSION} ${key}`;
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === want && files.every((f) => existsSync(path.join(out, f))) && existsSync(path.join(out, 'LICENSE.txt'))) {
    console.log(`agent-desktop ${AGENT_DESKTOP_VERSION} for ${key} is already in place.`);
    return path.join(out, files[0]);
  }
  const archive = await download(`${REPO}/releases/download/${AGENT_DESKTOP_VERSION}/agent-desktop-${AGENT_DESKTOP_VERSION}-${target}.tar.gz`);
  const got = sha256(archive);
  if (got !== sum) throw new Error(`agent-desktop checksum mismatch for ${key}: ${got}`);
  const licence = await download(`https://raw.githubusercontent.com/vercel-labs/agent-desktop/${AGENT_DESKTOP_VERSION}/LICENSE`);
  if (sha256(licence) !== LICENSE_SUM) throw new Error(`agent-desktop LICENSE checksum mismatch: ${sha256(licence)}`);
  const entries = untar(archive);
  const bins = files.map((f) => {
    const b = entries.get(f);
    if (!b) throw new Error(`${f} was not found inside the agent-desktop download`);
    return b;
  });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  files.forEach((f, i) => {
    writeFileSync(path.join(out, f), bins[i]);
    if (platform !== 'win32') chmodSync(path.join(out, f), 0o755);
  });
  writeFileSync(path.join(out, 'LICENSE.txt'), licence);
  writeFileSync(path.join(out, 'NOTICE.txt'), [
    `agent-desktop ${AGENT_DESKTOP_VERSION} (${target})`,
    `By Vercel Labs and the agent-desktop contributors.`,
    `Licensed under the Apache License, Version 2.0 (LICENSE.txt beside this file).`,
    `Source: ${REPO}/tree/${AGENT_DESKTOP_VERSION}`,
    `Binaries: ${REPO}/releases/tag/${AGENT_DESKTOP_VERSION}, unmodified (SHA-256 of the archive: ${sum}).`,
    'The programs are built from Rust crates under Apache-2.0, MIT, MPL-2.0, Unicode-3.0 and Unlicense terms;',
    `their list is the Cargo.lock at ${REPO}/blob/${AGENT_DESKTOP_VERSION}/Cargo.lock.`,
    '',
  ].join('\n'));
  writeFileSync(stamp, want);
  console.log(`agent-desktop ${AGENT_DESKTOP_VERSION} for ${key} is in ${out}`);
  return path.join(out, files[0]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = i >= 0 ? path.resolve(args.splice(i, 2)[1]) : undefined;
  const [platform, arch] = args;
  fetchAgentDesktop(platform, arch, { out }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
