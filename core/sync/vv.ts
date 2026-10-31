// SPDX-License-Identifier: AGPL-3.0-or-later
// Version vectors: each device counts its own changes to a file. Comparing two
// vectors tells whether one change came after the other, or whether two devices
// changed the file without seeing each other's change (a conflict).

export type VersionVector = Record<string, number>;

export type Order = 'equal' | 'newer' | 'older' | 'concurrent';

/** How `a` relates to `b`. */
export function compareVV(a: VersionVector, b: VersionVector): Order {
  let gt = false;
  let lt = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x > y) gt = true;
    else if (x < y) lt = true;
  }
  return gt && lt ? 'concurrent' : gt ? 'newer' : lt ? 'older' : 'equal';
}

export function mergeVV(a: VersionVector, b: VersionVector): VersionVector {
  const out: VersionVector = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

export function bumpVV(v: VersionVector, device: string): VersionVector {
  return { ...v, [device]: (v[device] ?? 0) + 1 };
}
