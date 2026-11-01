// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Screen sizes for Stage's recording resolution: reading what each system
// offers and picking the mode closest to what was asked.

import type { StageDisplayMode } from './types';

export interface OutputModes { output: string; primary: boolean; modes: StageDisplayMode[] }

/** `xrandr --query`: connected outputs and their modes ("*" current, "+" preferred). */
export function parseXrandr(out: string): OutputModes[] {
  const res: OutputModes[] = [];
  let cur: OutputModes | null = null;
  for (const line of out.split(/\r?\n/)) {
    const head = line.match(/^(\S+) connected( primary)?/);
    if (head) { cur = { output: head[1], primary: !!head[2], modes: [] }; res.push(cur); continue; }
    if (/^\S/.test(line)) { cur = null; continue; }
    const m = line.match(/^\s+(\d+)x(\d+)\S*\s+(.*)$/);
    if (!m || !cur) continue;
    for (const r of m[3].matchAll(/([\d.]+)(\*)?(\+)?/g)) {
      const mode: StageDisplayMode = { width: +m[1], height: +m[2], refresh: Math.round(+r[1] * 100) / 100 };
      if (r[2]) mode.current = true;
      cur.modes.push(mode);
    }
  }
  return res;
}

/** `wlr-randr`: outputs, their modes and which one is current. */
export function parseWlrRandr(out: string): OutputModes[] {
  const res: OutputModes[] = [];
  let cur: OutputModes | null = null;
  for (const line of out.split(/\r?\n/)) {
    const head = line.match(/^(\S+)\s+"/);
    if (head) { cur = { output: head[1], primary: res.length === 0, modes: [] }; res.push(cur); continue; }
    const m = line.match(/^\s+(\d+)x(\d+) px, ([\d.]+) Hz(.*)$/);
    if (m && cur) cur.modes.push({ width: +m[1], height: +m[2], refresh: Math.round(+m[3] * 100) / 100, ...(/current/.test(m[4]) ? { current: true } : {}) });
  }
  return res;
}

/** The Windows script's output: "cur W H F" then one "W H F" per mode. */
export function parseWinModes(out: string): StageDisplayMode[] {
  const modes: StageDisplayMode[] = [];
  let current: { w: number; h: number; f: number } | null = null;
  for (const line of out.split(/\r?\n/)) {
    const c = line.match(/^cur (\d+) (\d+) (\d+)/);
    if (c) { current = { w: +c[1], h: +c[2], f: +c[3] }; continue; }
    const m = line.match(/^(\d+) (\d+) (\d+)/);
    if (m) modes.push({ width: +m[1], height: +m[2], refresh: +m[3] });
  }
  return dedupe(modes.map((m) => (current && m.width === current.w && m.height === current.h && m.refresh === current.f ? { ...m, current: true } : m)));
}

/** One entry per size and refresh rate, biggest first. */
export function dedupe(modes: StageDisplayMode[]): StageDisplayMode[] {
  const seen = new Map<string, StageDisplayMode>();
  for (const m of modes) {
    const k = `${m.width}x${m.height}@${m.refresh ?? 0}${m.hidpi ? 'h' : ''}`;
    const prev = seen.get(k);
    if (!prev || (m.current && !prev.current)) seen.set(k, m);
  }
  return [...seen.values()].sort((a, b) => b.width * b.height - a.width * a.height || (b.refresh ?? 0) - (a.refresh ?? 0));
}

/**
 * The mode to switch to for a wanted size: the exact size (keeping the
 * current refresh rate if it can, and HiDPI on a Mac), else the largest mode
 * that fits inside it with the same shape, else null.
 */
export function chooseMode(modes: StageDisplayMode[], width: number, height: number): StageDisplayMode | null {
  const now = modes.find((m) => m.current);
  const exact = modes.filter((m) => m.width === width && m.height === height);
  if (exact.length) {
    return exact.sort((a, b) => Number(!!b.hidpi) - Number(!!a.hidpi) || Math.abs((a.refresh ?? 60) - (now?.refresh ?? 60)) - Math.abs((b.refresh ?? 60) - (now?.refresh ?? 60)))[0];
  }
  const ratio = width / height;
  const fit = modes.filter((m) => m.width <= width && m.height <= height && Math.abs(m.width / m.height - ratio) < 0.02);
  return fit.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

/** Common recording sizes, offered first in the picker. */
export const RECORDING_SIZES: [number, number][] = [[1920, 1080], [1280, 720], [2560, 1440], [1440, 900], [1680, 1050], [3840, 2160]];
