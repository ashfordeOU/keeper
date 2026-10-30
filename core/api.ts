// SPDX-License-Identifier: AGPL-3.0-or-later
// The contract between the interface and the main process. The preload script
// exposes exactly this object as `window.keeper`; the demo build fakes it.

import type { AgentSession, CalendarEvent, ClipItem, FocusState, LyricLine } from './island';
import type { RenamePreview, RenameStep } from './rename';
import type { Place, Weather } from './weather';
import type {
  AiMessage, AiProvider, AiReply, AppInfo, CleanResult, CleanupGroup, DiskInfo, DuplicateGroup, FileEntry, FileKind,
  JournalEntry, ParsedQuery, Progress, ProtectionReport, Rule, RulePlanItem, SearchHit, Settings, SpaceNode, StartupItem,
} from './types';

export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux';
  arch: string;
  osVersion: string;
  appVersion: string;
  home: string;
  sep: string;
}

export interface LibraryStatus {
  indexing: boolean;
  files: number;
  lastScan: number;
  ocrPending: number;
}

export interface BrowseEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: FileKind | 'folder';
  ext: string;
  hidden: boolean;
}

export interface NowPlaying {
  app: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  playing: boolean;
  position: number;
  duration: number;
  canShuffle?: boolean;
  shuffle?: boolean;
  repeat?: boolean;
}

export interface IslandAlert {
  id: string;
  kind: 'download' | 'screenshot' | 'focus' | 'agent' | 'battery' | 'info';
  title: string;
  detail?: string;
  path?: string;
  at: number;
}

export interface KeepAwakeOptions {
  /** stay awake for this many minutes */
  minutes?: number;
  /** stay awake until this time (epoch ms) */
  until?: number;
  /** while an app with this name is running */
  whileApp?: string;
  /** while this file is still growing (a download in progress) */
  whileFile?: string;
  /** only while on mains power */
  onlyOnPower?: boolean;
  /** let the screen turn off but keep the computer running */
  allowDisplaySleep?: boolean;
  /** end the session when battery drops below this percent */
  stopBelowBattery?: number;
}

export interface KeepAwakeState {
  on: boolean;
  since?: number;
  until?: number;
  reason?: string;
  options?: KeepAwakeOptions;
}

export interface HealthReport {
  cpuPercent: number;
  cores: number;
  cpuModel: string;
  memory: { total: number; free: number };
  uptimeSec: number;
  loadAvg: number[];
  battery?: { percent: number; charging: boolean; health?: number; cycles?: number };
  processes: { pid: number; name: string; cpu: number; memory: number }[];
  /** apps or services currently preventing sleep */
  awakeBlockers: string[];
  /** local servers listening on a port (dev servers, databases) */
  listening: { port: number; pid: number; name: string }[];
}

export interface CaptureResult {
  text: string;
  /** decoded QR code / barcode, when the area contained one */
  code?: string;
  image?: string;
}

export interface IslandState {
  shelf: FileEntry[];
  clips: ClipItem[];
  focus: FocusState;
  keepAwake: KeepAwakeState;
  weather?: Weather;
  battery?: { percent: number; charging: boolean };
  /** remaining ms until the next break reminder, when break reminders are on */
  breakIn?: number;
  agents: AgentSession[];
  events: CalendarEvent[];
  nowPlaying?: NowPlaying;
  lyrics?: LyricLine[];
  micInUse?: string[];
  alerts: IslandAlert[];
}

export interface IslandSettings {
  enabled: boolean;
  /** which screen edge the island sits on */
  edge: 'top' | 'left' | 'right';
  /** 'all' or display ids */
  displays: 'primary' | 'all';
  buddy: boolean;
  clipboard: boolean;
  agents: boolean;
  lyrics: boolean;
  calendarUrl: string;
  dictationShortcut: string;
  /** an OpenAI-compatible /audio/transcriptions endpoint (Groq, OpenAI, a local whisper server) */
  dictationUrl: string;
  dictationModel: string;
  soundOnAgent: boolean;
  weather: boolean;
  place: Place | null;
  units: 'metric' | 'imperial';
  /** remind to take a break every N minutes of activity (0 = off) */
  breakEvery: number;
  /** strip tracking parameters (utm_, fbclid, …) from links you copy */
  cleanLinks: boolean;
  /** shortcut for "copy text from an area of the screen" */
  captureShortcut: string;
  /** play an alert when a download finishes / a screenshot is taken */
  downloadAlerts: boolean;
}

export interface KeeperApi {
  system: {
    info(): Promise<SystemInfo>;
    disks(): Promise<DiskInfo[]>;
    health(): Promise<HealthReport>;
    killProcess(pid: number): Promise<boolean>;
    ejectAll(): Promise<{ ejected: string[]; failed: string[] }>;
    wifiNetworks(): Promise<{ ssid: string; password?: string }[]>;
    openExternal(url: string): Promise<void>;
  };
  capture: {
    /** lets the user drag over an area of the screen and returns the text (and any QR code) in it */
    text(): Promise<CaptureResult | null>;
    /** reads text from an image currently on the clipboard */
    clipboardImage(): Promise<CaptureResult | null>;
  };
  weather: {
    get(force?: boolean): Promise<Weather | null>;
    search(name: string): Promise<Place[]>;
  };
  settings: {
    get(): Promise<Settings & { island: IslandSettings }>;
    set(patch: Partial<Settings & { island: Partial<IslandSettings> }>): Promise<Settings & { island: IslandSettings }>;
    setSecret(name: AiProvider | 'dictation', value: string): Promise<boolean>;
    hasSecret(name: AiProvider | 'dictation'): Promise<boolean>;
    pickFolder(): Promise<string | null>;
  };
  library: {
    status(): Promise<LibraryStatus>;
    rescan(): Promise<void>;
    totals(): Promise<Record<FileKind, { count: number; size: number }>>;
    recent(n: number, kind?: FileKind | 'screenshot' | 'download'): Promise<FileEntry[]>;
    list(opts: { kind?: FileKind; screenshot?: boolean; root?: string; source?: string; tag?: string; sort?: 'name' | 'date' | 'size' | 'kind'; desc?: boolean; limit?: number }): Promise<FileEntry[]>;
    search(text: string, limit?: number): Promise<{ parsed: ParsedQuery; hits: SearchHit[] }>;
    bySource(): Promise<{ id: string; name: string; count: number; size: number; latest: number }[]>;
    tags(): Promise<{ tag: string; count: number }[]>;
    setTags(path: string, tags: string[]): Promise<void>;
    inspect(path: string): Promise<FileEntry | null>;
    readText(paths: string[]): Promise<{ path: string; text: string }[]>;
    largeFiles(minMb: number): Promise<FileEntry[]>;
  };
  files: {
    browse(dir: string, showHidden?: boolean): Promise<BrowseEntry[]>;
    thumbnail(path: string, size: number): Promise<string | null>;
    icon(path: string): Promise<string | null>;
    open(path: string): Promise<void>;
    openWith(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    copyPaths(paths: string[]): Promise<void>;
    copyText(text: string): Promise<void>;
    trash(paths: string[], title?: string): Promise<CleanResult>;
    move(paths: string[], dir: string): Promise<CleanResult>;
    copy(paths: string[], dir: string): Promise<CleanResult>;
    rename(path: string, name: string): Promise<string>;
    previewRename(paths: string[], steps: RenameStep[]): Promise<RenamePreview[]>;
    applyRename(paths: string[], steps: RenameStep[]): Promise<CleanResult>;
    newFolder(dir: string, name: string): Promise<string>;
    compress(paths: string[]): Promise<string>;
    startDrag(paths: string[]): void;
    /** the real path of a file dropped from the system (desktop app only) */
    pathOf?(file: File): string;
  };
  duplicates: {
    scan(opts?: { similar?: boolean; threshold?: number }): Promise<DuplicateGroup[]>;
  };
  cleanup: {
    scan(): Promise<CleanupGroup[]>;
    clean(groups: { id: string; paths?: string[] }[]): Promise<CleanResult>;
  };
  space: {
    tree(path: string): Promise<SpaceNode>;
  };
  startup: {
    list(): Promise<StartupItem[]>;
    toggle(id: string, enabled: boolean): Promise<StartupItem[]>;
  };
  apps: {
    list(): Promise<AppInfo[]>;
    uninstall(id: string): Promise<CleanResult>;
  };
  protection: {
    check(): Promise<ProtectionReport>;
  };
  rules: {
    list(): Promise<Rule[]>;
    save(rule: Rule): Promise<Rule[]>;
    remove(id: string): Promise<Rule[]>;
    plan(id: string): Promise<RulePlanItem[]>;
    run(id: string): Promise<CleanResult>;
  };
  history: {
    list(): Promise<JournalEntry[]>;
    undo(id: string): Promise<{ restored: number; failed: string[] }>;
  };
  ai: {
    ask(history: AiMessage[]): Promise<AiReply>;
  };
  island: {
    state(): Promise<IslandState>;
    addToShelf(paths: string[]): Promise<void>;
    removeFromShelf(path: string): Promise<void>;
    clearShelf(): Promise<void>;
    copyClip(id: string): Promise<void>;
    pinClip(id: string): Promise<void>;
    removeClip(id: string): Promise<void>;
    clearClips(): Promise<void>;
    focus(action: 'start' | 'pause' | 'resume' | 'stop', minutes?: number): Promise<FocusState>;
    keepAwake(on: boolean, options?: KeepAwakeOptions): Promise<KeepAwakeState>;
    presentation(on: boolean): Promise<boolean>;
    media(action: 'toggle' | 'next' | 'previous' | 'seek', value?: number): Promise<void>;
    openAgent(id: string): Promise<void>;
    transcribe(audio: ArrayBuffer, mime: string): Promise<string>;
    typeText(text: string): Promise<void>;
    dismiss(alertId: string): Promise<void>;
    setExpanded(expanded: boolean): void;
  };
  on(channel: 'progress', cb: (p: Progress) => void): () => void;
  on(channel: 'library-changed' | 'island-changed', cb: () => void): () => void;
  on(channel: 'navigate', cb: (route: string) => void): () => void;
  on(channel: 'dictation', cb: (state: 'start' | 'stop') => void): () => void;
  on(channel: 'palette', cb: () => void): () => void;
}
