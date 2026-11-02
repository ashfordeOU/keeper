// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's processes, for System → Keeper's processes: the main process, each
// window, the GPU process, the service processes, the terminal session host and
// helpers — with Stop, Restart and "Stop all background work now".

import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import { readFileSync } from 'node:fs';
import type { KeeperProcess } from '../../core/api-session';
import { run } from '../../core/platform';
import { holdAllWork, resumeAllWork, workHeldUntil } from '../services/governor';
import { terminalHostPid } from '../services/terminal';
import { allHosts, onHostRestarted, onHostsChanged } from './host';
import { logEvent } from '../resilience';
import { limitsStatus, startLimits } from './limits';
import { listParts, restartPart } from '../suite/supervisor';
import type { PartRole } from '../../core/suite';

const broadcast = (channel: string, ...args: unknown[]) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, ...args);
};

/** Memory of a process Electron does not manage (the terminal host), read only while the page is open. */
async function rssOf(pid: number): Promise<number> {
  try {
    if (process.platform === 'linux') {
      const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)\s+kB/);
      return m ? Number(m[1]) * 1024 : 0;
    }
    if (process.platform === 'win32') {
      const r = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 3000);
      const kb = r.stdout.match(/"([\d.,\s]+) K"/)?.[1]?.replace(/[^\d]/g, '');
      return kb ? Number(kb) * 1024 : 0;
    }
    const r = await run('ps', ['-o', 'rss=', '-p', String(pid)], 3000);
    return Number(r.stdout.trim()) * 1024 || 0;
  } catch {
    return 0;
  }
}

function windowLabel(wcId: number): { label: string; detail?: string } {
  const wc = webContents.fromId(wcId);
  const url = wc?.getURL() ?? '';
  const view = url.match(/[?&]view=(\w+)/)?.[1] ?? 'app';
  const names: Record<string, string> = { app: 'Main window', island: 'Island', quick: 'Quick Search', clips: 'Clipboard picker', widget: 'Widget', terminal: 'Terminal window', screenhost: 'Screen sharing', screenviewer: 'Remote screen', capture: 'Capture' };
  const win = wc ? BrowserWindow.fromWebContents(wc) : null;
  const extra = url.match(/[?&]win=(\w+)/)?.[1];
  return { label: (names[view] ?? `Window (${view})`) + (extra ? ` · ${extra}` : ''), detail: win?.getTitle() };
}

export async function listProcesses(): Promise<KeeperProcess[]> {
  const out: KeeperProcess[] = [];
  const hosts = allHosts();
  const byPid = new Map(hosts.filter((h) => h.pid).map((h) => [h.pid!, h]));
  for (const m of app.getAppMetrics()) {
    const cpu = m.cpu?.percentCPUUsage ?? 0;
    const memory = (m.memory?.workingSetSize ?? 0) * 1024;
    const host = byPid.get(m.pid);
    if (host) continue;
    if (m.type === 'Browser') out.push({ id: 'main', label: 'Keeper (main process)', kind: 'main', pid: m.pid, state: 'running', cpu, memory, startedAt: m.creationTime, canStop: false, canRestart: true, detail: 'Coordinates everything else; Restart quits and opens Keeper again, with your tabs.' });
    else if (m.type === 'Tab') {
      const wc = webContents.getAllWebContents().find((w) => w.getOSProcessId() === m.pid);
      const { label, detail } = wc ? windowLabel(wc.id) : { label: 'Window', detail: undefined };
      out.push({ id: `window:${wc?.id ?? m.pid}`, label, kind: 'window', pid: m.pid, state: 'running', cpu, memory, startedAt: m.creationTime, canStop: false, canRestart: !!wc, detail: detail ? `${detail} · Restart reloads it with its tabs` : 'Restart reloads it with its tabs' });
    } else if (m.type === 'GPU') out.push({ id: 'gpu', label: 'Graphics', kind: 'gpu', pid: m.pid, state: 'running', cpu, memory, startedAt: m.creationTime, canStop: false, canRestart: false, detail: 'Draws Keeper’s windows; the system restarts it if it fails.' });
    else out.push({ id: `helper:${m.pid}`, label: m.serviceName || m.name || m.type, kind: m.type === 'Utility' ? 'utility' : 'helper', pid: m.pid, state: 'running', cpu, memory, startedAt: m.creationTime, canStop: false, canRestart: false });
  }
  const metrics = new Map(app.getAppMetrics().map((m) => [m.pid, m]));
  for (const h of hosts) {
    const m = h.pid ? metrics.get(h.pid) : undefined;
    out.push({
      id: `svc:${h.opts.name}`, label: h.opts.label, kind: 'service', pid: h.pid, state: h.pid ? 'running' : h.state === 'crashed' ? 'crashed' : 'idle',
      cpu: m?.cpu?.percentCPUUsage ?? 0, memory: (m?.memory?.workingSetSize ?? 0) * 1024, startedAt: h.pid ? h.startedAt : undefined,
      restarts: h.restarts, lastCrash: h.lastCrash, feature: h.opts.feature, canStop: !!h.pid, canRestart: true,
      detail: h.pid ? 'Runs on its own: if it stops, the rest of Keeper carries on and it starts again.' : 'Not running: it starts when needed and stops after a quiet while.',
    });
  }
  // The suite's parts (the Island, widgets) in processes of their own: all of each part's processes together.
  for (const p of await listParts()) {
    if (!p.separate) continue;
    out.push({
      id: `part:${p.id}`, label: p.name, kind: 'service', pid: p.pid, state: p.state === 'running' ? 'running' : p.state === 'starting' ? 'starting' : p.state === 'waiting' || p.state === 'failed' ? 'crashed' : 'stopped',
      cpu: p.cpu, memory: p.memory, startedAt: p.startedAt, restarts: p.restarts, lastCrash: p.lastCrash, feature: p.feature, canStop: false, canRestart: p.wanted,
      detail: p.state === 'failed' ? 'Stopped after crashing again and again; Restart tries once more.' : `Its own Keeper process${p.processes > 1 ? ` (and ${p.processes - 1} helper${p.processes > 2 ? 's' : ''})` : ''}: it stays when the main window stops, and starts again if it stops.`,
    });
  }
  const tpid = terminalHostPid();
  if (tpid) out.push({ id: 'terminal-host', label: 'Terminal sessions', kind: 'service', pid: tpid, state: 'running', cpu: 0, memory: await rssOf(tpid), feature: 'terminal', canStop: false, canRestart: false, detail: 'Keeps your terminals running when Keeper’s windows close, and after a crash.' });
  return out;
}

export function registerSvcIpc() {
  onHostsChanged(() => broadcast('svc-changed'));
  onHostRestarted((_name, label, reason) => {
    logEvent('service-restarted', `${label}: ${reason}`);
    broadcast('resilience', { kind: 'service-restarted', name: label, reason });
  });
  ipcMain.handle('svc.list', () => listProcesses());
  ipcMain.handle('svc.stop', async (_e, id: string) => {
    const h = allHosts().find((x) => `svc:${x.opts.name}` === id);
    if (h) await h.stop(true);
    return listProcesses();
  });
  ipcMain.handle('svc.restart', async (_e, id: string) => {
    if (id === 'main') {
      app.relaunch();
      app.quit();
      return [];
    }
    if (id.startsWith('window:')) webContents.fromId(Number(id.slice(7)))?.reload();
    if (id.startsWith('part:')) restartPart(id.slice(5) as PartRole);
    const h = allHosts().find((x) => `svc:${x.opts.name}` === id);
    if (h) await h.restart().catch(() => undefined);
    return listProcesses();
  });
  ipcMain.handle('svc.held', () => workHeldUntil());
  ipcMain.handle('svc.limits', () => limitsStatus());
  app.whenReady().then(() => startLimits()).catch(() => undefined);
  ipcMain.handle('svc.stopAllWork', async (_e, resume?: boolean) => {
    if (resume) {
      resumeAllWork();
      return { stopped: [], heldUntil: 0 };
    }
    // Everything that runs in the background goes through the governor: holding it stops
    // indexing, reading text, meaning search, sync, backups and every regular check.
    holdAllWork(60 * 60_000);
    const stopped = ['indexing and reading text', 'meaning search', 'sync and backups', 'regular checks'];
    for (const h of allHosts()) if (h.pid) { await h.stop(true); stopped.push(h.opts.label); }
    logEvent('stop-all', `background work stopped by the person: ${stopped.join(', ')}`);
    broadcast('svc-changed');
    return { stopped, heldUntil: workHeldUntil() };
  });
}
