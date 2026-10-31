// SPDX-License-Identifier: AGPL-3.0-or-later
// Every part of Keeper that can be switched off, what it costs while on, and
// what it needs. Turning a feature off really stops it: no window, no timers,
// no watchers, nothing loaded, and its pages, menu items and commands hidden.
//
// To add a feature: add an entry below. Give it `routes` (pages it owns) and
// `commands` (palette ids it owns) so the interface hides them, and in the
// main process ask `featureOn(id)` / `onFeature(id, …)` before starting
// anything (electron/services/features.ts).

import type { AllSettings } from './settings';

export type FeatureGroup = 'Library' | 'Tidy' | 'Island' | 'Desktop' | 'AI' | 'Connections' | 'System';

export const FEATURE_GROUPS: FeatureGroup[] = ['Library', 'Tidy', 'Island', 'Desktop', 'AI', 'Connections', 'System'];

export type CostLevel = 'none' | 'low' | 'medium' | 'high';

export interface FeatureCost {
  /** overall, for sorting and the coloured dot */
  level: CostLevel;
  /** plain English: what runs while it is on */
  background?: string;
  windows?: string;
  memory?: string;
}

export interface FeatureDef {
  id: string;
  name: string;
  description: string;
  group: FeatureGroup;
  defaultOn: boolean;
  cost: FeatureCost;
  /** other features this one needs; it is off while any of them is off */
  requires?: string[];
  /** cannot be switched off (the library itself) */
  always?: boolean;
  /** pages this feature owns: hidden from the sidebar and palette when off */
  routes?: string[];
  /** command palette ids (or id prefixes ending in "*") it owns */
  commands?: string[];
  /** only on these systems */
  platforms?: NodeJS.Platform[];
  /** an older setting already switches this: read and write through it */
  bridge?: { get(s: AllSettings): boolean; set(on: boolean, s: AllSettings): Partial<AllSettings> };
}

const island = (key: keyof AllSettings['island']) => ({
  get: (s: AllSettings) => s.island?.[key] !== false,
  set: (on: boolean, s: AllSettings) => ({ island: { ...s.island, [key]: on } }) as Partial<AllSettings>,
});

export const FEATURES: FeatureDef[] = [
  // ---------------------------------------------------------------- Library
  { id: 'library', name: 'Library and search', description: 'Finds your files by name, kind, date and what is in them.', group: 'Library', defaultOn: true, always: true, cost: { level: 'low', background: 'Notices new and changed files; a full re-read every half hour', memory: 'About 3 MB per 1,000 files' } },
  { id: 'sources', name: 'Where downloads came from', description: 'Remembers the website or app each download came from, so “pdfs from gmail” works.', group: 'Library', defaultOn: true, cost: { level: 'low', background: 'One quick look per new file' } },
  { id: 'docText', name: 'Text inside documents', description: 'Reads PDFs and text files so search finds words inside them.', group: 'Library', defaultOn: true, cost: { level: 'medium', background: 'Reads new documents when you are not busy' } },
  { id: 'ocr', name: 'Text in pictures', description: 'Recognises text in screenshots and photos, on this computer.', group: 'Library', defaultOn: true, bridge: { get: (s) => s.ocrEnabled !== false, set: (on) => ({ ocrEnabled: on }) }, cost: { level: 'high', background: 'Recognises text in new pictures when you are not busy, never on battery', memory: 'About 150 MB while it works, released after a minute' } },
  { id: 'places', name: 'Disks, cloud drives and servers', description: 'The Locations part of the sidebar, with free space and eject.', group: 'Library', defaultOn: true, routes: ['trash'], cost: { level: 'low', background: 'Notices disks coming and going (no programs started)' } },
  { id: 'network', name: 'Network browsing', description: 'Finds servers and shared folders on your network; Connect to Server.', group: 'Library', defaultOn: true, requires: ['places'], routes: ['network'], cost: { level: 'none', background: 'Only while the Network page is open' } },
  { id: 'lock', name: 'Locked folders', description: 'Encrypts folders so only you can open them.', group: 'Library', defaultOn: true, commands: ['lock*'], cost: { level: 'none', background: 'Locks folders again on your schedule' } },

  // ---------------------------------------------------------------- Tidy
  { id: 'cleanup', name: 'Clean Up', description: 'Caches, old installers and leftovers you can safely remove.', group: 'Tidy', defaultOn: true, routes: ['cleanup'], commands: ['cleanup', 'clean*'], cost: { level: 'none', background: 'Only when you scan' } },
  { id: 'duplicates', name: 'Duplicates and look-alike photos', description: 'Finds copies and near-identical pictures.', group: 'Tidy', defaultOn: true, routes: ['duplicates'], commands: ['duplicates'], cost: { level: 'low', background: 'A small fingerprint of each new picture' } },
  { id: 'space', name: 'Space Map and Large Files', description: 'See what takes up room on your disks.', group: 'Tidy', defaultOn: true, routes: ['space', 'large'], commands: ['space', 'large'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'convert', name: 'Convert', description: 'Images, video, audio and PDFs in other formats, cut-outs and more.', group: 'Tidy', defaultOn: true, routes: ['convert'], commands: ['convert*'], cost: { level: 'none', background: 'Only while converting', memory: 'Loaded on first use' } },
  { id: 'rules', name: 'Automations', description: 'Rules that tidy folders for you.', group: 'Tidy', defaultOn: true, routes: ['rules'], commands: ['rules*'], cost: { level: 'low', background: 'Runs your rules once an hour' } },
  { id: 'history', name: 'History and undo', description: 'Everything Keeper moved or removed, with undo.', group: 'Tidy', defaultOn: true, routes: ['history'], cost: { level: 'none' } },

  // ---------------------------------------------------------------- Island
  { id: 'island', name: 'Island', description: 'The bar at the top of the screen: drop shelf, now playing, timers and alerts.', group: 'Island', defaultOn: true, bridge: island('enabled'), routes: ['island'], commands: ['island*', 'shelf*', 'present*'], cost: { level: 'medium', background: 'A few small checks every few seconds while you are at the computer', windows: 'One small window per screen', memory: 'About 60 MB' } },
  { id: 'clipboard', name: 'Clipboard history', description: 'Keeps what you copy, with search; passwords are never kept.', group: 'Island', defaultOn: true, bridge: island('clipboard'), commands: ['clip*'], cost: { level: 'low', background: 'Looks at the clipboard about once a second while you are active' } },
  { id: 'media', name: 'Now playing', description: 'Music and video controls and lyrics in the Island.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks what is playing every few seconds while something plays, less often otherwise' } },
  { id: 'agents', name: 'Coding assistants', description: 'Shows when a coding assistant in your terminal needs you.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('agents'), cost: { level: 'low', background: 'Reads their session files every few seconds' } },
  { id: 'focus', name: 'Focus timer and breaks', description: 'Focus sessions and reminders to take a break.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'A timer only while a session runs' } },
  { id: 'keepAwake', name: 'Keep awake', description: 'Stops the computer sleeping while you need it.', group: 'Island', defaultOn: true, commands: ['awake*'], cost: { level: 'none', background: 'Checks its end every 15 seconds while on' } },
  { id: 'islandWeather', name: 'Weather in the Island', description: 'The temperature and rain alerts at a glance.', group: 'Island', defaultOn: true, requires: ['island', 'weather'], bridge: island('weather'), cost: { level: 'none', background: 'One forecast every 20 minutes' } },
  { id: 'calendar', name: 'Next meeting', description: 'Your next event from a calendar link.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Reads the calendar every 15 minutes' } },
  { id: 'micIndicator', name: 'Microphone and camera in use', description: 'A dot when an app is listening or watching.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks the system every 10 seconds' } },
  { id: 'notifyMirror', name: 'Notifications in the Island', description: 'Shows other apps’ notifications in the Island.', group: 'Island', defaultOn: false, requires: ['island'], bridge: island('notifyMirror'), cost: { level: 'low', background: 'Listens for notifications' } },
  { id: 'hideInFullscreen', name: 'Hide in full screen', description: 'The Island steps aside for full-screen video and slides.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('hideInFullscreen'), cost: { level: 'low', background: 'One small helper watches the window in front' } },

  // ---------------------------------------------------------------- Desktop
  { id: 'quickSearch', name: 'Quick Search', description: 'Search from anywhere with a keyboard shortcut.', group: 'Desktop', defaultOn: true, cost: { level: 'none', windows: 'A small window, made the first time you use it' } },
  { id: 'widgets', name: 'Desktop widgets', description: 'Clocks, weather, disk space and more on your desktop.', group: 'Desktop', defaultOn: true, routes: ['widgets'], commands: ['widget*'], cost: { level: 'low', windows: 'One per widget you add' } },
  { id: 'weather', name: 'Weather', description: 'Forecasts, rain radar and trips.', group: 'Desktop', defaultOn: true, routes: ['weather'], cost: { level: 'none', background: 'Only for the places you add' } },
  { id: 'capture', name: 'Screenshots and recording', description: 'Capture the screen, annotate, record and read text from it.', group: 'Desktop', defaultOn: true, routes: ['capture', 'annotate'], commands: ['capture*', 'record*', 'screenshot*'], cost: { level: 'none', background: 'Only while capturing', memory: 'Loaded on first use' } },
  { id: 'dictation', name: 'Dictation', description: 'Speak instead of typing, with a shortcut.', group: 'Desktop', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Only while you dictate' } },
  { id: 'tray', name: 'Menu bar / tray icon', description: 'Keeper stays available when its window is closed.', group: 'Desktop', defaultOn: true, bridge: { get: (s) => s.trayEnabled !== false, set: (on) => ({ trayEnabled: on }) }, cost: { level: 'none' } },
  { id: 'login', name: 'Start at login', description: 'Keeper starts quietly in the tray when you log in.', group: 'Desktop', defaultOn: false, cost: { level: 'none' } },
  { id: 'terminal', name: 'Terminal', description: 'Terminals, SSH and remote files inside Keeper.', group: 'Desktop', defaultOn: true, routes: ['terminal'], commands: ['terminal*'], cost: { level: 'low', background: 'A small helper keeps open terminals running, even with the window closed', memory: 'About 30 MB per open terminal' } },

  // ---------------------------------------------------------------- AI
  { id: 'brain', name: 'Keeper’s brain', description: 'Indexes the text in your files so any AI can search and read them (with your permission).', group: 'AI', defaultOn: true, requires: ['docText'], routes: ['graph'], bridge: { get: (s) => s.brain?.enabled !== false, set: (on, s) => ({ brain: { ...s.brain, enabled: on } }) }, cost: { level: 'medium', background: 'Updates its index after file changes', memory: 'About 20 MB per 10,000 documents' } },
  { id: 'semantic', name: 'Search by meaning', description: 'Finds files by what they are about, not just their words (on-device model).', group: 'AI', defaultOn: false, requires: ['brain'], bridge: { get: (s) => !!s.brain?.semantic, set: (on, s) => ({ brain: { ...s.brain, semantic: on } }) }, cost: { level: 'high', background: 'Builds meaning vectors when you are not busy, never on battery by default', memory: 'About 150 MB with the model loaded' } },
  { id: 'assistant', name: 'Assistant', description: 'Ask about your files with the AI you choose.', group: 'AI', defaultOn: true, routes: ['assistant'], commands: ['assistant*', 'ask*'], cost: { level: 'none', background: 'Only while you ask' } },
  { id: 'aiAgents', name: 'AI agents', description: 'Agents that work on your files with the AI you choose, asking before they change anything.', group: 'AI', defaultOn: true, routes: ['agents'], commands: ['agent*'], cost: { level: 'none', background: 'Only while an agent runs' } },
  { id: 'platform', name: 'Works with your computer', description: 'Spotlight, desktop search, Explorer menu, Siri Shortcuts and the system’s text recognition.', group: 'AI', defaultOn: true, cost: { level: 'low', background: 'Small helpers for the integrations you turn on' } },

  // ---------------------------------------------------------------- Connections
  { id: 'remote', name: 'Cloud and servers', description: 'Your cloud storage, servers and NAS in one place.', group: 'Connections', defaultOn: true, routes: ['remote'], commands: ['remote*'], cost: { level: 'low', background: 'A health check every 15 minutes for connected services' } },
  { id: 'link', name: 'Keeper on your other devices', description: 'Reach this computer’s files from your phone and other computers, and see your devices in one place.', group: 'Connections', defaultOn: true, routes: ['devices'], commands: ['link*', 'devices'], cost: { level: 'low', background: 'Answers your paired devices over the network while on' } },
  { id: 'sync', name: 'Sync and backup', description: 'Folder sync between your devices, backups and cloud mirrors.', group: 'Connections', defaultOn: true, routes: ['sync'], commands: ['sync*', 'backup*'], cost: { level: 'low', background: 'Watches the folders you set up and checks them every few minutes; nothing until you add one' } },
  { id: 'netwatch', name: 'Network activity and VPN', description: 'Which apps use the network and where they connect; your VPNs.', group: 'Connections', defaultOn: true, routes: ['netactivity', 'vpn'], commands: ['netactivity*', 'vpn*'], cost: { level: 'none', background: 'Only while open; optional alerts look every few minutes' } },
  { id: 'calendars', name: 'Calendar and reminders', description: 'Your calendars (iCloud, Google, Microsoft 365, Fastmail, CalDAV, .ics links) and to-do lists, with event alerts.', group: 'Connections', defaultOn: true, routes: ['calendar', 'reminders'], commands: ['calendar*', 'reminder*'], cost: { level: 'low', background: 'Checks calendars every 15 minutes (less when you are away, never while locked); one timer for the next alert' } },
  { id: 'alarms', name: 'Alarms, timers and world clocks', description: 'Alarms that ring at a time, countdown timers, a stopwatch and clocks for other places.', group: 'Desktop', defaultOn: true, routes: ['alarms'], commands: ['alarm*', 'timer*'], cost: { level: 'none', background: 'One timer waiting for the next alarm' } },

  // ---------------------------------------------------------------- System
  { id: 'health', name: 'Health and alerts', description: 'Processor, memory, heat and battery history, with alerts for misbehaving apps.', group: 'System', defaultOn: true, routes: ['health'], commands: ['health*'], cost: { level: 'low', background: 'One look at running apps per minute' } },
  { id: 'processes', name: 'Processes', description: 'Every running app and process; quit, end or restart them.', group: 'System', defaultOn: true, requires: ['health'], routes: ['processes'], commands: ['process*'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'startupItems', name: 'Startup items and apps', description: 'What starts with your computer, and apps you no longer use.', group: 'System', defaultOn: true, routes: ['startup', 'apps'], cost: { level: 'none' } },
  { id: 'protection', name: 'Protection', description: 'Checks downloads and apps for known problems.', group: 'System', defaultOn: true, routes: ['protection'], cost: { level: 'none', background: 'Only when you check' } },
  { id: 'tools', name: 'Toolbox', description: 'Developer tools, system tweaks and handy utilities.', group: 'System', defaultOn: true, routes: ['tools'], commands: ['tool*'], cost: { level: 'none' } },
  { id: 'updates', name: 'Automatic update checks', description: 'Looks for a new Keeper on GitHub every six hours (you can always check by hand).', group: 'System', defaultOn: true, bridge: { get: (s) => s.updateMode !== 'off', set: (on, s) => ({ updateMode: on ? (s.updateMode === 'off' ? 'auto' : s.updateMode) : 'off' }) }, cost: { level: 'none', background: 'One small request every six hours' } },
];

const byId = new Map(FEATURES.map((f) => [f.id, f]));
// The renderer has no `process`; it passes the platform from system info.
const HOST = typeof process !== 'undefined' ? process.platform : '';
export const featureDef = (id: string) => byId.get(id);

export type FeatureMap = Record<string, boolean>;

/** What the person asked for (before dependencies). */
export function wanted(s: AllSettings, id: string, platform: string = HOST): boolean {
  const f = byId.get(id);
  if (!f) return true; // unknown ids (a newer feature in an older registry) stay on
  if (f.always) return true;
  if (f.platforms && !f.platforms.includes(platform as NodeJS.Platform)) return false;
  if (f.bridge) return f.bridge.get(s);
  return s.features?.[id] ?? f.defaultOn;
}

export interface FeatureState {
  id: string;
  wanted: boolean;
  /** on, and everything it needs is on */
  on: boolean;
  /** the features that keep it off although it is wanted */
  blockedBy?: string[];
}

/** Every feature's state, with dependencies applied (a feature is off while what it needs is off). */
export function featureStates(s: AllSettings, platform: string = HOST): Map<string, FeatureState> {
  const out = new Map<string, FeatureState>();
  const visit = (id: string, seen: Set<string>): boolean => {
    const done = out.get(id);
    if (done) return done.on;
    const w = wanted(s, id, platform);
    const f = byId.get(id);
    const blockedBy: string[] = [];
    for (const r of f?.requires ?? []) {
      if (seen.has(r)) continue; // a loop in the registry: ignore that edge
      if (!visit(r, new Set([...seen, id]))) blockedBy.push(r);
    }
    const st: FeatureState = { id, wanted: w, on: w && blockedBy.length === 0, blockedBy: blockedBy.length ? blockedBy : undefined };
    out.set(id, st);
    return st.on;
  };
  for (const f of FEATURES) visit(f.id, new Set());
  return out;
}

export function isOn(s: AllSettings, id: string, platform: string = HOST): boolean {
  return featureStates(s, platform).get(id)?.on ?? true;
}

/** The settings change that switches one feature. Turning one on also turns on what it needs. */
export function featurePatch(s: AllSettings, id: string, on: boolean): Partial<AllSettings> {
  const f = byId.get(id);
  if (!f || f.always) return {};
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  const apply = (fid: string, v: boolean) => {
    const d = byId.get(fid);
    if (!d || d.always) return;
    if (d.bridge) next = { ...next, ...d.bridge.set(v, next) };
    else next.features = { ...next.features, [fid]: v };
  };
  apply(id, on);
  if (on) {
    const need = (fid: string, seen = new Set<string>()) => {
      for (const r of byId.get(fid)?.requires ?? []) {
        if (seen.has(r)) continue;
        seen.add(r);
        if (!wanted(next, r)) apply(r, true);
        need(r, seen);
      }
    };
    need(id);
  }
  return diff(s, next);
}

export type PresetId = 'everything' | 'balanced' | 'minimal' | 'files';

export const PRESETS: { id: PresetId; name: string; description: string; on: (f: FeatureDef) => boolean }[] = [
  { id: 'everything', name: 'Everything', description: 'Every feature on.', on: () => true },
  { id: 'balanced', name: 'Balanced', description: 'Keeper as it comes: the useful things on, the heavier extras off until you want them.', on: (f) => f.defaultOn },
  { id: 'minimal', name: 'Minimal', description: 'Files, search and tidying, with the Island and tray. Nothing heavy in the background.', on: (f) => ['Library', 'Tidy'].includes(f.group) ? f.id !== 'ocr' : ['island', 'tray', 'quickSearch', 'clipboard', 'focus', 'keepAwake', 'hideInFullscreen', 'updates'].includes(f.id) },
  { id: 'files', name: 'Files only', description: 'A file manager and nothing else: library, search, places and tidying.', on: (f) => ['library', 'sources', 'docText', 'places', 'network', 'lock', 'cleanup', 'duplicates', 'space', 'convert', 'history', 'tray', 'quickSearch'].includes(f.id) },
];

export function presetPatch(s: AllSettings, preset: PresetId): Partial<AllSettings> {
  const p = PRESETS.find((x) => x.id === preset);
  if (!p) return {};
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  for (const f of FEATURES) {
    if (f.always) continue;
    const v = p.on(f);
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  }
  return diff(s, next);
}

/** Which preset the current choices match, if any. */
export function currentPreset(s: AllSettings): PresetId | undefined {
  return PRESETS.find((p) => FEATURES.every((f) => f.always || wanted(s, f.id) === p.on(f)))?.id;
}

function diff(prev: AllSettings, next: AllSettings): Partial<AllSettings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof AllSettings)[]) if (next[k] !== prev[k]) out[k] = next[k];
  return out as Partial<AllSettings>;
}

/** Pages hidden because the feature that owns them is off. */
export function hiddenRoutes(states: Map<string, FeatureState>): Set<string> {
  const hidden = new Set<string>();
  for (const f of FEATURES) if (states.get(f.id)?.on === false) for (const r of f.routes ?? []) hidden.add(r);
  return hidden;
}

/** Is this palette command owned by a feature that is off? */
export function commandHidden(states: Map<string, FeatureState>, commandId: string): boolean {
  for (const f of FEATURES) {
    if (states.get(f.id)?.on !== false) continue;
    for (const c of f.commands ?? []) if (c.endsWith('*') ? commandId.startsWith(c.slice(0, -1)) : commandId === c) return true;
  }
  return false;
}
