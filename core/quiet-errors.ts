// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Failures nobody caught (a promise that failed with no handler, in a window
// or in the main process) are written to the session log and shown once as a
// quiet toast, instead of failing silently. The same message is shown at most
// once in a while, and cancellations are not failures. Plain functions.

/** The message people see: no IPC wrapper, no "Error:" prefix, one line, not too long. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as { message?: unknown })?.message !== undefined ? String((e as { message: unknown }).message) : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  return String(raw ?? '')
    .replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .replace(/^(\w*Error): /, '')
    .split('\n')[0]
    .trim()
    .slice(0, 240);
}

/** Cancelled work, closed windows and the like: not worth a toast. */
export function ignorable(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  const t = errorText(e);
  return !t || name === 'AbortError' || /\b(aborted|cancell?ed|canceled by the user|The operation was aborted|ResizeObserver loop|Object has been destroyed|Render frame was disposed|WebContents was destroyed|No handler registered)\b/i.test(t);
}

/** Lets a message through at most once per `windowMs`. */
export function throttle(windowMs = 5000, now: () => number = Date.now): (key: string) => boolean {
  const seen = new Map<string, number>();
  return (key) => {
    const t = now();
    const last = seen.get(key);
    if (last !== undefined && t - last < windowMs) return false;
    seen.set(key, t);
    if (seen.size > 200) for (const [k, v] of seen) if (t - v > windowMs) seen.delete(k);
    return true;
  };
}
