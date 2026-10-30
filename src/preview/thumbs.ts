// SPDX-License-Identifier: AGPL-3.0-or-later
// Thumbnails the viewer draws itself when the system cannot: PDF first pages
// and font samples. They are handed back to the main process to be cached.

import { api, isDemo } from '../api';
import { fetchBytes, fileUrl } from './util';

const FONT = /\.(ttf|otf|woff2?|ttc)$/i;
const inflight = new Map<string, Promise<string | null>>();

export function canRenderThumb(path: string): boolean {
  return !isDemo && (/\.(pdf|ai)$/i.test(path) || FONT.test(path));
}

export function renderThumb(path: string, size: number): Promise<string | null> {
  const key = `${path}@${size}`;
  let p = inflight.get(key);
  if (!p) {
    p = draw(path, size).catch(() => null).finally(() => setTimeout(() => inflight.delete(key), 1000));
    inflight.set(key, p);
  }
  return p;
}

async function draw(path: string, size: number): Promise<string | null> {
  let url: string | null = null;
  if (/\.(pdf|ai)$/i.test(path)) {
    const { pdfThumb } = await import('./pdf');
    url = await pdfThumb(await fetchBytes(path, 300 * 1024 * 1024), size);
  } else if (FONT.test(path)) {
    const family = `kp-thumb-${Math.random().toString(36).slice(2)}`;
    const face = new FontFace(family, `url("${fileUrl(path)}")`);
    await face.load();
    document.fonts.add(face);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = Math.round(size * 0.82);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1b1b1f';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.round(size * 0.42)}px "${family}"`;
    g.fillText('Aa', c.width / 2, c.height * 0.46);
    g.font = `${Math.round(size * 0.08)}px "${family}"`;
    g.fillStyle = '#6b6b75';
    g.fillText('The quick brown fox', c.width / 2, c.height * 0.84);
    document.fonts.delete(face);
    url = c.toDataURL('image/png');
  }
  if (url) void api.preview.storeThumb(path, size, url).catch(() => undefined);
  return url;
}
