// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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

/** Files copied in a file manager (they arrive as a list of file URLs, with no plain text). */
export async function readFileList(): Promise<string[]> {
  try {
    if (!(await clipboard.has('text/uri-list').catch(() => false))) return [];
    for (const item of await clipboard.read()) {
      if (!item.types.includes('text/uri-list')) continue;
      const blob = (await item.getType('text/uri-list')) as Blob;
      return (await blob.text())
        .split(/\r?\n/)
        .filter((l) => l.startsWith('file://'))
        .map((l) => {
          const p = decodeURIComponent(new URL(l).pathname);
          return process.platform === 'win32' ? p.replace(/^\//, '').replace(/\//g, '\\') : p;
        });
    }
  } catch {
    /* no file list */
  }
  return [];
}
