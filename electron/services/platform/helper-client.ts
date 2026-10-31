// SPDX-License-Identifier: AGPL-3.0-or-later
// Talks to keeper-helper, the small native program that gives Keeper macOS's
// own abilities (the on-device model, Live Text, Spotlight). One process,
// started on first use, JSON lines both ways. No Electron imports, so tests can
// drive it with a stand-in helper.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeLine, LineDecoder, type HelperMessage } from '../../../core/platform-integrations';

export interface CallOptions {
  /** streamed text from the model */
  onDelta?: (text: string) => void;
  /** the model asks Keeper to run a tool; the answer goes back to the helper */
  onTool?: (name: string, args: unknown) => Promise<unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  opts: CallOptions;
  timer?: NodeJS.Timeout;
}

export class HelperClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private dead = false;

  constructor(private command: string, private args: string[] = [], private idleMs = 60_000) {}

  private idleTimer?: NodeJS.Timeout;

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const p = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const dec = new LineDecoder((m) => this.onMessage(m));
    p.stdout.on('data', (d: Buffer) => dec.push(d));
    p.stderr.on('data', () => undefined);
    p.on('error', (e) => this.fail(e));
    p.on('exit', (code) => this.fail(new Error(`keeper-helper stopped (${code ?? 'signal'})`)));
    p.stdin.on('error', () => undefined);
    this.proc = p;
    return p;
  }

  private fail(e: Error) {
    this.proc = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
      this.pending.delete(id);
    }
  }

  private onMessage(m: HelperMessage) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.delta !== undefined) {
      p.opts.onDelta?.(m.delta);
      return;
    }
    if (m.tool) {
      const { call, name, arguments: args } = m.tool;
      const run = p.opts.onTool ? p.opts.onTool(name, args) : Promise.resolve({ error: 'Tools are not available here' });
      void run
        .then((result) => result, (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        .then((result) => this.write({ id: m.id, method: 'toolResult', params: { call, result } }));
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve(m.result);
    this.armIdle();
  }

  private write(msg: unknown) {
    try {
      this.proc?.stdin.write(encodeLine(msg));
    } catch {
      /* the exit handler reports it */
    }
  }

  /** Stops the helper when nothing has been asked for a while; it starts again on the next call. */
  private armIdle() {
    clearTimeout(this.idleTimer);
    if (this.pending.size) return;
    this.idleTimer = setTimeout(() => this.stop(), this.idleMs);
    this.idleTimer.unref?.();
  }

  call<T = unknown>(method: string, params?: unknown, opts: CallOptions = {}): Promise<T> {
    if (this.dead) return Promise.reject(new Error('keeper-helper is not available'));
    clearTimeout(this.idleTimer);
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const p: Pending = { resolve: resolve as (v: unknown) => void, reject, opts };
      if (opts.timeoutMs) p.timer = setTimeout(() => { this.pending.delete(id); this.write({ id, method: 'cancel' }); reject(new Error('keeper-helper took too long')); }, opts.timeoutMs);
      opts.signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        this.write({ id, method: 'cancel' });
        reject(new Error('Stopped'));
      }, { once: true });
      this.pending.set(id, p);
      try {
        this.start();
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.write({ id, method, params });
    });
  }

  /** Marks the helper as unusable (missing or crashed at start), so callers fall back at once. */
  disable() {
    this.dead = true;
    this.stop();
  }

  stop() {
    clearTimeout(this.idleTimer);
    const p = this.proc;
    this.proc = null;
    if (p) {
      p.stdin.end();
      setTimeout(() => p.kill(), 500).unref?.();
    }
  }
}
