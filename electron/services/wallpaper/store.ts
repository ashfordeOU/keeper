// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Wallpaper, vibes, sound and folder-icon settings, in their own file
// (ambience.json next to settings.json) so a large vibe library never slows
// down every settings write.

import { app } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeAmbience, type AmbienceSettings } from '../../../core/vibes';

const file = () => path.join(app.getPath('userData'), 'ambience.json');
let cache: AmbienceSettings | null = null;
const listeners = new Set<(s: AmbienceSettings, prev: AmbienceSettings) => void>();
let writing: Promise<void> = Promise.resolve();

export function ambience(): AmbienceSettings {
  if (!cache) {
    try {
      cache = normalizeAmbience(JSON.parse(readFileSync(file(), 'utf8')));
    } catch {
      cache = normalizeAmbience(undefined);
    }
  }
  return cache;
}

export async function updateAmbience(patch: Partial<AmbienceSettings> | ((s: AmbienceSettings) => Partial<AmbienceSettings>)): Promise<AmbienceSettings> {
  const prev = ambience();
  const p = typeof patch === 'function' ? patch(prev) : patch;
  const next = normalizeAmbience({ ...prev, ...p });
  cache = next;
  const body = JSON.stringify(next, null, 1);
  // One write at a time, through a temporary file, so a crash never leaves half a file.
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`;
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  for (const fn of listeners) {
    try { fn(next, prev); } catch (e) { console.error('ambience listener', e); }
  }
  return next;
}

export function onAmbience(fn: (s: AmbienceSettings, prev: AmbienceSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function flushAmbience(): Promise<void> {
  return writing;
}
