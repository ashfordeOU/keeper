// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The library in the Keeper Files light app (docs/SOLO.md): the index Keeper keeps
// (index.json) and the file list's calls, nothing else. No text reading, no
// download sources, no brain, no automations. The folders are read again once when
// the saved library is older than half an hour (Keeper reads them every half hour),
// a little after the window is up, and saved when the light app quits.

import { app } from 'electron';
import path from 'node:path';
import { Journal } from '../../core/journal';
import type { BackgroundWork } from '../../core/api';
import { makeIndex, registerLibraryIpc } from '../ipc/library';
import { FileService } from '../services/files';
import { settings } from '../store';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const NO_TOUR = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) && process.env.KEEPER_SKIP_TOUR === '1';
/** Read the folders again when the saved library is older than this. */
const STALE_MS = 30 * 60_000;

export async function startLibrary(d: { broadcast: (channel: string, ...args: unknown[]) => void }): Promise<() => void> {
  const index = makeIndex(settings(), NO_TOUR);
  const journal = new Journal(path.join(app.getPath('userData'), 'history.json'));
  let timer: NodeJS.Timeout | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => d.broadcast('library-changed'), 300);
  };
  const files = new FileService(index, journal, changed);
  let found = 0;
  const rescan = async () => {
    if (index.scanning) return;
    found = 0;
    await index.scan({ showHidden: settings().showHidden, sources: false, onProgress: (p) => { found = p.found ?? found; } });
    changed();
  };
  const idle: BackgroundWork = { pending: 0, state: 'idle', boostedUntil: 0 };
  registerLibraryIpc({
    index: () => index, files: () => files, journal: () => journal,
    scan: () => ({ found, expected: index.files.size }),
    ocrPending: () => 0,
    background: () => idle,
    rescan,
    speedUp: () => undefined,
    changed,
    broadcast: d.broadcast,
    duplicates: () => undefined,
  });
  await index.load();
  if (Date.now() - index.lastScan > STALE_MS) setTimeout(() => void rescan().catch(() => undefined), 3000).unref?.();
  return () => {
    clearTimeout(timer);
    try { index.saveSync(); } catch { /* disk full or read-only: Keeper reads the folders again */ }
  };
}
