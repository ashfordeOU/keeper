// SPDX-License-Identifier: AGPL-3.0-or-later
// keeper-file:// URLs for playing local audio and video in the desktop app.
// Each path segment is encoded on its own so names with #, ? or % still work.

export function fileUrl(p: string): string | undefined {
  if (typeof window === 'undefined' || !window.keeper) return undefined;
  return 'keeper-file://' + p.split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join('');
}
