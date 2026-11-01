// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC, AI abilities and command-line methods for the system monitor: live
// readings, long-term history, dev servers, running agents, sensors, process
// extras, menu-bar readings and the tool launcher.

import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { registerAbility } from '../../core/abilities/registry';
import type { RunningAgent, SysmonResult } from '../../core/api-sysmon';
import { restartPlan } from '../../core/monitor-devservers';
import { ancestors, redactEnv } from '../../core/monitor-procinfo';
import { metricText, TRAY_METRICS, type MonitorSettings } from '../../core/monitor-tray';
import { canEnd } from '../../core/procs';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { killTree } from '../services/monitor';
import { clearHistory, historyCsv, historyView } from '../services/monitor-history';
import { initLauncher, launcherShortcutActive, openTool, openToolWindows, recentTools, standardOutput, toggleLauncher, type LauncherDeps } from '../services/monitor-launcher';
import { liveState, unwatchLive, watchLive } from '../services/monitor-live';
import { codeSignature, devServers, listeners, processEnv, readSensors, runningAgents, usePowerShell } from '../services/monitor-probe';
import { monitorSettings, setMonitorSettings } from '../services/monitor-settings';
import { initMonitorTray, togglePopover, trayPreview, trayState, type TrayDeps } from '../services/monitor-tray';
import { psRun } from '../services/ps-host';
import { containerAction, containers, energy, mixer, setAppNap, setOutput, setStream, useExtrasPowerShell } from '../services/monitor-extras';
import { allTabs } from '../services/browser-tabs';
import { CONTAINER_ACTIONS, type ContainerAction } from '../../core/monitor-containers';
import { act, details, sample } from '../services/procs';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const str = (v: unknown, n = 300) => String(v ?? '').slice(0, n);
const inside = (dir: string | undefined, roots: string[]) => !!dir && roots.some((r) => r && (dir === r || dir.startsWith(r.endsWith(path.sep) ? r : r + path.sep)));

async function cpuByPid(): Promise<Map<number, number>> {
  const s = await sample({ disk: false });
  return new Map(s.procs.map((p) => [p.pid, p.cpu]));
}

export async function agentsNow(): Promise<RunningAgent[]> {
  const s = await sample({ disk: false });
  return runningAgents(s.procs);
}

async function stopPids(root: number, label: string): Promise<SysmonResult> {
  const s = await sample({ disk: false });
  const p = s.procs.find((x) => x.pid === root);
  if (!p) return { ok: false, message: `${label} is no longer running.` };
  const allowed = canEnd(p, process.platform, process.pid);
  if (!allowed.ok) return { ok: false, message: allowed.reason ?? 'Keeper will not stop this process.' };
  const n = await killTree(root);
  return n ? { ok: true, message: `Stopped ${label}${n > 1 ? ` and ${n - 1} process${n > 2 ? 'es' : ''} it started` : ''}.`, stopped: n } : { ok: false, message: `Could not stop ${label}.` };
}

async function stopServer(pid: number): Promise<SysmonResult> {
  const ls = await listeners();
  const l = ls.find((x) => x.pid === pid);
  return stopPids(pid, l ? `${l.name} on port ${l.port}` : `process ${pid}`);
}

async function stopProject(root: string): Promise<SysmonResult> {
  const { projects } = await devServers({ all: true });
  const proj = projects.find((p) => p.root === root);
  if (!proj) return { ok: false, message: 'Nothing from this project is listening any more.' };
  let stopped = 0;
  const failed: string[] = [];
  for (const pid of new Set(proj.servers.map((s) => s.pid))) {
    const r = await stopPids(pid, `process ${pid}`);
    if (r.ok) stopped += r.stopped ?? 1;
    else failed.push(r.message);
  }
  return { ok: !failed.length, stopped, message: `Stopped ${stopped} process${stopped === 1 ? '' : 'es'} of ${proj.name}.${failed.length ? ` ${failed.join(' ')}` : ''}` };
}

async function restartServer(pid: number): Promise<SysmonResult> {
  const ls = await listeners();
  const l = ls.find((x) => x.pid === pid);
  if (!l) return { ok: false, message: 'This server is no longer listening.' };
  const plan = restartPlan(l);
  if ('error' in plan) return { ok: false, message: plan.error };
  const stopped = await stopPids(pid, `${l.name} on port ${l.port}`);
  if (!stopped.ok) return stopped;
  // Wait for the port to free up (at most five seconds) before starting it again.
  for (let i = 0; i < 20; i++) {
    if (!(await listeners()).some((x) => x.port === l.port)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    const child = spawn(plan.file, plan.args, { cwd: plan.cwd, detached: true, stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' });
    child.unref();
    return { ok: true, message: `Started ${l.name} again in ${path.basename(plan.cwd)} (port ${l.port}). Its output is not shown; start it from a terminal to see logs.` };
  } catch (e) {
    return { ok: false, message: `Stopped it, but could not start it again: ${(e as Error).message}` };
  }
}

async function stopAgentSession(pid: number): Promise<SysmonResult> {
  const a = (await agentsNow()).find((x) => x.pid === pid);
  if (!a) return { ok: false, message: 'This agent session has already ended.' };
  return stopPids(pid, `${a.label}${a.project ? ` in ${a.project}` : ''}`);
}

async function procExtras(pid: number, opts: { reveal?: boolean; revealSecrets?: boolean; signature?: boolean } = {}) {
  const s = await sample({ disk: false });
  const p = s.procs.find((x) => x.pid === pid);
  if (!p) return null;
  const [env, sig, ls] = await Promise.all([processEnv(pid), opts.signature !== false && p.path ? codeSignature(p.path) : Promise.resolve(undefined), listeners().catch(() => [])]);
  return {
    pid, parents: ancestors(pid, s.procs), env: 'vars' in env ? redactEnv(env.vars, opts) : undefined, envError: 'error' in env ? env.error : undefined,
    signature: sig, ports: [...new Set(ls.filter((l) => l.pid === pid).map((l) => l.port))].sort((a, b) => a - b),
  };
}

/** For the CLI and abilities: a short summary of the latest reading (one reading if nobody is watching). */
async function readingsNow() {
  let r = liveState().latest;
  if (!r) {
    watchLive('ask', 1000, ['gpu', 'temp', 'power']);
    await new Promise((res) => setTimeout(res, 1600));
    r = liveState().latest;
    unwatchLive('ask');
  }
  return r;
}

export type SysmonDeps = Omit<TrayDeps, 'openLauncher'> & Pick<LauncherDeps, 'devUrl'>;

export function registerSysmonIpc(d: SysmonDeps) {
  // Windows: questions go to the PowerShell that stays open.
  if (process.platform === 'win32') {
    usePowerShell(psRun);
    useExtrasPowerShell(psRun);
  }
  initMonitorTray({ ...d, openLauncher: toggleLauncher });
  initLauncher({ preload: d.preload, lockDown: d.lockDown, showMain: d.showMain, devUrl: d.devUrl });

  // Live readings for a window: start while it looks, stop when it closes or hides.
  const watching = new Set<number>();
  ipcMain.handle('sysmon.watch', (e, on: boolean) => {
    const wc: WebContents = e.sender;
    const id = `wc:${wc.id}`;
    if (on) {
      watchLive(id, 1000, ['gpu', 'temp', 'power', 'battery']);
      if (!watching.has(wc.id)) {
        watching.add(wc.id);
        wc.once('destroyed', () => {
          watching.delete(wc.id);
          unwatchLive(id);
        });
      }
    } else unwatchLive(id);
    return liveState();
  });
  handle('sysmon.live', () => liveState());
  handle('sysmon.history', (from: number, to: number, maxPoints?: number) => historyView(Number(from), Number(to), maxPoints));
  ipcMain.handle('sysmon.exportCsv', async (e, from: number, to: number) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const name = `Keeper health ${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}.csv`;
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'CSV', extensions: ['csv'] }] }) : await dialog.showSaveDialog({ defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, historyCsv(from, to));
    return r.filePath;
  });
  handle('sysmon.clearHistory', () => clearHistory());
  handle('sysmon.devServers', async (all?: boolean) => ({ projects: (await devServers({ all: !!all, cpu: await cpuByPid() })).projects }));
  handle('sysmon.stopServer', (pid: number) => stopServer(Number(pid)));
  handle('sysmon.stopProject', (root: string) => stopProject(str(root, 4096)));
  handle('sysmon.restartServer', (pid: number) => restartServer(Number(pid)));
  handle('sysmon.agents', () => agentsNow());
  handle('sysmon.stopAgentSession', (pid: number) => stopAgentSession(Number(pid)));
  handle('sysmon.sensors', () => readSensors());
  handle('sysmon.procExtras', (pid: number, opts?: { reveal?: boolean; revealSecrets?: boolean; signature?: boolean }) => procExtras(Number(pid), opts));
  handle('sysmon.settings', () => monitorSettings());
  handle('sysmon.setSettings', (patch: Partial<MonitorSettings>) => setMonitorSettings(patch));
  handle('sysmon.trayPreview', () => trayPreview());
  handle('sysmon.trayState', () => ({ ...trayState(), launcherShortcut: launcherShortcutActive(), toolWindows: openToolWindows() }));
  handle('sysmon.showPopover', () => togglePopover());
  handle('sysmon.containers', () => (featureOn('containers') ? containers() : { engine: null, containers: [], disk: [], note: 'Containers are switched off.' }));
  handle('sysmon.containerAction', (id: string, action: ContainerAction) => containerAction(str(id, 128), action));
  handle('sysmon.mixer', () => mixer());
  handle('sysmon.setStream', (id: string, patch: { volume?: number; muted?: boolean }) => setStream(str(id, 20), { volume: typeof patch?.volume === 'number' ? patch.volume : undefined, muted: typeof patch?.muted === 'boolean' ? patch.muted : undefined }));
  handle('sysmon.setOutput', (name: string) => setOutput(str(name, 200)));
  handle('sysmon.energy', () => energy());
  handle('sysmon.setAppNap', (id: string, allowed: boolean) => setAppNap(str(id, 200), !!allowed));
  handle('sysmon.tabs', () => tabsView());
  handle('sysmon.openLauncher', () => toggleLauncher());
  handle('sysmon.openTool', (id: string) => openTool(str(id, 200)));
  handle('sysmon.recentTools', () => recentTools());
  ipcMain.handle('sysmon.closeWindow', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) w.hide();
  });
  handle('sysmon.outputPreview', () => standardOutput('Example') ?? '');

  // ---------------------------------------------------------------- the keeper command, while the app runs
  registerKeeperMethod('keeper/sysmon.history', (p) => historyView(Number(p.from) || Date.now() - 86_400_000, Number(p.to) || Date.now(), Number(p.max) || 600));
  registerKeeperMethod('keeper/sysmon.readings', () => readingsNow());

  registerAbilities();
}

function registerAbilities() {
  const off = (what: string) => ({ content: `${what} is switched off in Keeper (Settings → Features).`, summary: 'off', isError: true });
  registerAbility({
    name: 'system_readings', label: 'See live system readings', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Processor, memory, network, disk, graphics, temperature and power readings right now, in plain numbers.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'See how hard the computer is working right now',
  }, async () => {
    if (!featureOn('health')) return off('Health');
    const r = await readingsNow();
    if (!r) return { content: 'No reading yet', summary: 'none', isError: true };
    const s = monitorSettings().tray;
    const lines = TRAY_METRICS.map((m) => `${m.label}: ${metricText(m.id, r, s)}`);
    return { content: lines.join('\n'), summary: `CPU ${Math.round(r.cpu)}%` };
  });
  registerAbility({
    name: 'health_history', label: 'See health history', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Peaks and the apps that worked hardest over a past period (up to a year): processor, memory, network, disk, graphics, power. `hours` back from now, default 24.',
    parameters: { type: 'object', properties: { hours: { type: 'number' } } },
    describe: (a) => `See the last ${Number(a.hours) || 24} hours of health history`,
  }, async (a) => {
    if (!featureOn('monitorHistory')) return off('Long-term history');
    const h = Math.min(24 * 366, Math.max(1, Number(a.hours) || 24));
    const v = historyView(Date.now() - h * 3600_000, Date.now(), 200);
    return { content: JSON.stringify({ peaks: v.peaks.map((p) => ({ ...p, at: new Date(p.t).toISOString() })), topApps: v.top, resolution: v.tier }), summary: `${v.points.length} points` };
  });
  registerAbility({
    name: 'dev_servers', label: 'See dev servers and ports', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Listening ports grouped by project folder (git root): server kind, port, process id, address, whether it is idle and its link.',
    parameters: { type: 'object', properties: { all: { type: 'boolean', description: 'include system services, not only dev servers' } } },
    describe: () => 'See dev servers and listening ports',
  }, async (a) => {
    if (!featureOn('devServers')) return off('Dev servers');
    const { projects } = await devServers({ all: !!a.all });
    return { content: JSON.stringify(projects.map((p) => ({ project: p.name, folder: p.root, servers: p.servers.map((s) => ({ port: s.port, pid: s.pid, kind: s.kind, url: s.url, exposed: s.exposed, idle: s.idle })) }))), summary: `${projects.reduce((n, p) => n + p.servers.length, 0)} servers` };
  });
  registerAbility({
    name: 'running_agents', label: 'See running AI agents', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Coding agents, AI command-line tools, editors with agents and local model servers running now, with process ids, folders, ports and resource use.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'See which AI agents and model servers are running',
  }, async () => {
    if (!featureOn('devServers')) return off('Dev servers and agents');
    const a = await agentsNow();
    return { content: JSON.stringify(a.map((x) => ({ agent: x.label, kind: x.kind, pid: x.pid, processes: x.pids.length, cpu: x.cpu, memoryMB: Math.round(x.memory / 1048576), project: x.project, ports: x.ports }))), summary: `${a.length} running` };
  });
  registerAbility({
    name: 'process_details', label: 'Inspect a process', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Details of one process: path, command line, folder, memory, open files, connections, children, parents, listening ports and code signature. The environment is never shared with AIs.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' } }, required: ['pid'] },
    describe: (a) => `Inspect process ${Number(a.pid)}`,
  }, async (a) => {
    const pid = Number(a.pid);
    const [d, x] = await Promise.all([details(pid), procExtras(pid, { reveal: false })]);
    if (!d || !x) return { content: 'No such process', summary: 'gone', isError: true };
    return { content: JSON.stringify({ ...d, openFiles: d.openFiles.slice(0, 50), parents: x.parents, ports: x.ports, signature: x.signature }), summary: d.name };
  });
  registerAbility({
    name: 'containers', label: 'See containers', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Docker or Podman containers with state, processor, memory, network and disk use, plus the engine\'s disk use (images, containers, volumes, build cache).',
    parameters: { type: 'object', properties: {} },
    describe: () => 'See your containers',
  }, async () => {
    if (!featureOn('containers')) return off('Containers');
    const v = await containers();
    if (!v.engine) return { content: v.note ?? 'No container engine', summary: 'none' };
    return { content: JSON.stringify({ engine: v.engine, containers: v.containers.map((c) => ({ id: c.id, name: c.name, image: c.image, state: c.state, cpu: c.cpu, memoryMB: c.memUsed ? Math.round(c.memUsed / 1048576) : undefined, ports: c.ports })), disk: v.disk }), summary: `${v.containers.length} containers` };
  });
  registerAbility({
    name: 'container_action', label: 'Stop or restart containers', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Stops, starts, restarts, pauses or resumes (unpause) one container by id or name from `containers`. Say why in `reason`.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: CONTAINER_ACTIONS }, reason: { type: 'string' } }, required: ['id', 'action', 'reason'] },
    describe: (a) => `${str(a.action)} the container ${str(a.id, 60)} — reason: “${str(a.reason, 160)}”`,
  }, async (a) => {
    if (!featureOn('containers')) return off('Containers');
    const r = await containerAction(str(a.id, 128), str(a.action) as ContainerAction);
    return { content: r.message, summary: r.ok ? str(a.action) : 'failed', isError: !r.ok };
  });
  registerAbility({
    name: 'process_control', label: 'Quit, pause or end programs', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Quits, force-quits, pauses (suspends), resumes or ends a process with everything it started. Always say why in `reason`; the person sees it before deciding. System processes, Keeper itself and processes working in the person\'s protected folders are refused.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' }, action: { type: 'string', enum: ['quit', 'force_quit', 'suspend', 'resume', 'end_tree'] }, reason: { type: 'string' } }, required: ['pid', 'action', 'reason'] },
    describe: (a) => `${({ quit: 'Quit', force_quit: 'Force quit', suspend: 'Pause', resume: 'Resume', end_tree: 'End, with everything it started,' } as Record<string, string>)[str(a.action)] ?? 'Act on'} process ${Number(a.pid)} — reason: “${str(a.reason, 160)}”`,
  }, async (a) => {
    const pid = Number(a.pid);
    const refusal = await refuseForAgent(pid);
    if (refusal) return { content: refusal, summary: 'refused', isError: true };
    const map: Record<string, 'quit' | 'forceQuit' | 'suspend' | 'resume' | 'endTree'> = { quit: 'quit', force_quit: 'forceQuit', suspend: 'suspend', resume: 'resume', end_tree: 'endTree' };
    const action = map[str(a.action)];
    if (!action) return { content: 'Unknown action', summary: 'bad action', isError: true };
    const r = await act(action, [pid]);
    const msg = r.message ?? r.failed.map((f) => f.reason).join('; ');
    return { content: r.ok ? msg || `Done (${str(a.action)}).` : msg || 'The system refused', summary: r.ok ? str(a.action) : 'failed', isError: !r.ok };
  });
  registerAbility({
    name: 'stop_dev_server', label: 'Stop dev servers', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Stops a dev server (by pid) or every server of a project (by folder from dev_servers), with what they started. Say why in `reason`.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' }, project: { type: 'string' }, reason: { type: 'string' } }, required: ['reason'] },
    describe: (a) => `Stop ${a.project ? `every dev server of ${path.basename(str(a.project))}` : `the dev server with process id ${Number(a.pid)}`} — reason: “${str(a.reason, 160)}”`,
  }, async (a) => {
    if (!featureOn('devServers')) return off('Dev servers');
    if (a.project) {
      if (inside(str(a.project, 4096), monitorSettings().protectedFolders)) return { content: 'That project is in a folder the person protected from AI agents.', summary: 'protected', isError: true };
      const r = await stopProject(str(a.project, 4096));
      return { content: r.message, summary: r.ok ? 'stopped' : 'failed', isError: !r.ok };
    }
    const refusal = await refuseForAgent(Number(a.pid));
    if (refusal) return { content: refusal, summary: 'refused', isError: true };
    const r = await stopServer(Number(a.pid));
    return { content: r.message, summary: r.ok ? 'stopped' : 'failed', isError: !r.ok };
  });
  registerAbility({
    name: 'stop_agent_session', label: 'Stop AI agent sessions', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Stops a running coding-agent session (pid from running_agents) and everything it started. Say why in `reason`.',
    parameters: { type: 'object', properties: { pid: { type: 'integer' }, reason: { type: 'string' } }, required: ['pid', 'reason'] },
    describe: (a) => `Stop the AI agent session with process id ${Number(a.pid)} and everything it started — reason: “${str(a.reason, 160)}”`,
  }, async (a) => {
    const refusal = await refuseForAgent(Number(a.pid));
    if (refusal) return { content: refusal, summary: 'refused', isError: true };
    const r = await stopAgentSession(Number(a.pid));
    return { content: r.message, summary: r.ok ? 'stopped' : 'failed', isError: !r.ok };
  });
}

/** Tabs from browsers linked through the extension, biggest first (incognito tabs are never listed). */
function tabsView() {
  const t = allTabs().filter((x) => !x.incognito);
  return {
    linked: t.length > 0,
    tabs: t.map((x) => ({ session: x.session, id: x.id, browser: x.browser, title: x.title, url: x.url, memory: x.memory, bytes: x.bytes, audible: x.audible, asleep: x.discarded }))
      .sort((a, b) => (b.memory ?? 0) - (a.memory ?? 0) || (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 200),
  };
}

/** Why an AI agent may not touch this process, or null when it may (the person still approves). */
async function refuseForAgent(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return 'That process cannot be touched.';
  const s = await sample({ disk: false });
  const p = s.procs.find((x) => x.pid === pid);
  if (!p) return 'No such process.';
  const ok = canEnd(p, process.platform, process.pid);
  if (!ok.ok) return ok.reason ?? 'Keeper protects this process.';
  const prot = monitorSettings().protectedFolders;
  if (prot.length) {
    const { cwdsOf } = await import('../services/monitor-probe');
    const cwd = (await cwdsOf([pid])).get(pid);
    if (inside(cwd, prot) || inside(p.path, prot)) return 'This process works in a folder the person protected from AI agents (Health → Settings).';
  }
  return null;
}
