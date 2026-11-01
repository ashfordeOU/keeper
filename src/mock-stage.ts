// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode in the browser demo: presets start and stop on a pretend Mac,
// with the changes it would make and how they were put back.

import { planStage, SWITCHES } from '../core/stage/plan';
import { normalizePreset, normalizeStageSettings } from '../core/stage/presets';
import type { StageApi, StageCapture, StageSettings, StageStatus } from '../core/stage/types';

export function mockStage(emit: (ch: string, ...a: unknown[]) => void): { stage: StageApi } {
  let cfg: StageSettings = normalizeStageSettings(undefined);
  let st: StageStatus = { on: false, auto: false, applied: [], notices: [], platform: 'darwin' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const env = { os: 'darwin' as const, desktop: '', wayland: false, tools: [], schemas: [], extensions: [] };
  const capture: StageCapture = { active: false, sources: [], method: 'Keeper’s recorder (reliable), the system’s capture controls and known recorder apps in front (a guess: macOS has no public signal)' };
  const changed = () => emit('stage-changed', structuredClone(st));
  const begin = (id?: string, reason = 'Stage page') => {
    const p = cfg.presets.find((x) => x.id === (id ?? cfg.preset)) ?? cfg.presets[0];
    const plan = planStage(p.switches, env);
    const label = (sw: string) => SWITCHES.find((s) => s.id === sw)?.label ?? sw;
    st = {
      on: true, preset: p.id, presetName: p.name, since: Date.now(), endsAt: p.limitMin ? Date.now() + p.limitMin * 60_000 : undefined, reason, auto: false, platform: 'darwin', notices: [],
      applied: [
        ...plan.values.map((v) => ({ switch: v.switch, label: v.label, ok: true })),
        ...plan.actions.map((a) => ({ switch: a, label: label(a), ok: true, note: a === 'hideOtherApps' ? '6 hidden' : a === 'pauseMusic' ? 'Paused Music' : undefined })),
        ...plan.skipped.map((k) => ({ switch: k.switch, label: label(k.switch), ok: false, note: k.note })),
      ],
    };
    changed();
    return structuredClone(st);
  };
  const end = () => {
    if (!st.on) return structuredClone(st);
    const back = st.applied.filter((a) => a.ok).map((a) => ({ label: a.label, outcome: a.switch === 'hideDock' ? 'left' as const : 'restored' as const, note: a.switch === 'hideDock' ? 'You changed it while Stage was on' : undefined }));
    st = { on: false, auto: false, applied: [], notices: [], platform: 'darwin', lastRevert: back };
    clearTimeout(timer);
    changed();
    return structuredClone(st);
  };
  const save = (patch: Partial<StageSettings>) => {
    cfg = normalizeStageSettings({ ...cfg, ...patch });
    return structuredClone(cfg);
  };
  const stage: StageApi = {
    status: async () => structuredClone(st),
    start: async (id, o) => {
      const p = cfg.presets.find((x) => x.id === (id ?? cfg.preset));
      if (st.on) end();
      if (p?.countdown && !o?.skipCountdown) {
        st = { ...st, countdownEndsAt: Date.now() + p.countdown * 1000, presetName: p.name };
        changed();
        await new Promise((r) => { timer = setTimeout(r, p.countdown * 1000); });
        st.countdownEndsAt = undefined;
      }
      return begin(id, o?.reason);
    },
    stop: async () => end(),
    toggle: async (id) => (st.on ? end() : begin(id, 'Island')),
    extend: async (m) => { if (st.on) { st.endsAt = (st.endsAt ?? Date.now()) + m * 60_000; changed(); } return structuredClone(st); },
    settings: async () => structuredClone(cfg),
    setSettings: async (patch) => save(patch),
    savePreset: async (p) => {
      const n = normalizePreset(p);
      if (!n) return structuredClone(cfg);
      return save({ presets: cfg.presets.some((x) => x.id === n.id) ? cfg.presets.map((x) => (x.id === n.id ? n : x)) : [...cfg.presets, n] });
    },
    removePreset: async (id) => save({ presets: cfg.presets.filter((p) => p.id !== id || p.builtIn) }),
    support: async () => SWITCHES,
    journal: async () => (st.on ? { pid: 4242, startedAt: st.since ?? Date.now(), preset: st.preset ?? '', entries: [] } : null),
    detect: async () => ({ ...capture, sources: [{ label: 'Keeper is recording the screen', reliable: true }], active: true }),
    modes: async () => [
      { width: 3024, height: 1964, refresh: 120, hidpi: false }, { width: 2560, height: 1440, refresh: 60, hidpi: true }, { width: 1920, height: 1080, refresh: 60, hidpi: true },
      { width: 1512, height: 982, refresh: 120, hidpi: true, current: true }, { width: 1280, height: 720, refresh: 60, hidpi: true },
    ],
    apps: async () => ['Calendar', 'Finder', 'Keynote', 'Mail', 'Messages', 'Music', 'Notes', 'OBS', 'Safari', 'Slack', 'Spotify', 'Terminal', 'zoom.us'],
    preview: async () => true,
    displayInputs: async () => ({ current: 0x0f, inputs: [{ code: 0x0f, label: 'DisplayPort 1' }, { code: 0x11, label: 'HDMI 1' }, { code: 0x12, label: 'HDMI 2' }, { code: 0x1b, label: 'USB-C' }] }),
    setDisplayInput: async () => undefined,
    overlays: async () => [],
    tray: async () => (st.on ? [`● Stage: ${st.presetName}`, '  Stop Stage', '  Add 15 minutes'] : ['Stage', ...cfg.presets.map((p) => `  ${p.name}`), '  —', '  Stage Settings…']),
  };
  return { stage };
}
