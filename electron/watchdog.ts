// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's watchdog: a few kilobytes of plain Node, started by Keeper and left
// running beside it. It does nothing but check every few seconds whether
// Keeper is still there. If Keeper stops without quitting (a crash, the system
// killing it), the watchdog starts it again, so windows, tabs, terminals and
// sessions come back. After three such stops in five minutes it starts Keeper
// in safe mode (only the library on) instead of looping.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, fstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const { pid, dir, cmd, instance } = JSON.parse(process.argv[2] ?? '{}') as { pid: number; dir: string; cmd: string[]; instance?: string };
if (!pid || !dir || !cmd?.length) process.exit(0);

// Chromium does not mark its sockets close-on-exec, so this process inherits Keeper's (its
// debugging and IPC sockets). Holding them would keep ports a restarted Keeper needs: close
// every inherited socket now. Node's own descriptors are not sockets.
for (let fd = 3; fd < 1024; fd++) {
  try {
    if (fstatSync(fd).isSocket()) closeSync(fd);
  } catch {
    /* not open */
  }
}

const alive = (p: number) => {
  try {
    process.kill(p, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Keeper writes its pid here while running and clears it on a normal quit. */
function stillOurs(): 'running' | 'quit' | 'other' {
  try {
    const r = JSON.parse(readFileSync(path.join(dir, 'running.json'), 'utf8')) as { pid: number } | null;
    if (!r) return 'quit';
    return r.pid === pid ? 'running' : 'other';
  } catch {
    return 'quit';
  }
}

/** The pid in the one-per-person lock, when that Keeper is alive and is not the one that stopped. */
function otherKeeper(): number | undefined {
  if (!instance) return undefined;
  try {
    const r = JSON.parse(readFileSync(instance, 'utf8')) as { pid?: number };
    return r.pid && r.pid !== pid && alive(r.pid) ? r.pid : undefined;
  } catch {
    return undefined;
  }
}

function crashesInFiveMinutes(): number {
  try {
    const t = JSON.parse(readFileSync(path.join(dir, 'crashes.json'), 'utf8')) as number[];
    return t.filter((x) => Date.now() - x < 5 * 60_000).length;
  } catch {
    return 0;
  }
}

function log(detail: string) {
  try {
    const f = path.join(dir, 'log.jsonl');
    let lines: string[] = [];
    try { lines = readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { /* new */ }
    lines.push(JSON.stringify({ at: Date.now(), kind: 'watchdog', detail }));
    writeFileSync(f, lines.slice(-200).join('\n') + '\n');
  } catch { /* best-effort */ }
}

function commandOf(p: number): string {
  try {
    if (process.platform === 'linux') return readFileSync(`/proc/${p}/comm`, 'utf8').trim().toLowerCase();
    if (process.platform === 'darwin') return path.basename(execFileSync('ps', ['-p', String(p), '-o', 'comm='], { encoding: 'utf8' }).trim()).toLowerCase();
    return '';
  } catch {
    return '';
  }
}

function stopLeftovers() {
  let list: { pid: number; name: string }[] = [];
  try { list = JSON.parse(readFileSync(path.join(dir, 'helpers.json'), 'utf8')); } catch { return; }
  let stopped = 0;
  for (const h of list) {
    if (!h.pid || !alive(h.pid)) continue;
    // Never stop an unrelated program that happens to have reused the number.
    const now = commandOf(h.pid);
    const want = h.name.replace(/\.exe$/, '');
    if (process.platform !== 'win32' && (!now || !(now.startsWith(want.slice(0, 15)) || want.startsWith(now)))) continue;
    try { process.kill(h.pid, 'SIGKILL'); stopped++; } catch { /* already gone */ }
  }
  try { writeFileSync(path.join(dir, 'helpers.json'), '[]'); } catch { /* best-effort */ }
  if (stopped) log(`stopped ${stopped} helper program(s) the stopped Keeper had left running`);
}

const timer = setInterval(() => {
  if (alive(pid)) return;
  clearInterval(timer);
  const state = stillOurs();
  // Quit normally, or another Keeper has already taken over: nothing to do.
  if (state !== 'running') process.exit(0);
  // Any copy of Keeper already running for this person (restarted by them, or by macOS) holds the
  // one-per-person lock (electron/instance.ts): never start a second one.
  const other = otherKeeper();
  if (other) {
    log(`Keeper (pid ${pid}) stopped unexpectedly; another Keeper (pid ${other}) is already running, so it is not started again`);
    process.exit(0);
  }
  // Helpers Keeper started (watchers, ffmpeg, the cloud daemon…) would otherwise linger,
  // holding files and ports; stop the ones that are still the same programs.
  stopLeftovers();
  // The crash itself is counted by the new Keeper when it starts; this one is the third or more?
  const safe = crashesInFiveMinutes() >= 2;
  log(`Keeper (pid ${pid}) stopped unexpectedly; starting it again${safe ? ' in safe mode after repeated crashes' : ''}`);
  const [exe, ...args] = cmd;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    spawn(exe, [...args.filter((a) => a !== '--safe-mode'), ...(safe ? ['--safe-mode'] : [])], { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
  } catch (e) {
    log(`could not start Keeper again: ${(e as Error).message}`);
  }
  setTimeout(() => process.exit(0), 500);
}, 3000);
