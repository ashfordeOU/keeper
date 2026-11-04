// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloads the Remote Desktop engine Keeper shows RDP connections in a tab with
// (IronRDP's WebAssembly client, @devolutions/iron-remote-desktop-rdp), checks it
// against a pinned SHA-256 and puts it in vendor/ironrdp/current. The release
// packs it as the downloadable component "ironrdp" (core/component-layout.json);
// the core installer leaves it out. Development and tests use this copy directly.
//
//   node scripts/fetch-ironrdp.mjs            (any platform: the file is the same everywhere)
//
// IronRDP is MIT OR Apache-2.0, by Devolutions Inc.: https://github.com/Devolutions/IronRDP

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const IRONRDP_PACKAGE = '@devolutions/iron-remote-desktop-rdp';
export const IRONRDP_VERSION = '0.7.0';
const TARBALL = `https://registry.npmjs.org/${IRONRDP_PACKAGE}/-/iron-remote-desktop-rdp-${IRONRDP_VERSION}.tgz`;
/** The npm tarball (its SHA-1 is the registry's own "shasum" fb2b483e…f631). */
const TARBALL_SHA256 = '461e88b6d164e42d7582c266827361a568ba4f8a6fce45d81b820e8b3f1cf15f';
/** The one file Keeper uses from it. */
const SCRIPT = 'iron-remote-desktop-rdp.js';
const SCRIPT_SHA256 = 'b008f0e258fd9485c6f2b07747116d4fcbbe51053ce995abd048fb2b79636332';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIT = `MIT License

Copyright (c) Devolutions Inc. and the IronRDP contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** One regular file out of a tar held in memory. */
export function untarOne(tar, wanted) {
  for (let o = 0; o + 512 <= tar.length;) {
    const h = tar.subarray(o, o + 512);
    if (h.every((x) => x === 0)) break;
    const field = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = (prefix ? `${prefix}/` : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = o + 512;
    if ((type === '0' || type === '\0') && name === wanted) return tar.subarray(body, body + size);
    o = body + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} is not in the download`);
}

export async function fetchIronRdp() {
  const out = path.join(root, 'vendor', 'ironrdp', 'current');
  const stamp = path.join(out, 'VERSION');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === IRONRDP_VERSION && existsSync(path.join(out, SCRIPT)) && sha256(readFileSync(path.join(out, SCRIPT))) === SCRIPT_SHA256) {
    console.log(`IronRDP ${IRONRDP_VERSION} is already in place.`);
    return path.join(out, SCRIPT);
  }
  console.log(`Downloading ${TARBALL}`);
  const res = await fetch(TARBALL);
  if (!res.ok) throw new Error(`IronRDP download failed: ${res.status}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  const sum = sha256(tgz);
  if (sum !== TARBALL_SHA256) throw new Error(`IronRDP checksum mismatch: ${sum}`);
  const script = untarOne(gunzipSync(tgz), `package/${SCRIPT}`);
  if (sha256(script) !== SCRIPT_SHA256) throw new Error(`IronRDP script checksum mismatch: ${sha256(script)}`);
  const tmp = `${out}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, SCRIPT), script);
  writeFileSync(path.join(tmp, 'LICENSE.txt'), `${IRONRDP_PACKAGE} ${IRONRDP_VERSION} (IronRDP's WebAssembly client), by Devolutions Inc. and the IronRDP contributors.\nLicensed under the MIT licence or the Apache License 2.0, at your option; Keeper uses it under the MIT licence below.\nSource: https://github.com/Devolutions/IronRDP\n\n${MIT}`);
  writeFileSync(stamp.replace(out, tmp), `${IRONRDP_VERSION}\n`);
  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  console.log(`IronRDP ${IRONRDP_VERSION} is in ${out}`);
  return path.join(out, SCRIPT);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchIronRdp().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
