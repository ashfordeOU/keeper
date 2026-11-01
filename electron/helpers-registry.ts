// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The helper programs Keeper starts that must not outlive it (watchers, ffmpeg,
// the cloud-storage daemon, PowerShell hosts…). Their process ids are kept in
// a small file so that, if Keeper is ever killed outright, the watchdog can
// stop what was left behind before it starts Keeper again. (A helper left
// running would keep files, ports and memory for nothing.) The terminal host
// is not listed: it is meant to keep terminals running.

import { app } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const live = new Map<number, string>();
let timer: NodeJS.Timeout | undefined;

const file = () => path.join(app.getPath('userData'), 'session', 'helpers.json');

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      mkdirSync(path.dirname(file()), { recursive: true });
      const tmp = `${file()}.tmp`;
      writeFileSync(tmp, JSON.stringify([...live].map(([pid, name]) => ({ pid, name }))));
      renameSync(tmp, file());
    } catch {
      /* best-effort */
    }
  }, 200);
  timer.unref?.();
}

/** Remembers a helper until it exits. */
export function trackHelper(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  live.set(pid, path.basename(String(child.spawnfile || '')).toLowerCase());
  save();
  child.once('exit', () => {
    live.delete(pid);
    save();
  });
}

/** Helper programs running right now, with their names. */
export function liveHelpers(): { pid: number; name: string }[] {
  return [...live].map(([pid, name]) => ({ pid, name }));
}

// Watchers and daemons that run for as long as their feature is on; they are not jobs.
const STANDING = /^(xprop|osascript|powershell(\.exe)?|pwsh(\.exe)?|rclone(\.exe)?)$/;

/** Helper programs doing a job right now (converting, recognising text, scanning…), not standing watchers. */
export function jobHelpers(): { pid: number; name: string }[] {
  return liveHelpers().filter((h) => !STANDING.test(h.name));
}
