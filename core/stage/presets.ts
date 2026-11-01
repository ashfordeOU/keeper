// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's presets and settings: the three that come with Keeper
// (Recording, Presenting, Screenshot), your own, and a lenient reader for
// settings loaded from disk.

import type { DisplayKeySettings, StageAppRule, StagePreset, StageSettings, StageSwitches } from './types';

export const NO_SWITCHES: StageSwitches = {
  hideDesktopIcons: false,
  hideDock: false,
  hideOtherApps: false,
  hideMenuBar: false,
  apps: [],
  dnd: false,
  muteAlerts: false,
  pauseMusic: false,
  backdrop: { kind: 'off', color: '#1d2230', color2: '#3b4a6b' },
  neutralCursor: false,
  spotlight: { mode: 'off', size: 'm', dim: 55 },
  clicks: false,
  keystrokes: 'off',
  keepAwake: false,
  resolution: { mode: 'keep', width: 1920, height: 1080 },
  cleanClipboard: false,
  hidePrivate: false,
  keepKeeperOut: false,
};

const sw = (patch: Partial<StageSwitches>): StageSwitches => ({ ...structuredClone(NO_SWITCHES), ...patch });

export const BUILT_IN: StagePreset[] = [
  {
    id: 'recording', name: 'Recording', builtIn: true, countdown: 3, limitMin: 0, shortcut: '',
    switches: sw({
      hideDesktopIcons: true, hideDock: true, hideOtherApps: true, hideMenuBar: false, dnd: true, muteAlerts: true, pauseMusic: true,
      backdrop: { kind: 'blur', color: '#1d2230', color2: '#3b4a6b' }, neutralCursor: true, clicks: true, keystrokes: 'shortcuts',
      keepAwake: true, cleanClipboard: true, hidePrivate: true, keepKeeperOut: true,
    }),
  },
  {
    id: 'presenting', name: 'Presenting', builtIn: true, countdown: 0, limitMin: 0, shortcut: '',
    switches: sw({
      hideDesktopIcons: true, dnd: true, muteAlerts: true, pauseMusic: true,
      spotlight: { mode: 'highlight', size: 'm', dim: 55 }, keepAwake: true, cleanClipboard: true, hidePrivate: true,
    }),
  },
  {
    id: 'screenshot', name: 'Screenshot', builtIn: true, countdown: 0, limitMin: 15, shortcut: '',
    switches: sw({
      hideDesktopIcons: true, hideDock: true, hideOtherApps: true, hideMenuBar: true, dnd: true, muteAlerts: true,
      backdrop: { kind: 'gradient', color: '#1d2230', color2: '#3b4a6b' }, neutralCursor: true, cleanClipboard: true, hidePrivate: true, keepKeeperOut: true,
    }),
  },
];

/** What the older "Presentation mode" did, kept exactly: stay awake and hide desktop icons. */
export const LEGACY_PRESENTATION: StagePreset = {
  id: 'presentation-mode', name: 'Presentation mode', countdown: 0, limitMin: 0, shortcut: '',
  switches: sw({ keepAwake: true, hideDesktopIcons: true }),
};

/** Recorders and call apps stay on screen without being listed. */
export const ALWAYS_KEEP = [
  'OBS', 'obs', 'obs64', 'Loom', 'Screen Studio', 'CleanShot X', 'Kap', 'ScreenFlow', 'Camtasia', 'QuickTime Player', 'zoom.us', 'Zoom', 'Microsoft Teams', 'Teams', 'ms-teams',
  'Webex', 'Slack', 'Discord', 'FaceTime', 'Google Chrome', 'Keynote', 'PowerPoint', 'Microsoft PowerPoint', 'simplescreenrecorder', 'kazam', 'peek', 'vokoscreenNG', 'ShareX', 'ScreenToGif',
];

export const DEFAULT_DISPLAY_KEYS: DisplayKeySettings = {
  enabled: false,
  brightnessUp: 'Control+Alt+F2',
  brightnessDown: 'Control+Alt+F1',
  volumeUp: 'Control+Alt+F12',
  volumeDown: 'Control+Alt+F11',
  mediaVolumeKeys: false,
  target: 'all',
  step: 10,
};

export function defaultStageSettings(): StageSettings {
  return {
    preset: 'recording',
    presets: structuredClone(BUILT_IN),
    shortcut: 'CommandOrControl+Alt+Shift+R',
    keep: [],
    auto: { preset: 'recording', streams: true, apps: true, keeperRecorder: true, extraApps: [], stopWhenDone: true },
    surfaces: { tray: true, island: true, shortcut: true },
    displayKeys: { ...DEFAULT_DISPLAY_KEYS },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

export function normalizeSwitches(raw: unknown): StageSwitches {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StageSwitches>;
  const d = NO_SWITCHES;
  const apps: StageAppRule[] = Array.isArray(r.apps)
    ? r.apps.filter((a) => a && typeof a.name === 'string' && a.name.trim()).slice(0, 40).map((a) => ({ name: a.name.trim(), action: a.action === 'quit' ? 'quit' : 'hide', reopen: a.reopen === true }))
    : [];
  const bd = (r.backdrop ?? {}) as Partial<StageSwitches['backdrop']>;
  const sp = (r.spotlight ?? {}) as Partial<StageSwitches['spotlight']>;
  const rs = (r.resolution ?? {}) as Partial<StageSwitches['resolution']>;
  return {
    hideDesktopIcons: bool(r.hideDesktopIcons, d.hideDesktopIcons),
    hideDock: bool(r.hideDock, d.hideDock),
    hideOtherApps: bool(r.hideOtherApps, d.hideOtherApps),
    hideMenuBar: bool(r.hideMenuBar, d.hideMenuBar),
    apps,
    dnd: bool(r.dnd, d.dnd),
    muteAlerts: bool(r.muteAlerts, d.muteAlerts),
    pauseMusic: bool(r.pauseMusic, d.pauseMusic),
    backdrop: {
      kind: oneOf(bd.kind, ['off', 'solid', 'gradient', 'blur'] as const, 'off'),
      color: HEX.test(bd.color ?? '') ? bd.color! : d.backdrop.color,
      color2: HEX.test(bd.color2 ?? '') ? bd.color2! : d.backdrop.color2,
    },
    neutralCursor: bool(r.neutralCursor, d.neutralCursor),
    spotlight: { mode: oneOf(sp.mode, ['off', 'spotlight', 'highlight'] as const, 'off'), size: oneOf(sp.size, ['s', 'm', 'l'] as const, 'm'), dim: num(sp.dim, 55, 10, 90) },
    clicks: bool(r.clicks, d.clicks),
    keystrokes: oneOf(r.keystrokes, ['off', 'shortcuts', 'all'] as const, 'off'),
    keepAwake: bool(r.keepAwake, d.keepAwake),
    resolution: { mode: rs.mode === 'set' ? 'set' : 'keep', width: num(rs.width, 1920, 640, 7680), height: num(rs.height, 1080, 480, 4320) },
    cleanClipboard: bool(r.cleanClipboard, d.cleanClipboard),
    hidePrivate: bool(r.hidePrivate, d.hidePrivate),
    keepKeeperOut: bool(r.keepKeeperOut, d.keepKeeperOut),
  };
}

export function normalizePreset(raw: unknown, fallbackId = 'custom'): StagePreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StagePreset>;
  const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : fallbackId;
  const name = str(r.name, '').trim().slice(0, 40) || 'Custom';
  return { id, name, builtIn: BUILT_IN.some((b) => b.id === id) || undefined, switches: normalizeSwitches(r.switches), countdown: num(r.countdown, 0, 0, 10), limitMin: num(r.limitMin, 0, 0, 24 * 60), shortcut: str(r.shortcut, '') };
}

/** Bad fields fall back; the built-in presets are always there (your edits to them are kept). */
export function normalizeStageSettings(raw: unknown): StageSettings {
  const d = defaultStageSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<StageSettings>;
  const seen = new Set<string>();
  const presets: StagePreset[] = [];
  for (const p of Array.isArray(r.presets) ? r.presets : []) {
    const n = normalizePreset(p, `custom-${presets.length + 1}`);
    if (n && !seen.has(n.id)) { seen.add(n.id); presets.push(n); }
  }
  for (const b of BUILT_IN) if (!seen.has(b.id)) presets.splice(BUILT_IN.indexOf(b), 0, structuredClone(b));
  const has = (id: unknown) => typeof id === 'string' && presets.some((p) => p.id === id);
  const a = (r.auto ?? {}) as Partial<StageSettings['auto']>;
  const s = (r.surfaces ?? {}) as Partial<StageSettings['surfaces']>;
  const k = (r.displayKeys ?? {}) as Partial<DisplayKeySettings>;
  return {
    preset: has(r.preset) ? r.preset! : d.preset,
    presets,
    shortcut: str(r.shortcut, d.shortcut),
    keep: Array.isArray(r.keep) ? r.keep.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 60) : [],
    auto: {
      preset: has(a.preset) ? a.preset! : d.auto.preset,
      streams: bool(a.streams, true), apps: bool(a.apps, true), keeperRecorder: bool(a.keeperRecorder, true),
      extraApps: Array.isArray(a.extraApps) ? a.extraApps.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 40) : [],
      stopWhenDone: bool(a.stopWhenDone, true),
    },
    surfaces: { tray: bool(s.tray, true), island: bool(s.island, true), shortcut: bool(s.shortcut, true) },
    displayKeys: {
      enabled: bool(k.enabled, false),
      brightnessUp: str(k.brightnessUp, d.displayKeys.brightnessUp), brightnessDown: str(k.brightnessDown, d.displayKeys.brightnessDown),
      volumeUp: str(k.volumeUp, d.displayKeys.volumeUp), volumeDown: str(k.volumeDown, d.displayKeys.volumeDown),
      mediaVolumeKeys: bool(k.mediaVolumeKeys, false), target: str(k.target, 'all') || 'all', step: num(k.step, 10, 1, 50),
    },
  };
}

/** A new custom preset copied from another one. */
export function copyPreset(from: StagePreset, name: string, existing: StagePreset[]): StagePreset {
  let n = 1;
  while (existing.some((p) => p.id === `custom-${n}`)) n++;
  return { ...structuredClone(from), id: `custom-${n}`, name: name.trim().slice(0, 40) || `Custom ${n}`, builtIn: undefined, shortcut: '' };
}

/** How many switches a preset turns on (for the cards). */
export function countOn(s: StageSwitches): number {
  let n = 0;
  for (const [k, v] of Object.entries(s)) {
    if (k === 'apps') n += (v as StageAppRule[]).length ? 1 : 0;
    else if (k === 'backdrop') n += (v as StageSwitches['backdrop']).kind !== 'off' ? 1 : 0;
    else if (k === 'spotlight') n += (v as StageSwitches['spotlight']).mode !== 'off' ? 1 : 0;
    else if (k === 'resolution') n += (v as StageSwitches['resolution']).mode === 'set' ? 1 : 0;
    else if (k === 'keystrokes') n += v !== 'off' ? 1 : 0;
    else if (v === true) n++;
  }
  return n;
}
