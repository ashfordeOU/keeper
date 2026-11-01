// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Live text while you talk. The recognizer reads the growing recording again
// every fraction of a second; words it writes the same way twice in a row are
// settled ("stable") and the rest is shown lighter ("pending"). Once a piece
// is settled and well behind the speaker, its sound is let go so each pass
// stays short however long the take is. Pure.

export interface Piece { start: number; end: number; text: string }

export interface StreamState {
  /** settled text, never changed again */
  committed: Piece[];
  /** the last guess for the part still being spoken */
  last: Piece[];
  /** seconds of sound already let go (times of later pieces are after this) */
  offset: number;
}

export const newStream = (): StreamState => ({ committed: [], last: [], offset: 0 });

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The longest run of words two guesses agree on, from the start. */
export function agreedWords(a: string, b: string): string {
  const x = a.trim().split(/\s+/).filter(Boolean);
  const y = b.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < x.length && i < y.length && key(x[i]) === key(y[i])) i++;
  // keep the newer spelling
  return y.slice(0, i).join(' ');
}

/**
 * A new guess for the sound kept so far (times from the start of that sound).
 * Returns the new state and how many seconds of sound can be let go.
 */
export function advance(s: StreamState, guess: Piece[], bufferSec: number, holdBackSec = 2): { state: StreamState; dropSec: number } {
  const committed = [...s.committed];
  let drop = 0;
  // a whole piece settles when the last guess had it the same and it ended a while ago
  let k = 0;
  while (k < guess.length && k < s.last.length && key(guess[k].text) === key(s.last[k].text) && guess[k].end <= bufferSec - holdBackSec) {
    committed.push({ start: s.offset + guess[k].start, end: s.offset + guess[k].end, text: guess[k].text.trim() });
    drop = guess[k].end;
    k++;
  }
  const rest = guess.slice(k).map((p) => ({ ...p, start: p.start - drop, end: p.end - drop }));
  return { state: { committed, last: rest, offset: s.offset + drop }, dropSec: drop };
}

/** What to show: the settled words, then the words both recent guesses agree on, then the rest. */
export function display(s: StreamState, prevGuessText: string): { stable: string; pending: string } {
  const settled = s.committed.map((p) => p.text).join(' ').trim();
  const now = s.last.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
  const agreed = agreedWords(prevGuessText, now);
  const stable = [settled, agreed].filter(Boolean).join(' ');
  const pending = now.slice(agreed.length).trim();
  return { stable, pending };
}

/** All text so far, for the final pass. */
export const allText = (s: StreamState) => [...s.committed, ...s.last].map((p) => p.text.trim()).filter(Boolean).join(' ');
