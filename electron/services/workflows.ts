// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs saved workflows: each step's results become the next step's files.
// Watched folders and schedules cost nothing until a workflow asks for them:
// one folder watcher per watched folder, one timer for the next scheduled run.

import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputFolder } from '../../core/convert';
import type { ConvertResult } from '../../core/convert-types';
import { checkWorkflow, matches, nextRun, type Workflow } from '../../core/filekit/workflow';
import type { Converter } from './convert';

export interface WorkflowOptions {
  file: string;
  converter: () => Converter;
  /** waits until heavy work may run (the governor), for watched and scheduled runs */
  waitTurn?: () => Promise<void>;
  onRun?: (w: Workflow, r: ConvertResult | Error) => void;
}

/** Files a list of files and folders stands for (folders: matching files inside, two levels deep). */
export async function expandInputs(inputs: string[], pattern?: string, depth = 2): Promise<string[]> {
  const out: string[] = [];
  const visit = async (p: string, d: number) => {
    const st = await fsp.stat(p).catch(() => null);
    if (!st) return;
    if (st.isFile()) { if (matches(path.basename(p), pattern) || d === depth) out.push(p); return; }
    if (!st.isDirectory() || d <= 0) return;
    for (const n of (await fsp.readdir(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (n.startsWith('.') || n.endsWith('(Keeper)')) continue;
      await visit(path.join(p, n), d - 1);
    }
  };
  for (const i of inputs) await visit(i, depth);
  return out;
}

/** Runs the steps in order; results of each step are the next step's files. */
export async function runSteps(conv: Converter, w: Pick<Workflow, 'steps' | 'outDir' | 'pattern' | 'name'>, inputs: string[], onStep?: (i: number, n: number, label: string) => void): Promise<ConvertResult> {
  let files = await expandInputs(inputs, w.pattern);
  if (!files.length) throw new Error('No files to run the workflow on');
  const finalDir = outputFolder(files, w.outDir);
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-flow-'));
  const notes: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  let details: string | undefined;
  try {
    for (const [i, step] of w.steps.entries()) {
      const last = i === w.steps.length - 1;
      onStep?.(i, w.steps.length, step.op.tool);
      const outDir = last ? finalDir : path.join(scratch, `step ${i + 1}`);
      await fsp.mkdir(outDir, { recursive: true });
      let r: ConvertResult;
      try {
        r = await conv.run({ op: step.op, inputs: files, outDir });
      } catch (e) {
        // A step with nothing to do ("already as small as it gets") passes its files on unchanged.
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already/i.test(msg)) throw e;
        const copies: string[] = [];
        for (const f of files) { const c = path.join(outDir, path.basename(f)); await fsp.copyFile(f, c); copies.push(c); }
        r = { outputs: copies, message: msg };
      }
      if (r.failed) failed.push(...r.failed.map((f) => ({ ...f, reason: `step ${i + 1}: ${f.reason}` })));
      if (r.message) notes.push(`${i + 1}. ${r.message}`);
      if (r.details) details = r.details;
      if (!r.outputs.length && !last) throw new Error(`Step ${i + 1} made no files${r.message ? ` (${r.message})` : ''}`);
      files = r.outputs.length ? r.outputs : files;
      if (last) return { outputs: r.outputs, failed: failed.length ? failed : undefined, message: `${w.name}: ${r.outputs.length} file${r.outputs.length === 1 ? '' : 's'}`, details: [notes.join('\n'), details].filter(Boolean).join('\n\n') || undefined, checksums: r.checksums };
    }
    return { outputs: [] };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

export class Workflows {
  private list: Workflow[] = [];
  private loaded = false;
  private watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private running = new Set<string>();
  private seen = new Map<string, Set<string>>();

  constructor(private o: WorkflowOptions) {}

  async all(): Promise<Workflow[]> {
    if (!this.loaded) {
      try { this.list = JSON.parse(await fsp.readFile(this.o.file, 'utf8')) as Workflow[]; } catch { this.list = []; }
      this.loaded = true;
    }
    return this.list;
  }

  private async persist() {
    await fsp.mkdir(path.dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.list, null, 1));
    await fsp.rename(tmp, this.o.file);
    void this.arm();
  }

  async save(w: Workflow): Promise<Workflow[]> {
    const problems = checkWorkflow(w);
    if (problems.length) throw new Error(problems.join('; '));
    if (w.schedule && !nextRun(w.schedule, new Date())) throw new Error(`“${w.schedule}” is not a schedule Keeper understands; try “daily 08:30”, “weekdays 18:00”, “weekly mon 09:00”, “hourly” or “every 30m”`);
    if (w.watch && !existsSync(w.watch)) throw new Error('The watched folder does not exist');
    await this.all();
    this.list = [...this.list.filter((x) => x.id !== w.id), w];
    await this.persist();
    return this.list;
  }

  async remove(id: string): Promise<Workflow[]> {
    await this.all();
    this.list = this.list.filter((x) => x.id !== id);
    await this.persist();
    return this.list;
  }

  async run(id: string, inputs?: string[]): Promise<ConvertResult> {
    const w = (await this.all()).find((x) => x.id === id);
    if (!w) throw new Error('That workflow no longer exists');
    const files = inputs?.length ? inputs : w.input ?? (w.watch ? [w.watch] : []);
    if (!files.length) throw new Error('Choose files or folders to run it on');
    if (this.running.has(id)) throw new Error('This workflow is already running');
    this.running.add(id);
    try {
      const r = await runSteps(this.o.converter(), w, files);
      w.lastRun = { at: Date.now(), ok: !r.failed?.length, outputs: r.outputs.length, message: r.message };
      await this.persist();
      this.o.onRun?.(w, r);
      return r;
    } catch (e) {
      w.lastRun = { at: Date.now(), ok: false, outputs: 0, message: e instanceof Error ? e.message : String(e) };
      await this.persist().catch(() => undefined);
      this.o.onRun?.(w, e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      this.running.delete(id);
    }
  }

  /** Starts watchers and the schedule timer for the workflows that want them; nothing otherwise. */
  async arm(): Promise<void> {
    const list = await this.all();
    // Folders.
    const wanted = new Map(list.filter((w) => w.watch && existsSync(w.watch)).map((w) => [w.id, w]));
    for (const [id, wt] of this.watchers) if (!wanted.has(id)) { wt.close(); this.watchers.delete(id); }
    for (const [id, w] of wanted) {
      if (this.watchers.has(id)) continue;
      const known = new Set(await fsp.readdir(w.watch!).catch(() => [] as string[]));
      this.seen.set(id, known);
      let debounce: NodeJS.Timeout | undefined;
      try {
        const wt = watch(w.watch!, { persistent: false }, () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => void this.arrived(id), 2500);
        });
        wt.on('error', () => { wt.close(); this.watchers.delete(id); });
        this.watchers.set(id, wt);
      } catch { /* the folder cannot be watched */ }
    }
    // Schedule: one timer for the soonest run.
    clearTimeout(this.timer);
    const now = new Date();
    const due = list.filter((w) => w.schedule).map((w) => ({ w, at: nextRun(w.schedule!, now) })).filter((x): x is { w: Workflow; at: Date } => !!x.at).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    if (due) {
      const ms = Math.min(due.at.getTime() - now.getTime(), 2 ** 31 - 1);
      this.timer = setTimeout(async () => {
        await this.o.waitTurn?.();
        await this.run(due.w.id).catch(() => undefined);
        void this.arm();
      }, Math.max(1000, ms));
      this.timer.unref?.();
    }
  }

  /** New files in a watched folder: wait until they stop growing, then run. */
  private async arrived(id: string) {
    const w = this.list.find((x) => x.id === id);
    const known = this.seen.get(id);
    if (!w?.watch || !known) return;
    const names = await fsp.readdir(w.watch).catch(() => [] as string[]);
    const fresh: string[] = [];
    for (const n of names) {
      if (known.has(n) || n.startsWith('.') || /\.(partial|crdownload|part|download|tmp)$/i.test(n) || !matches(n, w.pattern)) continue;
      const p = path.join(w.watch, n);
      const a = await fsp.stat(p).catch(() => null);
      if (!a?.isFile()) { known.add(n); continue; }
      await new Promise((r) => setTimeout(r, 1500));
      const b = await fsp.stat(p).catch(() => null);
      if (b && b.size === a.size) { known.add(n); fresh.push(p); }
    }
    if (!fresh.length) return;
    await this.o.waitTurn?.();
    await this.run(id, fresh).catch(() => undefined);
  }

  stop() {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    clearTimeout(this.timer);
  }
}
