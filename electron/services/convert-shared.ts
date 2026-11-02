// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small parts of the converters that the rest of Keeper uses at start: where
// the bundled ffmpeg is, and the standard output folder. Kept apart so that these
// do not load the converters (and the PDF, image and signing libraries they use).

import { ffmpegBinary } from '../../core/component-paths';

/** ffmpeg: inside the app (offline installer), downloaded as a component, or a development copy. */
export function ffmpegPath(): string | null {
  return ffmpegBinary();
}

/** The person's standard output folder (set by the app; the command line keeps results next to the originals). */
let standardOutputFn: (tool: string) => string | undefined = () => undefined;
export function setStandardOutput(fn: (tool: string) => string | undefined) {
  standardOutputFn = fn;
}
export const standardOutput = (tool: string) => standardOutputFn(tool);
