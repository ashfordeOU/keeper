// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "When was I last in Tallinn?": finds the place in a question and the stays
// that match it by name (named places, imported visit names, cached
// reverse-geocoding names) or by distance from a spot the caller looked up.

import { metres, type LL } from './geo';
import type { Stay } from './types';

const LEAD = /^(when|where)\s+(was|were|did)\s+(i|we)\s+(last\s+)?(in|at|visit|go to|been to)\s+|^(last|latest)\s+(time\s+)?(in|at)\s+|^(visits?|trips?|stays?)\s+(to|in|at)\s+|^(have\s+i\s+been\s+to)\s+/i;

/** The place words in a question ("when was I last in Tallinn?" → "Tallinn"). */
export function placeQuery(q: string): string {
  return q.trim().replace(/[?.!]+$/, '').replace(LEAD, '').replace(/^the\s+/i, '').trim();
}

export interface SearchHit {
  stay: Stay;
  /** "name" when the name matched, "near" when it was within the distance of the looked-up spot */
  how: 'name' | 'near';
}

export function searchStays(stays: Stay[], q: string, near?: LL, nearM = 25_000): SearchHit[] {
  const words = placeQuery(q).toLowerCase();
  if (!words) return [];
  const hits: SearchHit[] = [];
  for (const s of stays) {
    if (s.name && s.name.toLowerCase().includes(words)) hits.push({ stay: s, how: 'name' });
    else if (near && metres(near, s) <= nearM) hits.push({ stay: s, how: 'near' });
  }
  return hits.sort((a, b) => b.stay.start - a.stay.start);
}

/** One sentence answer for the top of the results. */
export function answer(q: string, hits: SearchHit[]): string {
  const place = placeQuery(q);
  if (!hits.length) return `No visits to ${place} found.`;
  const last = hits[0].stay;
  const when = new Date(last.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const days = new Set(hits.map((h) => new Date(h.stay.start).toDateString())).size;
  return `Last in ${place} on ${when}. ${days} day${days === 1 ? '' : 's'} there in all.`;
}
