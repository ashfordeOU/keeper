// SPDX-License-Identifier: AGPL-3.0-or-later
// Thin helpers over Electron's asynchronous clipboard.

import { clipboard, ClipboardItem, nativeImage } from 'electron';

export const readText = () => clipboard.readText().catch(() => '');
export const writeText = (t: string) => clipboard.writeText(t).catch(() => undefined);

export async function hasImage(): Promise<boolean> {
  return clipboard.has('image/png').catch(() => false);
}

export async function readImage(): Promise<Electron.NativeImage | null> {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = (await item.getType(type)) as Blob;
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (!img.isEmpty()) return img;
    }
  } catch {
    /* nothing readable */
  }
  return null;
}

export async function writeImage(img: Electron.NativeImage) {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]).catch(() => undefined);
}

/** Paths as text plus a file list, so pasting into a file manager copies the files. */
export async function writePaths(paths: string[]) {
  const uris = paths.map((p) => (process.platform === 'win32' ? `file:///${p.replace(/\\/g, '/')}` : `file://${p}`)).map(encodeURI).join('\r\n');
  await clipboard
    .write([new ClipboardItem({ 'text/plain': paths.join(process.platform === 'win32' ? '\r\n' : '\n'), 'text/uri-list': uris })])
    .catch(() => writeText(paths.join('\n')));
}
