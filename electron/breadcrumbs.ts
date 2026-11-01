// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What Keeper was doing just before it stopped, for crashes that leave no
// JavaScript trace (a native abort or a fatal error in the main process: macOS
// then reports EXC_BREAKPOINT on CrBrowserMain and nothing else). The last 200
// lines Keeper logged, its memory, the regular checks (and which one is
// running), timers and sleep/wake are kept in session/breadcrumbs.json: written
// once a minute when something changed, at once on sleep, wake, warnings and
// errors, all from the main thread with a small atomic write. After a crash the
// next start keeps that file as breadcrumbs-<time>.json (the last five) beside
// Crashpad's local minidump (crash reports are never uploaded).

import { app, powerMonitor } from 'electron';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

const MAX_LINES = 200;
const lines: string[] = [];
const power: string[] = [];
let dirty = false;
let pollsOf: () => unknown = () => [];
let started = false;

const dir = () => path.join(app.getPath('userData'), 'session');
const file = () => path.join(dir(), 'breadcrumbs.json');

function remember(kind: string, args: unknown[]) {
  const text = `${new Date().toISOString()} ${kind} ${format(...args)}`.slice(0, 600);
  lines.push(text);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  dirty = true;
}

function writeNow(why: string) {
  try {
    mkdirSync(dir(), { recursive: true });
    const m = process.memoryUsage();
    const body = JSON.stringify({
      at: Date.now(), why, pid: process.pid, version: app.getVersion(), uptimeSec: Math.round(process.uptime()),
      memoryMB: { rss: Math.round(m.rss / 1048576), heapUsed: Math.round(m.heapUsed / 1048576), heapTotal: Math.round(m.heapTotal / 1048576), external: Math.round(m.external / 1048576), arrayBuffers: Math.round(m.arrayBuffers / 1048576) },
      activeResources: (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo?.().reduce<Record<string, number>>((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {}),
      polls: pollsOf(),
      power: power.slice(-20),
      lines,
    });
    const tmp = `${file()}.tmp`;
    const fd = openSync(tmp, 'w');
    try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file());
    dirty = false;
  } catch {
    /* a read-only profile: nothing to keep */
  }
}

let soon: NodeJS.Timeout | undefined;
const writeSoon = (why: string) => { clearTimeout(soon); soon = setTimeout(() => writeNow(why), 2000); soon.unref?.(); };

/**
 * Starts keeping breadcrumbs. `polls` describes the governor's regular checks.
 * `crashedLastTime`: the previous run ended without quitting, so its file is kept.
 */
export function startBreadcrumbs(o: { polls: () => unknown; crashedLastTime: boolean }) {
  if (started) return;
  started = true;
  pollsOf = o.polls;
  if (o.crashedLastTime && existsSync(file())) {
    try {
      copyFileSync(file(), path.join(dir(), `breadcrumbs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const old = readdirSync(dir()).filter((n) => /^breadcrumbs-.+\.json$/.test(n)).sort();
      for (const n of old.slice(0, Math.max(0, old.length - 5))) rmSync(path.join(dir(), n), { force: true });
    } catch { /* best effort */ }
  }
  for (const k of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      remember(k, a);
      if (k === 'warn' || k === 'error') writeSoon(k);
      orig(...a);
    };
  }
  process.on('warning', (w) => { remember('process-warning', [w.name, w.message]); writeSoon('warning'); });
  const note = (ev: string) => () => { power.push(`${new Date().toISOString()} ${ev}`); remember('power', [ev]); writeNow(ev); };
  for (const ev of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'shutdown'] as const) powerMonitor.on(ev as 'suspend', note(ev));
  app.on('child-process-gone', (_e, d) => { remember('child-process-gone', [d.type, d.reason, d.exitCode, d.name ?? '']); writeSoon('child-process-gone'); });
  app.on('render-process-gone', (_e, _wc, d) => { remember('render-process-gone', [d.reason, d.exitCode]); writeSoon('render-process-gone'); });
  const t = setInterval(() => { if (dirty) writeNow('minute'); }, 60_000);
  t.unref?.();
  writeNow('start');
}

/** Lines logged so far (tests and the diagnostics report). */
export const breadcrumbLines = () => lines.slice();
