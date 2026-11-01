// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Windows: one PowerShell that stays open for the questions Keeper asks every
// few seconds (what is playing). Starting PowerShell costs a few hundred
// milliseconds of processor each time; asking a running one costs almost
// nothing. It closes after a minute without questions. Anything that goes
// wrong (timeout, crash) falls back to a fresh PowerShell for that question.

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { powershell } from '../../core/platform';
import { lowerPriority } from './governor';

// Each request is one line of base64 script; each answer one line of base64 output.
const LOOP = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $out = ''
  try { $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)); $out = (& ([ScriptBlock]::Create($code)) | Out-String) } catch { $out = '' }
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($out)))
  [Console]::Out.Flush()
}`;

/** For tests on other systems: which PowerShell to start. */
export let psExe = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export function setPsExe(fn: () => string) {
  psExe = fn;
}

let host: ChildProcess | undefined;
let buf = '';
let waiting: ((out: string | null) => void) | undefined;
let queue: Promise<unknown> = Promise.resolve();
let idle: NodeJS.Timeout | undefined;
let failures = 0;

function stop() {
  host?.kill();
  host = undefined;
  buf = '';
  waiting?.(null);
  waiting = undefined;
}

function ensure(): ChildProcess | undefined {
  if (host && host.exitCode === null && !host.killed) return host;
  if (failures >= 3) return undefined;
  try {
    const child = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LOOP], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    lowerPriority(child);
    child.on('error', () => { failures++; if (host === child) stop(); });
    child.on('exit', () => { if (host === child) { host = undefined; waiting?.(null); waiting = undefined; } });
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const w = waiting;
        waiting = undefined;
        w?.(Buffer.from(line, 'base64').toString('utf8'));
      }
    });
    host = child;
    return child;
  } catch {
    failures++;
    return undefined;
  }
}

function ask(script: string, timeout: number): Promise<string | null> {
  const h = ensure();
  if (!h) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      // Stuck: start over next time.
      failures++;
      stop();
      resolve(null);
    }, timeout);
    waiting = (out) => { clearTimeout(t); resolve(out); };
    h.stdin!.write(Buffer.from(script, 'utf8').toString('base64') + '\n');
  });
}

/**
 * Runs a script in the long-lived PowerShell (one at a time) and returns what
 * it printed. Falls back to a fresh PowerShell when the host cannot answer.
 */
export function psRun(script: string, timeout = 8000): Promise<{ ok: boolean; stdout: string }> {
  const job = queue.then(async () => {
    clearTimeout(idle);
    const out = await ask(script, timeout);
    idle = setTimeout(stop, 60_000);
    if (out !== null) return { ok: true, stdout: out };
    const r = await powershell(script, timeout);
    return { ok: r.ok, stdout: r.stdout };
  });
  queue = job.catch(() => undefined);
  return job;
}

process.on('exit', stop);
