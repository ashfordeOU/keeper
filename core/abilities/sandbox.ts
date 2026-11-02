// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Running an AI's code in a sealed workspace. The program sees only a fresh
// temporary folder, has no internet, cannot start other programs, and is
// stopped after a time limit.
//
//   Linux    unshare: no network, the home folders hidden behind empty ones
//   macOS    sandbox-exec: no network, no reading of /Users or /Volumes, writing only in the workspace
//   Windows  no system sandbox Keeper can use without administrator rights:
//            JavaScript runs in Node's permission model with no network objects; Python is off
//
// JavaScript also runs with Node's permission model (files only in the
// workspace, no child processes or workers) inside a bare vm context.

import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Lang = 'javascript' | 'python';

export interface SandboxOptions {
  timeoutSec: number;
  memoryMb: number;
  allowNetwork: boolean;
}

export interface Runtimes {
  /** a Node-compatible runtime: Keeper's own executable with ELECTRON_RUN_AS_NODE, or node */
  node: string;
  nodeEnv?: Record<string, string>;
  python?: string;
  /** tools found on this system */
  unshare?: boolean;
  sandboxExec?: boolean;
}

export interface Command {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  /** how the program is sealed off, for the person */
  isolation: string;
}

/** The JavaScript runner: a vm context with console and a tiny files helper bound to the workspace. */
export const JS_RUNNER = `
const fs = require('fs'), path = require('path'), vm = require('vm');
const ws = process.cwd();
const code = fs.readFileSync(path.join(ws, '.main.js'), 'utf8');
const out = (...a) => process.stdout.write(a.map((x) => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 2); } catch { return String(x); } })()).join(' ') + '\\n');
const inside = (p) => { const r = path.resolve(ws, String(p)); if (r !== ws && !r.startsWith(ws + path.sep)) throw new Error('Only files in the workspace can be used'); return r; };
const files = { read: (p) => fs.readFileSync(inside(p), 'utf8'), write: (p, s) => fs.writeFileSync(inside(p), typeof s === 'string' ? s : JSON.stringify(s, null, 2)), list: () => fs.readdirSync(ws).filter((n) => !n.startsWith('.')) };
const sandbox = { console: { log: out, info: out, warn: out, error: (...a) => process.stderr.write(a.join(' ') + '\\n') }, files, Math, JSON, Date, Intl, Array, Object, String, Number, Boolean, Map, Set, WeakMap, Promise, RegExp, Error, TextEncoder, TextDecoder, structuredClone, setTimeout, clearTimeout, BigInt, Symbol, Uint8Array, Float64Array, ArrayBuffer, DataView, URL };
const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
Promise.resolve(new vm.Script(code, { filename: 'main.js' }).runInContext(ctx, { timeout: 60000 })).then((r) => { if (r !== undefined) out(r); }, (e) => { process.stderr.write(String(e && e.stack || e) + '\\n'); process.exitCode = 1; });
`;

export function buildCommand(platform: NodeJS.Platform, lang: Lang, ws: string, o: SandboxOptions, rt: Runtimes): Command {
  const isWin = platform === 'win32';
  let cmd: string;
  let args: string[];
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', HOME: ws, TMPDIR: ws, TEMP: ws, TMP: ws, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', MPLBACKEND: 'Agg', MPLCONFIGDIR: ws };
  if (isWin) env.SystemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  if (lang === 'javascript') {
    cmd = rt.node;
    Object.assign(env, rt.nodeEnv ?? {});
    args = ['--permission', `--allow-fs-read=${ws}`, `--allow-fs-write=${ws}`, `--max-old-space-size=${Math.max(32, o.memoryMb)}`, path.join(ws, '.runner.cjs')];
  } else {
    if (!rt.python) throw new Error('Python is not installed on this computer');
    if (isWin && !o.allowNetwork) throw new Error('Python cannot be sealed off on Windows without administrator rights, so it is off. Use JavaScript, or allow unsealed Python in Agents → Abilities.');
    cmd = rt.python;
    args = ['-I', '-B', path.join(ws, '.main.py')];
  }
  let isolation = lang === 'javascript' ? 'Node permission model (files only in the workspace, no programs)' : 'Python in its own workspace';
  if (platform === 'linux' && rt.unshare) {
    // A new user + mount (+ network) namespace: the home folders and removable media are covered by empty folders.
    const hide = ['/home', '/root', '/media', '/mnt', '/run/user'].map((d) => `[ -d ${d} ] && mount -t tmpfs -o size=1m tmpfs ${d}`).join('; ');
    const inner = [cmd, ...args].map(shQuote).join(' ');
    args = ['-r', '-m', ...(o.allowNetwork ? [] : ['-n']), '--propagation', 'private', 'sh', '-c', `${hide}; cd ${shQuote(ws)} && exec ${inner}`];
    cmd = 'unshare';
    isolation += o.allowNetwork ? '; home folders hidden' : '; no network; home folders hidden';
  } else if (platform === 'darwin' && rt.sandboxExec) {
    const profile = macProfile(ws, o.allowNetwork);
    args = ['-p', profile, cmd, ...args];
    cmd = '/usr/bin/sandbox-exec';
    isolation += o.allowNetwork ? '; files outside the workspace hidden' : '; no network; files outside the workspace hidden';
  } else if (!o.allowNetwork) {
    isolation += lang === 'javascript' ? '; no network objects in the program' : '';
  }
  return { cmd, args, env, isolation };
}

export function macProfile(ws: string, net: boolean): string {
  const q = (s: string) => JSON.stringify(s);
  return [
    '(version 1)',
    '(allow default)',
    ...(net ? [] : ['(deny network*)']),
    '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/root"))',
    `(allow file-read* (subpath ${q(ws)}))`,
    '(deny file-write*)',
    `(allow file-write* (subpath ${q(ws)}) (literal "/dev/null"))`,
    '(deny process-exec (with no-sandbox))',
  ].join(' ');
}

function shQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** files the program made in the workspace */
  files: { name: string; size: number; path: string }[];
  isolation: string;
  ms: number;
}

const CAP = 64 * 1024;

/** Runs code in a new workspace (optionally with copies of some files) and returns what it printed and wrote. */
export async function runSandboxed(lang: Lang, code: string, o: SandboxOptions, rt: Runtimes, inputs: { name: string; data: Buffer }[] = [], platform: NodeJS.Platform = process.platform): Promise<RunOutput> {
  const ws = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-run-')));
  for (const f of inputs) await fsp.writeFile(path.join(ws, path.basename(f.name)), f.data);
  if (lang === 'javascript') {
    await fsp.writeFile(path.join(ws, '.main.js'), code);
    await fsp.writeFile(path.join(ws, '.runner.cjs'), JS_RUNNER);
  } else {
    await fsp.writeFile(path.join(ws, '.main.py'), code);
  }
  const before = new Set(await fsp.readdir(ws));
  const c = buildCommand(platform, lang, ws, o, rt);
  const t0 = Date.now();
  // Linux refuses to start a program file another process still has open for writing (ETXTBSY),
  // e.g. one written a moment ago: wait briefly and try again.
  let child: ReturnType<typeof spawn>;
  for (let attempt = 0; ; attempt++) {
    try {
      child = spawn(c.cmd, c.args, { cwd: ws, env: c.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: platform !== 'win32' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ETXTBSY' || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
  return new Promise<RunOutput>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout!.on('data', (d) => { if (stdout.length < CAP) stdout += d; });
    child.stderr!.on('data', (d) => { if (stderr.length < CAP) stderr += d; });
    const kill = () => {
      try {
        if (platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1, o.timeoutSec) * 1000);
    const done = async (exitCode: number | null) => {
      clearTimeout(timer);
      const files: RunOutput['files'] = [];
      for (const n of await fsp.readdir(ws).catch(() => [] as string[])) {
        if (before.has(n) || n.startsWith('.')) continue;
        const st = await fsp.stat(path.join(ws, n)).catch(() => null);
        if (st?.isFile()) files.push({ name: n, size: st.size, path: path.join(ws, n) });
      }
      resolve({ stdout: stdout.slice(0, CAP), stderr: stderr.slice(0, CAP), exitCode, timedOut, files, isolation: c.isolation, ms: Date.now() - t0 });
    };
    child.on('error', (e) => { stderr += String(e.message); void done(null); });
    child.on('close', (code) => void done(code));
  });
}

/** Removes an old workspace (the caller keeps it until the person has seen the files). */
export async function removeWorkspace(dir: string): Promise<void> {
  if (!path.basename(dir).startsWith('keeper-run-')) return;
  await fsp.rm(dir, { recursive: true, force: true });
}
