// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Containers (Docker or Podman), the per-app volume mixer and, on macOS,
// energy impact, sleep assertions and App Nap per app. No Electron here, so
// the command line shares it. Everything runs on demand only.

import { run } from '../../core/platform';
import { CONTAINER_ACTIONS, joinStats, parseDf, parsePs, parseStats, safeContainerId, type ContainerAction, type ContainerRow, type DiskUse, type Engine } from '../../core/monitor-containers';
import { linuxDefaultSinkCmd, linuxMuteCmd, MAC_MIXER_NOTE, parseLinuxSinks, parseLinuxStreams, parseWinMixer, winMixerList, winMixerSet, type MixerState } from '../../core/monitor-mixer';
import { linuxVolumeCmd } from '../../core/appctl';
import { appNapCmd, parseAppNap, parseAssertions, parseTopPower, type EnergyRow } from '../../core/monitor-energy';
import { powershell } from '../../core/platform';

type Ps = (script: string, timeout?: number) => Promise<{ ok: boolean; stdout: string }>;
let ps: Ps = (s, t) => powershell(s, t);
export function useExtrasPowerShell(fn: Ps) {
  ps = fn;
}

// ---------------------------------------------------------------- containers

let engineCache: { at: number; engine: Engine | null } | undefined;

/** Docker if it answers, else Podman; remembered for a minute. */
export async function containerEngine(): Promise<Engine | null> {
  if (engineCache && Date.now() - engineCache.at < 60_000) return engineCache.engine;
  let engine: Engine | null = null;
  for (const e of ['docker', 'podman'] as const) {
    const r = await run(e, ['version', '--format', '{{.Server.Version}}'], 8000);
    if (r.ok && r.stdout.trim()) {
      engine = e;
      break;
    }
  }
  engineCache = { at: Date.now(), engine };
  return engine;
}

export interface ContainersView { engine: Engine | null; containers: ContainerRow[]; disk: DiskUse[]; note?: string }

export async function containers(opts: { stats?: boolean; disk?: boolean } = { stats: true, disk: true }): Promise<ContainersView> {
  const engine = await containerEngine();
  if (!engine) return { engine: null, containers: [], disk: [], note: 'Neither Docker nor Podman is running here.' };
  const fmt = engine === 'docker' ? ['--format', '{{json .}}'] : ['--format', 'json'];
  const [list, stats, df] = await Promise.all([
    run(engine, ['ps', '-a', ...fmt], 15_000),
    opts.stats ? run(engine, ['stats', '--no-stream', ...fmt], 20_000) : Promise.resolve({ ok: false, stdout: '' }),
    opts.disk ? run(engine, ['system', 'df', ...fmt], 30_000) : Promise.resolve({ ok: false, stdout: '' }),
  ]);
  return { engine, containers: joinStats(parsePs(list.stdout), parseStats(stats.stdout)), disk: parseDf(df.stdout), note: list.ok ? undefined : 'The container engine did not answer.' };
}

export async function containerAction(id: string, action: ContainerAction): Promise<{ ok: boolean; message: string }> {
  if (!safeContainerId(id) || !CONTAINER_ACTIONS.includes(action)) return { ok: false, message: 'Not a container or action Keeper knows.' };
  const engine = await containerEngine();
  if (!engine) return { ok: false, message: 'No container engine is running.' };
  const r = await run(engine, [action, id], 60_000);
  const done: Record<ContainerAction, string> = { stop: 'Stopped', start: 'Started', restart: 'Restarted', pause: 'Paused', unpause: 'Resumed' };
  return { ok: r.ok, message: r.ok ? `${done[action]} ${id}` : (r.stderr || r.stdout).trim().slice(0, 300) || 'The engine refused.' };
}

// ---------------------------------------------------------------- mixer

export async function mixer(): Promise<MixerState> {
  if (process.platform === 'darwin') return { supported: false, streams: [], outputs: [], canSwitchOutput: false, note: MAC_MIXER_NOTE };
  if (process.platform === 'win32') {
    const r = await ps(winMixerList(), 20_000);
    return { supported: r.ok, streams: parseWinMixer(r.stdout), outputs: [], canSwitchOutput: false, note: 'Windows changes the output device only in its own Sound settings (the switch is not a public interface).' };
  }
  const [inputs, sinks, def, long] = await Promise.all([run('pactl', ['list', 'sink-inputs'], 8000), run('pactl', ['list', 'short', 'sinks'], 8000), run('pactl', ['get-default-sink'], 8000), run('pactl', ['list', 'sinks'], 8000)]);
  if (!inputs.ok && !sinks.ok) return { supported: false, streams: [], outputs: [], canSwitchOutput: false, note: 'No PipeWire or PulseAudio sound server answered (pactl).' };
  return { supported: true, streams: parseLinuxStreams(inputs.stdout), outputs: parseLinuxSinks(sinks.stdout, def.stdout, long.stdout), canSwitchOutput: true };
}

export async function setStream(id: string, patch: { volume?: number; muted?: boolean }): Promise<boolean> {
  if (process.platform === 'win32') return (await ps(winMixerSet(Number(id), patch.volume, patch.muted), 20_000)).ok;
  if (process.platform !== 'linux' || !/^\d+$/.test(id)) return false;
  let ok = true;
  if (patch.volume !== undefined) {
    const c = linuxVolumeCmd(Number(id), patch.volume);
    ok = (await run(c.file, c.args, 8000)).ok && ok;
  }
  if (patch.muted !== undefined) {
    const c = linuxMuteCmd(id, patch.muted);
    ok = (await run(c.file, c.args, 8000)).ok && ok;
  }
  return ok;
}

export async function setOutput(name: string): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  const c = linuxDefaultSinkCmd(name);
  return (await run(c.file, c.args, 8000)).ok;
}

// ---------------------------------------------------------------- energy (macOS)

export interface EnergyView { supported: boolean; rows: EnergyRow[]; note?: string }

/** macOS: energy impact from `top`, what keeps it awake from `pmset -g assertions`, App Nap from each app's preferences. */
export async function energy(): Promise<EnergyView> {
  if (process.platform !== 'darwin') return { supported: false, rows: [], note: 'Energy impact and App Nap are macOS ideas; the Processes list shows an estimated energy column on every system.' };
  const [top, as] = await Promise.all([run('/usr/bin/top', ['-l', '2', '-s', '1', '-n', '25', '-o', 'power', '-stats', 'pid,command,power'], 15_000), run('/usr/bin/pmset', ['-g', 'assertions'], 8000)]);
  const rows = parseTopPower(top.stdout);
  const holds = parseAssertions(as.stdout);
  for (const r of rows) r.holds = holds.get(r.pid);
  // App Nap only matters for apps; read their bundle id and the switch.
  await Promise.all(rows.slice(0, 15).map(async (r) => {
    const p = await run('/bin/ps', ['-o', 'comm=', '-p', String(r.pid)], 3000);
    const bundle = p.stdout.match(/^(.*?\.app)\//)?.[1];
    if (!bundle) return;
    const id = (await run('/usr/bin/mdls', ['-name', 'kMDItemCFBundleIdentifier', '-raw', bundle], 3000)).stdout.trim();
    if (!/^[\w.-]+$/.test(id)) return;
    r.bundleId = id;
    r.appNap = parseAppNap((await run('/usr/bin/defaults', ['read', id, 'NSAppSleepDisabled'], 3000)).stdout);
  }));
  return { supported: true, rows };
}

/** macOS: let an app nap or keep it awake when hidden (takes effect the next time the app starts). */
export async function setAppNap(bundleId: string, allowed: boolean): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  const c = appNapCmd(bundleId, allowed);
  return (await run(c.file, c.args, 5000)).ok;
}
