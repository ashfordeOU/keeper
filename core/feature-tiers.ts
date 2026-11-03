// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What a new install gets, and where each part is shown: data only, read by
// core/features.ts (defaults, the Recommended preset), the first-run setup and
// Settings → Features. Kept apart from FEATURES so the two can change separately.
//
//   normal   what Recommended does with the part:
//            'on' / 'off'; 'parent' = on, and it follows the part named in `follows`
//            (it has no switch of its own in Basic); or a rule about this computer
//            (see RULES in core/recommend.ts: 'dev', 'docker', 'localAI'…)
//   shown    'basic' = its own row; 'customize' = inside its parent group's Customize;
//            'advanced' = only with advanced settings shown
//   setup    the group card it belongs to in setup (SETUP_GROUPS)
//   plain    its name in plain words (the setup screens use it; FEATURES' own name may follow)

export type SetupGroupId = 'files' | 'tidy' | 'sync' | 'computer' | 'privacy' | 'mail' | 'notes' | 'island' | 'desktop' | 'screen' | 'ai' | 'devices' | 'general';

/** Rules about this computer that turn a part on in Recommended. */
export type ContextRule = 'dev' | 'docker' | 'localAI' | 'notesFound' | 'enoughMemory' | 'notWindows' | 'notMac' | 'monorail';

export type Normal = 'on' | 'off' | 'parent' | ContextRule;

export interface FeatureTier {
  plain: string;
  setup: SetupGroupId;
  normal: Normal;
  follows?: string;
  shown: 'basic' | 'customize' | 'advanced';
}

export const SETUP_GROUPS: { id: SetupGroupId; name: string; line: string; needs?: string }[] = [
  { id: 'files', name: 'Files and search', line: 'Find files by name, kind, date and the words inside them.', needs: 'Full Disk Access (optional)' },
  { id: 'tidy', name: 'Tidy', line: 'Clean up space, find duplicates, convert files, undo anything.' },
  { id: 'sync', name: 'Sync and backup', line: 'Back up and sync folders to a drive, a NAS or your cloud.' },
  { id: 'computer', name: 'Computer', line: 'See what slows your computer down and what starts with it.' },
  { id: 'privacy', name: 'Privacy and security', line: 'Check who can use your camera and microphone, and scan downloads.', needs: 'Full Disk Access (optional)' },
  { id: 'mail', name: 'Mail and calendar', line: 'Your mail, calendars, reminders and a week planner.', needs: 'Calendars, Reminders, Notifications' },
  { id: 'notes', name: 'Notes', line: 'Notes in plain files, and notes from your other apps in one place.', needs: 'Automation: Notes (only for Apple Notes)' },
  { id: 'island', name: 'The Island', line: 'A small bar at the top of the screen for music, timers, tasks and what\'s next.', needs: 'Calendars (for next meeting)' },
  { id: 'desktop', name: 'Desktop', line: 'Widgets, live wallpaper, ambient sound and weather.' },
  { id: 'screen', name: 'Screen', line: 'Screenshots, copy text from the screen, recording and a clean screen for presenting.', needs: 'Screen Recording (restart once)' },
  { id: 'ai', name: 'AI', line: 'Ask about your files, writing help, dictation and meeting notes, with the AI you choose.', needs: 'Microphone (for dictation and meetings)' },
  { id: 'devices', name: 'Your devices', line: 'Reach your files and screens from your phone and other computers.', needs: 'Local Network, Firewall (Windows)' },
  { id: 'general', name: 'Keeper itself', line: 'Quick Search, the menu bar icon, opening at login and updates.' },
];

/** "Do you write code?": the parts the developer bundle turns on (setup only, not a sidebar group). */
export const DEV_BUNDLE = ['agents', 'islandUsage', 'usageTracker', 'terminal', 'agentHub', 'devServers'];

export const TIERS: Record<string, FeatureTier> = {
  library: { plain: 'Files and search', setup: 'files', normal: 'on', shown: 'basic' },
  sources: { plain: 'Where downloads came from', setup: 'files', normal: 'on', shown: 'customize' },
  docText: { plain: 'Words inside documents', setup: 'files', normal: 'on', shown: 'customize' },
  ocr: { plain: 'Words in pictures and scans', setup: 'files', normal: 'enoughMemory', shown: 'customize' },
  places: { plain: 'Disks, cloud drives and servers', setup: 'files', normal: 'on', shown: 'customize' },
  network: { plain: 'Network folders', setup: 'files', normal: 'on', shown: 'customize' },
  lock: { plain: 'Locked folders', setup: 'files', normal: 'on', shown: 'basic' },
  remote: { plain: 'Cloud and servers', setup: 'files', normal: 'off', shown: 'basic' },
  cleanup: { plain: 'Clean up', setup: 'tidy', normal: 'on', shown: 'basic' },
  duplicates: { plain: 'Duplicates and look-alike photos', setup: 'tidy', normal: 'on', shown: 'customize' },
  space: { plain: 'Space map and large files', setup: 'tidy', normal: 'on', shown: 'customize' },
  convert: { plain: 'Convert', setup: 'tidy', normal: 'on', shown: 'basic' },
  rules: { plain: 'Automations', setup: 'tidy', normal: 'on', shown: 'customize' },
  history: { plain: 'Undo history', setup: 'tidy', normal: 'on', shown: 'customize' },
  fileKit: { plain: 'More formats for Convert', setup: 'tidy', normal: 'parent', follows: 'convert', shown: 'advanced' },
  workflows: { plain: 'Workflows', setup: 'tidy', normal: 'off', shown: 'advanced' },
  faces: { plain: 'Hide faces in pictures', setup: 'tidy', normal: 'parent', follows: 'convert', shown: 'customize' },
  speechModel: { plain: 'Transcribe recordings', setup: 'tidy', normal: 'parent', follows: 'convert', shown: 'advanced' },
  sync: { plain: 'Sync and backup', setup: 'sync', normal: 'on', shown: 'basic' },
  health: { plain: 'Computer health', setup: 'computer', normal: 'on', shown: 'basic' },
  processes: { plain: 'Running apps', setup: 'computer', normal: 'on', shown: 'customize' },
  monitorHistory: { plain: 'A year of health history', setup: 'computer', normal: 'off', shown: 'advanced' },
  monitorTray: { plain: 'Live numbers in the menu bar', setup: 'computer', normal: 'off', shown: 'advanced' },
  devServers: { plain: 'Local servers and ports', setup: 'computer', normal: 'dev', shown: 'advanced' },
  containers: { plain: 'Containers', setup: 'computer', normal: 'docker', shown: 'advanced' },
  monitorSensors: { plain: 'Graphics, fans and power', setup: 'computer', normal: 'parent', follows: 'health', shown: 'advanced' },
  startupItems: { plain: 'Startup items and apps', setup: 'computer', normal: 'on', shown: 'basic' },
  guide: { plain: 'Fix-it list', setup: 'computer', normal: 'on', shown: 'basic' },
  keepAwake: { plain: 'Keep awake', setup: 'computer', normal: 'on', shown: 'basic' },
  quickControls: { plain: 'Quick switches', setup: 'computer', normal: 'off', shown: 'basic' },
  quickControlsNetwork: { plain: 'Quick switches: network', setup: 'computer', normal: 'parent', follows: 'quickControls', shown: 'advanced' },
  quickControlsFirewall: { plain: 'Quick switches: firewall', setup: 'computer', normal: 'parent', follows: 'quickControls', shown: 'advanced' },
  quickControlsPrivacy: { plain: 'Quick switches: privacy', setup: 'computer', normal: 'parent', follows: 'quickControls', shown: 'advanced' },
  quickControlsSecurity: { plain: 'Quick switches: security', setup: 'computer', normal: 'parent', follows: 'quickControls', shown: 'advanced' },
  settingsCatalog: { plain: 'Hidden system settings', setup: 'computer', normal: 'off', shown: 'advanced' },
  appControls: { plain: 'Limits for each app', setup: 'computer', normal: 'off', shown: 'advanced' },
  browserTabs: { plain: 'Browser tabs', setup: 'computer', normal: 'off', shown: 'advanced' },
  journal: { plain: 'Journal', setup: 'notes', normal: 'off', shown: 'basic' },
  timeTracking: { plain: 'Track where your time goes', setup: 'computer', normal: 'off', shown: 'basic' },
  focusBlock: { plain: 'Block distractions while you focus', setup: 'computer', normal: 'off', shown: 'basic' },
  displayControl: { plain: 'Monitor controls', setup: 'computer', normal: 'off', shown: 'advanced' },
  displayKeys: { plain: 'Monitor brightness keys', setup: 'computer', normal: 'off', shown: 'advanced' },
  protection: { plain: 'Privacy and security check', setup: 'privacy', normal: 'on', shown: 'basic' },
  security: { plain: 'Scan downloads for malware', setup: 'privacy', normal: 'notWindows', shown: 'basic' },
  netwatch: { plain: 'Network activity and VPN', setup: 'privacy', normal: 'off', shown: 'basic' },
  firewall: { plain: 'Firewall', setup: 'privacy', normal: 'off', shown: 'advanced' },
  mail: { plain: 'Mail', setup: 'mail', normal: 'off', shown: 'basic' },
  calendars: { plain: 'Calendar and reminders', setup: 'mail', normal: 'on', shown: 'basic' },
  planner: { plain: 'Planner', setup: 'mail', normal: 'off', shown: 'basic' },
  insights: { plain: 'Insights', setup: 'mail', normal: 'off', shown: 'customize' },
  alarms: { plain: 'Alarms, timers and clocks', setup: 'mail', normal: 'off', shown: 'basic' },
  notes: { plain: 'Notes', setup: 'notes', normal: 'notesFound', shown: 'basic' },
  notesHub: { plain: 'Notes from other apps', setup: 'notes', normal: 'off', shown: 'basic' },
  notesSync: { plain: 'Keep notes apps in sync', setup: 'notes', normal: 'off', shown: 'advanced' },
  cues: { plain: 'Cues', setup: 'notes', normal: 'off', shown: 'basic' },
  island: { plain: 'The Island', setup: 'island', normal: 'on', shown: 'basic' },
  clipboard: { plain: 'Clipboard history', setup: 'island', normal: 'on', shown: 'customize' },
  media: { plain: 'Now playing', setup: 'island', normal: 'on', shown: 'customize' },
  agents: { plain: 'Coding assistants', setup: 'island', normal: 'dev', shown: 'advanced' },
  focus: { plain: 'Focus timer and breaks', setup: 'island', normal: 'on', shown: 'customize' },
  islandWeather: { plain: 'Weather in the Island', setup: 'island', normal: 'on', shown: 'customize' },
  islandAsk: { plain: 'Ask AI in the Island', setup: 'island', normal: 'localAI', shown: 'customize' },
  islandUsage: { plain: 'AI limits in the Island', setup: 'island', normal: 'dev', shown: 'advanced' },
  islandSales: { plain: 'Sales in the Island', setup: 'island', normal: 'off', shown: 'advanced' },
  islandStocks: { plain: 'Stocks in the Island', setup: 'island', normal: 'off', shown: 'customize' },
  islandNotes: { plain: 'Notes in the Island', setup: 'island', normal: 'on', shown: 'customize' },
  islandTodos: { plain: 'Tasks in the Island', setup: 'island', normal: 'on', shown: 'customize' },
  islandPlanner: { plain: 'Week in the Island', setup: 'island', normal: 'parent', follows: 'planner', shown: 'customize' },
  islandInsights: { plain: 'Insights in the Island', setup: 'island', normal: 'parent', follows: 'insights', shown: 'customize' },
  islandPrompter: { plain: 'Teleprompter', setup: 'island', normal: 'off', shown: 'customize' },
  calendar: { plain: 'Next meeting', setup: 'island', normal: 'on', shown: 'customize' },
  micIndicator: { plain: 'Microphone and camera dots', setup: 'island', normal: 'notMac', shown: 'customize' },
  notifyMirror: { plain: "Other apps' notifications in the Island", setup: 'island', normal: 'off', shown: 'advanced' },
  hideInFullscreen: { plain: 'Hide in full screen', setup: 'island', normal: 'on', shown: 'customize' },
  islandCalls: { plain: 'Calls in the Island', setup: 'island', normal: 'off', shown: 'customize' },
  islandHud: { plain: 'Volume and brightness in the Island', setup: 'island', normal: 'off', shown: 'advanced' },
  textSnippets: { plain: 'Typed snippets', setup: 'desktop', normal: 'off', shown: 'basic' },
  widgets: { plain: 'Desktop widgets', setup: 'desktop', normal: 'off', shown: 'basic' },
  wallpaper: { plain: 'Live wallpaper', setup: 'desktop', normal: 'off', shown: 'basic' },
  vibes: { plain: 'Vibes', setup: 'desktop', normal: 'off', shown: 'basic' },
  ambientSound: { plain: 'Ambient sound', setup: 'desktop', normal: 'off', shown: 'basic' },
  folderIcons: { plain: 'Folder colors and icons', setup: 'desktop', normal: 'off', shown: 'basic' },
  weather: { plain: 'Weather', setup: 'desktop', normal: 'on', shown: 'basic' },
  tracks: { plain: 'Places and tracks', setup: 'desktop', normal: 'off', shown: 'basic' },
  tracksLive: { plain: 'Live positions', setup: 'desktop', normal: 'off', shown: 'advanced' },
  tracksServices: { plain: 'Strava, Polar and Fitbit', setup: 'desktop', normal: 'off', shown: 'advanced' },
  monorail: { plain: 'Monorail', setup: 'desktop', normal: 'monorail', shown: 'basic' },
  capture: { plain: 'Screenshots and copy text from screen', setup: 'screen', normal: 'on', shown: 'basic' },
  studio: { plain: 'Studio (screen recording)', setup: 'screen', normal: 'off', shown: 'basic' },
  stage: { plain: 'Stage (clean screen)', setup: 'screen', normal: 'off', shown: 'basic' },
  stageAuto: { plain: 'Start Stage when I share my screen', setup: 'screen', normal: 'off', shown: 'advanced' },
  tools: { plain: 'Toolbox', setup: 'screen', normal: 'off', shown: 'basic' },
  videoDownload: { plain: 'Save videos from web pages', setup: 'screen', normal: 'off', shown: 'basic' },
  dictation: { plain: 'Dictation', setup: 'ai', normal: 'off', shown: 'basic' },
  dictationHold: { plain: 'Hold a key to talk', setup: 'ai', normal: 'off', shown: 'advanced' },
  meetings: { plain: 'Meeting notes', setup: 'ai', normal: 'off', shown: 'basic' },
  meetingDetect: { plain: 'Offer to record calls', setup: 'ai', normal: 'parent', follows: 'meetings', shown: 'customize' },
  brain: { plain: 'Let AI search your files', setup: 'ai', normal: 'localAI', shown: 'basic' },
  semantic: { plain: 'Search by meaning', setup: 'ai', normal: 'off', shown: 'basic' },
  assistant: { plain: 'Ask about your files', setup: 'ai', normal: 'on', shown: 'basic' },
  abilities: { plain: 'More AI skills', setup: 'ai', normal: 'off', shown: 'advanced' },
  aiAgents: { plain: 'AI agents', setup: 'ai', normal: 'off', shown: 'basic' },
  usageTracker: { plain: 'AI usage and limits', setup: 'ai', normal: 'dev', shown: 'advanced' },
  writingHelp: { plain: 'Writing help', setup: 'ai', normal: 'localAI', shown: 'basic' },
  selectionBar: { plain: 'Actions for selected text', setup: 'ai', normal: 'off', shown: 'basic' },
  agentHub: { plain: 'AI agents in the terminal', setup: 'ai', normal: 'dev', shown: 'advanced' },
  link: { plain: 'Keeper on your other devices', setup: 'devices', normal: 'off', shown: 'basic' },
  remoteScreen: { plain: 'See and control your devices', setup: 'devices', normal: 'parent', follows: 'link', shown: 'customize' },
  keeperMesh: { plain: 'Private network for your devices', setup: 'devices', normal: 'off', shown: 'advanced' },
  meshDirectHandoff: { plain: 'Faster private network', setup: 'devices', normal: 'parent', follows: 'keeperMesh', shown: 'advanced' },
  remoteDesktops: { plain: 'Remote Desktop, VNC and SSH', setup: 'devices', normal: 'off', shown: 'basic' },
  rdcHosting: { plain: 'Remote Desktop into this computer', setup: 'devices', normal: 'off', shown: 'advanced' },
  linkDirect: { plain: 'Faster connections between your devices', setup: 'devices', normal: 'parent', follows: 'link', shown: 'advanced' },
  remoteFleet: { plain: 'Your devices at a glance', setup: 'devices', normal: 'parent', follows: 'link', shown: 'customize' },
  remoteTerminal: { plain: 'Terminals on your devices', setup: 'devices', normal: 'off', shown: 'advanced' },
  remoteCommands: { plain: 'Run commands on your devices', setup: 'devices', normal: 'off', shown: 'advanced' },
  remoteHelp: { plain: 'Help someone (or get help)', setup: 'devices', normal: 'off', shown: 'customize' },
  screenExtras: { plain: 'More while sharing a screen', setup: 'devices', normal: 'parent', follows: 'remoteScreen', shown: 'advanced' },
  unattendedAccess: { plain: 'Reach this computer before login', setup: 'devices', normal: 'off', shown: 'advanced' },
  waylandControl: { plain: 'Let your devices control this Linux desktop', setup: 'devices', normal: 'parent', follows: 'remoteScreen', shown: 'advanced' },
  mirroring: { plain: 'Phones on this screen', setup: 'devices', normal: 'off', shown: 'basic' },
  terminal: { plain: 'Terminal', setup: 'devices', normal: 'dev', shown: 'basic' },
  quickSearch: { plain: 'Quick Search', setup: 'general', normal: 'on', shown: 'basic' },
  launcher: { plain: 'Apps and commands in Quick Search', setup: 'general', normal: 'parent', follows: 'quickSearch', shown: 'customize' },
  toolLauncher: { plain: 'Tool launcher', setup: 'general', normal: 'off', shown: 'advanced' },
  tray: { plain: 'Keeper in the menu bar', setup: 'general', normal: 'on', shown: 'basic' },
  login: { plain: 'Open at login', setup: 'general', normal: 'on', shown: 'basic' },
  platform: { plain: 'In Finder, Spotlight and Shortcuts', setup: 'general', normal: 'on', shown: 'basic' },
  updates: { plain: 'Check for updates automatically', setup: 'general', normal: 'on', shown: 'basic' },
  usageStats: { plain: 'Anonymous usage stats', setup: 'general', normal: 'off', shown: 'basic' },
};
