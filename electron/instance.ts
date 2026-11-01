// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One Keeper per person, whichever copy is started. Electron's own lock is per
// data folder, so an installed Keeper, a development build and a downloaded
// copy could all run side by side. This lock lives in one fixed place per
// person (not in the data folder) and is keyed on Keeper's identity:
//
//   the first Keeper writes instance.json (its pid) and listens on a local
//   socket (a named pipe on Windows); a later start finds a live pid, hands
//   its command line (keeper:// links, files to open) to the first through
//   the socket, and quits. A pid that is gone, or a socket nobody answers,
//   is stale: the new start takes over.
//
// Mac test runs (KEEPER_MACTEST_HOME) have a lock of their own, so a test never
// meets the owner's real Keeper, and they are named "Keeper (test)".
//
// The crash watchdog uses the same lock: if a Keeper is already running (the
// person or macOS restarted it), it does not start another.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const APP_ID = 'io.github.ashfordeou.keeper';

export interface InstancePaths { dir: string; file: string; socket: string }

/** Where the lock lives for this person (and, for test runs, for this test home). */
export function instancePaths(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir(), uid = process.getuid?.() ?? 0): InstancePaths {
  // The platform asked about decides the path style (tests ask about macOS from Windows too).
  const P = platform === 'win32' ? path.win32 : path.posix;
  const test = env.KEEPER_MACTEST_HOME && P.isAbsolute(env.KEEPER_MACTEST_HOME) ? env.KEEPER_MACTEST_HOME : '';
  const key = crypto.createHash('sha256').update(`${APP_ID}\u0000${test ? `test:${test}` : `home:${home}`}`).digest('hex').slice(0, 16);
  let dir: string;
  if (platform === 'win32') dir = P.join(env.LOCALAPPDATA || P.join(home, 'AppData', 'Local'), 'Keeper', 'instance');
  else if (platform === 'darwin') dir = test ? P.join(test, 'Library', 'Caches', APP_ID) : P.join(home, 'Library', 'Caches', APP_ID);
  else dir = P.join(env.XDG_RUNTIME_DIR || P.join(os.tmpdir(), `keeper-${uid}`), 'keeper-instance');
  // Unix socket paths are limited to about 100 bytes: keep the socket short, in the temporary folder when needed.
  const sockDir = platform === 'win32' ? '' : (P.join(dir, `keeper-${key}.sock`).length < 100 ? dir : os.tmpdir());
  const socket = platform === 'win32' ? `\\\\.\\pipe\\keeper-${key}` : P.join(sockDir, `keeper-${key}.sock`);
  return { dir, file: P.join(dir, `instance-${key}.json`), socket };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The pid of the Keeper holding the lock, if it is still running. */
export function runningInstance(p: InstancePaths = instancePaths()): number | undefined {
  try {
    const r = JSON.parse(fs.readFileSync(p.file, 'utf8')) as { pid?: number };
    return r.pid && r.pid !== process.pid && alive(r.pid) ? r.pid : undefined;
  } catch {
    return undefined;
  }
}

/** What a later start sends to the first one. */
export interface Handover { argv: string[]; cwd: string }

/**
 * A short Node program (run with Keeper's own runtime as plain Node) that
 * hands the command line over and says whether the first Keeper took it.
 * Synchronous on purpose: the decision has to be made before the app is ready.
 */
const CLIENT = `const net = require('net'); const [sock, msg] = process.argv.slice(-2);
const c = net.connect(sock); let done = false; const end = (code) => { if (!done) { done = true; c.destroy(); process.exit(code); } };
c.on('connect', () => c.write(msg + '\\n')); c.on('data', (d) => end(String(d).startsWith('ok') ? 0 : 1)); c.on('error', () => end(1)); setTimeout(() => end(1), 2500);`;

/** The program and arguments that hand `h` over (Keeper's runtime as plain Node). */
export function handOverCommand(p: InstancePaths, h: Handover): [string, string[]] {
  return [process.execPath, ['-e', CLIENT, p.socket, JSON.stringify(h)]];
}

export function handOver(p: InstancePaths, h: Handover): boolean {
  try {
    const [exe, args] = handOverCommand(p, h);
    execFileSync(exe, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', timeout: 4000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Before the app is ready: is another Keeper already running for this person?
 * If so, this start's command line has been handed to it and the caller quits.
 */
export function anotherKeeperTookOver(argv = process.argv, p = instancePaths()): boolean {
  if (process.env.KEEPER_INSTANCE_LOCK === '0') return false;
  if (!runningInstance(p)) return false;
  return handOver(p, { argv, cwd: process.cwd() });
}

let server: net.Server | null = null;

/** Takes the lock and listens for later starts; `onStart` gets each one's command line. */
export function holdInstanceLock(onStart: (h: Handover) => void, p = instancePaths()) {
  if (process.env.KEEPER_INSTANCE_LOCK === '0' || server) return;
  try {
    fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(p.file, JSON.stringify({ pid: process.pid, exe: process.execPath, at: Date.now() }));
  } catch {
    return;
  }
  if (process.platform !== 'win32') try { fs.unlinkSync(p.socket); } catch { /* none left over */ }
  const s = net.createServer((c) => {
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', (d: string) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try {
        const h = JSON.parse(buf.slice(0, i)) as Handover;
        c.end('ok\n');
        if (Array.isArray(h.argv)) onStart(h);
      } catch {
        c.end('no\n');
      }
    });
    c.on('error', () => undefined);
  });
  s.on('error', () => undefined);
  s.listen(p.socket, () => {
    if (process.platform !== 'win32') try { fs.chmodSync(p.socket, 0o600); } catch { /* best effort */ }
  });
  s.unref();
  server = s;
}

/** On a normal quit: let go of the lock (only if it is still ours). */
export function releaseInstanceLock(p = instancePaths()) {
  try {
    const r = JSON.parse(fs.readFileSync(p.file, 'utf8')) as { pid?: number };
    if (r.pid === process.pid) fs.rmSync(p.file, { force: true });
  } catch {
    /* gone already */
  }
  server?.close();
  server = null;
}
