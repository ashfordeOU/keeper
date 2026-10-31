// SPDX-License-Identifier: AGPL-3.0-or-later
// Default settings and a lenient reader for settings loaded from disk.

import type { IslandSettings } from './api';
import { defaultBrainSettings, normalizeBrainSettings } from './brain/config';
import { DEFAULT_PLATFORM } from './platform-integrations';
import { DEFAULT_THEME, THEMES } from './themes';
import type { Rule, Settings } from './types';

export type AllSettings = Settings & { island: IslandSettings };

export function defaultIsland(): IslandSettings {
  return {
    enabled: true,
    edge: 'top',
    displays: 'primary',
    buddy: true,
    clipboard: true,
    agents: true,
    lyrics: true,
    calendarUrl: '',
    dictationShortcut: 'CommandOrControl+Shift+;',
    dictationUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
    dictationModel: 'whisper-large-v3-turbo',
    soundOnAgent: true,
    weather: true,
    place: null,
    units: 'metric',
    breakEvery: 0,
    cleanLinks: true,
    captureShortcut: 'CommandOrControl+Shift+2',
    downloadAlerts: true,
    pasteShortcut: 'CommandOrControl+Shift+V',
    shelfShortcut: 'CommandOrControl+Shift+X',
    hideShortcut: 'CommandOrControl+Shift+H',
    awakeShortcut: 'CommandOrControl+Shift+A',
    edgeDrop: true,
    clipMax: 200,
    clipRetentionDays: 30,
    clipIgnoreApps: ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access', 'LastPass', 'Dashlane', 'Enpass', 'Proton Pass'],
    clipFetchTitles: false,
    clipPlainPaste: false,
    awakeTriggers: [],
    driveKeepAwake: null,
    notifyMirror: false,
    notifyApps: [],
    hideInFullscreen: true,
    upload: { kind: 'none', url: '', username: '', bucket: '', region: 'auto', accessKeyId: '', prefix: 'keeper', expiresHours: 72, publicUrl: '' },
    scriptActions: [],
    size: 'normal',
    blendNotch: true,
    cameraEdge: 'auto',
    followCamera: true,
    cameraDot: false,
    offsetX: 0,
    offsetY: 0,
    x11OnWayland: true,
    privacyDots: true,
    activitiesOff: [],
    hoverOpen: true,
  };
}

export function defaultSettings(folders: string[], rules: Rule[]): AllSettings {
  return {
    look: 'playful',
    appearance: 'system',
    theme: 'playful',
    accent: '',
    font: 'theme',
    density: 'comfortable',
    corners: 'theme',
    folders,
    excluded: [],
    showHidden: false,
    quickSearchShortcut: 'CommandOrControl+Shift+Space',
    platform: { ...DEFAULT_PLATFORM },
    trayEnabled: true,
    trayCount: 10,
    ocrEnabled: true,
    ocrLanguages: ['eng'],
    oldDownloadDays: 90,
    largeFileMb: 500,
    unusedAppDays: 180,
    rules,
    savedSearches: [],
    pinned: [],
    hiddenPlaces: [],
    recentServers: [],
    includeRemote: false,
    ai: { provider: 'anthropic', model: '', ollamaUrl: 'http://127.0.0.1:11434' },
    brain: defaultBrainSettings(),
    widgets: [],
    updateCheck: true,
    updateMode: 'auto',
    updateBeta: false,
    lastRunVersion: '',
    updatePlan: null,
    restorePlace: true,
    language: 'system',
    island: defaultIsland(),
  };
}

/** Bad or missing fields fall back to defaults instead of breaking the app. */
export function mergeSettings(base: AllSettings, raw: unknown): AllSettings {
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const out: AllSettings = { ...base };
  for (const k of Object.keys(base) as (keyof AllSettings)[]) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    const def = base[k];
    if (Array.isArray(def)) {
      if (Array.isArray(v)) (out as unknown as Record<string, unknown>)[k] = v;
    } else if (typeof def === 'object') {
      if (typeof v === 'object') (out as unknown as Record<string, unknown>)[k] = { ...(def as object), ...(v as object) };
    } else if (typeof v === typeof def) {
      (out as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (!['playful', 'minimal'].includes(out.look)) out.look = 'playful';
  if (!['system', 'light', 'dark'].includes(out.appearance)) out.appearance = 'system';
  // Settings from before themes only had a look; Minimal carries over.
  if (typeof r.theme !== 'string') out.theme = out.look === 'minimal' ? 'minimal' : out.theme;
  if (!THEMES.some((t) => t.id === out.theme)) out.theme = DEFAULT_THEME;
  if (out.accent && !/^#[0-9a-f]{6}$/i.test(out.accent)) out.accent = '';
  if (!['theme', 'system', 'rounded', 'serif', 'mono'].includes(out.font)) out.font = 'theme';
  if (!['comfortable', 'compact'].includes(out.density)) out.density = 'comfortable';
  if (!['theme', 'rounded', 'sharp'].includes(out.corners)) out.corners = 'theme';
  // Settings from before the brain had one AI choice; it becomes the active connection.
  out.brain = normalizeBrainSettings(r.brain && typeof r.brain === 'object' ? out.brain : undefined, out.ai);
  return out;
}
