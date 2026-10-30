// SPDX-License-Identifier: AGPL-3.0-or-later
// Default settings and a lenient reader for settings loaded from disk.

import type { IslandSettings } from './api';
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
  };
}

export function defaultSettings(folders: string[], rules: Rule[]): AllSettings {
  return {
    look: 'playful',
    appearance: 'system',
    folders,
    excluded: [],
    showHidden: false,
    quickSearchShortcut: 'CommandOrControl+Shift+Space',
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
    ai: { provider: 'anthropic', model: '', ollamaUrl: 'http://127.0.0.1:11434' },
    widgets: [],
    updateCheck: true,
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
  return out;
}
