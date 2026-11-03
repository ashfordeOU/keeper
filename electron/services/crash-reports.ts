// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Crash and error reports for Ashforde (Settings → Privacy): off until the
// person switches them on. While on, Keeper's own errors and crashes (from
// resilience.ts and the system's process events) become anonymous reports
// (core/crash-report.ts) that wait in <userData>/crash-reports.json and go out
// together, at most every 30 minutes. While off nothing is collected, and
// switching off deletes what was waiting. KEEPER_TELEMETRY=0, DO_NOT_TRACK=1
// and the administrator's policy file switch them off too.

import { app } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CrashReportsApi, CrashReportsStatus } from '../../core/api-crash';
import { CRASH_ENDPOINT, enqueue, errorName, makeReport, nextBatch, validateCrashBody, type CrashBody, type CrashKind, type CrashProcess, type CrashReport } from '../../core/crash-report';
import { offReason, parsePolicy, policyPath } from '../../core/telemetry';
import { lastRun, onProblem, type Problem } from '../resilience';
import { featureOn, onFeature, setFeature } from './features';
import { poll, pollNow } from './governor';

const FEATURE = 'crashReports';
const POLL = 'crashReports.send';
declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;
// Test hooks, never in an official build: another address and a shorter wait.
const ENDPOINT = (!OFFICIAL && process.env.KEEPER_CRASH_URL) || CRASH_ENDPOINT;
const INTERVAL = (!OFFICIAL && Number(process.env.KEEPER_CRASH_INTERVAL_MS)) || 30 * 60_000;
const POLICY_FILE = (!OFFICIAL && process.env.KEEPER_POLICY_FILE) || policyPath(process.platform, process.env);
// Test runs on CI machines send nothing unless a test points Keeper at its own stand-in server.
const CI_QUIET = !!process.env.CI && !(!OFFICIAL && process.env.KEEPER_CRASH_URL);

interface Stored { queue: CrashReport[]; last?: { at: number; body: CrashBody }; lastAttempt?: { at: number; result: string } }
let data: Stored | null = null;
let stopPoll: (() => void) | undefined;
let sending = false;

const file = () => path.join(app.getPath('userData'), 'crash-reports.json');
function load(): Stored {
  if (data) return data;
  let d: Partial<Stored> = {};
  try { d = JSON.parse(readFileSync(file(), 'utf8')); } catch { /* none yet */ }
  data = { queue: Array.isArray(d.queue) ? d.queue : [], last: d.last, lastAttempt: d.lastAttempt };
  return data;
}
function save() {
  if (!data) return;
  void fsp.writeFile(file(), JSON.stringify(data)).catch(() => undefined);
}

function policyOff(): boolean {
  let policy = null;
  try { policy = parsePolicy(readFileSync(POLICY_FILE, 'utf8')); } catch { /* no policy */ }
  // The administrator's "usageStats: false" and the environment switches cover crash reports too.
  return !!offReason({ switchOn: true, env: process.env, policy });
}

const on = () => featureOn(FEATURE) && !policyOff();

/** Words that must never appear in a frame: this computer's user name and name. */
function personal(): string[] {
  const out: string[] = [];
  try { out.push(os.userInfo().username); } catch { /* none */ }
  try { out.push(os.hostname().split('.')[0]); } catch { /* none */ }
  return out;
}

function add(proc: CrashProcess, kind: CrashKind, name: string, stack?: string) {
  if (!on()) return;
  const r = makeReport({ version: app.getVersion(), prerelease: /-/.test(app.getVersion()), platform: process.platform, osRelease: process.platform === 'darwin' ? process.getSystemVersion() : os.release(), arch: process.arch, process: proc, kind, name, stack, personal: personal() });
  const d = load();
  d.queue = enqueue(d.queue, r);
  save();
}

function fromProblem(p: Problem) {
  if (p.kind === 'window-error') add(p.process as CrashProcess, 'window-error', errorName(p.stack || p.text), p.stack);
  else if (p.kind === 'window-crash') add(p.process as CrashProcess, 'window-crash', p.reason === 'oom' ? 'WindowOutOfMemory' : p.reason === 'launch-failed' ? 'WindowLaunchFailed' : 'WindowCrashed');
  else add('main', p.kind, errorName(p.error), p.error instanceof Error ? p.error.stack : undefined);
}

async function send(): Promise<string> {
  const d = load();
  if (!d.queue.length) return 'nothing to send';
  if (!on()) return 'off';
  if (CI_QUIET) return 'quiet on CI';
  if (sending) return 'already sending';
  sending = true;
  try {
    const { body, rest } = nextBatch(d.queue);
    const v = validateCrashBody(body);
    if (!v.ok) { d.queue = rest; save(); return `dropped: ${v.error}`; }
    const u = new URL(ENDPOINT);
    const { ownConnectionDenied } = await import('./fw');
    if (await ownConnectionDenied(u.hostname, u.protocol === 'https:' ? 443 : Number(u.port) || 80).catch(() => false)) return 'blocked by the firewall';
    // No cookies, no extra headers: only the body.
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'error', credentials: 'omit' });
    if (res.ok || res.status === 400) {
      // A refused body is not tried again.
      d.queue = rest;
      if (res.ok) d.last = { at: Date.now(), body };
    }
    d.lastAttempt = { at: Date.now(), result: res.ok ? 'sent' : `answered ${res.status}` };
    save();
    return d.lastAttempt.result;
  } catch (e) {
    d.lastAttempt = { at: Date.now(), result: 'offline' };
    save();
    return e instanceof Error ? e.message : String(e);
  } finally {
    sending = false;
  }
}

function status(): CrashReportsStatus {
  const d = load();
  const offWhy = policyOff() ? 'Switched off on this computer by its administrator or an environment setting.' : undefined;
  return {
    on: featureOn(FEATURE) && !offWhy,
    locked: !!offWhy,
    offText: offWhy,
    next: d.queue.length ? nextBatch(d.queue).body : null,
    waiting: d.queue.reduce((n, r) => n + r.count, 0),
    last: d.last,
    host: new URL(ENDPOINT).host,
  };
}

export const crashReportsApi: CrashReportsApi = {
  async status() { return status(); },
  async setOn(v) {
    await setFeature(FEATURE, v);
    if (!v) { const d = load(); d.queue = []; save(); }
    return status();
  },
  async clear() { const d = load(); d.queue = []; save(); return status(); },
  async sendNow() { await send(); return status(); },
};

export function startCrashReports() {
  onProblem(fromProblem);
  // The last run ended without quitting (a crash with no JavaScript error to show for it).
  if (lastRun.unclean) add('main', 'unexpected-exit', 'UnexpectedExit');
  // The system's own word that a helper process crashed (the GPU, a utility process).
  app.on('child-process-gone', (_e, det) => {
    if (det.reason !== 'crashed' && det.reason !== 'oom') return;
    add(det.type === 'GPU' ? 'gpu' : det.type === 'Utility' ? 'utility' : 'other', 'process-crash', det.reason === 'oom' ? 'ProcessOutOfMemory' : 'ProcessCrashed');
  });
  onFeature(FEATURE, (v) => {
    if (!v) {
      stopPoll?.(); stopPoll = undefined;
      // Off: what was waiting goes.
      if (data?.queue.length) { data.queue = []; save(); }
      return;
    }
    stopPoll ??= poll(POLL, { baseMs: INTERVAL, idleFactor: 1, maxMs: INTERVAL * 2 }, () => send(), { feature: FEATURE, now: false });
    if (load().queue.length) setTimeout(() => pollNow(POLL), 60_000).unref?.();
  }, { now: true });
}
