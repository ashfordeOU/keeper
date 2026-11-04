// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's photo editor: a drawn picture whose preview follows the light slider.

import type { PhotoApi } from '../core/api-photo';
import { describeRecipe, exposureFactor, type PhotoRecipe } from '../core/photo-edit';
import { SAVE_FORMATS } from '../core/photo-formats';
import type { Look } from '../core/photo-presets';

const svg = (r: PhotoRecipe) => {
  const k = Math.min(1.6, exposureFactor(r.exposure));
  const sky = `rgb(${Math.round(120 * k)},${Math.round(170 * k)},${Math.round(220 * k)})`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${sky}"/><circle cx="900" cy="220" r="90" fill="#f6c453"/><path d="M0 640 340 360 560 560 760 420 1200 700V800H0z" fill="#3a7d44"/></svg>`)}`;
};

export function mockPhoto(): { photo: PhotoApi } {
  let saved: PhotoRecipe | null = null;
  let looks: Look[] = [];
  return {
    photo: {
      info: async (path) => ({ path, name: path.split('/').pop() ?? path, width: 1200, height: 800, size: 412_000, cutout: 'download', models: { fast: false, best: false }, via: 'sharp', alpha: false, hasLocation: false, formats: SAVE_FORMATS.map((f) => ({ id: f.id, ok: f.id !== 'heic' })), ...(saved ? { edited: { recipe: saved, savedAt: Date.now(), summary: describeRecipe(saved) } } : {}) }),
      preview: async (_p, r) => ({ url: svg(r), width: 1200, height: 800 }),
      save: async (path, r, mode) => { if (mode === 'replace') saved = r; return { path: mode === 'copy' ? path.replace(/(\.\w+)$/, ' (edited)$1') : path, copy: mode === 'copy' }; },
      revert: async (path) => { saved = null; return { path, copy: false }; },
      auto: async () => ({ exposure: 12, contrast: 8, vibrance: 15 }),
      looks: async () => looks,
      saveLook: async (name) => { looks = [...looks, { id: `own-${name}`, name, values: {}, own: true }]; return looks; },
      deleteLook: async (id) => { looks = looks.filter((l) => l.id !== id); return looks; },
      downloadModel: async () => undefined,
      removeModel: async () => undefined,
      recent: async () => [],
    },
  };
}
