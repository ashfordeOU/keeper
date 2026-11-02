// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's browser extension ships inside the app (app.asar.unpacked), a
// folder that is hard to reach in a browser's file dialog. A copy is kept in
// Keeper's own data folder (on a Mac ~/Library/Application Support/Keeper/
// browser-extension), refreshed whenever the app's copy changes, so an
// extension loaded from there picks up updates with the browser's reload.

import { app } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { extensionCopyFolder } from '../../core/browser-setup';

/** The extension inside the app. */
export function bundledExtensionFolder(): string {
  return path.join(app.getAppPath(), 'browser-extension').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

async function sameBytes(a: Buffer, file: string): Promise<boolean> {
  try {
    return a.equals(await fsp.readFile(file));
  } catch {
    return false;
  }
}

/** Copies the extension for Chromium browsers and for Firefox (its own manifest as manifest.json); only changed files are written. */
export async function prepareExtensionCopies(): Promise<{ chromium: string; firefox: string }> {
  const src = bundledExtensionFolder();
  const userData = app.getPath('userData');
  const out = { chromium: path.normalize(extensionCopyFolder(userData, 'chromium')), firefox: path.normalize(extensionCopyFolder(userData, 'firefox')) };
  if (!existsSync(src)) return out;
  const names = (await fsp.readdir(src, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  for (const engine of ['chromium', 'firefox'] as const) {
    const dest = out[engine];
    await fsp.mkdir(dest, { recursive: true });
    for (const name of names) {
      if (name === 'manifest.firefox.json') continue;
      const from = engine === 'firefox' && name === 'manifest.json' && names.includes('manifest.firefox.json') ? 'manifest.firefox.json' : name;
      const bytes = await fsp.readFile(path.join(src, from));
      const to = path.join(dest, name);
      if (!(await sameBytes(bytes, to))) await fsp.writeFile(to, bytes);
    }
  }
  return out;
}
