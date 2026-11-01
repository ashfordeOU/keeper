// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Teleprompter pacing: scrolls a script just under the camera at a reading
// speed, or only while you are speaking (voice activity, on this computer).

/** Average speaking rates: slow 110, normal 140, fast 170 words a minute. */
export function pixelsPerSecond(wordsPerMinute: number, wordsPerLine: number, lineHeightPx: number): number {
  const wpm = Math.max(30, Math.min(400, wordsPerMinute));
  const wpl = Math.max(1, wordsPerLine);
  return (wpm / 60 / wpl) * lineHeightPx;
}

/** Roughly how many words fit on a line of `widthPx` at `fontPx` (average word ≈ 5.1 chars + space). */
export function wordsPerLine(widthPx: number, fontPx: number): number {
  const charsPerLine = widthPx / (fontPx * 0.52);
  return Math.max(1, charsPerLine / 6.1);
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** Reading time at a pace, in seconds. */
export function readingSeconds(text: string, wordsPerMinute: number): number {
  return Math.round((wordCount(text) / Math.max(30, wordsPerMinute)) * 60);
}

/**
 * Voice-paced mode: speech is detected from the microphone's loudness (RMS of
 * the signal, 0–1) against a noise floor that adapts slowly. Returns whether
 * the person is speaking and the new noise floor.
 */
export function voiceActivity(rms: number, floor: number, opts = { margin: 2.2, minRms: 0.012, adapt: 0.02 }): { speaking: boolean; floor: number } {
  const speaking = rms > Math.max(opts.minRms, floor * opts.margin);
  // The floor follows the quiet parts only, so talking does not raise it.
  const next = speaking ? floor : floor + (rms - floor) * opts.adapt;
  return { speaking, floor: Math.max(0.001, next) };
}

/** Next scroll offset: moves only while running (and, in voice mode, while speaking), never past the end. */
export function step(offset: number, dtSeconds: number, pps: number, maxOffset: number, moving: boolean): number {
  if (!moving) return offset;
  return Math.min(maxOffset, Math.max(0, offset + pps * Math.max(0, Math.min(dtSeconds, 0.25))));
}

/** Markdown and simple HTML turned into plain lines a reader can follow. */
export function scriptFromText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
