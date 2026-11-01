// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the person chose for Keeper's abilities: which are on, which services
// they use, and what may leave this computer. Keys live in the keychain, not here.

export type Permission = 'off' | 'ask' | 'allow';

export type SearchProviderId = 'searxng' | 'brave' | 'tavily' | 'exa' | 'kagi' | 'google' | 'xai' | 'free';
export type ImageProviderId = 'openai' | 'xai' | 'gemini' | 'stability' | 'automatic1111' | 'comfyui';
export type VoiceStt = 'off' | 'provider' | 'dictation';
export type VoiceTts = 'system' | 'openai' | 'off';

export interface Persona {
  id: string;
  name: string;
  /** how it talks and what it focuses on */
  instructions: string;
  /** a connection id, or empty for the one in use */
  connection?: string;
  voice?: string;
  /** an emoji or a short image path for its avatar */
  avatar?: string;
  /** memories it may use: its own and the shared ones */
  memoryScope?: 'own' | 'shared' | 'none';
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  /** folders the project's AI may search and read (inside the library) */
  folders: string[];
  persona?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** "every weekday at 8:30", "every monday 10:00", "in 2 hours", or a five-field cron line */
  when: string;
  /** where the result goes */
  deliver: ('island' | 'notification' | 'file')[];
  connection?: string;
  persona?: string;
  project?: string;
  enabled: boolean;
  lastRun?: number;
  lastResult?: string;
  /** one-off tasks switch themselves off after running */
  once?: boolean;
}

export interface AbilitiesSettings {
  enabled: boolean;
  permissions: Record<string, Permission>;
  /** nothing that would send data to a service on the internet (search, cloud images, cloud voice) */
  localOnly: boolean;
  search: { provider: SearchProviderId; searxngUrl: string; googleCx: string; region: string; safe: boolean };
  social: { mastodonInstance: string; blueskyHandle: string; redditClientId: string };
  images: { provider: ImageProviderId; model: string; localUrl: string; size: string; folder: string };
  research: { maxSteps: number; maxMinutes: number; maxPages: number; folder: string };
  code: { python: boolean; timeoutSec: number; memoryMb: number; allowNetwork: boolean };
  voice: { stt: VoiceStt; sttUrl: string; sttModel: string; tts: VoiceTts; ttsVoice: string; handsFree: boolean };
  memory: { on: boolean; /** memories may go to cloud AIs */ cloud: boolean; auto: boolean };
  personas: Persona[];
  projects: Project[];
  tasks: ScheduledTask[];
  /** groups of AIs and agent sessions that work together */
  teams: import('./teams').TeamSpec[];
  /** the gateway may add Keeper's abilities to plain chat clients */
  gatewayInject: boolean;
}

/** What each ability may do by default: reading the web is fine to allow; anything that spends money or runs code asks. */
export const DEFAULT_PERMISSIONS: Record<string, Permission> = {
  web_search: 'allow',
  fetch_page: 'allow',
  deep_research: 'ask',
  social_search: 'allow',
  image_generate: 'ask',
  image_edit: 'ask',
  look_at_image: 'allow',
  ask_document: 'allow',
  run_code: 'ask',
  remember: 'allow',
  recall: 'allow',
  forget: 'ask',
  schedule_task: 'ask',
  speak: 'allow',
};

export function defaultAbilities(): AbilitiesSettings {
  return {
    enabled: true,
    permissions: { ...DEFAULT_PERMISSIONS },
    localOnly: false,
    search: { provider: 'free', searxngUrl: 'http://127.0.0.1:8888', googleCx: '', region: '', safe: true },
    social: { mastodonInstance: 'mastodon.social', blueskyHandle: '', redditClientId: '' },
    images: { provider: 'openai', model: '', localUrl: 'http://127.0.0.1:7860', size: '1024x1024', folder: '' },
    research: { maxSteps: 6, maxMinutes: 5, maxPages: 8, folder: '' },
    code: { python: true, timeoutSec: 20, memoryMb: 256, allowNetwork: false },
    voice: { stt: 'dictation', sttUrl: 'https://api.openai.com/v1/audio/transcriptions', sttModel: 'whisper-1', tts: 'system', ttsVoice: '', handsFree: false },
    memory: { on: true, cloud: false, auto: false },
    personas: [],
    projects: [],
    tasks: [],
    teams: [],
    gatewayInject: false,
  };
}

/** Fills in anything missing from settings saved by an older Keeper. */
export function normalizeAbilities(a: Partial<AbilitiesSettings> | undefined): AbilitiesSettings {
  const d = defaultAbilities();
  if (!a || typeof a !== 'object') return d;
  return {
    ...d,
    ...a,
    permissions: { ...d.permissions, ...(a.permissions ?? {}) },
    search: { ...d.search, ...(a.search ?? {}) },
    social: { ...d.social, ...(a.social ?? {}) },
    images: { ...d.images, ...(a.images ?? {}) },
    research: { ...d.research, ...(a.research ?? {}) },
    code: { ...d.code, ...(a.code ?? {}) },
    voice: { ...d.voice, ...(a.voice ?? {}) },
    memory: { ...d.memory, ...(a.memory ?? {}) },
    personas: Array.isArray(a.personas) ? a.personas : [],
    projects: Array.isArray(a.projects) ? a.projects : [],
    tasks: Array.isArray(a.tasks) ? a.tasks : [],
    teams: Array.isArray(a.teams) ? a.teams : [],
  };
}
