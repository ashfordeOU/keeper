// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Per-app controls in the app: remembers what the person set for each app,
// previews the exact commands, applies them (one administrator prompt when
// needed) and puts them back when Keeper starts. Nothing runs in the
// background unless an app has "pause in the background" switched on, and
// then only on front-app changes the system already reports.

import { app } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONTROLS, appTag, cgroupWrites, defaultForCmd, linuxAutostart, linuxRoute, linuxShape, linuxVolumeCmd, macAppearanceCmd, macLanguageCmd, macLoginAgent, macShape,
  notificationsCmd, parseSinkInputs, showPlan, winGpuCmd, winJob, winQos, winRunKey, winVolumeScript, type AppOs, type AppRef, type Cmd, type Plan,
} from '../../core/appctl';
import type { AppControlInfo, AppControlState, AppCtlApi } from '../../core/api-settingsplus';
import { run } from '../../core/platform';
import { runCmds, runOne } from './elevate';
import { act, apps as runningApps, setPriority } from './procs';
import { fwApi } from './fw';
import { awakeService } from './awake';
import { onFrontAppChange } from './fg-watch';

const OS = process.platform as AppOs;
const file = () => path.join(app.getPath('userData'), 'appctl.json');
let states: Record<string, AppControlState> = {};
let loaded = false;

export const keyOf = (a: AppRef) => (a.bundleId ?? a.path ?? a.name).toLowerCase();

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    states = JSON.parse(await fsp.readFile(file(), 'utf8'));
  } catch {
    states = {};
  }
}
async function save() {
  await fsp.writeFile(`${file()}.tmp`, JSON.stringify(states, null, 1), { mode: 0o600 });
  await fsp.rename(`${file()}.tmp`, file());
}

// ---------------------------------------------------------------- Linux cgroups

/** Moves the app into its own cgroup: a systemd user scope when possible (no password), else Keeper's tree (as root). */
async function linuxCgroup(a: AppRef): Promise<{ rel: string; dir: string; unit?: string }> {
  const pid = a.pid!;
  if (!existsSync('/sys/fs/cgroup/cgroup.controllers')) throw new Error('This system uses the older cgroup v1; per-app limits need cgroup v2 (standard on current distributions)');
  if (!pid) throw new Error('The app is not running');
  const own = async () => (await fsp.readFile(`/proc/${pid}/cgroup`, 'utf8')).split('\n').find((l) => l.startsWith('0::'))?.slice(3).trim() ?? '';
  const unit = `keeper-${appTag(a)}-${pid}.scope`;
  const cur = await own();
  if (cur.endsWith(`/${unit}`) || cur.includes(`/keeper/${appTag(a)}`)) return { rel: cur.replace(/^\//, ''), dir: `/sys/fs/cgroup${cur}`, unit: cur.endsWith('.scope') ? unit : undefined };
  const t = await run('busctl', ['--user', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'StartTransientUnit', 'ssa(sv)a(sa(sv))', unit, 'fail', '1', 'PIDs', 'au', '1', String(pid), '0'], 8000);
  if (t.ok) {
    await new Promise((r) => setTimeout(r, 300));
    const now = await own();
    return { rel: now.replace(/^\//, ''), dir: `/sys/fs/cgroup${now}`, unit };
  }
  const base = '/sys/fs/cgroup/keeper';
  const dir = `${base}/${appTag(a)}`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile('/sys/fs/cgroup/cgroup.subtree_control', '+cpu +memory').catch(() => undefined);
    await fsp.writeFile(`${base}/cgroup.subtree_control`, '+cpu +memory').catch(() => undefined);
    await fsp.writeFile(`${dir}/cgroup.procs`, String(pid));
  } catch {
    const r = await runCmds([{ file: 'sh', args: ['-c', `mkdir -p ${dir} && echo '+cpu +memory' > /sys/fs/cgroup/cgroup.subtree_control; echo '+cpu +memory' > ${base}/cgroup.subtree_control; echo ${pid} > ${dir}/cgroup.procs`], admin: true }]);
    if (!r.ok) throw new Error(`Could not give the app its own group: ${r.message}`);
  }
  if (!(await own()).includes(`/keeper/${appTag(a)}`)) throw new Error('The app could not be moved into its own group');
  return { rel: `keeper/${appTag(a)}`, dir };
}

async function linuxLimits(a: AppRef, o: { cpuPercent?: number; memMB?: number }): Promise<string> {
  const g = await linuxCgroup(a);
  if (g.unit) {
    const props = [...(o.cpuPercent !== undefined ? [`CPUQuota=${o.cpuPercent > 0 ? `${o.cpuPercent}%` : ''}`] : []), ...(o.memMB !== undefined ? [`MemoryMax=${o.memMB > 0 ? `${o.memMB}M` : 'infinity'}`] : [])];
    const r = await run('systemctl', ['--user', 'set-property', '--runtime', g.unit, ...props], 8000);
    if (r.ok) return `Limited through ${g.unit}`;
  }
  const writes = cgroupWrites({ cpuPercent: o.cpuPercent && o.cpuPercent > 0 ? o.cpuPercent : o.cpuPercent === 0 ? 100 * os.cpus().length : undefined, memMB: o.memMB, cores: os.cpus().length });
  for (const w of writes) {
    try {
      await fsp.writeFile(path.join(g.dir, w.file), w.value);
    } catch {
      const r = await runCmds([{ file: 'sh', args: ['-c', `echo '${w.value}' > '${path.join(g.dir, w.file)}'`], admin: true }]);
      if (!r.ok) throw new Error(r.message);
    }
  }
  return `Limited in ${g.rel}`;
}

async function linuxIface(kind: 'default' | 'vpn'): Promise<string> {
  if (kind === 'default') {
    const r = await run('ip', ['route', 'show', 'default'], 4000);
    const m = r.stdout.match(/dev (\S+)/);
    if (!m) throw new Error('No network connection');
    return m[1];
  }
  const r = await run('ip', ['-o', 'link', 'show'], 4000);
  const m = r.stdout.match(/^\d+: ((?:wg|tun|tap|tailscale|proton|nordlynx|mullvad)[\w.-]*)[:@]/m);
  if (!m) throw new Error('No VPN is connected');
  return m[1];
}

// ---------------------------------------------------------------- planning

async function macBundleId(p?: string): Promise<string | undefined> {
  const appDir = p?.match(/^(.*?\.app)(\/|$)/)?.[1];
  if (!appDir) return undefined;
  const r = await run('/usr/bin/defaults', ['read', path.join(appDir, 'Contents', 'Info'), 'CFBundleIdentifier'], 4000);
  return r.ok ? r.stdout.trim() : undefined;
}

function linuxDesktopId(a: AppRef): string | undefined {
  const base = path.basename(a.path ?? a.name).toLowerCase();
  for (const d of [path.join(os.homedir(), '.local/share/applications'), '/usr/share/applications', '/var/lib/flatpak/exports/share/applications']) {
    for (const n of [`${base}.desktop`, `org.${base}.desktop`]) if (existsSync(path.join(d, n))) return n;
  }
  return undefined;
}

async function enrich(a: AppRef): Promise<AppRef> {
  const out = { ...a };
  if (OS === 'darwin' && !out.bundleId) out.bundleId = await macBundleId(a.path);
  if (OS === 'linux' && !out.appId) out.appId = linuxDesktopId(a);
  return out;
}

const NONE: Plan = { cmds: [], undo: [] };

/** The plan for one patch. Some controls are carried out by other parts of Keeper (firewall, keep-awake, priority). */
async function planFor(a: AppRef, patch: Partial<AppControlState>, preview: boolean): Promise<{ plans: Plan[]; notes: string[]; actions: (() => Promise<void>)[] }> {
  const plans: Plan[] = [];
  const notes: string[] = [];
  const actions: (() => Promise<void>)[] = [];
  const home = os.homedir();
  if (patch.network) {
    notes.push(`Firewall rule: ${patch.network} ${a.name} (all connections out)`);
    actions.push(async () => {
      const id = `app-${appTag(a)}`;
      await fwApi.removeRule('mine', id).catch(() => undefined);
      if (!a.path) throw new Error('This app\'s location is not known');
      await fwApi.saveRule('mine', { id, app: { path: a.path }, direction: 'out', verdict: patch.network!, enabled: true, created: Date.now(), note: `Set in ${a.name}'s app settings` } as never);
    });
  }
  if (patch.bandwidthKbps !== undefined) {
    if (patch.bandwidthKbps <= 0) notes.push('Bandwidth limit removed');
    else if (OS === 'win32') plans.push(winQos(a, patch.bandwidthKbps));
    else if (OS === 'darwin') plans.push(macShape(a, patch.bandwidthKbps, patch.bandwidthPorts ?? []));
    else if (preview) plans.push(linuxShape(a, patch.bandwidthKbps, await linuxIface('default').catch(() => 'eth0'), `keeper/${appTag(a)}`));
    else {
      const g = await linuxCgroup(a);
      plans.push(linuxShape(a, patch.bandwidthKbps, await linuxIface('default'), g.rel));
    }
  }
  if (patch.vpn) {
    if (OS !== 'linux') notes.push(CONTROLS.find((c) => c.id === 'vpn')!.notes[OS]!);
    else if (preview) plans.push(linuxRoute(a, patch.vpn, `keeper/${appTag(a)}`, await linuxIface('vpn').catch(() => 'wg0')));
    else plans.push(linuxRoute(a, patch.vpn, (await linuxCgroup(a)).rel, await linuxIface('vpn')));
  }
  if (patch.priority) {
    notes.push(`Priority: ${patch.priority}`);
    const level = ({ low: 'lowest', below: 'low', normal: 'normal', above: 'high', high: 'highest' } as const)[patch.priority];
    actions.push(async () => {
      const r = await setPriority(a.pid!, level, { admin: patch.priority === 'above' || patch.priority === 'high' });
      if (!r.ok) throw new Error(r.message ?? 'Could not change the priority');
      if (OS === 'darwin' && patch.priority === 'low') await runOne({ file: '/usr/sbin/taskpolicy', args: ['-b', '-p', String(a.pid)] });
    });
  }
  if (patch.cpuPercent !== undefined || patch.memMB !== undefined) {
    if (OS === 'win32') plans.push(winJob(a, { cpuPercent: patch.cpuPercent, memMB: patch.memMB }));
    else if (OS === 'darwin') {
      if (patch.memMB) notes.push(CONTROLS.find((c) => c.id === 'memLimit')!.notes.darwin!);
      if (patch.cpuPercent) plans.push({ cmds: [{ file: '/usr/sbin/taskpolicy', args: ['-b', '-p', String(a.pid)] }], undo: [{ file: '/usr/sbin/taskpolicy', args: ['-B', '-p', String(a.pid)] }], note: CONTROLS.find((c) => c.id === 'cpuLimit')!.notes.darwin });
    } else {
      notes.push(...cgroupWrites({ cpuPercent: patch.cpuPercent || undefined, memMB: patch.memMB, cores: os.cpus().length }).map((w) => `write ${w.file} = ${w.value} (the app's own cgroup)`));
      if (!preview) actions.push(async () => { notes.push(await linuxLimits(a, { cpuPercent: patch.cpuPercent, memMB: patch.memMB })); });
    }
  }
  if (patch.paused !== undefined) {
    notes.push(patch.paused ? 'Pause the app now' : 'Resume the app');
    actions.push(async () => {
      const r = await act(patch.paused ? 'suspend' : 'resume', [a.pid!]);
      if (!r.ok) throw new Error(r.message ?? 'Could not pause the app');
    });
  }
  if (patch.startAtLogin !== undefined) {
    if (OS === 'win32') plans.push({ cmds: [winRunKey(a, patch.startAtLogin)], undo: [winRunKey(a, !patch.startAtLogin)] });
    else if (OS === 'darwin') {
      const la = macLoginAgent(a);
      plans.push(patch.startAtLogin ? { cmds: [], undo: [], files: [{ path: path.join(home, la.file), content: la.content }] } : { cmds: [], undo: [], removeFiles: [path.join(home, la.file)] });
    } else {
      const d = linuxAutostart(a);
      plans.push(patch.startAtLogin ? { cmds: [], undo: [], files: [{ path: path.join(home, d.file), content: d.content }] } : { cmds: [], undo: [], removeFiles: [path.join(home, d.file)] });
    }
  }
  if (patch.notifications !== undefined) {
    const c = notificationsCmd(a, patch.notifications, OS);
    if (c) plans.push({ cmds: [c], undo: [] });
    else notes.push(OS === 'darwin' ? CONTROLS.find((x) => x.id === 'notifications')!.notes.darwin! : 'Keeper could not find this app\'s identifier for notifications.');
  }
  if (patch.alwaysLight !== undefined) {
    if (OS === 'darwin') plans.push({ cmds: [macAppearanceCmd(a, patch.alwaysLight)], undo: [macAppearanceCmd(a, !patch.alwaysLight)], note: 'Takes effect when the app is next opened.' });
    else notes.push(CONTROLS.find((x) => x.id === 'appearance')!.notes[OS]!);
  }
  if (patch.language !== undefined) {
    if (OS === 'darwin') plans.push({ cmds: [macLanguageCmd(a, patch.language || null)], undo: [macLanguageCmd(a, null)], note: 'Takes effect when the app is next opened.' });
    else notes.push(CONTROLS.find((x) => x.id === 'language')!.notes[OS]!);
  }
  if (patch.volume !== undefined) {
    if (OS === 'darwin') notes.push(CONTROLS.find((x) => x.id === 'volume')!.notes.darwin!);
    else if (OS === 'win32') plans.push({ cmds: [{ file: 'powershell', args: ['-NoProfile', '-Command', winVolumeScript(a.pid!, patch.volume)] }], undo: [] });
    else if (preview) notes.push(`pactl set-sink-input-volume <the app's stream> ${patch.volume}%`);
    else {
      const r = await run('pactl', ['list', 'sink-inputs'], 5000);
      const streams = parseSinkInputs(r.stdout).filter((s) => s.pid === a.pid || (s.name && s.name.toLowerCase() === a.name.toLowerCase()));
      if (!streams.length) throw new Error('This app is not playing sound right now');
      plans.push({ cmds: streams.map((s) => linuxVolumeCmd(s.index, patch.volume!)), undo: [] });
    }
  }
  if (patch.gpu !== undefined) {
    if (OS === 'win32') plans.push({ cmds: [winGpuCmd(a, patch.gpu)], undo: [winGpuCmd(a, null)], note: 'Takes effect when the app is next opened.' });
    else notes.push(CONTROLS.find((x) => x.id === 'gpu')!.notes[OS]!);
  }
  if (patch.defaultFor?.length) {
    for (const t of patch.defaultFor) {
      const c = defaultForCmd(a, t, OS);
      if (c) plans.push({ cmds: [c], undo: [] });
    }
    if (OS === 'win32') notes.push(CONTROLS.find((x) => x.id === 'defaultFor')!.notes.win32!);
  }
  if (patch.keepAwake !== undefined) {
    notes.push(patch.keepAwake ? `Keep Awake trigger: while ${a.name} is running` : 'Keep Awake trigger removed');
    actions.push(async () => {
      const svc = awakeService();
      if (!svc) throw new Error('Keep Awake is switched off in Settings → Features');
      const id = `app-${appTag(a)}`;
      if (patch.keepAwake) await svc.saveTrigger({ id, name: `While ${a.name} runs`, enabled: true, match: 'any', conditions: [{ kind: 'app', value: a.name }], priority: 0, reactivateAfterMin: 0 });
      else await svc.removeTrigger(id);
    });
  }
  if (patch.autoSuspendMin !== undefined && OS !== 'darwin') notes.push(CONTROLS.find((x) => x.id === 'autoSuspend')!.notes[OS]!);
  if (patch.dnsException !== undefined) notes.push(CONTROLS.find((x) => x.id === 'dns')!.notes[OS]!);
  return { plans, notes, actions };
}

async function writeFiles(p: Plan) {
  for (const f of p.files ?? []) {
    await fsp.mkdir(path.dirname(f.path), { recursive: true });
    await fsp.writeFile(f.path, f.content, { mode: 0o644 });
  }
  for (const f of p.removeFiles ?? []) await fsp.rm(f, { force: true });
}

// ---------------------------------------------------------------- auto-pause (macOS front-app events)

const hiddenSince = new Map<string, number>();
let stopFront: (() => void) | null = null;
function watchFront() {
  const watched = Object.values(states).filter((s) => s.autoSuspendMin && s.autoSuspendMin > 0);
  if (!watched.length || OS !== 'darwin') {
    stopFront?.();
    stopFront = null;
    return;
  }
  if (stopFront) return;
  stopFront = onFrontAppChange((front) => {
    const now = Date.now();
    for (const s of Object.values(states).filter((x) => x.autoSuspendMin)) {
      const inFront = front.toLowerCase() === s.app.name.toLowerCase();
      if (inFront) {
        hiddenSince.delete(s.key);
        if (s.paused && s.app.pid) void act('resume', [s.app.pid]).then(() => { s.paused = false; void save(); });
      } else if (!hiddenSince.has(s.key)) {
        hiddenSince.set(s.key, now);
        // One timer per app that was just left; nothing runs while the person stays in other apps.
        setTimeout(() => {
          if (hiddenSince.get(s.key) === now && s.app.pid) void act('suspend', [s.app.pid]).then(() => { s.paused = true; void save(); });
        }, s.autoSuspendMin! * 60_000).unref?.();
      }
    }
  });
}

// ---------------------------------------------------------------- API

export const appctlApi: AppCtlApi = {
  async controls(): Promise<AppControlInfo[]> {
    return CONTROLS.map((c) => ({ id: c.id, title: c.title, description: c.description, support: c.support[OS], note: c.notes[OS], admin: !!c.admin[OS] }));
  },
  async list() {
    await load();
    return Object.values(states);
  },
  async get(a) {
    await load();
    const e = await enrich(a);
    return states[keyOf(e)] ?? { key: keyOf(e), app: e };
  },
  async preview(a, patch) {
    try {
      const e = await enrich(a);
      const p = await planFor(e, patch, true);
      return { commands: p.plans.flatMap(showPlan), notes: [...p.notes, ...p.plans.map((x) => x.note).filter((n): n is string => !!n)] };
    } catch (err) {
      return { commands: [], notes: [], error: err instanceof Error ? err.message : String(err) };
    }
  },
  async set(a, patch) {
    await load();
    const e = await enrich(a);
    const key = keyOf(e);
    const prev = states[key] ?? { key, app: e };
    try {
      // Undo the old shaping/route first so limits never stack.
      if (patch.bandwidthKbps !== undefined && prev.bandwidthKbps) {
        const old = OS === 'win32' ? winQos(e, prev.bandwidthKbps) : OS === 'darwin' && prev.bandwidthPorts?.length ? macShape(e, prev.bandwidthKbps, prev.bandwidthPorts) : OS === 'linux' ? linuxShape(e, prev.bandwidthKbps, await linuxIface('default'), `keeper/${appTag(e)}`) : NONE;
        await runCmds(old.undo);
      }
      if (patch.network === undefined && 'network' in patch) await fwApi.removeRule('mine', `app-${appTag(e)}`).catch(() => undefined);
      const p = await planFor(e, patch, false);
      for (const pl of p.plans) {
        await writeFiles(pl);
        if (pl.cmds.length) {
          const r = await runCmds(pl.cmds as Cmd[]);
          if (!r.ok) return { ok: false, message: r.message, state: prev };
        }
      }
      for (const fn of p.actions) await fn();
      states[key] = { ...prev, ...patch, app: { ...prev.app, ...e } };
      await save();
      watchFront();
      return { ok: true, message: [...p.notes, ...p.plans.map((x) => x.note).filter(Boolean)].join(' ') || 'Done', state: states[key] };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), state: prev };
    }
  },
  async clear(a) {
    await load();
    const e = await enrich(a);
    const key = keyOf(e);
    const s = states[key];
    if (!s) return { ok: true, message: 'Nothing was set' };
    const undo: Partial<AppControlState> = {};
    if (s.network) undo.network = undefined;
    if (s.bandwidthKbps) undo.bandwidthKbps = 0;
    if (s.priority && s.priority !== 'normal' && e.pid) undo.priority = 'normal';
    if ((s.cpuPercent || s.memMB) && e.pid && OS === 'linux') { undo.cpuPercent = 0; undo.memMB = 0; }
    if (s.paused && e.pid) undo.paused = false;
    if (s.startAtLogin) undo.startAtLogin = false;
    if (s.alwaysLight) undo.alwaysLight = false;
    if (s.language) undo.language = '';
    if (s.gpu !== undefined) undo.gpu = null as never;
    if (s.keepAwake) undo.keepAwake = false;
    if (s.notifications === false) undo.notifications = true;
    const r = await appctlApi.set(e, undo);
    delete states[key];
    await save();
    watchFront();
    return { ok: r.ok, message: r.ok ? 'Everything Keeper set for this app was removed' : r.message };
  },
  async running() {
    const list = await runningApps().catch(() => []);
    const out: AppRef[] = [];
    for (const a of list) out.push(await enrich({ name: a.name, path: a.path, pid: a.pid }));
    return out;
  },
};

/** At start: bring back what does not survive a restart (Windows QoS in the active store, the auto-pause watcher). */
export async function startAppctl() {
  await load();
  watchFront();
  if (OS !== 'win32') return;
  const qos = Object.values(states).filter((s) => s.bandwidthKbps && s.bandwidthKbps > 0 && s.app.path);
  for (const s of qos) await runCmds(winQos(s.app, s.bandwidthKbps!).cmds).catch(() => undefined);
}
