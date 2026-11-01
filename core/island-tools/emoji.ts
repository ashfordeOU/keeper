// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Emoji search for the Island: the full Unicode set with names and keywords
// (data from unicode-emoji-json and emojilib, both MIT), skin tones and recents.

export interface EmojiEntry {
  e: string;
  name: string;
  group: string;
  /** takes a skin tone modifier */
  tone: boolean;
  keywords: string[];
}

export const GROUPS = ['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags'];

/** Fitzpatrick modifiers, light to dark; index 0 = no tone. */
export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];

export function buildIndex(
  byEmoji: Record<string, { name: string; group: string; skin_tone_support: boolean }>,
  keywords: Record<string, string[]> = {},
): EmojiEntry[] {
  return Object.entries(byEmoji).map(([e, d]) => ({
    e,
    name: d.name,
    group: d.group,
    tone: !!d.skin_tone_support,
    keywords: (keywords[e] ?? []).map((k) => k.replace(/_/g, ' ').toLowerCase()),
  }));
}

/** Adds a skin tone to an emoji that supports one (before any variation selector or joiner). */
export function withTone(entry: EmojiEntry, tone: number): string {
  if (!entry.tone || tone <= 0 || tone >= TONES.length) return entry.e;
  const chars = [...entry.e];
  // The modifier goes right after the first code point (the person or hand).
  const rest = chars.slice(1).filter((c) => c !== '\u{FE0F}');
  return chars[0] + TONES[tone] + rest.join('');
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Best matches first: the whole name, then a word of the name starting with
 * the query, then keywords, then anywhere in the name. Every word typed must match.
 */
export function searchEmoji(index: EmojiEntry[], query: string, limit = 120): EmojiEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return index.slice(0, limit);
  const scored: { x: EmojiEntry; s: number }[] = [];
  for (const x of index) {
    const name = fold(x.name);
    const nameWords = name.split(/[\s:-]+/);
    let s = 0;
    let ok = true;
    for (const w of words) {
      if (name === w) s += 100;
      else if (nameWords.some((n) => n === w)) s += 60;
      else if (nameWords.some((n) => n.startsWith(w))) s += 40;
      else if (x.keywords.some((k) => k === w)) s += 30;
      else if (x.keywords.some((k) => k.startsWith(w))) s += 20;
      else if (name.includes(w)) s += 10;
      else { ok = false; break; }
    }
    if (ok) scored.push({ x, s: s - name.length / 100 });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((r) => r.x);
}

/** Most recent first, no duplicates, at most `max`. */
export function addRecent(recent: string[], e: string, max = 24): string[] {
  return [e, ...recent.filter((x) => x !== e)].slice(0, max);
}
