// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs a short list of commands (argument lists, never text typed by a person)
// — as the person, or together under ONE administrator prompt: pkexec on
// Linux, the macOS password dialog, UAC on Windows. Used by the settings
// catalogue and per-app controls.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../core/platform';

export interface RunCmd { file: string; args: string[]; admin?: boolean }
export interface RunResult { ok: boolean; message: string; outputs: string[] }

const posixQ = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const psQ = (a: string) => `'${a.replace(/['‘’‚‛]/g, '$&$&')}'`;
const WIN_PS = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Windows tools by full path, so a program of the same name elsewhere on PATH is never run. */
function resolve(file: string): string {
  if (process.platform !== 'win32') return file;
  const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const map: Record<string, string> = { reg: 'reg.exe', sc: 'sc.exe', powercfg: 'powercfg.exe', dism: 'dism.exe', cmd: 'cmd.exe' };
  if (file === 'powershell') return WIN_PS();
  return map[file] ? path.join(sys, map[file]) : file;
}

/** One shell line for an elevated batch: each command quoted, stop at the first failure. */
export function posixBatch(cmds: RunCmd[]): string {
  return cmds.map((c) => [c.file, ...c.args].map(posixQ).join(' ')).join(' && ');
}

export function powershellBatch(cmds: RunCmd[]): string {
  return cmds.map((c) => `& ${psQ(resolve(c.file))} ${c.args.map(psQ).join(' ')}; if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw "${c.file} failed ($LASTEXITCODE)" }`).join('\n');
}

/** An AppleScript string literal. */
export const appleQ = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function elevated(cmds: RunCmd[]): Promise<{ ok: boolean; out: string }> {
  if (process.platform === 'linux') {
    const r = await run('pkexec', ['sh', '-c', posixBatch(cmds)], 180_000);
    return { ok: r.ok, out: r.ok ? r.stdout : r.stderr || 'The administrator prompt was cancelled' };
  }
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/osascript', ['-e', `do shell script ${appleQ(posixBatch(cmds))} with administrator privileges`], 180_000);
    return { ok: r.ok, out: r.ok ? r.stdout : /-128/.test(r.stderr) ? 'The administrator prompt was cancelled' : r.stderr };
  }
  // Windows: the script goes to a file only this user can read; PowerShell is started elevated (one UAC prompt) to run it.
  const dir = path.join(app?.getPath?.('userData') ?? os.tmpdir(), 'elevated');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `run-${Date.now()}.ps1`);
  const done = `${file}.done`;
  await fsp.writeFile(file, `$ErrorActionPreference = 'Stop'\ntry {\n${powershellBatch(cmds)}\n'ok' | Out-File -Encoding ascii ${psQ(done)}\n} catch { $_.Exception.Message | Out-File -Encoding utf8 ${psQ(done)} }\n`, { mode: 0o600 });
  const launcher = `Start-Process -FilePath ${psQ(WIN_PS())} -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psQ(file)})`;
  const r = await run(WIN_PS(), ['-NoProfile', '-NonInteractive', '-Command', launcher], 180_000);
  const result = await fsp.readFile(done, 'utf8').catch(() => '');
  await fsp.rm(file, { force: true });
  await fsp.rm(done, { force: true });
  if (!r.ok && !result) return { ok: false, out: 'The administrator prompt was cancelled' };
  return { ok: result.trim() === 'ok', out: result.trim() === 'ok' ? '' : result.trim() };
}

/** Runs the commands in order: ordinary ones directly, administrator ones together under one prompt. */
export async function runCmds(cmds: RunCmd[], timeout = 60_000): Promise<RunResult> {
  const outputs: string[] = [];
  const admin = cmds.filter((c) => c.admin);
  if (admin.length) {
    const r = await elevated(admin);
    if (!r.ok) return { ok: false, message: r.out.trim().slice(0, 400) || 'It did not work', outputs };
    outputs.push(r.out);
  }
  for (const c of cmds.filter((x) => !x.admin)) {
    const r = await run(resolve(c.file), c.args, timeout);
    outputs.push(r.stdout);
    if (!r.ok) return { ok: false, message: (r.stderr || r.stdout).trim().slice(0, 400) || `${c.file} failed`, outputs };
  }
  return { ok: true, message: 'Done', outputs };
}

export async function runOne(c: RunCmd, timeout = 15_000) {
  return run(resolve(c.file), c.args, timeout);
}
