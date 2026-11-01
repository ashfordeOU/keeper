// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Has a password appeared in a data breach? Uses the Pwned Passwords range API
// with k-anonymity: only the first five characters of the password's SHA-1 are
// sent; the match happens on this computer. Nothing else leaves it.

import { createHash } from 'node:crypto';

export const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export function passwordPrefix(password: string): { prefix: string; suffix: string } {
  const h = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: h.slice(0, 5), suffix: h.slice(5) };
}

/** How many times the password was seen in breaches (0 = not found), from the range response. */
export function countInRange(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [s, n] = line.trim().split(':');
    if (s && s.toUpperCase() === suffix.toUpperCase()) return Number(n) || 0;
  }
  return 0;
}
