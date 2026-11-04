// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every setting Settings shows, in one registry: its section, its words, Basic
// or Advanced, what it costs, and words people search for it by. The Settings
// page, its search, reset, "Changed", export and import all read this.
//
// A row with `path` reads and writes that place in the settings (defaults come
// from defaultSettings(), so there is one source). A row with `panel` is drawn
// by its own component (themes, accounts, locked folders, approvals); rows with
// `inPanel` are drawn inside such a panel but still show in search, reset and
// Changed.

import { defaultSettings, mergeSettings, type AllSettings } from './settings';
import { FEATURES, featureOffered, featureStates } from './features';
import { ISLAND_INTENSITIES, ISLAND_LOOKS, ISLAND_PRESETS } from './island-look';

export type SectionId = 'general' | 'appearance' | 'features' | 'files' | 'island' | 'menubar' | 'ai' | 'pim' | 'privacy' | 'accessibility' | 'battery' | 'devices' | 'account' | 'about';

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: string;
  /** shown only while this part is on */
  feature?: string;
  /** shown on these systems with another name */
  labelFor?: Partial<Record<string, string>>;
  keywords?: string[];
}

export const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: 'settings', keywords: ['shortcuts', 'updates', 'language', 'startup', 'export', 'import', 'reset'] },
  { id: 'appearance', label: 'Appearance', icon: 'palette', keywords: ['theme', 'dark', 'light', 'sidebar', 'colors', 'look'] },
  { id: 'features', label: 'Features', icon: 'grid', keywords: ['parts', 'presets', 'turn off', 'apps'] },
  { id: 'files', label: 'Files & search', icon: 'folder', keywords: ['library', 'folders', 'clean up', 'locked', 'open with'] },
  { id: 'island', label: 'The Island', icon: 'island', feature: 'island', keywords: ['notch', 'shelf', 'clipboard'] },
  { id: 'menubar', label: 'Menu bar', labelFor: { win32: 'System tray', linux: 'Tray' }, icon: 'columns', keywords: ['tray', 'owl', 'summary'] },
  { id: 'ai', label: 'AI', icon: 'sparkle', keywords: ['assistant', 'model', 'brain', 'chatgpt', 'claude', 'ollama'] },
  { id: 'pim', label: 'Mail & Calendar', icon: 'mail', feature: 'mail', keywords: ['accounts', 'email', 'calendar', 'signature'] },
  { id: 'privacy', label: 'Privacy & permissions', icon: 'shield', keywords: ['permissions', 'approvals', 'usage stats', 'telemetry', 'tracking'] },
  { id: 'accessibility', label: 'Accessibility', icon: 'eye', keywords: ['motion', 'text size', 'focus'] },
  { id: 'battery', label: 'Battery and speed', icon: 'bolt', keywords: ['performance', 'power', 'memory', 'resources'] },
  { id: 'devices', label: 'Devices', icon: 'link', feature: 'link', keywords: ['mesh', 'phone', 'pair'] },
  // Only in builds with Keeper Pro switched on (core/pro-switch.ts): otherwise its part is left out and so is the section.
  { id: 'account', label: 'Account & Pro', icon: 'key', feature: 'proAccount', keywords: ['plan', 'license', 'subscription', 'upgrade', 'restore purchase', 'team'] },
  { id: 'about', label: 'About', icon: 'info', keywords: ['version', 'license', 'report a problem'] },
];

export type SettingKind = 'toggle' | 'choice' | 'number' | 'text' | 'shortcut' | 'list' | 'panel' | 'action' | 'link';

export interface SettingDef {
  id: string;
  /** where it lives in the settings (dot path), for rows Keeper reads and writes itself */
  path?: string;
  section: SectionId;
  /** sub-heading inside the section */
  group?: string;
  /** at most 6 words */
  label: string;
  /** at most 20 words */
  help?: string;
  level: 'basic' | 'advanced';
  kind: SettingKind;
  /** choices: value → words */
  choices?: { value: string | number; label: string }[];
  /** number rows: unit, smallest value */
  unit?: string;
  min?: number;
  /** a toggle that is on when the stored value is false */
  invert?: boolean;
  /** drawn by this component (src/screens/settings/panels.tsx) */
  panel?: string;
  /** drawn inside another row's panel (reveals that panel) */
  inPanel?: string;
  /** link rows: the page they open */
  to?: { name: string; arg?: string };
  /** hidden while this part is off */
  feature?: string;
  platforms?: string[];
  /** "Applies after restart" */
  restart?: boolean;
  /** "Uses the internet" */
  network?: boolean;
  /** words people search for it by */
  keywords?: string[];
  /** default true; false for secrets, device ids and paths, which differ between computers */
  exportable?: boolean;
  /** default true; false for accounts, folders and keys, which Reset never touches */
  resettable?: boolean;
  /** another name on these systems */
  labelFor?: Partial<Record<string, string>>;
}

export const SETTINGS: SettingDef[] = [
  // ---------------------------------------------------------------- General
  { id: 'login', section: 'general', label: 'Open at login', help: 'Keeper starts quietly, so Quick Search, the Island and automations are ready.', level: 'basic', kind: 'panel', panel: 'login', keywords: ['startup', 'boot', 'start automatically', 'launch at login', 'sign in'] },
  { id: 'quickSearchShortcut', path: 'quickSearchShortcut', section: 'general', group: 'Shortcuts', label: 'Quick Search shortcut', help: 'Search your files from any app.', level: 'basic', kind: 'shortcut', feature: 'quickSearch', keywords: ['hotkey', 'keyboard shortcut', 'spotlight', 'launcher'] },
  { id: 'selection.shortcut', path: 'selection.shortcut', section: 'general', group: 'Shortcuts', label: 'Selected text shortcut', help: 'Select text in any app, press this: copy, search, translate, rewrite, define.', level: 'basic', kind: 'shortcut', feature: 'selectionBar', keywords: ['hotkey', 'translate', 'selection', 'popup', 'define', 'rewrite'] },
  { id: 'today.captureShortcut', path: 'today.captureShortcut', section: 'general', group: 'Shortcuts', label: 'Inbox shortcut', help: 'Catch a thought, a link or a screenshot from any app; sort it later.', level: 'basic', kind: 'shortcut', feature: 'captureInbox', keywords: ['hotkey', 'capture', 'quick note', 'jot', 'idea', 'inbox'] },
  { id: 'shortcuts', section: 'general', group: 'Shortcuts', label: 'Shortcuts from any app', help: 'Every shortcut Keeper sets, and whether another app has taken it.', level: 'basic', kind: 'panel', panel: 'shortcuts', keywords: ['hotkey', 'keyboard shortcut', 'keys', 'conflict', 'taken', 'global'] },
  { id: 'launcher.calc', path: 'launcher.calc', section: 'general', group: 'Quick Search', label: 'Answer sums and conversions', help: 'Type 12*7 or 5 ft in cm and the answer comes first. Enter copies it.', level: 'basic', kind: 'toggle', feature: 'launcher', keywords: ['calculator', 'math', 'units', 'convert'] },
  { id: 'launcherLinks', section: 'general', group: 'Quick Search', label: 'Saved links', help: 'A word and an address: “map berlin” opens the map with Berlin filled in.', level: 'basic', kind: 'panel', panel: 'launcherLinks', feature: 'launcher', keywords: ['quicklinks', 'bookmarks', 'search engines', 'keywords', 'shortcuts'] },
  { id: 'launcher.currency', path: 'launcher.currency', section: 'general', group: 'Quick Search', label: 'Convert currencies', help: 'Downloads the European Central Bank’s daily rates when you convert money.', level: 'advanced', kind: 'toggle', feature: 'launcher', network: true, keywords: ['money', 'exchange rate', 'euro', 'dollar'] },
  { id: 'launcherCommands', section: 'general', group: 'Quick Search', label: 'Your commands', help: 'Run your own scripts from Quick Search. Keeper asks before each run.', level: 'advanced', kind: 'panel', panel: 'launcherCommands', feature: 'launcher', keywords: ['scripts', 'shell', 'terminal', 'workflows', 'run'] },
  { id: 'snippetsPage', section: 'general', group: 'Typing', label: 'Typed snippets', help: 'Abbreviations that become your saved text in any app.', level: 'basic', kind: 'link', to: { name: 'snippets' }, feature: 'textSnippets', keywords: ['text expansion', 'abbreviations', 'autotext', 'expand'] },
  { id: 'todayCards', section: 'general', group: 'Today', label: 'Choose Today’s cards', help: 'Edit Hello to show or hide each card on Today.', level: 'basic', kind: 'link', to: { name: 'home' }, keywords: ['hello', 'home', 'start page', 'agenda', 'what now', 'dashboard'] },
  { id: 'today.dayStart', path: 'today.dayStart', section: 'general', group: 'Today', label: 'Working day starts', help: 'Plan my day puts tasks between these times.', level: 'advanced', kind: 'choice', feature: 'dayPlan', choices: [{ value: 360, label: '6:00' }, { value: 390, label: '6:30' }, { value: 420, label: '7:00' }, { value: 450, label: '7:30' }, { value: 480, label: '8:00' }, { value: 510, label: '8:30' }, { value: 540, label: '9:00' }, { value: 570, label: '9:30' }, { value: 600, label: '10:00' }, { value: 630, label: '10:30' }, { value: 660, label: '11:00' }, { value: 690, label: '11:30' }, { value: 720, label: '12:00' }], keywords: ['time blocking', 'work hours', 'plan'] },
  { id: 'today.dayEnd', path: 'today.dayEnd', section: 'general', group: 'Today', label: 'Working day ends', level: 'advanced', kind: 'choice', feature: 'dayPlan', choices: [{ value: 900, label: '15:00' }, { value: 930, label: '15:30' }, { value: 960, label: '16:00' }, { value: 990, label: '16:30' }, { value: 1020, label: '17:00' }, { value: 1050, label: '17:30' }, { value: 1080, label: '18:00' }, { value: 1110, label: '18:30' }, { value: 1140, label: '19:00' }, { value: 1170, label: '19:30' }, { value: 1200, label: '20:00' }, { value: 1230, label: '20:30' }, { value: 1260, label: '21:00' }], keywords: ['time blocking', 'work hours', 'wrap up', 'shutdown'] },
  { id: 'language', path: 'language', section: 'general', label: 'Language', help: 'File names and anything you write stay as they are.', level: 'basic', kind: 'panel', panel: 'language', keywords: ['translation', 'locale', 'english', 'deutsch', 'español', 'français'] },
  { id: 'updates', section: 'general', group: 'Updates', label: 'Updates', help: 'Check for a new Keeper and install it when you quit.', level: 'basic', kind: 'panel', panel: 'updates', keywords: ['update', 'upgrade', 'new version', 'beta', 'release'] },
  { id: 'updateMode', path: 'updateMode', section: 'general', group: 'Updates', label: 'Check for updates automatically', level: 'basic', kind: 'choice', inPanel: 'updates', choices: [{ value: 'auto', label: 'Download and install' }, { value: 'ask', label: 'Ask first' }, { value: 'off', label: 'Never' }], network: true },
  { id: 'updateBeta', path: 'updateBeta', section: 'general', group: 'Updates', label: 'Try test versions', level: 'advanced', kind: 'toggle', inPanel: 'updates', keywords: ['beta', 'pre-release'], network: true },
  { id: 'restorePlace', path: 'restorePlace', section: 'general', label: 'Reopen where I left off', help: 'After an update or a restart, windows and tabs come back where they were.', level: 'basic', kind: 'toggle', keywords: ['restore', 'session', 'reopen windows'] },
  { id: 'tabs', path: 'tabs', section: 'general', label: 'Open pages in tabs', help: 'Middle-click or ⌘/Ctrl-click to open a page in a new tab.', level: 'basic', kind: 'toggle', keywords: ['tab bar', 'new tab'] },
  { id: 'setupAgain', section: 'general', label: 'Set up Keeper again', help: 'Choose again what Keeper does for you. Nothing you made is removed.', level: 'basic', kind: 'panel', panel: 'setupAgain', keywords: ['first run', 'welcome', 'onboarding', 'presets', 'recommended', 'tour'] },
  { id: 'captureExtras', section: 'general', group: 'Screen', label: 'Screenshot extras', help: 'A preview after each screenshot, a self-timer, window shadows and pictures pinned on screen.', level: 'basic', kind: 'link', to: { name: 'capture' }, feature: 'capture', keywords: ['quick access', 'thumbnail', 'pin', 'float', 'scrolling screenshot', 'long screenshot', 'timer', 'shadow'] },
  { id: 'drawOnScreen', section: 'general', group: 'Screen', label: 'Draw on screen', help: 'A pen, highlighter, arrows and a spotlight over any app while you present.', level: 'basic', kind: 'link', to: { name: 'stage' }, feature: 'drawOnScreen', keywords: ['annotate screen', 'presentation', 'pen', 'highlighter', 'ink', 'whiteboard', 'zoom it', 'laser pointer'] },
  { id: 'shareLinks', section: 'general', group: 'Screen', label: 'Where share links go', help: 'Your own WebDAV server or storage bucket, for Studio videos and screenshots. Never a Keeper server.', level: 'basic', kind: 'link', to: { name: 'island' }, network: true, keywords: ['upload', 'share link', 'cloud link', 's3', 'bucket', 'nextcloud', 'video link'] },
  { id: 'declutter', path: 'declutter', section: 'features', label: 'Suggest turning off unused parts', help: 'A part you haven’t opened in 30 days shows on the Fix-it List, with Undo.', level: 'basic', kind: 'toggle', feature: 'guide', keywords: ['declutter', 'unused', 'tidy', 'lighter', 'turn off', 'suggestions'] },
  { id: 'tips.on', path: 'tips.on', section: 'general', label: 'Getting to know Keeper', help: 'One short tip a day on Home, for your first week.', level: 'basic', kind: 'toggle', keywords: ['tips', 'onboarding', 'learn', 'hints', 'tour'] },
  { id: 'helpButton', path: 'helpButton', section: 'general', label: 'Show the Help button', help: 'The ? in the top bar explains the page you are on. F1 works either way.', level: 'basic', kind: 'toggle', keywords: ['help', 'question mark', 'guide', 'docs', 'documentation', 'how to', 'manual'] },
  { id: 'settingsAdvanced', path: 'settingsAdvanced', section: 'general', label: 'Always show all settings', help: 'Opens “More settings” in every section.', level: 'basic', kind: 'toggle', keywords: ['advanced', 'expert', 'show everything', 'more settings'] },
  { id: 'reader.refreshMinutes', path: 'reader.refreshMinutes', section: 'general', group: 'Reader', label: 'Look for new articles', help: 'How often your feeds are read. Only the feeds you add are fetched.', level: 'basic', kind: 'choice', choices: [{ value: 30, label: 'Every 30 minutes' }, { value: 60, label: 'Every hour' }, { value: 180, label: 'Every 3 hours' }, { value: 720, label: 'Twice a day' }, { value: 1440, label: 'Once a day' }], feature: 'reader', network: true, keywords: ['rss', 'feeds', 'refresh', 'news'] },
  { id: 'reader.fullText', path: 'reader.fullText', section: 'general', group: 'Reader', label: 'Fetch whole articles', help: 'When a feed gives only a summary, the article’s page is read and kept.', level: 'basic', kind: 'toggle', feature: 'reader', network: true, keywords: ['full text', 'summary', 'offline'] },
  { id: 'reader.images', path: 'reader.images', section: 'general', group: 'Reader', label: 'Show pictures in articles', help: 'Pictures load from the article’s site. Off shows text only.', level: 'advanced', kind: 'toggle', feature: 'reader', network: true, keywords: ['images', 'privacy'] },
  { id: 'reader.keepDays', path: 'reader.keepDays', section: 'general', group: 'Reader', label: 'Keep read articles for', help: 'Starred and saved articles always stay.', level: 'advanced', kind: 'choice', choices: [{ value: 7, label: 'A week' }, { value: 30, label: 'A month' }, { value: 90, label: 'Three months' }, { value: 365, label: 'A year' }], feature: 'reader', keywords: ['history', 'clean up'] },
  { id: 'weatherSource', path: 'weatherSource', section: 'general', group: 'Weather', label: 'Forecasts from', help: 'Both are free and need no account. Only your places are sent.', level: 'advanced', kind: 'choice', choices: [{ value: 'met', label: 'MET Norway' }, { value: 'open-meteo', label: 'Open-Meteo' }], feature: 'weather', network: true, keywords: ['weather', 'forecast', 'source', 'provider', 'met.no', 'yr'] },
  { id: 'photoEditorPage', section: 'files', group: 'Photo editor', label: 'Edit a picture', help: 'Crop, straighten, light and colour, hide private parts. The original is kept.', level: 'basic', kind: 'link', to: { name: 'photo' }, feature: 'photoEditor', keywords: ['crop', 'rotate', 'brightness', 'blur', 'redact', 'resize', 'background'] },
  { id: 'monitorsPage', section: 'general', group: 'Monitors', label: 'Sites and servers to watch', help: 'Add, import and pause checks; alerts go to the Island and your phone.', level: 'basic', kind: 'link', to: { name: 'monitors' }, feature: 'monitors', keywords: ['uptime', 'website down', 'ping', 'port', 'certificate', 'status'] },
  { id: 'notices.panel', section: 'general', group: 'Notifications', label: 'How each part tells you', help: 'Now, batched into one summary a few times a day, or silent.', level: 'basic', kind: 'panel', panel: 'noticeParts', feature: 'notices', keywords: ['notifications', 'alerts', 'batch', 'quiet', 'silent', 'digest', 'interruptions'] },
  { id: 'notices.batch', path: 'notices.batch', section: 'general', group: 'Notifications', label: 'Batched notices arrive', level: 'basic', kind: 'choice', choices: [{ value: 'thrice', label: 'At 9, 13 and 17' }, { value: 'hourly', label: 'Every hour' }], feature: 'notices', keywords: ['digest', 'summary', 'batch'] },
  { id: 'notices.quiet', section: 'general', group: 'Notifications', label: 'Quiet hours', help: 'Nothing is shown in these hours, except alarms.', level: 'basic', kind: 'panel', panel: 'quietHours', feature: 'notices', keywords: ['do not disturb', 'night', 'sleep', 'quiet time', 'mute'] },
  { id: 'notices.followFocus', path: 'notices.followFocus', section: 'general', group: 'Notifications', label: 'Hold notices while I focus', help: 'While Keeper’s focus timer runs.', level: 'basic', kind: 'toggle', feature: 'notices', keywords: ['focus', 'pomodoro', 'do not disturb'] },
  { id: 'notices.followSystem', path: 'notices.followSystem', section: 'general', group: 'Notifications', label: 'Follow Do Not Disturb', help: 'Where Keeper can read it (GNOME today).', level: 'advanced', kind: 'toggle', feature: 'notices', keywords: ['do not disturb', 'focus mode', 'dnd'] },
  { id: 'phoneAlertsPage', section: 'general', group: 'Phone alerts', label: 'Alerts to your phone', help: 'Choose where alerts go: ntfy, Telegram, e-mail or a web address.', level: 'basic', kind: 'link', to: { name: 'alerts' }, feature: 'phoneAlerts', keywords: ['notifications', 'push', 'telegram', 'ntfy', 'webhook', 'email'] },
  { id: 'phoneAlerts.batchSeconds', path: 'phoneAlerts.batchSeconds', section: 'general', group: 'Phone alerts', label: 'Send alerts together', help: 'Alerts that come close together arrive as one message.', level: 'advanced', kind: 'choice', choices: [{ value: 0, label: 'Right away' }, { value: 30, label: 'Within 30 seconds' }, { value: 120, label: 'Within 2 minutes' }, { value: 600, label: 'Within 10 minutes' }], feature: 'phoneAlerts', keywords: ['batch', 'bundle', 'quiet'] },
  { id: 'journal.weather', path: 'journal.weather', section: 'privacy', group: 'Journal', label: 'Weather in journal entries', help: 'Today’s entry notes the weather where you are, from Keeper’s Weather.', level: 'basic', kind: 'toggle', feature: 'journal', keywords: ['diary', 'temperature'] },
  { id: 'journal.place', path: 'journal.place', section: 'privacy', group: 'Journal', label: 'Places in journal entries', help: 'An entry notes where you were that day, from Places & Tracks.', level: 'basic', kind: 'toggle', feature: 'journal', keywords: ['diary', 'location', 'where'] },
  { id: 'journal.photos', path: 'journal.photos', section: 'privacy', group: 'Journal', label: 'Suggest photos from that day', help: 'Shows photos from your folders taken that day; nothing is added until you choose.', level: 'basic', kind: 'toggle', feature: 'journal', keywords: ['diary', 'pictures', 'camera'] },
  { id: 'timeTrack.page', section: 'privacy', group: 'Time tracking', label: 'Projects and recorded time', help: 'Your days and weeks, project rules, and CSV.', level: 'basic', kind: 'link', to: { name: 'time' }, feature: 'timeTracking', keywords: ['time tracker', 'timesheet', 'hours', 'productivity'] },
  { id: 'timeTrack.titles', path: 'timeTrack.titles', section: 'privacy', group: 'Time tracking', label: 'Keep window titles', help: 'Document and page names. Off keeps only the app and site.', level: 'basic', kind: 'toggle', feature: 'timeTracking', keywords: ['documents', 'window names', 'private'] },
  { id: 'timeTrack.sites', path: 'timeTrack.sites', section: 'privacy', group: 'Time tracking', label: 'Keep websites', help: 'The site in front, from Keeper’s browser extension.', level: 'basic', kind: 'toggle', feature: 'timeTracking', keywords: ['browser', 'domains', 'tabs'] },
  { id: 'timeTrack.idleMinutes', path: 'timeTrack.idleMinutes', section: 'privacy', group: 'Time tracking', label: 'Stop counting when away', help: 'Nobody touching the computer for this long ends the time.', level: 'advanced', kind: 'choice', choices: [{ value: 2, label: '2 minutes' }, { value: 5, label: '5 minutes' }, { value: 10, label: '10 minutes' }, { value: 15, label: '15 minutes' }, { value: 30, label: '30 minutes' }], feature: 'timeTracking', keywords: ['idle', 'afk', 'away'] },
  { id: 'timeTrack.keepDays', path: 'timeTrack.keepDays', section: 'privacy', group: 'Time tracking', label: 'Keep recorded time for', help: 'Older days are deleted.', level: 'advanced', kind: 'choice', choices: [{ value: 7, label: 'A week' }, { value: 30, label: 'A month' }, { value: 90, label: 'Three months' }, { value: 365, label: 'A year' }, { value: 3650, label: 'Ten years' }], feature: 'timeTracking', keywords: ['history', 'retention', 'delete'] },
  { id: 'focusBlock.page', section: 'general', group: 'Focus blocking', label: 'Lists and schedules', help: 'Which sites and apps are blocked, and when.', level: 'basic', kind: 'link', to: { name: 'blocking' }, feature: 'focusBlock', keywords: ['block sites', 'block apps', 'distractions', 'social media', 'schedule'] },
  { id: 'focusBlock.withFocus', path: 'focusBlock.withFocus', section: 'general', group: 'Focus blocking', label: 'Block during Focus sessions', help: 'Your Focus list is blocked whenever a Focus session runs.', level: 'basic', kind: 'toggle', feature: 'focusBlock', keywords: ['pomodoro', 'timer', 'distractions'] },
  { id: 'focusBlock.strict', path: 'focusBlock.strict', section: 'general', group: 'Focus blocking', label: 'Strict mode', help: 'No short visits and no early stop until a block ends.', level: 'basic', kind: 'toggle', feature: 'focusBlock', keywords: ['locked', 'cannot stop', 'hard mode'] },
  { id: 'focusBlock.passMinutes', path: 'focusBlock.passMinutes', section: 'general', group: 'Focus blocking', label: 'Length of a short visit', help: 'How long “Let me in” opens a blocked site or app.', level: 'advanced', kind: 'choice', choices: [{ value: 1, label: '1 minute' }, { value: 3, label: '3 minutes' }, { value: 5, label: '5 minutes' }, { value: 10, label: '10 minutes' }, { value: 15, label: '15 minutes' }], feature: 'focusBlock', keywords: ['pass', 'let me in', 'break'] },
  { id: 'focusBlock.waitSeconds', path: 'focusBlock.waitSeconds', section: 'general', group: 'Focus blocking', label: 'Pause before a short visit', help: 'A few seconds to think before a blocked site opens.', level: 'advanced', kind: 'choice', choices: [{ value: 0, label: 'No pause' }, { value: 5, label: '5 seconds' }, { value: 10, label: '10 seconds' }, { value: 30, label: '30 seconds' }, { value: 60, label: '1 minute' }], feature: 'focusBlock', keywords: ['friction', 'wait', 'delay'] },
  { id: 'focusBlock.closeApps', path: 'focusBlock.closeApps', section: 'general', group: 'Focus blocking', label: 'Close blocked apps', help: 'Quit a blocked app when it comes to the front, instead of covering it.', level: 'advanced', kind: 'toggle', feature: 'focusBlock', keywords: ['quit apps', 'kill'] },
  { id: 'settingsIo', section: 'general', group: 'Export and import', label: 'Export or import settings', help: 'Move your settings to another computer. Passwords and keys are never included.', level: 'basic', kind: 'panel', panel: 'settingsIo', keywords: ['backup settings', 'transfer', 'migrate', 'copy settings', 'restore settings'] },
  { id: 'exportTasks', section: 'general', group: 'Export and import', label: 'Export tasks and Island notes', help: 'Every task and Island note, as one file you keep. Nothing is uploaded.', level: 'advanced', kind: 'panel', panel: 'exportTasks', keywords: ['todo', 'reminders', 'backup', 'json'] },
  { id: 'resetAll', section: 'general', group: 'Export and import', label: 'Reset all settings', help: 'Puts every setting back as it came. Accounts, folders and keys stay.', level: 'advanced', kind: 'panel', panel: 'resetAll', keywords: ['factory', 'defaults', 'start over'] },

  // ---------------------------------------------------------------- Appearance
  { id: 'theme', path: 'theme', section: 'appearance', label: 'Theme', level: 'basic', kind: 'panel', panel: 'theme', keywords: ['look', 'skin', 'colors', 'style'] },
  { id: 'appearance', path: 'appearance', section: 'appearance', label: 'Light or dark', help: 'Themes made for only one of them say so on their card.', level: 'basic', kind: 'choice', choices: [{ value: 'system', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], keywords: ['dark mode', 'night mode', 'light mode', 'appearance', 'black'] },
  { id: 'themeTweaks', section: 'appearance', label: 'Accent, text and corners', level: 'basic', kind: 'panel', panel: 'themeTweaks', keywords: ['accent', 'font', 'density', 'compact', 'corners', 'seasons'] },
  { id: 'accent', path: 'accent', section: 'appearance', label: 'Accent color', level: 'basic', kind: 'text', inPanel: 'themeTweaks', keywords: ['highlight', 'tint', 'colour'] },
  { id: 'font', path: 'font', section: 'appearance', label: 'Text style', level: 'basic', kind: 'choice', inPanel: 'themeTweaks', choices: [{ value: 'theme', label: 'Theme' }, { value: 'system', label: 'System' }, { value: 'rounded', label: 'Rounded' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }], keywords: ['font', 'typeface'] },
  { id: 'density', path: 'density', section: 'appearance', label: 'Spacing', level: 'basic', kind: 'choice', inPanel: 'themeTweaks', choices: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], keywords: ['density', 'compact', 'dense'] },
  { id: 'corners', path: 'corners', section: 'appearance', label: 'Corners', level: 'basic', kind: 'choice', inPanel: 'themeTweaks', choices: [{ value: 'theme', label: 'Theme' }, { value: 'rounded', label: 'Rounded' }, { value: 'sharp', label: 'Sharp' }], keywords: ['radius', 'square'] },
  { id: 'themeSeasons', path: 'themeSeasons', section: 'appearance', label: 'Follow the seasons', level: 'advanced', kind: 'toggle', inPanel: 'themeTweaks', keywords: ['spring', 'summer', 'autumn', 'winter'] },
  { id: 'sidebarMode', path: 'sidebarMode', section: 'appearance', group: 'Sidebar', label: 'Sidebar', help: 'Automatic shows only icons in a narrow window.', level: 'basic', kind: 'choice', choices: [{ value: 'auto', label: 'Automatic' }, { value: 'full', label: 'Always full' }, { value: 'compact', label: 'Icons only' }], keywords: ['rail', 'icons', 'collapse', 'navigation'] },
  { id: 'inspectorMode', path: 'inspectorMode', section: 'appearance', label: 'Details panel', help: 'Shows details of the selected file. Show or hide: ⌘⌥I / Ctrl+Alt+I.', level: 'advanced', kind: 'choice', choices: [{ value: 'selection', label: 'When something is selected' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], keywords: ['inspector', 'info panel', 'details', 'right panel'] },
  { id: 'sidebarSectionLimit', path: 'sidebarSectionLimit', section: 'appearance', group: 'Sidebar', label: 'Items per sidebar section', help: 'The rest are under “Show all”.', level: 'advanced', kind: 'choice', choices: [{ value: 3, label: '3 items' }, { value: 5, label: '5 items' }, { value: 8, label: '8 items' }, { value: 12, label: '12 items' }, { value: 0, label: 'Everything' }], keywords: ['show all', 'long sections'] },
  { id: 'sidebarTypes', path: 'sidebarTypes', section: 'appearance', group: 'Sidebar', label: 'Find by type in the sidebar', help: 'A folded list of Documents, Pictures and more.', level: 'advanced', kind: 'toggle', keywords: ['library', 'all documents', 'kinds', 'file types', 'screenshots', 'downloaded from'] },
  { id: 'sidebarCustom', section: 'appearance', group: 'Sidebar', label: 'Sections in the sidebar', help: 'Show, hide and order them; bring back entries you removed.', level: 'advanced', kind: 'panel', panel: 'sidebarCustom', keywords: ['customize sidebar', 'reorder', 'hide section'] },

  // ---------------------------------------------------------------- Features
  { id: 'features', section: 'features', label: 'Turn off what you don’t use', help: 'It stops completely and leaves the sidebar.', level: 'basic', kind: 'panel', panel: 'features', keywords: ['parts', 'presets', 'disable', 'enable', 'switch off', 'modules', 'plugins'] },
  { id: 'ashfordeApps', section: 'features', label: 'Other apps by Ashforde', help: 'Install and work with Monorail, the window manager.', level: 'advanced', kind: 'panel', panel: 'ashfordeApps', keywords: ['monorail', 'window manager', 'tiling'] },

  // ---------------------------------------------------------------- Files & search
  { id: 'folders', path: 'folders', section: 'files', label: 'Folders to search', level: 'basic', kind: 'list', exportable: false, resettable: false, keywords: ['library', 'locations', 'add folder', 'where keeper looks'] },
  { id: 'excluded', path: 'excluded', section: 'files', label: 'Folders to skip', help: 'Keeper won’t search, clean or change anything in these.', level: 'basic', kind: 'list', exportable: false, resettable: false, keywords: ['exclude', 'ignore', 'never look', 'private'] },
  { id: 'ocrEnabled', path: 'ocrEnabled', section: 'files', label: 'Find text in pictures and scans', help: 'Search finds words in screenshots and scanned PDFs. Works on this computer.', level: 'basic', kind: 'toggle', keywords: ['ocr', 'text recognition', 'screenshots', 'scan'] },
  { id: 'showHidden', path: 'showHidden', section: 'files', label: 'Show hidden files', help: 'Files whose names start with a dot. ⌘⇧. / Ctrl+Shift+. switches.', level: 'basic', kind: 'toggle', keywords: ['dotfiles', 'invisible', 'dot files'] },
  { id: 'lockedFolders', section: 'files', label: 'Locked folders', help: 'Encrypted on disk; they open with Touch ID, Windows Hello or your password.', level: 'basic', kind: 'panel', panel: 'lockedFolders', feature: 'lock', keywords: ['encrypt', 'password', 'vault', 'private', 'lock'] },
  { id: 'includeRemote', path: 'includeRemote', section: 'files', label: 'Search network and cloud drives too', help: 'Slow, and may download every cloud file. Best left off.', level: 'advanced', kind: 'toggle', network: true, keywords: ['nas', 'cloud drive', 'network drive'] },
  { id: 'ocrLanguages', path: 'ocrLanguages', section: 'files', label: 'Languages in pictures', help: 'Pick the languages your screenshots and scans are in. Each downloads once (a few MB).', level: 'advanced', kind: 'panel', panel: 'ocrLanguages', keywords: ['ocr', 'language', 'chinese', 'japanese', 'german'] },
  { id: 'rescan', section: 'files', label: 'Search everything again', help: 'Only needed if search misses a file. Can take a while.', level: 'advanced', kind: 'action', keywords: ['rebuild', 'rescan', 'reindex', 'refresh library'] },
  { id: 'oldDownloadDays', path: 'oldDownloadDays', section: 'files', group: 'Clean up', label: 'Suggest removing downloads older than', level: 'advanced', kind: 'number', unit: 'days', min: 7, keywords: ['old downloads', 'forgotten'] },
  { id: 'largeFileMb', path: 'largeFileMb', section: 'files', group: 'Clean up', label: 'Count files as large from', level: 'advanced', kind: 'number', unit: 'MB', min: 10, keywords: ['big files', 'size'] },
  { id: 'unusedAppDays', path: 'unusedAppDays', section: 'files', group: 'Clean up', label: 'Suggest removing apps unused for', level: 'advanced', kind: 'number', unit: 'days', min: 30, keywords: ['unused apps', 'uninstall'] },
  { id: 'openWith', section: 'files', label: 'Apps that open your files', help: 'Which app opens maps, weather, events and addresses.', level: 'advanced', kind: 'panel', panel: 'openWith', keywords: ['open with', 'default apps', 'native apps', 'maps', 'calendar app'] },
  { id: 'platform', section: 'files', label: 'Works with your computer', labelFor: { darwin: 'Finder, Spotlight and Shortcuts', win32: 'File Explorer and Windows Search', linux: 'File manager and desktop search' }, help: 'Keeper in your system’s search and file menus.', level: 'advanced', kind: 'panel', panel: 'platform', feature: 'platform', keywords: ['spotlight', 'explorer', 'context menu', 'siri', 'integration'] },

  // ---------------------------------------------------------------- The Island
  { id: 'island.enabled', path: 'island.enabled', section: 'island', label: 'Show the Island', help: 'The bar at the top of the screen: drop shelf, now playing, timers and alerts.', level: 'basic', kind: 'toggle', keywords: ['notch', 'dynamic island', 'top bar'] },
  { id: 'island.look', path: 'island.look', section: 'island', group: 'Look', label: 'Island colours', help: 'Match your theme, stay dark, or use a bright gradient.', level: 'basic', kind: 'choice', choices: ISLAND_LOOKS.map((l) => ({ value: l.id, label: l.label })), feature: 'island', keywords: ['color', 'colour', 'theme', 'gradient', 'black', 'dark', 'colourful', 'colorful', 'look'] },
  { id: 'island.lookIntensity', path: 'island.lookIntensity', section: 'island', group: 'Look', label: 'Colour strength', help: 'Subtle or bold colours in the Island.', level: 'basic', kind: 'choice', choices: ISLAND_INTENSITIES.map((l) => ({ value: l.id, label: l.label })), feature: 'island', keywords: ['intensity', 'vivid', 'subtle', 'bold', 'color'] },
  { id: 'island.lookPreset', path: 'island.lookPreset', section: 'island', group: 'Look', label: 'Colourful gradient', help: 'The gradient for the Colourful look.', level: 'advanced', kind: 'choice', choices: ISLAND_PRESETS.map((p) => ({ value: p.id, label: p.name })), feature: 'island', keywords: ['gradient', 'preset', 'color'] },
  { id: 'island.lookAccent', path: 'island.lookAccent', section: 'island', group: 'Look', label: 'Island accent', help: 'Buttons, highlights and the glow. Text stays easy to read.', level: 'advanced', kind: 'panel', panel: 'islandAccent', feature: 'island', keywords: ['accent', 'color', 'colour', 'highlight', 'glow'] },
  { id: 'island.hoverOpen', path: 'island.hoverOpen', section: 'island', label: 'Open when I point at it', level: 'basic', kind: 'toggle', feature: 'island', keywords: ['hover'] },
  { id: 'island.hideInFullscreen', path: 'island.hideInFullscreen', section: 'island', label: 'Hide in full screen', help: 'Steps aside for full-screen video and slides.', level: 'basic', kind: 'toggle', feature: 'island', keywords: ['fullscreen', 'video', 'presentation'] },
  { id: 'island.clipboard', path: 'island.clipboard', section: 'island', label: 'Clipboard history', help: 'Keeps what you copy. Text that looks like a password is never saved.', level: 'basic', kind: 'toggle', feature: 'island', keywords: ['copy', 'paste', 'clipboard manager'] },
  { id: 'island.clipIgnoreApps', path: 'island.clipIgnoreApps', section: 'island', label: 'Never keep copies from', help: 'Apps whose copies are never kept, such as password managers.', level: 'basic', kind: 'panel', panel: 'clipIgnore', feature: 'clipboard', exportable: false, resettable: false, keywords: ['ignore', 'exclude', 'private', 'password manager', 'never record'] },
  { id: 'island.more', section: 'island', label: 'All Island settings', help: 'Tools, sizes, shortcuts, placement and more.', level: 'basic', kind: 'link', to: { name: 'island' }, feature: 'island', keywords: ['island tools', 'shelf', 'placement', 'position', 'size of the open island'] },
  { id: 'island.windowType', path: 'island.windowType', section: 'island', label: 'Island window style', help: 'Try “Panel” if the Island looks or acts wrong.', level: 'advanced', kind: 'choice', choices: [{ value: 'standard', label: 'Standard' }, { value: 'panel', label: 'Panel' }], restart: true, feature: 'island' },
  { id: 'island.x11OnWayland', path: 'island.x11OnWayland', section: 'island', label: 'Compatibility mode (XWayland)', help: 'Turn off only if the Island sits in the wrong place.', level: 'advanced', kind: 'toggle', platforms: ['linux'], restart: true, feature: 'island', keywords: ['wayland', 'x11', 'position'] },
  { id: 'island.mediaKeys', path: 'island.mediaKeys', section: 'island', label: 'Media keys', help: 'Play, pause and skip with the keyboard’s media keys.', level: 'advanced', kind: 'toggle', feature: 'island', keywords: ['play pause', 'music keys'] },
  { id: 'island.buddy', path: 'island.buddy', section: 'island', label: 'Show a little face', level: 'advanced', kind: 'toggle', feature: 'island', keywords: ['buddy', 'owl', 'mascot'] },
  { id: 'island.shelfKeepCopies', path: 'island.shelfKeepCopies', section: 'island', label: 'Shelf keeps copies', help: 'Files dropped on the shelf are copied, so moving the original is safe.', level: 'advanced', kind: 'toggle', feature: 'island', keywords: ['drop shelf', 'files'] },
  { id: 'island.cleanLinks', path: 'island.cleanLinks', section: 'island', label: 'Clean links you copy', help: 'Removes tracking bits like utm_ and fbclid from copied links.', level: 'advanced', kind: 'toggle', feature: 'clipboard', keywords: ['tracking', 'utm', 'url'] },
  { id: 'island.captureShortcut', path: 'island.captureShortcut', section: 'island', group: 'Shortcuts', label: 'Copy text from screen', level: 'advanced', kind: 'shortcut', feature: 'capture', keywords: ['ocr', 'hotkey', 'screen text'] },
  { id: 'island.pasteShortcut', path: 'island.pasteShortcut', section: 'island', group: 'Shortcuts', label: 'Open clipboard history', level: 'advanced', kind: 'shortcut', feature: 'clipboard', keywords: ['hotkey', 'paste'] },
  { id: 'island.pasteNextShortcut', path: 'island.pasteNextShortcut', section: 'island', group: 'Shortcuts', label: 'Paste the next one', help: 'While pasting one by one. Taken only while there is something to paste.', level: 'advanced', kind: 'shortcut', feature: 'clipboard', keywords: ['paste queue', 'paste stack', 'sequential', 'hotkey'] },
  { id: 'island.plainPasteShortcut', path: 'island.plainPasteShortcut', section: 'island', group: 'Shortcuts', label: 'Paste as plain text', help: 'Pastes what you copied without its fonts and colours.', level: 'advanced', kind: 'shortcut', feature: 'clipboard', keywords: ['paste without formatting', 'plain', 'hotkey'] },
  { id: 'island.queueOnPaste', path: 'island.queueOnPaste', section: 'island', label: 'Each paste takes the next one', help: 'While pasting one by one, your usual paste keys take the next too. Listens to the keyboard only then.', level: 'advanced', kind: 'toggle', feature: 'clipboard', keywords: ['paste queue', 'paste stack', 'sequential'] },
  { id: 'island.shelfShortcut', path: 'island.shelfShortcut', section: 'island', group: 'Shortcuts', label: 'Open the shelf', level: 'advanced', kind: 'shortcut', feature: 'island', keywords: ['hotkey', 'drop shelf'] },

  // ---------------------------------------------------------------- Menu bar / tray
  { id: 'trayEnabled', path: 'trayEnabled', section: 'menubar', label: 'Keeper in the menu bar', labelFor: { win32: 'Keeper in the system tray', linux: 'Keeper in the tray' }, help: 'Click the owl for a summary: weather, storage, network and new downloads.', level: 'basic', kind: 'toggle', keywords: ['tray icon', 'menu bar icon', 'owl', 'status bar'] },
  { id: 'glance', section: 'menubar', label: 'What the summary shows', help: 'Its parts, readings and four quick actions.', level: 'basic', kind: 'panel', panel: 'glance', keywords: ['cards', 'buttons', 'quick actions', 'hover', 'downloads', 'readings', 'sections', 'network', 'apps online', 'block'] },
  { id: 'usageLabel', section: 'menubar', label: 'AI usage in the menu bar', level: 'advanced', kind: 'panel', panel: 'usageLabel', feature: 'usageTracker', keywords: ['claude', 'codex', 'limits'] },
  { id: 'monitorTray', section: 'menubar', label: 'Live readings', help: 'Processor, memory and network next to the clock.', level: 'advanced', kind: 'link', to: { name: 'health', arg: 'settings' }, feature: 'health', keywords: ['cpu', 'memory', 'stats', 'monitor'] },

  // ---------------------------------------------------------------- AI
  { id: 'brain', section: 'ai', label: 'Your AI', help: 'Which AI Keeper uses, what it may see, and other apps that use Keeper.', level: 'basic', kind: 'panel', panel: 'brain', keywords: ['openai', 'chatgpt', 'claude', 'anthropic', 'ollama', 'local ai', 'model', 'api key', 'mcp', 'local api'] },
  { id: 'selectionBar', section: 'ai', label: 'Actions for selected text', help: 'Which buttons the bar shows, the language to translate into, and where Search goes.', level: 'basic', kind: 'panel', panel: 'selectionBar', feature: 'selectionBar', keywords: ['translate', 'define', 'rewrite', 'selection', 'popup'] },
  { id: 'brain.enabled', path: 'brain.enabled', section: 'ai', label: 'Let AI search your files', level: 'basic', kind: 'toggle', inPanel: 'brain', keywords: ['brain', 'index', 'ai search'] },
  { id: 'brain.semantic', path: 'brain.semantic', section: 'ai', label: 'Search by meaning', help: 'Finds files by what they’re about. Downloads a model once; heavy while it learns.', level: 'advanced', kind: 'toggle', inPanel: 'brain', feature: 'brain', keywords: ['semantic', 'embeddings', 'vectors'] },
  { id: 'graphIncludes', section: 'ai', group: 'Knowledge graph', label: 'What the graph includes', help: 'Choose the parts, mail accounts and folders it may use. Search by meaning follows.', level: 'basic', kind: 'link', to: { name: 'graph', arg: 'privacy' }, feature: 'graphAll', keywords: ['knowledge graph', 'privacy', 'leave out', 'exclude', 'people', 'connections', 'related'] },
  { id: 'graph.mail', path: 'graph.mail', section: 'ai', group: 'Knowledge graph', label: 'Include mail', help: 'Conversations and the people in them join the graph and search by meaning.', level: 'advanced', kind: 'toggle', feature: 'graphAll', keywords: ['email', 'knowledge graph', 'privacy'] },
  { id: 'graph.calendar', path: 'graph.calendar', section: 'ai', group: 'Knowledge graph', label: 'Include calendar events', level: 'advanced', kind: 'toggle', feature: 'graphAll', keywords: ['events', 'knowledge graph'] },
  { id: 'graph.meetings', path: 'graph.meetings', section: 'ai', group: 'Knowledge graph', label: 'Include recorded meetings', level: 'advanced', kind: 'toggle', feature: 'graphAll', keywords: ['transcripts', 'knowledge graph'] },

  // ---------------------------------------------------------------- Mail & Calendar
  { id: 'pim', section: 'pim', label: 'Accounts and calendars', help: 'Mail accounts, calendars to show, notifications and your signature.', level: 'basic', kind: 'panel', panel: 'pim', keywords: ['email', 'imap', 'gmail', 'outlook', 'icloud', 'caldav', 'signature', 'notifications'] },
  { id: 'pimImport', section: 'pim', label: 'Import and export', help: 'Bring in mail, calendars, tasks and contacts from other apps, or save them as files.', level: 'basic', kind: 'panel', panel: 'pimImport', resettable: false, exportable: false, keywords: ['import', 'export', 'mbox', 'eml', 'thunderbird', 'apple mail', 'outlook', 'olm', 'pst', 'ics', 'vcf', 'vcard', 'csv', 'todoist', 'google tasks', 'to do', 'reminders', 'migrate', 'move from'] },
  { id: 'mailToday', path: 'mailToday', section: 'pim', group: 'Mail', label: 'Show today at the top of the inbox', help: 'A greeting, today’s events from your calendars with Join for video calls, and the next meeting at the top of the window.', level: 'basic', kind: 'toggle', feature: 'mail', keywords: ['greeting', 'agenda', 'events', 'meetings', 'join', 'zoom', 'today'] },
  { id: 'mailReading', section: 'pim', group: 'Mail', label: 'Reading mail', help: 'Dark mode for designed mail, text size and how close the list is.', level: 'basic', kind: 'panel', panel: 'mailReading', feature: 'mail', resettable: false, keywords: ['dark mode', 'text size', 'density', 'font size', 'compact'] },
  { id: 'mailRules', section: 'pim', group: 'Mail', label: 'Rules for new mail', help: 'Move, archive, mark read, delete or label mail as it arrives.', level: 'basic', kind: 'panel', panel: 'mailRules', feature: 'mail', resettable: false, exportable: false, keywords: ['filters', 'sieve', 'gmail filters', 'automation', 'sort mail'] },
  { id: 'mailSmart', section: 'pim', group: 'Mail', label: 'Smart mailboxes', help: 'Saved searches listed with your folders.', level: 'basic', kind: 'panel', panel: 'mailSmart', feature: 'mail', resettable: false, keywords: ['saved search', 'smart folder', 'virtual folder'] },
  { id: 'mailTemplates', section: 'pim', group: 'Mail', label: 'Templates', help: 'Messages you send often, with names and dates filled in.', level: 'basic', kind: 'panel', panel: 'mailTemplates', feature: 'mail', resettable: false, keywords: ['canned responses', 'snippets', 'saved replies'] },
  { id: 'mailAi', section: 'pim', group: 'Mail', label: 'What the AI remembers', help: 'Notes about you that AI writing keeps in mind. Kept on this computer.', level: 'basic', kind: 'panel', panel: 'mailAi', feature: 'mail', resettable: false, exportable: false, keywords: ['ai memory', 'writing', 'tone', 'personal'] },
  { id: 'mailNotch', section: 'pim', group: 'Mail', label: 'App icon and notch', help: 'The unread number on the app icon, and whose mail drops from the notch.', level: 'basic', kind: 'panel', panel: 'mailNotch', feature: 'mail', resettable: false, keywords: ['dock badge', 'badge', 'island', 'notch', 'vip'] },
  { id: 'mailPrivacy', section: 'pim', group: 'Mail', label: 'Mail privacy', help: 'Pictures, blocked senders, sign-in codes and every connection Mail makes.', level: 'basic', kind: 'panel', panel: 'mailPrivacy', feature: 'mail', resettable: false, keywords: ['remote images', 'tracking pixels', 'read receipts', 'block', 'phishing', 'connections'] },
  { id: 'mailApps', section: 'pim', group: 'Mail', label: 'Mail in AI apps', help: 'Add Keeper to AI apps, so they can search and tidy shared mail with your approval.', level: 'basic', kind: 'panel', panel: 'mailApps', feature: 'mail', resettable: false, keywords: ['mcp', 'claude', 'cursor', 'codex', 'coding assistant'] },

  // ---------------------------------------------------------------- Privacy & permissions
  { id: 'permissions', section: 'privacy', label: 'Approvals', help: 'What Keeper may use on this computer, and why each part needs it.', level: 'basic', kind: 'panel', panel: 'permissions', keywords: ['permissions', 'accessibility', 'screen recording', 'microphone', 'camera', 'full disk access', 'allow'] },
  { id: 'crashReports', section: 'privacy', label: 'Send crash reports', help: 'Off until you switch it on. Anonymous: never the message, files or names.', level: 'basic', kind: 'panel', panel: 'crashReports', network: true, keywords: ['crash', 'error reports', 'bug reports', 'diagnostics', 'telemetry', 'stack trace'] },
  { id: 'usageStats', section: 'privacy', label: 'Send anonymous usage stats', help: 'Once a day. Never your files, searches or names.', level: 'basic', kind: 'panel', panel: 'usageStats', network: true, keywords: ['telemetry', 'tracking', 'analytics', 'diagnostics', 'data collection'] },
  { id: 'privacy.ai', section: 'privacy', label: 'What AI may see', level: 'basic', kind: 'link', to: { name: 'settings', arg: 'ai#brain' }, keywords: ['ai privacy'] },

  // ---------------------------------------------------------------- Accessibility
  { id: 'a11y', section: 'accessibility', label: 'Motion, text size and focus', level: 'basic', kind: 'panel', panel: 'a11y', keywords: ['reduce motion', 'animations', 'zoom', 'bigger text', 'focus ring', 'outline'] },
  { id: 'a11y.motion', path: 'a11y.motion', section: 'accessibility', label: 'Reduce motion', level: 'basic', kind: 'choice', inPanel: 'a11y', choices: [{ value: 'system', label: 'Automatic' }, { value: 'reduce', label: 'On' }, { value: 'full', label: 'Off' }], keywords: ['animations'] },
  { id: 'a11y.textScale', path: 'a11y.textScale', section: 'accessibility', label: 'Text size', level: 'basic', kind: 'number', inPanel: 'a11y', keywords: ['zoom', 'bigger text', 'font size'] },
  { id: 'a11y.focusAlways', path: 'a11y.focusAlways', section: 'accessibility', label: 'Always show focus outlines', level: 'basic', kind: 'toggle', inPanel: 'a11y', keywords: ['keyboard', 'outline', 'focus ring'] },

  // ---------------------------------------------------------------- Battery and speed
  { id: 'resources', section: 'battery', label: 'Save battery, balanced or fastest', help: 'How much Keeper does in the background.', level: 'basic', kind: 'panel', panel: 'resources', keywords: ['performance', 'power', 'battery', 'cpu', 'memory', 'speed', 'energy', 'limits'] },
  { id: 'resourceMode', path: 'resourceMode', section: 'battery', label: 'Battery and speed', level: 'basic', kind: 'choice', inPanel: 'resources', choices: [{ value: 'minimal', label: 'Save battery' }, { value: 'balanced', label: 'Balanced' }, { value: 'performance', label: 'Fastest' }] },
  { id: 'keeperItself', section: 'battery', label: 'What Keeper is running', help: 'Each part, what it uses, and restarting one.', level: 'basic', kind: 'link', to: { name: 'health', arg: 'keeper' }, feature: 'health', keywords: ['processes', 'keeper processes', 'safe mode', 'restart keeper'] },

  // ---------------------------------------------------------------- Devices
  { id: 'rdc.rdpInTab', section: 'devices', group: 'Remote Desktops', label: 'Remote Desktop in a tab', help: 'Shown in Keeper; the engine downloads on first use.', level: 'advanced', kind: 'link', to: { name: 'rdc', arg: 'places' }, feature: 'remoteDesktops', network: true, keywords: ['rdp', 'mstsc', 'freerdp', 'remote desktop', 'ironrdp', 'outside app', 'windows'] },
  { id: 'devices.page', section: 'devices', label: 'Your devices', help: 'Pair a device, your phone, and access from anywhere.', level: 'basic', kind: 'link', to: { name: 'devices' }, keywords: ['pair', 'phone', 'link'] },
  { id: 'meshPlaces', section: 'devices', label: 'Where device controls appear', help: 'In the palette, the tray and the Island.', level: 'advanced', kind: 'panel', panel: 'meshPlaces', feature: 'keeperMesh', keywords: ['mesh', 'private network', 'controls'] },

  // ---------------------------------------------------------------- About
  { id: 'about', section: 'about', label: 'Version and what’s new', level: 'basic', kind: 'panel', panel: 'about', keywords: ['version', 'release notes', 'changelog', 'source code', 'license', 'report a problem', 'bug', 'check keeper', 'self-check', 'diagnostics', 'problem report', 'logs', 'support'] },

  // ---------------------------------------------------------------- Account & Pro (builds with Pro switched on only)
  { id: 'proAccount', section: 'account', label: 'Your plan', help: 'Your plan and license on this computer.', level: 'basic', kind: 'panel', panel: 'proAccount', feature: 'proAccount', exportable: false, resettable: false, keywords: ['pro', 'license', 'subscription', 'restore purchase', 'manage subscription', 'remove license'] },
  { id: 'proCatalog', section: 'account', label: 'What Pro adds', help: 'Planned extras that cost money to run, or are for teams.', level: 'basic', kind: 'panel', panel: 'proCatalog', feature: 'proAccount', keywords: ['pro', 'upgrade', 'cloud', 'team', 'price'] },
];

// ---------------------------------------------------------------- search words

/** What people type → the words the settings use. */
export const SYNONYMS: Record<string, string[]> = {
  'dark mode': ['light or dark'],
  'night mode': ['light or dark'],
  startup: ['open at login'],
  boot: ['open at login'],
  'start at login': ['open at login'],
  autostart: ['open at login'],
  hotkey: ['shortcut'],
  'keyboard shortcut': ['shortcut'],
  keybinding: ['shortcut'],
  telemetry: ['usage stats'],
  tracking: ['usage stats', 'clean links'],
  analytics: ['usage stats'],
  notch: ['island'],
  ocr: ['text in pictures', 'languages in pictures'],
  backup: ['sync & backup', 'export'],
  vpn: ['privacy & security', 'network'],
  proxy: ['network', 'privacy & security'],
  inspector: ['details panel'],
  'tray icon': ['menu bar'],
  colour: ['color'],
  licence: ['license'],
  index: ['search everything again', 'let ai search your files'],
  font: ['text style', 'text size'],
  zoom: ['text size'],
  animations: ['reduce motion'],
  performance: ['battery and speed'],
  processes: ['what keeper is running'],
};

// ---------------------------------------------------------------- reading and writing

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** The settings change that puts `value` at `path` (nested objects are copied, not changed). */
export function patchFor(s: AllSettings, path: string, value: unknown): Partial<AllSettings> {
  const keys = path.split('.');
  const top = keys[0] as keyof AllSettings;
  if (keys.length === 1) return { [top]: value } as Partial<AllSettings>;
  const set = (o: unknown, ks: string[]): unknown => {
    const base = o && typeof o === 'object' ? { ...(o as Record<string, unknown>) } : {};
    base[ks[0]] = ks.length === 1 ? value : set(base[ks[0]], ks.slice(1));
    return base;
  };
  return { [top]: set(s[top], keys.slice(1)) } as Partial<AllSettings>;
}

let defaults: AllSettings | null = null;
/** Keeper's settings as they come (folders aside, which depend on the computer). */
export function settingDefaults(): AllSettings {
  return (defaults ??= defaultSettings([], []));
}

export function defaultValue(def: SettingDef): unknown {
  return def.path ? getPath(settingDefaults(), def.path) : undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Changed from how it came (only rows with a path and that Reset may touch). */
export function isChanged(s: AllSettings, def: SettingDef): boolean {
  if (!def.path || def.resettable === false) return false;
  return !same(getPath(s, def.path), defaultValue(def));
}

export function changedSettings(s: AllSettings, platform = ''): SettingDef[] {
  return SETTINGS.filter((d) => visibleOn(d, platform) && isChanged(s, d));
}

/** The change that resets these rows (accounts, folders and keys are never touched). */
export function resetPatch(s: AllSettings, defs: SettingDef[]): Partial<AllSettings> {
  let next: AllSettings = s;
  for (const d of defs) if (d.path && d.resettable !== false) next = { ...next, ...patchFor(next, d.path, defaultValue(d)) };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof AllSettings)[]) if (next[k] !== s[k]) out[k] = next[k];
  return out as Partial<AllSettings>;
}

/** How a value reads ("On", "Dark", "90 days"). */
export function valueText(def: SettingDef, v: unknown, platform = ''): string {
  if (def.kind === 'toggle') return (def.invert ? !v : !!v) ? 'On' : 'Off';
  if (def.choices) return def.choices.find((c) => c.value === v)?.label ?? String(v ?? '');
  if (def.kind === 'number') return `${String(v)}${def.unit ? ` ${def.unit}` : ''}`;
  if (def.kind === 'shortcut' && typeof v === 'string') return shortcutText(v, platform);
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'None';
  if (v === '' || v === undefined || v === null) return 'Not set';
  return String(v);
}

function shortcutText(acc: string, platform: string): string {
  const mac = platform === 'darwin';
  return acc.split('+').map((p) => (/^(CommandOrControl|CmdOrCtrl)$/.test(p) ? (mac ? '⌘' : 'Ctrl') : p === 'Shift' ? (mac ? '⇧' : 'Shift') : p === 'Alt' ? (mac ? '⌥' : 'Alt') : p)).join(mac ? '' : '+');
}

export function labelOf(def: SettingDef | SectionDef, platform = ''): string {
  return def.labelFor?.[platform] ?? def.label;
}

export function visibleOn(def: SettingDef, platform: string): boolean {
  // A row of a part this build leaves out (Pro's, in a build without Pro) never shows, even in search.
  const part = def.feature ? FEATURES.find((f) => f.id === def.feature) : undefined;
  if (part && !featureOffered(part, platform)) return false;
  return !def.platforms || !platform || def.platforms.includes(platform);
}

export const sectionDef = (id: string) => SECTIONS.find((s) => s.id === id);
export const settingDef = (id: string) => SETTINGS.find((s) => s.id === id);

/** Rows of a section, Basic first, then Advanced (the ones under "More settings"); panel-inner rows are drawn by their panel. */
export function sectionRows(section: SectionId, platform: string): { basic: SettingDef[]; advanced: SettingDef[] } {
  const rows = SETTINGS.filter((d) => d.section === section && !d.inPanel && visibleOn(d, platform));
  return { basic: rows.filter((d) => d.level === 'basic'), advanced: rows.filter((d) => d.level === 'advanced') };
}

// ---------------------------------------------------------------- deep links

/** Old Settings anchors (settings:<anchor>) → section and row. */
export const SETTINGS_ALIASES: Record<string, { section: SectionId; setting?: string }> = {
  inspector: { section: 'appearance', setting: 'inspectorMode' },
  sidebar: { section: 'appearance', setting: 'sidebarCustom' },
  locked: { section: 'files', setting: 'lockedFolders' },
  library: { section: 'files' },
  'open-with': { section: 'files', setting: 'openWith' },
  platform: { section: 'files', setting: 'platform' },
  brain: { section: 'ai', setting: 'brain' },
  permissions: { section: 'privacy', setting: 'permissions' },
  mesh: { section: 'devices', setting: 'meshPlaces' },
  ashforde: { section: 'features', setting: 'ashfordeApps' },
  usage: { section: 'battery' },
  performance: { section: 'battery' },
  'tasks-notes': { section: 'general', setting: 'exportTasks' },
  updates: { section: 'general', setting: 'updates' },
  shortcuts: { section: 'general', setting: 'shortcuts' },
  menubar: { section: 'menubar' },
  tray: { section: 'menubar' },
};

/** A row's old anchor (settings:locked → the row of Locked folders keeps id "locked"). */
export function legacyAnchor(settingId: string): string | undefined {
  return Object.entries(SETTINGS_ALIASES).find(([k, v]) => v.setting === settingId && !sectionDef(k))?.[0];
}

/** `settings:<section>`, `settings:<section>#<setting>`, an old anchor, or a setting id alone. */
export function parseSettingsArg(arg: string | undefined): { section: SectionId | 'changed'; setting?: string } {
  if (!arg) return { section: 'general' };
  const [head, tail] = arg.split('#');
  if (head === 'changed') return { section: 'changed' };
  if (sectionDef(head)) return { section: head as SectionId, setting: tail || undefined };
  if (SETTINGS_ALIASES[head]) return { ...SETTINGS_ALIASES[head], ...(tail ? { setting: tail } : {}) };
  const d = settingDef(head);
  if (d) return { section: d.section, setting: d.id };
  return { section: 'general' };
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  kind: 'setting' | 'feature' | 'section';
  id: string;
  section: SectionId;
  /** "The Island › Shortcuts › Open the shelf" */
  crumbs: string[];
  label: string;
  advanced?: boolean;
  /** the part that is off, which hides this ("Mail is off") */
  off?: { feature: string; name: string };
  score: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** The query and what it also means ("dark mode" → "light or dark"). */
export function expandQuery(q: string): string[] {
  const n = norm(q);
  const out = new Set([n]);
  for (const [k, vs] of Object.entries(SYNONYMS)) if (n.includes(k) || k.includes(n) && n.length >= 4) for (const v of vs) out.add(v);
  return [...out];
}

function scoreText(text: string, terms: string[]): number {
  const t = norm(text);
  let best = 0;
  for (const q of terms) {
    if (!q) continue;
    if (t === q) best = Math.max(best, 100);
    else if (t.startsWith(q)) best = Math.max(best, 80);
    else if (t.includes(q)) best = Math.max(best, 60);
    else {
      const words = q.split(' ').filter(Boolean);
      if (words.length > 1 && words.every((w) => t.includes(w))) best = Math.max(best, 40);
    }
  }
  return best;
}

/**
 * Settings, parts and sections that match, best first. Advanced rows count the
 * same as Basic ones; rows of parts that are off come with that part, to turn on.
 */
export function searchSettings(q: string, s: AllSettings | null, platform = '', permissions: { id: string; name: string }[] = []): SearchHit[] {
  const terms = expandQuery(q);
  if (!terms[0]) return [];
  const states = s ? featureStates(s, platform) : null;
  const offOf = (feature?: string) => {
    if (!feature || !states || states.get(feature)?.on !== false) return undefined;
    return { feature, name: FEATURES.find((f) => f.id === feature)?.name ?? feature };
  };
  const hits: SearchHit[] = [];
  for (const d of SETTINGS) {
    if (!visibleOn(d, platform)) continue;
    const sec = sectionDef(d.section)!;
    const label = labelOf(d, platform);
    const score = Math.max(scoreText(label, terms), scoreText(d.help ?? '', terms) - 25, ...(d.keywords ?? []).map((k) => scoreText(k, terms) - 15), scoreText(labelOf(sec, platform), terms) - 40);
    if (score <= 0) continue;
    const parent = d.inPanel ? settingDef(d.inPanel) : undefined;
    hits.push({ kind: 'setting', id: d.id, section: d.section, label, crumbs: [labelOf(sec, platform), ...(d.group ? [d.group] : parent ? [labelOf(parent, platform)] : []), label], advanced: d.level === 'advanced', off: offOf(d.feature) ?? offOf(sec.feature), score });
  }
  for (const f of FEATURES) {
    if (!featureOffered(f, platform)) continue;
    const score = Math.max(scoreText(f.name, terms) - 5, scoreText(f.description, terms) - 30);
    if (score <= 0) continue;
    hits.push({ kind: 'feature', id: f.id, section: 'features', label: f.name, crumbs: ['Features', f.name], score });
  }
  for (const p of permissions) {
    const score = scoreText(p.name, terms) - 10;
    if (score > 0) hits.push({ kind: 'setting', id: 'permissions', section: 'privacy', label: p.name, crumbs: ['Privacy & permissions', 'Approvals', p.name], score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Up to `per` results for each section, in the order the best ones come, with how many more each has. */
export function groupHits(hits: SearchHit[], per = 3): { section: SectionId; hits: SearchHit[]; more: number }[] {
  const out: { section: SectionId; hits: SearchHit[]; more: number }[] = [];
  for (const h of hits) {
    let g = out.find((x) => x.section === h.section);
    if (!g) out.push((g = { section: h.section, hits: [], more: 0 }));
    if (g.hits.length < per) g.hits.push(h);
    else g.more++;
  }
  return out;
}

// ---------------------------------------------------------------- export and import

export const SETTINGS_FILE_VERSION = 1;

/** Never leave the computer in an export, and never come in from an import. */
const NEVER = ['lastRunVersion', 'menuBarOneIcon', 'updatePlan', 'updateSkip', 'updateBetaChosen', 'permissionsAsked', 'permissionsSetup', 'recentServers', 'island.upload', 'island.calendarUrl', 'island.place', 'island.driveKeepAwake', 'features', 'featureSets', 'pageWindows'];
/** Paths that differ between computers: exported only when asked for. */
const FOLDER_PATHS = ['folders', 'excluded', 'pinned', 'hiddenPlaces', 'rules', 'sync', 'island.clipIgnoreApps'];
/** Any key that looks like it holds a secret, at any depth. */
const SECRET_KEY = /secret|token|passw|apikey|api_key|accesskey|access_key|privatekey|private_key|credential|cookie|bearer|deviceid|device_id|anonid|anonymous/i;

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SECRET_KEY.test(k)) out[k] = strip(x);
  return out;
}

function dropPath(o: Record<string, unknown>, path: string) {
  const ks = path.split('.');
  let cur: Record<string, unknown> | undefined = o;
  for (const k of ks.slice(0, -1)) cur = cur?.[k] && typeof cur[k] === 'object' ? (cur[k] as Record<string, unknown>) : undefined;
  if (cur) delete cur[ks[ks.length - 1]];
}

export interface ExportChoice {
  settings: boolean;
  parts: boolean;
  folders: boolean;
}

export interface SettingsFile {
  keeper: string;
  format: number;
  exported: string;
  settings?: Record<string, unknown>;
  features?: Record<string, boolean>;
  featureSets?: AllSettings['featureSets'];
}

/** The settings file: no keys, passwords, tokens, accounts' secrets, device ids or (unless asked) folders. */
export function exportSettings(s: AllSettings, choice: ExportChoice, version: string, now = new Date()): SettingsFile {
  const out: SettingsFile = { keeper: version, format: SETTINGS_FILE_VERSION, exported: now.toISOString() };
  if (choice.settings) {
    const copy = strip(JSON.parse(JSON.stringify(s))) as Record<string, unknown>;
    for (const p of NEVER) dropPath(copy, p);
    if (!choice.folders) for (const p of FOLDER_PATHS) dropPath(copy, p);
    for (const d of SETTINGS) if (d.path && d.exportable === false && !(choice.folders && FOLDER_PATHS.includes(d.path))) dropPath(copy, d.path);
    out.settings = copy;
  }
  if (choice.parts) {
    out.features = { ...(s.features ?? {}) };
    out.featureSets = s.featureSets ?? [];
  }
  return out;
}

export interface ImportPreview {
  /** registry rows that change, old → new */
  changes: { id: string; label: string; from: string; to: string }[];
  /** other settings that change (no row of their own) */
  otherChanges: number;
  /** parts the import turns on and off */
  partsOn: string[];
  partsOff: string[];
  /** settings from a newer Keeper (or not settings at all), left out */
  skipped: number;
  /** what to apply */
  patch: Partial<AllSettings>;
}

/** Reads a settings file and says what it would change; throws a plain message when it is not one. */
export function previewImport(current: AllSettings, text: string, platform = ''): ImportPreview {
  let file: SettingsFile;
  try {
    file = JSON.parse(text) as SettingsFile;
  } catch {
    throw new Error('That file isn’t Keeper settings.');
  }
  if (!file || typeof file !== 'object' || typeof file.keeper !== 'string') throw new Error('That file isn’t Keeper settings.');
  const raw = (file.settings && typeof file.settings === 'object' ? strip(file.settings) : {}) as Record<string, unknown>;
  for (const p of NEVER) dropPath(raw, p);
  let skipped = 0;
  for (const k of Object.keys(raw)) if (!(k in current)) { skipped++; delete raw[k]; }
  // Bad values fall back to what is there now, as when settings are read from disk.
  let next = mergeSettings(current, raw);
  if (file.features && typeof file.features === 'object') next = { ...next, features: { ...(current.features ?? {}), ...Object.fromEntries(Object.entries(file.features).filter(([, v]) => typeof v === 'boolean')) } };
  if (Array.isArray(file.featureSets)) next = { ...next, featureSets: file.featureSets };
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof AllSettings)[]) if (!same(next[k], current[k])) patch[k] = next[k];
  const changes = SETTINGS.filter((d) => d.path && visibleOn(d, platform) && !same(getPath(next, d.path), getPath(current, d.path)))
    .map((d) => ({ id: d.id, label: labelOf(d, platform), from: valueText(d, getPath(current, d.path!), platform), to: valueText(d, getPath(next, d.path!), platform) }));
  const before = featureStates(current, platform);
  const after = featureStates(next, platform);
  const partsOn = FEATURES.filter((f) => !before.get(f.id)?.on && after.get(f.id)?.on).map((f) => f.name);
  const partsOff = FEATURES.filter((f) => before.get(f.id)?.on && !after.get(f.id)?.on).map((f) => f.name);
  const covered = new Set(changes.map((c) => settingDef(c.id)!.path!.split('.')[0]));
  const otherChanges = Object.keys(patch).filter((k) => !covered.has(k) && k !== 'features' && k !== 'featureSets').length;
  return { changes, otherChanges, partsOn, partsOff, skipped, patch: patch as Partial<AllSettings> };
}

// ---------------------------------------------------------------- plain words

/** Words that never appear in Basic labels and help (spec §1.4); Advanced may name them in brackets after plain words. */
export const BANNED_WORDS: RegExp[] = [
  /\bindex(es|ed|ing)?\b/i, /\bOCR\b/, /\bAPI\b/, /\bMCP\b/, /\bWireGuard\b/i, /\bDDC\/CI\b/i, /\bPipeWire\b/i, /\bXWayland\b/i, /\bportal\b/i, /\bAT-SPI\b/i,
  /\bdaemon\b/i, /\bsocket\b/i, /\brelay\b/i, /\btunnel\b/i, /\bsubnets?\b/i, /\bexit node\b/i, /\bvectors?\b/i, /(?<!(speech|AI|language|face|a) )\bmodel\b/i, /\btokens?\b/i,
  /\bglance\b/i, /\bbrain\b/i, /\bhub\b/i, /\btelemetry\b/i, /\bIMAP\b/, /\bCalDAV\b/i, /CommandOrControl/,
];

/** Banned words in a piece of Basic copy. */
export function jargonIn(text: string): string[] {
  return BANNED_WORDS.filter((r) => r.test(text)).map((r) => text.match(r)![0]);
}

/** Every Basic label and description that uses a banned word (an empty list is clean). */
export function copyProblems(): string[] {
  const out: string[] = [];
  for (const d of SETTINGS) {
    if (d.level !== 'basic') continue;
    for (const t of [d.label, d.help ?? '', ...Object.values(d.labelFor ?? {})]) for (const w of jargonIn(t ?? '')) out.push(`settings ${d.id}: "${w}" in “${t}”`);
  }
  for (const s of SECTIONS) for (const w of jargonIn(s.label)) out.push(`section ${s.id}: "${w}"`);
  // Parts marked for everyone (the setup's tiers): their names and descriptions are Basic copy too.
  for (const f of FEATURES) {
    const tier = (f as { tier?: string }).tier;
    if (tier !== 'recommended' && tier !== 'offered') continue;
    for (const t of [f.name, f.description]) for (const w of jargonIn(t)) out.push(`feature ${f.id}: "${w}" in “${t}”`);
  }
  return out;
}
