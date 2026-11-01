// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Friendly questions in the terminal. Every question can be skipped, and
// every question gives up after a while (the run goes on without it). In a
// dry run, or with --answers, the answers come from a file instead.

import readline from 'node:readline/promises';

export type Answer = 'y' | 'n' | 'skip' | 'timeout';
export interface Asked { answer: Answer; note?: string; ms: number }

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { b: (s: string) => `\x1b[1m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m`, cyan: (s: string) => `\x1b[36m${s}\x1b[0m`, yel: (s: string) => `\x1b[33m${s}\x1b[0m`, red: (s: string) => `\x1b[31m${s}\x1b[0m`, grn: (s: string) => `\x1b[32m${s}\x1b[0m` }
  : { b: (s: string) => s, dim: (s: string) => s, cyan: (s: string) => s, yel: (s: string) => s, red: (s: string) => s, grn: (s: string) => s };
export const color = C;

export interface PromptOpts {
  /** a key for scripted answers (and the log) */
  key: string;
  title: string;
  /** what to do, one line per item */
  lines?: string[];
  /** what the question is */
  question: string;
  /** y/n/skip (default), or just Enter to go on (or s to skip) */
  kind?: 'yn' | 'enter';
  timeoutSec?: number;
  /** what a timeout or no terminal counts as */
  fallback?: Answer;
  /** ask for an optional note afterwards */
  note?: boolean;
}

export class Prompter {
  private rl: readline.Interface | null = null;
  private scripted: Record<string, string> | null;
  private abort = new AbortController();
  constructor(private o: { interactive: boolean; answers?: Record<string, string>; log: (s: string) => void; onInterrupt: () => void }) {
    this.scripted = o.answers ?? null;
  }

  private iface() {
    if (!this.rl) {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
      // readline takes Ctrl-C for itself on a terminal; pass it on so the run can stop safely.
      this.rl.on('SIGINT', () => this.o.onInterrupt());
    }
    return this.rl;
  }

  close() { this.rl?.close(); this.rl = null; }

  /** The run is stopping: the open question (and every later one) counts as skipped. */
  abortAll() { this.abort.abort(); }

  say(s = '') { process.stdout.write(s + '\n'); }

  async ask(p: PromptOpts): Promise<Asked> {
    const t0 = Date.now();
    if (this.abort.signal.aborted) return { answer: 'skip', ms: 0 };
    this.say('');
    this.say(C.cyan(C.b(`▸ ${p.title}`)));
    for (const l of p.lines ?? []) this.say(`  ${l}`);
    const timeout = p.timeoutSec ?? 300;
    const hint = p.kind === 'enter' ? 'Enter when done, s to skip' : 'y = yes, n = no, s = skip';
    if (this.scripted) {
      const raw = this.scripted[p.key] ?? this.scripted['*'] ?? 'skip';
      const [a, ...note] = raw.split(':');
      const answer = norm(a, p.kind) ?? 'skip';
      this.say(`  ${p.question} ${C.dim(`[${hint}]`)} ${C.yel(`${answer} (scripted)`)}`);
      this.o.log(`ask ${p.key}: ${answer} (scripted)`);
      return { answer, note: note.join(':') || undefined, ms: Date.now() - t0 };
    }
    if (!this.o.interactive || !process.stdin.isTTY) {
      const answer = p.fallback ?? 'skip';
      this.say(`  ${p.question} ${C.dim(`(no terminal to ask in: ${answer})`)}`);
      this.o.log(`ask ${p.key}: ${answer} (no terminal)`);
      return { answer, ms: Date.now() - t0 };
    }
    for (;;) {
      let raw: string;
      try {
        raw = await this.iface().question(`  ${C.b(p.question)} ${C.dim(`[${hint}; ${fmtWait(timeout)}]`)} `, { signal: AbortSignal.any([AbortSignal.timeout(timeout * 1000), this.abort.signal]) });
      } catch {
        if (this.abort.signal.aborted) return { answer: 'skip', ms: Date.now() - t0 };
        const answer = p.fallback ?? 'timeout';
        this.say(C.dim(`\n  No answer in ${fmtWait(timeout)}: counted as ${answer}.`));
        this.o.log(`ask ${p.key}: timeout`);
        return { answer, ms: Date.now() - t0 };
      }
      const answer = norm(raw.trim(), p.kind);
      if (!answer) { this.say(C.yel(`  Please type ${p.kind === 'enter' ? 'Enter or s' : 'y, n or s'}.`)); continue; }
      let note: string | undefined;
      if (p.note && answer !== 'skip') {
        try {
          note = (await this.iface().question(`  ${C.dim('Anything to add? (Enter to leave it)')} `, { signal: AbortSignal.timeout(120_000) })).trim() || undefined;
        } catch { /* no note */ }
      }
      this.o.log(`ask ${p.key}: ${answer}${note ? ` (${note})` : ''}`);
      return { answer, note, ms: Date.now() - t0 };
    }
  }

  /** A yes/no permission question for something that changes the Mac. No answer means no. */
  async consent(key: string, title: string, changes: string[], restore: string[], extra: string[] = []): Promise<boolean> {
    const r = await this.ask({
      key, title,
      lines: [C.b('What changes:'), ...changes.map((c) => `  • ${c}`), C.b('How it is put back:'), ...restore.map((c) => `  • ${c}`), ...extra],
      question: 'Go ahead?', kind: 'yn', timeoutSec: 180, fallback: 'n',
    });
    return r.answer === 'y';
  }
}

function norm(s: string, kind: PromptOpts['kind']): Answer | null {
  const v = s.toLowerCase();
  if (kind === 'enter') return v === '' || v === 'y' || v === 'yes' || v === 'done' ? 'y' : v === 's' || v === 'skip' ? 'skip' : v === 'n' || v === 'no' ? 'n' : null;
  if (v === 'y' || v === 'yes') return 'y';
  if (v === 'n' || v === 'no') return 'n';
  if (v === 's' || v === 'skip') return 'skip';
  return null;
}

const fmtWait = (s: number) => (s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`);
