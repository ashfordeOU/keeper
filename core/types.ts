// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Data contracts shared by the core engine, the Electron main process, the CLI
// and the interface. Sizes are bytes, times are epoch milliseconds.

export type Platform = 'win32' | 'darwin' | 'linux';

/** Library shelves. Every indexed file belongs to exactly one. */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'installer'
  | 'app'
  | 'code'
  | 'other';

export interface FileEntry {
  path: string;
  name: string;
  /** lower-case extension without the dot, '' when none */
  ext: string;
  kind: FileKind;
  size: number;
  mtime: number;
  /** creation time when the file system knows it, otherwise mtime */
  btime: number;
  /** last opened, when the OS tracks it (0 = unknown) */
  atime: number;
  /** top-level folder the file was found under (Desktop, Documents, Downloads, ...) */
  root: string;
  screenshot?: boolean;
  /** where the file was downloaded from, when the OS recorded it */
  source?: DownloadSource;
  /** text read from images and PDFs on this device */
  text?: string;
  /** in lists only the start of `text` is sent; ask for the full text when needed */
  /** hidden by name (a leading dot) or by the system's hidden flag; shown dimmed */
  hidden?: boolean;
  textCut?: boolean;
  /** user tags (macOS Finder tags, or Keeper tags on other systems) */
  tags?: string[];
  /** media details filled in lazily */
  meta?: MediaMeta;
  /** file only exists in the cloud (iCloud / OneDrive placeholder) */
  cloudOnly?: boolean;
  /** a folder, where a page shows folders and files together (never in the index) */
  dir?: boolean;
  /** a folder Keeper locked (shown as a folder with a lock) */
  locked?: boolean;
}

export interface MediaMeta {
  width?: number;
  height?: number;
  durationSec?: number;
  camera?: string;
  pages?: number;
  artist?: string;
  album?: string;
}

export interface DownloadSource {
  /** a known service id such as 'gmail', or 'web' for any other site */
  id: string;
  /** display name: "Gmail", "Google Drive", or the site's host */
  name: string;
  /** the host the download came from */
  host: string;
  url?: string;
  referrer?: string;
}

// ---------------------------------------------------------------- search

export type DateField = 'modified' | 'created' | 'opened';

export interface DateRange {
  field: DateField;
  /** inclusive, epoch ms; undefined = open */
  from?: number;
  /** exclusive, epoch ms; undefined = open */
  to?: number;
  /** what the user typed, for the chip label */
  label: string;
}

export interface SizeRange {
  min?: number;
  max?: number;
  label: string;
}

export type SortKey = 'name' | 'date' | 'size' | 'kind' | 'relevance';

/** A parsed search. Each field is one editable chip in the interface. */
export interface Query {
  kinds: FileKind[];
  exts: string[];
  screenshot?: boolean;
  date?: DateRange;
  size?: SizeRange;
  sources: string[];
  /** 'iphone', 'android', 'camera': matched against EXIF camera and file-name patterns */
  cameras: string[];
  /** Desktop, Documents, Downloads or a folder name */
  locations: string[];
  tags: string[];
  /** free words, matched against names, tags and text inside files */
  terms: string[];
  /** quoted phrases */
  phrases: string[];
  /** words that must not appear */
  exclude: string[];
  duplicatesOnly?: boolean;
  sort?: { key: SortKey; desc: boolean };
  limit?: number;
}

export interface Chip {
  field: 'kind' | 'ext' | 'screenshot' | 'date' | 'size' | 'source' | 'camera' | 'location' | 'tag' | 'term' | 'phrase' | 'exclude' | 'duplicates' | 'sort' | 'limit';
  label: string;
  value: string;
}

export interface ParsedQuery {
  query: Query;
  chips: Chip[];
  /** "Showing PDFs, modified in the last 7 days, larger than 5 MB" */
  explanation: string;
}

export interface SearchHit {
  file: FileEntry;
  score: number;
  /** a short excerpt of the matching text inside the file */
  snippet?: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  text: string;
  icon?: string;
  createdAt: number;
}

// ---------------------------------------------------------------- duplicates

export interface DuplicateGroup {
  id: string;
  /** 'exact' = same bytes (SHA-256); 'similar' = look-alike photos; 'pair' = same photo in two formats */
  kind: 'exact' | 'similar' | 'pair';
  files: FileEntry[];
  /** path of the copy Keeper suggests keeping */
  keep: string;
  /** bytes freed by removing everything except `keep` */
  reclaimable: number;
  /** why that copy was picked, shown on hover */
  reason: string;
}

// ---------------------------------------------------------------- cleanup

export type Safety = 'safe' | 'review' | 'permanent';

/** One cleanup card: "Browser caches", "Old installers", ... */
export interface CleanupGroup {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** 'cache' items are deleted for good (they rebuild); 'files' always go to the Trash */
  mode: 'cache' | 'files' | 'bin';
  safety: Safety;
  size: number;
  count: number;
  /** display paths, ~ for home */
  locations: string[];
  /** for 'files' groups: the actual files, so they can be reviewed one by one */
  items?: FileEntry[];
  /** selected by default in Smart Scan */
  preselect: boolean;
  note?: string;
}

/** One file or folder inside a cleanup group, for picking exactly what goes. */
export interface CleanupEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  /** files inside, for folders */
  files: number;
  mtime: number;
}

export interface CleanResult {
  freed: number;
  removed: number;
  failed: number;
  skipped: string[];
  /** id of the history entry, so the action can be looked up or undone */
  journalId?: string;
}

// ---------------------------------------------------------------- space map

export interface SpaceNode {
  name: string;
  path: string;
  size: number;
  files: number;
  kind: 'folder' | 'file' | 'other';
  children?: SpaceNode[];
  /** this folder holds things Keeper can clean */
  cleanable?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- system

export interface DiskInfo {
  mount: string;
  label: string;
  total: number;
  free: number;
  system: boolean;
}

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  enabled: boolean;
  /** 'user' items can be changed freely; 'system' ones need admin rights */
  scope: 'user' | 'system';
  source: string;
  publisher?: string;
  /** rough guess of how much it slows sign-in */
  impact: 'low' | 'medium' | 'high' | 'unknown';
}

export interface AppInfo {
  id: string;
  name: string;
  path: string;
  version?: string;
  publisher?: string;
  size: number;
  /** last opened, 0 = unknown */
  lastUsed: number;
  uninstallCommand?: string;
  system: boolean;
}

export interface ProtectionCheck {
  id: string;
  name: string;
  description: string;
  status: 'ok' | 'warn' | 'off' | 'unknown';
  detail?: string;
  /** how to turn it on, if it is off */
  fix?: string;
  weight: number;
}

export interface ProtectionReport {
  score: number;
  checks: ProtectionCheck[];
  checkedAt: number;
}

// ---------------------------------------------------------------- automation

export type RuleCondition =
  | { type: 'kind'; kinds: FileKind[] }
  | { type: 'ext'; exts: string[] }
  | { type: 'screenshot' }
  | { type: 'olderThanDays'; days: number; field?: DateField }
  | { type: 'largerThan'; bytes: number }
  | { type: 'inFolder'; folder: string }
  | { type: 'source'; sources: string[] }
  | { type: 'nameMatches'; pattern: string }
  | { type: 'query'; text: string };

export type RuleAction =
  | { type: 'trash' }
  /** {yyyy} {MM} {dd} {kind} {source} {ext} placeholders */
  | { type: 'move'; to: string }
  | { type: 'tag'; tag: string };

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  /** where the rule looks; defaults to Downloads and Desktop */
  scope: string[];
  lastRun?: number;
}

export interface RulePlanItem {
  file: FileEntry;
  action: RuleAction;
  /** resolved destination for moves */
  to?: string;
}

// ---------------------------------------------------------------- history

export interface JournalOp {
  type: 'trash' | 'move' | 'delete' | 'startup' | 'tag' | 'create';
  from: string;
  to?: string;
  size: number;
}

export interface JournalEntry {
  id: string;
  at: number;
  title: string;
  ops: JournalOp[];
  freed: number;
  undone?: boolean;
  /** caches deleted for good cannot be undone */
  undoable: boolean;
}

// ---------------------------------------------------------------- assistant

export type AiProvider = 'anthropic' | 'openai' | 'ollama';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiSuggestion {
  path: string;
  reason: string;
  size: number;
  safety: Safety;
}

export interface AiReply {
  text: string;
  suggestions: AiSuggestion[];
  /** a search the assistant proposes running, in Keeper's query language */
  search?: string;
}

// ---------------------------------------------------------------- progress & settings

export interface Progress {
  task: string;
  phase: string;
  done: number;
  total: number;
  current?: string;
  /** reading the folders: files found so far, and about how many there were last time (0: unknown) */
  found?: number;
  expected?: number;
}

export type Look = 'playful' | 'minimal';
export type Appearance = 'system' | 'light' | 'dark';

export interface Settings {
  /** kept for older settings and the Playful/Minimal toggle; `theme` decides the colours */
  look: Look;
  appearance: Appearance;
  /** theme id from core/themes.ts */
  theme: string;
  /** a custom accent colour (#rrggbb), or '' for the theme's own */
  accent: string;
  font: 'theme' | 'system' | 'rounded' | 'serif' | 'mono';
  density: 'comfortable' | 'compact';
  corners: 'theme' | 'rounded' | 'sharp';
  /** switch to the seasonal theme for the time of year (Winter, Spring, Summer, Autumn, Festive) */
  themeSeasons?: boolean;
  /** which half of the world the seasons follow; 'auto' uses the weather place or the time zone */
  hemisphere?: 'auto' | 'north' | 'south';
  /** Settings → Accessibility: motion, text size and focus outlines */
  a11y?: import('./a11y').A11ySettings;
  /** folders the library indexes */
  folders: string[];
  /** never index or touch anything under these */
  excluded: string[];
  showHidden: boolean;
  quickSearchShortcut: string;
  /** Keeper inside the operating system: Spotlight, desktop search, Explorer, native text recognition */
  platform: import('./platform-integrations').PlatformSettings;
  trayEnabled: boolean;
  trayCount: number;
  ocrEnabled: boolean;
  ocrLanguages: string[];
  oldDownloadDays: number;
  largeFileMb: number;
  unusedAppDays: number;
  rules: Rule[];
  savedSearches: SavedSearch[];
  pinned: string[];
  /** sidebar places the person removed (by id) */
  hiddenPlaces: string[];
  /** servers used with Connect to Server, newest first */
  recentServers: string[];
  /** let the library walk network drives and cloud folders (off: they can be slow or download files) */
  includeRemote: boolean;
  ai: { provider: AiProvider; model: string; ollamaUrl: string };
  /** Keeper's brain: the passage index, meaning search, the AIs it works with and the apps it serves */
  brain: import('./brain/config').BrainSettings;
  /** abilities any AI can use through Keeper: web, pictures, code, memory, schedules, personas, projects, teams */
  abilities?: import('./abilities/config').AbilitiesSettings;
  /** AI agents: what they may do, the model gateway, agent-to-agent, skills, learning */
  agents: import('./agents-config').AgentSettings;
  /** sync between your devices, backups and mirrors */
  sync: import('./sync/config').SyncSettings;
  /** desktop widgets (see core/widgets.ts) */
  widgets: import('./widgets').WidgetConfig[];
  /** check for new releases on GitHub once a day */
  /** kept for settings saved by early builds; updateMode replaces it */
  updateCheck: boolean;
  /** 'auto' downloads and installs new versions; 'ask' tells you first; 'off' only checks when you press the button */
  updateMode: 'auto' | 'ask' | 'off';
  /** also offer pre-release (beta) versions */
  updateBeta: boolean;
  /** the person set updateBeta themselves (a beta install otherwise follows betas) */
  updateBetaChosen: boolean;
  /** how much of the computer Keeper's background work may use (see core/governor.ts) */
  resourceMode: import('./governor').ResourceMode;
  /** closing the main window while Keeper stays in the tray lets its page go (unset: yes, except in Performance mode) */
  freeWindowOnClose?: boolean;
  /** features switched away from their default (see core/features.ts) */
  features: Record<string, boolean>;
  /** sidebar entries the person hid, by id ("section:tidy", "nav:health") */
  sidebarHidden: string[];
  /** feature sets the person saved ("Work", "Travel"), and which set to use on battery / on power */
  featureSets: { id: string; name: string; features: Record<string, boolean> }[];
  /** the one-icon menu bar was applied once (Keep Awake's and the readings' own icons turned off) */
  menuBarOneIcon?: boolean;
  /** the owl's glance: its cards, quick actions and hover (core/glance.ts) */
  glance?: Partial<import('./glance').GlanceSettings>;
  featureSetOnBattery: string;
  featureSetOnPower: string;
  /** Keep Awake: defaults for new sessions, triggers, menu-bar item and statistics (core/awake-engine.ts) */
  awake: import('./awake-engine').AwakeSettings;
  /** sidebar sections in the person's order, by id */
  sidebarOrder: string[];
  /** the version that ran last, to show "What's new" once after an update */
  lastRunVersion: string;
  /** when a downloaded update goes in (null = the default for the update mode) */
  updatePlan?: import('./update-schedule').UpdatePlan | null;
  /** the version the person chose to skip ("Skip this version"); automatic checks stay quiet about it */
  updateSkip?: string;
  /** reopen the page you were on after an update or restart */
  restorePlace?: boolean;
  /** open pages in tabs (⌘/Ctrl-click or middle-click, ⌘T); off keeps one page per window */
  tabs?: boolean;
  language: string;
  /** when the details panel on the right shows (Settings → Appearance) */
  inspectorMode: import('./inspector').InspectorMode;
  /** the sidebar: full, an icons-only rail, or the rail in narrow windows (Settings → Sidebar) */
  sidebarMode: import('./sidebar-layout').SidebarMode;
  /** long sidebar sections show this many items (most used first) and "Show all"; 0 shows everything */
  sidebarSectionLimit: number;
  /** Home's sections, order, density and styles (Edit Home) */
  home: import('./home-layout').HomeSettings;
  /** the first-run Permissions step: set everything up now, only what gets turned on, or not chosen yet */
  permissionsSetup: '' | 'all' | 'onDemand';
  /** which app opens maps, weather, events, addresses… per kind ('auto', 'web' or an app id; see core/native-apps.ts) */
  nativeApps?: import('./native-apps').NativeAppPrefs;
}
