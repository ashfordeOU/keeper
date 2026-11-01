// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Talks to keeper-helper directly, the way Keeper does: one JSON request per
// line on stdin, one JSON answer (or several "delta" lines, for streams) per
// line on stdout. Its stderr goes to the run's logs.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface HelperAnswer { ok: boolean; result?: any; error?: string; deltas: string[]; ms: number; timedOut?: boolean }

export interface Helper {
  /** waits for the answer; for a stream, collects deltas for streamMs and then cancels it */
  call(method: string, params?: Record<string, unknown>, o?: { timeoutMs?: number; streamMs?: number; onDelta?: (d: string) => void }): Promise<HelperAnswer>;
  stop(): void;
}

export function startHelper(bin: string, stderrFile: string, env: NodeJS.ProcessEnv): Helper {
  const child: ChildProcess = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
  const err = fs.createWriteStream(stderrFile, { flags: 'a' });
  child.stderr?.on('data', (d: Buffer) => err.write(d));
  let next = 1;
  let buf = '';
  const waiting = new Map<number, (m: any) => void>();
  const deltas = new Map<number, (d: string) => void>();
  let dead: string | null = null;
  child.on('exit', (code) => {
    dead = `keeper-helper stopped (${code ?? 'signal'})`;
    for (const [, w] of waiting) w({ error: dead });
    waiting.clear();
  });
  child.on('error', (e) => { dead = String(e); });
  child.stdout?.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l.trim()) continue;
      let m: any;
      try { m = JSON.parse(l); } catch { err.write(`[unparsed stdout] ${l}\n`); continue; }
      if (typeof m.id !== 'number') continue;
      if ('delta' in m) deltas.get(m.id)?.(String(m.delta));
      else waiting.get(m.id)?.(m);
    }
  });
  const write = (o: unknown) => { try { child.stdin?.write(JSON.stringify(o) + '\n'); } catch { /* closed */ } };
  return {
    async call(method, params = {}, o = {}) {
      const t0 = Date.now();
      if (dead) return { ok: false, error: dead, deltas: [], ms: 0 };
      const id = next++;
      const got: string[] = [];
      deltas.set(id, (d) => { if (got.length < 2000) got.push(d); o.onDelta?.(d); });
      const answer = new Promise<any>((resolve) => waiting.set(id, resolve));
      write({ id, method, params });
      let streamTimer: NodeJS.Timeout | undefined;
      if (o.streamMs) streamTimer = setTimeout(() => write({ id, method: 'cancel' }), o.streamMs);
      const limit = o.timeoutMs ?? 20_000;
      const m = await Promise.race([answer, new Promise((r) => setTimeout(() => r({ timeout: true }), limit + (o.streamMs ?? 0)))]) as any;
      if (streamTimer) clearTimeout(streamTimer);
      waiting.delete(id);
      deltas.delete(id);
      if (m.timeout) { write({ id, method: 'cancel' }); return { ok: false, error: `no answer in ${Math.round(limit / 1000)} s`, deltas: got, ms: Date.now() - t0, timedOut: true }; }
      if ('error' in m) return { ok: false, error: String(m.error), deltas: got, ms: Date.now() - t0 };
      return { ok: true, result: m.result, deltas: got, ms: Date.now() - t0 };
    },
    stop() {
      try { child.stdin?.end(); } catch { /* closed */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
      err.end();
    },
  };
}

/** The dry run's stand-in: answers from fixtures ("method" → result, or { "$error": "…" }, plus optional "$deltas"). */
export function fakeHelper(fixtures: Record<string, any>): Helper {
  return {
    async call(method, _p, o = {}) {
      const f = fixtures[method];
      if (f === undefined) return { ok: false, error: `Unknown method ${method}`, deltas: [], ms: 1 };
      const deltas: string[] = Array.isArray(f?.$deltas) ? f.$deltas : [];
      for (const d of deltas) o.onDelta?.(d);
      if (f && typeof f === 'object' && '$error' in f) return { ok: false, error: String(f.$error), deltas, ms: 1 };
      const result = f && typeof f === 'object' && '$result' in f ? f.$result : f;
      return { ok: true, result, deltas, ms: 1 };
    },
    stop() { /* nothing */ },
  };
}
