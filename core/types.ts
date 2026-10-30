// SPDX-License-Identifier: AGPL-3.0-or-later
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
  /** user tags (macOS Finder tags, or Keeper tags on other systems) */
  tags?: string[];
  /** media details filled in lazily */
  meta?: MediaMeta;
  /** file only exists in the cloud (iCloud / OneDrive placeholder) */
  cloudOnly?: boolean;
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
  type: 'trash' | 'move' | 'delete' | 'startup' | 'tag';
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
}

export type Look = 'playful' | 'minimal';
export type Appearance = 'system' | 'light' | 'dark';

export interface Settings {
  look: Look;
  appearance: Appearance;
  /** folders the library indexes */
  folders: string[];
  /** never index or touch anything under these */
  excluded: string[];
  showHidden: boolean;
  quickSearchShortcut: string;
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
  ai: { provider: AiProvider; model: string; ollamaUrl: string };
  /** check for new releases on GitHub once a day */
  updateCheck: boolean;
  language: string;
}
