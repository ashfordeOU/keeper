// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for Wallpaper & Vibes (`npm run demo`): a live wallpaper on two
// displays, a few vibes, a schedule, a sound mix and changed folder icons.

import { normalizeMix } from '../core/scenes/ambient';
import type { AmbienceApi, AmbienceState } from '../core/scenes/api';
import { normalizeSource, paletteById, surprise } from '../core/scenes/catalog';
import { defaultAmbience, normalizeAmbience, normalizeVibe, presetRules, scheduledVibe, stepVibe, describeRule, type AmbienceSettings } from '../core/vibes';

export function mockAmbience(emit: (channel: string, ...args: unknown[]) => void, home: string): { ambience: AmbienceApi } {
  const base = defaultAmbience();
  let a: AmbienceSettings = normalizeAmbience({
    ...base,
    activeVibe: 'evening',
    wallpaper: { ...base.wallpaper, enabled: true, default: base.vibes.find((v) => v.id === 'evening')!.wallpaper!, perDisplay: { '2': normalizeSource({ kind: 'scene', scene: 'contours', palette: 'paper', params: {} }) } },
    sound: { ...base.sound, mix: { rain: 0.55, cafe: 0.3 }, master: 0.5 },
    schedule: { ...base.schedule, enabled: true, rules: [...presetRules('day-night', base.vibes), ...presetRules('battery', base.vibes)] },
    folderIcons: [
      { folder: `${home}/Projects`, appliedAt: Date.now() - 86_400_000 * 3, spec: { pattern: 'gradient', color: '#4f7cff', color2: '#9db4ff', symbol: '💼' }, iconFile: '', platform: 'darwin', previous: {} },
      { folder: `${home}/Pictures/Holidays`, appliedAt: Date.now() - 86_400_000, spec: { pattern: 'dots', color: '#f5a524', color2: '#ffe0a3', symbol: '📷' }, iconFile: '', platform: 'darwin', previous: {} },
    ],
  });
  let paused = false;
  const displays = [
    { id: '1', label: 'Built-in Retina Display', primary: true, width: 1512, height: 982, scaleFactor: 2 },
    { id: '2', label: 'Studio Display', primary: false, width: 2560, height: 1440, scaleFactor: 2 },
  ];
  const state = (): AmbienceState => {
    const sched = scheduledVibe(a.schedule, { now: Date.now(), place: null, manualSun: a.schedule.manualSun, onBattery: false, batteryPercent: 82, focusActive: false });
    return {
      settings: structuredClone(a),
      displays: displays.map((d) => {
        const source = a.wallpaper.perDisplay[d.id] ?? a.wallpaper.default;
        return { ...d, source, live: a.wallpaper.enabled && source.kind !== 'none' ? { strategy: 'desktop-window', running: !paused, fps: 30, scale: 0.75, reason: paused ? 'Paused by you' : undefined } : null };
      }),
      strategy: 'desktop-window',
      strategyNote: 'A window at desktop level on each display, behind the icons.',
      scheduled: { vibe: sched.vibe, rule: sched.rule ? describeRule(sched.rule, a.vibes) : null },
      features: { wallpaper: true, vibes: true, ambientSound: true, folderIcons: true },
      caps: { live: true, still: true, folderIcons: true, folderIconsHow: 'Finder icons, set with NSWorkspace (removing one restores the original).', lockScreen: 'The lock screen shows the desktop picture on macOS 14 and later.' },
      platform: 'darwin',
    };
  };
  const set = (patch: Partial<AmbienceSettings>) => { a = normalizeAmbience({ ...a, ...patch }); emit('ambience-changed'); return state(); };
  const ok = async () => state();
  return {
    ambience: {
      state: ok,
      set: async (p) => set(p),
      setWallpaper: async (d, src) => set({ wallpaper: d === 'all' ? { ...a.wallpaper, default: normalizeSource(src), perDisplay: {} } : { ...a.wallpaper, perDisplay: { ...a.wallpaper.perDisplay, [d]: normalizeSource(src) } } }),
      setPlaying: async (on) => { paused = false; return set({ wallpaper: { ...a.wallpaper, enabled: on } }); },
      surprise: async () => set({ wallpaper: { ...a.wallpaper, default: surprise(Math.random, a.wallpaper.default, a.palettes), perDisplay: {} } }),
      applyVibe: async (id) => {
        const v = a.vibes.find((x) => x.id === id);
        if (!v) return state();
        return set({ activeVibe: id, wallpaper: v.wallpaper ? { ...a.wallpaper, default: v.wallpaper, perDisplay: {} } : a.wallpaper, sound: v.sound ? { ...a.sound, ...v.sound } : a.sound });
      },
      stepVibe: async (dir) => { const v = stepVibe(a.vibes, a.activeVibe, dir); return v ? set({ activeVibe: v.id, wallpaper: v.wallpaper ? { ...a.wallpaper, default: v.wallpaper } : a.wallpaper }) : state(); },
      saveVibe: async (v) => { const n = normalizeVibe(v)!; return set({ vibes: a.vibes.some((x) => x.id === n.id) ? a.vibes.map((x) => (x.id === n.id ? n : x)) : [...a.vibes, n] }); },
      removeVibe: async (id) => set({ vibes: a.vibes.filter((v) => v.id !== id) }),
      captureVibe: async (name) => set({ vibes: [...a.vibes, { id: `v${Date.now()}`, name, emoji: '✨', wallpaper: a.wallpaper.default, theme: null, appearance: null, sound: { playing: true, mix: a.sound.mix, master: a.sound.master }, widgets: null, focusMinutes: null }] }),
      resetStarters: async () => set({ vibes: defaultAmbience().vibes }),
      saveRules: async (rules) => set({ schedule: { ...a.schedule, rules } }),
      savePalette: async (p) => set({ palettes: [...a.palettes.filter((x) => x.id !== p.id), p] }),
      removePalette: async (id) => set({ palettes: a.palettes.filter((x) => x.id !== id) }),
      pickMedia: async () => null,
      setStill: async () => ({ ok: true, how: 'NSWorkspace', path: '/tmp/still.png' }),
      restoreDesktop: async () => ({ ok: true }),
      cost: async () => ({ displays: displays.map((d) => ({ id: d.id, cpu: paused ? 0 : d.id === '1' ? 3.1 : 4.4, fps: paused ? 0 : 30, frameMs: 0.6, running: !paused })), gpuCpu: paused ? 0.2 : 5.8, sampledMs: 2000 }),
      setMix: async (mix, master) => set({ sound: { ...a.sound, mix: normalizeMix(mix), master: master ?? a.sound.master } }),
      setSoundPlaying: async (on) => set({ sound: { ...a.sound, playing: on } }),
      sleep: async (m) => set({ sound: { ...a.sound, sleepAt: m ? Date.now() + m * 60_000 : null } }),
      openMixer: async () => undefined,
      closeMixer: async () => undefined,
      pickFolders: async () => [],
      applyFolderIcon: async () => ({ done: [], failed: [] }),
      restoreFolderIcon: async (folders) => { set({ folderIcons: a.folderIcons.filter((r) => !folders.includes(r.folder)) }); return { done: folders, failed: [] }; },
      folderIcons: async () => a.folderIcons,
      trayPreview: async () => [{ label: 'Desktop & Vibes', enabled: true, submenu: a.vibes.map((v) => ({ label: `${v.emoji}  ${v.name}`, checked: v.id === a.activeVibe, enabled: true })) }],
      frame: async () => ({ display: '1', source: a.wallpaper.default, palette: paletteById(a.wallpaper.default.kind === 'scene' ? a.wallpaper.default.palette : 'polar', a.palettes), policy: { run: !paused, fps: 30, scale: 0.75 } }),
      report: () => undefined,
      ready: () => undefined,
    },
  };
}
