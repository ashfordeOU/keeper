// SPDX-License-Identifier: AGPL-3.0-or-later
// The contract between the interface and the main process. The preload script
// exposes exactly this object as `window.keeper`; the demo build fakes it.

import type { AgentSession, CalendarEvent, ClipItem, FocusState, LyricLine } from './island';
import type { CaptureEntry, CaptureOptions, PickedColor } from './capture';
import type { RenamePreview, RenameStep } from './rename';
import type { Place, Weather } from './weather';
import type { ConvertCapabilities, ConvertJob, ConvertResult } from './convert-types';
import type { AwakeTrigger } from './awake';
import type { KeeperApiX } from './api-x';
import type { PlacesApi } from './api-places';
import type { PlatformApi } from './api-platform';
import type { LockApi } from './api-lock';
import type { BrainApi, BrainDelta, BrainStep } from './api-brain';
import type { PreviewApi } from './previewTypes';
import type { WidgetConfig } from './widgets';
import type {
  AiMessage, AiProvider, AiReply, AppInfo, CleanResult, CleanupEntry, CleanupGroup, DiskInfo, DuplicateGroup, FileEntry, FileKind,
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
  /** a placeholder whose contents live only in the cloud (iCloud, OneDrive, Dropbox… on demand) */
  cloudOnly?: boolean;
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
  kind: 'download' | 'screenshot' | 'focus' | 'agent' | 'battery' | 'info' | 'notification';
  title: string;
  /** the app a mirrored notification came from */
  app?: string;
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
  /** barcode format of `code`: QR_CODE, EAN_13, CODE_128, … */
  codeFormat?: string;
  image?: string;
}

export interface RecordState {
  recording: boolean;
  since?: number;
  mode?: 'full' | 'window' | 'area';
  path?: string;
  error?: string;
}

export interface ShelfView {
  id: string;
  name: string;
  color: string;
  pinned?: boolean;
  items: FileEntry[];
}

export interface DevicesState {
  /** 0–100 */
  volume?: number;
  muted?: boolean;
  /** displays whose brightness Keeper can change */
  monitors: { id: string; name: string; brightness?: number; external: boolean }[];
  /** wireless devices that report their charge */
  bluetooth: { name: string; percent: number }[];
  /** the helper used for external monitors, or why it is missing */
  ddc?: string;
}

export type ShelfAction = 'zip' | 'copyText' | 'moveTo' | 'copyTo' | 'script' | 'upload' | 'copyPaths' | 'resize';

export interface UploadSettings {
  kind: 'none' | 'webdav' | 's3';
  /** WebDAV folder URL, or the S3 endpoint (https://s3.eu-west-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com, …) */
  url: string;
  username: string;
  bucket: string;
  region: string;
  /** S3 access key id (the secret is kept in the keychain) */
  accessKeyId: string;
  /** folder inside the bucket or server */
  prefix: string;
  /** S3: how long shared links work */
  expiresHours: number;
  /** WebDAV: public base URL for links, if the server publishes uploads somewhere else */
  publicUrl: string;
}

export interface ScriptAction {
  id: string;
  name: string;
  /** a command; {files} {file} {dir} are filled in */
  command: string;
}

export interface IslandState {
  /** items of the active shelf (kept for older views) */
  shelf: FileEntry[];
  shelves: ShelfView[];
  activeShelf: string;
  closedShelves: { id: string; name: string; color: string; count: number }[];
  devices?: DevicesState;
  /** reasons automatic keep-awake is on */
  awakeTriggers?: string[];
  /** hidden by the user or because an app is full screen */
  hidden?: boolean;
  clips: ClipItem[];
  focus: FocusState;
  keepAwake: KeepAwakeState;
  weather?: Weather;
  battery?: { percent: number; charging: boolean };
  /** remaining ms until the next break reminder, when break reminders are on */
  breakIn?: number;
  /** a screen recording is running */
  recording?: { since: number };
  agents: AgentSession[];
  events: CalendarEvent[];
  nowPlaying?: NowPlaying;
  lyrics?: LyricLine[];
  micInUse?: string[];
  /** apps using a camera (Windows and Linux; macOS shows its own light) */
  camInUse?: string[];
  alerts: IslandAlert[];
}

export interface IslandPlacementPreview {
  platform: string;
  desktop?: string;
  macModel?: string;
  wayland: boolean;
  xwayland: boolean;
  displays: { info: import('./island-place').DisplayInfo; placement: import('./island-place').Placement; primary: boolean; label: string }[];
  wanted: number[];
}

export interface IslandSettings {
  enabled: boolean;
  /** which screen edge the island sits on */
  edge: 'top' | 'left' | 'right';
  /** which screens get an Island: the main one, every one, the one with the pointer, or the laptop's own */
  displays: 'primary' | 'all' | 'mouse' | 'builtin';
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
  /** clipboard picker that pastes into the app in front */
  pasteShortcut: string;
  /** open the shelf from anywhere */
  shelfShortcut: string;
  hideShortcut: string;
  awakeShortcut: string;
  /** open the shelf when a file is dragged to the top edge of the screen */
  edgeDrop: boolean;
  clipMax: number;
  /** forget unpinned, unfiled clips after this many days (0 = keep) */
  clipRetentionDays: number;
  /** never record copies made in these apps (password managers…) */
  clipIgnoreApps: string[];
  /** look up page titles of copied links (sends a request to that site) */
  clipFetchTitles: boolean;
  /** paste as plain text from the picker */
  clipPlainPaste: boolean;
  awakeTriggers: AwakeTrigger[];
  /** keep an external drive from sleeping by touching a hidden file */
  driveKeepAwake: { path: string; seconds: number } | null;
  /** Linux: show other apps' notifications in the Island */
  notifyMirror: boolean;
  /** only these apps (empty = all) */
  notifyApps: string[];
  hideInFullscreen: boolean;
  upload: UploadSettings;
  scriptActions: ScriptAction[];
  /** how big the Island is */
  size?: 'compact' | 'normal' | 'large';
  /** on Macs with a notch, grow out of it in the same black */
  blendNotch?: boolean;
  /** where the camera is ('auto' follows the screen's rotation) */
  cameraEdge?: 'auto' | 'top' | 'left' | 'right' | 'bottom';
  /** move to the side when a tablet is turned and the camera is on a long edge */
  followCamera?: boolean;
  /** draw a small camera dot in the middle of the pill on screens without a notch */
  cameraDot?: boolean;
  /** move the Island by hand, in points */
  offsetX?: number;
  offsetY?: number;
  /** Linux on Wayland: run Keeper through XWayland so the Island can stay on top and in place */
  x11OnWayland?: boolean;
  /** show dots while the camera or microphone is in use */
  privacyDots?: boolean;
  /** activity kinds not to show in the pill */
  activitiesOff?: string[];
  /** open the Island when the pointer rests on it (tap or click always works) */
  hoverOpen?: boolean;
}

export interface KeeperApi extends KeeperApiX {
  places: PlacesApi;
  platform: PlatformApi;
  lock: LockApi;
  /** Keeper's brain: passage index, meaning search, the AI harness and the AI apps it serves */
  brain: BrainApi;
  /** the process manager and services in Health */
  /** universal file previews */
  preview: PreviewApi;
  /** video, audio, picture, PDF and file tools; results always go to a new folder */
  convert: {
    run(job: ConvertJob): Promise<ConvertResult>;
    capabilities(): Promise<ConvertCapabilities>;
    /** how long a video or audio file is, in seconds */
    duration(path: string): Promise<number | null>;
    /** how many pages a PDF has */
    pageCount(path: string): Promise<number | null>;
  };
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
    /** reads text (and codes) from an image or PDF file */
    readFile(path: string): Promise<CaptureResult>;
    /** saves a screenshot of the whole screen, a chosen window or a dragged area; returns its path */
    screenshot(mode?: 'full' | 'window' | 'area'): Promise<string | null>;
    record(mode?: 'full' | 'window' | 'area', opts?: { mic?: boolean; systemAudio?: boolean; countdown?: number }): Promise<RecordState>;
    stopRecording(): Promise<string | null>;
    recordState(): Promise<RecordState>;
    /** pick a colour from anywhere on screen; it is copied as hex */
    color(): Promise<PickedColor | null>;
    /** the last 20 picked colours, newest first */
    colors(): Promise<string[]>;
    history(): Promise<CaptureEntry[]>;
    removeHistory(id: string): Promise<void>;
    clearHistory(): Promise<void>;
    options(): Promise<CaptureOptions>;
    setOptions(patch: Partial<CaptureOptions>): Promise<CaptureOptions>;
    /** opens a link read from a QR code (http and https only) */
    openLink(url: string): Promise<void>;
  };
  weather: {
    get(force?: boolean): Promise<Weather | null>;
    search(name: string): Promise<Place[]>;
  };
  widgets: {
    list(): Promise<WidgetConfig[]>;
    save(widget: WidgetConfig): Promise<WidgetConfig[]>;
    remove(id: string): Promise<WidgetConfig[]>;
    /** images in a folder, for the photo widget */
    photos(folder: string): Promise<string[]>;
    /** the widget this window shows (inside a widget window) */
    current(): Promise<WidgetConfig | null>;
  };
  settings: {
    get(): Promise<Settings & { island: IslandSettings }>;
    set(patch: Partial<Settings & { island: Partial<IslandSettings> }>): Promise<Settings & { island: IslandSettings }>;
    /** AI keys are stored under the connection's id (see core/brain/config.ts) */
    setSecret(name: AiProvider | 'dictation' | 'upload' | (string & {}), value: string): Promise<boolean>;
    hasSecret(name: AiProvider | 'dictation' | 'upload' | (string & {})): Promise<boolean>;
    pickFolder(): Promise<string | null>;
    pickFiles(opts?: { title?: string; extensions?: string[] }): Promise<string[]>;
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
    /** a full-size image as a data URL, for the editor (library folders only) */
    readImage(path: string): Promise<string>;
    /** saves a PNG; an existing image's path saves next to it as "name (edited).png". Returns the saved path. */
    writeImage(path: string, dataUrl: string): Promise<string>;
    copyImage(dataUrl: string): Promise<void>;
    /** the real path of a file dropped from the system (desktop app only) */
    pathOf?(file: File): string;
  };
  duplicates: {
    scan(opts?: { similar?: boolean; threshold?: number }): Promise<DuplicateGroup[]>;
  };
  cleanup: {
    scan(): Promise<CleanupGroup[]>;
    clean(groups: { id: string; paths?: string[] }[]): Promise<CleanResult>;
    /** what is inside a group (or a folder within it), for the advanced view */
    details(id: string, dir?: string): Promise<CleanupEntry[]>;
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
    /** the closed pill's size, so the window covers nothing else */
    setSize(width: number, height: number): void;
    createShelf(name?: string): Promise<void>;
    selectShelf(id: string): Promise<void>;
    renameShelf(id: string, name: string): Promise<void>;
    setShelfColor(id: string, color: string): Promise<void>;
    pinShelf(id: string): Promise<void>;
    closeShelf(id: string): Promise<void>;
    reopenShelf(id: string): Promise<void>;
    moveShelfItem(from: number, to: number): Promise<void>;
    renameShelfItem(path: string, name: string): Promise<void>;
    /** runs an action on the active shelf's files (or the given paths) */
    shelfAction(action: ShelfAction, arg?: string, paths?: string[]): Promise<{ message: string; link?: string }>;
    updateClip(id: string, patch: { note?: string }): Promise<void>;
    toggleClipCollection(id: string, name: string): Promise<void>;
    /** puts a clip on the clipboard and pastes it into the app in front */
    pasteClip(id: string, plain?: boolean): Promise<void>;
    exportClips(): Promise<string | null>;
    importClips(): Promise<number>;
    openClips(): Promise<void>;
    closeClips(): void;
    openShelf(): Promise<void>;
    hide(hidden: boolean): Promise<void>;
    setVolume(value: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    setBrightness(monitorId: string, value: number): Promise<void>;
    refreshDevices(): Promise<DevicesState>;
    /** what the automatic keep-awake rules see right now */
    awakeStatus(): Promise<{ active: string[]; snapshot: Record<string, unknown> }>;
    /** where this Island window sits and what it fits around (notch, bars, camera) */
    layout(): Promise<import('./island-place').Placement | null>;
    /** every screen, what was detected on it, and where the Island goes; for Settings */
    placementPreview(): Promise<IslandPlacementPreview>;
  };
  on(channel: 'progress', cb: (p: Progress) => void): () => void;
  on(channel: 'library-changed' | 'island-changed', cb: () => void): () => void;
  on(channel: 'navigate', cb: (route: string) => void): () => void;
  on(channel: 'dictation', cb: (state: 'start' | 'stop') => void): () => void;
  on(channel: 'palette', cb: () => void): () => void;
  on(channel: 'settings-changed', cb: (settings: Settings & { island: IslandSettings }) => void): () => void;
  on(channel: 'widgets-changed', cb: () => void): () => void;
  on(channel: 'places-changed', cb: () => void): () => void;
  on(channel: 'locks-changed', cb: () => void): () => void;
  on(channel: 'brain-status', cb: (s: import('./brain-contract').BrainStatus) => void): () => void;
  on(channel: 'brain-delta', cb: (d: BrainDelta) => void): () => void;
  on(channel: 'brain-step', cb: (d: BrainStep) => void): () => void;
  on(channel: 'lock-progress', cb: (p: import('./vault').VaultProgress & { target: string }) => void): () => void;
  on(channel: 'island-open', cb: (tab: string) => void): () => void;
  on(channel: 'island-layout', cb: (p: import('./island-place').Placement) => void): () => void;
}
