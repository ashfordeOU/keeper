// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice settings: defaults, and merging a change into what is saved. Speech
// stays on this computer unless the person picks a service.

import type { DeepPartial, HoldKey, VoiceSettings } from './types';

export const HOLD_KEYS: { id: HoldKey; label: string; mac?: boolean }[] = [
  { id: 'fn', label: 'fn (Globe)', mac: true },
  { id: 'rightAlt', label: 'Right Option / Alt' },
  { id: 'rightCtrl', label: 'Right Control' },
  { id: 'rightMeta', label: 'Right Command / Windows' },
  { id: 'rightShift', label: 'Right Shift' },
  { id: 'capsLock', label: 'Caps Lock' },
  { id: 'f13', label: 'F13' }, { id: 'f14', label: 'F14' }, { id: 'f15', label: 'F15' }, { id: 'f16', label: 'F16' },
  { id: 'f17', label: 'F17' }, { id: 'f18', label: 'F18' }, { id: 'f19', label: 'F19' },
  { id: 'f5', label: 'F5' }, { id: 'f9', label: 'F9' }, { id: 'scrollLock', label: 'Scroll Lock' }, { id: 'pause', label: 'Pause' },
];

export const holdKeyLabel = (k: HoldKey, platform: string = 'linux') => {
  const l = HOLD_KEYS.find((h) => h.id === k)?.label ?? k;
  if (platform === 'darwin') return l.replace(' / Alt', '').replace(' / Windows', '').replace('Right Option', 'Right ⌥ Option').replace('Right Command', 'Right ⌘ Command');
  return l.replace('Option / ', '').replace('Command / ', '');
};

export function defaultVoiceSettings(platform: string = 'linux'): VoiceSettings {
  return {
    dictation: {
      key: platform === 'darwin' ? 'rightAlt' : 'rightCtrl',
      mode: 'hold',
      doubleTapLatch: true,
      shortcut: 'CommandOrControl+Shift+;',
      editShortcut: 'CommandOrControl+Shift+\'',
      engine: 'device',
      model: 'base',
      language: 'auto',
      translate: false,
      review: false,
      commands: 'everywhere',
      fillers: true,
      formatting: true,
      tone: 'auto',
      aiPolish: false,
      insert: 'paste',
      silenceSec: 2.5,
      maxSec: 180,
      sounds: true,
      hud: 'both',
      corner: 'bottom',
      mic: '',
      history: true,
      historyCap: 500,
      keepAudio: false,
      voiceEdit: 'ask',
      typingWpm: 40,
      codeTerms: false,
    },
    meetings: {
      detect: true,
      systemAudio: true,
      diarize: true,
      autoNotes: true,
      notesTarget: { kind: 'none' },
      notesAi: 'local',
      actionsToTasks: false,
      keepAudio: false,
      language: 'auto',
      model: 'base',
      liveForAI: false,
      rememberVoices: true,
      extraApps: [],
    },
    surfaces: { tray: true, island: true, palette: true },
    apps: [
      // Terminals and editors: commands on, exact text, typed rather than pasted where pasting misbehaves.
      { id: 'terminal', app: 'Terminal', tone: 'verbatim', mode: 'exact', commands: true },
      { id: 'iterm', app: 'iTerm', tone: 'verbatim', mode: 'exact', commands: true },
      { id: 'wt', app: 'WindowsTerminal', tone: 'verbatim', mode: 'exact', commands: true },
      { id: 'gnome-terminal', app: 'gnome-terminal', tone: 'verbatim', mode: 'exact', commands: true },
      { id: 'konsole', app: 'konsole', tone: 'verbatim', mode: 'exact', commands: true },
      { id: 'code', app: 'Code', tone: 'neutral', mode: 'auto', commands: true },
      { id: 'mail', app: 'Mail', tone: 'professional' },
      { id: 'outlook', app: 'Outlook', tone: 'professional' },
      { id: 'slack', app: 'Slack', tone: 'casual' },
      { id: 'messages', app: 'Messages', tone: 'casual' },
      { id: 'discord', app: 'Discord', tone: 'casual' },
      { id: '1password', app: '1Password', exclude: true },
      { id: 'keepass', app: 'KeePass', exclude: true },
      { id: 'bitwarden', app: 'Bitwarden', exclude: true },
    ],
    dictionary: [],
    snippets: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merges a change; arrays are replaced whole. Unknown keys are dropped. */
export function mergeVoiceSettings<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!isObj(patch) || !isObj(base)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in out) || v === undefined) continue;
    const cur = out[k];
    if (isObj(cur) && isObj(v) && !('kind' in v)) out[k] = mergeVoiceSettings(cur, v as never);
    else if (Array.isArray(cur) ? Array.isArray(v) : typeof cur === typeof v || (isObj(cur) && isObj(v))) out[k] = v;
  }
  return out as T;
}

/** Saved settings with anything missing filled in and anything out of range pulled back. */
export function normalizeVoiceSettings(saved: unknown, platform: string = 'linux'): VoiceSettings {
  const s = mergeVoiceSettings(defaultVoiceSettings(platform), saved as DeepPartial<VoiceSettings>);
  const d = s.dictation;
  d.silenceSec = clamp(d.silenceSec, 0.8, 8);
  d.maxSec = clamp(d.maxSec, 10, 900);
  d.historyCap = clamp(Math.round(d.historyCap), 0, 10_000);
  d.typingWpm = clamp(d.typingWpm, 10, 200);
  if (!HOLD_KEYS.some((k) => k.id === d.key)) d.key = defaultVoiceSettings(platform).dictation.key;
  if (!['tiny', 'base', 'small', 'turbo'].includes(d.model)) d.model = 'base';
  if (!['tiny', 'base', 'small', 'turbo'].includes(s.meetings.model)) s.meetings.model = 'base';
  s.apps = s.apps.filter((a) => a && typeof a.app === 'string' && a.app.trim());
  s.dictionary = s.dictionary.filter((e) => e && typeof e.word === 'string' && e.word.trim());
  s.snippets = s.snippets.filter((e) => e && typeof e.trigger === 'string' && e.trigger.trim() && typeof e.text === 'string');
  return s;
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
