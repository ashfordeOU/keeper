// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// HEIC and HEIF photos decoded in plain JavaScript (libheif built for WebAssembly,
// LGPL, kept as its own swappable package): used where neither sharp nor the
// system can read them (Linux, and Windows without the HEIF extension).

import { createRequire } from 'node:module';

const req = createRequire(__filename);

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: unknown) => void): void;
}
let heifModule: { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } } | null = null;

/** The first (main) picture in a HEIC or HEIF file as RGBA, or null when it cannot be read. */
export async function decodeHeif(b: Uint8Array): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    heifModule ??= req('libheif-js/wasm-bundle');
    const images = new heifModule!.HeifDecoder().decode(b);
    const img = images[0];
    if (!img) return null;
    const width = img.get_width();
    const height = img.get_height();
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    await new Promise<void>((resolve, reject) => img.display(target, (d) => (d ? resolve() : reject(new Error('decode failed')))));
    return target;
  } catch {
    return null;
  }
}
