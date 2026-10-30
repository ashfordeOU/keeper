// SPDX-License-Identifier: AGPL-3.0-or-later
// Camera RAW files (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, …) carry a
// full-size JPEG preview made by the camera. Finding the biggest embedded JPEG
// gives an instant, accurate preview without a RAW decoder.

export interface Span {
  start: number;
  end: number;
}

/**
 * Scans for JPEG streams (FFD8 FF … FFD9). A JPEG is walked marker by marker,
 * so FFD9 bytes inside segments do not end it early. Returns spans biggest first.
 */
export function findJpegs(b: Uint8Array, minBytes = 2048): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < b.length - 4) {
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) {
      const end = walkJpeg(b, i);
      if (end > 0) {
        if (end - i >= minBytes) spans.push({ start: i, end });
        i = end;
        continue;
      }
    }
    i++;
  }
  return spans.sort((a, b2) => b2.end - b2.start - (a.end - a.start));
}

function walkJpeg(b: Uint8Array, start: number): number {
  let p = start + 2;
  while (p < b.length - 1) {
    if (b[p] !== 0xff) return -1;
    let marker = b[p + 1];
    // Fill bytes.
    while (marker === 0xff && p < b.length - 2) {
      p++;
      marker = b[p + 1];
    }
    if (marker === 0xd9) return p + 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    if (p + 3 >= b.length) return -1;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) return -1;
    p += 2 + len;
    if (marker === 0xda) {
      // Entropy-coded data: skip to the next marker that is not a stuffed 00 or a restart.
      while (p < b.length - 1) {
        if (b[p] === 0xff && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7)) break;
        p++;
      }
    }
  }
  return -1;
}

/** The largest embedded JPEG, or undefined when there is none. */
export function largestJpeg(b: Uint8Array): Uint8Array | undefined {
  const s = findJpegs(b)[0];
  return s ? b.subarray(s.start, s.end) : undefined;
}

/** Size of a JPEG from its SOF marker. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let p = 2;
  while (p < b.length - 9) {
    if (b[p] !== 0xff) return undefined;
    const m = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] };
    }
    p += 2 + len;
  }
  return undefined;
}

/** The biggest PNG inside a macOS .icns file. */
export function largestIcnsPng(b: Uint8Array): Uint8Array | undefined {
  let best: Uint8Array | undefined;
  let p = 8;
  while (p + 8 <= b.length) {
    const len = ((b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]) >>> 0;
    if (len < 8 || p + len > b.length) break;
    const data = b.subarray(p + 8, p + len);
    if (data[0] === 0x89 && data[1] === 0x50 && (!best || data.length > best.length)) best = data;
    p += len;
  }
  return best;
}
