// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Displays: lists every screen with its modes, switches one (and switches it
// back unless Keep comes in time), keeps presets per set of screens (applied
// by themselves when that set is plugged in, if asked), and makes plugged-in
// monitors follow the built-in screen's brightness or the time of day over
// DDC/CI. Screen modes cost nothing in the background; matched brightness
// reads the built-in level every few seconds while it is on (a file on Linux)
// and writes a monitor only when its level should move by 3% or more.

import { screen as electronScreen } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BrightnessState, DisplaysApi, DisplaysState } from '../../core/api-displays';
import type { DisplayInfo } from '../../core/display-control';
import {
  autoPreset, backlightPercent, linuxBuiltIn, linuxModeCmd, normalizeDisplaysSettings, parseKscreen, pickMode, presetChanges, presetFromNow, scheduledLevel, setKey, syncWrites,
  type BrightnessSettings, type ModeChoice, type ScreenInfo,
} from '../../core/display-modes';
import { dedupe, parseWinModes, parseWlrRandr, parseXrandr } from '../../core/stage/display';
import { winModesScript, winSetModeScript } from '../../core/stage/targets';
import type { StageDisplayMode } from '../../core/stage/types';
import { powershell, run } from '../../core/platform';
import { settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';
import { poll } from './governor';
import { macHelperCall } from './platform/mac';

const OS = process.platform;
const options = () => normalizeDisplaysSettings(settings().displays);
let broadcast: (channel: string) => void = () => undefined;

function onPath(tool: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) if (dir && existsSync(path.join(dir, tool))) return true;
  return false;
}

// ---------------------------------------------------------------- listing

type Kmode = StageDisplayMode & { kid?: string };

async function listScreens(): Promise<{ screens: ScreenInfo[]; note?: string }> {
  if (OS === 'darwin') {
    const list = await macHelperCall<{ displays: { id: number; name: string; main: boolean; builtIn: boolean }[] }>('displays.list', {}, 8000).catch(() => null);
    const ids = list?.displays?.length ? list.displays : [{ id: 0, name: 'Main screen', main: true, builtIn: false }];
    const screens: ScreenInfo[] = [];
    for (const d of ids) {
      const r = await macHelperCall<{ display: number; modes: StageDisplayMode[] }>('stage.modes', d.id ? { display: d.id } : {}, 8000).catch(() => null);
      if (r) screens.push({ id: String(r.display), name: d.name, main: d.main, builtIn: d.builtIn, modes: dedupe(r.modes.map((m) => ({ ...m, id: String(m.id) }))), how: 'mac' });
    }
    return screens.length ? { screens } : { screens, note: 'Keeper’s helper did not answer, so screen modes cannot be listed.' };
  }
  if (OS === 'win32') {
    const r = await powershell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName + "|" + $_.Primary }', 15_000);
    const screens: ScreenInfo[] = [];
    let i = 0;
    for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
      const [dev, primary] = line.split('|');
      i++;
      const m = await powershell(winModesScript(dev.trim()), 20_000);
      screens.push({ id: dev.trim(), name: `Screen ${i}${primary?.trim() === 'True' ? ' (main)' : ''}`, main: primary?.trim() === 'True', builtIn: false, modes: parseWinModes(m.stdout), how: 'win' });
    }
    return screens.length ? { screens } : { screens, note: 'Windows did not list its screens.' };
  }
  if (onPath('xrandr') && process.env.DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland') {
    const outs = parseXrandr((await run('xrandr', ['--query'], 8000)).stdout);
    return { screens: outs.map((o) => ({ id: o.output, name: niceOutput(o.output), main: o.primary, builtIn: linuxBuiltIn(o.output), modes: dedupe(o.modes), how: 'xrandr' as const })) };
  }
  if (onPath('kscreen-doctor')) {
    const outs = parseKscreen((await run('kscreen-doctor', ['-o'], 8000)).stdout);
    if (outs.length) return { screens: outs.map((o) => ({ id: o.output, name: niceOutput(o.output), main: o.primary, builtIn: o.builtIn, modes: o.modes, how: 'kscreen' as const })) };
  }
  if (onPath('wlr-randr')) {
    const outs = parseWlrRandr((await run('wlr-randr', [], 8000)).stdout);
    return { screens: outs.map((o) => ({ id: o.output, name: niceOutput(o.output), main: o.primary, builtIn: linuxBuiltIn(o.output), modes: dedupe(o.modes), how: 'wlr' as const })) };
  }
  return { screens: [], note: 'This desktop changes screen sizes only in its own Displays settings (GNOME on Wayland has no tool other apps may use).' };
}

/** "eDP-1" → "Built-in screen", "HDMI-1" → "HDMI 1", "DP-2" → "DisplayPort 2". */
function niceOutput(o: string): string {
  if (linuxBuiltIn(o)) return 'Built-in screen';
  const m = o.match(/^(HDMI|DP|DVI|VGA|USB-C)[-_]?(?:[A-Z]-)?(\d+)$/i);
  if (!m) return o;
  return `${m[1].toUpperCase() === 'DP' ? 'DisplayPort' : m[1].toUpperCase()} ${m[2]}`;
}

// ---------------------------------------------------------------- switching, with a way back

let pending: { revertAt: number; timer: NodeJS.Timeout; back: { screen: ScreenInfo; mode: StageDisplayMode }[] } | null = null;

async function applyMode(s: ScreenInfo, m: Kmode): Promise<boolean> {
  if (s.how === 'mac') return !!(await macHelperCall('stage.setMode', { display: Number(s.id), modeId: Number(m.id), width: m.width, hidpi: m.hidpi }, 10_000).catch(() => null));
  if (s.how === 'win') return /^\s*0\s*$/.test((await powershell(winSetModeScript(s.id, m.width, m.height, m.refresh), 20_000)).stdout);
  const c = linuxModeCmd(s.how, s.id, m);
  return (await run(c.file, c.args, 10_000)).ok;
}

function armRevert(back: { screen: ScreenInfo; mode: StageDisplayMode }[]): number {
  const secs = options().confirmSeconds;
  if (pending) { clearTimeout(pending.timer); back = [...pending.back.filter((b) => !back.some((x) => x.screen.id === b.screen.id)), ...back]; }
  const revertAt = Date.now() + secs * 1000;
  // The way back runs here, not in the window: it works even when the new mode shows nothing at all.
  pending = { revertAt, back, timer: setTimeout(() => void revertNow(), secs * 1000) };
  broadcast('displays-changed');
  return revertAt;
}

async function revertNow() {
  const p = pending;
  pending = null;
  if (!p) return;
  clearTimeout(p.timer);
  for (const b of p.back) await applyMode(b.screen, b.mode).catch(() => false);
  broadcast('displays-changed');
}

async function setModes(changes: { screen: ScreenInfo; mode: StageDisplayMode }[]): Promise<{ ok: boolean; message: string; revertAt?: number }> {
  const back: { screen: ScreenInfo; mode: StageDisplayMode }[] = [];
  for (const c of changes) {
    const cur = c.screen.modes.find((m) => m.current);
    if (!(await applyMode(c.screen, c.mode))) {
      for (const b of back) await applyMode(b.screen, b.mode).catch(() => false);
      return { ok: false, message: `${c.screen.name} did not accept that mode` };
    }
    if (cur) back.push({ screen: c.screen, mode: cur });
  }
  if (!back.length) return { ok: true, message: 'Nothing to change' };
  const revertAt = armRevert(back);
  return { ok: true, message: `Keep this? It switches back in ${options().confirmSeconds} seconds.`, revertAt };
}

async function state(): Promise<DisplaysState> {
  const o = options();
  const { screens, note } = await listScreens();
  const key = setKey(screens);
  return { screens, note, presets: o.presets, presetForNow: o.presets.find((p) => p.set === key)?.id, revertAt: pending?.revertAt, confirmSeconds: o.confirmSeconds };
}

async function setMode(id: string, want: ModeChoice) {
  if (!featureOn('displayModes')) return { ok: false, message: 'Screen modes are off' };
  const { screens } = await listScreens();
  const s = screens.find((x) => x.id === id);
  if (!s) return { ok: false, message: 'That screen is no longer connected' };
  const m = pickMode(s.modes, want);
  if (!m) return { ok: false, message: 'That screen has no such mode' };
  return setModes([{ screen: s, mode: m }]);
}

async function savePresets(next: ReturnType<typeof options>['presets']) {
  await updateSettings({ displays: { ...options(), presets: next } });
}

async function applyPreset(id: string) {
  const p = options().presets.find((x) => x.id === id);
  if (!p) return { ok: false, message: 'That preset is gone' };
  const { screens } = await listScreens();
  const changes = presetChanges(p, screens);
  if (!changes.length) return { ok: true, message: `${p.name} is already in use` };
  return setModes(changes);
}

// A set of screens plugged in or out: its preset, if it is marked to apply by itself (with Keep, as always).
let plugTimer: NodeJS.Timeout | undefined;
function screensChanged() {
  clearTimeout(plugTimer);
  plugTimer = setTimeout(async () => {
    if (!featureOn('displayModes')) return;
    const { screens } = await listScreens();
    const p = autoPreset(options().presets, screens);
    if (p && presetChanges(p, screens).length) await applyPreset(p.id);
    broadcast('displays-changed');
  }, 3000);
}

// ---------------------------------------------------------------- matched brightness

async function builtInLevel(): Promise<{ level?: number; note?: string }> {
  if (OS === 'linux') {
    const dir = process.env.KEEPER_BACKLIGHT_DIR ?? '/sys/class/backlight';
    const names = await fsp.readdir(dir).catch(() => [] as string[]);
    if (!names.length) return { note: 'This computer has no built-in screen whose brightness the system shares.' };
    const read = (f: string) => fsp.readFile(path.join(dir, names.sort()[0], f), 'utf8').catch(() => undefined);
    return { level: backlightPercent(await read('brightness'), await read('max_brightness')) };
  }
  if (OS === 'darwin') {
    const r = await macHelperCall<{ brightness?: number }>('hud.levels', {}, 4000).catch(() => null);
    return typeof r?.brightness === 'number' ? { level: Math.round(r.brightness) } : { note: 'macOS does not share the built-in screen’s brightness on this Mac, so monitors follow the time of day instead.' };
  }
  const r = await powershell('(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness', 8000);
  const n = Number(r.stdout.trim());
  return r.stdout.trim() && Number.isFinite(n) ? { level: n } : { note: 'Windows does not share a built-in screen’s brightness on this computer.' };
}

let monitorCache: { at: number; list: DisplayInfo[]; note?: string } | null = null;
const lastSet = new Map<string, number>();

async function monitors(force = false) {
  if (!force && monitorCache && Date.now() - monitorCache.at < 5 * 60_000) return monitorCache;
  const { listDisplays } = await import('./display-control');
  const r = await listDisplays().catch(() => ({ displays: [] as DisplayInfo[], note: 'The monitors did not answer.' }));
  // In plain words, with no device paths.
  const note = r.displays.length ? undefined : OS === 'linux' && /ddcutil/.test(r.note ?? '') ? 'No monitor answered. Install ddcutil, and turn on DDC/CI in the monitor’s own menu.' : 'No monitor answered. Turn on DDC/CI in the monitor’s own menu.';
  monitorCache = { at: Date.now(), list: r.displays, note };
  for (const d of r.displays) if (d.brightness !== undefined && !lastSet.has(d.id)) lastSet.set(d.id, d.brightness);
  return monitorCache;
}

async function brightness(): Promise<BrightnessState> {
  const b = options().brightness;
  const [bi, mons] = await Promise.all([builtInLevel(), featureOn('displayControl') ? monitors() : Promise.resolve({ list: [] as DisplayInfo[], note: 'Turn on Monitor controls to change a monitor’s brightness.' })]);
  return { settings: b, builtIn: bi.level, canFollow: bi.level !== undefined, followNote: bi.note, monitors: mons.list, monitorsNote: mons.note };
}

async function syncTick() {
  if (!featureOn('brightnessSync') || !featureOn('displayControl')) return;
  const b = options().brightness;
  if (b.mode === 'off') return;
  let source: number | undefined;
  if (b.mode === 'builtin') source = (await builtInLevel()).level;
  if (source === undefined) {
    const d = new Date();
    source = scheduledLevel(b, d.getHours() * 60 + d.getMinutes());
  }
  const mons = await monitors();
  const writes = syncWrites(source, mons.list.map((m) => ({ id: m.id, last: lastSet.get(m.id) })), b.offsets);
  if (!writes.length) return;
  const { setDisplay } = await import('./display-control');
  for (const w of writes) {
    await setDisplay(w.id, 'brightness', w.level).then(() => lastSet.set(w.id, w.level)).catch(() => undefined);
  }
  broadcast('displays-changed');
}

let stopSync: (() => void) | undefined;
function scheduleSync() {
  stopSync?.();
  stopSync = undefined;
  if (!featureOn('brightnessSync') || !featureOn('displayControl') || options().brightness.mode === 'off') return;
  stopSync = poll('displays.sync', { baseMs: OS === 'win32' ? 10_000 : 4000, idleFactor: 4, pauseWhenLocked: true, maxMs: 60_000 }, syncTick, { feature: ['brightnessSync', 'displayControl'], now: true });
}

async function setBrightness(patch: Partial<BrightnessSettings>): Promise<BrightnessState> {
  const o = options();
  await updateSettings({ displays: { ...o, brightness: normalizeDisplaysSettings({ ...o, brightness: { ...o.brightness, ...patch } }).brightness } });
  // A new offset or level applies at the next look.
  lastSet.clear();
  scheduleSync();
  return brightness();
}

export const displaysApi: DisplaysApi = {
  state,
  setMode,
  keep: async () => { if (pending) { clearTimeout(pending.timer); pending = null; } broadcast('displays-changed'); return state(); },
  revert: async () => { await revertNow(); return state(); },
  savePreset: async (name) => {
    const { screens } = await listScreens();
    const p = presetFromNow(screens, name, `p${Date.now().toString(36)}`);
    await savePresets([...options().presets.filter((x) => !(x.set === p.set && x.name === p.name)), p]);
    return state();
  },
  removePreset: async (id) => { await savePresets(options().presets.filter((p) => p.id !== id)); return state(); },
  applyPreset,
  setPresetAuto: async (id, auto) => { await savePresets(options().presets.map((p) => (p.id === id ? { ...p, auto } : p))); return state(); },
  brightness,
  setBrightness,
};

export function startDisplays(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  let listening = false;
  onFeature('displayModes', (on) => {
    if (on && !listening) {
      // Plugging a screen in or out is an event from the system: no polling.
      electronScreen.on('display-added', screensChanged);
      electronScreen.on('display-removed', screensChanged);
      listening = true;
    } else if (!on && listening) {
      electronScreen.off('display-added', screensChanged);
      electronScreen.off('display-removed', screensChanged);
      listening = false;
    }
  }, { now: true });
  onFeature('brightnessSync', scheduleSync, { now: true });
  onFeature('displayControl', scheduleSync);
}
