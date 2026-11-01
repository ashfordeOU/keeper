// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's mesh helper: the only part of Keeper Mesh that runs as the
// administrator (Linux and macOS). Plain Node, bundled on its own as
// dist-electron/mesh-helper.cjs and run with Keeper's own runtime.
//
//   Linux  started by pkexec when the mesh is turned on (one password prompt)
//          or directly when Keeper already runs as root
//   macOS  installed once as a LaunchDaemon through the administrator dialog
//          (see native/macos/mesh-helper.plist)
//
// It listens on a Unix socket that only the person who started Keeper can
// open, and runs only steps that plan-guard.ts allows: Keeper's own
// interfaces, tables, anchors, DNS files and forwarding switches. It keeps
// the cleanup plan Keeper gives it on disk, and runs it when Keeper's process
// is gone (a crash, a kill, power loss before the next start), so DNS, routes
// and the kill switch never stay behind and cut the computer off.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkStep, hostsChangeAllowed, type GuardOpts } from '../../../core/mesh/plan-guard';
import { withHostsBlock, type Step } from '../../../core/mesh/os-plan';

const SAFE_PATH = '/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/sbin:/usr/local/bin:/opt/homebrew/bin';

export interface StepResult {
  ok: boolean;
  message: string;
  outputs: string[];
}

/** Writes a UAPI request to wireguard-go's control socket. */
function uapi(iface: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(`/var/run/wireguard/${iface}.sock`);
    let out = '';
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error('wireguard-go did not answer'));
    }, 5000);
    s.on('connect', () => s.write(body));
    s.on('data', (d) => {
      out += d.toString();
      if (/\n\n$/.test(out)) {
        clearTimeout(t);
        s.end();
        const errno = out.match(/errno=(-?\d+)/);
        if (errno && errno[1] !== '0') reject(new Error(`wireguard-go refused the configuration (errno ${errno[1]})`));
        else resolve(out);
      }
    });
    s.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/** Waits for wireguard-go's control socket after starting it. */
async function waitForSocket(iface: string, ms = 4000) {
  const p = `/var/run/wireguard/${iface}.sock`;
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (existsSync(p)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('wireguard-go did not start');
}

/** Lets a caller run the same steps somewhere else (the network-namespace test runs them in a namespace). */
export type Wrap = (file: string, args: string[]) => [string, string[]];

function exec(s: Step, wrap?: Wrap): Promise<{ code: number; out: string; err: string }> {
  let args = s.args;
  let input = s.stdin ?? '';
  let tmp: string | undefined;
  // Some nft builds refuse "-f -" from a pipe ("Not a regular file: /dev/stdin"): give it a private file instead.
  if (s.file === 'nft' && args[0] === '-f' && args[1] === '-') {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'keeper-nft-'));
    writeFileSync(path.join(tmp, 'rules.nft'), input, { mode: 0o600 });
    args = ['-f', path.join(tmp, 'rules.nft')];
    input = '';
  }
  const [file, argv] = wrap ? wrap(s.file, args) : [s.file, args];
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const c = spawn(file, argv, { env: { PATH: SAFE_PATH, ...(s.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', (e) => resolve({ code: 127, out, err: e.message }));
    c.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    c.stdin.on('error', () => undefined);
    c.stdin.end(input);
  }).finally(() => tmp && rmSync(tmp, { recursive: true, force: true }));
}

/** Runs steps in order, each checked by the guard first. Stops at the first real failure. */
function readHosts(): string {
  try {
    return readFileSync('/etc/hosts', 'utf8');
  } catch {
    return '';
  }
}

export async function runSteps(steps: Step[], guard: GuardOpts, wrap?: Wrap): Promise<StepResult> {
  const outputs: string[] = [];
  for (let s of steps) {
    let why = checkStep(s, guard);
    if (!why && s.file === 'tee' && s.args[0] === '/etc/hosts') {
      const now = readHosts();
      why = hostsChangeAllowed(now, s.stdin ?? '');
      // A cleanup written earlier may predate other edits: taking Keeper's block out is always safe.
      if (why && s.ignoreError) {
        s = { ...s, stdin: withHostsBlock(now, []) };
        why = null;
      }
    }
    if (why) return { ok: false, message: `Refused: ${why}`, outputs };
    try {
      if (s.file === 'uapi') {
        outputs.push(await uapi(s.args[0], s.stdin ?? ''));
        continue;
      }
      const r = await exec(s, wrap);
      outputs.push(r.out);
      if (r.code !== 0 && !s.ignoreError) return { ok: false, message: (r.err || r.out).trim().slice(0, 400) || `${s.file} failed`, outputs };
      if (guard.wgGo && s.file === guard.wgGo && r.code === 0) await waitForSocket(s.args[0]);
    } catch (e) {
      if (!s.ignoreError) return { ok: false, message: (e as Error).message, outputs };
    }
  }
  return { ok: true, message: 'Done', outputs };
}

const sha256 = (p: string) => crypto.createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * Puts a verified copy of wireguard-go where only the administrator can
 * change it, and returns its path. The copy is checked again before use, so
 * swapping the file Keeper downloaded changes nothing.
 */
export function installWireguardGo(src: string, expect: string, stateDir: string): string {
  const bin = path.join(stateDir, 'bin');
  mkdirSync(bin, { recursive: true, mode: 0o755 });
  const dst = path.join(bin, 'wireguard-go');
  if (existsSync(dst) && sha256(dst) === expect) return dst;
  const tmp = `${dst}.${process.pid}`;
  copyFileSync(src, tmp);
  if (sha256(tmp) !== expect) {
    rmSync(tmp, { force: true });
    throw new Error('wireguard-go does not match its pinned checksum');
  }
  chmodSync(tmp, 0o755);
  renameSync(tmp, dst);
  return dst;
}

// ---------------------------------------------------------------- the helper program

interface Args {
  /** the person's user id: the socket is theirs alone */
  uid: number;
  /** Keeper's process: when it is gone, the cleanup plan runs (a daemon learns it from "attach") */
  pid?: number;
  /** macOS LaunchDaemon: keeps running, waits for the next Keeper */
  daemon?: boolean;
  socket: string;
  state: string;
  os: 'linux' | 'darwin';
  wgGo?: { path: string; sha256: string };
  wg?: string;
}

async function main(a: Args) {
  if (process.getuid?.() !== 0) throw new Error('The mesh helper must run as the administrator');
  mkdirSync(a.state, { recursive: true, mode: 0o700 });
  const guard: GuardOpts = { os: a.os, wg: a.wg };
  if (a.wgGo) guard.wgGo = installWireguardGo(a.wgGo.path, a.wgGo.sha256, a.state);
  const planFile = path.join(a.state, `cleanup-${a.uid}.json`);
  let watched = a.pid;
  const readPlan = (): Step[] => {
    try {
      return JSON.parse(readFileSync(planFile, 'utf8')) as Step[];
    } catch {
      return [];
    }
  };
  // a plan left from a Keeper that stopped without cleaning up: run it now
  const left = readPlan();
  if (left.length) await runSteps(left.map((s) => ({ ...s, ignoreError: true })), guard);
  rmSync(planFile, { force: true });

  rmSync(a.socket, { force: true });
  const server = net.createServer((c) => {
    let buf = '';
    c.on('data', async (d) => {
      buf += d.toString();
      if (buf.length > 4_000_000) return c.destroy();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let req: { id: number; op: string; steps?: Step[] };
        try {
          req = JSON.parse(line);
        } catch {
          continue;
        }
        let res: { id: number; ok: boolean; message: string; outputs?: string[] };
        if (req.op === 'run') res = { id: req.id, ...(await runSteps(req.steps ?? [], guard)) };
        else if (req.op === 'cleanup') {
          // only steps the guard allows are kept, so a stored plan can never do more than a live one
          const bad = (req.steps ?? []).map((s) => checkStep(s, guard)).find(Boolean);
          if (bad) res = { id: req.id, ok: false, message: `Refused: ${bad}` };
          else {
            if (req.steps?.length) writeFileSync(planFile, JSON.stringify(req.steps), { mode: 0o600 });
            else rmSync(planFile, { force: true });
            res = { id: req.id, ok: true, message: 'kept' };
          }
        } else if (req.op === 'ping') res = { id: req.id, ok: true, message: 'pong' };
        else if (req.op === 'quit') {
          c.end(JSON.stringify({ id: req.id, ok: true, message: 'bye' }) + '\n');
          return shutdown(false);
        } else res = { id: req.id, ok: false, message: 'unknown request' };
        c.write(JSON.stringify(res) + '\n');
      }
    });
    c.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(a.socket, () => r()));
  chownSync(a.socket, a.uid, -1);
  chmodSync(a.socket, 0o600);

  let stopping = false;
  async function shutdown(runPlan: boolean) {
    if (stopping) return;
    stopping = true;
    if (runPlan) {
      const plan = readPlan();
      if (plan.length) await runSteps(plan.map((s) => ({ ...s, ignoreError: true })), guard);
    }
    rmSync(planFile, { force: true });
    if (a.daemon && runPlan) {
      // the LaunchDaemon stays for the next time Keeper starts
      watched = undefined;
      stopping = false;
      return;
    }
    server.close();
    rmSync(a.socket, { force: true });
    process.exit(0);
  }
  // The watchdog: Keeper gone without cleaning up → put DNS, routes and the kill switch back.
  setInterval(() => {
    if (!watched) return;
    try {
      process.kill(watched, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') void shutdown(true);
    }
  }, 2000);
  process.on('SIGTERM', () => void shutdown(true));
}

if (typeof require !== 'undefined' && require.main === module && process.argv[2]) {
  main(JSON.parse(process.argv[2]) as Args).catch((e) => {
    process.stderr.write(String(e?.message ?? e) + '\n');
    process.exit(1);
  });
}
