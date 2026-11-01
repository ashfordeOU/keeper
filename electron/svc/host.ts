// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs a part of Keeper in its own process (an Electron utility process), so a
// crash or a hang there never takes the rest of Keeper with it.
//
//   • started on the first call, stopped again after a quiet while (its memory
//     goes back to the system);
//   • calls are plain messages; a call that never answers is given up after a
//     timeout and the process is restarted;
//   • if the process stops unexpectedly it is started again with growing waits,
//     the call that was in flight is tried once more, and the interface hears
//     about it quietly;
//   • the Processes page lists it with its memory, CPU, restarts and last crash.

import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';

export interface HostOptions {
  /** short id, e.g. 'net' */
  name: string;
  /** shown on the Processes page */
  label: string;
  /** file in dist-electron, e.g. 'svc-net.cjs' */
  script: string;
  /** the Keeper feature it belongs to (Disable switches that off) */
  feature?: string;
  /** stop after this long without calls (0: keep running) */
  idleStopMs?: number;
  /** give up on a call after this long */
  callTimeoutMs?: number;
  /** sent once after the process starts, before any call */
  init?: () => unknown;
}

interface Pending { method: string; args: unknown[]; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; retried: boolean }

type Listener = () => void;
const hosts = new Map<string, ServiceHost>();
const changeListeners = new Set<Listener>();
let restartedListener: (name: string, label: string, reason: string) => void = () => undefined;

export function allHosts(): ServiceHost[] {
  return [...hosts.values()];
}

export function onHostsChanged(fn: Listener) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

export function onHostRestarted(fn: (name: string, label: string, reason: string) => void) {
  restartedListener = fn;
}

const changed = () => { for (const l of changeListeners) l(); };

export class HostError extends Error {
  constructor(message: string, readonly code: 'NO_HOST' | 'TIMEOUT' | 'CRASHED' | 'STOPPED' | 'REMOTE') {
    super(message);
  }
}

export class ServiceHost {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private stopping = false;
  private crashTimes: number[] = [];
  /** stopped on purpose from the Processes page: no automatic restarts until the next call */
  private held = false;
  state: 'stopped' | 'starting' | 'running' | 'crashed' = 'stopped';
  startedAt = 0;
  restarts = 0;
  lastCrash?: { at: number; reason: string };
  calls = 0;

  constructor(readonly opts: HostOptions) {
    hosts.set(opts.name, this);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Calls a method in the service, starting it if needed. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    this.held = false;
    this.calls++;
    this.touch();
    return this.start().then(() => new Promise<T>((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => this.timeout(id), this.opts.callTimeoutMs ?? 30_000);
      this.pending.set(id, { method, args, resolve: resolve as (v: unknown) => void, reject, timer, retried: false });
      this.send(id, method, args);
    }));
  }

  private send(id: number, method: string, args: unknown[]) {
    try {
      this.child?.postMessage({ id, method, args });
    } catch (e) {
      this.fail(id, new HostError((e as Error).message, 'CRASHED'));
    }
  }

  private fail(id: number, e: Error) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(e);
  }

  private timeout(id: number) {
    const p = this.pending.get(id);
    if (!p) return;
    this.fail(id, new HostError(`${this.opts.label} did not answer`, 'TIMEOUT'));
    // A process that stops answering is restarted; the next call gets a fresh one.
    this.crashed(`no answer to ${p.method} within ${Math.round((this.opts.callTimeoutMs ?? 30_000) / 1000)} s`);
    this.child?.kill();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    // Starting again after it stopped unexpectedly counts as a restart (and the interface hears about it).
    const afterCrash = this.state === 'crashed';
    this.state = 'starting';
    changed();
    this.ready = new Promise<void>((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(path.join(__dirname, this.opts.script), [], { serviceName: `Keeper ${this.opts.label}`, stdio: 'ignore' });
      } catch (e) {
        this.ready = null;
        this.state = 'stopped';
        reject(new HostError(`could not start ${this.opts.label}: ${(e as Error).message}`, 'NO_HOST'));
        return;
      }
      this.child = child;
      const startTimer = setTimeout(() => {
        reject(new HostError(`${this.opts.label} did not start`, 'NO_HOST'));
        child.kill();
      }, 15_000);
      child.once('spawn', () => {
        clearTimeout(startTimer);
        this.startedAt = Date.now();
        this.state = 'running';
        if (afterCrash) {
          this.restarts++;
          restartedListener(this.opts.name, this.opts.label, this.lastCrash?.reason ?? '');
        }
        if (this.opts.init) child.postMessage({ id: 0, method: '__init', args: [this.opts.init()] });
        changed();
        resolve();
      });
      child.on('message', (m: { id: number; ok?: boolean; value?: unknown; error?: string }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new HostError(m.error ?? 'failed', 'REMOTE'));
        this.touch();
      });
      child.once('exit', (code) => {
        clearTimeout(startTimer);
        const wasStopping = this.stopping;
        this.child = null;
        this.ready = null;
        this.stopping = false;
        if (wasStopping) {
          this.state = 'stopped';
          for (const id of [...this.pending.keys()]) this.fail(id, new HostError(`${this.opts.label} was stopped`, 'STOPPED'));
          changed();
          return;
        }
        this.crashed(`stopped unexpectedly (exit code ${code})`);
        reject(new HostError(`${this.opts.label} stopped`, 'CRASHED'));
        this.recover();
      });
    });
    return this.ready;
  }

  private crashed(reason: string) {
    this.lastCrash = { at: Date.now(), reason };
    this.state = 'crashed';
    this.crashTimes = [...this.crashTimes.filter((t) => Date.now() - t < 10 * 60_000), Date.now()];
    changed();
  }

  /** Calls in flight are tried once more on a fresh process; after five crashes in ten minutes it waits for the next call. */
  private recover() {
    const pending = [...this.pending.entries()];
    if (this.held || this.crashTimes.length > 5) {
      for (const [id] of pending) this.fail(id, new HostError(`${this.opts.label} keeps stopping`, 'CRASHED'));
      return;
    }
    const wait = Math.min(30_000, 500 * 2 ** (this.crashTimes.length - 1));
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (!pending.length && !this.opts.idleStopMs) return void this.start().catch(() => undefined);
      if (!pending.length) return;
      this.start().then(() => {
        for (const [id, p] of pending) {
          if (!this.pending.has(id)) continue;
          if (p.retried) { this.fail(id, new HostError(`${this.opts.label} stopped again`, 'CRASHED')); continue; }
          p.retried = true;
          this.send(id, p.method, p.args);
        }
      }, (e: Error) => { for (const [id] of pending) this.fail(id, e); });
    }, wait);
  }

  private touch() {
    clearTimeout(this.idleTimer);
    if (!this.opts.idleStopMs) return;
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) void this.stop();
    }, this.opts.idleStopMs);
    this.idleTimer.unref?.();
  }

  /** Stops the process (its memory goes back to the system); the next call starts it again. */
  stop(hold = false): Promise<void> {
    this.held = hold;
    clearTimeout(this.idleTimer);
    clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
      changed();
      return Promise.resolve();
    }
    this.stopping = true;
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 3000).unref?.();
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.held = false;
    await this.start();
    this.restarts++;
    changed();
  }
}
