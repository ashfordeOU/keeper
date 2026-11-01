// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs commands for the test run and logs every one. In a dry run (on Linux,
// to prove the flow) macOS commands answer from fixtures instead.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface RunResult { ok: boolean; code: number; stdout: string; stderr: string; timedOut?: boolean; ms: number }
export interface RunOpts { timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string; cwd?: string; inherit?: boolean; /** the output is private (notes, for example): never written to the log */ secret?: boolean }

export interface Fixture {
  /** regular expression matched against "cmd arg1 arg2 …" */
  match: string;
  stdout?: string;
  stderr?: string;
  code?: number;
  /** read stdout from this file in the fixtures folder */
  file?: string;
}

export interface Background {
  child: ChildProcess | null;
  stop(signal?: NodeJS.Signals): Promise<RunResult>;
}

export class Sys {
  private fixtures: { re: RegExp; f: Fixture }[] = [];
  /** called before a command takes over the terminal (sudo's password prompt): the questions let go of it */
  beforeInherit: () => void = () => undefined;
  constructor(private o: { dryRun: boolean; logFile: string; fixtures?: Fixture[]; fixtureDir?: string }) {
    for (const f of o.fixtures ?? []) this.fixtures.push({ re: new RegExp(f.match), f });
  }

  get dryRun() { return this.o.dryRun; }

  log(line: string) {
    try { fs.appendFileSync(this.o.logFile, line.endsWith('\n') ? line : line + '\n'); } catch { /* the log is best effort */ }
  }

  private fixture(cmd: string, args: string[]): RunResult {
    const line = [cmd, ...args].join(' ');
    const hit = this.fixtures.find((x) => x.re.test(line));
    if (!hit) return { ok: false, code: 127, stdout: '', stderr: `not mocked in the dry run: ${line}`, ms: 0 };
    let stdout = hit.f.stdout ?? '';
    if (hit.f.file && this.o.fixtureDir) stdout = fs.readFileSync(`${this.o.fixtureDir}/${hit.f.file}`, 'utf8');
    const code = hit.f.code ?? 0;
    return { ok: code === 0, code, stdout, stderr: hit.f.stderr ?? '', ms: 1 };
  }

  /** Runs a command to the end. Never throws: failures come back as ok=false. */
  async run(cmd: string, args: string[] = [], opts: RunOpts = {}): Promise<RunResult> {
    const line = [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
    if (this.o.dryRun) {
      const r = this.fixture(cmd, args);
      this.log(`$ ${line}\n  -> ${r.code} (dry run)${r.stdout && !opts.secret ? `\n${indent(r.stdout)}` : ''}`);
      return r;
    }
    return this.runReal(cmd, args, opts);
  }

  /** Always runs the command, even in a dry run (for the run's own work: zip, files). */
  async runReal(cmd: string, args: string[] = [], opts: RunOpts = {}): Promise<RunResult> {
    const line = [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
    const t0 = Date.now();
    if (opts.inherit) this.beforeInherit();
    const r = await new Promise<RunResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(cmd, args, { env: opts.env ?? process.env, cwd: opts.cwd, stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ ok: false, code: 127, stdout: '', stderr: String(e), ms: 0 });
        return;
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const max = 8 << 20;
      child.stdout?.on('data', (d: Buffer) => { if (stdout.length < max) stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { if (stderr.length < max) stderr += d.toString(); });
      const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000).unref(); }, opts.timeoutMs) : null;
      child.on('error', (e) => { stderr += String(e); });
      child.on('close', (code, sig) => {
        if (timer) clearTimeout(timer);
        const c = code ?? (sig ? 128 : 1);
        resolve({ ok: c === 0 && !timedOut, code: c, stdout, stderr, timedOut, ms: Date.now() - t0 });
      });
      if (opts.input !== undefined) child.stdin?.end(opts.input);
      else child.stdin?.end();
    });
    this.log(`$ ${opts.secret ? `${cmd} (private script)` : line}\n  -> ${r.code}${r.timedOut ? ' (timed out)' : ''} in ${r.ms} ms${opts.secret ? '\n    (output not logged: private)' : r.stdout ? `\n${indent(r.stdout.slice(0, 20_000))}` : ''}${r.stderr ? `\n  stderr:\n${indent(r.stderr.slice(0, 4000))}` : ''}`);
    return r;
  }

  /** A shell line (for pipes); same rules as run(). */
  sh(script: string, opts: RunOpts = {}) {
    return this.run('/bin/sh', ['-c', script], opts);
  }

  /** Starts a long-running command; stop() ends it and returns what it printed. */
  background(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; onLine?: (l: string) => void; stdoutFile?: string } = {}): Background {
    const line = [cmd, ...args].join(' ');
    if (this.o.dryRun) {
      const r = this.fixture(cmd, args);
      this.log(`$ ${line} &  (dry run)`);
      if (opts.onLine) for (const l of r.stdout.split('\n').filter(Boolean)) opts.onLine(l);
      return { child: null, stop: async () => r };
    }
    this.log(`$ ${line} &`);
    const t0 = Date.now();
    const child = spawn(cmd, args, { env: opts.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let buf = '';
    const out = opts.stdoutFile ? fs.createWriteStream(opts.stdoutFile) : null;
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      out?.write(s);
      if (stdout.length < 4 << 20) stdout += s;
      if (opts.onLine) {
        buf += s;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) opts.onLine(l);
      }
    });
    child.stderr?.on('data', (d: Buffer) => { if (stderr.length < 1 << 20) stderr += d.toString(); });
    child.on('error', (e) => { stderr += String(e); });
    const done = new Promise<RunResult>((resolve) => child.on('close', (code, sig) => {
      out?.end();
      const c = code ?? (sig ? 128 : 1);
      resolve({ ok: c === 0, code: c, stdout, stderr, ms: Date.now() - t0 });
    }));
    return {
      child,
      stop: async (signal: NodeJS.Signals = 'SIGINT') => {
        if (child.exitCode === null) {
          try { child.kill(signal); } catch { /* gone */ }
          const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 8000);
          const r = await done;
          clearTimeout(t);
          this.log(`  (stopped ${line}: ${r.code})`);
          return r;
        }
        return done;
      },
    };
  }

  async has(cmd: string): Promise<boolean> {
    return (await this.sh(`command -v ${cmd} >/dev/null 2>&1`)).ok;
  }
}

const indent = (s: string) => s.replace(/\n+$/, '').split('\n').map((l) => `    ${l}`).join('\n');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls fn until it returns something truthy or the time is up. */
export async function until<T>(fn: () => Promise<T> | T, ms = 10_000, step = 250): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => undefined);
    if (v || Date.now() > end) return v || undefined;
    await sleep(step);
  }
}
