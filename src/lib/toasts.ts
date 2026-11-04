// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The toast stack's rules: the same message again within a few seconds does
// not stack a copy, it refreshes the one showing and counts (×2, ×3); a toast
// with a key (the mode you are in) replaces the one with that key.

export interface ToastItem<A = unknown> {
  id: number;
  text: string;
  action?: A;
  /** how many times it was asked for while showing */
  count: number;
  /** when it was last asked for */
  at: number;
  /** toasts with the same key replace each other (the mode switched again, a newer state of one thing) */
  key?: string;
}

/** How long a toast stays: longer when it has a button. */
export const toastLife = (hasAction: boolean) => (hasAction ? 8000 : 4000);
/** The most toasts shown at once. */
export const MAX_TOASTS = 3;

/**
 * Adds a toast. An identical text still showing (asked for within `windowMs`)
 * is refreshed and counted instead; its newest action wins.
 */
export function pushToast<A>(list: ToastItem<A>[], text: string, action: A | undefined, now: number, id: number, windowMs = 5000, key?: string): { list: ToastItem<A>[]; id: number } {
  // One state of one thing: the newer message replaces the one showing, in its place, never a second toast.
  const keyed = key ? list.find((t) => t.key === key) : undefined;
  if (keyed) return { list: list.map((t) => (t === keyed ? { id: keyed.id, text, action, count: 1, at: now, key } : t)), id: keyed.id };
  const same = list.find((t) => t.text === text && now - t.at < windowMs);
  if (same) {
    const merged: ToastItem<A> = { ...same, count: same.count + 1, at: now, action: action ?? same.action };
    // Moves to the bottom of the stack, where new toasts appear.
    return { list: [...list.filter((t) => t !== same), merged], id: same.id };
  }
  return { list: [...list.slice(-(MAX_TOASTS - 1)), { id, text, action, count: 1, at: now, ...(key ? { key } : {}) }], id };
}

/** Drops a toast whose time is up (one that was refreshed since stays). */
export function expireToast<A>(list: ToastItem<A>[], id: number, now: number): ToastItem<A>[] {
  return list.filter((t) => t.id !== id || now - t.at < toastLife(!!t.action) - 50);
}
