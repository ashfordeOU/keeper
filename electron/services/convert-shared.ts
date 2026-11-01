// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small parts of the converters that the rest of Keeper uses at start: where
// the bundled ffmpeg is, and the standard output folder. Kept apart so that these
// do not load the converters (and the PDF, image and signing libraries they use).

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const req = createRequire(__filename);

/** ffmpeg ships inside the app; when packaged it lives outside the asar archive. */
export function ffmpegPath(): string | null {
  try {
    const p = (req('ffmpeg-static') as string | null) ?? null;
    if (!p) return null;
    const unpacked = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return existsSync(unpacked) ? unpacked : existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** The person's standard output folder (set by the app; the command line keeps results next to the originals). */
let standardOutputFn: (tool: string) => string | undefined = () => undefined;
export function setStandardOutput(fn: (tool: string) => string | undefined) {
  standardOutputFn = fn;
}
export const standardOutput = (tool: string) => standardOutputFn(tool);
