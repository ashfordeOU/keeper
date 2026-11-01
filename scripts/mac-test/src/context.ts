// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What every test area gets: the recorder (results.json, written after every
// check so a stopped run still leaves results), the undo journal (every change
// to the Mac is written down, with the command that puts it back, before it is
// made), the commands, the questions, the app and the helper.

import fs from 'node:fs';
import path from 'node:path';
import type { KeeperApp } from './app';
import type { Args } from './args';
import type { Helper } from './helper';
import { color, type Prompter } from './prompt';
import { summarize, type ChangeRecord, type CheckKind, type CheckResult, type Results, type Status } from './schema';
import type { RunResult, Sys } from './sys';

export interface Outcome { status: Status; details: string; error?: string; data?: unknown }
export const pass = (details: string, data?: unknown): Outcome => ({ status: 'pass', details, data });
export const fail = (details: string, error?: string, data?: unknown): Outcome => ({ status: 'fail', details, error, data });
export const skip = (details: string, data?: unknown): Outcome => ({ status: 'skip', details, data });
/** pass when ok, fail otherwise */
export const verdict = (ok: boolean, details: string, data?: unknown, error?: string): Outcome => (ok ? pass(details, data) : fail(details, error, data));

export interface CheckHandle {
  /** adds a file (a path inside the bundle) to this check */
  artifact(rel: string): void;
  /** the owner's answer and note, for guided checks */
  answered(answer: string, note?: string): void;
}

export class Recorder {
  readonly results: Results;
  private file: string;
  constructor(bundle: string, init: Omit<Results, 'checks' | 'changes' | 'cleanup' | 'summary'>, private log: (s: string) => void) {
    this.results = { ...init, checks: [], changes: [], cleanup: { ok: true, items: [] }, summary: { total: 0, pass: 0, fail: 0, skip: 0 } };
    this.file = path.join(bundle, 'results.json');
    this.save();
  }

  save() {
    if (this.frozen) return;
    this.results.summary = summarize(this.results.checks);
    try { fs.writeFileSync(this.file, JSON.stringify(this.results, null, 2)); } catch { /* the folder may be gone at the very end */ }
  }

  has(id: string) { return this.results.checks.some((c) => c.id === id); }

  /** Once the run is stopping, checks are recorded as skipped without running. */
  stopping: () => boolean = () => false;
  /** Set when the results are final (scrubbed for packing): nothing is written after that. */
  frozen = false;

  /** Runs one check: times it, catches what it throws, prints a line, saves. */
  async check(id: string, title: string, kind: CheckKind, fn: (h: CheckHandle) => Promise<Outcome>): Promise<CheckResult> {
    const area = id.split('.')[0];
    let n = 2;
    let uid = id;
    while (this.has(uid)) uid = `${id}-${n++}`;
    const started = new Date();
    const artifacts: string[] = [];
    let answer: string | undefined;
    let note: string | undefined;
    let o: Outcome;
    if (this.stopping()) {
      o = skip('The run was stopped before this check');
    } else try {
      o = await fn({ artifact: (rel) => { if (rel && !artifacts.includes(rel)) artifacts.push(rel); }, answered: (a, nt) => { answer = a; note = nt; } });
    } catch (e) {
      const err = e as Error;
      o = fail(`Stopped with an error: ${err?.message ?? String(e)}`, err?.stack ?? String(e));
    }
    const c: CheckResult = {
      id: uid, area, title, kind, status: o.status, details: o.details, startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(), artifacts,
      ...(o.error ? { error: o.error } : {}), ...(answer ? { answer } : {}), ...(note ? { note } : {}), ...(o.data !== undefined ? { data: o.data } : {}),
    };
    this.results.checks.push(c);
    this.save();
    const tag = c.status === 'pass' ? color.grn('PASS') : c.status === 'fail' ? color.red('FAIL') : color.dim('skip');
    process.stdout.write(`  ${tag} ${title} ${color.dim(`(${(c.durationMs / 1000).toFixed(1)} s)`)}${c.status !== 'pass' ? color.dim(` — ${c.details.slice(0, 140)}`) : ''}\n`);
    this.log(`[${c.status}] ${uid}: ${c.details}${c.error ? `\n${c.error}` : ''}`);
    return c;
  }
}

export interface UndoItem { id: string; what: string; restore: string; cmd: string; admin?: boolean; verify?: () => Promise<{ ok: boolean; detail?: string }> }

/**
 * The undo journal, shared with run.sh: one line per change, written before
 * the change is made. If this program is stopped or crashes, run.sh's trap
 * runs whatever is not marked done, newest first.
 */
export class Undo {
  private items: UndoItem[] = [];
  private done = new Set<string>();
  constructor(private file: string, private doneFile: string, private sys: Sys, private rec: Recorder, private say: (s: string) => void) {
    fs.writeFileSync(file, '', { flag: 'a' });
    fs.writeFileSync(doneFile, '', { flag: 'a' });
  }

  get pending() { return this.items.filter((i) => !this.done.has(i.id)); }

  add(item: UndoItem) {
    if (this.items.some((i) => i.id === item.id && !this.done.has(i.id))) return;
    if (this.done.has(item.id)) this.done.delete(item.id);
    this.items.push(item);
    const b64 = Buffer.from(item.cmd).toString('base64');
    fs.appendFileSync(this.file, `${item.id}\t${item.admin ? 1 : 0}\t${item.what.replace(/[\t\n]/g, ' ')}\t${b64}\n`);
    const ch: ChangeRecord = { id: item.id, what: item.what, restore: item.restore, admin: !!item.admin, restored: false, verified: false };
    this.rec.results.changes = this.rec.results.changes.filter((c) => c.id !== item.id).concat(ch);
    this.rec.save();
  }

  /** Puts one change back now (it is then marked done, so it is not run again). */
  async run(id: string): Promise<boolean> {
    const item = this.items.find((i) => i.id === id);
    if (!item || this.done.has(id)) return true;
    const r: RunResult = this.sys.dryRun
      ? { ok: true, code: 0, stdout: '', stderr: '', ms: 0 }
      : item.admin
      ? await this.sys.run('/usr/bin/sudo', ['/bin/sh', '-c', item.cmd], { timeoutMs: 120_000, inherit: true })
      : await this.sys.sh(item.cmd, { timeoutMs: 60_000 });
    const ch = this.rec.results.changes.find((c) => c.id === id);
    if (ch) { ch.restored = r.ok; if (!r.ok) ch.detail = (r.stderr || r.stdout).trim().slice(0, 300); }
    if (item.verify) {
      const v = await item.verify().catch((e) => ({ ok: false, detail: String(e) }));
      if (ch) { ch.verified = v.ok; if (v.detail) ch.detail = v.detail; }
    } else if (ch) ch.verified = r.ok;
    this.done.add(id);
    fs.appendFileSync(this.doneFile, `${id}\n`);
    this.rec.save();
    return r.ok;
  }

  /** Runs every change not yet put back, newest first. */
  async runAll() {
    const left = this.pending.reverse();
    if (left.length) this.say(color.b(`\nPutting back ${left.length} change${left.length === 1 ? '' : 's'}…`));
    for (const i of left) {
      const ok = await this.run(i.id);
      this.say(`  ${ok ? color.grn('ok') : color.red('FAILED')} ${i.restore}`);
    }
  }

  /** A change that turned out not to need putting back (it never happened). */
  forget(id: string) {
    if (this.done.has(id)) return;
    this.done.add(id);
    fs.appendFileSync(this.doneFile, `${id}\n`);
    this.rec.results.changes = this.rec.results.changes.filter((c) => c.id !== id);
    this.items = this.items.filter((i) => i.id !== id);
    this.rec.save();
  }
}

export interface Paths {
  root: string;
  run: string;
  bundle: string;
  home: string;
  userData: string;
  shots: string;
  logs: string;
  data: string;
  bin: string;
}

export interface Facts {
  macosMajor: number;
  macos: string;
  darwin: string;
  model: string;
  notch: boolean;
  arm: boolean;
  battery: boolean;
  user: string;
  realHome: string;
  helperBin?: string;
  probeBin?: string;
  tcc: Record<string, unknown>;
  screens: any[];
  /** the throwaway home really is in use (checked before Keeper starts) */
  sandboxOk: boolean;
  /** the owner's own Keeper data folder at the start */
  realKeeperBefore?: { exists: boolean; files: number; newest: number; bytes: number };
  /** what a stage of the run read before changing things, for the cleanup checks */
  before: Record<string, unknown>;
}

export interface Ctx {
  args: Args;
  sys: Sys;
  prompt: Prompter;
  rec: Recorder;
  undo: Undo;
  paths: Paths;
  facts: Facts;
  dry: boolean;
  /** Keeper, started on first use (and again after a test closes it) */
  app(): Promise<KeeperApp>;
  /** extra environment for Keeper's next start (an area sets it, closes Keeper, and removes it again) */
  appEnv: Record<string, string>;
  /** Keeper if it is running now */
  running(): KeeperApp | null;
  /** closes Keeper (gracefully, or as a crash would) */
  closeApp(how?: 'quit' | 'kill'): Promise<void>;
  helper(): Promise<Helper | null>;
  /** mactest-probe <args>, parsed; null when it is not built or failed */
  probe(...args: string[]): Promise<any | null>;
  /** writes text or JSON into data/; returns the bundle path */
  saveData(name: string, v: unknown): string;
  /** a picture of the whole screen (or a region), when the owner allowed screen pictures; returns the bundle path */
  shotScreen(name: string, region?: { x: number; y: number; width: number; height: number }): Promise<string | null>;
  /** a picture of one of Keeper's windows; returns the bundle path */
  shotWindow(name: string, match?: string): Promise<string | null>;
  /** `say` a short cue (sparingly) */
  cue(text: string): Promise<void>;
  stopping(): boolean;
  /** asks once whether a sudo step may run (and keeps sudo's ticket warm) */
  sudoOk(why: string): Promise<boolean>;
  say(s?: string): void;
}

/** The heading printed when an area starts. */
export function areaHeader(ctx: Ctx, title: string) {
  ctx.say('');
  ctx.say(color.b(color.cyan(`━━ ${title} ━━`)));
}
