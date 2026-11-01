// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The package check: everything Keeper needs is inside the .app / installer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain CommonJS build script
import { checkPackage, verifyPackage } from '../scripts/verify-package.cjs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fakeMac(skip: string[] = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-pkg-'));
  dirs.push(root);
  const app = path.join(root, 'Keeper.app');
  const res = path.join(app, 'Contents', 'Resources');
  const mods = path.join(res, 'app.asar.unpacked', 'node_modules');
  const files: Record<string, string> = {
    asar: path.join(res, 'app.asar'),
    ffmpeg: path.join(mods, 'ffmpeg-static', 'ffmpeg'),
    sharp: path.join(mods, '@img', 'sharp-darwin-arm64', 'lib', 'sharp-darwin-arm64.node'),
    ort: path.join(mods, 'onnxruntime-node', 'bin', 'napi-v6', 'darwin', 'arm64', 'onnxruntime_binding.node'),
    pty: path.join(mods, 'node-pty', 'prebuilds', 'darwin-arm64', 'pty.node'),
    rclone: path.join(res, 'rclone', 'rclone'),
    helper: path.join(app, 'Contents', 'MacOS', 'keeper-helper'),
    intents: path.join(app, 'Contents', 'Library', 'Helpers', 'Keeper Intents.app', 'Contents', 'Info.plist'),
  };
  for (const [k, f] of Object.entries(files)) if (!skip.includes(k)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); }
  return { appDir: app, resources: res, platform: 'darwin', arch: 'arm64' };
}

describe('the package check', () => {
  it('a complete Mac app passes, strictly too', () => {
    expect(checkPackage({ ...fakeMac(), strict: true }).missing).toEqual([]);
  });
  it('a missing helper or image library always stops packaging', () => {
    expect(() => verifyPackage(fakeMac(['helper']))).toThrow(/keeper-helper/);
    expect(() => verifyPackage(fakeMac(['sharp']))).toThrow(/image library/);
  });
  it('rclone and Keeper Intents are listed locally, and required for releases', () => {
    const o = fakeMac(['rclone', 'intents']);
    const r = verifyPackage(o);
    expect(r.missing.map((m: { name: string }) => m.name).join(' ')).toMatch(/rclone.*Intents/);
    expect(() => verifyPackage({ ...o, strict: true })).toThrow(/rclone.*Intents/);
  });
});
