// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Default settings and a lenient reader for settings loaded from disk.

import { defaultA11y, normalizeA11y } from './a11y';
import { defaultFocusBlockOptions, normalizeFocusBlockOptions } from './focus-block';
import { defaultSnapSettings, normalizeLayouts, normalizeSnapSettings } from './snap';
import { defaultTimeTrackOptions, normalizeTimeTrackOptions } from './time-track';
import { defaultJournalSettings, normalizeJournalSettings } from './notes/journal';
import { defaultReaderSettings, normalizeReaderSettings } from './reader';
import { normalizeWeatherSource } from './weather';
import { defaultPhoneAlertSettings, normalizePhoneAlertSettings } from './phone-alerts';
import { defaultNoticeSettings, normalizeNoticeSettings } from './notices';
import { cleanGoals, defaultTips, normalizeTips } from './goals';
import { defaultModeState, normalizeModeState, normalizeSession } from './modes';
import { defaultAwakeSettings, normalizeAwakeSettings } from './awake-engine';
import { defaultAbilities } from './abilities/config';
import type { IslandSettings } from './api';
import { cleanPanelSizes, isPanelSize, islandWindowType } from './island-size';
import { DEFAULT_DECK, cleanDeck, migrateDeck } from './island-tools/tools';
import { HOVER_DWELL_MS, migrateHoverDelay } from './island-open';
import { DEFAULT_INTENSITY, DEFAULT_LOOK, DEFAULT_PRESET, cleanLook } from './island-look';
import { defaultBrainSettings, normalizeBrainSettings } from './brain/config';
import { defaultGraphPrivacy, normalizeGraphPrivacy } from './graph/everything';
import { defaultAgentSettings, normalizeAgentSettings } from './agents-config';
import { defaultSyncSettings, normalizeSyncSettings } from './sync/config';
import { defaultGlanceSettings } from './glance';
import { DEFAULT_PLATFORM } from './platform-integrations';
import { defaultHomeSettings, normalizeHome } from './home-layout';
import { defaultTodaySettings, normalizeToday } from './today';
import { migrateSidebarLists } from './file-types';
import { DEFAULT_THEME, THEMES } from './themes';
import type { Rule, Settings } from './types';
import { sanitizePageWindows } from './page-window';
import { defaultLauncher, normalizeLauncher } from './launcher/links';
import { defaultSelection, normalizeSelection } from './selection';
import { defaultTyping, normalizeTyping } from './typing/expand';

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
    pasteNextShortcut: 'CommandOrControl+Alt+V',
    plainPasteShortcut: '',
    queueOnPaste: true,
    shelfShortcut: 'CommandOrControl+Shift+X',
    taskShortcut: 'CommandOrControl+Alt+N',
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
    alwaysBattery: false,
    openTo: 'activity',
    hoverOpen: true,
    hoverDelayMs: HOVER_DWELL_MS,
    haptics: true,
    openModel: 1,
    openShortcut: 'CommandOrControl+Alt+I',
    focusSound: 'off',
    focusVolume: 0.4,
    shelfKeepCopies: false,
    shelfRetentionDays: 7,
    mediaKeys: false,
    panelSize: 'regular',
    panelSizes: {},
    deck: [...DEFAULT_DECK],
    windowType: 'standard',
    look: DEFAULT_LOOK,
    lookIntensity: DEFAULT_INTENSITY,
    lookPreset: DEFAULT_PRESET,
    lookAccent: '',
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
    themeSeasons: false,
    hemisphere: 'auto',
    a11y: defaultA11y(),
    folders,
    excluded: [],
    showHidden: false,
    quickSearchShortcut: 'CommandOrControl+Shift+Space',
    launcher: defaultLauncher(),
    selection: defaultSelection(),
    typing: defaultTyping(),
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
    graph: defaultGraphPrivacy(),
    abilities: defaultAbilities(),
    agents: defaultAgentSettings(),
    sync: defaultSyncSettings(),
    widgets: [],
    updateCheck: true,
    updateMode: 'auto',
    updateBeta: false,
    updateBetaChosen: false,
    resourceMode: 'balanced',
    features: {},
    sidebarHidden: [],
    pageWindows: {},
    featureSets: [],
    menuBarOneIcon: false,
    glance: {},
    featureSetOnBattery: '',
    featureSetOnPower: '',
    awake: defaultAwakeSettings(),
    sidebarOrder: [],
    lastRunVersion: '',
    updatePlan: null,
    updateSkip: '',
    restorePlace: true,
    mailToday: true,
    language: 'system',
    inspectorMode: 'selection',
    sidebarMode: 'auto',
    sidebarSectionLimit: 5,
    sidebarTypes: false,
    settingsAdvanced: false,
    home: defaultHomeSettings(),
    today: defaultTodaySettings(),
    permissionsSetup: '',
    permissionsAsked: {},
    featuresPinned: false,
    setupDone: false,
    nativeApps: {},
    focusBlock: defaultFocusBlockOptions(),
    snap: defaultSnapSettings(),
    snapLayouts: [],
    timeTrack: defaultTimeTrackOptions(),
    journal: defaultJournalSettings(),
    reader: defaultReaderSettings(),
    archives: { extractTo: 'beside', openAfter: true },
    pdfReader: { darkPages: false, keepPrevious: true },
    weatherSource: 'met',
    phoneAlerts: defaultPhoneAlertSettings(),
    notices: defaultNoticeSettings(),
    helpButton: true,
    declutter: true,
    setupGoals: [],
    tips: defaultTips(),
    mode: defaultModeState(),
    modeSession: null,
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
  out.themeSeasons = out.themeSeasons === true;
  if (!['auto', 'north', 'south'].includes(out.hemisphere ?? '')) out.hemisphere = 'auto';
  out.a11y = normalizeA11y(out.a11y);
  out.pdfReader = { darkPages: out.pdfReader?.darkPages === true, keepPrevious: out.pdfReader?.keepPrevious !== false };
  out.archives = { extractTo: out.archives?.extractTo === 'ask' ? 'ask' : 'beside', openAfter: out.archives?.openAfter !== false };
  out.focusBlock = normalizeFocusBlockOptions(out.focusBlock);
  out.snap = normalizeSnapSettings(out.snap);
  out.snapLayouts = normalizeLayouts(out.snapLayouts);
  out.timeTrack = normalizeTimeTrackOptions(out.timeTrack);
  out.journal = normalizeJournalSettings(out.journal);
  out.reader = normalizeReaderSettings(out.reader);
  out.graph = normalizeGraphPrivacy(out.graph);
  out.weatherSource = normalizeWeatherSource(out.weatherSource);
  out.phoneAlerts = normalizePhoneAlertSettings(out.phoneAlerts);
  out.notices = normalizeNoticeSettings(r.notices);
  out.setupGoals = cleanGoals(r.setupGoals);
  out.tips = normalizeTips(r.tips);
  out.mode = normalizeModeState(r.mode);
  out.modeSession = normalizeSession(r.modeSession);
  // Settings from before the brain had one AI choice; it becomes the active connection.
  out.brain = normalizeBrainSettings(r.brain && typeof r.brain === 'object' ? out.brain : undefined, out.ai);
  out.sync = normalizeSyncSettings(out.sync, base.sync);
  out.agents = normalizeAgentSettings(out.agents);
  out.awake = normalizeAwakeSettings(out.awake, r.island && typeof r.island === 'object' ? (r.island as { awakeTriggers?: unknown }).awakeTriggers : undefined);
  if (!Array.isArray(out.featureSets)) out.featureSets = [];
  out.pageWindows = sanitizePageWindows(out.pageWindows);
  // The AI usage tracker's own menu-bar item became a card in the owl's glance: someone who had
  // switched the item off does not get the card either. (The old feature switch is dropped.)
  if (out.features && 'usageMenuBar' in out.features) {
    const { usageMenuBar, ...rest } = out.features as Record<string, boolean>;
    out.features = rest;
    if (usageMenuBar === false) {
      const cards = Array.isArray(out.glance?.cards) ? out.glance.cards : defaultGlanceSettings('any').cards;
      out.glance = { ...(out.glance ?? {}), cards: cards.filter((c) => c !== 'usage') };
    }
  }
  if (!['selection', 'always', 'never'].includes(out.inspectorMode)) out.inspectorMode = 'selection';
  if (!['auto', 'full', 'compact'].includes(out.sidebarMode)) out.sidebarMode = 'auto';
  out.home = normalizeHome(r.home);
  out.today = normalizeToday(r.today);
  out.launcher = normalizeLauncher(r.launcher);
  out.selection = normalizeSelection(r.selection);
  out.typing = normalizeTyping(r.typing);
  // The open Island's sizes and window type (settings from before them get the defaults).
  // The deck (pinned tools) came after the tabs: settings from before it keep the person's first choices.
  const rawIsland = r.island && typeof r.island === 'object' ? (r.island as Record<string, unknown>) : {};
  out.island.deck = Array.isArray(rawIsland.deck) ? cleanDeck(rawIsland.deck) : migrateDeck(out.island.toolOrder, out.island.toolsOff);
  // The open model's shorter hover delay: settings from before it that still have the old default get the new one, once.
  out.island.hoverDelayMs = migrateHoverDelay(out.island.hoverDelayMs, Object.keys(rawIsland).length > 0 && rawIsland.openModel !== 1);
  out.island.openModel = 1;
  out.island = { ...out.island, panelSize: isPanelSize(out.island.panelSize) ? out.island.panelSize : 'regular', panelSizes: cleanPanelSizes(out.island.panelSizes) as IslandSettings['panelSizes'], windowType: islandWindowType(out.island.windowType), ...cleanLook(out.island) };
  // The Library and Cloud & Servers sections are gone (types are chips on the file list; connections are in Locations).
  Object.assign(out, migrateSidebarLists(out));
  out.sidebarSectionLimit = Number.isFinite(out.sidebarSectionLimit) ? Math.max(0, Math.min(50, Math.round(out.sidebarSectionLimit))) : 5;
  if (!['', 'all', 'onDemand'].includes(out.permissionsSetup)) out.permissionsSetup = '';
  return out;
}
