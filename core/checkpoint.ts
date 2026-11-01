// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The session checkpoint on disk (main process only): two generations, each with
// a checksum, so a file cut short by a crash or power loss is recognised and the
// previous generation used instead.

import { createHash } from 'node:crypto';
import { sanitizeWindow, type SessionSnapshot } from './session';


/** One generation on disk: the snapshot plus a checksum. */
export function encodeCheckpoint(s: SessionSnapshot, gen: number): string {
  const body = JSON.stringify(s);
  const sum = createHash('sha256').update(body).digest('hex');
  return JSON.stringify({ gen, sum, body });
}

export function decodeCheckpoint(text: string): { gen: number; snapshot: SessionSnapshot } | null {
  try {
    const o = JSON.parse(text) as { gen?: number; sum?: string; body?: string };
    if (typeof o.body !== 'string' || typeof o.gen !== 'number' || createHash('sha256').update(o.body).digest('hex') !== o.sum) return null;
    const s = JSON.parse(o.body) as SessionSnapshot;
    if (s?.version !== 1 || !Array.isArray(s.windows)) return null;
    return { gen: o.gen, snapshot: { version: 1, savedAt: Number(s.savedAt) || 0, windows: s.windows.map((w, i) => sanitizeWindow(w, i ? `w${i}` : 'main')) } };
  } catch {
    return null;
  }
}

/** The newest generation that is intact. */
export function pickCheckpoint(texts: (string | null)[]): { gen: number; snapshot: SessionSnapshot } | null {
  let best: { gen: number; snapshot: SessionSnapshot } | null = null;
  for (const t of texts) {
    if (!t) continue;
    const d = decodeCheckpoint(t);
    if (d && (!best || d.gen > best.gen)) best = d;
  }
  return best;
}

/** Crash-loop guard: how many unexpected exits in the window. */
export function recentCrashes(times: number[], now: number, windowMs = 5 * 60_000): number {
  return times.filter((t) => now - t <= windowMs).length;
}
