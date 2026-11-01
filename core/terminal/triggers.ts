// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Triggers watch a terminal's output for a pattern (a question waiting for an
// answer, an error) and highlight it or let you know. Lines are matched as
// plain text, a few times a second at most, so they cost next to nothing.

import { stripAnsi } from './ring';
import type { Trigger } from './types';

export interface TriggerHit {
  trigger: Trigger;
  line: string;
}

export class TriggerWatcher {
  private compiled: { t: Trigger; re: RegExp }[] = [];
  private partial = '';
  /** the same trigger does not fire again within this time */
  private last = new Map<string, number>();

  constructor(triggers: Trigger[], private quietMs = 15_000) {
    this.set(triggers);
  }

  set(triggers: Trigger[]) {
    this.compiled = [];
    for (const t of triggers) {
      if (!t.enabled) continue;
      try {
        this.compiled.push({ t, re: new RegExp(t.pattern, 'i') });
      } catch {
        /* a pattern that does not compile is skipped (the editor shows why) */
      }
    }
  }

  get active() {
    return this.compiled.length > 0;
  }

  /** Feeds output; returns triggers that fired on complete lines (and on a trailing prompt-like line). */
  feed(data: string, now = Date.now()): TriggerHit[] {
    if (!this.compiled.length) return [];
    const text = this.partial + stripAnsi(data);
    const lines = text.split(/\r?\n|\r/);
    this.partial = (lines.pop() ?? '').slice(-2000);
    // A question usually ends without a newline ("Continue? (y/n) "), so the unfinished line is checked too.
    const check = [...lines, this.partial];
    const hits: TriggerHit[] = [];
    for (const line of check) {
      if (!line.trim()) continue;
      for (const { t, re } of this.compiled) {
        if (!re.test(line)) continue;
        const prev = this.last.get(t.id);
        if (prev !== undefined && now - prev < this.quietMs) continue;
        this.last.set(t.id, now);
        hits.push({ trigger: t, line: line.trim().slice(0, 200) });
      }
    }
    return hits;
  }
}

/** Why a pattern does not work, for the editor; undefined when it is fine. */
export function patternError(pattern: string): string | undefined {
  try {
    new RegExp(pattern, 'i');
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
