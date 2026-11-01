// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The rate limits services report on Keeper's own AI calls (response
// headers), kept in memory for the usage tracker's "this minute" meters.
// The AI providers call noteRateHeaders after each answer; nothing is stored.

import { parseRateHeaders, serviceOf, type RateHeaders } from './sources';

const latest = new Map<string, RateHeaders>();

/** After a call: `base` is the service's URL or provider kind; `get` reads a response header. */
export function noteRateHeaders(base: string, get: ((name: string) => string | null | undefined) | undefined) {
  if (!get) return;
  try {
    const svc = serviceOf(base);
    if (!svc) return;
    const h = parseRateHeaders(get, Date.now());
    if (h) latest.set(svc, h);
  } catch {
    /* headers are a bonus; never break a call over them */
  }
}

export function rateHeadersFor(service: string): RateHeaders | undefined {
  return latest.get(service);
}
