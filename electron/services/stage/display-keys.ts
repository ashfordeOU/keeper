// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Brightness and volume shortcuts for external monitors over DDC/CI
// (Settings → Features → "Display keys"). The shortcuts are ordinary global
// shortcuts; optionally the keyboard's own volume keys are taken over too
// (Electron can register VolumeUp/VolumeDown; brightness keys cannot be
// registered by apps, so brightness uses the shortcuts you choose). Each press
// shows a small level HUD; presses in quick succession are sent as one change,
// because DDC/CI is slow.

import { globalShortcut } from 'electron';
import { stepLevel, type DisplayInfo } from '../../../core/display-control';
import type { DisplayKeySettings } from '../../../core/stage/types';
import { listDisplays, setDisplay } from '../display-control';
import { showHud } from './overlay';

let cache: { at: number; displays: DisplayInfo[] } | null = null;
const pending = new Map<string, NodeJS.Timeout>();

async function targets(cfg: DisplayKeySettings): Promise<DisplayInfo[]> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), displays: (await listDisplays()).displays };
  return cache.displays.filter((d) => cfg.target === 'all' || d.id === cfg.target);
}

/** One key press: change brightness or volume by a step on the target monitors. */
export async function nudge(cfg: DisplayKeySettings, control: 'brightness' | 'volume', dir: 1 | -1): Promise<number | null> {
  const ds = await targets(cfg);
  if (!ds.length) { showHud('No external display answers over DDC/CI', 0); return null; }
  let shown = 0;
  for (const d of ds) {
    const v = stepLevel(d[control], dir * cfg.step);
    d[control] = v;
    shown = v;
    const key = `${d.id}:${control}`;
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => { pending.delete(key); void setDisplay(d.id, control, v).catch(() => { cache = null; }); }, 180));
  }
  showHud(`${control === 'brightness' ? '☀︎ Brightness' : '🔊 Volume'} · ${ds.length === 1 ? ds[0].name : `${ds.length} displays`}`, shown);
  return shown;
}

/** Registers the shortcuts (called from Keeper's shortcut registration, so turning features off frees them). */
export function registerDisplayKeys(cfg: DisplayKeySettings) {
  const reg = (acc: string, fn: () => void) => {
    try { if (acc) globalShortcut.register(acc, fn); } catch { /* taken or invalid */ }
  };
  reg(cfg.brightnessUp, () => void nudge(cfg, 'brightness', 1));
  reg(cfg.brightnessDown, () => void nudge(cfg, 'brightness', -1));
  reg(cfg.volumeUp, () => void nudge(cfg, 'volume', 1));
  reg(cfg.volumeDown, () => void nudge(cfg, 'volume', -1));
  if (cfg.mediaVolumeKeys) {
    reg('VolumeUp', () => void nudge(cfg, 'volume', 1));
    reg('VolumeDown', () => void nudge(cfg, 'volume', -1));
  }
}

export function forgetDisplays() {
  cache = null;
}
