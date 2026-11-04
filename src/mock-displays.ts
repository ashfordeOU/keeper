// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's displays: a laptop screen and a 4K monitor.

import type { BrightnessState, DisplaysApi, DisplaysState } from '../core/api-displays';
import { defaultDisplaysSettings, pickMode, presetFromNow, type DisplayPreset, type ScreenInfo } from '../core/display-modes';

export function mockDisplays(): { displays: DisplaysApi } {
  let screens: ScreenInfo[] = [
    { id: '1', name: 'Built-in screen', main: true, builtIn: true, how: 'mac', modes: [{ id: 'a', width: 1512, height: 982, refresh: 120, hidpi: true, current: true }, { id: 'b', width: 1800, height: 1169, refresh: 120, hidpi: true }, { id: 'c', width: 1512, height: 982, refresh: 60, hidpi: true }] },
    { id: '2', name: 'Studio monitor', main: false, builtIn: false, how: 'mac', modes: [{ id: 'd', width: 2560, height: 1440, refresh: 60, hidpi: true, current: true }, { id: 'e', width: 3840, height: 2160, refresh: 60 }, { id: 'f', width: 1920, height: 1080, refresh: 60, hidpi: true }] },
  ];
  let presets: DisplayPreset[] = [];
  let b = defaultDisplaysSettings().brightness;
  const state = async (): Promise<DisplaysState> => ({ screens, presets, confirmSeconds: 15 });
  const brightness = async (): Promise<BrightnessState> => ({ settings: b, builtIn: 70, canFollow: true, monitors: [{ id: 'kh:0', name: 'Studio monitor', external: true, brightness: 70 }] });
  return {
    displays: {
      state,
      setMode: async (id, want) => {
        screens = screens.map((s) => { if (s.id !== id) return s; const m = pickMode(s.modes, want); return m ? { ...s, modes: s.modes.map((x) => ({ ...x, current: x === m })) } : s; });
        return { ok: true, message: 'Keep this?' };
      },
      keep: state,
      revert: state,
      savePreset: async (name) => { presets = [...presets, presetFromNow(screens, name, `p${presets.length}`)]; return state(); },
      removePreset: async (id) => { presets = presets.filter((p) => p.id !== id); return state(); },
      applyPreset: async () => ({ ok: true, message: 'Already in use' }),
      setPresetAuto: async (id, auto) => { presets = presets.map((p) => (p.id === id ? { ...p, auto } : p)); return state(); },
      brightness,
      setBrightness: async (patch) => { b = { ...b, ...patch }; return brightness(); },
    },
  };
}
