// SPDX-License-Identifier: AGPL-3.0-or-later
// Work a restart would interrupt: a screen recording, a folder being locked,
// a conversion. Updates wait until the list is empty.

const jobs = new Map<number, string>();
const checks: (() => string | undefined)[] = [];
let seq = 0;

/** Marks work as running; call the returned function when it ends. */
export function beginBusy(label: string): () => void {
  const id = ++seq;
  jobs.set(id, label);
  return () => void jobs.delete(id);
}

/** For work that already keeps its own state: return a label while it runs. */
export function addBusyCheck(fn: () => string | undefined) {
  checks.push(fn);
}

export function busyWith(): string[] {
  const out = [...jobs.values()];
  for (const c of checks) {
    try {
      const l = c();
      if (l) out.push(l);
    } catch {
      /* a broken check never blocks updates */
    }
  }
  return out;
}
