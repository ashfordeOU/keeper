// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Displays: each screen's size, refresh rate and sharp (HiDPI) mode, presets
// for each set of screens, switching back by itself when a change is not
// confirmed, and plugged-in monitors' brightness following the built-in
// screen or the time of day (through the existing DDC/CI path,
// core/display-control.ts). Only public interfaces: CoreGraphics display modes
// (keeper-helper), ChangeDisplaySettingsEx on Windows, xrandr, wlr-randr and
// kscreen-doctor on Linux. No virtual screens and no extra brightness: those
// need private interfaces. Pure: electron/services/displays.ts runs it.

import type { StageDisplayMode } from './stage/types';

export interface ScreenInfo {
  /** stable for this screen: the output name (Linux), device name (Windows) or display id (macOS) */
  id: string;
  name: string;
  main: boolean;
  /** the laptop's own screen */
  builtIn: boolean;
  modes: StageDisplayMode[];
  /** how its mode is changed */
  how: 'mac' | 'win' | 'xrandr' | 'wlr' | 'kscreen';
}

export interface ModeChoice { width: number; height: number; refresh?: number; hidpi?: boolean }

export const modeKey = (m: ModeChoice) => `${m.width}x${m.height}@${m.refresh ?? 0}${m.hidpi ? 'h' : ''}`;
export const sameMode = (a: ModeChoice, b: ModeChoice) => a.width === b.width && a.height === b.height && Math.round(a.refresh ?? 0) === Math.round(b.refresh ?? 0) && !!a.hidpi === !!b.hidpi;

/** The sizes a screen offers, biggest first, each with its refresh rates (fastest first) and whether a sharp version exists. */
export function sizesOf(modes: StageDisplayMode[]): { width: number; height: number; rates: number[]; hidpi: boolean; lowres: boolean }[] {
  const by = new Map<string, { width: number; height: number; rates: Set<number>; hidpi: boolean; lowres: boolean }>();
  for (const m of modes) {
    const k = `${m.width}x${m.height}`;
    const e = by.get(k) ?? { width: m.width, height: m.height, rates: new Set<number>(), hidpi: false, lowres: false };
    if (m.refresh) e.rates.add(Math.round(m.refresh * 100) / 100);
    if (m.hidpi) e.hidpi = true; else e.lowres = true;
    by.set(k, e);
  }
  return [...by.values()].map((e) => ({ ...e, rates: [...e.rates].sort((a, b) => b - a) })).sort((a, b) => b.width * b.height - a.width * a.height);
}

/** "2560 × 1440", "1920 × 1080 (sharp)". */
export const sizeWords = (m: { width: number; height: number; hidpi?: boolean }) => `${m.width} × ${m.height}${m.hidpi ? ' (sharp)' : ''}`;
export const rateWords = (r?: number) => (r ? `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')} Hz` : 'Automatic');

/** The mode to switch to for a wanted size, refresh rate and sharpness, or null when the screen has no such mode. */
export function pickMode(modes: StageDisplayMode[], want: ModeChoice): StageDisplayMode | null {
  const same = modes.filter((m) => m.width === want.width && m.height === want.height && (want.hidpi === undefined || !!m.hidpi === want.hidpi));
  if (!same.length) return null;
  if (!want.refresh) return same.find((m) => m.current) ?? same.sort((a, b) => (b.refresh ?? 0) - (a.refresh ?? 0))[0];
  return same.sort((a, b) => Math.abs((a.refresh ?? 0) - want.refresh!) - Math.abs((b.refresh ?? 0) - want.refresh!))[0];
}

// ---------------------------------------------------------------- KDE (kscreen-doctor)

/** `kscreen-doctor -o` (colours off): outputs, their modes ("1:1920x1080@60*!" — * current, ! preferred) and which is built in. */
export function parseKscreen(out: string): { output: string; builtIn: boolean; primary: boolean; modes: (StageDisplayMode & { kid: string })[] }[] {
  const res: { output: string; builtIn: boolean; primary: boolean; modes: (StageDisplayMode & { kid: string })[] }[] = [];
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  for (const block of clean.split(/\n(?=Output:)/)) {
    const head = block.match(/^Output:\s*\d+\s+(\S+)\s+(enabled|disabled)?\s*(connected|disconnected)?/);
    if (!head || head[3] === 'disconnected' || head[2] === 'disabled') continue;
    const modesLine = block.match(/Modes:\s*([^\n]+)/)?.[1] ?? '';
    const modes = [...modesLine.matchAll(/(\d+):(\d+)x(\d+)@([\d.]+)([*!]*)/g)].map((m) => ({ kid: m[1], width: +m[2], height: +m[3], refresh: Math.round(+m[4] * 100) / 100, ...(m[5].includes('*') ? { current: true } : {}) }));
    res.push({ output: head[1], builtIn: /^(eDP|LVDS|DSI)/i.test(head[1]) || /Panel|Built-?in/i.test(block.match(/Type:\s*(\S+)/)?.[1] ?? ''), primary: /primary/i.test(block), modes });
  }
  return res;
}

/** Built-in panels on Linux are named eDP-1, LVDS-1 or DSI-1. */
export const linuxBuiltIn = (output: string) => /^(eDP|LVDS|DSI)/i.test(output);

/** The command that sets a mode, for the tools on Linux (argument lists, never a shell). */
export function linuxModeCmd(how: ScreenInfo['how'], output: string, m: StageDisplayMode & { kid?: string }): { file: string; args: string[] } {
  if (!/^[\w.:-]{1,40}$/.test(output)) throw new Error('Not a screen name');
  const size = `${Math.round(m.width)}x${Math.round(m.height)}`;
  if (how === 'xrandr') return { file: 'xrandr', args: ['--output', output, '--mode', size, ...(m.refresh ? ['--rate', String(m.refresh)] : [])] };
  if (how === 'wlr') return { file: 'wlr-randr', args: ['--output', output, '--mode', `${size}${m.refresh ? `@${m.refresh}Hz` : ''}`] };
  if (how === 'kscreen') return { file: 'kscreen-doctor', args: [`output.${output}.mode.${m.kid && /^\d+$/.test(m.kid) ? m.kid : `${size}@${Math.round(m.refresh ?? 60)}`}`] };
  throw new Error('Not a Linux screen');
}

// ---------------------------------------------------------------- presets

export interface DisplayPreset {
  id: string;
  name: string;
  /** the set of screens it is for (setKey) */
  set: string;
  modes: Record<string, ModeChoice>;
  /** applied by itself when this set of screens is connected */
  auto: boolean;
}

/** One key for the screens connected now, whatever order they are listed in. */
export const setKey = (screens: Pick<ScreenInfo, 'id'>[]) => screens.map((s) => s.id).sort().join('+');

/** A preset from what the screens show now. */
export function presetFromNow(screens: ScreenInfo[], name: string, id: string): DisplayPreset {
  const modes: Record<string, ModeChoice> = {};
  for (const s of screens) {
    const cur = s.modes.find((m) => m.current);
    if (cur) modes[s.id] = { width: cur.width, height: cur.height, refresh: cur.refresh, ...(cur.hidpi ? { hidpi: true } : {}) };
  }
  return { id, name: name.trim().slice(0, 40) || 'My screens', set: setKey(screens), modes, auto: false };
}

/** The changes a preset makes now: only screens that are connected and not already in that mode. */
export function presetChanges(p: DisplayPreset, screens: ScreenInfo[]): { screen: ScreenInfo; mode: StageDisplayMode }[] {
  const out: { screen: ScreenInfo; mode: StageDisplayMode }[] = [];
  for (const s of screens) {
    const want = p.modes[s.id];
    if (!want) continue;
    const cur = s.modes.find((m) => m.current);
    if (cur && sameMode(cur, want)) continue;
    const m = pickMode(s.modes, want);
    if (m) out.push({ screen: s, mode: m });
  }
  return out;
}

/** The preset to apply by itself for the screens connected now, if one is marked so. */
export const autoPreset = (presets: DisplayPreset[], screens: ScreenInfo[]) => presets.find((p) => p.auto && p.set === setKey(screens)) ?? null;

// ---------------------------------------------------------------- matched brightness

export type SyncMode = 'off' | 'builtin' | 'schedule';

export interface BrightnessSettings {
  mode: SyncMode;
  /** per monitor (DisplayInfo id): added to the built-in screen's level, -50…+50 */
  offsets: Record<string, number>;
  /** schedule: day and evening levels, and when evening starts and ends (minutes after midnight) */
  day: number;
  evening: number;
  eveningFrom: number;
  eveningTo: number;
}

export interface DisplaysSettings {
  presets: DisplayPreset[];
  /** seconds a new mode waits for "Keep" before it switches back */
  confirmSeconds: number;
  brightness: BrightnessSettings;
}

export const defaultDisplaysSettings = (): DisplaysSettings => ({
  presets: [],
  confirmSeconds: 15,
  brightness: { mode: 'builtin', offsets: {}, day: 80, evening: 40, eveningFrom: 19 * 60, eveningTo: 7 * 60 },
});

const pct = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : d);
const minutes = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? ((Math.round(Number(v)) % 1440) + 1440) % 1440 : d);

export function normalizeDisplaysSettings(o: Partial<DisplaysSettings> | undefined): DisplaysSettings {
  const d = defaultDisplaysSettings();
  const v = o && typeof o === 'object' ? o : {};
  const b = (v.brightness && typeof v.brightness === 'object' ? v.brightness : {}) as Partial<BrightnessSettings>;
  const offsets: Record<string, number> = {};
  for (const [k, x] of Object.entries(b.offsets ?? {})) if (Number.isFinite(Number(x))) offsets[k] = Math.max(-50, Math.min(50, Math.round(Number(x))));
  return {
    presets: Array.isArray(v.presets) ? v.presets.filter((p) => p && typeof p.id === 'string' && typeof p.set === 'string' && p.modes && typeof p.modes === 'object').slice(0, 20).map((p) => ({ id: p.id, name: String(p.name ?? 'My screens').slice(0, 40), set: p.set, modes: p.modes, auto: p.auto === true })) : [],
    confirmSeconds: [10, 15, 30].includes(Number(v.confirmSeconds)) ? Number(v.confirmSeconds) : d.confirmSeconds,
    brightness: {
      mode: (['off', 'builtin', 'schedule'] as SyncMode[]).includes(b.mode as SyncMode) ? (b.mode as SyncMode) : d.brightness.mode,
      offsets,
      day: pct(b.day, d.brightness.day),
      evening: pct(b.evening, d.brightness.evening),
      eveningFrom: minutes(b.eveningFrom, d.brightness.eveningFrom),
      eveningTo: minutes(b.eveningTo, d.brightness.eveningTo),
    },
  };
}

/** The level a schedule asks for at this minute of the day (evening may run past midnight). */
export function scheduledLevel(b: BrightnessSettings, minuteOfDay: number): number {
  const { eveningFrom: f, eveningTo: t } = b;
  const evening = f <= t ? minuteOfDay >= f && minuteOfDay < t : minuteOfDay >= f || minuteOfDay < t;
  return evening ? b.evening : b.day;
}

/** Each monitor's level for a source level (the built-in screen's, or the schedule's), with its own offset. */
export const targetLevel = (source: number, offset = 0) => Math.max(0, Math.min(100, Math.round(source + offset)));

/**
 * Which monitors to change now: only those whose level is at least `step`
 * away from what they were last set to (DDC/CI is slow, and some monitors
 * flicker on every write).
 */
export function syncWrites(source: number, monitors: { id: string; last?: number }[], offsets: Record<string, number>, step = 3): { id: string; level: number }[] {
  return monitors.map((m) => ({ id: m.id, level: targetLevel(source, offsets[m.id] ?? 0), last: m.last })).filter((m) => m.last === undefined || Math.abs(m.level - m.last) >= step).map(({ id, level }) => ({ id, level }));
}

/** `/sys/class/backlight/*`: brightness out of max_brightness, as a percent. */
export const backlightPercent = (cur: string | undefined, max: string | undefined) => {
  const c = Number(cur);
  const m = Number(max);
  return Number.isFinite(c) && m > 0 ? Math.max(0, Math.min(100, Math.round((c / m) * 100))) : undefined;
};
