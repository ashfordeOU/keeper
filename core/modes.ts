// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Modes: one choice that shapes the whole app. A mode is a preset, not a fork:
// data that sets ordinary parts (core/features.ts) and ordinary settings (the
// same ones Settings shows: spacing, text size, motion, the sidebar, notices,
// help). One base mode (Standard, Simple, Focus, Pro, Researcher, Creator,
// Writer, Family) plus add-ons that stack on any base (Accessibility needs,
// Privacy-max). The person always wins: what they change afterwards is kept as
// an override for that mode, put back when they return to it, and "Changed"
// and Reset compare against the mode, not against how Keeper came.
//
// Pure: electron/services/modes.ts applies a switch, and the renderer shows the
// preview from the same functions.

import { FEATURES, featureOffered, featurePatch, featureStates, NAV_GROUPS, recommend, wanted, type ComputerContext, type FeatureDef, type NavGroup } from './features';
import { defaultSettings, type AllSettings } from './settings';

export type ModeId = 'standard' | 'simple' | 'focus' | 'pro' | 'researcher' | 'creator' | 'writer' | 'family';
export type AddonId = 'lowVision' | 'motor' | 'dyslexia' | 'screenReader' | 'privacyMax';

/** Settings a mode sets, by dot path ("a11y.textScale"). Every path is an ordinary setting. */
export type ModeSettings = Record<string, unknown>;

export interface ModeDef {
  id: ModeId;
  name: string;
  /** one short line: what it is like */
  line: string;
  /** who it suits, in a few words */
  who: string;
  icon: string;
  /** the badge colour (a design token name: --mode-<tone>) */
  tone: string;
  /** parts it turns on and off, on top of the essentials Recommended picks for this computer */
  on: string[];
  off: string[];
  settings: ModeSettings;
  /** sidebar sections it shows (the rest are a click away in the palette); all when absent */
  sidebar?: NavGroup[];
  /** its own signature part: an ordinary part anyone can turn on in any mode */
  signature?: { name: string; line: string; part: string };
}

export interface AddonDef {
  id: AddonId;
  name: string;
  line: string;
  /** which group it is listed under */
  kind: 'access' | 'privacy';
  icon: string;
  on: string[];
  off: string[];
  settings: ModeSettings;
  signature?: { name: string; line: string; part: string };
}

/** The sidebar sections a narrow mode keeps (NAV_GROUPS ids). */
const SECTIONS_ALL: NavGroup[] = ['files', 'pim', 'notes', 'tidy', 'sync', 'computer', 'security', 'devices', 'ai', 'screen', 'desktop'];

export const MODES: ModeDef[] = [
  {
    id: 'standard', name: 'Standard', line: 'Keeper as it comes: the essentials for this computer.', who: 'Most people', icon: 'home', tone: 'standard',
    on: [], off: [], settings: {},
  },
  {
    id: 'simple', name: 'Simple', line: 'A calm file manager with mail. Big text, few rows.', who: 'People who want it calm', icon: 'sun', tone: 'simple',
    on: ['library', 'quickSearch', 'cleanup', 'history', 'mail', 'calendars', 'island', 'bigButtons'],
    off: ['terminal', 'agentHub', 'aiAgents', 'agents', 'islandUsage', 'usageTracker', 'devServers', 'containers', 'firewall', 'keeperMesh', 'tools', 'studio', 'stage', 'widgets', 'tracks', 'settingsCatalog', 'processes', 'startupItems', 'rules', 'brain', 'writingHelp', 'islandAsk', 'quickControls'],
    settings: { 'a11y.textScale': 1.1, density: 'comfortable', 'home.density': 'spacious', 'today.cards': ['now', 'tasks'], settingsAdvanced: false, sidebarSectionLimit: 5, helpButton: true, 'tips.on': true, 'notices.batch': 'hourly', 'notices.delivery.health': 'silent', 'notices.delivery.fixit': 'silent', 'notices.delivery.privacy': 'silent' },
    sidebar: ['files', 'pim'],
    signature: { name: 'Big buttons', line: 'Six large buttons on Today: find a file, free up space, write mail and more.', part: 'bigButtons' },
  },
  {
    id: 'focus', name: 'Focus', line: 'One thing at a time. Notices wait; distractions stay out.', who: 'People who lose time to distractions', icon: 'timer', tone: 'focus',
    on: ['captureInbox', 'planner', 'dayPlan', 'focus', 'focusBlock', 'journal', 'island', 'islandTodos'],
    off: ['widgets', 'vibes', 'wallpaper', 'islandWeather', 'islandStocks', 'islandSales', 'notifyMirror', 'islandInsights'],
    settings: { 'a11y.motion': 'reduce', density: 'comfortable', 'today.cards': ['now', 'tasks', 'focus'], 'notices.batch': 'thrice', 'notices.followFocus': true, 'notices.delivery.mail': 'batched', 'notices.delivery.monitors': 'batched', 'notices.delivery.network': 'batched', 'notices.delivery.reader': 'silent' },
    sidebar: ['files', 'pim', 'notes'],
    signature: { name: 'One thing now', line: 'Today shows what is on now, your top three and one focus timer.', part: 'focus' },
  },
  {
    id: 'pro', name: 'Pro', line: 'Everything in reach, tight and fast, for keyboard people.', who: 'Developers, IT and power users', icon: 'terminal', tone: 'pro',
    on: ['filePanes', 'terminal', 'agentHub', 'aiAgents', 'agents', 'islandUsage', 'usageTracker', 'devServers', 'containers', 'firewall', 'settingsCatalog', 'remoteDesktops', 'keeperMesh', 'tools', 'processes', 'launcher', 'quickControls', 'monitorSensors'],
    off: ['ambientSound', 'vibes'],
    settings: { density: 'compact', settingsAdvanced: true, sidebarSectionLimit: 0, helpButton: false, 'tips.on': false, 'notices.delivery.monitors': 'now', 'notices.delivery.network': 'now', 'notices.delivery.aiusage': 'now' },
    signature: { name: 'Run anything', line: 'Quick Search runs any Keeper action, your commands and saved links.', part: 'launcher' },
  },
  {
    id: 'researcher', name: 'Researcher', line: 'Notes, sources and search by meaning, side by side.', who: 'Students, academics and analysts', icon: 'book', tone: 'researcher',
    on: ['notes', 'brain', 'graphAll', 'semantic', 'docText', 'ocr', 'convert', 'dictation', 'meetings', 'planner', 'calendars', 'reader'],
    off: ['firewall', 'keeperMesh', 'islandStocks', 'monitorHistory'],
    settings: { 'notices.delivery.calendar': 'now', 'notices.delivery.mail': 'batched', 'notices.delivery.health': 'batched' },
    sidebar: ['files', 'pim', 'notes', 'ai'],
    signature: { name: 'Linked sources', line: 'Every note shows the files, mail and notes it is linked to.', part: 'graphAll' },
  },
  {
    id: 'creator', name: 'Creator', line: 'Record, edit and share your screen in one flow.', who: 'Video makers, teachers and designers', icon: 'video', tone: 'creator',
    on: ['capture', 'studio', 'stage', 'drawOnScreen', 'photoEditor', 'convert', 'faces', 'islandPrompter', 'speechModel'],
    off: ['agents', 'aiAgents', 'islandUsage'],
    settings: { 'notices.delivery.health': 'silent', 'notices.delivery.fixit': 'silent', 'notices.delivery.mail': 'batched' },
    sidebar: ['files', 'pim', 'screen'],
    signature: { name: 'Record and share', line: 'Studio records, adds captions and copies a link to share.', part: 'studio' },
  },
  {
    id: 'writer', name: 'Writer', line: 'A quiet page to write on, with words that flow.', who: 'Writers, bloggers and journalists', icon: 'note', tone: 'writer',
    on: ['notes', 'journal', 'textSnippets', 'dictation', 'selectionBar', 'writingHelp', 'focusBlock', 'reader'],
    off: ['health', 'firewall', 'tools', 'studio'],
    settings: { font: 'serif', 'a11y.textScale': 1.1, 'a11y.motion': 'reduce', 'home.density': 'spacious', 'notices.delivery.mail': 'batched', 'notices.delivery.reader': 'silent' },
    sidebar: ['files', 'pim', 'notes'],
    signature: { name: 'Distraction blocking', line: 'Block the sites and apps that pull you away while you write.', part: 'focusBlock' },
  },
  {
    id: 'family', name: 'Family', line: 'Large and plain, with a helper one click away.', who: 'New or older computer users', icon: 'person', tone: 'family',
    on: ['library', 'mail', 'calendars', 'alarms', 'cleanup', 'link', 'remoteScreen', 'island', 'bigButtons'],
    off: ['terminal', 'agentHub', 'aiAgents', 'agents', 'islandUsage', 'usageTracker', 'devServers', 'containers', 'firewall', 'settingsCatalog', 'startupItems', 'fileKit', 'studio', 'stage', 'tools', 'rules', 'workflows', 'keeperMesh', 'brain', 'writingHelp', 'islandAsk', 'abilities', 'processes', 'quickControls', 'widgets'],
    settings: { 'a11y.textScale': 1.25, 'a11y.motion': 'reduce', 'a11y.focusAlways': true, density: 'comfortable', 'home.density': 'spacious', 'today.cards': ['now', 'tasks'], settingsAdvanced: false, sidebarSectionLimit: 5, helpButton: true, 'tips.on': true, 'notices.batch': 'hourly', 'notices.delivery.health': 'silent', 'notices.delivery.fixit': 'silent', 'notices.delivery.network': 'silent', 'notices.delivery.updates': 'silent' },
    sidebar: ['files', 'pim'],
    signature: { name: 'Help mode', line: 'One click lets a trusted relative see your screen, with a big Stop.', part: 'remoteHelp' },
  },
];

export const ADDONS: AddonDef[] = [
  {
    id: 'lowVision', name: 'Low vision', line: 'Larger text, clear focus outlines and less motion.', kind: 'access', icon: 'eye',
    on: [], off: ['wallpaper', 'vibes'],
    settings: { 'a11y.textScale': 1.5, 'a11y.focusAlways': true, 'a11y.motion': 'reduce', density: 'comfortable' },
  },
  {
    id: 'motor', name: 'Steady hands', line: 'Roomy spacing, focus outlines and keyboard first.', kind: 'access', icon: 'keyboard',
    on: ['dictation'], off: [],
    settings: { 'a11y.focusAlways': true, 'a11y.motion': 'reduce', density: 'comfortable', 'a11y.textScale': 1.1 },
  },
  {
    id: 'dyslexia', name: 'Easier reading', line: 'A rounded font, a little larger, and calm pages.', kind: 'access', icon: 'text',
    on: ['dictation'], off: [],
    settings: { font: 'rounded', 'a11y.textScale': 1.1, 'a11y.motion': 'reduce' },
  },
  {
    id: 'screenReader', name: 'Screen reader', line: 'No moving backgrounds; focus outlines always on.', kind: 'access', icon: 'audio',
    on: [], off: ['wallpaper', 'vibes', 'widgets'],
    settings: { 'a11y.focusAlways': true, 'a11y.motion': 'reduce' },
  },
  {
    id: 'privacyMax', name: 'Privacy-max', line: 'Nothing leaves this computer unless you ask.', kind: 'privacy', icon: 'shield',
    on: ['firewall', 'netwatch', 'lock', 'protection', 'offlineCheck'],
    off: ['weather', 'islandWeather', 'islandStocks', 'islandSales', 'updates', 'videoDownload', 'monorail', 'linkDirect'],
    settings: { 'ai.provider': 'ollama', 'launcher.currency': false, 'island.lyrics': false, 'island.clipFetchTitles': false, 'reader.images': false, 'reader.fullText': false },
    signature: { name: 'Offline check', line: 'Every way Keeper could reach the internet, with one switch each.', part: 'offlineCheck' },
  },
];

/** Paths where add-ons keep the larger value rather than the last one (text size). */
const LARGEST = new Set(['a11y.textScale']);

export const modeDef = (id: string): ModeDef | undefined => MODES.find((m) => m.id === id);
export const addonDef = (id: string): AddonDef | undefined => ADDONS.find((a) => a.id === id);

// ---------------------------------------------------------------- what is stored

export interface ModeChoice {
  base: ModeId;
  addons: AddonId[];
}

/** What the person changed on top of a mode: kept for that mode and put back when they return. */
export interface ModeOverrides {
  features: Record<string, boolean>;
  settings: ModeSettings;
}

export interface ModeState extends ModeChoice {
  /** by modeKey(): "writer+dyslexia" */
  overrides: Record<string, ModeOverrides>;
  /** when the person last switched (0: never; Keeper came in Standard) */
  since: number;
}

/** A timed session over any mode ("Focus for 50 minutes"): it changes nothing that is saved, and ends by itself. */
export interface ModeSession {
  mode: 'focus';
  /** when it started and ends (ms) */
  start: number;
  until: number;
}

export const defaultModeState = (): ModeState => ({ base: 'standard', addons: [], overrides: {}, since: 0 });

const MAX_KEPT = 16;

export function normalizeModeState(v: unknown): ModeState {
  const d = defaultModeState();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<ModeState>;
  const base = modeDef(String(r.base)) ? (r.base as ModeId) : 'standard';
  const addons = cleanAddons(r.addons);
  const overrides: Record<string, ModeOverrides> = {};
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [k, o] of Object.entries(r.overrides).slice(-MAX_KEPT)) {
      if (!o || typeof o !== 'object' || !validKey(k)) continue;
      const f = (o as ModeOverrides).features;
      const st = (o as ModeOverrides).settings;
      overrides[k] = {
        features: f && typeof f === 'object' ? Object.fromEntries(Object.entries(f).filter(([id, x]) => typeof x === 'boolean' && FEATURES.some((ft) => ft.id === id))) : {},
        settings: st && typeof st === 'object' ? Object.fromEntries(Object.entries(st).filter(([p]) => MANAGED.includes(p))) : {},
      };
    }
  }
  return { base, addons, overrides, since: typeof r.since === 'number' && r.since > 0 ? r.since : 0 };
}

export function normalizeSession(v: unknown, now = Date.now()): ModeSession | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<ModeSession>;
  if (r.mode !== 'focus' || typeof r.until !== 'number' || typeof r.start !== 'number') return null;
  return r.until > now ? { mode: 'focus', start: r.start, until: r.until } : null;
}

export function cleanAddons(v: unknown): AddonId[] {
  if (!Array.isArray(v)) return [];
  // Kept in the list's own order, so "Writer + Easier reading + Privacy-max" always reads the same.
  return ADDONS.map((a) => a.id).filter((id) => v.includes(id));
}

function validKey(k: string): boolean {
  const [b, ...rest] = k.split('+');
  return !!modeDef(b) && rest.every((a) => !!addonDef(a));
}

/** "writer+dyslexia+privacyMax": the key a mode's overrides are kept under. */
export function modeKey(c: ModeChoice): string {
  return [c.base, ...cleanAddons(c.addons)].join('+');
}

/** "Writer + Easier reading + Privacy-max". */
export function modeTitle(c: ModeChoice): string {
  return [modeDef(c.base)?.name ?? 'Standard', ...cleanAddons(c.addons).map((a) => addonDef(a)!.name)].join(' + ');
}

export function modeOf(s: Pick<AllSettings, 'mode'>): ModeState {
  return normalizeModeState(s.mode);
}

// ---------------------------------------------------------------- the values a mode sets

/** Every setting path some mode or add-on sets: switching resets these to how Keeper came, then the mode sets its own. */
export const MANAGED: string[] = [...new Set([...MODES, ...ADDONS].flatMap((m) => Object.keys(m.settings)).concat(['sidebarHidden']))];

/** The parts a mode never touches: the library itself, the person's own choices (usage stats, crash reports), and opening at login (the system keeps it). */
function modeTouches(f: FeatureDef): boolean {
  return !f.always && !f.ownChoice && f.id !== 'login';
}

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** A copy of `s` with `value` at `path` (nested objects copied, never changed). */
export function setAt<T>(s: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const put = (o: unknown, ks: string[]): unknown => {
    const base = o && typeof o === 'object' ? { ...(o as Record<string, unknown>) } : {};
    base[ks[0]] = ks.length === 1 ? value : put(base[ks[0]], ks.slice(1));
    return base;
  };
  return put(s, keys) as T;
}

let factory: AllSettings | null = null;
const defaults = () => (factory ??= defaultSettings([], []));

/** The sidebar entries a mode hides: its sections that are left out. */
export function sidebarHiddenFor(sections: NavGroup[] | undefined): string[] {
  if (!sections) return [];
  return SECTIONS_ALL.filter((g) => !sections.includes(g)).map((g) => `section:${g}`);
}

/** The settings a mode (with add-ons) sets, before the person's own changes. */
export function modeSettings(c: ModeChoice): ModeSettings {
  const base = modeDef(c.base) ?? MODES[0];
  const out: ModeSettings = {};
  for (const p of MANAGED) out[p] = getAt(defaults(), p);
  Object.assign(out, base.settings);
  out.sidebarHidden = sidebarHiddenFor(base.sidebar);
  for (const a of cleanAddons(c.addons)) {
    for (const [p, v] of Object.entries(addonDef(a)!.settings)) {
      out[p] = LARGEST.has(p) && typeof out[p] === 'number' && typeof v === 'number' ? Math.max(out[p] as number, v) : v;
    }
  }
  return out;
}

/** Is this part on in the mode (before the person's own changes)? */
export function modeWants(f: FeatureDef, c: ModeChoice, ctx?: ComputerContext): boolean {
  let v = recommend(f, ctx);
  const base = modeDef(c.base) ?? MODES[0];
  if (base.on.includes(f.id)) v = true;
  if (base.off.includes(f.id)) v = false;
  for (const a of cleanAddons(c.addons)) {
    const d = addonDef(a)!;
    if (d.on.includes(f.id)) v = true;
    if (d.off.includes(f.id)) v = false;
  }
  return v;
}

/** The settings with a mode laid over them (and, unless `bare`, the person's overrides for it). */
export function withMode(s: AllSettings, c: ModeChoice, ctx: ComputerContext | undefined, overrides?: ModeOverrides): AllSettings {
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  const vals = { ...modeSettings(c), ...(overrides?.settings ?? {}) };
  // A value that is not there (a part's notices before the person chose) is put back by leaving it out.
  for (const [p, v] of Object.entries(vals)) if (v !== undefined || getAt(next, p) !== undefined) next = setAt(next, p, v);
  const apply = (f: FeatureDef, v: boolean) => {
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  };
  const want = new Map<string, boolean>();
  for (const f of FEATURES) if (modeTouches(f)) want.set(f.id, overrides?.features[f.id] ?? modeWants(f, c, ctx));
  for (const f of FEATURES) if (want.has(f.id)) apply(f, want.get(f.id)!);
  // A part the mode turns on brings what it needs (Help mode needs Keeper on your other devices).
  for (const [id, on] of want) if (on) next = { ...next, ...featurePatch(next, id, true) };
  return next;
}

/** What the person changed on top of the mode they are in: the overrides to keep for it. */
export function overridesOf(s: AllSettings, ctx: ComputerContext | undefined, platform = ''): ModeOverrides {
  const m = modeOf(s);
  const bare = withMode(s, m, ctx);
  const out: ModeOverrides = { features: {}, settings: {} };
  // Only what really differs counts: a part that follows one that is off is off either way.
  const a = featureStates(s, platform);
  const b = featureStates(bare, platform);
  for (const f of FEATURES) {
    if (!modeTouches(f) || !featureOffered(f, platform)) continue;
    const now = wanted(s, f.id, platform);
    if (now !== wanted(bare, f.id, platform) && a.get(f.id)?.on !== b.get(f.id)?.on) out.features[f.id] = now;
  }
  for (const p of MANAGED) {
    const now = getAt(s, p);
    if (!same(now, getAt(bare, p))) out.settings[p] = now;
  }
  return out;
}

export const overrideCount = (o: ModeOverrides | undefined): number => (o ? Object.keys(o.features).length + Object.keys(o.settings).length : 0);

/**
 * The settings change that switches to a mode: what the person changed in the mode they
 * leave is kept for it, and the new mode comes with the changes they made in it before.
 */
export function switchPatch(s: AllSettings, to: ModeChoice, ctx: ComputerContext | undefined, now = Date.now(), platform = ''): Partial<AllSettings> {
  const from = modeOf(s);
  const kept = { ...from.overrides };
  const mine = overridesOf(s, ctx, platform);
  if (overrideCount(mine)) kept[modeKey(from)] = mine;
  else delete kept[modeKey(from)];
  const target: ModeChoice = { base: to.base, addons: cleanAddons(to.addons) };
  const next = withMode(s, target, ctx, kept[modeKey(target)]);
  const keys = Object.keys(kept);
  const trimmed = keys.length > MAX_KEPT ? Object.fromEntries(keys.slice(-MAX_KEPT).map((k) => [k, kept[k]])) : kept;
  const state: ModeState = { ...target, overrides: trimmed, since: now };
  return diff(s, { ...next, mode: state });
}

/** Back to the mode as it comes: the person's changes in it are dropped. */
export function resetModePatch(s: AllSettings, ctx: ComputerContext | undefined, now = Date.now()): Partial<AllSettings> {
  const m = modeOf(s);
  const kept = { ...m.overrides };
  delete kept[modeKey(m)];
  return diff(s, { ...withMode(s, m, ctx), mode: { ...m, overrides: kept, since: now } });
}

// ---------------------------------------------------------------- the preview

export interface ModePreview {
  title: string;
  /** part names */
  turnsOn: string[];
  turnsOff: string[];
  /** settings that change, in words ("Text size: 110%") */
  settings: { path: string; label: string; to: string }[];
  /** sidebar sections shown after the switch (null: all) */
  sidebar: number | null;
  /** changes the person made in that mode before, which come back */
  restored: number;
  /** changes the person made here, kept for when they come back */
  kept: number;
}

/** Words for the settings a mode sets (the preview reads these). */
export const SETTING_WORDS: Record<string, { label: string; value?: (v: unknown) => string }> = {
  'a11y.textScale': { label: 'Text size', value: (v) => `${Math.round(Number(v) * 100)}%` },
  'a11y.motion': { label: 'Motion', value: (v) => (v === 'reduce' ? 'Reduced' : v === 'full' ? 'Full' : 'Like the system') },
  'a11y.focusAlways': { label: 'Focus outlines', value: (v) => (v ? 'Always' : 'With the keyboard') },
  density: { label: 'Spacing', value: (v) => (v === 'compact' ? 'Compact' : 'Comfortable') },
  'home.density': { label: 'Today spacing', value: (v) => String(v).replace(/^./, (c) => c.toUpperCase()) },
  font: { label: 'Text style', value: (v) => ({ theme: 'Theme', system: 'System', rounded: 'Rounded', serif: 'Serif', mono: 'Mono' })[String(v)] ?? String(v) },
  settingsAdvanced: { label: 'All settings shown', value: (v) => (v ? 'Yes' : 'No') },
  sidebarSectionLimit: { label: 'Rows per sidebar section', value: (v) => (Number(v) === 0 ? 'All' : String(v)) },
  helpButton: { label: 'Help button', value: (v) => (v ? 'Shown' : 'Hidden') },
  'tips.on': { label: 'A tip a day', value: (v) => (v ? 'On' : 'Off') },
  'notices.batch': { label: 'Batched notices', value: (v) => (v === 'hourly' ? 'Every hour' : 'At 9, 13 and 17') },
  'notices.followFocus': { label: 'Hold notices while focusing', value: (v) => (v ? 'Yes' : 'No') },
  'ai.provider': { label: 'AI', value: (v) => (v === 'ollama' ? 'On this computer only' : String(v)) },
  'launcher.currency': { label: 'Currency rates', value: (v) => (v ? 'On' : 'Off') },
  'island.lyrics': { label: 'Lyrics', value: (v) => (v ? 'On' : 'Off') },
  'island.clipFetchTitles': { label: 'Link titles in clipboard', value: (v) => (v ? 'On' : 'Off') },
  'reader.images': { label: 'Pictures in articles', value: (v) => (v ? 'On' : 'Off') },
  'reader.fullText': { label: 'Whole articles', value: (v) => (v ? 'On' : 'Off') },
  'today.cards': { label: 'Cards on Today', value: (v) => (Array.isArray(v) ? `${v.length}` : 'Picked for you') },
};

const NOTICE_WORDS: Record<string, string> = { mail: 'Mail', calendar: 'Calendar', monitors: 'Sites and servers', network: 'Network', privacy: 'Privacy', fixit: 'Fix-it List', health: 'Health', aiusage: 'AI usage', reader: 'Reader', updates: 'Updates', keeper: 'Keeper' };
const DELIVERY_WORDS: Record<string, string> = { now: 'Now', batched: 'Batched', silent: 'Silent' };

/** "Text size: 110%", "Mail notices: Batched". */
export function settingWords(path: string, v: unknown): { label: string; to: string } {
  const n = /^notices\.delivery\.(\w+)$/.exec(path);
  if (n) return { label: `${NOTICE_WORDS[n[1]] ?? n[1]} notices`, to: DELIVERY_WORDS[String(v)] ?? String(v) };
  const w = SETTING_WORDS[path];
  if (w) return { label: w.label, to: w.value ? w.value(v) : String(v) };
  return { label: path, to: String(v) };
}

export function previewSwitch(s: AllSettings, to: ModeChoice, ctx: ComputerContext | undefined, platform = ''): ModePreview {
  const patch = switchPatch(s, to, ctx, 1, platform);
  const next = { ...s, ...patch } as AllSettings;
  const turnsOn: string[] = [];
  const turnsOff: string[] = [];
  const before = featureStates(s, platform);
  const after = featureStates(next, platform);
  for (const f of FEATURES) {
    if (!featureOffered(f, platform) || !modeTouches(f)) continue;
    const a = before.get(f.id)?.on ?? false;
    const b = after.get(f.id)?.on ?? false;
    if (!a && b) turnsOn.push(f.plain ?? f.name);
    if (a && !b) turnsOff.push(f.plain ?? f.name);
  }
  const settings: ModePreview['settings'] = [];
  for (const p of MANAGED) {
    if (p === 'sidebarHidden') continue;
    const a = getAt(s, p);
    const b = getAt(next, p);
    if (same(a, b) || b === undefined) continue;
    settings.push({ path: p, ...settingWords(p, b) });
  }
  const st = modeOf(next);
  const hidden = (next.sidebarHidden ?? []).filter((h) => h.startsWith('section:')).length;
  return {
    title: modeTitle(to),
    turnsOn,
    turnsOff,
    settings,
    sidebar: hidden ? SECTIONS_ALL.length - hidden : null,
    restored: overrideCount(modeOf(s).overrides[modeKey(to)]),
    kept: overrideCount(st.overrides[modeKey(modeOf(s))]),
  };
}

/** "Turns on 3 parts and off 14. Your data stays." */
export function previewLine(p: ModePreview): string {
  const bits: string[] = [];
  if (p.turnsOn.length) bits.push(`Turns on ${p.turnsOn.length} ${p.turnsOn.length === 1 ? 'part' : 'parts'}`);
  if (p.turnsOff.length) bits.push(`${bits.length ? 'off' : 'Turns off'} ${p.turnsOff.length}${bits.length ? '' : p.turnsOff.length === 1 ? ' part' : ' parts'}`);
  const head = bits.length ? `${bits.join(' and ')}.` : 'No parts change.';
  return `${head} Your data stays.`;
}

// ---------------------------------------------------------------- setup: goals suggest a mode

/** The mode a set of setup goals points to (Standard when nothing stands out). */
export function suggestMode(goals: string[]): ModeId {
  if (goals.includes('family')) return 'family';
  if (goals.includes('record')) return 'creator';
  if (goals.includes('focus')) return 'focus';
  if (goals.includes('notes') && !goals.includes('clean')) return 'writer';
  return 'standard';
}

// ---------------------------------------------------------------- Focus as a timed session

export const SESSION_LENGTHS = [25, 50, 90] as const;

export function startSession(minutes: number, now = Date.now()): ModeSession {
  const m = Math.min(240, Math.max(5, Math.round(minutes)));
  return { mode: 'focus', start: now, until: now + m * 60_000 };
}

/** Minutes left, rounded up (0 once it has ended). */
export function sessionLeft(s: ModeSession | null | undefined, now = Date.now()): number {
  if (!s || s.until <= now) return 0;
  return Math.ceil((s.until - now) / 60_000);
}

/** The sidebar sections a running Focus session shows (it changes nothing saved). */
export function sessionSidebar(s: ModeSession | null | undefined, now = Date.now()): NavGroup[] | null {
  return sessionLeft(s, now) > 0 ? (modeDef('focus')!.sidebar ?? null) : null;
}

/** The badge in the sidebar's foot: "Focus · 42 min" during a session, else the mode's name. */
export function badgeText(m: ModeChoice, session: ModeSession | null | undefined, now = Date.now()): string {
  const left = sessionLeft(session, now);
  if (left) return `Focus · ${left} min`;
  return modeTitle(m);
}

// ---------------------------------------------------------------- helpers

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diff(prev: AllSettings, next: AllSettings): Partial<AllSettings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof AllSettings)[]) if (!same(next[k], prev[k])) out[k] = next[k];
  return out as Partial<AllSettings>;
}

/** The value Reset and "Changed" compare a setting against: the mode's own, or how Keeper came. */
export function modeBaseline(s: AllSettings, path: string): { managed: boolean; value: unknown } {
  const m = modeOf(s);
  if (m.base === 'standard' && !m.addons.length) return { managed: false, value: undefined };
  if (!MANAGED.includes(path)) return { managed: false, value: undefined };
  return { managed: true, value: modeSettings(m)[path] };
}

// ---------------------------------------------------------------- the docs page, made from the data

/** The "What each mode changes" part of docs/MODES.md (a test keeps the page in step with this data). */
export function modesDoc(): string {
  const name = (id: string) => FEATURES.find((f) => f.id === id)?.plain ?? FEATURES.find((f) => f.id === id)?.name ?? id;
  const words = (st: ModeSettings) => Object.entries(st).map(([p, v]) => { const w = settingWords(p, v); return `${w.label}: ${w.to}`; }).join(' · ');
  const out: string[] = [];
  for (const m of [...MODES, ...ADDONS]) {
    const add = 'kind' in m;
    out.push(`### What ${m.name} changes${add ? ' (add-on)' : ''}`, '', `${m.line}${'who' in m ? ` For: ${m.who.toLowerCase()}.` : ''}`, '');
    if (m.on.length) out.push(`- **Turns on:** ${m.on.map(name).join(', ')}`);
    if (m.off.length) out.push(`- **Turns off:** ${m.off.map(name).join(', ')}`);
    if (Object.keys(m.settings).length) out.push(`- **Settings:** ${words(m.settings)}`);
    if (!add) out.push(`- **Sidebar:** ${(m as ModeDef).sidebar ? (m as ModeDef).sidebar!.map((g) => NAV_GROUPS.find((x) => x.id === g)?.title ?? g).join(', ') : 'every section'}`);
    if (m.signature) out.push(`- **Its own part:** ${m.signature.name}: ${m.signature.line}`);
    if (!m.on.length && !m.off.length && !Object.keys(m.settings).length) out.push('- Nothing: Keeper as it comes, with the essentials for this computer.');
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}
